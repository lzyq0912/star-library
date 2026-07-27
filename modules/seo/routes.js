/**
 * SEO / public page HTTP routes.
 */
const fetcher = require('../../lib/fetcher');
const {
  publicUrl,
  entryPublicUrl,
  articleRouteFromRequest,
  entryForArticleRoute,
  articleCanonicalPathForRoute,
  normalizePathForCompare,
  normalizeAssetDirectoryType,
} = require('./urls');
const {
  normalizeFaviconTarget,
  fallbackFaviconPng,
  cacheFavicon,
  sendFavicon,
  loadFavicon,
  faviconCache,
  faviconInFlight,
} = require('./favicon');
const {
  renderSitemap,
  renderAssetFeed,
  renderLlmsTxt,
} = require('./feeds');
const { renderIndex } = require('./html');

const FAVICON_MAX_INFLIGHT = require('../shared/config').FAVICON_MAX_INFLIGHT;

function registerSeoRoutes(app, { faviconRateLimit }) {
  app.get('/', (req, res) => {
    const entryId = String(req.query.entry || '').trim();
    const entry = entryId ? fetcher.getEntryById(entryId) : null;
    if (entry) return res.redirect(301, entryPublicUrl(req, entry));
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderIndex(req, entry));
  });

  app.get(/^\/articles\/.+$/, (req, res) => {
    const route = articleRouteFromRequest(req);
    const entry = entryForArticleRoute(route);
    // 深链硬刷新：即便库里暂时解析不到，也必须吐 SPA 壳，禁止纯文本 "Not found"
    // （关掉再开首页可见 = 客户端路由正常；硬刷 404 纯文本会整页挂掉）
    if (!entry) {
      res.status(404);
      res.setHeader('Cache-Control', 'no-cache');
      return res.type('html').send(renderIndex(req, null));
    }
    const canonicalPath = articleCanonicalPathForRoute(entry, route);
    if (normalizePathForCompare(req.path) !== normalizePathForCompare(canonicalPath)) {
      return res.redirect(301, publicUrl(req, canonicalPath));
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderIndex(req, entry));
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
      'User-agent: OAI-SearchBot',
      'Allow: /',
      '',
      'User-agent: ChatGPT-User',
      'Allow: /',
      '',
      'User-agent: PerplexityBot',
      'Allow: /',
      '',
      'User-agent: Claude-SearchBot',
      'Allow: /',
      '',
      'User-agent: *',
      'Allow: /',
      `Sitemap: ${publicUrl(req, '/sitemap.xml')}`,
      `LLMs: ${publicUrl(req, '/llms.txt')}`,
      '',
    ].join('\n'));
  });

  app.get('/llms.txt', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('text/plain').send(renderLlmsTxt(req));
  });

  app.get('/favicons', faviconRateLimit, async (req, res) => {
    const target = normalizeFaviconTarget(req.query.domain_url);
    const size = Math.max(16, Math.min(parseInt(req.query.sz || '64', 10) || 64, 128));
    const fallback = { buffer: fallbackFaviconPng(), type: 'image/png' };
    if (!target) {
      return sendFavicon(res, fallback);
    }
    const cacheKey = `${target}:${size}`;
    const cached = faviconCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
      cacheFavicon(cacheKey, cached);
      return sendFavicon(res, cached);
    }
    let task = faviconInFlight.get(cacheKey);
    if (!task) {
      if (faviconInFlight.size >= FAVICON_MAX_INFLIGHT) return sendFavicon(res, fallback);
      task = loadFavicon(target, size)
        .then(result => {
          const value = { ...result, at: Date.now() };
          cacheFavicon(cacheKey, value);
          return value;
        })
        .finally(() => faviconInFlight.delete(cacheKey));
      faviconInFlight.set(cacheKey, task);
    }
    try {
      return sendFavicon(res, await task);
    } catch {
      return sendFavicon(res, fallback);
    }
  });

  app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('application/xml').send(renderSitemap(req));
  });

  app.get('/assets.xml', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('application/rss+xml').send(renderAssetFeed(req));
  });

  app.get('/assets/:type.xml', (req, res) => {
    const type = normalizeAssetDirectoryType(String(req.params.type || ''));
    if (!type) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('application/rss+xml').send(renderAssetFeed(req, type));
  });

  app.get('/assets', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderIndex(req));
  });

  app.get('/assets/:type', (req, res) => {
    const type = normalizeAssetDirectoryType(String(req.params.type || ''));
    if (!type) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderIndex(req));
  });
}

module.exports = { registerSeoRoutes };
