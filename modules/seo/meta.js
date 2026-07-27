/**
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

function jsonLdScript(value) {
  if (!value) return '';
  return `<script type="application/ld+json">${safeJsonForHtml(value)}</script>`;
}

function assetDirectoryMeta(req) {
  if (!isAssetDirectoryRequest(req)) return null;
  const type = requestAssetDirectoryType(req);
  const sort = requestAssetSort(req);
  const sortPrefix = sort === 'helpful' ? '有用 · ' : '';
  const sortDescription = sort === 'helpful' ? '按读者“有用”反馈优先浏览。' : '';
  const q = clipText(String(req.query.q || '').trim(), 48);
  const stats = assetDirectoryStats(type, q);
  const searchSuffix = stats.summary || '';
  const latestSuffix = stats.latestText || '';
  if (!type) {
    if (q) {
      return {
        title: `${sortPrefix}公开资产搜索：${q} · QMReader`,
        description: `搜索“${q}”相关的公开资产，包含中文翻译、乔木风格重写、划线点评、人工点评和文章对话。${sortDescription}${searchSuffix}`,
      };
    }
    return {
      title: stats.assetCount ? `${sortPrefix}公开资产（${stats.assetCount} 条） · QMReader` : `${sortPrefix}公开资产 · QMReader`,
      description: stats.assetCount
        ? `QMReader 已沉淀 ${stats.assetCount} 条公开资产，覆盖 ${stats.entryCount} 篇文章，包括中文翻译、乔木风格重写、划线点评、人工点评和文章对话。${sortDescription}${latestSuffix}`
        : DEFAULT_DESCRIPTION,
    };
  }
  const meta = ASSET_DIRECTORY_META[type];
  if (q) {
    return {
      title: `${sortPrefix}${meta.label}资产搜索：${q} · QMReader`,
      description: `搜索“${q}”相关的${meta.label}资产。${sortDescription}${searchSuffix}`,
    };
  }
  return {
    title: stats.assetCount ? `${sortPrefix}${meta.label}资产（${stats.assetCount} 条） · QMReader` : `${sortPrefix}${meta.label}资产 · QMReader`,
    description: stats.assetCount
      ? `QMReader 已沉淀 ${stats.assetCount} 条${meta.label}资产，覆盖 ${stats.entryCount} 篇文章，可通过网页或 RSS 浏览。${sortDescription}${latestSuffix}`
      : meta.description,
  };
}

function contributorDirectoryMeta(req = null) {
  const sort = normalizeContributorSort(req && req.query && req.query.sort);
  const contributors = store.getContributors({ limit: 200, sort });
  const totalAssets = contributors.reduce((sum, contributor) => sum + Number(contributor.assetCount || 0), 0);
  const totalHelpful = contributors.reduce((sum, contributor) => sum + Number(contributor.helpfulCount || 0), 0);
  const latestAt = contributors.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
  const helpfulSuffix = totalHelpful ? `获得 ${totalHelpful} 次有用反馈。` : '';
  const sortTitle = sort === 'helpful' ? '有用贡献榜' : sort === 'assets' ? '高产贡献榜' : '公开贡献榜';
  const sortDescription = sort === 'helpful'
    ? '当前按读者有用反馈排序。'
    : sort === 'assets'
    ? '当前按公开资产数量排序。'
    : '';
  return {
    contributors,
    title: contributors.length ? `${sortTitle}（${contributors.length} 人） · QMReader` : `${sortTitle} · QMReader`,
    description: contributors.length
      ? `QMReader 有 ${contributors.length} 位用户沉淀了 ${totalAssets} 条公开翻译、重写、划线点评、点评和文章对话。${helpfulSuffix}${sortDescription}${latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : ''}`
      : '浏览在 QMReader 沉淀过公开翻译、重写、划线点评、点评和文章对话的贡献榜。',
    latestAt,
  };
}

function contributorPageMeta(req) {
  return contributorPageMetaForId(contributorIdFromRequest(req), {
    type: normalizeAssetDirectoryType(String(req.query.type || req.query.asset || '')),
    sort: String(req.query.sort || '') === 'helpful' ? 'helpful' : 'latest',
  });
}

function contributorPageMetaForId(id, { type = '', sort = 'latest' } = {}) {
  if (!id) return null;
  const assetType = normalizeAssetDirectoryType(type);
  const assetSort = sort === 'helpful' ? 'helpful' : 'latest';
  const contributor = store.getContributor(id);
  if (!contributor) return null;
  const translations = store.getUserTranslations(id, { limit: 200 });
  const rewrites = store.getUserRewrites(id, { limit: 200 });
  const comments = store.getUserComments(id, { limit: 200 });
  const annotations = store.getUserAnnotations(id, { limit: 200 });
  const messages = store.getUserChatMessages(id, { limit: 200 });
  const translationCount = translations.length;
  const rewriteCount = rewrites.length;
  const commentCount = comments.length;
  const annotationCount = annotations.length;
  const chatCount = messages.length;
  const assetCount = translationCount + rewriteCount + annotationCount + commentCount + chatCount;
  const typeCounts = { translation: translationCount, rewrite: rewriteCount, annotations: annotationCount, comments: commentCount, chat: chatCount };
  const visibleAssetCount = assetType ? typeCounts[assetType] || 0 : assetCount;
  const latestAt = Math.max(
    translations.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0),
    rewrites.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0),
    annotations.reduce((latest, annotation) => Math.max(latest, Number(annotation.updatedAt || annotation.createdAt) || 0), 0),
    comments.reduce((latest, comment) => Math.max(latest, Number(comment.updatedAt || comment.createdAt) || 0), 0),
    messages.reduce((latest, message) => Math.max(latest, Number(message.createdAt) || 0), 0),
  );
  const typeLatestAt = assetType === 'translation'
    ? translations.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0)
    : assetType === 'rewrite'
    ? rewrites.reduce((latest, item) => Math.max(latest, Number(item.updatedAt || item.createdAt) || 0), 0)
    : assetType === 'annotations'
    ? annotations.reduce((latest, annotation) => Math.max(latest, Number(annotation.updatedAt || annotation.createdAt) || 0), 0)
    : assetType === 'comments'
    ? comments.reduce((latest, comment) => Math.max(latest, Number(comment.updatedAt || comment.createdAt) || 0), 0)
    : assetType === 'chat'
    ? messages.reduce((latest, message) => Math.max(latest, Number(message.createdAt) || 0), 0)
    : latestAt;
  const displayName = clipText(contributor.displayName || '读者', 48);
  const typeMeta = assetType ? ASSET_DIRECTORY_META[assetType] : null;
  const sortPrefix = assetSort === 'helpful' ? '有用 · ' : '';
  const helpfulSentence = Number(contributor.helpfulCount || 0)
    ? `获得 ${Number(contributor.helpfulCount || 0)} 次有用反馈。`
    : '';
  const sortSentence = assetSort === 'helpful' ? '当前按读者有用反馈优先浏览。' : '';
  const title = typeMeta
    ? `${sortPrefix}${displayName} 的${typeMeta.label}（${visibleAssetCount} 条） · QMReader`
    : `${sortPrefix}${displayName} 的公开资产（${assetCount} 条） · QMReader`;
  const description = typeMeta
    ? `${displayName} 在 QMReader 沉淀了 ${visibleAssetCount} 条${typeMeta.label}资产。${helpfulSentence}${sortSentence}${typeLatestAt ? `最新更新 ${formatShanghaiMinute(typeLatestAt)}。` : ''}`
    : assetCount
      ? `${displayName} 在 QMReader 沉淀了 ${assetCount} 条公开资产，包括 ${translationCount} 条中文翻译、${rewriteCount} 条乔木风格重写、${annotationCount} 条划线点评、${commentCount} 条人工点评和 ${chatCount} 条文章对话。${helpfulSentence}${sortSentence}${latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : ''}`
      : `${displayName} 的 QMReader 个人主页。`;
  return {
    contributor: { ...contributor, displayName },
    translations,
    rewrites,
    annotations,
    comments,
    messages,
    translationCount,
    rewriteCount,
    annotationCount,
    commentCount,
    chatCount,
    assetCount,
    visibleAssetCount,
    assetType,
    assetSort,
    latestAt: typeLatestAt || latestAt,
    title,
    description,
  };
}

function assetDirectoryStats(type = '', q = '') {
  const assetType = normalizeAssetDirectoryType(type);
  const query = normalizeSearchText(q);
  const entries = fetcher.getEntries({ limit: 1000 })
    .filter(entry => entry && entry.id && hasPublicAssets(entry))
    .filter(entry => !assetType || hasPublicAssetType(entry, assetType))
    .filter(entry => !query || normalizeSearchText(entryDirectorySearchText(entry)).includes(query));
  let assetCount = 0;
  let latestAt = 0;
  for (const entry of entries) {
    assetCount += entryAssetCount(entry, assetType);
    latestAt = Math.max(latestAt, entryAssetTypeTimestamp(entry, assetType));
  }
  const latestText = latestAt ? `最新更新 ${formatShanghaiMinute(latestAt)}。` : '';
  const summary = assetCount ? `${assetCount} 条 · ${entries.length} 篇文章。${latestText}` : '';
  return {
    assetCount,
    entryCount: entries.length,
    latestAt,
    latestText,
    summary,
    entries,
  };
}

function socialMetaTags(req, entry) {
  const directoryMeta = entry ? null : assetDirectoryMeta(req);
  const contributorPage = !entry && !directoryMeta ? contributorPageMeta(req) : null;
  const contributorMeta = !entry && !directoryMeta && !contributorPage && isContributorDirectoryRequest(req) ? contributorDirectoryMeta(req) : null;
  const focus = entry ? requestAssetFocus(req) : '';
  const title = entry
    ? entryShareTitle(entry, focus, req)
    : (directoryMeta?.title || contributorPage?.title || contributorMeta?.title || DEFAULT_TITLE);
  const description = entry
    ? entryShareDescription(entry, focus, req)
    : clipText(directoryMeta?.description || contributorPage?.description || contributorMeta?.description || DEFAULT_DESCRIPTION);
  const modifiedTime = entry
    ? entryShareModifiedTime(entry, focus, req)
    : timestampIso(directoryMeta?.latestAt || contributorPage?.latestAt || contributorMeta?.latestAt);
  const url = canonicalUrlForRequest(req, entry, focus);
  const image = entry ? absolutePublicUrl(req, entry.image) : '';
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    shouldNoindexRequest(req, entry) ? `<meta name="robots" content="noindex,follow" />` : '',
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="QMReader" />`,
    `<meta property="og:type" content="${entry ? 'article' : contributorPage ? 'profile' : 'website'}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ].filter(Boolean);
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}" />`);
  }
  if (entry && entry.published) {
    tags.push(`<meta property="article:published_time" content="${escapeHtml(entry.published)}" />`);
  }
  if (modifiedTime) {
    if (entry) tags.push(`<meta property="article:modified_time" content="${escapeHtml(modifiedTime)}" />`);
    tags.push(`<meta property="og:updated_time" content="${escapeHtml(modifiedTime)}" />`);
  }
  const structuredData = shareStructuredData(req, {
    entry,
    focus,
    directoryMeta,
    contributorPage,
    title,
    description,
    modifiedTime,
    image,
    url,
  });
  if (structuredData) tags.push(jsonLdScript(structuredData));
  return { title, tags: tags.join('\n  ') };
}

function canonicalUrlForRequest(req, entry, focus = '') {
  if (entry) {
    const assetFocus = normalizeAssetDirectoryType(focus);
    const itemId = requestAssetItemId(req, assetFocus);
    if (assetFocus && itemId) {
      return entryAssetItemUrl(req, entry, assetFocus, { id: itemId }, { includeHash: false });
    }
    return entryPublicUrl(req, entry, assetFocus);
  }
  if (isAssetDirectoryRequest(req)) return assetDirectoryUrl(req, requestAssetDirectoryType(req), requestAssetSort(req));
  const contributorId = contributorIdFromRequest(req);
  if (contributorId) return contributorPageUrl(req, contributorId);
  if (isContributorDirectoryRequest(req)) {
    const sort = normalizeContributorSort(req && req.query && req.query.sort);
    const query = sort === 'latest' ? '' : `?sort=${encodeURIComponent(sort)}`;
    return publicUrl(req, `/contributors${query}`);
  }
  return publicUrl(req, '/');
}

function shouldNoindexRequest(req, entry) {
  if (String(req.query.q || '').trim()) return true;
  if (entry && !hasPublicAssets(entry)) return true;
  return false;
}

function shareStructuredData(req, { entry, focus, directoryMeta, contributorPage, title, description, modifiedTime, image, url }) {
  if (entry) return entryStructuredData(req, entry, { focus, title, description, modifiedTime, image, url });
  if (directoryMeta) return assetDirectoryStructuredData(req, directoryMeta, { title, description, url });
  if (contributorPage) return contributorPageStructuredData(req, contributorPage, { title, description, url });
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'QMReader',
    url,
    description,
  };
}

function contributorAssetStructuredItems(req, contributorPage) {
  const translationItems = (contributorPage.translations || []).map(item => ({
    type: 'translation',
    id: item.id,
    text: item.contentSnippet || item.summaryZh || '',
    at: item.updatedAt || item.createdAt,
    helpfulCount: Number(item.helpfulCount) || 0,
    entry: item.entry,
  }));
  const rewriteItems = (contributorPage.rewrites || []).map(item => ({
    type: 'rewrite',
    id: item.id,
    text: item.bodySnippet || '',
    at: item.updatedAt || item.createdAt,
    helpfulCount: Number(item.helpfulCount) || 0,
    entry: item.entry,
  }));
  const commentItems = (contributorPage.comments || []).map(comment => ({
    type: 'comments',
    id: comment.id,
    text: comment.bodySnippet || comment.body || '',
    at: comment.updatedAt || comment.createdAt,
    helpfulCount: Number(comment.helpfulCount) || 0,
    entry: comment.entry,
  }));
  const annotationItems = (contributorPage.annotations || []).map(annotation => ({
    type: 'annotations',
    id: annotation.id,
    text: `${annotation.quote || annotation.quoteSnippet || ''}\n${annotation.bodySnippet || annotation.body || ''}`,
    at: annotation.updatedAt || annotation.createdAt,
    helpfulCount: Number(annotation.helpfulCount) || 0,
    entry: annotation.entry,
  }));
  const chatItems = (contributorPage.messages || []).map(message => ({
    type: 'chat',
    id: message.id,
    text: message.contentSnippet || message.content || '',
    at: message.createdAt,
    helpfulCount: Number(message.helpfulCount) || 0,
    entry: message.entry,
  }));
  return [...translationItems, ...rewriteItems, ...annotationItems, ...commentItems, ...chatItems]
    .filter(item => item.entry && item.entry.id)
    .filter(item => !contributorPage.assetType || item.type === contributorPage.assetType)
    .sort((a, b) => {
      if (contributorPage.assetSort === 'helpful') {
        const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
        if (helpfulDelta) return helpfulDelta;
      }
      return (Number(b.at) || 0) - (Number(a.at) || 0);
    })
    .slice(0, 10)
    .map((item, index) => {
      const label = ASSET_DIRECTORY_META[item.type]?.label || (item.type === 'chat' ? '文章对话' : '人工点评');
      return {
        '@type': 'ListItem',
        position: index + 1,
        url: entryAssetItemUrl(req, { id: item.entry.id }, item.type, item, { includeHash: false }),
        name: `${label}：${clipText(item.entry.titleZh || item.entry.title || '文章', 90)}`,
        description: clipText(item.text, 180),
        dateModified: timestampIso(item.at) || undefined,
      };
    });
}

function contributorPageStructuredData(req, contributorPage, { title, description, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: title.replace(/\s·\sQMReader$/, ''),
    description,
    url,
    isPartOf: siteStructuredData(req),
    dateModified: timestampIso(contributorPage.latestAt) || undefined,
    mainEntity: {
      '@type': 'Person',
      name: contributorPage.contributor.displayName || '读者',
      identifier: contributorPage.contributor.id,
      url,
    },
    hasPart: {
      '@type': 'ItemList',
      name: contributorPage.assetType ? `${ASSET_DIRECTORY_META[contributorPage.assetType].label}资产` : '公开资产',
      numberOfItems: typeof contributorPage.visibleAssetCount === 'number'
        ? contributorPage.visibleAssetCount
        : contributorPage.assetCount || 0,
      itemListElement: contributorAssetStructuredItems(req, contributorPage),
    },
  };
}

function siteStructuredData(req) {
  return {
    '@type': 'WebSite',
    name: 'QMReader',
    url: publicUrl(req, '/'),
  };
}

function assetDirectoryStructuredData(req, directoryMeta, { title, description, url }) {
  const type = requestAssetDirectoryType(req);
  const stats = directoryMeta.stats || assetDirectoryStats(type, String(req.query.q || '').trim());
  const label = type ? `${ASSET_DIRECTORY_META[type].label}资产` : '公开资产';
  const items = (stats.entries || [])
    .flatMap(entry => {
      const assets = entry.assets || {};
      const previews = assets.previews || {};
      const types = type ? [type] : publicAssetTypes(entry);
      return types
        .filter(itemType => hasPublicAssetType(entry, itemType))
        .flatMap(itemType => assetFeedPreviews(entry, itemType, previews).map(preview => ({
          entry,
          type: itemType,
          preview,
          at: Number(preview.at) || entryAssetTypeTimestamp(entry, itemType),
        })));
    })
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 10);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title.replace(/\s·\sQMReader$/, ''),
    description,
    url,
    isPartOf: siteStructuredData(req),
    dateModified: timestampIso(stats.latestAt) || undefined,
    mainEntity: {
      '@type': 'ItemList',
      name: label,
      numberOfItems: stats.assetCount || 0,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: entryAssetItemUrl(req, item.entry, item.type, item.preview, { includeHash: false }),
        name: assetFeedTitle(item.entry, item.type, item.preview),
        description: clipText(item.preview && item.preview.text, 180),
        dateModified: timestampIso(item.at) || entryAssetTypeLastModified(item.entry, item.type) || entryLastModified(item.entry) || undefined,
      })),
    },
  };
}

function entryStructuredData(req, entry, { focus, title, description, modifiedTime, image, url }) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clipText(entry.titleZh || entry.title || title, 120),
    alternativeHeadline: entry.titleZh && entry.title ? clipText(entry.title, 120) : undefined,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: entry.published || undefined,
    dateModified: modifiedTime || entryLastModified(entry) || entry.published || undefined,
    image: image || undefined,
    author: structuredAuthor(entry.author || sourceNameForEntry(entry) || 'QMReader'),
    publisher: {
      '@type': 'Organization',
      name: 'QMReader',
      url: publicUrl(req, '/'),
    },
    inLanguage: entry.titleZh || entry.summaryZh ? 'zh-CN' : undefined,
  };
  const part = entryAssetStructuredPart(req, entry, focus);
  if (part) article.hasPart = part;
  return article;
}

function entryAssetStructuredPart(req, entry, focus) {
  const type = normalizeAssetDirectoryType(focus);
  if (!type) return null;
  const exactPreview = exactAssetPreview(entry, type, req);
  const preview = exactPreview || entry.assets?.previews?.[type];
  if (!preview || !preview.text) return null;
  const itemUrl = entryAssetItemUrl(req, entry, type, preview);
  const itemIdUrl = entryAssetItemUrl(req, entry, type, preview, { includeHash: false });
  const base = {
    '@id': `${itemIdUrl}#structured`,
    name: assetShareIdentity(type, preview) || ASSET_DIRECTORY_META[type]?.label || '公开资产',
    text: clipText(preview.text, 500),
    url: itemUrl,
    dateCreated: timestampIso(preview.at) || undefined,
    dateModified: timestampIso(preview.at) || undefined,
    author: structuredAuthor(preview.author || preview.model || 'QMReader'),
    isPartOf: entryPublicUrl(req, entry),
  };
  if (type === 'comments' || type === 'annotations') return { '@type': 'Comment', ...base };
  if (type === 'chat') {
    const schemaType = preview.role === 'user' ? 'Question' : preview.role === 'assistant' ? 'Answer' : 'CreativeWork';
    return { '@type': schemaType, ...base };
  }
  return {
    '@type': 'CreativeWork',
    ...base,
    about: ASSET_DIRECTORY_META[type]?.label || '公开资产',
  };
}

function structuredAuthor(name) {
  const text = clipText(name || 'QMReader', 80);
  const isOrg = /ai|deepseek|openai|anthropic|claude|gemini|gpt|qmreader/i.test(text);
  return {
    '@type': isOrg ? 'Organization' : 'Person',
    name: text,
  };
}

function sourceNameForEntry(entry) {
  const source = fetcher.getSourceById(entry && entry.sourceId);
  return source ? source.name : '';
}

function entryShareTitle(entry, focus = '', req = null) {
  return assetShareTitle(entry, focus, exactAssetPreview(entry, focus, req));
}

function assetShareTitle(entry, focus = '', preview = null) {
  const snapshotTitle = (focus === 'translation' || focus === 'rewrite') && preview && preview.title
    ? preview.title
    : '';
  const articleTitle = clipText(snapshotTitle || entry.titleZh || entry.title || '文章', 72);
  const label = ASSET_DIRECTORY_META[focus]?.label || '';
  if (!label) return `${articleTitle} · QMReader`;
  const identity = assetShareIdentity(focus, preview);
  return `${identity || label} · ${articleTitle} · QMReader`;
}

function assetShareIdentity(focus = '', preview = null) {
  if (!preview) return '';
  const author = clipText(preview.author || preview.model || '', 24);
  if (focus === 'translation') return author ? `${author}的中文翻译` : '中文翻译';
  if (focus === 'rewrite') return author ? `${author}的乔木重写` : '乔木风格重写';
  if (focus === 'annotations') return author ? `${author}的划线点评` : '划线点评';
  if (focus === 'comments') return author ? `${author}的点评` : '人工点评';
  if (focus === 'chat') {
    const roleLabel = preview.role === 'user' ? '提问' : '回答';
    const speaker = author || (preview.role === 'user' ? '读者' : 'AI');
    return `${speaker}的${roleLabel}`;
  }
  return '';
}

function assetFeedTitle(entry, type, preview = null) {
  return assetShareTitle(entry, type, preview)
    .replace(/\s·\sQMReader$/, '')
    .replace(/\s·\s/, '：');
}

function assetFeedPreviews(entry, type, previews = {}) {
  if (type === 'translation' || type === 'rewrite') {
    const items = store.getEntryAiAssetPreviews(entry.id, type, { limit: 500 });
    if (items.length) return items;
    const preview = previews[type] || {};
    return preview && preview.text ? [preview] : [];
  }
  if (type === 'comments') {
    return store.getComments(entry.id).map(comment => ({
      type: 'comments',
      id: comment.id,
      author: comment.author,
      model: comment.model || '',
      text: comment.body,
      at: comment.updatedAt || comment.createdAt,
      helpfulCount: Number(comment.helpfulCount) || 0,
    }));
  }
  if (type === 'annotations') {
    return store.getAnnotations(entry.id).map(annotation => ({
      type: 'annotations',
      id: annotation.id,
      role: annotation.surface,
      author: annotation.author,
      model: '',
      text: `${annotation.quote}\n${annotation.body}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
      replyCount: Number(annotation.replyCount) || 0,
    }));
  }
  if (type === 'chat') {
    return store.getChatMessages(entry.id).map(message => ({
      type: 'chat',
      id: message.id,
      role: message.role,
      author: message.author,
      model: message.model || '',
      text: message.content,
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    }));
  }
  return [previews[type] || {}].filter(preview => preview && preview.text);
}

function entryShareDescription(entry, focus = '', req = null) {
  const exactPreview = exactAssetPreview(entry, focus, req);
  if (exactPreview && exactPreview.text) return assetPreviewDescription(focus, exactPreview);
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const preview = focus && previews[focus] ? previews[focus] : null;
  if (preview && preview.text) return assetPreviewDescription(focus, preview);
  return clipText(entry.summaryZh || entry.summary || DEFAULT_DESCRIPTION);
}

function entryShareModifiedTime(entry, focus = '', req = null) {
  const exactPreview = exactAssetPreview(entry, focus, req);
  if (exactPreview && exactPreview.at) return timestampIso(exactPreview.at);
  const focusedAt = focus ? entryAssetTypeTimestamp(entry, focus) : 0;
  return timestampIso(focusedAt || entryAssetTypeTimestamp(entry));
}

function assetPreviewDescription(focus, preview) {
  const label = ASSET_DIRECTORY_META[focus]?.label || '公开资产';
  const source = [preview.author, preview.model].filter(Boolean).join(' · ');
  const prefix = source ? `${label}（${source}）` : label;
  return clipText(`${prefix}：${preview.text}`, 220);
}

function exactAssetPreview(entry, focus, req) {
  if (!entry || !req) return null;
  if (focus === 'translation' || focus === 'rewrite') {
    const asset = store.getAiAssetContribution(requestAssetItemId(req, focus), focus);
    if (!asset || asset.entryId !== entry.id) return null;
    return {
      type: focus,
      id: asset.id,
      author: asset.contributorName || asset.author || asset.createdBy || '',
      title: focus === 'translation' ? asset.titleZh || '' : asset.title || '',
      model: asset.model || '',
      text: focus === 'translation'
        ? clipText((asset.content || []).map(translationBlockText).find(Boolean) || asset.summaryZh || '', 220)
        : asset.body,
      at: asset.updatedAt || asset.createdAt,
      helpfulCount: Number(store.getEntryAssetReaction(entry.id, focus, null, asset.id).helpfulCount) || 0,
    };
  }
  if (focus === 'comments') {
    const comment = store.getComment(entry.id, requestAssetItemId(req, focus));
    if (!comment) return null;
    return {
      type: 'comments',
      id: comment.id,
      author: comment.author,
      model: comment.model || '',
      text: comment.body,
      at: comment.updatedAt || comment.createdAt,
    };
  }
  if (focus === 'annotations') {
    const annotation = store.getAnnotation(entry.id, requestAssetItemId(req, focus));
    if (!annotation) return null;
    return {
      type: 'annotations',
      id: annotation.id,
      role: annotation.surface,
      author: annotation.author,
      model: '',
      text: `${annotation.quote}\n${annotation.body}`,
      at: annotation.updatedAt || annotation.createdAt,
      helpfulCount: Number(annotation.helpfulCount) || 0,
      replyCount: Number(annotation.replyCount) || 0,
    };
  }
  if (focus === 'chat') {
    const message = store.getChatMessage(entry.id, requestAssetItemId(req, focus));
    if (!message) return null;
    return {
      type: 'chat',
      id: message.id,
      role: message.role,
      author: message.author,
      model: message.model || '',
      text: message.content,
      at: message.createdAt,
      helpfulCount: Number(message.helpfulCount) || 0,
    };
  }
  return null;
}

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
