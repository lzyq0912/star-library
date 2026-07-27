#!/usr/bin/env node
/**
 * 知乎存量修复：
 * 1) raw HTML → Markdown
 * 2) 正文/封面远程图片下载到 public/article-images/{sourceId}/{entry16}/{hash20}.ext
 * 3) 公式图保留为 LaTeX（不下载 equation 图）
 *
 * 用法：
 *   node scripts/repair-zhihu-local.js
 *   node scripts/repair-zhihu-local.js --source=zhihu-tianqing
 *   node scripts/repair-zhihu-local.js --limit=5 --dry-run
 *   node scripts/repair-zhihu-local.js --skip-download
 *   node scripts/repair-zhihu-local.js --concurrency=8
 *   node scripts/repair-zhihu-local.js --needs-images   # 仅仍有远程图或未转 MD 的条目
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { zhihuHtmlToMarkdown, markdownSummary, firstMarkdownImage } = require('./zhihu-html-to-markdown');
const { normalizeZhihu } = require('../public/content-normalizers.js');
const { assertPublicHttpUrl } = require('../lib/fetcher/net-safety');

const ROOT = path.join(__dirname, '..');
process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR || path.join(ROOT, 'data');
const DATA_DIR = process.env.QMREADER_DATA_DIR;
const DB_FILE = process.env.QMREADER_DB_FILE || path.join(DATA_DIR, 'qmreader.sqlite');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const IMAGE_ROOT = path.join(ROOT, 'public', 'article-images');
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;

/** 路径段净化：防 sourceId/entryId 含 ../ 等逃逸出 article-images */
function sanitizePathSegment(value, maxLen = 64) {
  return String(value || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, maxLen) || 'unknown';
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipDownload = args.includes('--skip-download');
const needsImagesOnly = args.includes('--needs-images');
const sourceFilter = (args.find(a => a.startsWith('--source=')) || '').slice('--source='.length);
const limit = Number((args.find(a => a.startsWith('--limit=')) || '').slice('--limit='.length)) || 0;
const concurrency = Math.max(1, Number((args.find(a => a.startsWith('--concurrency=')) || '').slice('--concurrency='.length)) || 6);

/** 仍含远程图床 / 未转 Markdown 的知乎条目（新导入或未修完） */
function entryNeedsRepair(row) {
  const body = String(row && row.content || '');
  if (looksLikeHtml(body)) return true;
  if (/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/i.test(body)) return true;
  if (/https?:\/\/(?:[^/\s)]+\.)?(?:zhimg\.com|zhihu\.com)\//i.test(body)) return true;
  const image = String(row && row.image || '');
  if (isHttpUrl(image) && !image.includes('/article-images/')) return true;
  return false;
}

function md5(text) {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function looksLikeHtml(value) {
  return /<(?:p|div|blockquote|h[1-6]|ul|ol|table|figure)\b/i.test(String(value || '').slice(0, 1200));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isEquationUrl(value) {
  return /zhihu\.com\/equation|equation\?tex=/i.test(String(value || ''));
}

function preferFullImageUrl(url) {
  let clean = String(url || '').trim();
  if (!clean) return '';
  // 去掉知乎尺寸后缀，尽量拉原图
  clean = clean.replace(/_720w\.(jpg|jpeg|png|webp)/i, '_r.$1');
  clean = clean.replace(/_b\.(jpg|jpeg|png|webp)/i, '_r.$1');
  return clean;
}

function collectMarkdownImages(markdown) {
  const text = String(markdown || '');
  const found = [];
  const re = /!\[[^\]]*\]\((\/article-images\/[^)\s]+|https?:\/\/[^)\s]+)\)/gi;
  let match;
  while ((match = re.exec(text))) {
    found.push({ start: match.index + match[0].lastIndexOf('(') + 1, end: match.index + match[0].length - 1, url: match[1] });
  }
  return found;
}

function imageExtension(buf, contentType, url) {
  if (buf && buf.length >= 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  }
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/jpeg')) return 'jpg';
  if (type.includes('image/webp')) return 'webp';
  if (type.includes('image/gif')) return 'gif';
  const fromUrl = /\.(png|jpe?g|gif|webp)(?:$|\?)/i.exec(String(url || ''));
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  return '';
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function downloadImage(url) {
  let safeUrl;
  try {
    // SSRF：拒绝 localhost / 内网 / 非 http(s)
    safeUrl = await assertPublicHttpUrl(url);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(safeUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://zhuanlan.zhihu.com/',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf.length > MAX_IMAGE_BYTES) return null;
    const ext = imageExtension(buf, res.headers.get('content-type') || '', safeUrl);
    if (!ext) return null;
    return { buf, ext };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function localPathFor(sourceId, entryFolder, remoteUrl, ext) {
  const source = sanitizePathSegment(sourceId, 64);
  const folder = sanitizePathSegment(entryFolder, 16);
  const assetHash = sha256(remoteUrl).slice(0, 20);
  const file = `${assetHash}.${ext}`;
  const abs = path.join(IMAGE_ROOT, source, folder, file);
  const web = `/article-images/${source}/${folder}/${file}`;
  return { abs, web, assetHash, source, folder };
}

async function localizeMarkdownImages(sourceId, entryId, articleUrl, markdown) {
  if (skipDownload) return { markdown, downloaded: 0, reused: 0, failed: 0 };

  const entryFolder = (entryId || md5(articleUrl || '')).slice(0, 16);
  const matches = collectMarkdownImages(markdown);
  const remoteUrls = [];
  for (const item of matches) {
    if (item.url.startsWith('/article-images/')) continue;
    if (!isHttpUrl(item.url) || isEquationUrl(item.url)) continue;
    const preferred = preferFullImageUrl(item.url);
    if (preferred && !remoteUrls.includes(preferred)) remoteUrls.push(preferred);
  }

  // 封面也可能只有 image 字段
  const coverCandidates = [];

  const urlMap = new Map(); // preferred remote -> local web path
  let downloaded = 0;
  let reused = 0;
  let failed = 0;

  await mapPool(remoteUrls, concurrency, async (remote) => {
    // 先看是否已有任意扩展名
    const probe = localPathFor(sourceId, entryFolder, remote, 'jpg');
    const dir = path.dirname(probe.abs);
    if (fs.existsSync(dir)) {
      const existing = fs.readdirSync(dir).find(name => name.startsWith(probe.assetHash + '.'));
      if (existing) {
        urlMap.set(remote, `/article-images/${probe.source}/${probe.folder}/${existing}`);
        reused += 1;
        return;
      }
    }

    if (dryRun) {
      urlMap.set(remote, probe.web);
      return;
    }

    const got = await downloadImage(remote);
    if (!got) {
      // 回退：有时 _r 不存在，试原 URL 形式
      const alt = remote.includes('_r.') ? remote.replace(/_r\.(jpg|jpeg|png|webp)/i, '_720w.$1') : '';
      const got2 = alt ? await downloadImage(alt) : null;
      if (!got2) {
        failed += 1;
        urlMap.set(remote, remote);
        return;
      }
      const paths = localPathFor(sourceId, entryFolder, remote, got2.ext);
      fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
      fs.writeFileSync(paths.abs, got2.buf);
      urlMap.set(remote, paths.web);
      downloaded += 1;
      return;
    }

    const paths = localPathFor(sourceId, entryFolder, remote, got.ext);
    fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
    fs.writeFileSync(paths.abs, got.buf);
    urlMap.set(remote, paths.web);
    downloaded += 1;
  });

  // 从后往前替换，避免 offset 漂移
  let output = markdown;
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  for (const item of sorted) {
    if (item.url.startsWith('/article-images/') || isEquationUrl(item.url) || !isHttpUrl(item.url)) continue;
    const preferred = preferFullImageUrl(item.url);
    const local = urlMap.get(preferred) || item.url;
    output = output.slice(0, item.start) + local + output.slice(item.end);
  }

  return { markdown: output, downloaded, reused, failed, coverCandidates, urlMap };
}

function localizeCover(image, sourceId, entryId, urlMap) {
  const raw = String(image || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/article-images/')) return raw;
  if (!isHttpUrl(raw) || isEquationUrl(raw)) return raw;
  const preferred = preferFullImageUrl(raw);
  if (urlMap && urlMap.has(preferred)) return urlMap.get(preferred);
  // 若封面不在正文图集，仍可按同规则生成路径（调用方应已下载）
  return preferred;
}

function listZhihuEntries() {
  const db = new DatabaseSync(DB_FILE);
  const rows = db.prepare(`
    SELECT id, source_id, title, link, content, summary, image, published, published_ts
    FROM entries
    WHERE source_id LIKE 'zhihu-%'
      AND COALESCE(deleted_at, 0) = 0
    ORDER BY source_id, published_ts DESC
  `).all();
  db.close();
  return rows
    .filter(row => !sourceFilter || row.source_id === sourceFilter)
    .filter(row => !needsImagesOnly || entryNeedsRepair(row))
    .slice(0, limit > 0 ? limit : undefined);
}

function updateEntry(id, { content, summary, image }) {
  const db = new DatabaseSync(DB_FILE);
  const t = Date.now();
  db.prepare(`
    UPDATE entries
    SET content = ?,
        summary = ?,
        image = ?,
        content_hash = ?,
        original_fetched_at = COALESCE(original_fetched_at, ?),
        original_fetch_error = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(
    content,
    summary,
    image,
    sha256(content),
    t,
    t,
    id,
  );
  db.close();
}

function patchCache(updates) {
  if (!fs.existsSync(CACHE_FILE)) return 0;
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return 0;
  }
  let n = 0;
  const byId = new Map(updates.map(u => [u.id, u]));
  for (const source of Object.values(cache || {})) {
    if (!source || !Array.isArray(source.entries)) continue;
    for (const entry of source.entries) {
      const u = entry && entry.id ? byId.get(entry.id) : null;
      if (!u) continue;
      entry.content = u.content;
      entry.summary = u.summary;
      entry.image = u.image;
      entry.contentHash = sha256(u.content);
      n += 1;
    }
  }
  if (n && !dryRun) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return n;
}

async function main() {
  const rows = listZhihuEntries();
  console.log(`[zhihu-repair] entries=${rows.length} dryRun=${dryRun} skipDownload=${skipDownload} needsImages=${needsImagesOnly} concurrency=${concurrency} source=${sourceFilter || '*'}`);

  const updates = [];
  let converted = 0;
  let imgDownloaded = 0;
  let imgReused = 0;
  let imgFailed = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const prefix = `[${i + 1}/${rows.length}] ${row.source_id} ${row.title.slice(0, 40)}`;
    let body = String(row.content || '');
    if (looksLikeHtml(body)) {
      body = zhihuHtmlToMarkdown(body);
      converted += 1;
    }
    // 与阅读器 QMContentNormalizers.normalizeZhihu 对齐，持久化干净 Markdown
    body = normalizeZhihu(body);

    const loc = await localizeMarkdownImages(row.source_id, row.id, row.link, body);
    body = loc.markdown;
    imgDownloaded += loc.downloaded || 0;
    imgReused += loc.reused || 0;
    imgFailed += loc.failed || 0;

    // 封面：优先已本地化正文首图；忽略公式图/远程未落盘的 equation
    let cover = firstMarkdownImage(body) || null;
    if (cover && isEquationUrl(cover)) cover = null;
    if (row.image && isEquationUrl(row.image) && !cover) {
      // 旧数据把公式图当封面，清空
      cover = null;
    }
    if (!cover && row.image && isHttpUrl(row.image) && !isEquationUrl(row.image) && !skipDownload) {
      const preferred = preferFullImageUrl(row.image);
      const entryFolder = sanitizePathSegment(row.id.slice(0, 16), 16);
      const probe = localPathFor(row.source_id, entryFolder, preferred, 'jpg');
      const dir = path.dirname(probe.abs);
      let web = null;
      if (fs.existsSync(dir)) {
        const existing = fs.readdirSync(dir).find(name => name.startsWith(probe.assetHash + '.'));
        if (existing) web = `/article-images/${probe.source}/${probe.folder}/${existing}`;
      }
      if (!web && !dryRun) {
        const got = await downloadImage(preferred);
        if (got) {
          const paths = localPathFor(row.source_id, entryFolder, preferred, got.ext);
          fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
          fs.writeFileSync(paths.abs, got.buf);
          web = paths.web;
          imgDownloaded += 1;
        }
      }
      cover = web || (String(row.image).startsWith('/article-images/') ? row.image : preferred);
    } else if (row.image && String(row.image).startsWith('/article-images/')) {
      cover = row.image;
    } else if (!cover && row.image) {
      cover = localizeCover(row.image, row.source_id, row.id, loc.urlMap);
    }

    const summary = markdownSummary(body, 280) || String(row.summary || '').slice(0, 280);
    console.log(`${prefix} -> md=${body.length} dl=${loc.downloaded || 0} reuse=${loc.reused || 0} fail=${loc.failed || 0}`);

    const update = {
      id: row.id,
      content: body,
      summary,
      image: cover || row.image || null,
    };
    updates.push(update);
    if (!dryRun) updateEntry(row.id, update);
  }

  const cacheHits = patchCache(updates);
  console.log(`[zhihu-repair] done converted=${converted} downloaded=${imgDownloaded} reused=${imgReused} failed=${imgFailed} cachePatched=${cacheHits} dryRun=${dryRun}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
