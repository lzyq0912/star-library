/**
 * SPA HTML shell injection (renderIndex).
 */
const fs = require('fs');
const {
  INDEX_PATH,
  DOMPURIFY_VERSION,
  UMAMI_WEBSITE_ID,
  UMAMI_SRC,
  ASSET_DIRECTORY_META,
} = require('../shared/config');
const { escapeHtml } = require('../shared/http');
const {
  publicUrl,
  isAssetDirectoryRequest,
  requestAssetDirectoryType,
  isContributorDirectoryRequest,
  contributorIdFromRequest,
  assetFeedUrl,
  contributorFeedUrl,
} = require('./urls');
const {
  socialMetaTags,
  contributorPageMeta,
  assetDirectoryMeta,
} = require('./meta');
const { rssAlternateTag } = require('./feeds');

function renderIndex(req, entry = null) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { title, tags } = socialMetaTags(req, entry);
  const umami = umamiConfigTag(req);
  return html
    .replace(/src="\/purify\.min\.js\?v=[^"]+"/, `src="/purify.min.js?v=${escapeHtml(DOMPURIFY_VERSION)}"`)
    .replace(/<link rel="alternate" type="application\/rss\+xml" title="[^"]*" href="[^"]*" \/>/, rssAlternateTag(req))
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `  ${tags}${umami ? `\n  ${umami}` : ''}\n</head>`);
}

function umamiConfigTag(req) {
  if (!UMAMI_WEBSITE_ID || !UMAMI_SRC) return '';
  if (!/^[0-9a-f-]{36}$/i.test(UMAMI_WEBSITE_ID)) return '';
  let src;
  try {
    src = new URL(UMAMI_SRC).toString();
  } catch {
    return '';
  }
  if (!/^https:\/\//i.test(src)) return '';
  let domain = 'rss.qiaomu.ai';
  try { domain = new URL(publicUrl(req, '/')).hostname || domain; } catch { /* use production default */ }
  return `<meta name="qmreader-analytics" data-src="${escapeHtml(src)}" data-website-id="${escapeHtml(UMAMI_WEBSITE_ID)}" data-domains="${escapeHtml(domain)}" />`;
}

module.exports = { renderIndex, umamiConfigTag };
