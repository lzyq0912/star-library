#!/usr/bin/env node
/**
 * 把 _preserved_blog_data/jsonl 导入 QMReader entries
 * 日期优先：frontmatter date → URL 路径日期 → published_at → crawled_at
 * publishedTs 使用毫秒（与 RSS 路径一致）
 *
 *   node scripts/import-preserved-blog.js [jsonl]
 *   node scripts/import-preserved-blog.js --dry-run              # 只打印 will delete/upsert，不写库
 *   node scripts/import-preserved-blog.js --apply-deletes        # 才执行 soft-delete（默认不删）
 *   node scripts/import-preserved-blog.js path/to.jsonl --apply-deletes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');

const store = require('../lib/store');
const { zhihuHtmlToMarkdown } = require('./zhihu-html-to-markdown');

const DEFAULT_JSONL = path.resolve(
  __dirname,
  '../../_preserved_blog_data/incremental/articles.jsonl',
);
const DEFAULT_SAVED_PAGES = path.resolve(__dirname, '../../Web/saved-pages.json');

function parseCliArgs(argv) {
  const opts = {
    file: DEFAULT_JSONL,
    dryRun: false,
    applyDeletes: false,
  };
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--apply-deletes') opts.applyDeletes = true;
    else if (!a.startsWith('-')) opts.file = a;
  }
  return opts;
}

/** 知乎源展示名（与 lib/sources.js 保持一致；勿用 URL slug 臆测） */
const ZHIHU_AUTHOR_BY_SOURCE = {
  'zhihu-tianqing': '天晴',
  'zhihu-lemonround': '猛猿',
  'zhihu-fafa': '良睦路程序员',
  'zhihu-yuanchao': '好奇的小逸',
  'zhihu-tongsanpang': '手抓饼熊',
  'zhihu-haotian': 'haotian',
};

const FM_DATE_RE = /^(?:date|published|publish_date|pubDate|updated):\s*['"]?([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}(?:[T\s][0-9:]+(?:Z|[+-][0-9:]+)?)?)['"]?\s*$/im;
const URL_DATE_RE = /\/((?:19|20)\d{2})\/(\d{1,2})\/(\d{1,2})\//;
const BAOYU_DATE_RE = /\/((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\//;

function stripFrontMatter(md) {
  let s = String(md || '').trim();
  for (let i = 0; i < 2; i++) {
    if (s.startsWith('---')) {
      const end = s.indexOf('\n---', 3);
      if (end !== -1) {
        s = s.slice(end + 4).trim();
        continue;
      }
    }
    break;
  }
  if (s.startsWith('#') && s.includes('\n---\n')) {
    const [head, ...rest] = s.split('\n---\n');
    if (/^- url:/m.test(head)) s = rest.join('\n---\n').trim();
  }
  return s;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function isSafeImageUrl(url) {
  const clean = String(url || '').trim();
  return isHttpUrl(clean) || /^\/article-images\/[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_.-]+$/i.test(clean);
}

function markdownPlainText(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairedArticleTitle(rawTitle, body, url) {
  const title = String(rawTitle || url || 'Untitled').trim() || 'Untitled';
  const generic = new Set([
    "arthurchiao's blog",
    'dwarkesh podcast',
    'exploring language models',
    'karpathy',
    'blog',
    'posts',
    'untitled',
  ]);
  if (!generic.has(title.toLowerCase())) return title;
  const heading = String(body || '').match(/^\s{0,3}#{1,3}\s+(.+)$/m);
  const repaired = heading ? markdownPlainText(heading[1]) : '';
  return repaired || title;
}

/** 从 markdown / html 抽首图 URL（封面） */
function firstImageUrl(text) {
  const raw = String(text || '');
  const md = raw.match(/!\[[^\]]*\]\((\/article-images\/[^)\s]+|https?:\/\/[^)\s]+)\)/i);
  if (md && isSafeImageUrl(md[1])) return md[1].trim();
  const html = raw.match(/<img\b[^>]*\bsrc=["'](\/article-images\/[^"']+|https?:\/\/[^"']+)["']/i);
  if (html && isSafeImageUrl(html[1])) return html[1].trim();
  // 错误导入残留：!<a href="url">
  const broken = raw.match(/!<a\s+href=["'](https?:\/\/[^"']+)["']/i);
  if (broken && isSafeImageUrl(broken[1])) return broken[1].trim();
  return null;
}

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      // 用 UTC 正午，避免时区把日期推到前一天
      const t = Date.UTC(y, mo - 1, d, hh || 12, mm, ss);
      if (Number.isFinite(t)) return t;
    }
  }
  const t = Date.parse(s);
  if (Number.isFinite(t) && t > 0) return t;
  return null;
}

function dateFromFrontMatter(md) {
  const text = String(md || '');
  // 优先第一段 frontmatter
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const block = text.slice(3, end);
      const m = block.match(FM_DATE_RE);
      if (m) return parseFlexibleDate(m[1]);
    }
  }
  // 正文里可能还有 trafilatura 的 yaml 头
  const m2 = text.slice(0, 2000).match(FM_DATE_RE);
  if (m2) return parseFlexibleDate(m2[1]);
  return null;
}

function dateFromUrl(url) {
  const u = String(url || '');
  let m = u.match(URL_DATE_RE);
  if (m) return parseFlexibleDate(`${m[1]}-${m[2]}-${m[3]}`);
  m = u.match(BAOYU_DATE_RE);
  if (m) return parseFlexibleDate(`${m[1]}-${m[2]}-${m[3]}`);
  return null;
}

/** @returns {{ published: string, publishedTs: number }} publishedTs 为毫秒 */
function resolvePublished(p) {
  const incrementalCrawl = Boolean(p && (p.source_id || p.content_hash));
  const candidates = [
    dateFromFrontMatter(p.content_md),
    dateFromUrl(p.url),
    parseFlexibleDate(p.published_at),
    incrementalCrawl ? null : parseFlexibleDate(p.crawled_at),
  ];
  for (const ts of candidates) {
    if (Number.isFinite(ts) && ts > 0) {
      return {
        published: new Date(ts).toISOString(),
        publishedTs: ts,
      };
    }
  }
  if (incrementalCrawl) return { published: null, publishedTs: 0 };
  const now = Date.now();
  return { published: new Date(now).toISOString(), publishedTs: now };
}

function loadJsonl(file) {
  const by = new Map();
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const key = o.content_id || o.url;
    if (key) by.set(key, o);
  }
  return [...by.values()];
}

function hostSourceId(host) {
  const map = {
    'lilianweng.github.io': 'lilianweng',
    'baoyu.io': 'baoyu',
    'karpathy.bearblog.dev': 'karpathy',
    'arthurchiao.art': 'arthurchiao',
    'www.aleksagordic.com': 'aleksagordic',
    'aleksagordic.com': 'aleksagordic',
    'gordicaleksa.medium.com': 'aleksagordic',
    'normaluhr.github.io': 'normaluhr',
    'shichaoxin.com': 'shichaoxin',
    'magazine.sebastianraschka.com': 'sebastianraschka',
    'www.dwarkesh.com': 'dwarkesh',
    'dwarkesh.com': 'dwarkesh',
    'dwarkeshpatel.com': 'dwarkesh',
    'newsletter.maartengrootendorst.com': 'maarten',
    'qingkeai.online': 'qingkeai',
    'rlhfbook.com': 'rlhfbook',
  };
  const h = String(host || '').replace(/^www\./, '');
  return map[host] || map[h] || 'zen-imported';
}

/** 知乎主站 / 专栏均认（www 已剥） */
function isZhihuHost(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return h === 'zhihu.com' || h === 'zhuanlan.zhihu.com' || h.endsWith('.zhihu.com');
}

function savedPageSourceId(page) {
  const url = String(page && page.url || '');
  const host = String(page && page.host || '').replace(/^www\./, '') || (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();
  if (isZhihuHost(host) && url.includes('/tian-qing-71-69/')) return 'zhihu-tianqing';
  if (isZhihuHost(host) && url.includes('/lemonround/')) return 'zhihu-lemonround';
  if (isZhihuHost(host) && url.includes('/fa-fa-1-94/')) return 'zhihu-fafa';
  if (isZhihuHost(host) && url.includes('/yuan-chao-yi-83/')) return 'zhihu-yuanchao';
  if (isZhihuHost(host) && url.includes('/tongsanpang/')) return 'zhihu-tongsanpang';
  if (host === 'chapterpal.com') return 'chapterpal';
  if (host === 'github.com' && url.includes('/thinkwee/AgentsMeetRL')) return 'agentsmeetrl';
  if (host === 'youtube.com' && url.includes('/@anthropic-ai')) return 'anthropic-youtube';
  if (host.endsWith('feishu.cn') && url.includes('/docx/EkmedzRGEouVCTxUqHLc08APnjh')) return 'romain-notes';
  return hostSourceId(host);
}

function isNonBlogSavedPage(page) {
  const url = String(page && page.url || '');
  let host = String(page && page.host || '').replace(/^www\./, '');
  if (!host) {
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
  }
  return host === 'chapterpal.com'
    || host === 'github.com'
    || host === 'youtube.com'
    || host.endsWith('feishu.cn')
    || host.endsWith('larksuite.com');
}

function loadSavedBlogPages(file) {
  if (!file || !fs.existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`saved pages ignored: ${error.message || error}`);
    return [];
  }
  return (Array.isArray(data.pages) ? data.pages : [])
    .filter(page => page && page.folder === '博客' && isHttpUrl(page.url));
}

function savedPageEntries(pages, importedEntries) {
  const importedLinks = new Set((importedEntries || [])
    .map(entry => String(entry && entry.link || '').trim())
    .filter(Boolean));
  const additions = [];
  for (const page of pages || []) {
    const url = String(page.url || '').trim();
    if (!url || importedLinks.has(url)) continue;
    let host = String(page.host || '').replace(/^www\./, '');
    if (!host) {
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
    }
    additions.push({
      id: crypto.createHash('md5').update(`zen-bookmark|${url}`).digest('hex'),
      sourceId: savedPageSourceId(page),
      title: String(page.title || url).trim() || url,
      link: url,
      author: host,
      published: null,
      publishedTs: 0,
      summary: '',
      content: '',
      image: null,
      audio: null,
    });
    importedLinks.add(url);
  }
  return additions;
}

function stripLegacySourceMeta(content) {
  return String(content || '').replace(
    /^<p><em>来源\s+<a\b[^>]*>[\s\S]*?<\/a>\s*·\s*[^<]*<\/em><\/p>\s*/i,
    '',
  ).replace(
    /^\s*\*?来源\*?\s+\*?\[[^\]]+\]\([^)]+\)\*?\s*·\s*[^\n]+\n+/i,
    '',
  );
}

/** 评论 / Support / 订阅落地页等，禁止当博文导入（与 crawl looks_like_article 对齐） */
const NON_ARTICLE_SEGMENTS = new Set([
  'comment', 'comments', 'support', 'about', 'privacy', 'terms', 'tos',
  'subscribe', 'subscription', 'coming-soon', 'login', 'signup', 'sign-up',
  'account', 'profile', 'membership', 'members', 'recommend', 'leaderboard',
  'shop', 'store', 'welcome', 'contact', 'donate', 'pledge', 'gift',
]);

function isNonArticleUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const pathName = (parsed.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    if (pathName === '/' || /^\/(?:archive|archives|support|about|privacy|terms|subscribe)$/.test(pathName)) {
      return true;
    }
    if (/\/(?:index|index\.html?|page\/\d+)$/.test(pathName)) return true;
    if (/\/(?:comment|comments)(?:\/|$)/.test(pathName)) return true;
    if (/\/(?:tag|tags|category|categories|author|authors|search)\//.test(pathName)) return true;
    const segments = pathName.split('/').filter(Boolean);
    if (segments.some(seg => NON_ARTICLE_SEGMENTS.has(seg))) return true;
    if (parsed.hostname.replace(/^www\./, '') === 'blog.csdn.net') return true;
    return false;
  } catch {
    return true;
  }
}

function isUsableArticlePost(post) {
  const body = stripFrontMatter(post && (post.content_md || post.content_text || ''));
  if (body.replace(/\s+/g, '').length < 80 || !isHttpUrl(post && post.url)) return false;
  if (isNonArticleUrl(post.url)) return false;
  return true;
}

function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const file = cli.file;
  const dryRun = cli.dryRun;
  const applyDeletes = cli.applyDeletes;
  const savedPagesFile = process.env.ZEN_SAVED_PAGES_FILE || DEFAULT_SAVED_PAGES;
  if (!fs.existsSync(file)) {
    console.error('jsonl not found:', file);
    process.exit(1);
  }
  const allPosts = loadJsonl(file);
  const posts = allPosts.filter(isUsableArticlePost);
  const invalidPosts = allPosts.filter(post => !isUsableArticlePost(post));
  console.log(
    `Loading ${posts.length} usable posts from ${file} (${allPosts.length - posts.length} invalid/empty skipped)`
    + ` dryRun=${dryRun} applyDeletes=${applyDeletes}`,
  );

  let invalidArticlesRemoved = 0;
  let wouldDeleteInvalid = 0;
  for (const post of invalidPosts) {
    const url = String(post && post.url || '').trim();
    if (!url) continue;
    const id = crypto.createHash('md5').update(`zen-import|${url}`).digest('hex');
    if (dryRun) {
      wouldDeleteInvalid += 1;
      console.log(`  [dry-run] will soft-delete invalid: ${id.slice(0, 12)} ${url.slice(0, 80)}`);
      continue;
    }
    if (!applyDeletes) continue;
    const result = store.softDeleteEntry(id, { reason: '列表页、首页或空正文不是文章' });
    if (result && !result.alreadyDeleted) invalidArticlesRemoved += 1;
  }
  if (!dryRun && !applyDeletes && invalidPosts.length) {
    console.log(`  soft-delete skipped for ${invalidPosts.length} invalid posts (pass --apply-deletes to delete)`);
  }

  let withFm = 0;
  let withUrl = 0;
  const entries = posts.map((p) => {
    const url = p.url || '';
    const host = (p.source_host || '').replace(/^www\./, '') || (() => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
    })();
    const sourceId = String(p.source_id || '').trim()
      || savedPageSourceId({ url: p.source_seed || url, host: p.source_host || host });
    let body = stripFrontMatter(p.content_md || p.content_text || '');
    if (!body) body = p.content_text || p.title || url;
    // 知乎导出常是 raw HTML，导入前转成 Markdown，避免阅读器按 MD 解析时版式崩溃
    if (String(sourceId).startsWith('zhihu-') || isZhihuHost(host) || /zhuanlan\.zhihu\.com|zhihu\.com\/p\//i.test(url)) {
      body = zhihuHtmlToMarkdown(body);
    }
    const title = repairedArticleTitle(p.title, body, url);
    const summary = markdownPlainText(body).slice(0, 280);
    const id = crypto.createHash('md5').update(`zen-import|${url || p.content_id || title}`).digest('hex');
    const { published, publishedTs } = resolvePublished(p);
    const image = firstImageUrl(p.content_md || body) || null;
    if (dateFromFrontMatter(p.content_md)) withFm += 1;
    else if (dateFromUrl(url)) withUrl += 1;
    return {
      id,
      sourceId,
      title,
      link: url,
      author: ZHIHU_AUTHOR_BY_SOURCE[sourceId] || host,
      published,
      publishedTs,
      summary,
      // 正文以原始 Markdown 入库；浏览器端统一用完整 GFM 解析器渲染。
      content: stripLegacySourceMeta(body),
      // 图片本地化后的正文必须替换旧的无图 HTML，即使抽取后的纯文本略短。
      forceContent: body.includes('/article-images/'),
      // 本地 crawl 导入即视为原文已就绪（宝玉/Arthur/知乎等），避免开文再「原文获取中」
      originalFetchedAt: (body.includes('/article-images/')
        || markdownPlainText(body).length >= 700
        || String(sourceId).startsWith('zhihu-'))
        ? Date.now()
        : undefined,
      image,
      audio: null,
    };
  });

  const savedPages = loadSavedBlogPages(savedPagesFile);
  const blogPages = savedPages.filter(page => !isNonBlogSavedPage(page));
  const nonBlogPages = savedPages.filter(isNonBlogSavedPage);
  // saved-pages 只负责提供博客来源，不再把博客首页或个人页伪装成文章。
  // 这些空正文书签正是“（无内容，请打开原文）”占位项的来源。
  const bookmarkEntries = [];
  let emptyBookmarksRemoved = 0;
  let wouldDeleteBookmarks = 0;
  for (const page of blogPages) {
    const url = String(page.url || '').trim();
    const id = crypto.createHash('md5').update(`zen-bookmark|${url}`).digest('hex');
    if (dryRun) {
      wouldDeleteBookmarks += 1;
      console.log(`  [dry-run] will soft-delete empty bookmark: ${id.slice(0, 12)} ${url.slice(0, 80)}`);
      continue;
    }
    if (!applyDeletes) continue;
    const result = store.softDeleteEntry(id, { reason: '博客来源书签不是文章，已从文章列表移除' });
    if (result && !result.alreadyDeleted) emptyBookmarksRemoved += 1;
  }

  let nonBlogSeparated = 0;
  let wouldSeparateNonBlog = 0;
  for (const page of nonBlogPages) {
    const url = String(page.url || '').trim();
    const id = crypto.createHash('md5').update(`zen-bookmark|${url}`).digest('hex');
    if (dryRun) {
      wouldSeparateNonBlog += 1;
      console.log(`  [dry-run] will soft-delete non-blog: ${id.slice(0, 12)} ${url.slice(0, 80)}`);
      continue;
    }
    if (!applyDeletes) continue;
    const result = store.softDeleteEntry(id, { reason: '已从博客阅读器分离到 non-blog-sources.json' });
    if (result && !result.alreadyDeleted) nonBlogSeparated += 1;
  }
  if (!dryRun && !applyDeletes && (blogPages.length || nonBlogPages.length)) {
    console.log(
      `  soft-delete skipped for bookmarks (blog=${blogPages.length}, non-blog=${nonBlogPages.length}); pass --apply-deletes`,
    );
  }

  let legacyMetaCleaned = 0;
  let wouldCleanLegacy = 0;
  for (const entry of entries) {
    const existing = store.getEntry(entry.id);
    if (!existing || !existing.content) continue;
    const cleaned = stripLegacySourceMeta(existing.content);
    if (!cleaned || cleaned === existing.content) continue;
    if (dryRun) {
      wouldCleanLegacy += 1;
      console.log(`  [dry-run] will clean legacy meta: ${entry.id.slice(0, 12)} ${entry.title.slice(0, 40)}`);
      continue;
    }
    store.updateEntryContent(entry.id, {
      content: cleaned,
      summary: existing.summary,
      image: existing.image,
    });
    legacyMetaCleaned += 1;
  }

  const BATCH = 50;
  if (dryRun) {
    console.log(`  [dry-run] will upsert ${entries.length} entries`);
    for (const e of entries.slice(0, 10)) {
      console.log(`    upsert ${e.sourceId} ${e.id.slice(0, 12)} ${(e.title || '').slice(0, 50)}`);
    }
    if (entries.length > 10) console.log(`    ... and ${entries.length - 10} more`);
  } else {
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH);
      store.upsertEntries(chunk);
      console.log(`  upserted ${Math.min(i + BATCH, entries.length)}/${entries.length}`);
    }
  }

  // 抽样校验
  const sample = entries
    .slice()
    .sort((a, b) => b.publishedTs - a.publishedTs)
    .slice(0, 5)
    .map((e) => `${e.published ? e.published.slice(0, 10) : 'undated'} | ${e.sourceId} | ${e.title.slice(0, 40)}`);
  const tag = dryRun ? '[dry-run]' : '[ok]';
  console.log(
    `${tag} imported ${entries.length} (articles=${posts.length}, invalid-skipped=${allPosts.length - posts.length}`
    + `, invalid-removed=${invalidArticlesRemoved}, blog-pages=${blogPages.length}`
    + `, empty-bookmarks-removed=${emptyBookmarksRemoved}, non-blog-pages=${nonBlogPages.length}`
    + `, bookmark-only=${bookmarkEntries.length}, non-blog-separated=${nonBlogSeparated}`
    + `, legacy-meta-cleaned=${legacyMetaCleaned}, fm=${withFm}, url-only fallback used when no fm)`
    + (dryRun
      ? ` wouldDeleteInvalid=${wouldDeleteInvalid} wouldDeleteBookmarks=${wouldDeleteBookmarks}`
        + ` wouldSeparateNonBlog=${wouldSeparateNonBlog} wouldCleanLegacy=${wouldCleanLegacy}`
      : ''),
  );
  console.log('[sample newest]');
  for (const line of sample) console.log(' ', line);
  console.log('data dir:', process.env.QMREADER_DATA_DIR || 'data/');
}

main();
