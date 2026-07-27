/**
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
} = require('./urls');
const {
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
} = require('./meta');

function sitemapUrlXml(loc, { lastmod = '', changefreq = 'weekly', priority = '0.7' } = {}) {
  const parts = [
    `  <url>`,
    `    <loc>${escapeHtml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '',
    changefreq ? `    <changefreq>${escapeHtml(changefreq)}</changefreq>` : '',
    priority ? `    <priority>${escapeHtml(priority)}</priority>` : '',
    `  </url>`,
  ];
  return parts.filter(Boolean).join('\n');
}

function rssAlternateTag(req) {
  const contributorId = contributorIdFromRequest(req);
  if (contributorId) {
    const contributorPage = contributorPageMeta(req);
    if (contributorPage) {
      const title = `${contributorPage.contributor.displayName || '读者'} 的公开资产 RSS`;
      return `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(contributorFeedUrl(req, contributorId))}" />`;
    }
  }
  const type = isAssetDirectoryRequest(req) ? requestAssetDirectoryType(req) : '';
  const sort = isAssetDirectoryRequest(req) ? requestAssetSort(req) : 'latest';
  const meta = type ? ASSET_DIRECTORY_META[type] : null;
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const title = meta ? `QMReader ${sortPrefix}${meta.label}资产 RSS` : `QMReader ${sortPrefix}公开资产 RSS`;
  return `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(assetFeedUrl(req, type, sort))}" />`;
}

function publicExactAssetSitemapUrls(req, entry, lastmod = '') {
  const urls = [];
  for (const type of ['translation', 'rewrite']) {
    if (!hasPublicAssetType(entry, type)) continue;
    const typeLastmod = entryAssetTypeLastModified(entry, type, lastmod);
    for (const preview of store.getEntryAiAssetPreviews(entry.id, type, { limit: 500 })) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, type, preview, { includeHash: false }), {
        lastmod: assetItemLastModified(preview, typeLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'comments')) {
    const commentsLastmod = entryAssetTypeLastModified(entry, 'comments', lastmod);
    for (const comment of store.getComments(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'comments', comment, { includeHash: false }), {
        lastmod: assetItemLastModified(comment, commentsLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'annotations')) {
    const annotationsLastmod = entryAssetTypeLastModified(entry, 'annotations', lastmod);
    for (const annotation of store.getAnnotations(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'annotations', annotation, { includeHash: false }), {
        lastmod: assetItemLastModified(annotation, annotationsLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  if (hasPublicAssetType(entry, 'chat')) {
    const chatLastmod = entryAssetTypeLastModified(entry, 'chat', lastmod);
    for (const message of store.getChatMessages(entry.id)) {
      urls.push(sitemapUrlXml(entryAssetItemUrl(req, entry, 'chat', message, { includeHash: false }), {
        lastmod: assetItemLastModified(message, chatLastmod),
        changefreq: 'monthly',
        priority: '0.72',
      }));
    }
  }
  return urls;
}

function rssDate(timestamp) {
  const t = Number(timestamp) || 0;
  if (!t) return '';
  try {
    return new Date(t).toUTCString();
  } catch {
    return '';
  }
}

function publicAssetFeedItems(req, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const sort = requestAssetSort(req);
  return fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .flatMap(entry => {
      const assets = entry.assets || {};
      const previews = assets.previews || {};
      const types = assetType ? [assetType] : publicAssetTypes(entry);
      return types
        .filter(itemType => hasPublicAssetType(entry, itemType))
        .flatMap(itemType => assetFeedPreviews(entry, itemType, previews).map(preview => {
          const label = ASSET_DIRECTORY_META[itemType].label;
          const at = Number(preview.at) || Number(assets.latestAt) || Number(entry.publishedTs) || Date.now();
          const source = [preview.author, preview.model].filter(Boolean).join(' · ');
          const helpfulCount = Number(preview.helpfulCount) || 0;
          const baseDescription = preview.text
            ? assetPreviewDescription(itemType, preview)
            : clipText(`${label}：${entry.summaryZh || entry.summary || entry.titleZh || entry.title || ''}`, 220);
          const description = helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription;
          const title = assetFeedTitle(entry, itemType, preview);
          const link = entryAssetItemUrl(req, entry, itemType, preview);
          return {
            type: itemType,
            title,
            link,
            description,
            source,
            at,
            helpfulCount,
            guid: `qmreader:${entry.id}:${itemType}:${preview.id || at}`,
          };
        }));
    })
    .sort((a, b) => {
      if (sort === 'helpful') {
        const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
        if (helpfulDelta) return helpfulDelta;
      }
      return b.at - a.at;
    })
    .slice(0, 80);
}

function contributorFeedItems(req, contributorPage) {
  const translations = (contributorPage.translations || []).map(item => {
    const preview = {
      id: item.id,
      author: item.contributorName || item.author || contributorPage.contributor.displayName || '读者',
      model: item.model || '',
      text: item.contentSnippet || item.summaryZh || '',
      at: item.updatedAt || item.createdAt,
      helpfulCount: Number(item.helpfulCount) || 0,
    };
    const entry = item.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('translation', preview);
    return {
      type: 'translation',
      title: assetFeedTitle(entry, 'translation', preview),
      link: entryAssetItemUrl(req, entry, 'translation', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:translation:${item.id}`,
    };
  });
  const rewrites = (contributorPage.rewrites || []).map(item => {
    const preview = {
      id: item.id,
      author: item.contributorName || item.author || contributorPage.contributor.displayName || '读者',
      model: item.model || '',
      text: item.bodySnippet || '',
      at: item.updatedAt || item.createdAt,
      helpfulCount: Number(item.helpfulCount) || 0,
    };
    const entry = item.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('rewrite', preview);
    return {
      type: 'rewrite',
      title: assetFeedTitle(entry, 'rewrite', preview),
      link: entryAssetItemUrl(req, entry, 'rewrite', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:rewrite:${item.id}`,
    };
  });
  const comments = (contributorPage.comments || []).map(comment => {
    const preview = {
      id: comment.id,
      author: comment.contributorName || comment.author || contributorPage.contributor.displayName || '读者',
      model: comment.model || '',
      text: comment.body || comment.bodySnippet || '',
      at: comment.updatedAt || comment.createdAt,
      helpfulCount: Number(comment.helpfulCount) || 0,
    };
    const entry = comment.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('comments', preview);
    return {
      type: 'comments',
      title: assetFeedTitle(entry, 'comments', preview),
      link: entryAssetItemUrl(req, entry, 'comments', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: preview.author,
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:comments:${comment.id}`,
    };
  });
  const annotations = (contributorPage.annotations || []).map(annotation => {
    const preview = {
      id: annotation.id,
      role: annotation.surface,
      author: annotation.contributorName || annotation.author || contributorPage.contributor.displayName || '读者',
      model: '',
      text: `${annotation.quote || annotation.quoteSnippet || ''}\n${annotation.body || annotation.bodySnippet || ''}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
    };
    const entry = annotation.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('annotations', preview);
    return {
      type: 'annotations',
      title: assetFeedTitle(entry, 'annotations', preview),
      link: entryAssetItemUrl(req, entry, 'annotations', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: preview.author,
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:annotations:${annotation.id}`,
    };
  });
  const messages = (contributorPage.messages || []).map(message => {
    const preview = {
      id: message.id,
      role: message.role,
      author: message.contributorName || message.author || contributorPage.contributor.displayName || '读者',
      model: message.model || '',
      text: message.content || message.contentSnippet || '',
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    };
    const entry = message.entry || {};
    const helpfulCount = Number(preview.helpfulCount) || 0;
    const baseDescription = assetPreviewDescription('chat', preview);
    return {
      type: 'chat',
      title: assetFeedTitle(entry, 'chat', preview),
      link: entryAssetItemUrl(req, entry, 'chat', preview),
      description: helpfulCount ? `有用 ${helpfulCount} 次｜${baseDescription}` : baseDescription,
      source: [preview.author, preview.model].filter(Boolean).join(' · '),
      at: Number(preview.at) || 0,
      guid: `qmreader:contributor:${contributorPage.contributor.id}:chat:${message.id}`,
    };
  });
  return [...translations, ...rewrites, ...annotations, ...comments, ...messages]
    .filter(item => item.link && item.description)
    .sort((a, b) => b.at - a.at)
    .slice(0, 80);
}

function renderRssChannel({ title, link, description, selfUrl, items }) {
  const lastBuildDate = rssDate(items.reduce((latest, item) => Math.max(latest, Number(item.at) || 0), 0) || Date.now());
  const itemXml = items.map(item => [
    '    <item>',
    `      <title>${escapeHtml(item.title)}</title>`,
    `      <link>${escapeHtml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeHtml(item.guid)}</guid>`,
    `      <pubDate>${escapeHtml(rssDate(item.at))}</pubDate>`,
    `      <category>${escapeHtml(ASSET_DIRECTORY_META[item.type]?.label || '公开资产')}</category>`,
    item.source ? `      <dc:creator>${escapeHtml(item.source)}</dc:creator>` : '',
    `      <description>${escapeHtml(item.description)}</description>`,
    '    </item>',
  ].filter(Boolean).join('\n')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeHtml(title)}</title>`,
    `    <link>${escapeHtml(link)}</link>`,
    `    <description>${escapeHtml(description)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${escapeHtml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeHtml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    itemXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

function renderAssetFeed(req, type = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const sort = requestAssetSort(req);
  const meta = assetType ? ASSET_DIRECTORY_META[assetType] : null;
  const items = publicAssetFeedItems(req, assetType);
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const title = meta ? `${sortPrefix}${meta.label}资产 · QMReader` : `${sortPrefix}QMReader 公开资产`;
  const description = `${meta ? meta.description : DEFAULT_DESCRIPTION}${sort === 'helpful' ? ' 当前订阅按读者“有用”反馈优先排序。' : ''}`;
  const selfUrl = assetFeedUrl(req, assetType, sort);
  const directoryUrl = assetDirectoryUrl(req, assetType, sort);
  return renderRssChannel({ title, link: directoryUrl, description, selfUrl, items });
}

function renderContributorFeed(req, contributorPage) {
  const displayName = contributorPage.contributor.displayName || '读者';
  const items = contributorFeedItems(req, contributorPage);
  return renderRssChannel({
    title: `${displayName} 的公开资产 · QMReader`,
    link: contributorPageUrl(req, contributorPage.contributor.id),
    description: `${contributorPage.description} 当前订阅包含该贡献主页的公开翻译、重写、划线点评、点评和文章对话。`,
    selfUrl: contributorFeedUrl(req, contributorPage.contributor.id),
    items,
  });
}

function renderSitemap(req) {
  const entries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id)
    .sort((a, b) => {
      const assetDelta = Number(hasPublicAssets(b)) - Number(hasPublicAssets(a));
      if (assetDelta) return assetDelta;
      return Math.max(Number(b.assets?.latestAt) || 0, Number(b.publishedTs) || 0)
        - Math.max(Number(a.assets?.latestAt) || 0, Number(a.publishedTs) || 0);
    });

  const urls = [
    [
      `  <url>`,
      `    <loc>${escapeHtml(publicUrl(req, '/'))}</loc>`,
      `    <changefreq>daily</changefreq>`,
      `    <priority>1.0</priority>`,
      `  </url>`,
    ].join('\n'),
  ];

  const assetEntries = entries.filter(hasPublicAssets);
  if (assetEntries.length) {
    const latestAssetLastmod = latestAssetTypeLastModified(assetEntries);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(assetDirectoryUrl(req))}</loc>`,
      latestAssetLastmod ? `    <lastmod>${escapeHtml(latestAssetLastmod)}</lastmod>` : '',
      `    <changefreq>daily</changefreq>`,
      `    <priority>0.7</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));

    for (const type of Object.keys(ASSET_DIRECTORY_META)) {
      const typeEntries = assetEntries.filter(entry => hasPublicAssetType(entry, type));
      if (!typeEntries.length) continue;
      const typeLastmod = latestAssetTypeLastModified(typeEntries, type);
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(assetDirectoryUrl(req, type))}</loc>`,
        typeLastmod ? `    <lastmod>${escapeHtml(typeLastmod)}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.65</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
  }

  const contributors = store.getContributors({ limit: 100 });
  if (contributors.length) {
    const latestContributorAt = contributors.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(publicUrl(req, '/contributors'))}</loc>`,
      latestContributorAt ? `    <lastmod>${escapeHtml(new Date(latestContributorAt).toISOString())}</lastmod>` : '',
      `    <changefreq>daily</changefreq>`,
      `    <priority>0.7</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));
    for (const contributor of contributors) {
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(publicUrl(req, `/contributors/${encodeURIComponent(contributor.id)}`))}</loc>`,
        contributor.latestAt ? `    <lastmod>${escapeHtml(new Date(contributor.latestAt).toISOString())}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.65</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
  }

  for (const entry of assetEntries) {
    const lastmod = entryLastModified(entry);
    urls.push([
      `  <url>`,
      `    <loc>${escapeHtml(entryPublicUrl(req, entry))}</loc>`,
      lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '',
      `    <changefreq>weekly</changefreq>`,
      `    <priority>0.8</priority>`,
      `  </url>`,
    ].filter(Boolean).join('\n'));

    for (const type of publicAssetTypes(entry)) {
      const typeLastmod = entryAssetTypeLastModified(entry, type, lastmod);
      urls.push([
        `  <url>`,
        `    <loc>${escapeHtml(entryPublicUrl(req, entry, type))}</loc>`,
        typeLastmod ? `    <lastmod>${escapeHtml(typeLastmod)}</lastmod>` : '',
        `    <changefreq>weekly</changefreq>`,
        `    <priority>0.75</priority>`,
        `  </url>`,
      ].filter(Boolean).join('\n'));
    }
    urls.push(...publicExactAssetSitemapUrls(req, entry, lastmod));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

function renderLlmsTxt(req) {
  const assetEntries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .sort((a, b) => entryAssetTypeTimestamp(b) - entryAssetTypeTimestamp(a));
  const stats = assetDirectoryStats();
  const recent = assetEntries.slice(0, 12).map(entry => {
    const types = publicAssetTypes(entry).map(type => ASSET_DIRECTORY_META[type].label).join('、');
    const title = entry.titleZh || entry.title || entry.id;
    return `- ${title}\n  URL: ${entryPublicUrl(req, entry)}\n  Assets: ${types || '公开资产'}`;
  });
  return [
    '# QMReader',
    '',
    'QMReader is a public Chinese RSS reading and knowledge asset site curated around article translation, Qiaomu-style rewrites, inline text annotations, human comments, and article-context AI conversations.',
    '',
    'Primary language: zh-CN',
    `Canonical site: ${publicUrl(req, '/')}`,
    `Sitemap: ${publicUrl(req, '/sitemap.xml')}`,
    '',
    'Important public directories:',
    `- All public assets: ${assetDirectoryUrl(req)}`,
    `- Chinese translations: ${assetDirectoryUrl(req, 'translation')}`,
    `- Qiaomu-style rewrites: ${assetDirectoryUrl(req, 'rewrite')}`,
    `- Inline annotations: ${assetDirectoryUrl(req, 'annotations')}`,
    `- Human comments: ${assetDirectoryUrl(req, 'comments')}`,
    `- Article conversations: ${assetDirectoryUrl(req, 'chat')}`,
    `- Contributor leaderboard: ${publicUrl(req, '/contributors')}`,
    '',
    'RSS feeds:',
    `- All public assets: ${assetFeedUrl(req)}`,
    `- Chinese translations: ${assetFeedUrl(req, 'translation')}`,
    `- Qiaomu-style rewrites: ${assetFeedUrl(req, 'rewrite')}`,
    `- Inline annotations: ${assetFeedUrl(req, 'annotations')}`,
    `- Human comments: ${assetFeedUrl(req, 'comments')}`,
    `- Article conversations: ${assetFeedUrl(req, 'chat')}`,
    '',
    'Citation guidance:',
    '- Prefer canonical /articles/<readable-slug>--<short-id> URLs over legacy ID-first or query-parameter URLs.',
    '- Prefer pages with public assets over raw RSS-only entries.',
    '- Attribute inline annotations, human comments, translations, rewrites, and AI conversations to the displayed contributor or model metadata on the page.',
    '',
    `Current public asset count: ${stats.assetCount || 0}`,
    `Covered article count: ${stats.entryCount || assetEntries.length}`,
    '',
    'Recent public asset pages:',
    recent.length ? recent.join('\n') : '- No public asset pages are available yet.',
    '',
  ].join('\n');
}

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
