/**
 * Favicon proxy (SEO slice leaf).
 */
const fetcher = require('../../lib/fetcher');
const {
  FAVICON_MAX_BYTES,
  FAVICON_CACHE_MAX_ENTRIES,
  FAVICON_TOTAL_TIMEOUT_MS,
  FAVICON_MAX_INFLIGHT,
} = require('../shared/config');

const faviconCache = new Map();
const faviconInFlight = new Map();

function normalizeFaviconTarget(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function fallbackFaviconPng() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

function faviconCandidates(target, size) {
  const encoded = encodeURIComponent(target);
  return [
    `https://www.google.com/s2/favicons?domain_url=${encoded}&sz=${size}`,
    `${target}/favicon.ico`,
    `${target}/apple-touch-icon.png`,
    `${target}/apple-touch-icon-precomposed.png`,
  ];
}

async function fetchFaviconCandidate(url, deadline) {
  try {
    const result = await fetcher.fetchPublicBuffer(url, {
      deadline,
      maxBytes: FAVICON_MAX_BYTES,
      maxRedirects: 4,
      headers: { 'User-Agent': 'QMReader favicon proxy/1.0' },
    });
    if (result.status < 200 || result.status >= 300) return null;
    const type = fetcher.safeRasterMimeType(result.buffer);
    return type ? { buffer: result.buffer, type } : null;
  } catch {
    return null;
  }
}

function cacheFavicon(cacheKey, value) {
  faviconCache.delete(cacheKey);
  faviconCache.set(cacheKey, value);
  while (faviconCache.size > FAVICON_CACHE_MAX_ENTRIES) {
    faviconCache.delete(faviconCache.keys().next().value);
  }
}

function sendFavicon(res, value) {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.type(value.type).send(value.buffer);
}

async function loadFavicon(target, size) {
  const fallback = { buffer: fallbackFaviconPng(), type: 'image/png' };
  const deadline = Date.now() + FAVICON_TOTAL_TIMEOUT_MS;
  let safeTarget;
  try {
    safeTarget = new URL(await fetcher.assertPublicHttpUrl(target, { deadline })).origin;
  } catch {
    return fallback;
  }
  for (const url of faviconCandidates(safeTarget, size)) {
    if (Date.now() >= deadline) break;
    const result = await fetchFaviconCandidate(url, deadline);
    if (result) return result;
  }
  return fallback;
}

module.exports = {
  normalizeFaviconTarget,
  fallbackFaviconPng,
  faviconCandidates,
  fetchFaviconCandidate,
  cacheFavicon,
  sendFavicon,
  loadFavicon,
  faviconCache,
  faviconInFlight,
};
