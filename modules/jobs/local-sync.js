const fs = require('fs');
const path = require('path');
const likesSync = require('../../lib/likes-sync');
const xhsKbSync = require('../../lib/xhs-kb-sync');
const biliWatchlaterSync = require('../../lib/bili-watchlater-sync');
const { ROOT, MINUTE_MS } = require('../shared/config');

const ZHIHU_SOURCE_RE = /^zhihu-/;
const ZHIHU_IMPORT_STAMP = process.env.ZHIHU_IMPORT_STAMP
  || path.join(ROOT, 'data', 'blog-crawl', 'zhihu-last-import.json');
// 默认 60s：crawl 写 stamp 后尽快灌 cache；refresh-hint 可即时触发
const ZHIHU_RELOAD_POLL_MS = parseInt(process.env.ZHIHU_RELOAD_POLL_MS || `${MINUTE_MS}`, 10);

let zhihuStampSeen = '';
let zhihuPollTimer = null;

/** 已禁用 / 已删源：不再扫盘 upsert（避免删后被 forceContent 复活） */
function isFetcherSourceEnabled(fetcher, sourceId) {
  if (!fetcher || typeof fetcher.getSourceById !== 'function') return true;
  const src = fetcher.getSourceById(sourceId);
  if (!src) return false;
  if (typeof fetcher.isEnabled === 'function') return fetcher.isEnabled(src);
  return src.enabled !== false;
}

function listZhihuSourceIds(fetcher) {
  if (!fetcher || typeof fetcher.getSourcesMeta !== 'function') return [];
  return fetcher.getSourcesMeta()
    .filter(s => s && ZHIHU_SOURCE_RE.test(String(s.id || '')))
    .map(s => s.id);
}

/**
 * 知乎 localOnly：从 SQLite 重灌内存 cache（不爬网）。
 * fetchSource(localOnly) 路径无 await，调用后 cache 已更新。
 */
function reloadZhihuSource(fetcher, sourceId) {
  const id = String(sourceId || '').trim();
  if (!id || !ZHIHU_SOURCE_RE.test(id)) return null;
  const src = fetcher.getSourceById(id);
  if (!src) return null;
  if (!isFetcherSourceEnabled(fetcher, id)) {
    return {
      kind: 'zhihu',
      sourceId: id,
      skipped: true,
      disabled: true,
      imported: 0,
      entryCount: 0,
    };
  }
  // localOnly 分支同步写 cache，返回 Promise 但不阻塞
  void fetcher.fetchSource(src);
  let entryCount = 0;
  try {
    const entries = fetcher.getEntries({ sourceId: id, limit: 5000 }) || [];
    entryCount = Array.isArray(entries) ? entries.length : 0;
  } catch {
    entryCount = 0;
  }
  return {
    kind: 'zhihu',
    sourceId: id,
    imported: 0,
    entryCount,
    skipped: false,
  };
}

function reloadAllZhihuSources(fetcher) {
  const ids = listZhihuSourceIds(fetcher);
  const results = [];
  for (const id of ids) {
    const r = reloadZhihuSource(fetcher, id);
    if (r) results.push(r);
  }
  return results;
}

function readZhihuImportStamp() {
  try {
    if (!fs.existsSync(ZHIHU_IMPORT_STAMP)) return null;
    const raw = fs.readFileSync(ZHIHU_IMPORT_STAMP, 'utf8');
    const data = JSON.parse(raw);
    const key = String(data && (data.finishedAt || data.at || data.ts) || raw).trim();
    return { key, data };
  } catch {
    return null;
  }
}

/**
 * 外部 crawl 写 stamp 后，Reader 进程轮询重读知乎 DB → 内存 cache。
 */
function pollZhihuImportStamp(fetcher) {
  const stamp = readZhihuImportStamp();
  if (!stamp || !stamp.key) return { changed: false };
  if (stamp.key === zhihuStampSeen) return { changed: false, key: stamp.key };
  zhihuStampSeen = stamp.key;
  const results = reloadAllZhihuSources(fetcher);
  const total = results.reduce((n, r) => n + (r.entryCount || 0), 0);
  console.log(`[zhihu-reload] stamp=${stamp.key} sources=${results.length} entries≈${total}`);
  return { changed: true, key: stamp.key, results };
}

function startZhihuImportWatch(fetcher) {
  if (!Number.isFinite(ZHIHU_RELOAD_POLL_MS) || ZHIHU_RELOAD_POLL_MS <= 0) {
    console.log('[zhihu-reload] poll disabled (ZHIHU_RELOAD_POLL_MS<=0)');
    return;
  }
  // 启动时记下当前 stamp，避免把旧 import 当新事件；若尚无 stamp 则空串
  const initial = readZhihuImportStamp();
  zhihuStampSeen = initial && initial.key ? initial.key : '';
  if (zhihuPollTimer) clearInterval(zhihuPollTimer);
  const interval = Math.max(30 * 1000, ZHIHU_RELOAD_POLL_MS);
  zhihuPollTimer = setInterval(() => {
    try {
      pollZhihuImportStamp(fetcher);
    } catch (error) {
      console.warn('[zhihu-reload] poll failed:', error.message || error);
    }
  }, interval);
  if (typeof zhihuPollTimer.unref === 'function') zhihuPollTimer.unref();
  console.log(`[zhihu-reload] poll every ${interval}ms stamp=${ZHIHU_IMPORT_STAMP}`);
}

/**
 * 本地 Typora/知识库/知乎源：扫盘或重读 DB → 灌内存 cache。
 * 返回 null 表示不是本地 likes/kb/zhihu 源。
 */
function syncLocalDiskSource(fetcher, sourceId, { force = true } = {}) {
  const id = String(sourceId || '').trim();
  if (!id) return null;
  if (id === biliWatchlaterSync.SOURCE_ID) {
    if (!isFetcherSourceEnabled(fetcher, id)) {
      return {
        kind: 'bili-watchlater',
        sourceId: id,
        skipped: true,
        disabled: true,
        imported: 0,
        entryCount: 0,
      };
    }
    // 异步 API 同步：返回 Promise；orchestrator/refresh-hint 已 await 兼容
    return Promise.resolve()
      .then(() => biliWatchlaterSync.syncAll({ force, fetcher }))
      .then((result) => {
        biliWatchlaterSync.refreshLocalSources(fetcher);
        return {
          kind: 'bili-watchlater',
          sourceId: id,
          result,
          entryCount: result ? (result.count || result.imported || 0) : 0,
          imported: result ? (result.imported || 0) : 0,
          skipped: Boolean(result && result.skipped),
        };
      });
  }
  if (id === likesSync.SOURCE_X || id === likesSync.SOURCE_XHS) {
    if (!isFetcherSourceEnabled(fetcher, id)) {
      return {
        kind: 'likes',
        sourceId: id,
        skipped: true,
        disabled: true,
        imported: 0,
        entryCount: 0,
      };
    }
    const result = likesSync.syncBySourceId(id, { force, fetcher });
    likesSync.refreshLocalSources(fetcher);
    return {
      kind: 'likes',
      sourceId: id,
      result,
      entryCount: result && !result.missing ? (result.files || result.imported || 0) : 0,
      imported: result ? (result.imported || 0) : 0,
      skipped: Boolean(result && result.skipped),
    };
  }
  if (/^xhs-/.test(id) && id !== likesSync.SOURCE_XHS) {
    if (!isFetcherSourceEnabled(fetcher, id)) {
      return {
        kind: 'xhs-kb',
        sourceId: id,
        skipped: true,
        disabled: true,
        imported: 0,
      };
    }
    const results = xhsKbSync.syncAll({ fetcher });
    xhsKbSync.refreshLocalSources(fetcher);
    const hit = (results || []).find(r => r && r.sourceId === id) || null;
    return {
      kind: 'xhs-kb',
      sourceId: id,
      result: hit,
      results,
      imported: hit ? (hit.imported || 0) : 0,
    };
  }
  if (ZHIHU_SOURCE_RE.test(id)) {
    return reloadZhihuSource(fetcher, id);
  }
  return null;
}

function runStartupLocalIngest(fetcher) {
  try {
    const results = likesSync.syncAll({ force: true, fetcher });
    likesSync.refreshLocalSources(fetcher);
    for (const r of results) {
      if (r.disabled) console.log(`[likes-sync] skip disabled ${r.sourceId}`);
      else if (r.missing) console.warn(`[likes-sync] missing ${r.sourceId}: ${r.root}`);
      else console.log(`[likes-sync] ${r.sourceId}: imported ${r.imported}/${r.files}`);
    }
  } catch (error) {
    console.warn('[likes-sync] startup sync failed:', error.message || error);
  }
  try {
    const kbResults = xhsKbSync.syncAll({ fetcher });
    xhsKbSync.refreshLocalSources(fetcher);
    for (const r of kbResults) {
      if (r.disabled) console.log(`[xhs-kb] skip disabled ${r.sourceId}`);
      else if (r.missing) console.warn(`[xhs-kb] missing ${r.sourceId}: ${r.root}`);
      else console.log(`[xhs-kb] ${r.sourceId}: imported ${r.imported}`);
    }
  } catch (error) {
    console.warn('[xhs-kb] startup sync failed:', error.message || error);
  }
  // 知乎：启动时重读 DB；之后靠 stamp 轮询感知外部 crawl
  try {
    const zhihu = reloadAllZhihuSources(fetcher);
    if (zhihu.length) {
      console.log(`[zhihu-reload] startup hydrate sources=${zhihu.length}`);
    }
  } catch (error) {
    console.warn('[zhihu-reload] startup hydrate failed:', error.message || error);
  }
  startZhihuImportWatch(fetcher);
  // B站稍后再看：启动全量同步 + 周期轮询
  void (async () => {
    try {
      const r = await biliWatchlaterSync.syncAll({ force: true, fetcher });
      biliWatchlaterSync.refreshLocalSources(fetcher);
      if (r.disabled) console.log('[bili-watchlater] skip disabled');
      else if (r.skipped) console.log(`[bili-watchlater] startup skipped count=${r.count || 0}`);
      else console.log(`[bili-watchlater] startup: imported=${r.imported} count=${r.count}`);
    } catch (error) {
      console.warn('[bili-watchlater] startup sync failed:', error.message || error);
    }
    if (process.env.BILI_SYNC_ENABLED === '0') return;
    biliWatchlaterSync.startPoll({ fetcher });
  })();
  if (process.env.LIKES_WATCH === '0') {
    console.log('[likes-sync] watch disabled (LIKES_WATCH=0)');
    return;
  }
  likesSync.startWatch({ fetcher });
}

module.exports = {
  syncLocalDiskSource,
  runStartupLocalIngest,
  reloadZhihuSource,
  reloadAllZhihuSources,
  pollZhihuImportStamp,
  startZhihuImportWatch,
  ZHIHU_IMPORT_STAMP,
};
