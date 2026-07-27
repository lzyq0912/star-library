/**
 * 本地小红书 / X 收藏 Markdown 同步进 QMReader。
 * 目录由外部爬虫维护；本模块扫盘 upsert，并可 watch 增量。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
// 未配置目录时留空 → 同步与媒体挂载自动跳过（在 .env 设 XHS_LIKES_DIR / X_LIKES_DIR 启用）
const XHS_ROOT = process.env.XHS_LIKES_DIR || '';
const X_ROOT = process.env.X_LIKES_DIR || '';

const SOURCE_XHS = 'xhs-likes';
const SOURCE_X = 'x-likes';
const META_MARKER = '<!--qm-social-v1';
const META_END = '-->';

const WATCH_DEBOUNCE_MS = Number(process.env.LIKES_WATCH_DEBOUNCE_MS || 2500);
/** 周期扫盘兜底（ms）。fs.watch 在批量写/原子替换时会漏事件，默认 20s 再对一下盘。 */
const POLL_MS = Number(process.env.LIKES_POLL_MS || 20_000);
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);

/** 各源上次成功扫盘指纹：`${mdCount}:${maxMtimeMs}`，未变则跳过重解析 */
const lastDirFingerprint = Object.create(null);
/** 最近一次同步元信息（给 API / 调试） */
let lastSyncMeta = {
  at: 0,
  results: [],
};

function md5(text) {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*([+-]\d{2}:?\d{2}|Z))?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      // 按本地东八区理解爬虫写出的时间
      const t = Date.parse(`${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+08:00`);
      if (Number.isFinite(t)) return t;
    }
  }
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? t : null;
}

function parseFrontMatter(md) {
  const text = String(md || '');
  if (!text.startsWith('---')) return { meta: {}, body: text.trim() };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text.trim() };
  const block = text.slice(3, end);
  const body = text.slice(end + 4).trim();
  const meta = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[m[1]] = value;
  }
  return { meta, body };
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

/** 去掉 Typora 排序前缀：文件名 `ale1t_标题` / `ah45h_…` / 目录 `0pl-2026-07` 不进展示标题 */
function stripTitlePrefix(title) {
  let t = String(title || '').trim();
  // 短 hash 前缀：3–8 位字母数字 + 下划线
  t = t.replace(/^[a-z0-9]{3,8}_/i, '');
  // 月目录排序前缀
  t = t.replace(/^0[a-z0-9]{1,3}-\d{4}-\d{2}[/_-]*/i, '');
  return t.trim() || String(title || '').trim();
}

function titleFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return stripTitlePrefix(base).replace(/-/g, ' ') || base;
}

/** 弱标题：纯链接 / t.co / 文件名把 URL 空格化后的残渣，不能当文章标题 */
function isWeakTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return true;
  if (raw.length < 2) return true;
  const plain = markdownPlainText(raw);
  if (!plain) return true;
  if (/^https?:\/\//i.test(plain)) return true;
  if (/^t\.co\//i.test(plain)) return true;
  // 文件名 `https-t-co-xxx` → `https t co xxx`
  if (/^https?\s+t\s+co\b/i.test(plain)) return true;
  if (/^https?\s/i.test(plain) && /(?:t\s*co|x\.com|twitter\.com)/i.test(plain) && plain.length < 80) {
    return true;
  }
  // 整行 markdown 链接且锚文本也是 URL
  if (/^\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$/i.test(raw)
    && /https?:\/\/|t\.co\//i.test(plain)) {
    return true;
  }
  // 几乎只有域名/路径碎片
  if (/^(?:www\.)?(?:x|twitter)\.com\b/i.test(plain)) return true;
  return false;
}

function isReservedHeadingText(text) {
  return /^(?:Media|引用|热门评论|\d+\.\s)/i.test(String(text || '').trim());
}

/**
 * X Article exports start with a level-2/3 Markdown heading. Normal posts do
 * not: their generated `title` is only a list label and must not become an h1.
 */
function extractXArticleTitle(body) {
  const firstContentLine = String(body || '')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map(line => line.trim())
    .find(line => {
      if (!line) return false;
      if (/^\[(?:打开原推|原文链接)\]\(https?:\/\/[^)]+\)$/i.test(line)) return false;
      if (/^\[[^\]]*https?:\/\/[^\]]*\]\(https?:\/\/[^)]+\)$/i.test(line)) return false;
      if (/^https?:\/\/\S+$/i.test(line)) return false;
      return true;
    });
  const match = firstContentLine && firstContentLine.match(/^#{2,3}\s+(.+)$/);
  if (!match || isReservedHeadingText(match[1])) return '';
  return stripTitlePrefix(markdownPlainText(match[1]));
}

function extractTitle(body, filePath, meta) {
  const text = String(body || '');
  const candidates = [];

  // 1) H1
  const h1 = text.match(/^\s{0,3}#\s+(.+)$/m);
  if (h1 && !isReservedHeadingText(h1[1])) {
    candidates.push(stripTitlePrefix(markdownPlainText(h1[1])));
  }
  // 2) 长文推文常用 ### 作文章标题（无 H1）
  const hx = text.match(/^\s{0,3}#{2,3}\s+(.+)$/m);
  if (hx && !isReservedHeadingText(hx[1])) {
    candidates.push(stripTitlePrefix(markdownPlainText(hx[1])));
  }
  // 3) frontmatter title
  if (meta && meta.title) candidates.push(stripTitlePrefix(meta.title));

  // 4) 正文首条有意义文本（跳过纯链接 / 打开原推）
  const firstLine = text
    .split('\n')
    .map(l => l.trim())
    .find(l => {
      if (!l) return false;
      if (/^#{1,6}\s/.test(l)) return false;
      if (/^!\[/.test(l)) return false;
      if (/^\[打开原推\]/.test(l) || /^\[原文链接\]/.test(l)) return false;
      if (/^\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$/i.test(l)) return false;
      if (/^https?:\/\/\S+$/i.test(l)) return false;
      const plain = markdownPlainText(l);
      return plain && !isWeakTitle(plain);
    });
  if (firstLine) {
    candidates.push(stripTitlePrefix(markdownPlainText(firstLine)).slice(0, 100));
  }

  for (const c of candidates) {
    if (c && !isWeakTitle(c)) return c;
  }

  const fromFile = titleFromFilename(filePath);
  if (fromFile && !isWeakTitle(fromFile) && fromFile.length >= 2) return fromFile;
  if (meta && meta.author) return `${String(meta.author).trim()} 的推文`;
  return '未命名推文';
}

function mediaWebPath(platform, absPath) {
  const root = platform === 'xhs' ? XHS_ROOT : X_ROOT;
  const mount = platform === 'xhs' ? '/likes-media/xhs' : '/likes-media/x';
  const resolved = path.resolve(absPath);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) return null;
  const rel = path.relative(rootResolved, resolved).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return null;
  return `${mount}/${rel}`;
}

function rewriteImageSrc(platform, mdDir, rawSrc) {
  const src = String(rawSrc || '').trim().replace(/^<|>$/g, '');
  if (!src) return null;
  if (src.startsWith('/likes-media/')) return src;
  if (src.startsWith('/article-images/')) return src;
  if (isHttpUrl(src)) return src;

  // 绝对本机路径
  if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) {
    return mediaWebPath(platform, src);
  }

  // 相对路径（相对 md 所在目录）
  const abs = path.resolve(mdDir, src);
  return mediaWebPath(platform, abs);
}

function collectMdImages(platform, mdDir, text) {
  const images = [];
  const re = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const web = rewriteImageSrc(platform, mdDir, match[2].trim());
    if (web) images.push({ src: web, alt: match[1] || '' });
  }
  return images;
}

function isReservedSectionHeading(line) {
  return /^\s{0,3}##\s+(?:Media\s*$|引用|热门评论)/i.test(String(line || ''));
}

function splitSections(body) {
  const text = String(body || '');
  const lines = text.split('\n');
  const sections = { title: '', beforeMedia: [], media: [], quote: [], comments: [], rest: [] };
  let mode = 'body';
  const bodyLines = [];
  for (const line of lines) {
    if (/^\s{0,3}##\s+Media\s*$/i.test(line)) {
      mode = 'media';
      continue;
    }
    if (/^\s{0,3}##\s+引用/.test(line)) {
      mode = 'quote';
      sections.quote.push(line);
      continue;
    }
    if (/^\s{0,3}##\s+热门评论/.test(line)) {
      mode = 'comments';
      continue;
    }
    // 仅一级标题作笔记标题；忽略 ## 分区标题（引用/评论/Media）
    if (/^\s{0,3}#\s+/.test(line) && !sections.title && mode === 'body' && !isReservedSectionHeading(line)) {
      sections.title = line.replace(/^\s{0,3}#\s+/, '').trim();
      continue;
    }
    if (mode === 'media') sections.media.push(line);
    else if (mode === 'quote') sections.quote.push(line);
    else if (mode === 'comments') sections.comments.push(line);
    else bodyLines.push(line);
  }

  // 清洗正文：去掉 PDF / 原文链接行
  const cleanedBody = bodyLines
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (/\*\*电子文档\*\*/.test(t)) return false;
      if (/点击查看\s*PDF/i.test(t)) return false;
      if (/^\[原文链接\]\(/.test(t)) return false;
      if (/^\[打开原推\]\(/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');

  return {
    title: sections.title,
    body: cleanedBody,
    mediaText: sections.media.join('\n'),
    quoteText: sections.quote.join('\n'),
    commentsText: sections.comments.join('\n'),
  };
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** 提取连续引用块为纯文本/markdown */
function extractBlockquoteText(chunk) {
  const lines = String(chunk || '').split('\n');
  const quoted = [];
  let inQuote = false;
  for (const line of lines) {
    if (/^>\s?/.test(line)) {
      inQuote = true;
      quoted.push(line.replace(/^>\s?/, ''));
      continue;
    }
    // 引用内空行常写作单独的 `>`
    if (inQuote && /^>\s*$/.test(line)) {
      quoted.push('');
      continue;
    }
    if (inQuote && !line.trim()) {
      quoted.push('');
      continue;
    }
    if (inQuote) break;
  }
  return decodeHtmlEntities(quoted.join('\n').trim());
}

function parseXhsComments(text) {
  const raw = String(text || '').trim()
    .replace(/^==展示点赞最高的前[^=]+==\s*/m, '')
    .trim();
  if (!raw) return [];
  const chunks = raw.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  const comments = [];
  for (const chunk of chunks) {
    // 1. ==**name** · 👍 n · time==  or  1. **name** · 👍 n · time
    const head = chunk.match(/^\d+\.\s*(?:==)?\*\*(.+?)\*\*\s*·\s*👍\s*(\d+)\s*·\s*([^\n=]+?)(?:==)?\s*$/m);
    if (!head) continue;
    let bodyText = extractBlockquoteText(chunk);
    // 无引用符时，取标题行之后到 details/--- 之前
    if (!bodyText) {
      bodyText = chunk
        .replace(/^\d+\.\s*.+\n/, '')
        .replace(/<details>[\s\S]*$/i, '')
        .replace(/^==|==$/gm, '')
        .trim();
      bodyText = decodeHtmlEntities(bodyText);
    }
    const replies = [];
    const details = chunk.match(/<details>[\s\S]*?<\/details>/i);
    if (details) {
      const replyBlocks = details[0]
        .replace(/<\/?details[^>]*>/gi, '')
        .replace(/<\/?summary[^>]*>[\s\S]*?<\/summary>/gi, '')
        .split(/\n(?=-\s*\*\*)/)
        .map(s => s.trim())
        .filter(Boolean);
      for (const rb of replyBlocks) {
        const m = rb.match(/^-\s*\*\*(.+?)\*\*\s*·\s*👍\s*(\d+)\s*·\s*([^\n]+)\n?([\s\S]*)$/);
        if (!m) continue;
        const replyText = extractBlockquoteText(m[4]) || decodeHtmlEntities(m[4].replace(/^>\s?/gm, '').trim());
        replies.push({
          author: m[1].trim(),
          likes: Number(m[2]) || 0,
          time: m[3].trim(),
          text: replyText,
        });
      }
    }
    comments.push({
      author: head[1].trim(),
      likes: Number(head[2]) || 0,
      time: head[3].trim(),
      text: bodyText,
      replies,
      highlight: /==\*\*/.test(chunk.slice(0, 80)),
    });
  }
  return comments;
}

function parseXCommentHead(block) {
  const line = String(block || '').split('\n')[0] || '';
  // ### 1. Name ([@user](url)) · ❤ 133
  let m = line.match(/^###\s+\d+\.\s+(.+?)\s+\(\[@([^\]]+)\]\([^)]+\)\)\s*(?:·\s*[❤❤️]\s*(\d+))?/);
  if (m) {
    return {
      author: m[1].trim(),
      username: String(m[2] || '').replace(/^@/, '').trim(),
      likes: Number(m[3]) || 0,
    };
  }
  // ### 1. Name (@user) · ❤ 28
  m = line.match(/^###\s+\d+\.\s+(.+?)\s+\(@([^)]+)\)\s*(?:·\s*[❤❤️]\s*(\d+))?/);
  if (m) {
    return {
      author: m[1].trim(),
      username: String(m[2] || '').replace(/^@/, '').trim(),
      likes: Number(m[3]) || 0,
    };
  }
  return null;
}

function parseXComments(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const comments = [];
  const blocks = raw.split(/\n(?=###\s+\d+\.)/);
  for (const block of blocks) {
    const head = parseXCommentHead(block);
    if (!head) continue;
    let body = block
      .replace(/^###\s+\d+\.[^\n]*\n?/, '')
      .replace(/^\s+|\s+$/g, '');
    body = decodeHtmlEntities(body);
    // 有中文译文时去掉评论里的「> 原文」英文块
    body = stripXOriginalIfChinesePresent(body);
    comments.push({
      author: head.author,
      username: head.username,
      likes: head.likes,
      time: '',
      text: body,
      replies: [],
    });
  }
  return comments;
}

/**
 * X 收藏常见结构：中文译文在前，文末 `> 原文` 后挂英文原稿。
 * 有中文译文时只保留译文（可点原网址看英文）。
 */
function stripXOriginalIfChinesePresent(body) {
  let text = String(body || '');
  // 匹配独立「原文」标记行：> 原文 / **原文** / ### 原文
  const re = /(?:^|\n)[ \t]*(?:>[ \t]*)?(?:\*\*)?原文(?:\*\*)?[ \t]*(?:\n|$)/;
  const m = re.exec(text);
  if (!m) return text;
  const before = text.slice(0, m.index).trim();
  const chineseChars = (before.match(/[\u4e00-\u9fff]/g) || []).length;
  // 前文需有一定中文量，避免误伤纯英文帖里偶发的「原文」二字
  if (chineseChars < 8) return text;
  return before;
}

/** 清洗正文：保留可读 markdown 结构 */
function normalizeSocialBody(body, platform) {
  let text = decodeHtmlEntities(body || '');
  // 去掉打开原推/原文链接残留
  text = text
    .replace(/^\[打开原推\]\([^)]+\)\s*/gm, '')
    .replace(/^\[原文链接\]\([^)]+\)\s*/gm, '')
    .replace(/^\*\*电子文档\*\*[^\n]*\n?/gm, '')
    .replace(/^📄\s*\[[^\]]*\]\([^)]+\)\s*/gm, '');
  if (platform === 'x') {
    // 文首仅 t.co / x.com 短链占位行（长文推文常见），去掉以免标题/摘要被污染
    text = text.replace(
      /^(?:[ \t]*(?:\[[^\]]*\]\(https?:\/\/(?:t\.co\/[^)]+|x\.com\/[^)]+|twitter\.com\/[^)]+)\)|https?:\/\/(?:t\.co|x\.com|twitter\.com)\/\S+)[ \t]*\n)+/i,
      '',
    );
    text = stripXOriginalIfChinesePresent(text);
  }
  // 中文数字标题「一、」前补空行，利于分段
  text = text.replace(/([^\n])\n([一二三四五六七八九十]+[、.．])/g, '$1\n\n$2');
  // 编号列表：行首 1、 或 1. 规范化
  text = text.replace(/^(\d+)[、．]\s*/gm, '$1. ');
  // 压多余空行
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function parseXQuote(quoteText) {
  const text = String(quoteText || '').trim();
  if (!text) return null;
  const head = text.match(/^##\s+引用\s*·\s*@?(\S+)/);
  const link = text.match(/\[@?([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const lines = text.split('\n').slice(1).filter(l => {
    const t = l.trim();
    if (!t) return true;
    if (/^\[@?/.test(t)) return false;
    if (/^https?:\/\//.test(t)) return false;
    if (/^###\s+/.test(t)) return true;
    return true;
  });
  // drop leading empty and media-only
  let body = lines.join('\n').trim();
  body = body.replace(/^###\s+.+\n?/, (m) => m); // keep subtitle if any
  const images = [];
  body = body.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_, alt, src) => {
    images.push({ alt, src });
    return '';
  }).trim();
  // 嵌入转发帖同样：有简体译文时去掉「> 原文」英文块
  body = stripXOriginalIfChinesePresent(decodeHtmlEntities(body));
  return {
    author: head ? head[1].replace(/^@/, '') : (link ? link[1] : ''),
    username: head ? head[1].replace(/^@/, '') : (link ? link[1] : ''),
    url: link ? link[2] : '',
    text: markdownPlainText(body).slice(0, 2000),
    body,
  };
}

function tagsFromMeta(meta) {
  const raw = String(meta.tags || '').trim();
  if (!raw) return [];
  return raw.split(/[\s,，]+/).map(t => t.trim()).filter(Boolean).slice(0, 30);
}

/**
 * 收藏/点赞时间（liked_at / collected_at）：排序锚点 + 列表/详情展示。
 * X = 用户 like 时间；小红书 = 收藏时间。帖子 created_at 仅作次级排序键。
 */
function resolveFavoritedRaw(meta) {
  const liked = String((meta && meta.liked_at) || '').trim();
  const collected = String((meta && meta.collected_at) || '').trim();
  return liked || collected || '';
}

/**
 * 展示时间原始串：X / 小红书均用收藏（like）时间，不再用帖子发布时间。
 */
function resolveDisplayRaw(_platform, meta) {
  return resolveFavoritedRaw(meta);
}

/** 展示用：`2026-07-13 17:34:23`（去掉 +0800 / Z） */
function formatFavoritedClock(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, '0');
    const d = String(m[3]).padStart(2, '0');
    const hh = String(m[4]).padStart(2, '0');
    const mm = String(m[5]).padStart(2, '0');
    const ss = String(m[6] || '0').padStart(2, '0');
    return `${y}-${mo}-${d} ${hh}:${mm}:${ss}`;
  }
  const t = parseFlexibleDate(s);
  if (!t) return '';
  // 东八区墙钟
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const pick = type => parts.find(p => p.type === type)?.value || '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function buildPayload(platform, filePath, meta, sections, images) {
  const noteId = String(meta.id || path.basename(filePath, '.md'));
  const author = String(meta.author || '').trim();
  const username = String(meta.username || '').trim();
  const url = String(meta.url || '').trim();
  const createdAtRaw = String(meta.created_at || '').trim();
  const favoritedRaw = resolveFavoritedRaw(meta);
  const displayRaw = resolveDisplayRaw(platform, meta);
  const likedAt = favoritedRaw;
  const comments = platform === 'xhs'
    ? parseXhsComments(sections.commentsText)
    : parseXComments(sections.commentsText);
  const quote = platform === 'x' ? parseXQuote(sections.quoteText) : null;
  const body = normalizeSocialBody(sections.body, platform);

  return {
    v: 1,
    platform,
    noteId,
    author,
    username,
    authorId: String(meta.author_id || '').trim(),
    url,
    type: String(meta.type || (platform === 'xhs' ? '图文' : '推文')).trim(),
    likes: Number(meta.likes) || 0,
    collected: Number(meta.collected) || 0,
    commentsCount: Number(meta.comments) || comments.length,
    tags: tagsFromMeta(meta),
    createdAt: formatFavoritedClock(createdAtRaw) || createdAtRaw,
    likedAt,
    collectedAt: String(meta.collected_at || '').trim(),
    favoritedAt: formatFavoritedClock(favoritedRaw) || favoritedRaw,
    // 列表/详情展示用（X = like 时间，小红书 = 收藏时间）
    displayAt: formatFavoritedClock(displayRaw) || displayRaw,
    title: (() => {
      const fromSection = stripTitlePrefix(sections.title || '');
      if (fromSection && !isWeakTitle(fromSection)) return fromSection;
      return extractTitle(body, filePath, meta);
    })(),
    body,
    images,
    quote,
    comments,
  };
}

/**
 * Typora 相对路径（调试/稳定键用）。
 * X 列表排序：liked_at DESC → created_at DESC（同时 like 时发布时间越新越前）。
 */
function typoraRelPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

/** macOS 文件创建时间；无效时回退 mtime。 */
function fileCreatedMs(filePath) {
  try {
    const st = fs.statSync(filePath);
    const birth = Number(st.birthtimeMs);
    if (Number.isFinite(birth) && birth > 0) return Math.round(birth);
    const mtime = Number(st.mtimeMs);
    if (Number.isFinite(mtime) && mtime > 0) return Math.round(mtime);
    return 0;
  } catch {
    return 0;
  }
}

function fileMtimeMs(filePath) {
  try {
    return Math.round(Number(fs.statSync(filePath).mtimeMs) || 0);
  } catch {
    return 0;
  }
}

/**
 * 跨源「全部」与单源共用 publishedTs：必须用真实时间轴。
 * 旧实现 pathOrderPublishedTs(newestAnchor - index*1s) 会把整仓几百条
 * 挤进「刚刚」附近几十秒，导致「全部」最前面全是 X/小红书收藏。
 *
 * 规则：收藏/点赞时间优先，否则展示时间；同秒用 created_at 毫秒分量作微扰（≤999ms），
 * 不改变跨天/跨源的相对顺序。
 */
function likesSortPublishedTs(entry) {
  const liked = Number(entry && entry._likedTs) || 0;
  const display = Number(entry && entry._displayTs) || 0;
  const created = Number(entry && entry._createdTs) || 0;
  const base = liked || display || created || Date.now();
  // 同秒收藏：created 的 ms 分量作稳定次级键（不跨秒污染）
  const tie = created > 0 ? (created % 1000) : 0;
  return base + tie;
}

/**
 * X / 小红书条目排序：
 * 1) 收藏时间 liked_at/collected_at 越新越前
 * 2) 同一次 like：帖子 created_at 越新越前
 * 3) 路径作稳定次序
 */
function compareLikesEntries(a, b) {
  const likedA = Number(a._likedTs) || 0;
  const likedB = Number(b._likedTs) || 0;
  if (likedA !== likedB) return likedB - likedA;
  const createdA = Number(a._createdTs) || 0;
  const createdB = Number(b._createdTs) || 0;
  if (createdA !== createdB) return createdB - createdA;
  return String(a._rel || '').localeCompare(String(b._rel || ''), 'en');
}

function encodeContent(payload) {
  const json = JSON.stringify(payload);
  // 人类可读兜底正文：若前端不识别 meta 仍能显示
  const fallbackParts = [];
  if (payload.title) fallbackParts.push(`# ${payload.title}`);
  if (payload.body) fallbackParts.push(payload.body);
  if (payload.images && payload.images.length) {
    fallbackParts.push('## Media');
    for (const img of payload.images) {
      fallbackParts.push(`![${img.alt || ''}](${img.src})`);
    }
  }
  return `${META_MARKER}\n${json}\n${META_END}\n\n${fallbackParts.join('\n\n')}`;
}

function parseStoredContent(content) {
  const text = String(content || '');
  if (!text.startsWith(META_MARKER)) return null;
  // JSON strings may legitimately contain `-->`; only accept our line sentinel.
  let end = text.indexOf(`\n${META_END}`, META_MARKER.length);
  if (end === -1) end = text.indexOf(META_END, META_MARKER.length);
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(META_MARKER.length, end).trim());
  } catch {
    return null;
  }
}

function walkMarkdownFiles(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMarkdownFiles(full, out);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

/** 可同步的 md 列表（跳过「有用」归档夹） */
function listSyncMarkdownFiles(root) {
  return walkMarkdownFiles(root)
    .filter(f => !typoraRelPath(root, f).split('/').includes('有用'));
}

/**
 * 目录指纹：文件数 + 最大 mtime + mtime 校验和。
 * 仅 count:maxM 时，改写「非最新」文件可能漏扫；加上 sum 可感知内容批量更新。
 */
function dirFingerprint(root) {
  const files = listSyncMarkdownFiles(root);
  let maxM = 0;
  let sumM = 0;
  for (const f of files) {
    try {
      const m = Math.round(Number(fs.statSync(f).mtimeMs) || 0);
      if (m > maxM) maxM = m;
      // 无符号 32-bit 累加，避免极大 sum
      sumM = (sumM + (m >>> 0)) >>> 0;
    } catch { /* ignore */ }
  }
  return `${files.length}:${maxM}:${sumM.toString(16)}`;
}

function entryFromMarkdown(platform, sourceId, filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.warn(`[likes-sync] read fail ${filePath}:`, error && error.message ? error.message : error);
    return null;
  }
  const { meta, body } = parseFrontMatter(raw);
  const xArticleTitle = platform === 'x' ? extractXArticleTitle(body) : '';
  const sections = splitSections(body);
  if (xArticleTitle) {
    sections.title = xArticleTitle;
    // The native article view renders its own h1; keep it out of the body.
    sections.body = sections.body
      .replace(/(^|\n)\s*#{2,3}\s+[^\n]+\n?/, '$1')
      .trim();
  }
  const mdDir = path.dirname(filePath);
  const mediaImages = collectMdImages(platform, mdDir, sections.mediaText);
  const bodyImages = collectMdImages(platform, mdDir, sections.body);
  // 正文里的图也并入，但 Media 区优先
  const seen = new Set(mediaImages.map(i => i.src));
  const images = mediaImages.slice();
  for (const img of bodyImages) {
    if (!seen.has(img.src)) {
      seen.add(img.src);
      images.push(img);
    }
  }
  // 去掉正文中的图片 markdown，改由原生 UI 展示
  sections.body = sections.body
    .replace(/!\[([^\]]*)\]\([^)\n]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 标题：H1 / ### 长文标题 / 正文首句；拒绝 t.co 等弱标题
  const sectionTitle = stripTitlePrefix(sections.title || '');
  if (sectionTitle && !isWeakTitle(sectionTitle)) {
    sections.title = sectionTitle;
  } else {
    sections.title = extractTitle(sections.body, filePath, meta);
  }
  // 引用区图片也本地化
  if (sections.quoteText) {
    sections.quoteText = sections.quoteText.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_, alt, src) => {
      const web = rewriteImageSrc(platform, mdDir, src.trim());
      return web ? `![${alt}](${web})` : '';
    });
  }
  const fileTs = fileCreatedMs(filePath) || fileMtimeMs(filePath) || Date.now();
  const payload = buildPayload(platform, filePath, meta, sections, images);
  if (platform === 'x') {
    payload.kind = xArticleTitle ? 'article' : 'post';
    payload.isArticle = Boolean(xArticleTitle);
  }
  payload.fileCreatedAt = new Date(fileTs).toISOString();
  // 展示时间：X / 小红书均为收藏（like）时间；均无则回退文件创建时间
  const displayTs = parseFlexibleDate(resolveDisplayRaw(platform, meta))
    || parseFlexibleDate(meta.liked_at)
    || parseFlexibleDate(meta.collected_at)
    || fileTs;
  if (!payload.displayAt) {
    payload.displayAt = formatFavoritedClock(new Date(displayTs).toISOString());
  }
  if (!payload.favoritedAt) {
    payload.favoritedAt = formatFavoritedClock(payload.fileCreatedAt) || payload.displayAt;
  }
  if (!payload.likedAt) {
    payload.likedAt = payload.favoritedAt;
  }
  const likedTs = parseFlexibleDate(meta.liked_at)
    || parseFlexibleDate(meta.collected_at)
    || fileTs;
  const createdTs = parseFlexibleDate(meta.created_at) || displayTs || fileTs;
  const root = platform === 'xhs' ? XHS_ROOT : X_ROOT;
  const rel = typoraRelPath(root, filePath);
  const stableKey = String(meta.id || meta.url || rel);
  const id = md5(`${sourceId}|${stableKey}`);
  const title = payload.title || titleFromFilename(filePath);
  const summary = markdownPlainText(payload.body).slice(0, 280)
    || (payload.tags && payload.tags.length ? payload.tags.join(' ') : '')
    || title;
  const link = isHttpUrl(meta.url) ? meta.url : `likes://${sourceId}/${encodeURIComponent(stableKey)}`;

  return {
    id,
    sourceId,
    title,
    link,
    author: payload.author || payload.username || (platform === 'xhs' ? '小红书' : 'X'),
    // published = 展示时间（X=like 时间）；publishedTs 在 sync 里按 like+发布时间序覆写
    published: new Date(displayTs).toISOString(),
    publishedTs: displayTs,
    summary,
    content: encodeContent(payload),
    forceContent: true,
    image: images[0] ? images[0].src : null,
    audio: null,
    _filePath: filePath,
    _rel: rel,
    _displayTs: displayTs,
    _likedTs: likedTs,
    _createdTs: createdTs,
  };
}

function syncPlatform({ platform, sourceId, root, limit = 0, force = false } = {}) {
  if (!root || !fs.existsSync(root)) {
    return {
      platform,
      sourceId,
      root,
      files: 0,
      imported: 0,
      failed: 0,
      missing: true,
    };
  }

  const files = listSyncMarkdownFiles(root);
  const fp = dirFingerprint(root);
  // 盘面未变且非强制：跳过重解析（仍由调用方 refreshLocalSources 保 cache）
  // 自愈：内存指纹未变但 DB 条数明显少于盘面时强制重扫（进程卡死/漏事件后恢复）
  if (!force && !limit && lastDirFingerprint[sourceId] === fp) {
    let dbCount = -1;
    try {
      dbCount = store.countEntriesBySource(sourceId);
    } catch { /* ignore */ }
    if (!(dbCount >= 0 && dbCount < files.length)) {
      return {
        platform,
        sourceId,
        root,
        files: files.length,
        imported: 0,
        failed: 0,
        skipped: true,
        fingerprint: fp,
        dbCount,
      };
    }
    console.warn(`[likes-sync] ${sourceId}: fingerprint ok but DB ${dbCount} < disk ${files.length}, force resync`);
  }

  const selected = limit > 0
    ? files.slice().sort((a, b) => typoraRelPath(root, a).localeCompare(typoraRelPath(root, b), 'en')).slice(0, limit)
    : files;

  const entries = [];
  let failed = 0;
  const parsed = [];
  for (const file of selected) {
    try {
      const entry = entryFromMarkdown(platform, sourceId, file);
      if (!entry) {
        failed += 1;
        continue;
      }
      parsed.push(entry);
    } catch (error) {
      failed += 1;
      console.warn(`[likes-sync] skip ${file}:`, error.message || error);
    }
  }

  // 排序：收藏时间 DESC → 发布时间 DESC（同时 like 时越新越前）
  parsed.sort(compareLikesEntries);

  parsed.forEach((entry) => {
    const displayTs = Number(entry._displayTs) || Date.now();
    // 展示：X/小红书 = 收藏（like）时间，写入 published 供列表读
    entry.published = new Date(displayTs).toISOString();
    // 排序：真实收藏时间（跨源「全部」可与 RSS 按时间混排）
    entry.publishedTs = likesSortPublishedTs(entry);
    delete entry._filePath;
    delete entry._rel;
    delete entry._displayTs;
    delete entry._likedTs;
    delete entry._createdTs;
    entries.push(entry);
  });

  const batchSize = 80;
  for (let i = 0; i < entries.length; i += batchSize) {
    store.upsertEntries(entries.slice(i, i + batchSize));
  }
  lastDirFingerprint[sourceId] = fp;
  return {
    platform,
    sourceId,
    root,
    files: files.length,
    imported: entries.length,
    failed,
    fingerprint: fp,
  };
}

function isSourceSyncable(fetcher, sourceId) {
  if (!fetcher || typeof fetcher.getSourceById !== 'function') return true;
  const src = fetcher.getSourceById(sourceId);
  if (!src) return false;
  if (typeof fetcher.isEnabled === 'function') return fetcher.isEnabled(src);
  return src.enabled !== false;
}

function skippedDisabled(platform, sourceId, root) {
  return {
    platform,
    sourceId,
    root,
    files: 0,
    imported: 0,
    failed: 0,
    skipped: true,
    disabled: true,
  };
}

function syncAll(options = {}) {
  const results = [];
  const fetcher = options.fetcher || null;
  if (!isSourceSyncable(fetcher, SOURCE_XHS)) {
    results.push(skippedDisabled('xhs', SOURCE_XHS, XHS_ROOT));
  } else if (fs.existsSync(XHS_ROOT)) {
    results.push(syncPlatform({
      platform: 'xhs',
      sourceId: SOURCE_XHS,
      root: XHS_ROOT,
      limit: options.limit || 0,
      force: Boolean(options.force),
    }));
  } else {
    results.push({ platform: 'xhs', sourceId: SOURCE_XHS, root: XHS_ROOT, files: 0, imported: 0, failed: 0, missing: true });
  }
  if (!isSourceSyncable(fetcher, SOURCE_X)) {
    results.push(skippedDisabled('x', SOURCE_X, X_ROOT));
  } else if (fs.existsSync(X_ROOT)) {
    results.push(syncPlatform({
      platform: 'x',
      sourceId: SOURCE_X,
      root: X_ROOT,
      limit: options.limit || 0,
      force: Boolean(options.force),
    }));
  } else {
    results.push({ platform: 'x', sourceId: SOURCE_X, root: X_ROOT, files: 0, imported: 0, failed: 0, missing: true });
  }
  lastSyncMeta = { at: Date.now(), results };
  return results;
}

/** 按源 id 扫盘（x-likes / xhs-likes）；其它 id 返回 null */
function syncBySourceId(sourceId, options = {}) {
  const id = String(sourceId || '').trim();
  const fetcher = options.fetcher || null;
  if (id === SOURCE_X) {
    if (!isSourceSyncable(fetcher, SOURCE_X)) {
      const result = skippedDisabled('x', SOURCE_X, X_ROOT);
      lastSyncMeta = { at: Date.now(), results: [result] };
      return result;
    }
    const result = syncPlatform({
      platform: 'x',
      sourceId: SOURCE_X,
      root: X_ROOT,
      limit: options.limit || 0,
      force: options.force !== false, // 单源 API 默认强制，保证点刷新必重扫
    });
    lastSyncMeta = { at: Date.now(), results: [result] };
    return result;
  }
  if (id === SOURCE_XHS) {
    if (!isSourceSyncable(fetcher, SOURCE_XHS)) {
      const result = skippedDisabled('xhs', SOURCE_XHS, XHS_ROOT);
      lastSyncMeta = { at: Date.now(), results: [result] };
      return result;
    }
    const result = syncPlatform({
      platform: 'xhs',
      sourceId: SOURCE_XHS,
      root: XHS_ROOT,
      limit: options.limit || 0,
      force: options.force !== false,
    });
    lastSyncMeta = { at: Date.now(), results: [result] };
    return result;
  }
  return null;
}

function getLastSyncMeta() {
  return lastSyncMeta;
}

function refreshLocalSources(fetcher) {
  if (!fetcher || typeof fetcher.fetchSource !== 'function' || typeof fetcher.getSourceById !== 'function') return;
  for (const id of [SOURCE_X, SOURCE_XHS]) {
    if (!isSourceSyncable(fetcher, id)) continue;
    const source = fetcher.getSourceById(id);
    if (source) {
      try {
        // localOnly：同步从 DB 灌 cache
        const result = fetcher.fetchSource(source);
        if (result && typeof result.then === 'function') result.catch(() => {});
      } catch (error) {
        console.warn(`[likes-sync] refresh ${id}:`, error.message || error);
      }
    }
  }
}

function startWatch({ onSync, fetcher } = {}) {
  const roots = [
    { root: XHS_ROOT, label: 'xhs' },
    { root: X_ROOT, label: 'x' },
  ].filter(item => fs.existsSync(item.root));

  if (!roots.length) {
    console.warn('[likes-sync] watch skipped: roots missing');
    return () => {};
  }

  let timer = null;
  let pollTimer = null;
  let running = false;
  let pending = false;
  const watchers = [];

  const run = async ({ reason = 'watch' } = {}) => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    // 防止异常路径卡死 running，导致后续 poll/watch 全部空转
    const stuckTimer = setTimeout(() => {
      if (running) {
        console.warn(`[likes-sync] ${reason} still running >90s, releasing lock`);
        running = false;
      }
    }, 90_000);
    if (typeof stuckTimer.unref === 'function') stuckTimer.unref();
    try {
      // 周期轮询 / watch 均走指纹：盘面未变则 skip 重解析；禁用/已删源不扫盘
      const results = syncAll({ force: false, fetcher });
      const anyParsed = results.some(r => r && !r.skipped && !r.missing && !r.disabled);
      // 有扫盘结果时从 DB 灌 cache；listEntriesBySource 很轻，保证 UI entryCount 即时
      if (anyParsed) refreshLocalSources(fetcher);
      if (typeof onSync === 'function') onSync(results);
      if (anyParsed) {
        const imported = results.reduce((n, r) => n + (r.imported || 0), 0);
        // 写文件日志时 Node 可能全缓冲；显式换行 + 立即可见
        console.log(`[likes-sync] ${reason} sync done: imported=${imported} (${results.map(r => `${r.sourceId}:${r.skipped ? 'skip' : `${r.imported}/${r.files}`}`).join(', ')})`);
      }
    } catch (error) {
      console.warn(`[likes-sync] ${reason} sync failed:`, error.message || error);
    } finally {
      clearTimeout(stuckTimer);
      running = false;
      if (pending) {
        pending = false;
        timer = setTimeout(() => run({ reason: 'watch' }), WATCH_DEBOUNCE_MS);
      }
    }
  };

  const schedule = (filename) => {
    // 空 filename：部分平台只给 event 不给路径，仍应调度
    if (filename && !/\.md$/i.test(filename) && !/\.(jpe?g|png|gif|webp)$/i.test(filename)) {
      // 目录 rename / 新建月文件夹时也调度
      if (!/^[0-9a-z].+/i.test(filename) && !filename.includes('/')) return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => run({ reason: 'watch' }), WATCH_DEBOUNCE_MS);
  };

  for (const item of roots) {
    try {
      const watcher = fs.watch(item.root, { recursive: true }, (_event, filename) => {
        schedule(filename ? String(filename) : '');
      });
      watcher.on('error', (error) => {
        console.warn(`[likes-sync] watch error (${item.label}):`, error.message || error);
      });
      watchers.push(watcher);
      console.log(`[likes-sync] watching ${item.root}`);
    } catch (error) {
      console.warn(`[likes-sync] cannot watch ${item.root}:`, error.message || error);
    }
  }

  // 周期兜底：爬虫原子写/漏事件时仍能进库
  if (POLL_MS > 0) {
    pollTimer = setInterval(() => {
      run({ reason: 'poll' }).catch(() => {});
    }, Math.max(5000, POLL_MS));
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
    console.log(`[likes-sync] poll every ${Math.max(5000, POLL_MS)}ms (fingerprint skip)`);
  }

  return () => {
    clearTimeout(timer);
    if (pollTimer) clearInterval(pollTimer);
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  };
}

module.exports = {
  XHS_ROOT,
  X_ROOT,
  SOURCE_XHS,
  SOURCE_X,
  META_MARKER,
  parseStoredContent,
  syncAll,
  syncPlatform,
  syncBySourceId,
  getLastSyncMeta,
  dirFingerprint,
  startWatch,
  refreshLocalSources,
  encodeContent,
  extractXArticleTitle,
  mediaWebPath,
};
