const Parser = require('rss-parser');
const cheerio = require('cheerio');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { SOURCES, RSSHUB_INSTANCES } = require('./sources');
const store = require('./store');
const githubRepo = require('./github-repo');
const constants = require('./fetcher/constants');
const runtime = require('./fetcher/runtime');
const {
  isNonPublicIpAddress,
  publicHttpUrl,
  remainingDeadlineMs,
  resolvePublicTarget,
  createPinnedLookup,
  assertPublicHttpUrl,
} = require('./fetcher/net-safety');
const {
  decodeResponseBuffer,
} = require('./fetcher/text-codec');
const {
  stripHtml,
  escapeHtmlForHtml,
  absoluteUrl,
  hostnameOf,
  decodeEntities,
  metaContent,
  isTrackingPixelUrl,
  toLocalArticleImageUrl,
  firstImage,
  isGenericCoverImage,
  isLikelyArticleOgImage,
  contentHasRealImage,
  pickArticleCoverImage,
  bestSrcsetCandidate,
  normalizeFeedContent,
  normalizeRenderedContent,
  isPaulGrahamUrl,
  jamesClearNewsletterTimestamp,
  isJamesClearNewsletterUrl,
  contentContainerScore,
  extractReadableContent,
} = require('./fetcher/html-content');
const {
  TIMEOUT_MS,
  MAX_TEXT_RESPONSE_BYTES,
  MAX_HTML_RESPONSE_BYTES,
  BROWSER_HEADERS,
  sleep,
  isHnrssUrl,
  fetchPublicBuffer,
  safeRasterMimeType,
  fetchText: fetchTextHttp,
} = require('./fetcher/http-public');
const {
  IMAGE_ROOT,
  isLocalArticleImageUrl,
  isLocalizableRemoteImageUrl,
  imageRefererFor,
  collectContentImageUrls,
  rewriteContentImageUrls,
  localImagePaths,
  findExistingLocalImage,
  downloadImageForLocalize,
  localizeEntryImages,
} = require('./fetcher/images-localize');
const { createHackerNews } = require('./fetcher/sources-hackernews');
const { createEntriesNormalize } = require('./fetcher/entries-normalize');
const { createSourceFetch } = require('./fetcher/sources-fetch');
const { createCatalog } = require('./fetcher/sources-catalog');

const {
  USER_SUBMITTED_SOURCE_ID,
  GITHUB_PROJECTS_SOURCE_ID: CONST_GITHUB_PROJECTS_SOURCE_ID,
  HUGGINGFACE_SOURCE_ID,
  PRODUCTHUNT_SOURCE_ID,
  HACKERNEWS_SOURCE_ID,
  HACKERNEWS_DISCUSSION_FETCH_LIMIT,
  HACKERNEWS_AUTHOR_LOOKUP_LIMIT,
  HACKERNEWS_THREAD_COMMENT_FETCH_COUNT,
  HACKERNEWS_DISCUSSION_COMMENT_LIMIT,
  HACKERNEWS_AUTHOR_REPLY_LIMIT,
  HACKERNEWS_API_COMMENT_FETCH_LIMIT,
  HNRSS_REQUEST_GAP_MS,
  CONCURRENCY,
  RSS_HEADERS,
} = constants;

const GITHUB_PROJECTS_SOURCE_ID = githubRepo.GITHUB_PROJECTS_SOURCE_ID || CONST_GITHUB_PROJECTS_SOURCE_ID || 'github-projects';

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: RSS_HEADERS,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded'],
      ['comments', 'comments'],
      ['dc:creator', 'dcCreator'],
    ],
  },
});

async function waitForHnrssRequestSlot() {
  const slot = runtime.hnrssRequestQueue.then(async () => {
    const gap = Number.isFinite(HNRSS_REQUEST_GAP_MS) ? HNRSS_REQUEST_GAP_MS : 1500;
    const elapsed = Date.now() - runtime.lastHnrssRequestAt;
    if (elapsed < gap) await sleep(gap - elapsed);
    runtime.lastHnrssRequestAt = Date.now();
  });
  runtime.hnrssRequestQueue = slot.catch(() => {});
  return slot;
}

/** 门面包装：默认注入 hnrss 限速槽位（http-public 层默认 no-op） */
async function fetchText(url, timeout = TIMEOUT_MS, maxBytes = MAX_TEXT_RESPONSE_BYTES, dependencies = {}) {
  return fetchTextHttp(url, timeout, maxBytes, {
    waitForHnrssRequestSlot,
    ...dependencies,
  });
}

async function parseRssUrl(url) {
  const xml = await fetchText(url, isHnrssUrl(url) ? 7000 : TIMEOUT_MS, MAX_TEXT_RESPONSE_BYTES, {
    headers: RSS_HEADERS,
  });
  return parser.parseString(xml);
}

// ---------------------------------------------------------------------------
// 运行时数据权威（双真相收敛）— 可变共享见 lib/fetcher/runtime.js
// | 数据              | 权威                    | 加速层                                      |
// | 条目正文/列表     | SQLite (store)          | runtime.cache；cache.json 仅元数据+轻量镜像 |
// | 源启用状态        | state.json + runtime.state | —                                         |
// | localOnly 源      | 仅 SQLite               | 内存 cache 按需 hydrate；禁止整源写巨型 json |
// ---------------------------------------------------------------------------

function hydrateCacheFromDb() {
  // 从 SQLite 灌入 runtime.cache；DB 为条目正文/列表的权威源
  for (const src of SOURCES) {
    if (!src || !src.id) continue;
    const limit = Math.max(src.limit || 50, 5000);
    let rows = [];
    try {
      rows = store.listEntriesBySource(src.id, limit) || [];
    } catch {
      rows = [];
    }
    if (!rows.length) continue;
    const prev = runtime.cache[src.id];
    runtime.cache[src.id] = {
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      feedUrl: (prev && prev.feedUrl) || 'local-db',
      feedTitle: src.name,
      status: 'ok',
      error: null,
      failureCount: 0,
      nextRetryAt: null,
      entries: rows,
    };
  }
}

/**
 * 写 cache.json 前净化（不改动传入对象 / 内存 runtime.cache）。
 * - localOnly：不落 entries（[] + entryCount + diskSkipped），权威在 SQLite
 * - RSS/其它：保留列表字段（title/summary/link/image/…），剥掉每条 content
 * - manual：同样剥 content，元数据+轻量列表即可
 */
function cachePayloadForDisk(cacheObj) {
  const out = {};
  const input = cacheObj && typeof cacheObj === 'object' && !Array.isArray(cacheObj) ? cacheObj : {};
  for (const [sourceId, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      out[sourceId] = raw;
      continue;
    }
    const src = SOURCES.find(s => s && s.id === sourceId) || null;
    if (src && src.localOnly) {
      const entryCount = Array.isArray(raw.entries)
        ? raw.entries.length
        : (Number(raw.entryCount) || 0);
      out[sourceId] = {
        fetchedAt: raw.fetchedAt,
        lastAttemptAt: raw.lastAttemptAt,
        feedUrl: raw.feedUrl,
        feedTitle: raw.feedTitle,
        status: raw.status,
        error: raw.error,
        failureCount: raw.failureCount,
        nextRetryAt: raw.nextRetryAt,
        entries: [],
        entryCount,
        diskSkipped: 'localOnly-sqlite',
      };
      continue;
    }
    if (!Array.isArray(raw.entries) || !raw.entries.length) {
      out[sourceId] = raw;
      continue;
    }
    out[sourceId] = {
      ...raw,
      entries: raw.entries.map(entry => {
        if (!entry || typeof entry !== 'object') return entry;
        if (!Object.prototype.hasOwnProperty.call(entry, 'content')) return entry;
        const { content: _content, ...rest } = entry;
        return rest;
      }),
    };
  }
  return out;
}

function loadDisk({ upsert = true } = {}) {
  if (runtime.saveTimer || runtime.pendingCacheSourceIds.size || runtime.pendingCacheEntryPatches.size) flushDisk();
  // cache.json 可删可重建：仅为加速层镜像，条目权威始终是 SQLite
  try { runtime.cache = JSON.parse(fs.readFileSync(runtime.CACHE_FILE, 'utf8')); } catch { runtime.cache = {}; }
  try { runtime.state = JSON.parse(fs.readFileSync(runtime.STATE_FILE, 'utf8')); } catch { runtime.state = {}; }
  runtime.pendingCacheSourceIds.clear();
  runtime.pendingCacheEntryPatches.clear();

  // localOnly 条目禁止信任磁盘镜像：丢弃 entries，强制后续 hydrateCacheFromDb / ensureLocalOnlyCache
  for (const src of SOURCES) {
    if (!src || !src.id || !src.localOnly) continue;
    const c = runtime.cache[src.id];
    if (!c || typeof c !== 'object') continue;
    if (Array.isArray(c.entries) && c.entries.length) {
      runtime.cache[src.id] = {
        ...c,
        entries: [],
        entryCount: c.entries.length,
        diskSkipped: 'localOnly-sqlite',
      };
    }
  }

  // SQLite 权威：先以 DB 灌入（含本地导入），再视需要把 runtime.cache 中多出的 RSS 条目回写
  // 避免陈旧 cache.json 用错误 publishedTs 覆盖已修正的 DB
  hydrateCacheFromDb();
  if (upsert) {
    for (const [sourceId, c] of Object.entries(runtime.cache)) {
      if (!c || !Array.isArray(c.entries) || !c.entries.length) continue;
      const src = SOURCES.find(s => s && s.id === sourceId);
      // localOnly 仅 SQLite 权威，禁止 runtime.cache → DB 回灌
      if (src && src.localOnly) continue;
      // 仅当 runtime.cache 条目明显更新（publishedTs 单位毫秒且合理）才 upsert
      const sample = c.entries[0];
      const ts = Number(sample && sample.publishedTs) || 0;
      if (ts > 0 && ts < 1e12) {
        // 旧 runtime.cache 用了秒级时间戳，丢弃不回写
        continue;
      }
      // 若该源已由 DB 灌满，跳过回写，防止覆盖导入修正
      const dbCount = (() => {
        try { return store.countEntriesBySource ? store.countEntriesBySource(sourceId) : 0; } catch { return 0; }
      })();
      if (dbCount >= c.entries.length) continue;
      store.upsertEntries(c.entries);
    }
  }
  hydrateCacheFromDb();
}


function markCacheSourceChanged(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id) return;
  // localOnly 权威在 SQLite；禁止排进写盘队列（任何路径都不得整源 stringify 进 cache.json）
  const src = SOURCES.find(s => s && s.id === id);
  if (src && src.localOnly) return;
  runtime.pendingCacheSourceIds.add(id);
  runtime.pendingCacheEntryPatches.delete(id);
}

function markCacheEntryChanged(sourceId, entryId, fields) {
  const source = String(sourceId || '').trim();
  const entry = String(entryId || '').trim();
  if (!source || !entry || runtime.pendingCacheSourceIds.has(source)) return;
  if (!runtime.pendingCacheEntryPatches.has(source)) runtime.pendingCacheEntryPatches.set(source, new Map());
  const patches = runtime.pendingCacheEntryPatches.get(source);
  patches.set(entry, { ...(patches.get(entry) || {}), ...(fields || {}) });
}

function mergeCacheSources(latest, local, sourceIds) {
  const merged = { ...(latest && typeof latest === 'object' ? latest : {}) };
  for (const sourceId of sourceIds || []) {
    if (Object.prototype.hasOwnProperty.call(local || {}, sourceId)) {
      const localSource = local[sourceId];
      const latestSource = merged[sourceId];
      if (localSource && latestSource && Array.isArray(localSource.entries) && Array.isArray(latestSource.entries)) {
        const latestById = new Map(latestSource.entries
          .filter(entry => entry && entry.id)
          .map(entry => [entry.id, entry]));
        const entries = localSource.entries.map(entry => {
          const latestEntry = entry && entry.id ? latestById.get(entry.id) : null;
          if (!latestEntry) return entry;
          const localFetchedAt = Number(entry.originalFetchedAt) || 0;
          const latestFetchedAt = Number(latestEntry.originalFetchedAt) || 0;
          const localAttemptedAt = Number(entry.originalFetchAttemptedAt) || 0;
          const latestAttemptedAt = Number(latestEntry.originalFetchAttemptedAt) || 0;
          const attemptFields = latestAttemptedAt > localAttemptedAt
            ? {
              originalFetchAttemptedAt: latestEntry.originalFetchAttemptedAt,
              originalFetchError: latestEntry.originalFetchError,
            }
            : {};
          const contentFields = latestFetchedAt > localFetchedAt
            ? {
              content: latestEntry.content,
              summary: latestEntry.summary,
              image: latestEntry.image,
              contentHash: latestEntry.contentHash,
              originalFetchedAt: latestEntry.originalFetchedAt,
              originalFetchAttemptedAt: latestEntry.originalFetchAttemptedAt,
              originalFetchError: latestEntry.originalFetchError,
            }
            : {};
          return { ...entry, ...attemptFields, ...contentFields };
        });
        merged[sourceId] = { ...localSource, entries };
      } else {
        merged[sourceId] = localSource;
      }
    }
    else delete merged[sourceId];
  }
  return merged;
}

function mergeCacheEntries(latest, patchesBySource) {
  const merged = { ...(latest && typeof latest === 'object' ? latest : {}) };
  for (const [sourceId, entryPatches] of patchesBySource || []) {
    const currentSource = merged[sourceId];
    if (!currentSource || typeof currentSource !== 'object' || !Array.isArray(currentSource.entries)) continue;
    const currentEntries = Array.isArray(currentSource.entries) ? currentSource.entries.slice() : [];
    const indexes = new Map(currentEntries
      .map((entry, index) => [entry && entry.id, index])
      .filter(([id]) => id));
    for (const [entryId, fields] of entryPatches || []) {
      const index = indexes.get(entryId);
      if (index === undefined) continue;
      currentEntries[index] = { ...currentEntries[index], ...(fields || {}) };
    }
    merged[sourceId] = { ...currentSource, entries: currentEntries };
  }
  return merged;
}

/**
 * @param {string[]} sourceIds
 * @param {Array} patchesBySource
 * @param {{ readDisk?: boolean }} [opts] readDisk=false 时以内存 runtime.cache 为 base（无锁竞争路径）
 */
function cacheForWrite(sourceIds, patchesBySource, { readDisk = true } = {}) {
  let latest = runtime.cache;
  if (readDisk) {
    try {
      const parsed = JSON.parse(fs.readFileSync(runtime.CACHE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) latest = parsed;
    } catch { /* keep the in-memory snapshot if disk is absent or invalid */ }
  }
  const withSources = mergeCacheSources(latest, runtime.cache, sourceIds);
  return mergeCacheEntries(withSources, patchesBySource);
}

/** 最近一次 acquireCacheWriteLock 是否曾在 wait 循环中阻塞（可能有其他进程写过盘） */
let cacheLockWaited = false;

function acquireCacheWriteLock(timeoutMs = 500) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  cacheLockWaited = false;
  fs.mkdirSync(path.dirname(runtime.CACHE_LOCK_DIR), { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(runtime.CACHE_LOCK_DIR);
      const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      try {
        fs.writeFileSync(runtime.CACHE_LOCK_OWNER_FILE, token, { flag: 'wx' });
      } catch (error) {
        fs.rmSync(runtime.CACHE_LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      runtime.activeCacheLockToken = token;
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(runtime.CACHE_LOCK_DIR);
        if (Date.now() - stat.mtimeMs > runtime.CACHE_LOCK_STALE_MS) {
          // 过期锁：他进程可能已写完盘后崩溃，读盘 merge 更稳妥
          cacheLockWaited = true;
          fs.rmSync(runtime.CACHE_LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError && statError.code === 'ENOENT') continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      cacheLockWaited = true;
      Atomics.wait(runtime.CACHE_LOCK_WAIT_ARRAY, 0, 0, Math.min(25, remaining));
    }
  }
}

function releaseCacheWriteLock() {
  const token = runtime.activeCacheLockToken;
  runtime.activeCacheLockToken = '';
  if (!token) return;
  let owner = '';
  try { owner = fs.readFileSync(runtime.CACHE_LOCK_OWNER_FILE, 'utf8').trim(); } catch { return; }
  if (owner === token) fs.rmSync(runtime.CACHE_LOCK_DIR, { recursive: true, force: true });
}

/**
 * 写 runtime.state.json：内存覆盖同 key；禁止用空对象覆盖磁盘上已有的删源/禁用记录
 * （runtime.cache 保存路径会顺带写 runtime.state，曾把 {} 盖掉 enabled:false，导致删源「复活」）
 */
function writeStateAtomic() {
  if (process.env.QMREADER_WORKER_KIND) return;
  let disk = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(runtime.STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) disk = parsed;
  } catch { /* missing or invalid */ }

  const mem = runtime.state && typeof runtime.state === 'object' && !Array.isArray(runtime.state) ? runtime.state : {};
  const memKeys = Object.keys(mem).length;
  const diskKeys = Object.keys(disk).length;

  if (memKeys === 0 && diskKeys > 0) {
    // 内存空、磁盘有：保留磁盘（常见于启动后未 load 全量又被 runtime.cache save 触发）
    console.warn('[runtime.state] refuse empty overwrite of', diskKeys, 'source prefs');
    runtime.state = disk;
    return;
  }

  // 内存优先（同 key 覆盖）；磁盘多出的 key 保留（另一路径刚删的源不会被旧内存抹掉）
  const merged = { ...disk, ...mem };
  runtime.state = merged;
  writeJsonAtomic(runtime.STATE_FILE, merged, 2);
}

function writeDiskNow({ lockTimeoutMs = 500 } = {}) {
  fs.mkdirSync(path.dirname(runtime.CACHE_FILE), { recursive: true });
  const changedSourceIds = [...runtime.pendingCacheSourceIds];
  const changedEntries = [...runtime.pendingCacheEntryPatches.entries()]
    .filter(([sourceId]) => !runtime.pendingCacheSourceIds.has(sourceId))
    .map(([sourceId, patches]) => [sourceId, new Map(patches)]);
  if (changedSourceIds.length || changedEntries.length) {
    if (!acquireCacheWriteLock(lockTimeoutMs)) return false;
    try {
      // 无锁等待：内存即为最新，跳过全量读盘；曾等待则可能有他进程写入，读盘 merge
      const memBefore = runtime.cache;
      const merged = cacheForWrite(changedSourceIds, changedEntries, {
        readDisk: cacheLockWaited,
      });
      // 落盘轻量镜像；内存仍保留完整 entries（含 content）
      const payload = cachePayloadForDisk(merged);
      writeJsonAtomic(runtime.CACHE_FILE, payload);
      if (cacheLockWaited) {
        // 读盘 merge 时未变更源可能只有 cache.json 轻量镜像，勿覆盖内存全文
        const writtenIds = new Set(changedSourceIds);
        for (const [sourceId] of changedEntries) writtenIds.add(sourceId);
        const next = { ...merged };
        for (const [sourceId, memSrc] of Object.entries(memBefore || {})) {
          if (!writtenIds.has(sourceId) && memSrc) next[sourceId] = memSrc;
        }
        runtime.cache = next;
      } else {
        runtime.cache = merged;
      }
      for (const sourceId of changedSourceIds) runtime.pendingCacheSourceIds.delete(sourceId);
      for (const [sourceId] of changedEntries) runtime.pendingCacheEntryPatches.delete(sourceId);
    } finally {
      releaseCacheWriteLock();
    }
  }
  writeStateAtomic();
  return true;
}

function writeJsonAtomic(file, value, spacing) {
  const tempFile = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(value, null, spacing));
    fs.renameSync(tempFile, file);
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* rename already removed it */ }
  }
}

function saveDisk() {
  clearTimeout(runtime.saveTimer);
  runtime.saveTimer = setTimeout(() => {
    runtime.saveTimer = null;
    if (!writeDiskNow()) saveDisk();
  }, 500);
}

function flushDisk() {
  if (runtime.saveTimer) {
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = null;
  }
  if (!writeDiskNow({ lockTimeoutMs: 5000 })) {
    const error = new Error('runtime.cache write lock timed out');
    error.statusCode = 503;
    throw error;
  }
}

function isEnabled(source) {
  const o = runtime.state[source.id];
  return o && typeof o.enabled === 'boolean' ? o.enabled : source.enabled;
}

function setEnabled(id, enabled) {
  runtime.state[id] = { ...(runtime.state[id] || {}), enabled: Boolean(enabled) };
  // 删源/开关须立刻落盘，不能只靠 500ms debounce（期间 loadDisk/崩溃会丢）
  try {
    flushDisk();
  } catch {
    saveDisk();
  }
}

function expandCandidates(feeds) {
  const out = [];
  for (const f of feeds) {
    if (f.includes('{rsshub}')) {
      for (const base of RSSHUB_INSTANCES) out.push(f.replace('{rsshub}', base));
    } else {
      out.push(f);
    }
  }
  return out;
}

async function fetchJson(url, timeout = TIMEOUT_MS) {
  const text = await fetchText(url, timeout, MAX_TEXT_RESPONSE_BYTES, {
    headers: { ...BROWSER_HEADERS, Accept: 'application/json, text/json;q=0.9, */*;q=0.5' },
  });
  return JSON.parse(text);
}

function collectUrlsFromText(value, baseUrl = '') {
  const urls = [];
  const seen = new Set();
  const add = raw => {
    const url = absoluteUrl(decodeEntities(String(raw || '').replace(/&amp;/g, '&')), baseUrl);
    if (!url || seen.has(url) || /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mp3|wav|pdf)(?:[?#].*)?$/i.test(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const html = String(value || '');
  if (html) {
    const $ = cheerio.load(html, { decodeEntities: false }, false);
    $('a[href]').each((_, el) => add($(el).attr('href')));
  }

  const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
  let match;
  while ((match = urlRe.exec(stripHtmlKeepUrls(value)))) add(match[0]);
  return urls;
}

function stripHtmlKeepUrls(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function productHuntOfficialUrlCandidates(entry) {
  if (!entry || entry.sourceId !== PRODUCTHUNT_SOURCE_ID) return [];
  const baseUrl = entry.link || 'https://www.producthunt.com/';
  const rawUrls = [
    ...collectUrlsFromText(entry.content, baseUrl),
    ...collectUrlsFromText(entry.summary, baseUrl),
    entry.link,
  ].filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (const raw of rawUrls) {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const host = hostnameOf(url);
    let priority = 0;
    if (isProductHuntRedirectUrl(url)) priority = 20;
    else if (isProductHuntUrl(url)) priority = 5;
    else {
      if (isLikelyAssetHost(host)) continue;
      const terms = titleTerms(entry.title);
      priority = 30 + (terms.some(term => url.toLowerCase().includes(term)) ? 10 : 0);
    }
    candidates.push({ url, priority });
  }
  const sorted = candidates.sort((a, b) => b.priority - a.priority);
  const external = sorted.filter(item => !isProductHuntUrl(item.url)).slice(0, 3);
  const redirects = sorted.filter(item => isProductHuntRedirectUrl(item.url)).slice(0, 2);
  const productHuntPages = sorted
    .filter(item => isProductHuntUrl(item.url) && !isProductHuntRedirectUrl(item.url))
    .slice(0, 1);
  return [...external, ...redirects, ...productHuntPages]
    .slice(0, 6)
    .map(item => item.url);
}

function titleTerms(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !['the', 'and', 'for', 'with', 'your', 'app'].includes(term))
    .slice(0, 8);
}

function isLikelyAssetHost(host) {
  return /(?:producthunt|githubusercontent|raw\.githubusercontent|shields\.io|cloudfront|imgix|unsplash|gravatar|googleusercontent|twimg|discord|youtube|youtu\.be|linkedin|facebook|instagram|x\.com|twitter)/i.test(host);
}

function inferSiteUrlFromAssetUrl(value, terms = []) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (isLikelyAssetHost(host)) return '';
    if (!/\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(url.pathname)) return '';
    const lower = url.toString().toLowerCase();
    if (terms.length && !terms.some(term => lower.includes(term))) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const assetIndex = parts.findIndex(part => /^(assets?|images?|img|static|media)$/i.test(part));
    if (assetIndex > 0) {
      url.pathname = `/${parts.slice(0, assetIndex).join('/')}/`;
    } else {
      url.pathname = '/';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeLikelyLandingUrl(value) {
  try {
    const url = new URL(value);
    if (isLikelyAssetHost(url.hostname.replace(/^www\./, '').toLowerCase())) return '';
    if (/\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mp3|wav|pdf|zip|dmg|pkg|exe|sh|json|ya?ml|toml|lock|txt)(?:$|[?#])/i.test(url.pathname)) return '';
    if (/^\/(?:login|signin|sign-in|signup|sign-up|auth|oauth|register)(?:\/|$)/i.test(url.pathname)) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    return url.toString();
  } catch {
    return '';
  }
}

function likelyOfficialUrlFromReaderMarkdown(markdown, title = '') {
  const terms = titleTerms(title);
  const links = collectUrlsFromText(markdown, '')
    .filter(url => !isProductHuntUrl(url) && hostnameOf(url) !== 'r.jina.ai');
  const landingLinks = links
    .map(normalizeLikelyLandingUrl)
    .filter(Boolean);
  const termHit = landingLinks.find(url => terms.length && terms.some(term => url.toLowerCase().includes(term)));
  if (termHit) return termHit;

  const imageRe = /!\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/gi;
  let match;
  while ((match = imageRe.exec(String(markdown || '')))) {
    const inferred = inferSiteUrlFromAssetUrl(match[1], terms);
    if (inferred) return inferred;
  }

  return landingLinks.find(url => !isLikelyAssetHost(hostnameOf(url))) || landingLinks[0] || '';
}

function jinaReaderUrl(targetUrl) {
  const url = publicHttpUrl(targetUrl);
  return `https://r.jina.ai/${url}`;
}

function extractJinaReaderContext(markdown, targetUrl) {
  const raw = String(markdown || '').trim();
  if (!raw || /cf-mitigated|Just a moment|Enable JavaScript and cookies/i.test(raw)) return null;
  const title = ((raw.match(/^Title:\s*(.+)$/mi) || [])[1] || '').trim();
  const source = ((raw.match(/^URL Source:\s*(.+)$/mi) || [])[1] || targetUrl || '').trim();
  const content = raw.split(/^\s*Markdown Content:\s*$/mi).slice(1).join('\n').trim();
  const body = content || raw
    .replace(/^Title:.*$/gmi, '')
    .replace(/^URL Source:.*$/gmi, '')
    .replace(/^Published Time:.*$/gmi, '')
    .replace(/^Warning:.*$/gmi, '')
    .trim();
  const text = stripHtml(body);
  if (text.length < 80 && !title) return null;
  const summary = text.slice(0, 320);
  const inferredUrl = likelyOfficialUrlFromReaderMarkdown(body, title);
  return {
    url: publicHttpUrl(inferredUrl || source || targetUrl),
    sourceUrl: targetUrl,
    readerSourceUrl: publicHttpUrl(source || targetUrl),
    title: title || hostnameOf(source || targetUrl),
    summary,
    content: body.slice(0, 12000),
    image: firstImage(body, source || targetUrl) || null,
    fetchedVia: 'jina',
  };
}

function extractOfficialContextFromHtml(html, finalUrl, sourceUrl) {
  const raw = String(html || '');
  if (!raw || /cf-mitigated|Just a moment|Enable JavaScript and cookies/i.test(raw)) return null;
  const extracted = extractReadableContent(raw, finalUrl);
  const metaDescription = decodeEntities(metaContent(raw, ['og:description', 'twitter:description', 'description']) || '');
  const title = extracted.title || decodeEntities(metaContent(raw, ['og:title', 'twitter:title']) || '') || hostnameOf(finalUrl);
  const contentText = stripHtml(extracted.content || '');
  if (contentText.length < 80 && !metaDescription) return null;
  return {
    url: finalUrl,
    sourceUrl,
    title,
    summary: extracted.summary || metaDescription || contentText.slice(0, 320),
    content: extracted.content || (metaDescription ? `<p>${escapeHtmlForHtml(metaDescription)}</p>` : ''),
    image: extracted.image || null,
    fetchedVia: 'direct',
  };
}

function productHuntOfficialContextMatches(entry, context) {
  if (!context || !context.url || isProductHuntUrl(context.url)) return false;
  const terms = titleTerms(entry && entry.title);
  if (!terms.length) return true;
  const haystack = `${context.title || ''} ${context.url || ''}`.toLowerCase();
  return terms.some(term => haystack.includes(term));
}

async function fetchHtmlWithManualRedirects(startUrl, timeout = 15000, maxRedirects = 6) {
  const result = await fetchPublicBuffer(startUrl, {
    timeout,
    maxBytes: MAX_HTML_RESPONSE_BYTES,
    maxRedirects,
    headers: BROWSER_HEADERS,
  });
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(`Status code ${result.status}`);
    error.statusCode = result.status;
    throw error;
  }
  const contentType = result.headers.get('content-type') || '';
  if (contentType && !/html|text|xml|json/i.test(contentType)) throw new Error(`Unsupported content type ${contentType}`);
  return { url: result.url, html: decodeResponseBuffer(result.buffer, result.headers) };
}

async function fetchProductHuntOfficialContext(entry, {
  timeout = 18000,
  fetchHtml = fetchHtmlWithManualRedirects,
  fetchReader = fetchText,
  now = Date.now,
} = {}) {
  const candidates = productHuntOfficialUrlCandidates(entry);
  const errors = [];
  const deadline = now() + Math.max(1, timeout);
  async function tryCandidate(candidate, { followInferred = true } = {}) {
    if (deadline <= now()) return null;
    try {
      const fetched = await fetchHtml(candidate, remainingDeadlineMs(deadline, now));
      const context = extractOfficialContextFromHtml(fetched.html, fetched.url, candidate);
      if (productHuntOfficialContextMatches(entry, context)) return context;
    } catch (error) {
      errors.push(`${candidate}: ${error.message || error}`);
      if (error && error.name === 'TimeoutError') return null;
    }

    if (deadline <= now()) return null;
    try {
      const markdown = await fetchReader(jinaReaderUrl(candidate), remainingDeadlineMs(deadline, now));
      const context = extractJinaReaderContext(markdown, candidate);
      if (
        productHuntOfficialContextMatches(entry, context)
        && context.readerSourceUrl
        && !isProductHuntUrl(context.readerSourceUrl)
      ) return context;
      if (
        followInferred
        && context
        && context.url
        && !isProductHuntUrl(context.url)
        && context.url !== candidate
      ) {
        return tryCandidate(context.url, { followInferred: false });
      }
    } catch (error) {
      errors.push(`jina ${candidate}: ${error.message || error}`);
    }
    return null;
  }

  for (const candidate of candidates) {
    const context = await tryCandidate(candidate);
    if (context) return context;
    if (deadline <= now()) break;
  }

  const err = new Error(errors.length ? errors.slice(0, 3).join('; ') : 'no Product Hunt official URL candidates');
  err.statusCode = 422;
  throw err;
}

function updateCachedEntry(entryId, fields) {
  for (const [sourceId, c] of Object.entries(runtime.cache)) {
    const hit = (c.entries || []).find(e => e.id === entryId);
    if (!hit) continue;
    Object.assign(hit, fields);
    markCacheEntryChanged(sourceId, entryId, fields);
    saveDisk();
    return hit;
  }
  return null;
}

function removeCachedEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  let removed = false;
  for (const [sourceId, c] of Object.entries(runtime.cache)) {
    if (!c || !Array.isArray(c.entries)) continue;
    const before = c.entries.length;
    c.entries = c.entries.filter(entry => entry && entry.id !== id);
    if (c.entries.length !== before) {
      removed = true;
      markCacheSourceChanged(sourceId);
    }
  }
  if (removed) saveDisk();
  return removed;
}


// ---------------------------------------------------------------------------
// 工厂接线：HN / entries-normalize
// ---------------------------------------------------------------------------

async function mapLimitBootstrap(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

const hn = createHackerNews({
  HACKERNEWS_SOURCE_ID,
  HACKERNEWS_DISCUSSION_FETCH_LIMIT,
  HACKERNEWS_AUTHOR_LOOKUP_LIMIT,
  HACKERNEWS_THREAD_COMMENT_FETCH_COUNT,
  HACKERNEWS_DISCUSSION_COMMENT_LIMIT,
  HACKERNEWS_AUTHOR_REPLY_LIMIT,
  HACKERNEWS_API_COMMENT_FETCH_LIMIT,
  cheerio,
  stripHtml,
  escapeHtmlForHtml,
  absoluteUrl,
  hostnameOf,
  decodeEntities,
  normalizeFeedContent,
  fetchText,
  fetchJson,
  parseRssUrl,
  mapLimit: mapLimitBootstrap,
});

const entries = createEntriesNormalize({
  stripHtml,
  escapeHtmlForHtml,
  normalizeFeedContent,
  absoluteUrl,
  firstImage,
  hostnameOf,
  isTrackingPixelUrl,
  store,
  GITHUB_PROJECTS_SOURCE_ID,
  HUGGINGFACE_SOURCE_ID,
  getSourceById: (id) => SOURCES.find(s => s.id === id) || null,
  isHackerNewsSource: (...a) => hn.isHackerNewsSource(...a),
  hackerNewsItemIdFromFeedItem: (...a) => hn.hackerNewsItemIdFromFeedItem(...a),
  hackerNewsArticleUrlFromItem: (...a) => hn.hackerNewsArticleUrlFromItem(...a),
  fetchHtmlWithManualRedirects,
  extractReadableContent,
  localizeEntryImages,
  pickArticleCoverImage,
  isGenericCoverImage,
  contentHasRealImage,
  publicHttpUrl,
  fetchText,
  isPaulGrahamUrl,
});

const {
  isHackerNewsSource,
  isHackerNewsEntry,
  isHackerNewsItemUrl,
  hackerNewsItemIdFromUrl,
  hackerNewsUrlsFromValue,
  hackerNewsItemIdFromText,
  hackerNewsThreadUrl,
  hackerNewsItemIdFromFeedItem,
  hackerNewsItemIdFromEntry,
  hackerNewsArticleUrlFromItem,
  hackerNewsStatsFromContent,
  hackerNewsEntryStats,
  hackerNewsFeedWeight,
  hackerNewsValueScore,
  mergeHackerNewsEntry,
  rankHackerNewsEntries,
  formatHackerNewsDate,
  hackerNewsCommentTextHtml,
  hackerNewsCommentListHtml,
  hackerNewsEntryContent,
  hackerNewsSummary,
  parseHackerNewsCommentItem,
  hackerNewsApiItemUrl,
  fetchHackerNewsApiItem,
  hackerNewsApiCommentToComment,
  fetchHackerNewsApiComments,
  hackerNewsAlgoliaCommentToComment,
  fetchHackerNewsAlgoliaAuthorReplies,
  fetchHackerNewsApiDiscussion,
  uniqueHackerNewsComments,
  fetchHackerNewsThreadComments,
  fetchHackerNewsAuthorReplies,
  hydrateHackerNewsEntry,
  hydrateHackerNewsEntries,
  mergeHackerNewsOriginalContent,
} = hn;

const {
  isProductHuntUrl,
  isProductHuntRedirectUrl,
  arxivIdFromUrl,
  sourceContentKind,
  isRepoManualSource,
  isRepoSourceEntry,
  isPaperSourceEntry,
  normalizePaperAbstract,
  formatDateForPaper,
  linkHtml,
  paperLinksHtml,
  paperEntryContent,
  decorateEntry,
  isThinEntryContent,
  shouldAutoFetchOriginal,
  entryHasLocalPreservedBody,
  normalizeItem,
  normalizeFeedEntryUrl,
  dedupeEntries,
  hasFullEssayContent,
  mapLimit,
  newestEntries,
  preferRicherContent,
  storedEntryForCache,
  changedEntriesAfterUpsert,
  hydrateThinFeedEntry,
  hydrateThinFeedEntries,
  hydratePaulGrahamEntry,
} = entries;

async function hydrateSourceEntries(source, entriesList) {
  if (isHackerNewsSource(source)) return hydrateHackerNewsEntries(entriesList);
  if (source && source.id === 'paulgraham') {
    const hydrated = await mapLimit(entriesList, 4, hydratePaulGrahamEntry);
    if (!hasFullEssayContent(hydrated)) throw new Error('Paul Graham feed did not provide full essay content');
    return hydrated;
  }
  return hydrateThinFeedEntries(source, entriesList);
}


async function fetchEntryOriginal(entry) {
  if (!entry || !entry.id) {
    const err = new Error('entry is required');
    err.statusCode = 400;
    throw err;
  }
  // 本地离线源 / GitHub 项目：有可用正文则直接标记已获取，不打知乎等受保护站点、不爬仓库页
  const src = entry.sourceId ? getSourceById(entry.sourceId) : null;
  const offline = Boolean(
    (src && src.localOnly)
    || isRepoSourceEntry(entry)
    || (src && isRepoManualSource(src))
    || entry.sourceId === 'xhs-likes'
    || entry.sourceId === 'x-likes'
    || entry.sourceId === 'bili-watchlater'
    || /^xhs-/.test(String(entry.sourceId || ''))
    || /^zhihu-/.test(String(entry.sourceId || '')),
  );
  // 博客 crawl / 全文 RSS 已入库：直接标 originalFetched，避免「原文获取中」空跑网络
  if (offline || entryHasLocalPreservedBody(entry) || (!isThinEntryContent(entry) && stripHtml(entry.content || '').length >= 300)) {
    const text = stripHtml(entry.content || '');
    if (text.length >= 80) {
      const updated = store.updateEntryContent(entry.id, {
        content: entry.content,
        summary: entry.summary,
        image: entry.image,
        originalFetched: true,
      });
      if (updated) {
        updateCachedEntry(entry.id, {
          content: updated.content,
          summary: updated.summary,
          image: updated.image,
          contentHash: updated.contentHash,
          originalFetchedAt: updated.originalFetchedAt,
          originalFetchAttemptedAt: updated.originalFetchAttemptedAt,
          originalFetchError: null,
        });
        return updated;
      }
      return {
        ...entry,
        originalFetchedAt: Date.now(),
        originalFetchAttemptedAt: Date.now(),
        originalFetchError: null,
      };
    }
    if (offline) {
      const err = new Error('本地导入源无可用正文，且不支持匿名抓取受保护站点');
      err.statusCode = 422;
      throw err;
    }
  }
  try {
    const fetched = await fetchHtmlWithManualRedirects(entry.link, 30000);
    const extracted = extractReadableContent(fetched.html, fetched.url);
    if (!extracted.content || stripHtml(extracted.content).length < 80) {
      const err = new Error('没有从原文页面提取到可用正文');
      err.statusCode = 422;
      throw err;
    }
    let content = mergeHackerNewsOriginalContent(entry, extracted);
    let image = extracted.image || entry.image || null;
    try {
      const localized = await localizeEntryImages({
        sourceId: entry.sourceId || '',
        entryId: entry.id,
        content,
        image,
        pageUrl: fetched.url || entry.link,
      });
      content = localized.content;
      image = localized.image;
    } catch (error) {
      console.warn(`localize images skipped for ${entry.id}:`, error.message || error);
    }
    const updated = store.updateEntryContent(entry.id, {
      content,
      summary: extracted.summary || entry.summary,
      image,
      originalFetched: true,
    });
    if (updated) updateCachedEntry(entry.id, {
      content: updated.content,
      summary: updated.summary,
      image: updated.image,
      contentHash: updated.contentHash,
      originalFetchedAt: updated.originalFetchedAt,
      originalFetchAttemptedAt: updated.originalFetchAttemptedAt,
      originalFetchError: updated.originalFetchError,
    });
    return updated;
  } catch (error) {
    const marked = store.markEntryOriginalFetchAttempt(entry.id, error.message || error);
    if (marked) updateCachedEntry(entry.id, {
      originalFetchAttemptedAt: marked.originalFetchAttemptedAt,
      originalFetchError: marked.originalFetchError,
    });
    throw error;
  }
}

function repoManualSourceCache(source) {
  const limit = source && source.limit || 500;
  const entries = store.listEntriesBySource(source.id, limit);
  let latestAt = Date.now();
  if (entries.length) {
    latestAt = Math.max(...entries.map(e => Number(e.publishedTs) || Number(e.updatedAt) || 0), 0) || Date.now();
  }
  return {
    fetchedAt: latestAt,
    feedUrl: '',
    feedTitle: source && source.name || 'GitHub 项目',
    status: 'ok',
    error: null,
    entries,
  };
}

function manualSourceCache(source) {
  if (isRepoManualSource(source)) return repoManualSourceCache(source);
  const entries = store.getSubmittedEntries({ limit: source && source.limit || 200 });
  const meta = store.getSubmissionMeta();
  return {
    fetchedAt: meta.latestAt || Date.now(),
    feedUrl: '',
    feedTitle: source && source.name || '个人精选',
    status: 'ok',
    error: null,
    entries,
  };
}


const sourceFetch = createSourceFetch({
  SOURCES,
  store,
  runtime,
  CONCURRENCY: runtime.CONCURRENCY,
  expandCandidates,
  parseRssUrl,
  normalizeItem,
  dedupeEntries,
  newestEntries,
  hydrateSourceEntries,
  isHackerNewsSource,
  rankHackerNewsEntries,
  markCacheSourceChanged,
  saveDisk,
  manualSourceCache,
  isEnabled,
  fetchText,
  storedEntryForCache,
  changedEntriesAfterUpsert,
  normalizeFeedEntryUrl,
  mapLimit,
});

const {
  fetchSource,
  refreshAll,
  recordSourceFailure,
  finalizeFetchedSource,
  failedSourceResult,
  fetchCombinedSource,
  parseFeedUrl,
  sourceLimit,
  parseWpJsonFeed,
  parseSitemapFeed,
  loadSitemapUrls,
  sitemapDocumentUrls,
} = sourceFetch;

const catalog = createCatalog({
  SOURCES,
  store,
  runtime,
  USER_SUBMITTED_SOURCE_ID,
  HACKERNEWS_SOURCE_ID,
  isEnabled,
  isRepoManualSource,
  decorateEntry,
  stripHtml,
  toLocalArticleImageUrl,
  firstImage,
  isGenericCoverImage,
  isLikelyArticleOgImage,
  contentHasRealImage,
  isLocalArticleImageUrl,
});

const {
  getSourcesMeta,
  getEntries,
  getSourceById,
  getEntryById,
  getEntryByIdPrefix,
  ensureLocalOnlyCache,
  entryWithContentIfNeeded,
  withTranslations,
  normalizeSearchText,
  entrySearchText,
  entryMatchesSearch,
  slimListStats,
  clipListText,
  listCoverImage,
  toListCatalogEntry,
  slimListAssets,
  emptyListAssets,
} = catalog;


async function normalizeSubmittedUrl(value) {
  const shaped = validateSubmittedUrlShape(value);
  const url = new URL(await assertPublicHttpUrl(shaped));
  url.hash = '';
  return url.toString();
}

const SUBMISSION_PROBE_SEGMENTS = new Set([
  'admin', 'actuator', 'debug', 'health', 'healthz', 'info', 'livez', 'metrics',
  'readyz', 'server-status', 'status', 'version',
]);
const SUBMISSION_NON_ARTICLE_EXTENSIONS = /\.(?:css|env|ico|js|json|log|map|toml|txt|ya?ml)(?:$|[?#])/i;
const SUBMISSION_ADMIN_TITLES = /^(?:alist|moltbot control|grafana|jenkins|phpmyadmin|portainer|prometheus|swagger ui)(?:\s*[-–—|:].*)?$/i;

function submissionUrlError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateSubmittedUrlShape(value) {
  const normalized = publicHttpUrl(value);
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw submissionUrlError('提交链接必须使用公开域名，不能直接使用 IP 地址');
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) {
    throw submissionUrlError('提交链接不能指向内部网络域名');
  }
  if (url.port) throw submissionUrlError('提交链接只支持标准 HTTP/HTTPS 端口');
  const segments = url.pathname.split('/').filter(Boolean).map(segment => segment.toLowerCase());
  const first = segments[0] || '';
  const shortApiPath = first === 'api' && segments.length <= 2;
  const jsonListPath = first === 'json' && segments[1] === 'list';
  if (SUBMISSION_PROBE_SEGMENTS.has(first) || shortApiPath || jsonListPath) {
    throw submissionUrlError('这个地址是接口、健康检查或管理端点，不是可收录文章');
  }
  if (SUBMISSION_NON_ARTICLE_EXTENSIONS.test(url.pathname) || /\/favicon(?:\.ico)?\/?$/i.test(url.pathname)) {
    throw submissionUrlError('这个地址是静态资源，不是可收录文章');
  }
  url.hash = '';
  return url.toString();
}

function submittedContentRiskReason({ title = '', url = '' } = {}) {
  const cleanTitle = stripHtml(title).replace(/\s+/g, ' ').trim();
  if (SUBMISSION_ADMIN_TITLES.test(cleanTitle)) return '页面看起来是管理面板，不是公开文章';
  try {
    validateSubmittedUrlShape(url);
  } catch (error) {
    return error.message || '链接不符合投稿要求';
  }
  return '';
}

function submittedFallbackContent({ title = '', description = '', url = '' } = {}) {
  const parts = [
    description ? `<p>${escapeHtmlForHtml(description)}</p>` : '',
    url ? `<p><a href="${escapeHtmlForHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtmlForHtml(url)}</a></p>` : '',
  ].filter(Boolean);
  return parts.join('\n') || `<p>${escapeHtmlForHtml(title || url || '读者提交链接')}</p>`;
}

async function submitLink(urlValue, user = {}, { note = '' } = {}) {
  const url = await normalizeSubmittedUrl(urlValue);
  const fetched = await fetchHtmlWithManualRedirects(url, 30000);
  validateSubmittedUrlShape(fetched.url);
  const html = fetched.html;
  const extracted = extractReadableContent(html, fetched.url);
  const metaDescription = decodeEntities(metaContent(html, ['og:description', 'twitter:description', 'description']) || '');
  const title = stripHtml(extracted.title || metaContent(html, ['og:title', 'twitter:title']) || url)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || url;
  const extractedTextLength = stripHtml(extracted.content).length;
  const summary = (extracted.summary || metaDescription || stripHtml(extracted.content) || title).slice(0, 320);
  let content = extractedTextLength >= 80
    ? extracted.content
    : submittedFallbackContent({ title, description: summary, url });
  const riskReason = submittedContentRiskReason({ title, url: fetched.url });
  if (riskReason) throw submissionUrlError(riskReason);
  const t = Date.now();
  const entryId = crypto.createHash('md5').update(`${USER_SUBMITTED_SOURCE_ID}|${url}`).digest('hex');
  // 封面：正文实图优先，其次 og（再滤全站默认图）
  let image = pickArticleCoverImage(
    content,
    extracted.image || absoluteUrl(metaContent(html, ['og:image', 'twitter:image']), fetched.url),
    fetched.url,
  );
  // 与抓原文一致：把正文/封面远程图落到 public/article-images（防盗链 / 外网失效）
  try {
    const localized = await localizeEntryImages({
      sourceId: USER_SUBMITTED_SOURCE_ID,
      entryId,
      content,
      image,
      pageUrl: fetched.url || url,
    });
    content = localized.content;
    image = pickArticleCoverImage(content, localized.image || image, fetched.url);
  } catch (error) {
    console.warn(`localize images skipped for submitted ${entryId}:`, error && error.message || error);
  }
  if (image && isGenericCoverImage(image)) image = null;

  const entry = {
    id: entryId,
    sourceId: USER_SUBMITTED_SOURCE_ID,
    title,
    link: url,
    author: user.displayName || user.email || '读者',
    published: new Date(t).toISOString(),
    publishedTs: t,
    summary,
    content,
    image,
    audio: null,
    // 已抓过全文+本地化图，避免开文再走薄内容补抓
    originalFetchedAt: t,
    originalFetchAttemptedAt: t,
    forceContent: true,
  };
  const saved = store.saveSubmittedEntry(entry, {
    userId: user.id || null,
    author: user.displayName || user.email || '读者',
    note,
  });
  if (!saved) {
    const err = new Error('这个链接已被管理员移除，暂不能重新收录');
    err.statusCode = 403;
    throw err;
  }
  runtime.cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(getSourceById(USER_SUBMITTED_SOURCE_ID));
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return saved;
}

async function queueSubmittedLink(urlValue, user = {}, { note = '' } = {}) {
  // Quarantine must not cause any network activity, including DNS. Full public
  // target resolution and redirect validation happen only after admin approval.
  const url = validateSubmittedUrlShape(urlValue);
  return store.createSubmissionRequest({
    url,
    userId: user.id,
    author: user.displayName || user.email || '读者',
    note,
  });
}

async function approveSubmissionRequest(requestId, { adminUserId = '' } = {}) {
  const request = store.getSubmissionRequest(requestId);
  if (!request) {
    const error = new Error('submission request not found');
    error.statusCode = 404;
    throw error;
  }
  if (request.status !== 'pending') return { request, entry: request.entryId ? getEntryById(request.entryId) : null };
  const entry = await submitLink(request.url, {
    id: request.userId,
    email: request.email,
    displayName: request.displayName || request.author,
  }, { note: request.note });
  const reviewed = store.reviewSubmissionRequest(request.id, {
    status: 'approved',
    reviewedBy: adminUserId,
    reason: '管理员审核通过',
    entryId: entry.id,
  });
  return { request: reviewed, entry };
}

function rejectSubmissionRequest(requestId, { adminUserId = '', reason = '' } = {}) {
  return store.reviewSubmissionRequest(requestId, {
    status: 'rejected',
    reviewedBy: adminUserId,
    reason: String(reason || '').trim() || '管理员拒绝投稿',
  });
}

/**
 * 收录 GitHub 仓库为项目书签（非文章）。
 */
async function submitGitHubRepo(urlValue, user = {}, { note = '' } = {}) {
  const { owner, repo, canonicalUrl } = githubRepo.parseGitHubRepoUrl(urlValue);
  const meta = await githubRepo.fetchRepoBookmark(canonicalUrl);
  const t = Date.now();
  const entryId = crypto.createHash('md5').update(`${GITHUB_PROJECTS_SOURCE_ID}|${canonicalUrl.toLowerCase()}`).digest('hex');
  const cleanNote = String(note || '').trim().slice(0, 500);
  let content = githubRepo.buildRepoBriefHtml(meta, { note: cleanNote });
  let image = meta.avatar || null;
  const pushedTs = meta.pushedAt ? Date.parse(meta.pushedAt) : NaN;
  const publishedTs = Number.isFinite(pushedTs) ? pushedTs : t;
  const published = Number.isFinite(pushedTs) ? new Date(pushedTs).toISOString() : new Date(t).toISOString();

  try {
    const localized = await localizeEntryImages({
      sourceId: GITHUB_PROJECTS_SOURCE_ID,
      entryId,
      content,
      image,
      pageUrl: meta.link || canonicalUrl,
    });
    content = localized.content;
    image = localized.image || image;
  } catch (error) {
    console.warn(`localize images skipped for github repo ${entryId}:`, error && error.message || error);
  }

  if (store.isEntryDeleted(entryId)) {
    store.clearEntrySoftDelete(entryId);
  }

  const entry = {
    id: entryId,
    sourceId: GITHUB_PROJECTS_SOURCE_ID,
    // 统一只显示仓库名（AgentsMeetRL），不带 owner/
    title: githubRepo.buildRepoDisplayTitle(meta) || meta.name || repo,
    link: meta.link || canonicalUrl,
    author: meta.owner || user.displayName || user.email || owner,
    published,
    publishedTs,
    summary: githubRepo.buildRepoSummary(meta),
    content,
    image,
    audio: null,
    originalFetchedAt: t,
    originalFetchAttemptedAt: t,
    forceContent: true,
  };

  store.upsertEntries([entry]);
  const saved = store.getEntry(entryId);
  if (!saved) {
    const err = new Error('收录 GitHub 项目失败');
    err.statusCode = 500;
    throw err;
  }

  const source = getSourceById(GITHUB_PROJECTS_SOURCE_ID);
  runtime.cache[GITHUB_PROJECTS_SOURCE_ID] = manualSourceCache(source || { id: GITHUB_PROJECTS_SOURCE_ID, name: 'GitHub 项目', limit: 500 });
  markCacheSourceChanged(GITHUB_PROJECTS_SOURCE_ID);
  saveDisk();
  return saved;
}

function deleteEntry(entryId, { userId = '', reason = '' } = {}) {
  const cleanId = String(entryId || '').trim();
  if (!cleanId) return null;
  const entry = getEntryById(cleanId);
  const result = store.softDeleteEntry(cleanId, { userId, reason });
  if (!result) return null;
  removeCachedEntry(result.id);
  return { ...result, entry };
}

function purgeSourceImageDir(sourceId) {
  const source = String(sourceId || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64);
  if (!source) return { removed: false, path: '' };
  const dir = path.join(IMAGE_ROOT, source);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { removed: true, path: dir };
    }
  } catch (error) {
    console.warn(`[deleteSource] purge images ${source}:`, error.message || error);
    return { removed: false, path: dir, error: String(error.message || error) };
  }
  return { removed: false, path: dir };
}

/**
 * 删除源：停同步（enabled=false）+ 硬清该源全部条目（CASCADE 关联）+ 清 runtime.cache/本地图。
 * 源定义仍在 lib/sources.js，侧栏因 enabled 过滤不再展示；管理页可再启用（内容需重新抓取/扫盘）。
 */
function deleteSource(sourceId, {
  userId = '',
  reason = 'source delete',
  hard = true,
} = {}) {
  const id = String(sourceId || '').trim();
  if (!id) {
    const err = new Error('sourceId is required');
    err.statusCode = 400;
    throw err;
  }
  const src = getSourceById(id);
  if (!src) return null;
  if (id === USER_SUBMITTED_SOURCE_ID) {
    const err = new Error('投稿源请用用户管理清理，不能直接删源');
    err.statusCode = 400;
    throw err;
  }

  setEnabled(id, false);
  runtime.state[id] = {
    ...(runtime.state[id] || {}),
    enabled: false,
    removedAt: Date.now(),
    removedBy: String(userId || '').trim() || null,
    removedReason: String(reason || '').trim().slice(0, 300) || null,
  };
  saveDisk();

  const purge = hard
    ? store.hardDeleteEntriesBySource(id)
    : store.softDeleteEntriesBySource(id, { userId, reason });

  delete runtime.cache[id];
  markCacheSourceChanged(id);
  const images = purgeSourceImageDir(id);
  try {
    flushDisk();
  } catch (error) {
    console.warn('[deleteSource] flushDisk:', error.message || error);
    saveDisk();
  }

  return {
    id,
    name: src.name || id,
    enabled: false,
    deletedCount: Number(purge && purge.deletedCount) || 0,
    totalBefore: Number(purge && purge.totalBefore) || Number(purge && purge.deletedCount) || 0,
    mode: purge && purge.mode || (hard ? 'hard' : 'soft'),
    images,
  };
}

function deleteUserSubmissions(userId, { deletedBy = '', reason = '' } = {}) {
  const result = store.softDeleteUserSubmissions(userId, { deletedBy, reason });
  const source = getSourceById(USER_SUBMITTED_SOURCE_ID);
  runtime.cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(source);
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return result;
}

function moderateUser(userId, { adminUserId = '', reason = '' } = {}) {
  const result = store.disableUserForModeration(userId, { adminUserId, reason });
  const source = getSourceById(USER_SUBMITTED_SOURCE_ID);
  runtime.cache[USER_SUBMITTED_SOURCE_ID] = manualSourceCache(source);
  markCacheSourceChanged(USER_SUBMITTED_SOURCE_ID);
  saveDisk();
  return result;
}


module.exports = {
  loadDisk,
  flushDisk,
  fetchSource,
  recordSourceFailure,
  refreshAll,
  getSourcesMeta,
  getEntries,
  getSourceById,
  getEntryById,
  getEntryByIdPrefix,
  fetchEntryOriginal,
  fetchProductHuntOfficialContext,
  submitLink,
  submitGitHubRepo,
  queueSubmittedLink,
  approveSubmissionRequest,
  rejectSubmissionRequest,
  deleteEntry,
  removeCachedEntry,
  deleteSource,
  deleteUserSubmissions,
  moderateUser,
  setEnabled,
  isEnabled,
  assertPublicHttpUrl,
  fetchPublicBuffer,
  safeRasterMimeType,
  jinaReaderUrl,
  isThinEntryContent,
  shouldAutoFetchOriginal,
  __test: {
    acquireCacheWriteLock,
    bestSrcsetCandidate,
    cachePayloadForDisk,
    contentContainerScore,
    createPinnedLookup,
    dedupeEntries,
    decodeResponseBuffer,
    extractReadableContent,
    fetchPublicBuffer,
    fetchText,
    isGenericCoverImage,
    isLikelyArticleOgImage,
    isNonPublicIpAddress,
    isThinEntryContent,
    entryHasLocalPreservedBody,
    isTrackingPixelUrl,
    localizeEntryImages,
    mergeCacheEntries,
    mergeCacheSources,
    normalizeFeedContent,
    normalizeFeedEntryUrl,
    pickArticleCoverImage,
    productHuntOfficialContextMatches,
    shouldAutoFetchOriginal,
    submittedContentRiskReason,
    validateSubmittedUrlShape,
    productHuntOfficialUrlCandidates,
    resolvePublicTarget,
    releaseCacheWriteLock,
    safeRasterMimeType,
    sitemapDocumentUrls,
  },
};
