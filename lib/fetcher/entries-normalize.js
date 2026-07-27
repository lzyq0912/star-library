'use strict';

/**
 * 条目规范化与装饰（RSS item→entry、paper/repo 装饰、瘦条目判定、去重、hydrate 边界）。
 *
 * **Agent 改 RSS item→entry 映射时改此文件**（`normalizeItem` / `decorateEntry` / paper 卡片等）。
 *
 * 无 cache/state 读写（除 hydrate 经 deps.store 可选回写）。禁止 `require('../fetcher')`。
 *
 * @module lib/fetcher/entries-normalize
 */

const crypto = require('crypto');

const THIN_ORIGINAL_HYDRATE_LIMIT = Math.max(
  1,
  Math.min(12, parseInt(process.env.THIN_ORIGINAL_HYDRATE_LIMIT || '6', 10) || 6),
);
const THIN_ORIGINAL_HYDRATE_CONCURRENCY = Math.max(
  1,
  Math.min(4, parseInt(process.env.THIN_ORIGINAL_HYDRATE_CONCURRENCY || '2', 10) || 2),
);

/**
 * @param {object} deps
 * @param {function} deps.stripHtml
 * @param {function} deps.escapeHtmlForHtml
 * @param {function} [deps.normalizeFeedContent]
 * @param {function} [deps.absoluteUrl]
 * @param {function} [deps.firstImage]
 * @param {function} [deps.hostnameOf]
 * @param {function} [deps.isTrackingPixelUrl]
 * @param {function} deps.getSourceById
 * @param {function} [deps.isHackerNewsSource]
 * @param {function} [deps.hackerNewsItemIdFromFeedItem]
 * @param {function} [deps.hackerNewsArticleUrlFromItem]
 * @param {object} [deps.store]
 * @param {string} [deps.GITHUB_PROJECTS_SOURCE_ID]
 * @param {string} [deps.HUGGINGFACE_SOURCE_ID]
 * @param {function} [deps.fetchHtmlWithManualRedirects] hydrate 边界
 * @param {function} [deps.extractReadableContent]
 * @param {function} [deps.pickArticleCoverImage]
 * @param {function} [deps.isGenericCoverImage]
 * @param {function} [deps.contentHasRealImage]
 * @param {function} [deps.localizeEntryImages]
 * @param {function} [deps.publicHttpUrl]
 * @param {function} [deps.fetchText]
 * @param {function} [deps.isPaulGrahamUrl]
 */
function createEntriesNormalize(deps = {}) {
  const {
    stripHtml,
    escapeHtmlForHtml,
    normalizeFeedContent = (html) => html || '',
    absoluteUrl = (url) => url || null,
    firstImage = () => null,
    hostnameOf = () => '',
    isTrackingPixelUrl = () => false,
    getSourceById = () => null,
    isHackerNewsSource = () => false,
    hackerNewsItemIdFromFeedItem = () => '',
    hackerNewsArticleUrlFromItem = () => '',
    store = null,
    GITHUB_PROJECTS_SOURCE_ID = 'github-projects',
    HUGGINGFACE_SOURCE_ID = 'huggingface',
    fetchHtmlWithManualRedirects = null,
    extractReadableContent = null,
    pickArticleCoverImage = (content, image) => image || null,
    isGenericCoverImage = () => false,
    contentHasRealImage = () => false,
    localizeEntryImages = null,
    publicHttpUrl = (url) => url,
    fetchText = null,
    isPaulGrahamUrl = () => false,
  } = deps;

  if (typeof stripHtml !== 'function' || typeof escapeHtmlForHtml !== 'function') {
    throw new Error('createEntriesNormalize: stripHtml and escapeHtmlForHtml are required');
  }

  function isProductHuntUrl(value) {
    const host = hostnameOf(value);
    return host === 'producthunt.com';
  }

  function isProductHuntRedirectUrl(value) {
    try {
      const url = new URL(value);
      return isProductHuntUrl(url.toString()) && /^\/r\/p\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function arxivIdFromUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'arxiv.org') return '';
      const match = url.pathname.match(/^\/(?:abs|pdf|html)\/([^/?#]+?)(?:\.pdf)?$/i);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  function sourceContentKind(sourceId) {
    const source = getSourceById(sourceId);
    return source && source.contentKind ? source.contentKind : '';
  }

  function isRepoManualSource(sourceOrId) {
    if (!sourceOrId) return false;
    if (typeof sourceOrId === 'string') {
      return sourceOrId === GITHUB_PROJECTS_SOURCE_ID || sourceContentKind(sourceOrId) === 'repo';
    }
    return Boolean(
      sourceOrId.manual
      && (sourceOrId.id === GITHUB_PROJECTS_SOURCE_ID || sourceOrId.contentKind === 'repo'),
    );
  }

  function isRepoSourceEntry(entry) {
    return Boolean(entry && isRepoManualSource(entry.sourceId));
  }

  function isPaperSourceEntry(entry) {
    return Boolean(
      entry
      && (entry.sourceId === HUGGINGFACE_SOURCE_ID || sourceContentKind(entry.sourceId) === 'paper'),
    );
  }

  function normalizePaperAbstract(entry) {
    const content = String(entry && entry.content || '');
    const text = stripHtml(content || (entry && entry.summary) || '').replace(/\s+/g, ' ').trim();
    if (!/class=["']paper-brief["']/i.test(content)) return text;
    const match = text.match(/摘要\s+([\s\S]+)/);
    const fromCard = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    if (fromCard && !/^论文信息\b/.test(fromCard)) return fromCard;
    return stripHtml(entry && entry.summary || '').replace(/\s+/g, ' ').trim();
  }

  function formatDateForPaper(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(time));
    } catch {
      return '';
    }
  }

  function linkHtml(url, label) {
    if (!url) return '';
    return `<a href="${escapeHtmlForHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtmlForHtml(label)}</a>`;
  }

  function paperLinksHtml(entry, arxivId) {
    const links = [];
    if (entry && entry.link) links.push(linkHtml(entry.link, 'arXiv'));
    if (arxivId) {
      links.push(linkHtml(`https://arxiv.org/pdf/${arxivId}.pdf`, 'PDF'));
      links.push(linkHtml(`https://huggingface.co/papers/${arxivId}`, 'Hugging Face'));
    }
    return links.filter(Boolean).join(' · ');
  }

  function paperEntryContent(entry) {
    if (!isPaperSourceEntry(entry)) return entry && entry.content || '';
    const abstract = normalizePaperAbstract(entry);
    const arxivId = arxivIdFromUrl(entry && entry.link);
    const links = paperLinksHtml(entry, arxivId);
    const rows = [
      arxivId ? `<li><strong>arXiv ID</strong><span>${escapeHtmlForHtml(arxivId)}</span></li>` : '',
      entry && entry.author ? `<li><strong>作者</strong><span>${escapeHtmlForHtml(entry.author)}</span></li>` : '',
      entry && entry.published
        ? `<li><strong>发布</strong><span>${escapeHtmlForHtml(formatDateForPaper(entry.published) || entry.published)}</span></li>`
        : '',
      links ? `<li><strong>链接</strong><span>${links}</span></li>` : '',
    ].filter(Boolean).join('');
    return [
      '<article class="paper-brief">',
      '<h2>论文信息</h2>',
      rows ? `<ul class="paper-meta-list">${rows}</ul>` : '',
      '<h2>摘要</h2>',
      abstract ? `<p>${escapeHtmlForHtml(abstract)}</p>` : '<p>RSS 源没有提供摘要。</p>',
      '</article>',
    ].join('');
  }

  function decorateEntry(entry) {
    if (!entry || !isPaperSourceEntry(entry)) return entry;
    if (/class=["']paper-brief["']/i.test(String(entry.content || ''))) return entry;
    return {
      ...entry,
      content: paperEntryContent(entry),
    };
  }

  function isThinEntryContent(entry, { minChars = 600 } = {}) {
    if (!entry) return true;
    if (entry.originalFetchedAt) {
      const full = stripHtml(entry.content || '');
      return full.length < 80;
    }
    const contentText = stripHtml(entry.content || '');
    const summaryText = stripHtml(entry.summary || '');
    const text = contentText || summaryText;
    if (!text) return true;
    if (text.length < Math.min(300, minChars)) return true;
    if (text.length < minChars) {
      // 摘要级 teaser：正文几乎等于摘要，或只剩跟踪像素 + 短文
      if (summaryText && contentText && contentText.length <= summaryText.length + 40) return true;
      if (/telemetry\.(?:gif|png)|plugins\/feed\/assets\/telemetry/i.test(String(entry.content || ''))) return true;
    }
    return false;
  }

  function entryHasLocalPreservedBody(entry) {
    if (!entry) return false;
    const content = String(entry.content || '');
    if (/\/article-images\//i.test(content) || /\/article-images\//i.test(String(entry.image || ''))) return true;
    // 与前端 hasUsableOriginalContent 对齐：实质全文已在库则不再联网
    return stripHtml(content).length >= 700;
  }

  function shouldAutoFetchOriginal(entry) {
    if (!entry || !/^https?:\/\//i.test(entry.link || '')) return false;
    if (entry.sourceId === 'hackernews') {
      return !entry.originalFetchedAt && !/news\.ycombinator\.com\/item\?/i.test(entry.link || '');
    }
    // GitHub 项目书签：API 入库，禁止当文章补抓
    if (isRepoSourceEntry(entry)) return false;
    // 本地离线源（收藏 / 知识库 / 知乎导入）：禁止匿名抓原文（知乎会 403）
    if (
      entry.sourceId === 'xhs-likes'
      || entry.sourceId === 'x-likes'
      || entry.sourceId === 'bili-watchlater'
      || /^xhs-/.test(String(entry.sourceId || ''))
      || /^zhihu-/.test(String(entry.sourceId || ''))
    ) {
      return false;
    }
    const src = entry.sourceId ? getSourceById(entry.sourceId) : null;
    if (src && src.localOnly) return false;
    if (src && isRepoManualSource(src)) return false;
    // crawl/导入全文或本地镜像图：不补抓
    if (entryHasLocalPreservedBody(entry)) return false;
    return isThinEntryContent(entry);
  }

  function normalizeFeedEntryUrl(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, baseUrl || undefined);
      if (!['http:', 'https:'].includes(url.protocol)) return raw;
      url.hash = '';
      return url.toString();
    } catch {
      return raw;
    }
  }

  function normalizeItem(item, source, context = {}) {
    const hnItemId = isHackerNewsSource(source) ? hackerNewsItemIdFromFeedItem(item) : '';
    const rawLink = isHackerNewsSource(source)
      ? (hackerNewsArticleUrlFromItem(item) || item.link || item.guid || '')
      : (item.link || item.guid || '');
    const link = normalizeFeedEntryUrl(rawLink, source && source.siteUrl);
    const baseUrl = link || source.siteUrl || '';
    const rawContent = item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description || '';
    const content = normalizeFeedContent(rawContent, baseUrl);
    const rawGuid = String(item.guid || '').trim();
    // 相对 guid（Halo 常见 `/archives/xxx`）解析成绝对 URL，避免与 link 分裂成两条
    const normalizedGuid = rawGuid
      ? (
        /^https?:/i.test(rawGuid) || (rawGuid.startsWith('/') && source && source.siteUrl)
          ? normalizeFeedEntryUrl(rawGuid, source && source.siteUrl)
          : rawGuid
      )
      : '';
    // 优先用规范化 link 做稳定 id，guid 仅在无 link 时兜底
    const idKey = hnItemId ? `hn:${hnItemId}` : (link || normalizedGuid || String(item.title || '').trim());
    const id = crypto.createHash('md5').update(source.id + '|' + idKey).digest('hex');
    const text = stripHtml(content);
    let image = firstImage(content, baseUrl) || null;
    if (!image && item.itunes && item.itunes.image) image = item.itunes.image;
    if (!image && item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
      image = item.mediaThumbnail.$.url;
    }
    if (!image && Array.isArray(item.mediaContent)) {
      const mc = item.mediaContent.find(m => m.$ && m.$.url && /image|jpg|jpeg|png|webp/i.test((m.$.medium || '') + (m.$.type || '') + m.$.url));
      if (mc) image = mc.$.url;
    }
    image = absoluteUrl(image, baseUrl);
    let audio = null;
    if (item.enclosure && item.enclosure.url && /audio/i.test(item.enclosure.type || '')) {
      audio = { url: item.enclosure.url, type: item.enclosure.type };
    }
    const published = item.isoDate || item.pubDate || null;
    const entry = decorateEntry({
      id,
      sourceId: source.id,
      title: stripHtml(item.title || '(无标题)').slice(0, 300) || '(无标题)',
      link,
      author: item.creator || item.dcCreator || item.author || (item.itunes && item.itunes.author) || '',
      published,
      publishedTs: published ? Date.parse(published) || 0 : 0,
      summary: text.slice(0, 320),
      content,
      image,
      audio,
    });
    if (hnItemId) entry.hnFeedUrl = context.feedUrl || '';
    return entry;
  }

  function dedupeEntries(entries) {
    const order = [];
    const byKey = new Map();
    for (const entry of entries || []) {
      if (!entry) continue;
      // 同源同 link 视为同一篇（兼容历史 guid/link 分裂）
      const linkKey = entry.link
        ? `${entry.sourceId || ''}|${normalizeFeedEntryUrl(entry.link)}`
        : '';
      const key = linkKey || entry.id || `${entry.sourceId || ''}:${entry.title || ''}`;
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, entry);
        order.push(key);
        continue;
      }
      const existingScore = stripHtml(existing.content || '').length + (existing.image ? 80 : 0);
      const nextScore = stripHtml(entry.content || '').length + (entry.image ? 80 : 0);
      // 正文更长优先；相同时保留 published 更「具体」的（非正午伪时间）
      if (nextScore > existingScore) {
        byKey.set(key, entry);
      } else if (nextScore === existingScore) {
        const existingTs = Number(existing.publishedTs) || 0;
        const nextTs = Number(entry.publishedTs) || 0;
        const existingNoon = /T12:00:00/.test(String(existing.published || ''));
        const nextNoon = /T12:00:00/.test(String(entry.published || ''));
        if (existingNoon && !nextNoon) byKey.set(key, entry);
        else if (!existingNoon && nextNoon) { /* keep existing */ }
        else if (nextTs > 0 && (existingTs <= 0 || nextTs < existingTs)) byKey.set(key, entry);
      }
    }
    return order.map(key => byKey.get(key));
  }

  function hasFullEssayContent(entries) {
    return (entries || []).some(entry => stripHtml(entry.content).length >= 600);
  }

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

  function preferRicherContent(primary = '', secondary = '') {
    const a = String(primary || '');
    const b = String(secondary || '');
    const aLen = stripHtml(a).length;
    const bLen = stripHtml(b).length;
    if (aLen >= bLen + 40) return a;
    if (bLen > aLen) return b;
    return a || b;
  }

  function storedEntryForCache(entry) {
    if (!store) return decorateEntry(entry);
    if (store.isEntryDeleted(entry.id)) return null;
    const stored = store.getEntry(entry.id);
    if (!stored) return decorateEntry(entry);
    const content = isPaperSourceEntry(entry)
      ? (entry.content || stored.content || '')
      : preferRicherContent(entry.content, stored.content);
    const summary = isPaperSourceEntry(entry)
      ? (entry.summary || stored.summary || '')
      : (stripHtml(content).slice(0, 320) || stored.summary || entry.summary || '');
    const merged = {
      ...entry,
      ...stored,
      content,
      summary,
      image: (entry.image && !isTrackingPixelUrl(entry.image) ? entry.image : null)
        || (stored.image && !isTrackingPixelUrl(stored.image) ? stored.image : null)
        || entry.image
        || stored.image
        || null,
      audio: stored.audio || entry.audio || null,
      originalFetchedAt: entry.originalFetchedAt || stored.originalFetchedAt || null,
      originalFetchAttemptedAt: entry.originalFetchAttemptedAt || stored.originalFetchAttemptedAt || null,
      originalFetchError: entry.originalFetchedAt
        ? null
        : (entry.originalFetchError || stored.originalFetchError || null),
    };
    return decorateEntry(merged);
  }

  function changedEntriesAfterUpsert(previousHashes, cachedEntries) {
    return (cachedEntries || []).filter(entry => {
      if (!entry || !entry.id) return false;
      const previousHash = previousHashes.get(entry.id);
      return !previousHash || previousHash !== entry.contentHash;
    });
  }

  function newestEntries(entries, limit) {
    return (entries || [])
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (b.entry.publishedTs - a.entry.publishedTs) || a.index - b.index)
      .slice(0, limit)
      .map(item => item.entry);
  }

  /** 与 fetch 边界：瘦 RSS 条目补抓原文（需注入 fetch/extract/store） */
  async function hydrateThinFeedEntry(entry) {
    if (!entry || !entry.link || !shouldAutoFetchOriginal(entry)) return entry;
    if (!fetchHtmlWithManualRedirects || !extractReadableContent || !store) return entry;
    // 软删条目：getEntry 会返回 null，若继续抓原文会带 forceContent 走 upsert 复活
    if (entry.id && typeof store.isEntryDeleted === 'function' && store.isEntryDeleted(entry.id)) {
      return entry;
    }
    const existing = entry.id ? store.getEntry(entry.id) : null;
    if (existing && !isThinEntryContent(existing) && stripHtml(existing.content || '').length >= stripHtml(entry.content || '').length) {
      return {
        ...entry,
        content: existing.content,
        summary: existing.summary || entry.summary,
        image: existing.image || entry.image,
        contentHash: existing.contentHash || entry.contentHash,
        originalFetchedAt: existing.originalFetchedAt || entry.originalFetchedAt,
        originalFetchAttemptedAt: existing.originalFetchAttemptedAt || entry.originalFetchAttemptedAt,
        originalFetchError: existing.originalFetchError || entry.originalFetchError || null,
      };
    }
    try {
      const fetched = await fetchHtmlWithManualRedirects(entry.link, 25000);
      const extracted = extractReadableContent(fetched.html, fetched.url);
      const extractedText = stripHtml(extracted.content || '');
      if (extractedText.length < 80 || extractedText.length <= stripHtml(entry.content || '').length + 40) {
        return entry;
      }
      let content = extracted.content;
      // 封面只要正文实图；正文无图则清空（避免 bearblog 全站 og 小狗图）
      let image = pickArticleCoverImage(content, extracted.image, fetched.url);
      if (!image && entry.image && !isGenericCoverImage(entry.image) && contentHasRealImage(content)) {
        image = entry.image;
      }
      if (localizeEntryImages) {
        try {
          const localized = await localizeEntryImages({
            sourceId: entry.sourceId || '',
            entryId: entry.id,
            content,
            image,
            pageUrl: fetched.url || entry.link,
          });
          content = localized.content;
          image = pickArticleCoverImage(content, localized.image || image, fetched.url);
        } catch { /* keep remote urls if localize fails */ }
      }
      if (image && isGenericCoverImage(image)) image = null;

      const next = {
        ...entry,
        content,
        summary: extracted.summary || entry.summary,
        image,
        forceContent: true,
        originalFetchedAt: Date.now(),
        originalFetchAttemptedAt: Date.now(),
        originalFetchError: null,
      };
      if (entry.id && typeof store.updateEntryContent === 'function') {
        const updated = store.updateEntryContent(entry.id, {
          content: next.content,
          summary: next.summary,
          image: next.image,
          originalFetched: true,
        });
        if (updated) {
          return {
            ...next,
            contentHash: updated.contentHash,
            originalFetchedAt: updated.originalFetchedAt,
            originalFetchAttemptedAt: updated.originalFetchAttemptedAt,
            originalFetchError: null,
          };
        }
      }
      return next;
    } catch (error) {
      const message = String(error && error.message || error).slice(0, 200);
      if (entry.id && typeof store.markEntryOriginalFetchAttempt === 'function') {
        try { store.markEntryOriginalFetchAttempt(entry.id, message); } catch { /* best effort */ }
      }
      return {
        ...entry,
        originalFetchAttemptedAt: Date.now(),
        originalFetchError: message,
      };
    }
  }

  async function hydrateThinFeedEntries(source, entries) {
    if (!source || source.manual || source.localOnly) return entries;
    if (isHackerNewsSource(source) || source.id === 'paulgraham') return entries;
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return list;
    let remaining = THIN_ORIGINAL_HYDRATE_LIMIT;
    return mapLimit(list, THIN_ORIGINAL_HYDRATE_CONCURRENCY, async (entry) => {
      if (remaining <= 0 || !shouldAutoFetchOriginal(entry)) return entry;
      remaining -= 1;
      return hydrateThinFeedEntry(entry);
    });
  }

  async function hydratePaulGrahamEntry(entry) {
    const originalLength = stripHtml(entry.content).length;
    if (!entry || !entry.link || !isPaulGrahamUrl(entry.link)) return entry;
    if (!fetchText || !extractReadableContent) return entry;
    try {
      const url = publicHttpUrl(entry.link);
      const html = await fetchText(url, 15000);
      const extracted = extractReadableContent(html, url);
      const extractedLength = stripHtml(extracted.content).length;
      if (extractedLength < 80 || extractedLength < originalLength * 0.8) return entry;
      return {
        ...entry,
        title: entry.title || extracted.title || '(无标题)',
        summary: extracted.summary || entry.summary,
        content: extracted.content,
        image: extracted.image || entry.image,
      };
    } catch {
      return entry;
    }
  }

  return {
    isProductHuntUrl,
    isProductHuntRedirectUrl,
    arxivIdFromUrl,
    sourceContentKind,
    isRepoManualSource,
    isRepoSourceEntry,
    isPaperSourceEntry,
    normalizePaperAbstract,
    formatDateForPaper,
    linkHtml,
    paperLinksHtml,
    paperEntryContent,
    decorateEntry,
    isThinEntryContent,
    shouldAutoFetchOriginal,
    entryHasLocalPreservedBody,
    normalizeItem,
    normalizeFeedEntryUrl,
    dedupeEntries,
    hasFullEssayContent,
    mapLimit,
    newestEntries,
    preferRicherContent,
    storedEntryForCache,
    changedEntriesAfterUpsert,
    hydrateThinFeedEntry,
    hydrateThinFeedEntries,
    hydratePaulGrahamEntry,
    THIN_ORIGINAL_HYDRATE_LIMIT,
    THIN_ORIGINAL_HYDRATE_CONCURRENCY,
  };
}

module.exports = { createEntriesNormalize };
