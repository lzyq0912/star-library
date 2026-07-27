/**
 * Catalog / list path: getEntries, getSourcesMeta, ensureLocalOnlyCache, lean list mappers.
 * Agent 改列表 API 或侧栏 meta 时优先打开此文件。
 */
'use strict';

function createCatalog(deps = {}) {
  const store = deps.store || require('../store');
  const SOURCES = deps.SOURCES;
  if (!SOURCES) {
    throw new Error('createCatalog: deps.SOURCES is required');
  }

  const runtime = deps.runtime || null;
  const USER_SUBMITTED_SOURCE_ID = deps.USER_SUBMITTED_SOURCE_ID || 'user-submitted';
  const HACKERNEWS_SOURCE_ID = deps.HACKERNEWS_SOURCE_ID || 'hackernews';

  const isEnabled = deps.isEnabled;
  const isRepoManualSource = deps.isRepoManualSource;
  const decorateEntry = deps.decorateEntry;
  if (typeof isEnabled !== 'function') {
    throw new Error('createCatalog: deps.isEnabled is required');
  }
  if (typeof isRepoManualSource !== 'function') {
    throw new Error('createCatalog: deps.isRepoManualSource is required');
  }
  if (typeof decorateEntry !== 'function') {
    throw new Error('createCatalog: deps.decorateEntry is required');
  }

  // HTML / 图片工具：优先 deps，否则同目录纯工具（禁止 require 门面 fetcher.js）
  let stripHtml = deps.stripHtml;
  let toLocalArticleImageUrl = deps.toLocalArticleImageUrl;
  let firstImage = deps.firstImage;
  let isGenericCoverImage = deps.isGenericCoverImage;
  let isLikelyArticleOgImage = deps.isLikelyArticleOgImage;
  let contentHasRealImage = deps.contentHasRealImage;
  let isLocalArticleImageUrl = deps.isLocalArticleImageUrl;

  if (
    !stripHtml || !toLocalArticleImageUrl || !firstImage
    || !isGenericCoverImage || !isLikelyArticleOgImage || !contentHasRealImage
  ) {
    const html = require('./html-content');
    stripHtml = stripHtml || html.stripHtml;
    toLocalArticleImageUrl = toLocalArticleImageUrl || html.toLocalArticleImageUrl;
    firstImage = firstImage || html.firstImage;
    isGenericCoverImage = isGenericCoverImage || html.isGenericCoverImage;
    isLikelyArticleOgImage = isLikelyArticleOgImage || html.isLikelyArticleOgImage;
    contentHasRealImage = contentHasRealImage || html.contentHasRealImage;
  }
  if (!isLocalArticleImageUrl) {
    isLocalArticleImageUrl = require('./images-localize').isLocalArticleImageUrl;
  }

  /**
   * 与门面共享同一 cache 对象引用。
   * - runtime.cache：可被门面整体替换后同步（getter 或赋值）
   * - deps.getCache：显式取当前引用
   * - deps.cache：同一 object 可变
   */
  function getCache() {
    if (typeof deps.getCache === 'function') return deps.getCache() || {};
    if (runtime && runtime.cache != null) return runtime.cache;
    if (deps.cache != null) return deps.cache;
    return {};
  }

  function setCacheBucket(sourceId, bucket) {
    if (typeof deps.setCache === 'function') {
      const cur = getCache();
      const next = { ...cur, [sourceId]: bucket };
      deps.setCache(next);
      if (runtime) runtime.cache = next;
      return bucket;
    }
    const cache = getCache();
    cache[sourceId] = bucket;
    return bucket;
  }

  function getSourcesMeta() {
    const cache = getCache();
    return SOURCES.map(s => {
      if (s.manual) {
        let meta = null;
        try {
          if (isRepoManualSource(s)) {
            const count = store.countEntriesBySource(s.id);
            const cached = cache[s.id];
            meta = {
              latestAt: (cached && cached.fetchedAt) || null,
              count,
            };
          } else {
            meta = store.getSubmissionMeta();
          }
        } catch (error) {
          const fallback = cache[s.id];
          meta = {
            latestAt: fallback && fallback.fetchedAt || null,
            count: fallback && Array.isArray(fallback.entries) ? fallback.entries.length : 0,
          };
        }
        return {
          id: s.id,
          name: s.name,
          category: s.category,
          siteUrl: s.siteUrl,
          icon: s.icon || '',
          contentKind: s.contentKind || '',
          displayPin: Number(s.displayPin) || 0,
          description: s.description || '',
          note: s.note || '',
          localOnly: Boolean(s.localOnly),
          excludeFromAll: Boolean(s.excludeFromAll),
          enabled: isEnabled(s),
          status: 'ok',
          error: null,
          fetchedAt: meta.latestAt,
          entryCount: meta.count,
        };
      }
      // localOnly 侧栏计数：cache 未灌时也从 DB 取数，避免显示 0 且「全部」漏源
      const c = s.localOnly ? ensureLocalOnlyCache(s) : cache[s.id];
      let entryCount = c && c.entries
        ? c.entries.filter(entry => entry && !entry.deletedAt).length
        : 0;
      if (!entryCount && s.localOnly && isEnabled(s) && store.countEntriesBySource) {
        try { entryCount = store.countEntriesBySource(s.id) || 0; } catch { /* keep 0 */ }
      }
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        siteUrl: s.siteUrl,
        icon: s.icon || '',
        contentKind: s.contentKind || '',
        displayPin: Number(s.displayPin) || 0,
        description: s.description || '',
        note: s.note || '',
        localOnly: Boolean(s.localOnly),
        excludeFromAll: Boolean(s.excludeFromAll),
        enabled: isEnabled(s),
        status: c ? c.status : (s.localOnly ? 'ok' : 'pending'),
        error: c ? c.error : null,
        fetchedAt: c ? c.fetchedAt : null,
        lastAttemptAt: c ? c.lastAttemptAt || c.fetchedAt || null : null,
        nextRetryAt: c ? c.nextRetryAt || null : null,
        failureCount: c ? Number(c.failureCount) || 0 : 0,
        // hydrate 已排除 deleted；用内存字段，避免 N 次 isEntryDeleted SQL
        entryCount,
      };
    });
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function entrySearchText(entry, source, titleZh = '') {
    return [
      entry && entry.title,
      titleZh,
      entry && entry.summary,
      entry && entry.summaryZh,
      entry && stripHtml(entry.content || ''),
      source && source.name,
      source && source.category,
    ].filter(Boolean).join(' ');
  }

  function entryMatchesSearch(entry, source, titleZh, query) {
    const terms = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!terms.length) return true;
    const haystack = normalizeSearchText(entrySearchText(entry, source, titleZh));
    return terms.every(term => haystack.includes(term));
  }

  /**
   * localOnly（X / 小红书 / 知乎）以 SQLite 为真相源。
   * 若内存 cache 缺桶或明显少于 DB，按需从 DB 重灌，避免「全部」首包漏掉本地源，
   * 直到用户点进该源触发 refresh-hint / merge 才出现。
   */
  function ensureLocalOnlyCache(source) {
    const cache = getCache();
    if (!source || !source.id || !source.localOnly || source.manual) return cache[source && source.id] || null;
    if (!isEnabled(source)) return cache[source.id] || null;
    const sid = source.id;
    const limit = Math.max(source.limit || 50, 5000);
    let dbCount = 0;
    try {
      dbCount = store.countEntriesBySource ? store.countEntriesBySource(sid) : 0;
    } catch {
      dbCount = 0;
    }
    const current = cache[sid];
    const memCount = current && Array.isArray(current.entries)
      ? current.entries.filter(entry => entry && !entry.deletedAt).length
      : 0;
    // 仅当内存与 DB 计数一致才复用 cache。
    // memCount > dbCount：典型是软删后未剔 cache（取消稍后再看回魂根因）→ 必须重灌
    // memCount < dbCount：DB 有新条目 → 重灌
    if (memCount > 0 && dbCount > 0 && memCount === dbCount) return current;
    if (memCount > 0 && dbCount <= 0) {
      // DB 已空：清空内存，避免幽灵条目
      return setCacheBucket(sid, {
        ...(current || {}),
        fetchedAt: Date.now(),
        lastAttemptAt: Date.now(),
        feedUrl: (current && current.feedUrl) || 'local-db',
        feedTitle: source.name,
        status: 'ok',
        error: null,
        entries: [],
      });
    }
    let rows = [];
    try {
      rows = store.listEntriesBySource(sid, limit) || [];
    } catch {
      rows = [];
    }
    if (!rows.length) {
      if (dbCount <= 0) {
        return setCacheBucket(sid, {
          fetchedAt: Date.now(),
          lastAttemptAt: Date.now(),
          feedUrl: (current && current.feedUrl) || 'local-db',
          feedTitle: source.name,
          status: 'ok',
          error: null,
          entries: [],
        });
      }
      return current || null;
    }
    return setCacheBucket(sid, {
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      nextRetryAt: null,
      failureCount: 0,
      feedUrl: (current && current.feedUrl) || 'local-db',
      feedTitle: source.name,
      status: 'ok',
      error: null,
      entries: rows,
    });
  }

  function getEntries({ sourceId, category, q, limit = 5000, viewer = null } = {}) {
    const cache = getCache();
    const byId = Object.fromEntries(SOURCES.map(s => [s.id, s]));
    let all = [];
    for (const src of SOURCES) {
      // 课程库等：只在显式 ?source= 时出现，不进「全部」时间线
      if (src.excludeFromAll && !sourceId) continue;
      if (src.manual) {
        if (!isEnabled(src)) continue;
        if (sourceId && src.id !== sourceId) continue;
        if (category && src.category !== category) continue;
        if (isRepoManualSource(src)) {
          all = all.concat(store.listEntriesBySource(src.id, src.limit || 500).map(decorateEntry));
        } else {
          all = all.concat(store.getSubmittedEntries({ limit: src.limit || 200 }).map(decorateEntry));
        }
        continue;
      }
      const sid = src.id;
      if (!isEnabled(src)) continue;
      if (sourceId && sid !== sourceId) continue;
      if (category && src.category !== category) continue;
      // localOnly：cache 空/过旧时按需从 SQLite 补灌，保证「全部」含 X/小红书/知乎
      const c = src.localOnly ? ensureLocalOnlyCache(src) : cache[sid];
      if (!c) continue;
      // cache 由 listEntriesBySource / hydrate 灌入时已排除软删；用 deletedAt 字段过滤，避免 N+1 SQL
      if (c.entries) {
        all = all.concat(
          c.entries
            .filter(entry => entry && !entry.deletedAt)
            .map(decorateEntry)
        );
      }
    }
    // Zen 源表裁掉 user-submitted 后，显式 ?source=user-submitted 仍从 DB 列投稿（admin / 集成测）
    // 不进入全量目录、不进侧栏（SOURCES 无此项且本分支仅 sourceId 精确命中）
    if (
      sourceId === USER_SUBMITTED_SOURCE_ID
      && !byId[USER_SUBMITTED_SOURCE_ID]
      && (!category || category === 'article')
    ) {
      all = all.concat(
        store.getSubmittedEntries({ limit: Math.min(Number(limit) || 200, 500) }).map(decorateEntry)
      );
    }
    if (q) {
      const titleMap = store.getTitleTranslations(all.map(entry => entry && entry.id).filter(Boolean));
      all = all.filter(entry => entryMatchesSearch(entry, byId[entry.sourceId], titleMap[entry.id], q));
    }
    if (!(sourceId === HACKERNEWS_SOURCE_ID && !category && !q)) {
      all.sort((a, b) => b.publishedTs - a.publishedTs);
    }
    // 列表路径用 lean assets/stats，避免 3000+ 条空资产对象撑爆 JSON 与主线程 parse
    return withTranslations(all.slice(0, limit), viewer, { listMode: true });
  }

  function getSourceById(id) {
    return SOURCES.find(s => s.id === id) || null;
  }

  /** cache 可能是 lean hydrate（无 content）；详情/翻译等需要正文时按需读 DB */
  function entryWithContentIfNeeded(entry) {
    if (!entry || !entry.id) return entry;
    const cachedContent = String(entry.content || '').trim();
    const needsContent = !cachedContent;
    const needsImage = !entry.image;
    // cache 可能落后于 DB 的 original_fetched 标记（存量补标后未重启）
    const needsFetchedFlag = !entry.originalFetchedAt;
    // 正文已在 cache 且封面/原文标记齐全：直接返回；否则并 DB
    if (!needsContent && !needsImage && !needsFetchedFlag) return entry;
    const stored = store.getEntry(entry.id);
    if (!stored) return entry;
    const content = String(stored.content || '').trim() || cachedContent;
    const image = entry.image || stored.image || null;
    const originalFetchedAt = entry.originalFetchedAt || stored.originalFetchedAt || null;
    // 回写到 cache 条目，避免同一篇重复读 DB
    if (content) entry.content = content;
    if (image) entry.image = image;
    if (originalFetchedAt) entry.originalFetchedAt = originalFetchedAt;
    if (stored.originalFetchAttemptedAt && !entry.originalFetchAttemptedAt) {
      entry.originalFetchAttemptedAt = stored.originalFetchAttemptedAt;
    }
    if (originalFetchedAt) entry.originalFetchError = null;
    return {
      ...entry,
      ...stored,
      content: content || entry.content || '',
      image: image || stored.image || entry.image || null,
      originalFetchedAt,
      originalFetchAttemptedAt: entry.originalFetchAttemptedAt || stored.originalFetchAttemptedAt || null,
      originalFetchError: originalFetchedAt ? null : (entry.originalFetchError || stored.originalFetchError || null),
    };
  }

  function getEntryById(id, viewer = null) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    if (store.isEntryDeleted(cleanId)) return null;
    const cache = getCache();
    for (const c of Object.values(cache)) {
      const hit = (c.entries || []).find(e => e.id === cleanId);
      if (hit) return withTranslations([decorateEntry(entryWithContentIfNeeded(hit))], viewer)[0];
    }
    const stored = store.getEntry(cleanId);
    return stored ? withTranslations([decorateEntry(stored)], viewer)[0] : null;
  }

  function getEntryByIdPrefix(prefix, viewer = null) {
    const clean = String(prefix || '').trim();
    if (clean.length < 6) return null;
    const cache = getCache();
    const cacheHits = [];
    for (const c of Object.values(cache)) {
      for (const entry of c.entries || []) {
        if (entry && entry.id && entry.id.startsWith(clean) && !entry.deletedAt) {
          cacheHits.push(entry);
          if (cacheHits.length > 2) break;
        }
      }
      if (cacheHits.length > 2) break;
    }
    if (cacheHits.length === 1) {
      return withTranslations([decorateEntry(entryWithContentIfNeeded(cacheHits[0]))], viewer)[0];
    }
    // cache 多命中或未灌盘时，以 SQLite 唯一前缀为准（避免 cache 未就绪误杀）
    const stored = store.getEntryByIdPrefix(clean);
    if (stored) return withTranslations([decorateEntry(stored)], viewer)[0];
    return null;
  }

  function slimListStats(stats) {
    if (!stats) return null;
    const viewCount = Number(stats.viewCount) || 0;
    const favoriteCount = Number(stats.favoriteCount) || 0;
    const likeCount = Number(stats.likeCount) || 0;
    const dislikeCount = Number(stats.dislikeCount) || 0;
    const reactionByMe = stats.reactionByMe || '';
    if (!viewCount && !favoriteCount && !likeCount && !dislikeCount && !reactionByMe) return null;
    const out = { entryId: stats.entryId };
    if (viewCount) out.viewCount = viewCount;
    if (favoriteCount) out.favoriteCount = favoriteCount;
    if (likeCount) out.likeCount = likeCount;
    if (dislikeCount) out.dislikeCount = dislikeCount;
    if (reactionByMe) out.reactionByMe = reactionByMe;
    return out;
  }

  function clipListText(value, max = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  }

  /** 列表封面：正文实图优先；否则可用已本地化/CMS 级封面（杜绝全站 og 小狗占位） */
  function listCoverImage(entry) {
    if (!entry) return '';
    const content = entry.content || '';
    const bodyImg = firstImage(content);
    if (bodyImg) return toLocalArticleImageUrl(bodyImg);
    // lean 列表无 content：用 entry.image，并纠正误存的外站 /article-images/ 绝对地址
    const cover = toLocalArticleImageUrl(entry.image);
    if (!cover || isGenericCoverImage(cover)) return '';
    // 已落到本站 article-images 的封面：正文即使无 <img>（纯 CSS 图表文）也保留
    if (isLocalArticleImageUrl(cover)) return cover;
    // 远程封面：正文已加载且确认无实图时，仅保留「像文章配图」的 CMS og
    if (content && !contentHasRealImage(content) && !isLikelyArticleOgImage(cover)) return '';
    return cover;
  }

  /** 目录列表专用：仅前端 filter/渲染需要的字段，彻底去掉 content 与内部元数据 */
  function toListCatalogEntry(entry, { titleZh = null, summaryZh = null, assets = null, stats = null } = {}) {
    if (!entry) return null;
    const out = {
      id: entry.id,
      sourceId: entry.sourceId,
      title: entry.title || '',
      published: entry.published || null,
      publishedTs: Number(entry.publishedTs) || 0,
    };
    const zh = titleZh != null ? titleZh : entry.titleZh;
    if (zh) out.titleZh = zh;
    if (entry.link) out.link = entry.link;
    if (entry.author) out.author = entry.author;
    // 原文摘要 + 中文摘要都下发；前端 listSummaryText 优先 summaryZh（译后默认中文概要）
    const zhSummary = clipListText(summaryZh != null ? summaryZh : entry.summaryZh, 160);
    const summary = clipListText(entry.summary, 160);
    if (summary) out.summary = summary;
    if (zhSummary) out.summaryZh = zhSummary;
    // 列表图：优先正文里的首张实图，避开误存的站点 og
    const cover = listCoverImage(entry);
    if (cover) out.image = cover;
    if (entry.audio) out.audio = entry.audio;
    if (assets) out.assets = assets;
    if (stats) out.stats = stats;
    return out;
  }

  /** 列表 lean assets：再压掉零值字段 */
  function slimListAssets(assets) {
    if (!assets) return null;
    const out = {};
    if (assets.translation || assets.translationCount) {
      out.translation = true;
      if (assets.translationCount) out.translationCount = Number(assets.translationCount) || 1;
    }
    if (assets.rewrite || assets.rewriteCount) {
      out.rewrite = true;
      if (assets.rewriteCount) out.rewriteCount = Number(assets.rewriteCount) || 1;
    }
    if (assets.comments) out.comments = Number(assets.comments) || 0;
    if (assets.annotations) out.annotations = Number(assets.annotations) || 0;
    if (assets.chatMessages) out.chatMessages = Number(assets.chatMessages) || 0;
    if (assets.helpfulCount) out.helpfulCount = Number(assets.helpfulCount) || 0;
    if (assets.latestAt) {
      out.latestAt = Number(assets.latestAt) || 0;
      if (Array.isArray(assets.latestTypes) && assets.latestTypes.length) {
        out.latestTypes = assets.latestTypes;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  /** 列表：lean assets（稀疏）+ 非零 stats；详情仍走 full */
  function withTranslations(entries, viewer = null, { listMode = false } = {}) {
    const decorated = entries.map(decorateEntry);
    const ids = decorated.map(e => e.id);
    const listZh = typeof store.getListTranslations === 'function'
      ? store.getListTranslations(ids)
      : {};
    const titleMap = Object.fromEntries(
      Object.entries(listZh).map(([id, row]) => [id, row && row.titleZh]).filter(([, v]) => v)
    );
    // 兼容无 getListTranslations 的旧 store
    if (!Object.keys(listZh).length && store.getTitleTranslations) {
      Object.assign(titleMap, store.getTitleTranslations(ids));
    }
    const assetMap = listMode
      ? store.getEntryAssetSummaries(ids, { mode: 'list' })
      : store.getEntryAssetSummaries(ids);
    // 列表 sparse：不预填 3000+ 空 stats 对象
    const statsMap = store.getEntryStats(ids, viewer, { sparse: listMode });
    if (listMode) {
      return decorated.map((entry) => {
        const zh = listZh[entry.id] || {};
        return toListCatalogEntry(entry, {
          titleZh: zh.titleZh || titleMap[entry.id] || null,
          summaryZh: zh.summaryZh || entry.summaryZh || null,
          assets: slimListAssets(assetMap[entry.id] || null),
          stats: slimListStats(statsMap[entry.id] || null),
        });
      });
    }
    return decorated.map(entry => {
      const zh = listZh[entry.id] || {};
      const titleZh = zh.titleZh || titleMap[entry.id] || null;
      const summaryZh = zh.summaryZh || entry.summaryZh || null;
      const assets = assetMap[entry.id] || entry.assets || emptyListAssets();
      const stats = statsMap[entry.id] || entry.stats || null;
      return {
        ...entry,
        titleZh,
        summaryZh,
        assets,
        stats,
      };
    });
  }

  function emptyListAssets() {
    return {
      translation: false,
      rewrite: false,
      comments: 0,
      chatMessages: 0,
      latestAt: 0,
      latestTypes: [],
    };
  }

  return {
    getSourcesMeta,
    getEntries,
    getSourceById,
    getEntryById,
    getEntryByIdPrefix,
    ensureLocalOnlyCache,
    entryWithContentIfNeeded,
    withTranslations,
    // helpers（测试 / 内部）
    normalizeSearchText,
    entrySearchText,
    entryMatchesSearch,
    slimListStats,
    clipListText,
    listCoverImage,
    toListCatalogEntry,
    slimListAssets,
    emptyListAssets,
    getCache,
  };
}

module.exports = { createCatalog };
