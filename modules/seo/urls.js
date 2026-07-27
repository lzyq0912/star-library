/**
 * Path / slug / canonical / entry lookup helpers (SEO leaf).
 */
const fetcher = require('../../lib/fetcher');
const {
  ARTICLE_SHORT_ID_LENGTH,
  ASSET_DIRECTORY_META,
} = require('../shared/config');

function clipText(value, max = 180) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function slugifyForUrl(value, fallback = 'article') {
  const slug = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’"“”‘]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function entrySlug(entry) {
  const fallback = slugifyForUrl(entry && entry.id, 'article');
  return slugifyForUrl(entry && (entry.titleZh || entry.title || entry.id), fallback);
}

function entryShortId(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  return String(id || '').trim().slice(0, ARTICLE_SHORT_ID_LENGTH);
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

function entryArticleLocator(entry) {
  const shortId = entryShortId(entry);
  return `${entrySlug(entry)}--${shortId}`;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return String(value || '').trim();
  }
}

function splitArticleLocator(locator) {
  const value = String(locator || '').trim();
  const marker = value.lastIndexOf('--');
  if (marker <= 0) return null;
  const slug = value.slice(0, marker).replace(/^-+|-+$/g, '');
  const shortId = value.slice(marker + 2).trim();
  if (!slug || shortId.length < 6) return null;
  return { slug, shortId };
}

function translationBlockText(pair) {
  if (!pair) return '';
  return String(pair.target || '').trim() || clipText(pair.targetHtml || '', 240);
}

function publicUrl(req, target = req.originalUrl || '/') {
  const host = req.get('host') || 'rss.qiaomu.ai';
  const proto = req.protocol || (req.get('x-forwarded-proto') || 'https').split(',')[0];
  return `${proto}://${host}${target}`;
}

function absolutePublicUrl(req, value) {
  if (!value) return '';
  try {
    return new URL(value, publicUrl(req, '/')).href;
  } catch {
    return '';
  }
}

function normalizeAssetDirectoryType(value) {
  return ASSET_DIRECTORY_META[value] ? value : '';
}

function requestAssetDirectoryType(req) {
  const queryType = normalizeAssetDirectoryType(String(req.query.asset || ''));
  if (queryType) return queryType;
  const match = String(req.path || '').match(/^\/assets\/([^/.]+)\/?$/);
  return normalizeAssetDirectoryType(match ? match[1] : '');
}

function requestAssetSort(req) {
  return String(req.query.sort || '') === 'helpful' ? 'helpful' : 'latest';
}

function isAssetDirectoryRequest(req) {
  if (String(req.query.view || '') === 'assets') return true;
  return /^\/assets(?:\/[^/.]+)?\/?$/.test(String(req.path || ''));
}

function isContributorDirectoryRequest(req) {
  return /^\/contributors\/?$/.test(String(req.path || ''));
}

function contributorIdFromRequest(req) {
  const match = String(req.path || '').match(/^\/contributors\/([^/?#]+)\/?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1] || '').trim();
  }
}

function articleRouteFromRequest(req) {
  const match = String(req.path || '').match(/^\/articles\/(.+?)\/?$/);
  if (!match) return null;
  const segments = String(match[1] || '').split('/').filter(Boolean).map(decodePathSegment);
  const first = segments[0] || '';
  if (!first) return null;
  const locator = splitArticleLocator(first);
  if (locator) {
    const focus = normalizeAssetDirectoryType(segments[1] || '');
    return {
      id: locator.shortId,
      shortId: locator.shortId,
      slug: locator.slug,
      focus,
      itemId: focus ? (segments[2] || '') : '',
      legacy: false,
    };
  }
  const id = first;
  const raw = segments.slice(1);
  let focus = '';
  let itemId = '';
  const firstAssetIndex = raw.findIndex(value => normalizeAssetDirectoryType(value));
  let slug = raw[0] || '';
  if (firstAssetIndex >= 0) {
    focus = normalizeAssetDirectoryType(raw[firstAssetIndex]);
    slug = raw.slice(0, firstAssetIndex).filter(Boolean).join('-');
    itemId = raw[firstAssetIndex + 1] || '';
  }
  return { id, shortId: '', slug, focus, itemId, legacy: true };
}

function entryForArticleRoute(route, viewer = null) {
  if (!route || !route.id) return null;
  return route.shortId
    ? fetcher.getEntryByIdPrefix(route.shortId, viewer)
    : fetcher.getEntryById(route.id, viewer);
}

function entryByIdOrPrefix(id, viewer = null) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  return fetcher.getEntryById(clean, viewer) || fetcher.getEntryByIdPrefix(clean, viewer);
}

function articleCanonicalPathForRoute(entry, route, { includeHash = false } = {}) {
  if (!entry) return '/';
  return entryPublicPath(entry, route && route.focus, route && route.itemId, { includeHash });
}

function normalizePathForCompare(value) {
  const path = String(value || '').replace(/\/+$/, '');
  return path || '/';
}

function requestAssetItemId(req, focus = '') {
  const assetFocus = normalizeAssetDirectoryType(focus);
  const articleRoute = articleRouteFromRequest(req);
  if (articleRoute && articleRoute.focus === assetFocus && articleRoute.itemId) return articleRoute.itemId;
  if (assetFocus === 'translation' || assetFocus === 'rewrite') return String(req.query.assetId || '').trim();
  if (assetFocus === 'comments') return String(req.query.comment || '').trim();
  if (assetFocus === 'annotations') return String(req.query.annotation || '').trim();
  if (assetFocus === 'chat') return String(req.query.chat || '').trim();
  return '';
}

function requestAssetFocus(req) {
  const articleRoute = articleRouteFromRequest(req);
  if (articleRoute && articleRoute.focus) return articleRoute.focus;
  if (String(req.query.comment || '').trim()) return 'comments';
  if (String(req.query.annotation || '').trim()) return 'annotations';
  if (String(req.query.chat || '').trim()) return 'chat';
  const focus = normalizeAssetDirectoryType(String(req.query.focus || ''));
  if (focus) return focus;
  const tab = String(req.query.tab || '');
  if (tab === 'translation') return 'translation';
  if (tab === 'rewrite') return 'rewrite';
  return '';
}

function normalizeContributorSort(sort = '') {
  return ['helpful', 'assets'].includes(String(sort || '').trim()) ? String(sort || '').trim() : 'latest';
}

function entryAssetCount(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return aiAssetCount(assets, 'translation');
  if (type === 'rewrite') return aiAssetCount(assets, 'rewrite');
  if (type === 'comments') return Number(assets.comments) || 0;
  if (type === 'annotations') return Number(assets.annotations) || 0;
  if (type === 'chat') return Number(assets.chatMessages) || 0;
  return Object.keys(ASSET_DIRECTORY_META).reduce((sum, itemType) => sum + entryAssetCount(entry, itemType), 0);
}

function aiAssetCount(assets, type) {
  const count = Number(assets && assets[`${type}Count`]) || 0;
  if (count) return count;
  const items = assets && assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
  if (items.length) return items.length;
  return assets && assets[type] ? 1 : 0;
}

function entryDirectorySearchText(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const parts = [entry.title, entry.titleZh, entry.summary, entry.summaryZh];
  for (const preview of Object.values(assets.previews || {})) {
    parts.push(preview.type, preview.author, preview.title, preview.model, preview.role, preview.text);
  }
  for (const items of Object.values(assets.items || {})) {
    for (const item of items || []) parts.push(item.type, item.author, item.title, item.model, item.role, item.text);
  }
  return parts.filter(Boolean).join(' ');
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatShanghaiMinute(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(t));
  } catch {
    return '';
  }
}

function hasPublicAssets(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  return Boolean(aiAssetCount(assets, 'translation') || aiAssetCount(assets, 'rewrite') || assets.annotations || assets.comments || assets.chatMessages);
}

function hasPublicAssetType(entry, type) {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return Boolean(aiAssetCount(assets, 'translation'));
  if (type === 'rewrite') return Boolean(aiAssetCount(assets, 'rewrite'));
  if (type === 'annotations') return Boolean(assets.annotations);
  if (type === 'comments') return Boolean(assets.comments);
  if (type === 'chat') return Boolean(assets.chatMessages);
  return hasPublicAssets(entry);
}

function publicAssetTypes(entry) {
  return Object.keys(ASSET_DIRECTORY_META).filter(type => hasPublicAssetType(entry, type));
}

function timestampIso(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Date(t).toISOString();
  } catch {
    return '';
  }
}

function entryLastModified(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const timestamp = Math.max(Number(assets.latestAt) || 0, Number(entry && entry.publishedTs) || 0);
  return timestampIso(timestamp);
}

function entryAssetTypeTimestamp(entry, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const assets = entry && entry.assets ? entry.assets : {};
  if (!assetType) return Math.max(Number(assets.latestAt) || 0, Number(entry && entry.publishedTs) || 0);
  if (!hasPublicAssetType(entry, assetType)) return 0;
  const itemAt = Number(assets.items?.[assetType]?.[0]?.at || 0);
  const previewAt = Number(assets.previews?.[assetType]?.at || 0);
  const latestAt = Array.isArray(assets.latestTypes) && assets.latestTypes.includes(assetType)
    ? Number(assets.latestAt) || 0
    : 0;
  return Math.max(itemAt, previewAt, latestAt);
}

function entryAssetTypeLastModified(entry, type = '', fallback = '') {
  return timestampIso(entryAssetTypeTimestamp(entry, type)) || fallback;
}

function latestAssetTypeLastModified(entries, type = '') {
  let latest = 0;
  for (const entry of entries) latest = Math.max(latest, entryAssetTypeTimestamp(entry, type));
  return timestampIso(latest);
}

function assetItemLastModified(item, fallback = '') {
  return timestampIso(item && (item.updatedAt || item.createdAt)) || fallback;
}

function entryPublicPath(entry, focus = '', itemId = '', { includeHash = true } = {}) {
  if (!entry || !entry.id) return '/';
  const parts = ['/articles', encodePathSegment(entryArticleLocator(entry))];
  const assetFocus = normalizeAssetDirectoryType(focus);
  const safeItemId = String(itemId || '').trim();
  let hash = '';
  if (assetFocus) parts.push(assetFocus);
  if (assetFocus && safeItemId) {
    parts.push(encodePathSegment(safeItemId));
    if (includeHash && assetFocus === 'comments') hash = `#comment-${encodePathSegment(safeItemId)}`;
    if (includeHash && assetFocus === 'annotations') hash = `#annotation-${encodePathSegment(safeItemId)}`;
    if (includeHash && assetFocus === 'chat') hash = `#chat-${encodePathSegment(safeItemId)}`;
  }
  return `${parts.join('/')}${hash}`;
}

function entryPublicUrl(req, entry, focus = '') {
  return publicUrl(req, entryPublicPath(entry, focus));
}

function assetDirectoryUrl(req, type = '', sort = 'latest') {
  const assetType = normalizeAssetDirectoryType(type);
  const path = assetType ? `/assets/${assetType}` : '/assets';
  const query = sort === 'helpful' ? '?sort=helpful' : '';
  return publicUrl(req, `${path}${query}`);
}

function contributorPageUrl(req, contributorId) {
  return publicUrl(req, `/contributors/${encodeURIComponent(contributorId)}`);
}

function assetFeedUrl(req, type = '', sort = 'latest') {
  const assetType = normalizeAssetDirectoryType(type);
  const path = assetType ? `/assets/${assetType}.xml` : '/assets.xml';
  const query = sort === 'helpful' ? '?sort=helpful' : '';
  return publicUrl(req, `${path}${query}`);
}

function contributorFeedUrl(req, contributorId) {
  return publicUrl(req, `/contributors/${encodeURIComponent(contributorId)}.xml`);
}

function entryAssetItemUrl(req, entry, type, preview = {}, { includeHash = true } = {}) {
  const assetFocus = normalizeAssetDirectoryType(type);
  const itemId = String(preview.id || '').trim();
  return publicUrl(req, entryPublicPath(entry, assetFocus, itemId, { includeHash }));
}

module.exports = {
  clipText,
  slugifyForUrl,
  entrySlug,
  entryShortId,
  encodePathSegment,
  entryArticleLocator,
  decodePathSegment,
  splitArticleLocator,
  translationBlockText,
  publicUrl,
  absolutePublicUrl,
  normalizeAssetDirectoryType,
  requestAssetDirectoryType,
  requestAssetSort,
  isAssetDirectoryRequest,
  isContributorDirectoryRequest,
  contributorIdFromRequest,
  articleRouteFromRequest,
  entryForArticleRoute,
  entryByIdOrPrefix,
  articleCanonicalPathForRoute,
  normalizePathForCompare,
  requestAssetItemId,
  requestAssetFocus,
  normalizeContributorSort,
  entryAssetCount,
  aiAssetCount,
  entryDirectorySearchText,
  normalizeSearchText,
  formatShanghaiMinute,
  hasPublicAssets,
  hasPublicAssetType,
  publicAssetTypes,
  timestampIso,
  entryLastModified,
  entryAssetTypeTimestamp,
  entryAssetTypeLastModified,
  latestAssetTypeLastModified,
  assetItemLastModified,
  entryPublicPath,
  entryPublicUrl,
  assetDirectoryUrl,
  contributorPageUrl,
  assetFeedUrl,
  contributorFeedUrl,
  entryAssetItemUrl,
};
