#!/usr/bin/env node
/**
 * Split modules/seo/register.js into leaf modules + barrel.
 * Run from repo root: node scripts/build-vsa-split-seo.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'modules/seo/register.js');
const src = fs.readFileSync(srcPath, 'utf8');

// Extract function body by name (function foo(...) { ... })
function extractFunction(name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${name}`);
  let i = m.index + m[0].length - 1; // at '('
  // find matching ) for params then {
  let depth = 0;
  let inParams = true;
  let startBrace = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inParams) {
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          inParams = false;
        }
      }
      continue;
    }
    if (c === '{') {
      startBrace = i;
      depth = 1;
      i++;
      break;
    }
  }
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(m.index, i + 1);
      }
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractMany(names) {
  return names.map(extractFunction).join('\n\n');
}

const FAVICON_FNS = [
  'normalizeFaviconTarget', 'fallbackFaviconPng', 'faviconCandidates',
  'fetchFaviconCandidate', 'cacheFavicon', 'sendFavicon', 'loadFavicon',
];

const URLS_FNS = [
  'clipText', 'slugifyForUrl', 'entrySlug', 'entryShortId', 'encodePathSegment',
  'entryArticleLocator', 'decodePathSegment', 'splitArticleLocator', 'translationBlockText',
  'publicUrl', 'absolutePublicUrl', 'normalizeAssetDirectoryType', 'requestAssetDirectoryType',
  'requestAssetSort', 'isAssetDirectoryRequest', 'isContributorDirectoryRequest',
  'contributorIdFromRequest', 'articleRouteFromRequest', 'entryForArticleRoute',
  'entryByIdOrPrefix', 'articleCanonicalPathForRoute', 'normalizePathForCompare',
  'requestAssetItemId', 'requestAssetFocus', 'normalizeContributorSort',
  'entryAssetCount', 'aiAssetCount', 'entryDirectorySearchText', 'normalizeSearchText',
  'formatShanghaiMinute', 'hasPublicAssets', 'hasPublicAssetType', 'publicAssetTypes',
  'timestampIso', 'entryLastModified', 'entryAssetTypeTimestamp', 'entryAssetTypeLastModified',
  'latestAssetTypeLastModified', 'assetItemLastModified',
  'entryPublicPath', 'entryPublicUrl', 'assetDirectoryUrl', 'contributorPageUrl',
  'assetFeedUrl', 'contributorFeedUrl', 'entryAssetItemUrl',
];

const META_FNS = [
  'jsonLdScript', 'assetDirectoryMeta', 'contributorDirectoryMeta', 'contributorPageMeta',
  'contributorPageMetaForId', 'assetDirectoryStats', 'socialMetaTags', 'canonicalUrlForRequest',
  'shouldNoindexRequest', 'shareStructuredData', 'contributorAssetStructuredItems',
  'contributorPageStructuredData', 'siteStructuredData', 'assetDirectoryStructuredData',
  'entryStructuredData', 'entryAssetStructuredPart', 'structuredAuthor', 'sourceNameForEntry',
  'entryShareTitle', 'assetShareTitle', 'assetShareIdentity', 'assetFeedTitle', 'assetFeedPreviews',
  'entryShareDescription', 'entryShareModifiedTime', 'assetPreviewDescription', 'exactAssetPreview',
];

const FEEDS_FNS = [
  'sitemapUrlXml', 'rssAlternateTag', 'publicExactAssetSitemapUrls', 'rssDate',
  'publicAssetFeedItems', 'contributorFeedItems', 'renderRssChannel', 'renderAssetFeed',
  'renderContributorFeed', 'renderSitemap', 'renderLlmsTxt',
];

const HTML_FNS = ['renderIndex', 'umamiConfigTag'];

const dir = path.join(root, 'modules/seo');

// favicon.js
fs.writeFileSync(path.join(dir, 'favicon.js'), `/**
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

${extractMany(FAVICON_FNS)}

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
`);

// urls.js
fs.writeFileSync(path.join(dir, 'urls.js'), `/**
 * Path / slug / canonical / entry lookup helpers (SEO leaf).
 */
const fetcher = require('../../lib/fetcher');
const {
  ARTICLE_SHORT_ID_LENGTH,
  ASSET_DIRECTORY_META,
} = require('../shared/config');

${extractMany(URLS_FNS)}

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
`);

// meta.js — imports urls symbols into local scope via destructure + re-bind for extracted bodies
const urlsNames = URLS_FNS.join(',\n  ');
fs.writeFileSync(path.join(dir, 'meta.js'), `/**
 * Social meta, directory meta, JSON-LD (depends on urls).
 */
const fetcher = require('../../lib/fetcher');
const store = require('../../lib/store');
const {
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  ASSET_DIRECTORY_META,
} = require('../shared/config');
const { escapeHtml, safeJsonForHtml } = require('../shared/http');
const {
  ${urlsNames},
} = require('./urls');

${extractMany(META_FNS)}

module.exports = {
  jsonLdScript,
  assetDirectoryMeta,
  contributorDirectoryMeta,
  contributorPageMeta,
  contributorPageMetaForId,
  assetDirectoryStats,
  socialMetaTags,
  canonicalUrlForRequest,
  shouldNoindexRequest,
  shareStructuredData,
  contributorAssetStructuredItems,
  contributorPageStructuredData,
  siteStructuredData,
  assetDirectoryStructuredData,
  entryStructuredData,
  entryAssetStructuredPart,
  structuredAuthor,
  sourceNameForEntry,
  entryShareTitle,
  assetShareTitle,
  assetShareIdentity,
  assetFeedTitle,
  assetFeedPreviews,
  entryShareDescription,
  entryShareModifiedTime,
  assetPreviewDescription,
  exactAssetPreview,
};
`);

const metaExportNames = META_FNS.join(',\n  ');
fs.writeFileSync(path.join(dir, 'feeds.js'), `/**
 * Sitemap / RSS / llms.txt renders.
 */
const fetcher = require('../../lib/fetcher');
const store = require('../../lib/store');
const {
  DEFAULT_DESCRIPTION,
  ASSET_DIRECTORY_META,
} = require('../shared/config');
const { escapeHtml } = require('../shared/http');
const {
  ${urlsNames},
} = require('./urls');
const {
  ${metaExportNames},
} = require('./meta');

${extractMany(FEEDS_FNS)}

module.exports = {
  sitemapUrlXml,
  rssAlternateTag,
  publicExactAssetSitemapUrls,
  rssDate,
  publicAssetFeedItems,
  contributorFeedItems,
  renderRssChannel,
  renderAssetFeed,
  renderContributorFeed,
  renderSitemap,
  renderLlmsTxt,
};
`);

fs.writeFileSync(path.join(dir, 'html.js'), `/**
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

${extractMany(HTML_FNS)}

module.exports = { renderIndex, umamiConfigTag };
`);

// routes: extract registerSeoRoutes body and rewrite free refs
const routesFn = extractFunction('registerSeoRoutes');
fs.writeFileSync(path.join(dir, 'routes.js'), `/**
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
const { contributorPageMetaForId } = require('./meta');
const {
  renderSitemap,
  renderAssetFeed,
  renderContributorFeed,
  renderLlmsTxt,
} = require('./feeds');
const { renderIndex } = require('./html');

const FAVICON_MAX_INFLIGHT = require('../shared/config').FAVICON_MAX_INFLIGHT;

${routesFn}

module.exports = { registerSeoRoutes };
`);

// barrel
fs.writeFileSync(path.join(dir, 'register.js'), `/**
 * SEO slice barrel — stable require path for create-app + slices.
 */
const { registerSeoRoutes } = require('./routes');
const {
  entryByIdOrPrefix,
  normalizeAssetDirectoryType,
  normalizeContributorSort,
  entryPublicUrl,
  publicUrl,
} = require('./urls');

module.exports = {
  registerSeoRoutes,
  entryByIdOrPrefix,
  normalizeAssetDirectoryType,
  normalizeContributorSort,
  entryPublicUrl,
  publicUrl,
};
`);

// syntax + load check
const files = ['favicon.js', 'urls.js', 'meta.js', 'feeds.js', 'html.js', 'routes.js', 'register.js'];
for (const f of files) {
  execSync(`node --check ${JSON.stringify(path.join(dir, f))}`, { stdio: 'pipe' });
  console.log('syntax OK', f);
}

// load with temp data dir
execSync(`QMREADER_DATA_DIR=$(mktemp -d) node -e "require('./modules/seo/register'); console.log('load OK')"` , {
  cwd: root,
  stdio: 'inherit',
  shell: '/bin/zsh',
});
console.log('SEO split complete');
