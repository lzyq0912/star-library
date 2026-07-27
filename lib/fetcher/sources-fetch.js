/**
 * Source fetch pipeline: parse feeds → hydrate → finalize into runtime.cache.
 * Agent 改抓源/刷新时优先此文件。
 *
 * 禁止 require 门面 lib/fetcher.js（防环）。cache 经 deps.runtime.cache 写入。
 */
'use strict';

const cheerio = require('cheerio');
const {
  stripHtml,
  decodeEntities,
  absoluteUrl,
  normalizeRenderedContent,
  metaContent,
  extractReadableContent,
  jamesClearNewsletterTimestamp,
  isJamesClearNewsletterUrl,
} = require('./html-content');

const SITEMAP_SKIP = /\/(archive|authors?|subscribe|upgrade|recommendations|tags?|privacy|terms|about|login|account|category|sitemap)(\/|$)/i;

function defaultNormalizeFeedEntryUrl(value, baseUrl = '') {
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

async function defaultMapLimit(items, limit, mapper) {
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

function createSourceFetch(deps) {
  const {
    SOURCES,
    store,
    runtime, // { cache } — 写 runtime.cacheRef()[id]
    CONCURRENCY = 8,
    expandCandidates,
    parseRssUrl,
    normalizeItem,
    dedupeEntries,
    newestEntries,
    hydrateSourceEntries,
    isHackerNewsSource,
    rankHackerNewsEntries,
    markCacheSourceChanged,
    saveDisk,
    manualSourceCache,
    isEnabled,
    fetchText,
    storedEntryForCache,
    changedEntriesAfterUpsert,
    normalizeFeedEntryUrl = defaultNormalizeFeedEntryUrl,
    mapLimit = defaultMapLimit,
  } = deps;

  if (!runtime || typeof runtime !== 'object') {
    throw new Error('createSourceFetch: deps.runtime is required');
  }

  /** 始终读 runtime.cache，避免 loadDisk 整表替换后闭包仍指向旧对象 */
  function cacheRef() {
    if (!runtime.cache || typeof runtime.cache !== 'object') {
      runtime.cache = {};
    }
    return runtime.cache;
  }

  function structuredDatePublished(html) {
    const match = /"datePublished"\s*:\s*"([^"]+)"/.exec(String(html || ''));
    return match ? decodeEntities(match[1]) : '';
  }

  function wpJsonDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  }

  function wpJsonPublished(post) {
    const schemaGraph = post && post.yoast_head_json && post.yoast_head_json.schema && post.yoast_head_json.schema['@graph'];
    const schemaDate = Array.isArray(schemaGraph)
      ? (schemaGraph.find(node => node && node.datePublished) || {}).datePublished
      : '';
    return schemaDate || wpJsonDate(post && (post.date_gmt || post.date || post.modified_gmt));
  }

  function wpJsonImage(post) {
    const yoast = post && post.yoast_head_json;
    const image = yoast && Array.isArray(yoast.og_image) && yoast.og_image[0] && yoast.og_image[0].url;
    return image || (yoast && yoast.thumbnailUrl) || null;
  }

  function sitemapPublishedTimestamp(item, source) {
    if (source && source.id === 'james-clear') return jamesClearNewsletterTimestamp(item.loc);
    return Date.parse(item.lastmod || 0) || 0;
  }

  async function parseWpJsonFeed(url, source) {
    const text = await fetchText(url);
    const posts = JSON.parse(text);
    if (!Array.isArray(posts)) throw new Error('wpjson: expected an array of posts');
    const items = posts.map(post => {
      const link = post && post.link ? String(post.link) : '';
      const content = normalizeRenderedContent(post && post.content && post.content.rendered, link)
        || normalizeRenderedContent(post && post.excerpt && post.excerpt.rendered, link);
      const title = decodeEntities(stripHtml(post && post.title && post.title.rendered || '(无标题)'));
      const description = stripHtml(post && post.excerpt && post.excerpt.rendered || content).slice(0, 320);
      const image = absoluteUrl(wpJsonImage(post), link);
      const item = {
        title,
        link,
        guid: link,
        pubDate: wpJsonPublished(post),
        content,
        description,
      };
      if (image) item.mediaThumbnail = { $: { url: image } };
      return item;
    }).filter(item => item.link && (item.title || item.content));
    items.sort((a, b) => (Date.parse(b.pubDate || 0) || 0) - (Date.parse(a.pubDate || 0) || 0));
    if (!items.length) throw new Error('wpjson: no posts found');
    return { title: source.name, items };
  }

  function sitemapDocumentUrls(xml, baseUrl) {
    const $ = cheerio.load(String(xml || ''), { xmlMode: true });
    const urls = [];
    $('url').each((_, el) => {
      const loc = $(el).find('loc').first().text().trim();
      if (!loc) return;
      urls.push({
        loc: normalizeFeedEntryUrl(loc, baseUrl),
        lastmod: $(el).find('lastmod').first().text().trim() || null,
      });
    });
    const indexes = [];
    $('sitemap').each((_, el) => {
      const loc = $(el).find('loc').first().text().trim();
      if (loc) indexes.push(normalizeFeedEntryUrl(loc, baseUrl));
    });
    return { urls: urls.filter(item => item.loc), indexes: indexes.filter(Boolean) };
  }

  async function loadSitemapUrls(url, depth = 0) {
    const xml = await fetchText(url);
    const parsed = sitemapDocumentUrls(xml, url);
    if (parsed.urls.length || !parsed.indexes.length || depth >= 1) return parsed.urls;
    const nested = await mapLimit(parsed.indexes.slice(0, 6), 3, async childUrl => {
      try {
        return await loadSitemapUrls(childUrl, depth + 1);
      } catch {
        return [];
      }
    });
    const seen = new Set();
    return nested.flat().filter(item => item && item.loc && !seen.has(item.loc) && seen.add(item.loc));
  }

  // Fallback for beehiiv-style sites with no public RSS: walk sitemap.xml, fetch top pages for metadata.
  async function parseSitemapFeed(url, source) {
    const urls = await loadSitemapUrls(url);
    if (!urls.length) throw new Error('sitemap: no article URLs found');
    let posts = [];
    if (source && source.id === 'james-clear') {
      posts = urls.filter(u => isJamesClearNewsletterUrl(u.loc));
    } else {
      posts = urls.filter(u => {
        try {
          const p = new URL(u.loc).pathname;
          return p.length > 1 && !SITEMAP_SKIP.test(p);
        } catch { return false; }
      });
      const withP = posts.filter(u => u.loc.includes('/p/'));
      if (withP.length) posts = withP;
    }
    posts.sort((a, b) => sitemapPublishedTimestamp(b, source) - sitemapPublishedTimestamp(a, source));
    const limit = Math.min(source.limit || 5, 30);
    const top = posts.slice(0, limit);
    const items = await mapLimit(top, 4, async u => {
      let title = decodeURIComponent(new URL(u.loc).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]/g, ' ');
      let description = '', content = '', image = null;
      const slugTimestamp = sitemapPublishedTimestamp(u, source);
      let published = slugTimestamp ? new Date(slugTimestamp).toISOString() : u.lastmod;
      try {
        const html = await fetchText(u.loc, 12000);
        title = decodeEntities(metaContent(html, ['og:title', 'twitter:title']) || (/<title[^>]*>([^<]+)<\/title>/i.exec(html) || [])[1] || title);
        description = decodeEntities(metaContent(html, ['og:description', 'twitter:description', 'description']) || '');
        image = metaContent(html, ['og:image', 'twitter:image']);
        published = metaContent(html, ['article:published_time']) || structuredDatePublished(html) || published || u.lastmod;
        const extracted = extractReadableContent(html, u.loc);
        if (extracted && stripHtml(extracted.content).length >= 80) {
          title = extracted.title || title;
          description = extracted.summary || description;
          content = extracted.content;
          image = extracted.image || image;
        }
      } catch { /* keep slug-derived title */ }
      const item = { title, link: u.loc, guid: u.loc, pubDate: published, content: content || (description ? `<p>${description}</p>` : ''), description };
      if (image) item.mediaThumbnail = { $: { url: image } };
      return item;
    });
    if (!items.length) throw new Error('sitemap: no posts found');
    return { title: source.name, items };
  }

  async function parseFeedUrl(url, source) {
    if (url.startsWith('sitemap:')) return parseSitemapFeed(url.slice(8), source);
    if (url.startsWith('wpjson:')) return parseWpJsonFeed(url.slice(7), source);
    return parseRssUrl(url);
  }

  function sourceLimit(source) {
    return Math.min(source.limit || 20, 30);
  }

  function finalizeFetchedSource(source, entries, { feedUrl = '', feedTitle = '' } = {}) {
    const previousHashes = new Map(entries.map(entry => {
      const existing = entry && entry.id ? store.getEntry(entry.id) : null;
      return [entry && entry.id, existing && existing.contentHash ? existing.contentHash : ''];
    }));
    store.upsertEntries(entries);
    // 同源同链去重（历史相对 guid / zen-import / 新绝对 link 分裂）
    if (typeof store.dedupeSourceEntriesByLink === 'function') {
      try {
        store.dedupeSourceEntriesByLink(source.id, {
          reason: '同源同链重复（feed 刷新合并）',
        });
      } catch (error) {
        console.warn(`[fetcher] dedupe ${source.id}:`, error.message || error);
      }
    }
    // 以 DB 为准重建 cache，避免残留已软删的重复项
    const limit = Math.max(source.limit || 50, 5000);
    let dbEntries = [];
    try {
      dbEntries = store.listEntriesBySource(source.id, limit) || [];
    } catch {
      dbEntries = entries;
    }
    const cachedEntries = (dbEntries.length ? dbEntries : entries).map(storedEntryForCache).filter(Boolean);
    const changedEntries = changedEntriesAfterUpsert(previousHashes, cachedEntries);
    const fetchedAt = Date.now();
    cacheRef()[source.id] = {
      fetchedAt,
      lastAttemptAt: fetchedAt,
      nextRetryAt: 0,
      failureCount: 0,
      feedUrl,
      feedTitle: feedTitle || source.name,
      status: 'ok',
      error: null,
      entries: cachedEntries,
    };
    markCacheSourceChanged(source.id);
    saveDisk();
    return { ...cacheRef()[source.id], changedEntries };
  }

  function failedSourceResult(source, error) {
    const previous = cacheRef()[source.id];
    const now = Date.now();
    const failureCount = Math.max(0, Number(previous && previous.failureCount) || 0) + 1;
    const retryDelay = Math.min(30 * 60 * 1000, 60 * 1000 * (2 ** Math.min(4, failureCount - 1)));
    cacheRef()[source.id] = {
      ...(previous || { entries: [] }),
      fetchedAt: previous && previous.fetchedAt || 0,
      lastAttemptAt: now,
      nextRetryAt: now + retryDelay,
      failureCount,
      status: previous && previous.entries && previous.entries.length ? 'stale' : 'error',
      error: error ? String(error.message || error).slice(0, 200) : 'unknown error',
    };
    markCacheSourceChanged(source.id);
    saveDisk();
    return cacheRef()[source.id];
  }

  function recordSourceFailure(source, error) {
    if (!source || !source.id) return null;
    return failedSourceResult(source, error);
  }

  async function fetchCombinedSource(source) {
    const errors = [];
    const combinedEntries = [];
    const feedUrls = [];
    const feedTitles = [];

    for (const url of expandCandidates(source.feeds)) {
      try {
        const feed = await parseFeedUrl(url, source);
        feedUrls.push(url);
        if (feed.title) feedTitles.push(feed.title);
        combinedEntries.push(...(feed.items || []).map(item => normalizeItem(item, source, { feedUrl: url })));
      } catch (error) {
        errors.push(`${url}: ${error.message || error}`);
      }
    }

    if (!combinedEntries.length && Array.isArray(source.fallbackFeeds)) {
      for (const url of expandCandidates(source.fallbackFeeds)) {
        try {
          const feed = await parseFeedUrl(url, source);
          const limit = sourceLimit(source);
          let entries = dedupeEntries((feed.items || []).map(item => normalizeItem(item, source, { feedUrl: url })));
          if (!entries.length) throw new Error('fallback feed returned no usable entries');
          entries = newestEntries(entries, limit);
          try {
            entries = await hydrateSourceEntries(source, entries);
          } catch (hydrateErr) {
            console.warn(`[fetchCombinedSource:fallback] ${source.id} hydration failed, keeping feed entries:`, hydrateErr.message || hydrateErr);
          }
          entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
          return finalizeFetchedSource(source, entries, {
            feedUrl: url,
            feedTitle: feed.title || source.name,
          });
        } catch (error) {
          errors.push(`${url}: ${error.message || error}`);
        }
      }
    }

    if (!combinedEntries.length) throw new Error(errors.slice(0, 3).join('; ') || 'no feed items');

    const limit = sourceLimit(source);
    const uniqueEntries = dedupeEntries(combinedEntries);
    if (!uniqueEntries.length) throw new Error('combined feeds returned no usable entries');
    let entries = isHackerNewsSource(source)
      ? rankHackerNewsEntries(uniqueEntries, limit)
      : newestEntries(uniqueEntries, limit);
    try {
      entries = await hydrateSourceEntries(source, entries);
    } catch (hydrateErr) {
      console.warn(`[fetchCombinedSource] ${source.id} hydration failed, keeping feed entries:`, hydrateErr.message || hydrateErr);
    }
    entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
    return finalizeFetchedSource(source, entries, {
      feedUrl: feedUrls.join(', '),
      feedTitle: feedTitles[0] || source.name,
    });
  }

  async function fetchSource(source) {
    if (source && source.localOnly) {
      // 与 hydrate / 源 limit(2000) 对齐，避免本地收藏超过 500 时 cache 被截断
      const entries = store.listEntriesBySource(source.id, Math.max(source.limit || 50, 5000));
      cacheRef()[source.id] = {
        fetchedAt: Date.now(),
        lastAttemptAt: Date.now(),
        nextRetryAt: null,
        failureCount: 0,
        feedUrl: 'local-db',
        feedTitle: source.name,
        status: 'ok',
        error: null,
        entries,
      };
      // 本地源真相在 SQLite；切源/interaction 刷新不必把 60MB 全文再 stringify 进 cache.json
      // 仅更新内存 cache，磁盘在真正 RSS 变更或启动 hydrate 时再落
      return cacheRef()[source.id];
    }
    if (source && source.manual) {
      cacheRef()[source.id] = manualSourceCache(source);
      markCacheSourceChanged(source.id);
      saveDisk();
      return cacheRef()[source.id];
    }
    if (source && source.combineFeeds) {
      try {
        return await fetchCombinedSource(source);
      } catch (error) {
        return failedSourceResult(source, error);
      }
    }
    const candidates = expandCandidates(source.feeds);
    let lastErr = null;
    for (const url of candidates) {
      try {
        const feed = await parseFeedUrl(url, source);
        const limit = sourceLimit(source);
        let entries = dedupeEntries((feed.items || []).map(i => normalizeItem(i, source, { feedUrl: url })));
        if (!entries.length) throw new Error('feed returned no usable entries');
        entries = newestEntries(entries, limit);
        try {
          entries = await hydrateSourceEntries(source, entries);
        } catch (hydrateErr) {
          console.warn(`[fetchSource] ${source.id} hydration failed, keeping feed entries:`, hydrateErr.message || hydrateErr);
        }
        entries = isHackerNewsSource(source) ? rankHackerNewsEntries(entries, limit) : newestEntries(entries, limit);
        return finalizeFetchedSource(source, entries, {
          feedUrl: url,
          feedTitle: feed.title || source.name,
        });
      } catch (e) {
        lastErr = e;
      }
    }
    return failedSourceResult(source, lastErr);
  }

  async function refreshAll(onProgress) {
    const targets = SOURCES.filter(isEnabled);
    let idx = 0, done = 0;
    const changedEntries = [];
    async function worker() {
      while (idx < targets.length) {
        const source = targets[idx++];
        try {
          const result = await fetchSource(source);
          if (result && Array.isArray(result.changedEntries)) changedEntries.push(...result.changedEntries);
        } catch (error) {
          failedSourceResult(source, error);
          console.error(`[refreshAll] ${source.id} failed`, error);
        } finally {
          done++;
          if (onProgress) onProgress(done, targets.length, source.id);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { changedEntries };
  }

  return {
    fetchSource,
    refreshAll,
    recordSourceFailure,
    finalizeFetchedSource,
    failedSourceResult,
    fetchCombinedSource,
    parseFeedUrl,
    sourceLimit,
    parseWpJsonFeed,
    parseSitemapFeed,
    loadSitemapUrls,
    sitemapDocumentUrls,
  };
}

module.exports = { createSourceFetch };
