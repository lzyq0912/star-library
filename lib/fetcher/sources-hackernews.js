'use strict';

/**
 * Hacker News source helpers + discussion hydration.
 *
 * 门面接入（lib/fetcher.js）：
 *   const { createHackerNews } = require('./fetcher/sources-hackernews');
 *   const hn = createHackerNews({
 *     HACKERNEWS_SOURCE_ID, HACKERNEWS_DISCUSSION_FETCH_LIMIT, ...
 *     cheerio, stripHtml, escapeHtmlForHtml, absoluteUrl, hostnameOf,
 *     decodeEntities, normalizeFeedContent, fetchText, fetchJson,
 *     parseRssUrl, mapLimit, linkHtml,
 *   });
 *   // 方式 A：Object.assign 到门面作用域 / 导出
 *   Object.assign(exports, hn);
 *   // 方式 B：解构后本地使用
 *   const { isHackerNewsSource, hydrateHackerNewsEntries, ... } = hn;
 *
 * 禁止本模块 require('../fetcher') 或 require('../../lib/fetcher')，避免循环依赖。
 * @param {object} deps injected from facade — no require('../fetcher')
 */

function createHackerNews(deps) {
  const {
    HACKERNEWS_SOURCE_ID = 'hackernews',
    HACKERNEWS_DISCUSSION_FETCH_LIMIT = 4,
    HACKERNEWS_AUTHOR_LOOKUP_LIMIT = 2,
    HACKERNEWS_THREAD_COMMENT_FETCH_COUNT = 30,
    HACKERNEWS_DISCUSSION_COMMENT_LIMIT = 8,
    HACKERNEWS_AUTHOR_REPLY_LIMIT = 5,
    HACKERNEWS_API_COMMENT_FETCH_LIMIT = 10,
    cheerio: cheerioDep,
    stripHtml,
    escapeHtmlForHtml,
    absoluteUrl,
    hostnameOf,
    decodeEntities,
    normalizeFeedContent,
    fetchText,
    fetchJson: fetchJsonDep,
    parseRssUrl,
    mapLimit,
    linkHtml: linkHtmlDep,
  } = deps;

  const cheerio = cheerioDep || require('cheerio');

  async function fetchJson(url, timeout) {
    if (typeof fetchJsonDep === 'function') return fetchJsonDep(url, timeout);
    const text = await fetchText(url, timeout);
    return JSON.parse(text);
  }

  function linkHtml(url, label) {
    if (typeof linkHtmlDep === 'function') return linkHtmlDep(url, label);
    if (!url) return '';
    return `<a href="${escapeHtmlForHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtmlForHtml(label)}</a>`;
  }

  function stripHtmlKeepUrls(value) {
    return String(value || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isHackerNewsSource(source) {
    return Boolean(source && source.id === HACKERNEWS_SOURCE_ID);
  }

  function isHackerNewsEntry(entry) {
    return Boolean(entry && entry.sourceId === HACKERNEWS_SOURCE_ID);
  }

  function isHackerNewsItemUrl(value) {
    try {
      const url = new URL(decodeEntities(String(value || '').replace(/&amp;/g, '&')));
      return url.hostname.replace(/^www\./, '').toLowerCase() === 'news.ycombinator.com'
        && /^\/item\/?$/i.test(url.pathname)
        && Boolean(url.searchParams.get('id'));
    } catch {
      return false;
    }
  }

  function hackerNewsItemIdFromUrl(value) {
    try {
      const url = new URL(decodeEntities(String(value || '').replace(/&amp;/g, '&')));
      if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'news.ycombinator.com') return '';
      if (!/^\/item\/?$/i.test(url.pathname)) return '';
      return /^\d+$/.test(url.searchParams.get('id') || '') ? url.searchParams.get('id') : '';
    } catch {
      const match = /news\.ycombinator\.com\/item\?[^"'<>#\s]*\bid=(\d+)/i.exec(String(value || ''));
      return match ? match[1] : '';
    }
  }

  function hackerNewsUrlsFromValue(value, baseUrl = '') {
    const urls = [];
    const seen = new Set();
    const add = raw => {
      const url = absoluteUrl(decodeEntities(String(raw || '').replace(/&amp;/g, '&')), baseUrl);
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };
    const html = String(value || '');
    if (html) {
      const $ = cheerio.load(html, { decodeEntities: false }, false);
      $('a[href]').each((_, el) => add($(el).attr('href')));
    }
    const urlRe = /https?:\/\/[^\s"'<>）)]+/gi;
    let match;
    while ((match = urlRe.exec(stripHtmlKeepUrls(value)))) add(match[0]);
    return urls;
  }

  function hackerNewsItemIdFromText(...values) {
    for (const value of values) {
      const fromUrl = hackerNewsItemIdFromUrl(value);
      if (fromUrl) return fromUrl;
      const match = /news\.ycombinator\.com\/item\?[^"'<>#\s]*\bid=(\d+)/i.exec(String(value || ''));
      if (match) return match[1];
    }
    return '';
  }

  function hackerNewsThreadUrl(itemId) {
    return itemId ? `https://news.ycombinator.com/item?id=${itemId}` : '';
  }

  function hackerNewsItemIdFromFeedItem(item) {
    return hackerNewsItemIdFromText(
      item && item.comments,
      item && item.guid,
      item && item.link,
      item && item.content,
      item && item.description,
      item && item.summary,
    );
  }

  function hackerNewsItemIdFromEntry(entry) {
    return hackerNewsItemIdFromText(
      entry && entry.content,
      entry && entry.summary,
      entry && entry.link,
    );
  }

  function hackerNewsArticleUrlFromItem(item) {
    const link = item && item.link ? String(item.link).trim() : '';
    if (link && !isHackerNewsItemUrl(link)) return link;
    const values = [
      item && item.content,
      item && item.description,
      item && item.summary,
      item && item.contentSnippet,
    ];
    for (const value of values) {
      const url = hackerNewsUrlsFromValue(value, link).find(candidate => !isHackerNewsItemUrl(candidate) && hostnameOf(candidate) !== 'hnrss.org');
      if (url) return url;
    }
    return link;
  }

  function hackerNewsStatsFromContent(value) {
    const text = stripHtml(value || '').replace(/\s+/g, ' ');
    const numberFrom = pattern => {
      const match = pattern.exec(text);
      return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
    };
    return {
      points: numberFrom(/\bPoints:\s*([\d,]+)/i),
      comments: numberFrom(/#\s*Comments:\s*([\d,]+)/i) || numberFrom(/\bComments:\s*([\d,]+)/i),
    };
  }

  function hackerNewsEntryStats(entry) {
    return hackerNewsStatsFromContent(`${entry && entry.content || ''}\n${entry && entry.summary || ''}`);
  }

  function hackerNewsFeedWeight(feedUrl) {
    const value = String(feedUrl || '').toLowerCase();
    if (value.includes('/active')) return 36;
    if (value.includes('/frontpage')) return 28;
    if (value.includes('/best')) return 22;
    return 0;
  }

  function hackerNewsValueScore(entry) {
    const stats = hackerNewsEntryStats(entry);
    const ageHours = entry && entry.publishedTs ? Math.max(0, (Date.now() - entry.publishedTs) / 3600000) : 48;
    const freshness = Math.max(0, 30 - ageHours) * 0.8;
    return stats.points + stats.comments * 3 + hackerNewsFeedWeight(entry && entry.hnFeedUrl) + freshness;
  }

  function mergeHackerNewsEntry(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const existingScore = hackerNewsValueScore(existing);
    const incomingScore = hackerNewsValueScore(incoming);
    const primary = incomingScore > existingScore ? incoming : existing;
    const secondary = primary === incoming ? existing : incoming;
    const content = stripHtml(incoming.content).length > stripHtml(existing.content).length
      ? incoming.content
      : existing.content;
    const link = primary.link && !isHackerNewsItemUrl(primary.link)
      ? primary.link
      : (secondary.link && !isHackerNewsItemUrl(secondary.link) ? secondary.link : primary.link || secondary.link || '');
    const feedUrl = [existing.hnFeedUrl, incoming.hnFeedUrl].filter(Boolean).join(', ');
    return {
      ...primary,
      link,
      author: primary.author || secondary.author || '',
      content,
      summary: primary.summary && primary.summary.length >= (secondary.summary || '').length ? primary.summary : secondary.summary || primary.summary,
      hnFeedUrl: feedUrl,
    };
  }

  function rankHackerNewsEntries(entries, limit) {
    const byId = new Map();
    for (const entry of entries || []) {
      const key = hackerNewsItemIdFromEntry(entry) || entry.id;
      byId.set(key, mergeHackerNewsEntry(byId.get(key), entry));
    }
    return Array.from(byId.values())
      .sort((a, b) => hackerNewsValueScore(b) - hackerNewsValueScore(a) || (b.publishedTs - a.publishedTs))
      .slice(0, limit);
  }

  function formatHackerNewsDate(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(time));
    } catch {
      return '';
    }
  }

  function hackerNewsCommentTextHtml(comment) {
    const text = String(comment && comment.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length > 760) return `<p>${escapeHtmlForHtml(`${text.slice(0, 760)}...`)}</p>`;
    const html = String(comment && comment.content || '').trim();
    return html || `<p>${escapeHtmlForHtml(text)}</p>`;
  }

  function hackerNewsCommentListHtml(comments) {
    return (comments || []).map(comment => {
      const meta = [
        comment.author ? escapeHtmlForHtml(comment.author) : '',
        formatHackerNewsDate(comment.published),
        comment.link ? linkHtml(comment.link, '评论链接') : '',
      ].filter(Boolean).join(' · ');
      const body = hackerNewsCommentTextHtml(comment);
      if (!body) return '';
      return [
        '<li class="hn-comment">',
        meta ? `<div class="hn-comment-meta">${meta}</div>` : '',
        `<blockquote>${body}</blockquote>`,
        '</li>',
      ].join('');
    }).filter(Boolean).join('');
  }

  function hackerNewsEntryContent(entry, discussion = {}) {
    const baseStats = hackerNewsEntryStats(entry);
    const stats = {
      points: discussion.points || baseStats.points,
      comments: discussion.commentsCount || baseStats.comments,
    };
    const itemId = hackerNewsItemIdFromEntry(entry);
    const threadUrl = discussion.threadUrl || hackerNewsThreadUrl(itemId);
    const articleLink = entry && entry.link && !isHackerNewsItemUrl(entry.link) ? linkHtml(entry.link, '原文') : '';
    const threadLink = threadUrl ? linkHtml(threadUrl, 'HN 讨论') : '';
    const submitter = discussion.author || (entry && entry.author) || '';
    const rows = [
      articleLink ? `<li><strong>原文</strong><span>${articleLink}</span></li>` : '',
      threadLink ? `<li><strong>讨论</strong><span>${threadLink}</span></li>` : '',
      submitter ? `<li><strong>提交者</strong><span>${escapeHtmlForHtml(submitter)}</span></li>` : '',
      stats.points ? `<li><strong>Points</strong><span>${stats.points}</span></li>` : '',
      stats.comments ? `<li><strong>Comments</strong><span>${stats.comments}</span></li>` : '',
    ].filter(Boolean).join('');
    const authorReplies = hackerNewsCommentListHtml(discussion.authorReplies || []);
    const comments = hackerNewsCommentListHtml(discussion.comments || []);
    const storyText = discussion.storyTextHtml && stripHtml(discussion.storyTextHtml).length ? discussion.storyTextHtml : '';
    const originalMeta = stripHtml(entry && entry.content || '').length ? entry.content : '';
    return [
      '<article class="hackernews-brief">',
      '<h2>Hacker News 线索</h2>',
      rows ? `<ul class="hn-meta-list">${rows}</ul>` : '',
      originalMeta && !/class=["']hackernews-brief["']/i.test(originalMeta) ? `<section class="hn-feed-meta">${originalMeta}</section>` : '',
      storyText ? '<h2>提交正文</h2>' : '',
      storyText ? `<section class="hn-story-text">${storyText}</section>` : '',
      authorReplies ? '<h2>作者回复</h2>' : '',
      authorReplies ? `<ol class="hn-comment-list hn-author-replies">${authorReplies}</ol>` : '',
      comments ? '<h2>讨论摘录</h2>' : '',
      comments ? `<ol class="hn-comment-list">${comments}</ol>` : '',
      !authorReplies && !comments && stats.comments ? '<p>HN 讨论区有评论，但本次刷新没有取到可用的评论正文。</p>' : '',
      !stats.comments ? '<p>当前还没有 HN 评论。</p>' : '',
      '</article>',
    ].filter(Boolean).join('');
  }

  function hackerNewsSummary(entry, discussion = {}) {
    const baseStats = hackerNewsEntryStats(entry);
    const stats = {
      points: discussion.points || baseStats.points,
      comments: discussion.commentsCount || baseStats.comments,
    };
    const authorText = (discussion.authorReplies || []).map(comment => comment.text).find(Boolean);
    const commentText = (discussion.comments || []).map(comment => comment.text).find(Boolean);
    const storyText = stripHtml(discussion.storyTextHtml || '').replace(/\s+/g, ' ').trim();
    const lead = authorText ? `作者回复：${authorText}` : (commentText ? `讨论摘录：${commentText}` : (storyText || stripHtml(entry && entry.summary || entry && entry.content || '')));
    const prefix = [
      stats.points ? `${stats.points} points` : '',
      stats.comments ? `${stats.comments} comments` : '',
    ].filter(Boolean).join(' / ');
    return [prefix ? `Hacker News：${prefix}` : 'Hacker News', lead]
      .filter(Boolean)
      .join('。')
      .slice(0, 320);
  }

  function parseHackerNewsCommentItem(item, threadUrl) {
    const rawContent = item && (item.contentEncoded || item['content:encoded'] || item.content || item.summary || item.description) || '';
    const baseUrl = item && (item.link || item.guid) || threadUrl || '';
    const content = normalizeFeedContent(rawContent, baseUrl);
    const text = stripHtml(content).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return {
      id: item && (item.guid || item.id || item.link) || '',
      author: item && (item.creator || item.dcCreator || item.author) || '',
      published: item && (item.isoDate || item.pubDate) || '',
      link: item && (item.link || item.guid) || '',
      content,
      text,
    };
  }

  function hackerNewsApiItemUrl(itemId) {
    return `https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(itemId)}.json`;
  }

  async function fetchHackerNewsApiItem(itemId) {
    const item = await fetchJson(hackerNewsApiItemUrl(itemId), 8000);
    return item && typeof item === 'object' && !item.deleted && !item.dead ? item : null;
  }

  function hackerNewsApiCommentToComment(item) {
    if (!item || item.deleted || item.dead || item.type !== 'comment' || !item.text) return null;
    const content = normalizeFeedContent(item.text, hackerNewsThreadUrl(item.id));
    const text = stripHtml(content).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return {
      id: String(item.id || ''),
      author: item.by || '',
      published: item.time ? new Date(item.time * 1000).toISOString() : '',
      link: hackerNewsThreadUrl(item.id),
      content,
      text,
    };
  }

  async function fetchHackerNewsApiComments(ids, limit) {
    const targetIds = (ids || []).slice(0, limit).filter(Boolean);
    const items = await mapLimit(targetIds, 6, id => fetchHackerNewsApiItem(id).catch(() => null));
    return items
      .map(hackerNewsApiCommentToComment)
      .filter(Boolean);
  }

  function hackerNewsAlgoliaCommentToComment(hit) {
    if (!hit || !hit.comment_text) return null;
    const id = String(hit.objectID || hit.id || '').trim();
    const content = normalizeFeedContent(hit.comment_text, id ? hackerNewsThreadUrl(id) : '');
    const text = stripHtml(content).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return {
      id,
      author: hit.author || '',
      published: hit.created_at || '',
      link: id ? hackerNewsThreadUrl(id) : '',
      content,
      text,
    };
  }

  async function fetchHackerNewsAlgoliaAuthorReplies(itemId, author) {
    if (!itemId || !author) return [];
    const url = [
      'https://hn.algolia.com/api/v1/search_by_date?',
      `tags=comment,author_${encodeURIComponent(author)},story_${encodeURIComponent(itemId)}`,
      `&hitsPerPage=${HACKERNEWS_AUTHOR_REPLY_LIMIT}`,
    ].join('');
    const data = await fetchJson(url, 6000);
    return uniqueHackerNewsComments((data && data.hits || [])
      .map(hackerNewsAlgoliaCommentToComment)
      .filter(Boolean))
      .slice(0, HACKERNEWS_AUTHOR_REPLY_LIMIT);
  }

  async function fetchHackerNewsApiDiscussion(itemId) {
    const story = await fetchHackerNewsApiItem(itemId);
    if (!story) throw new Error('HN API item not found');
    const threadUrl = hackerNewsThreadUrl(itemId);
    const author = story.by || '';
    const storyTextHtml = story.text ? normalizeFeedContent(story.text, threadUrl) : '';
    const comments = await fetchHackerNewsApiComments(story.kids || [], HACKERNEWS_API_COMMENT_FETCH_LIMIT);
    let authorReplies = [];
    if (author) {
      try {
        authorReplies = await fetchHackerNewsAlgoliaAuthorReplies(itemId, author);
      } catch { authorReplies = []; }
    }
    const authorReplyKeys = new Set(authorReplies.map(comment => comment.id || `${comment.author}|${comment.text.slice(0, 80)}`));
    return {
      threadUrl,
      author,
      points: story.score || 0,
      commentsCount: story.descendants || 0,
      storyTextHtml,
      authorReplies,
      comments: comments
        .filter(comment => !authorReplyKeys.has(comment.id || `${comment.author}|${comment.text.slice(0, 80)}`))
        .slice(0, HACKERNEWS_DISCUSSION_COMMENT_LIMIT),
      story,
    };
  }

  function uniqueHackerNewsComments(comments) {
    const seen = new Set();
    return (comments || []).filter(comment => {
      const key = comment.id || `${comment.author}|${comment.text.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function fetchHackerNewsThreadComments(itemId, threadUrl) {
    const feed = await parseRssUrl(`https://hnrss.org/item?id=${encodeURIComponent(itemId)}&count=${HACKERNEWS_THREAD_COMMENT_FETCH_COUNT}`);
    return uniqueHackerNewsComments((feed.items || [])
      .map(item => parseHackerNewsCommentItem(item, threadUrl))
      .filter(Boolean));
  }

  async function fetchHackerNewsAuthorReplies(itemId, author, threadUrl) {
    if (!author) return [];
    const feed = await parseRssUrl(`https://hnrss.org/item?id=${encodeURIComponent(itemId)}&author=${encodeURIComponent(author)}&count=${HACKERNEWS_AUTHOR_REPLY_LIMIT}`);
    return uniqueHackerNewsComments((feed.items || [])
      .map(item => parseHackerNewsCommentItem(item, threadUrl))
      .filter(Boolean));
  }

  async function hydrateHackerNewsEntry(entry, { allowAuthorLookup = false } = {}) {
    if (!isHackerNewsEntry(entry)) return entry;
    const itemId = hackerNewsItemIdFromEntry(entry);
    const threadUrl = hackerNewsThreadUrl(itemId);
    const stats = hackerNewsEntryStats(entry);
    if (!itemId) {
      return {
        ...entry,
        summary: hackerNewsSummary(entry),
        content: hackerNewsEntryContent(entry, { threadUrl }),
      };
    }

    try {
      const discussion = await fetchHackerNewsApiDiscussion(itemId);
      const link = entry.link && !isHackerNewsItemUrl(entry.link)
        ? entry.link
        : (discussion.story && discussion.story.url || entry.link || threadUrl);
      return {
        ...entry,
        link,
        author: discussion.author || entry.author,
        summary: hackerNewsSummary(entry, discussion),
        content: hackerNewsEntryContent({ ...entry, link, author: discussion.author || entry.author }, discussion),
      };
    } catch { /* fall back to HNRSS thread feed */ }

    try {
      const allComments = await fetchHackerNewsThreadComments(itemId, threadUrl);
      let authorReplies = entry.author
        ? allComments.filter(comment => comment.author && comment.author.toLowerCase() === entry.author.toLowerCase())
        : [];
      if (!authorReplies.length && allowAuthorLookup && entry.author) {
        try {
          authorReplies = await fetchHackerNewsAuthorReplies(itemId, entry.author, threadUrl);
        } catch { /* keep general thread comments */ }
      }
      authorReplies = uniqueHackerNewsComments(authorReplies).slice(0, HACKERNEWS_AUTHOR_REPLY_LIMIT);
      const authorReplyKeys = new Set(authorReplies.map(comment => comment.id || `${comment.author}|${comment.text.slice(0, 80)}`));
      const comments = allComments
        .filter(comment => !authorReplyKeys.has(comment.id || `${comment.author}|${comment.text.slice(0, 80)}`))
        .slice(0, HACKERNEWS_DISCUSSION_COMMENT_LIMIT);
      const discussion = { threadUrl, authorReplies, comments };
      return {
        ...entry,
        summary: hackerNewsSummary(entry, discussion),
        content: hackerNewsEntryContent(entry, discussion),
      };
    } catch {
      return {
        ...entry,
        summary: hackerNewsSummary(entry),
        content: hackerNewsEntryContent(entry, { threadUrl }),
      };
    }
  }

  async function hydrateHackerNewsEntries(entries) {
    const hydrated = [];
    let fetched = 0;
    for (const entry of entries || []) {
      const stats = hackerNewsEntryStats(entry);
      const shouldFetchDiscussion = fetched < HACKERNEWS_DISCUSSION_FETCH_LIMIT
        && hackerNewsItemIdFromEntry(entry)
        && (stats.comments > 0 || fetched < HACKERNEWS_AUTHOR_LOOKUP_LIMIT);
      if (shouldFetchDiscussion) {
        hydrated.push(await hydrateHackerNewsEntry(entry, { allowAuthorLookup: fetched < HACKERNEWS_AUTHOR_LOOKUP_LIMIT }));
        fetched += 1;
      } else {
        hydrated.push({
          ...entry,
          summary: hackerNewsSummary(entry),
          content: hackerNewsEntryContent(entry, { threadUrl: hackerNewsThreadUrl(hackerNewsItemIdFromEntry(entry)) }),
        });
      }
    }
    return hydrated;
  }

  function mergeHackerNewsOriginalContent(entry, extracted) {
    if (!isHackerNewsEntry(entry)) return extracted && extracted.content || '';
    const discussion = /class=["']hackernews-brief["']/i.test(String(entry && entry.content || ''))
      ? entry.content
      : hackerNewsEntryContent(entry, { threadUrl: hackerNewsThreadUrl(hackerNewsItemIdFromEntry(entry)) });
    return [
      '<article class="hn-original-article">',
      '<h2>原文正文</h2>',
      extracted && extracted.content ? extracted.content : '',
      '</article>',
      discussion,
    ].filter(Boolean).join('\n');
  }

  return {
    isHackerNewsSource,
    isHackerNewsEntry,
    isHackerNewsItemUrl,
    hackerNewsItemIdFromUrl,
    hackerNewsUrlsFromValue,
    hackerNewsItemIdFromText,
    hackerNewsThreadUrl,
    hackerNewsItemIdFromFeedItem,
    hackerNewsItemIdFromEntry,
    hackerNewsArticleUrlFromItem,
    hackerNewsStatsFromContent,
    hackerNewsEntryStats,
    hackerNewsFeedWeight,
    hackerNewsValueScore,
    mergeHackerNewsEntry,
    rankHackerNewsEntries,
    formatHackerNewsDate,
    hackerNewsCommentTextHtml,
    hackerNewsCommentListHtml,
    hackerNewsEntryContent,
    hackerNewsSummary,
    parseHackerNewsCommentItem,
    hackerNewsApiItemUrl,
    fetchHackerNewsApiItem,
    hackerNewsApiCommentToComment,
    fetchHackerNewsApiComments,
    hackerNewsAlgoliaCommentToComment,
    fetchHackerNewsAlgoliaAuthorReplies,
    fetchHackerNewsApiDiscussion,
    uniqueHackerNewsComments,
    fetchHackerNewsThreadComments,
    fetchHackerNewsAuthorReplies,
    hydrateHackerNewsEntry,
    hydrateHackerNewsEntries,
    mergeHackerNewsOriginalContent,
  };
}

module.exports = { createHackerNews };
