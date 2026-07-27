'use strict';

/**
 * 条目图片本地化：远程图落到 public/article-images，改写正文/封面 URL。
 * 无 cache/state。下载走 http-public.fetchPublicBuffer（manual redirect + pin）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  BROWSER_HEADERS,
  fetchPublicBuffer,
  rasterExtFromBuffer,
} = require('./http-public');
const {
  hostnameOf,
  isTrackingPixelUrl,
  firstImage,
  isLikelyContentImageUrl,
  repairEmptyImageAnchorsHtml,
} = require('./html-content');

/** public/article-images 绝对根（本文件在 lib/fetcher/ 下，上两级为项目根） */
const IMAGE_ROOT = path.join(__dirname, '..', '..', 'public', 'article-images');
const MAX_LOCALIZE_IMAGE_BYTES = Math.max(1, Math.min(20, parseInt(process.env.MAX_LOCALIZE_IMAGE_MB || '12', 10) || 12)) * 1024 * 1024;
// 默认 40：长图文 Substack（30+ 图）不再只本地化前 20 张导致后半远程、前半偶发丢图
const MAX_LOCALIZE_IMAGES_PER_ENTRY = Math.max(1, Math.min(80, parseInt(process.env.MAX_LOCALIZE_IMAGES_PER_ENTRY || '40', 10) || 40));
const LOCALIZE_IMAGE_CONCURRENCY = Math.max(1, Math.min(6, parseInt(process.env.LOCALIZE_IMAGE_CONCURRENCY || '3', 10) || 3));

async function mapLimit(items, limit, mapper) {
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

function isLocalArticleImageUrl(value) {
  return /^\/article-images\/[a-z0-9_-]+\//i.test(String(value || '').trim());
}

function isLocalizableRemoteImageUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  if (isTrackingPixelUrl(raw)) return false;
  if (/^file:/i.test(raw)) return false;
  if (/zhihu\.com\/equation|equation\?tex=/i.test(raw)) return false;
  return true;
}

function imageRefererFor(url, pageUrl = '') {
  const host = hostnameOf(url);
  if (/zhimg\.com$/i.test(host) || /zhihu\.com$/i.test(host)) return 'https://zhuanlan.zhihu.com/';
  if (pageUrl) {
    try {
      return new URL(pageUrl).origin + '/';
    } catch { /* fall through */ }
  }
  try {
    return new URL(url).origin + '/';
  } catch {
    return '';
  }
}

function collectContentImageUrls(html, cover = '') {
  const found = [];
  const push = (value) => {
    const url = String(value || '').trim();
    if (!url || found.includes(url)) return;
    found.push(url);
  };
  if (cover) push(cover);
  const source = String(html || '');
  const srcRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = srcRe.exec(source))) push(match[1]);
  const mdRe = /!\[[^\]]*\]\(([^)\s]+)\)/gi;
  while ((match = mdRe.exec(source))) push(match[1]);
  // 空图片锚点 / figure 链接（尚未 promote 成 img 时仍可本地化）
  const hrefRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*<\/a>/gi;
  while ((match = hrefRe.exec(source))) {
    if (isLikelyContentImageUrl(match[1])) push(match[1]);
  }
  return found;
}

function rewriteContentImageUrls(html, urlMap) {
  let out = String(html || '');
  if (urlMap && urlMap.size) {
    const mapped = (src) => urlMap.get(src) || urlMap.get(String(src || '').split('?')[0]) || src;
    out = out.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (full, pre, src, post) => {
      return `${pre}${mapped(src)}${post}`;
    });
    out = out.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (full, pre, src, post) => {
      return `${pre}${mapped(src)}${post}`;
    });
    // 同步改写图片锚点 href（仅 urlMap 命中；勿用 isLikelyContentImageUrl 放宽误伤普通外链）
    out = out.replace(/(<a\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, (full, pre, href, post) => {
      if (!urlMap.has(href) && !urlMap.has(String(href || '').split('?')[0])) {
        return full;
      }
      return `${pre}${mapped(href)}${post}`;
    });
  }
  // 作者机本地 file:// 路径不可能在阅读器里打开，直接去掉
  out = out.replace(/<img\b[^>]*\bsrc=["']file:[^"']+["'][^>]*>/gi, '');
  out = out.replace(/!\[[^\]]*\]\(file:[^)\s]+\)/gi, '');
  return out;
}

function localImagePaths(sourceId, entryId, remoteUrl, ext) {
  const source = String(sourceId || 'unknown').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64) || 'unknown';
  // entryId 与 source 同规则净化；空 entryId 时 folder 用 md5(remoteUrl).slice(0,16)
  const entryKey = String(entryId || '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 16);
  const folder = entryKey || crypto.createHash('md5').update(String(remoteUrl || '')).digest('hex').slice(0, 16);
  const assetHash = crypto.createHash('sha256').update(String(remoteUrl || '')).digest('hex').slice(0, 20);
  const file = `${assetHash}.${ext}`;
  const abs = path.join(IMAGE_ROOT, source, folder, file);
  const web = `/article-images/${source}/${folder}/${file}`;
  return { abs, web, assetHash, dir: path.dirname(abs) };
}

function findExistingLocalImage(sourceId, entryId, remoteUrl) {
  const probe = localImagePaths(sourceId, entryId, remoteUrl, 'jpg');
  try {
    if (!fs.existsSync(probe.dir)) return '';
    const hit = fs.readdirSync(probe.dir).find(name => name.startsWith(`${probe.assetHash}.`));
    // web path 与 localImagePaths 同一 folder 键（勿用未净化 entryId 重拼）
    if (!hit) return '';
    return probe.web.replace(/\/[^/]+$/, `/${hit}`);
  } catch {
    return '';
  }
}

/**
 * 下载远程图：走 fetchPublicBuffer（manual redirect + 每跳 pin），禁止 redirect:'follow' 绕过 SSRF。
 * @returns {{ buffer: Buffer, ext: string, finalUrl: string } | null}
 */
async function downloadImageForLocalize(url, pageUrl = '') {
  const headers = {
    ...BROWSER_HEADERS,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: imageRefererFor(url, pageUrl),
  };
  try {
    const result = await fetchPublicBuffer(url, {
      timeout: 90000,
      maxBytes: MAX_LOCALIZE_IMAGE_BYTES,
      headers,
    });
    if (!result || result.status < 200 || result.status >= 300 || !result.buffer || result.buffer.length < 32) {
      return null;
    }
    if (result.buffer.length > MAX_LOCALIZE_IMAGE_BYTES) return null;
    const finalUrl = result.url || url;
    const ext = rasterExtFromBuffer(
      result.buffer,
      result.headers && result.headers.get('content-type'),
      finalUrl,
    );
    if (!ext) return null;
    return { buffer: result.buffer, ext, finalUrl };
  } catch {
    return null;
  }
}

/**
 * 把正文/封面里的远程图落到 public/article-images，避免防盗链、大图超时、外网不稳导致青稞等源「图全挂」。
 */
async function localizeEntryImages({
  sourceId = '',
  entryId = '',
  content = '',
  image = null,
  pageUrl = '',
} = {}) {
  const source = String(sourceId || '').trim() || 'unknown';
  const id = String(entryId || '').trim();
  // 先把空图片锚点补成 <img>，再收集/下载（Substack figure 丢 img 时依赖这一步）
  let nextContent = repairEmptyImageAnchorsHtml(String(content || ''), pageUrl);
  let nextImage = image || null;
  const candidates = collectContentImageUrls(nextContent, nextImage)
    .filter(url => isLocalizableRemoteImageUrl(url))
    .slice(0, MAX_LOCALIZE_IMAGES_PER_ENTRY);
  if (!candidates.length) {
    nextContent = rewriteContentImageUrls(nextContent, new Map());
    if (nextImage && /^file:/i.test(String(nextImage))) nextImage = null;
    return {
      content: nextContent,
      image: nextImage,
      downloaded: 0,
      reused: 0,
      failed: 0,
      urlMap: new Map(),
    };
  }

  const urlMap = new Map();
  let downloaded = 0;
  let reused = 0;
  let failed = 0;

  await mapLimit(candidates, LOCALIZE_IMAGE_CONCURRENCY, async (remote) => {
    const existing = findExistingLocalImage(source, id, remote);
    if (existing) {
      urlMap.set(remote, existing);
      reused += 1;
      return;
    }
    try {
      const got = await downloadImageForLocalize(remote, pageUrl);
      if (!got) {
        failed += 1;
        return;
      }
      const paths = localImagePaths(source, id, remote, got.ext);
      const absResolved = path.resolve(paths.abs);
      const rootResolved = path.resolve(IMAGE_ROOT);
      if (!absResolved.startsWith(rootResolved + path.sep)) {
        failed += 1;
        return;
      }
      fs.mkdirSync(path.dirname(absResolved), { recursive: true });
      fs.writeFileSync(absResolved, got.buffer);
      urlMap.set(remote, paths.web);
      downloaded += 1;
    } catch {
      failed += 1;
    }
  });

  nextContent = rewriteContentImageUrls(nextContent, urlMap);
  if (nextImage && urlMap.has(nextImage)) nextImage = urlMap.get(nextImage);
  if (nextImage && (isTrackingPixelUrl(nextImage) || /^file:/i.test(String(nextImage)))) {
    nextImage = firstImage(nextContent) || null;
  }
  if ((!nextImage || !isLocalArticleImageUrl(nextImage)) && urlMap.size) {
    const firstLocal = [...urlMap.values()].find(isLocalArticleImageUrl);
    if (firstLocal) nextImage = firstLocal;
  }
  return { content: nextContent, image: nextImage, downloaded, reused, failed, urlMap };
}

module.exports = {
  IMAGE_ROOT,
  MAX_LOCALIZE_IMAGE_BYTES,
  MAX_LOCALIZE_IMAGES_PER_ENTRY,
  LOCALIZE_IMAGE_CONCURRENCY,
  isLocalArticleImageUrl,
  isLocalizableRemoteImageUrl,
  imageRefererFor,
  collectContentImageUrls,
  rewriteContentImageUrls,
  localImagePaths,
  findExistingLocalImage,
  downloadImageForLocalize,
  localizeEntryImages,
  repairEmptyImageAnchorsHtml,
};
