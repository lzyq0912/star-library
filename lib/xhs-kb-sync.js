/**
 * 本地知识库小红书博主 → QMReader（小红书原生 social 格式）
 * 源目录默认：~/本机/知识库/小红书
 * 输出：content 内嵌 <!--qm-social-v1 ...-->，与 xhs-likes 同一渲染链路
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { encodeContent } = require('./likes-sync');

// 未配置目录时留空 → 各博主导入与 /kb-media 挂载自动跳过（在 .env 设 XHS_KB_DIR 启用）
const KB_ROOT = process.env.XHS_KB_DIR || '';

const MEDIA_MOUNT = '/kb-media';

/** @type {Array<{id:string,name:string,author:string,displayPin:number,description:string}>} */
const KB_SOURCES = [
  {
    id: 'xhs-wanyouyinli',
    name: '万有引力AI',
    author: '万有引力AI',
    displayPin: 3,
    description: '知识库 · Claude / Agent / Vibe Coding 主页归档',
  },
  {
    id: 'xhs-luoye',
    name: '落叶带走秋风',
    author: '落叶带走秋风',
    displayPin: 4,
    description: '知识库 · 大模型算法面经与研究观察合集',
  },
  {
    id: 'xhs-shutiao',
    name: '整点薯条',
    author: '整点🍟',
    displayPin: 5,
    description: '知识库 · LLM 秋招 / 面试 / RL 笔记',
  },
];

function md5(text) {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch {
    return null;
  }
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

function formatClockFromMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const pick = type => parts.find(p => p.type === type)?.value || '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const t = Date.parse(`${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+08:00`);
      if (Number.isFinite(t)) return t;
    }
  }
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? t : null;
}

function fileMtimeMs(filePath) {
  try {
    return Math.round(Number(fs.statSync(filePath).mtimeMs) || 0);
  } catch {
    return 0;
  }
}

/** 知识库相对路径 → /kb-media/...（分段 encode） */
function mediaWebPath(absPath) {
  const resolved = path.resolve(absPath);
  const rootResolved = path.resolve(KB_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) return null;
  const rel = path.relative(rootResolved, resolved).split(path.sep).filter(Boolean);
  if (!rel.length) return null;
  return `${MEDIA_MOUNT}/${rel.map(seg => encodeURIComponent(seg)).join('/')}`;
}

function rewriteImageSrc(mdDir, rawSrc) {
  const src = String(rawSrc || '').trim().replace(/^<|>$/g, '');
  if (!src) return null;
  if (src.startsWith(MEDIA_MOUNT + '/')) return src;
  if (isHttpUrl(src)) return src;
  if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) {
    return mediaWebPath(src);
  }
  return mediaWebPath(path.resolve(mdDir, src));
}

function collectImages(mdDir, text) {
  const images = [];
  const re = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const web = rewriteImageSrc(mdDir, match[2].trim());
    if (web) images.push({ src: web, alt: match[1] || '' });
  }
  return images;
}

function stripImages(md) {
  return String(md || '')
    .replace(/!\[([^\]]*)\]\([^)\n]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTagsFromBody(body) {
  const tags = [];
  const re = /#([^\s#\[\]（）()]+?)(?:\[话题\])?#/g;
  let m;
  while ((m = re.exec(String(body || '')))) {
    const t = m[1].replace(/[，,。.!！?？:：]+$/g, '').trim();
    if (t && !tags.includes(t)) tags.push(t);
  }
  // 简洁 #tag
  const re2 = /(?:^|[\s，,])#([\u4e00-\u9fffA-Za-z0-9_+\-]{1,30})(?=[\s，,]|$)/g;
  while ((m = re2.exec(String(body || '')))) {
    const t = m[1].trim();
    if (t && !tags.includes(t)) tags.push(t);
  }
  return tags.slice(0, 30);
}

/** 文末 *作者 | 2026/1/8 15:35:37 浙江* */
function parseAuthorSignature(text) {
  const m = String(text || '').match(/\*([^*\n|]+?)\s*\|\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)[^*\n]*\*/);
  if (!m) return { author: '', dateRaw: '', clean: String(text || '') };
  const author = m[1].trim();
  const dateRaw = m[2].trim().replace(/\//g, '-');
  const clean = String(text || '').replace(m[0], '').trim();
  return { author, dateRaw, clean };
}

function stripMetaListHeader(body) {
  // 去掉文首「- ID:」一类元数据块（若仍残留）
  return String(body || '')
    .replace(/^(?:\s*-\s*(?:ID|类型|作者|链接|点赞|收藏|评论)\s*:[^\n]*\n)+/m, '')
    .trim();
}

function buildEntry({
  sourceId,
  author,
  title,
  body,
  images,
  noteId,
  url,
  authorId,
  type,
  likes,
  collected,
  commentsCount,
  tags,
  createdMs,
  stableKey,
}) {
  const displayMs = Number(createdMs) || Date.now();
  const clock = formatClockFromMs(displayMs);
  const cleanBody = stripMetaListHeader(stripImages(body));
  const finalTags = (tags && tags.length) ? tags : extractTagsFromBody(cleanBody);
  const payload = {
    v: 1,
    platform: 'xhs',
    noteId: String(noteId || stableKey || title || 'note'),
    author: author || '小红书',
    username: '',
    authorId: String(authorId || '').trim(),
    url: isHttpUrl(url) ? url : '',
    type: String(type || '图文').trim(),
    likes: Number(likes) || 0,
    collected: Number(collected) || 0,
    commentsCount: Number(commentsCount) || 0,
    tags: finalTags,
    createdAt: clock,
    likedAt: clock,
    collectedAt: clock,
    favoritedAt: clock,
    displayAt: clock,
    title: String(title || '').trim() || '未命名笔记',
    body: cleanBody,
    images: images || [],
    quote: null,
    comments: [],
    source: 'xhs-kb',
  };

  const id = md5(`${sourceId}|${stableKey}`);
  const summary = markdownPlainText(cleanBody).slice(0, 280) || payload.title;
  const link = isHttpUrl(url)
    ? url
    : `kb-xhs://${sourceId}/${encodeURIComponent(String(stableKey))}`;

  return {
    id,
    sourceId,
    title: payload.title,
    link,
    author: payload.author,
    published: new Date(displayMs).toISOString(),
    publishedTs: displayMs,
    summary,
    content: encodeContent(payload),
    forceContent: true,
    image: images && images[0] ? images[0].src : null,
    audio: null,
  };
}

function upsertBatch(entries) {
  const batchSize = 80;
  for (let i = 0; i < entries.length; i += batchSize) {
    store.upsertEntries(entries.slice(i, i + batchSize));
  }
}

// ─── 万有引力AI ───────────────────────────────────────────

function importWanyouyinli() {
  const notesRoot = path.join(KB_ROOT, '万有引力AI', 'notes');
  const sourceId = 'xhs-wanyouyinli';
  if (!fs.existsSync(notesRoot)) {
    return { sourceId, imported: 0, failed: 0, missing: true, root: notesRoot };
  }
  const entries = [];
  let failed = 0;
  let dirs;
  try {
    dirs = fs.readdirSync(notesRoot, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch {
    return { sourceId, imported: 0, failed: 0, missing: true, root: notesRoot };
  }

  for (const ent of dirs) {
    const dir = path.join(notesRoot, ent.name);
    const mdPath = path.join(dir, 'note.md');
    if (!fs.existsSync(mdPath)) {
      failed += 1;
      continue;
    }
    try {
      const raw = readText(mdPath);
      const jsonPath = path.join(dir, 'note.json');
      const json = safeReadJson(jsonPath);
      const note = ((json && json.data && json.data.note) || (json && json.note) || {}) || {};

      const titleMatch = raw.match(/^\s{0,3}#\s+(.+)$/m);
      const title = (note.title || (titleMatch && titleMatch[1]) || ent.name.replace(/^\d+-/, '')).trim();

      const pickMeta = (key) => {
        const re = new RegExp(`^-\\s*${key}\\s*:\\s*(.+)$`, 'm');
        const m = raw.match(re);
        return m ? m[1].trim() : '';
      };

      const noteId = note.noteId || pickMeta('ID') || ent.name;
      const author = (note.user && (note.user.nickname || note.user.nickName)) || pickMeta('作者') || '万有引力AI';
      const authorId = (note.user && note.user.userId) || '';
      const url = pickMeta('链接')
        || (noteId
          ? `https://www.xiaohongshu.com/explore/${noteId}${note.xsecToken ? `?xsec_token=${encodeURIComponent(note.xsecToken)}` : ''}`
          : '');
      const typeRaw = note.type || pickMeta('类型') || 'normal';
      const type = typeRaw === 'video' ? '视频' : '图文';

      const interact = note.interactInfo || {};
      const likes = Number(String(interact.likedCount || pickMeta('点赞') || '0').replace(/[^\d.]/g, '')) || 0;
      const collected = Number(String(interact.collectedCount || pickMeta('收藏') || '0').replace(/[^\d.]/g, '')) || 0;
      const commentsCount = Number(String(interact.commentCount || pickMeta('评论') || '0').replace(/[^\d.]/g, '')) || 0;

      let bodySection = raw;
      const bodyM = raw.match(/##\s*正文\s*\n([\s\S]*?)(?=\n##\s*图片\b|\n##\s*Media\b|$)/i);
      if (bodyM) bodySection = bodyM[1];
      else {
        // 去掉标题与元数据列表
        bodySection = raw
          .replace(/^\s{0,3}#\s+.+\n+/, '')
          .replace(/^(?:\s*-\s*(?:ID|类型|作者|链接|点赞|收藏|评论)\s*:[^\n]*\n)+/m, '')
          .replace(/\n##\s*图片[\s\S]*$/i, '')
          .replace(/\n##\s*Media[\s\S]*$/i, '');
      }

      let imageSection = '';
      const imgM = raw.match(/##\s*(?:图片|Media)\s*\n([\s\S]*)$/i);
      if (imgM) imageSection = imgM[1];

      const images = [
        ...collectImages(dir, imageSection),
        ...collectImages(dir, bodySection),
      ];
      // 去重
      const seen = new Set();
      const uniqImages = [];
      for (const img of images) {
        if (seen.has(img.src)) continue;
        seen.add(img.src);
        uniqImages.push(img);
      }

      // 若 json 有 imageList 但 md 漏图，补相对 images/NN.webp
      if (!uniqImages.length && Array.isArray(note.imageList) && note.imageList.length) {
        note.imageList.forEach((_, i) => {
          const abs = path.join(dir, 'images', `${String(i + 1).padStart(2, '0')}.webp`);
          if (fs.existsSync(abs)) {
            const web = mediaWebPath(abs);
            if (web) uniqImages.push({ src: web, alt: `图片 ${String(i + 1).padStart(2, '0')}` });
          }
        });
      }

      const createdMs = Number(note.time) || fileMtimeMs(mdPath) || Date.now();

      entries.push(buildEntry({
        sourceId,
        author,
        title,
        body: bodySection,
        images: uniqImages,
        noteId,
        url,
        authorId,
        type,
        likes,
        collected,
        commentsCount,
        tags: extractTagsFromBody(bodySection),
        createdMs,
        stableKey: `wanyouyinli|${noteId}`,
      }));
    } catch (error) {
      failed += 1;
      console.warn(`[xhs-kb] skip 万有引力 ${ent.name}:`, error.message || error);
    }
  }

  entries.sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
  upsertBatch(entries);
  return { sourceId, imported: entries.length, failed, missing: false, root: notesRoot };
}

// ─── 落叶带走秋风（合集按 ## 切篇）────────────────────────

function importLuoye() {
  const root = path.join(KB_ROOT, '落叶带走秋风');
  const sourceId = 'xhs-luoye';
  if (!fs.existsSync(root)) {
    return { sourceId, imported: 0, failed: 0, missing: true, root };
  }
  const files = ['01_求职准备与选择合集.md', '02_研究方向与技术观察合集.md', '03_面经合集.md']
    .map(name => path.join(root, name))
    .filter(f => fs.existsSync(f));

  const entries = [];
  let failed = 0;

  for (const filePath of files) {
    try {
      const raw = readText(filePath);
      const mdDir = path.dirname(filePath);
      // 按二级标题切分（跳过一级标题与导语）
      const parts = raw.split(/(?=^##\s+)/m).filter(Boolean);
      for (const part of parts) {
        if (!/^\s{0,3}##\s+/.test(part)) continue;
        const titleM = part.match(/^\s{0,3}##\s+(.+)$/m);
        if (!titleM) continue;
        const title = titleM[1].trim();
        if (/^(求职|研究|面经|合集|说明|目录)/.test(title) && title.length < 6) continue;

        let body = part.replace(/^\s{0,3}##\s+.+\n?/, '');
        // 去掉文末「源文件：`...`」与分隔线
        body = body
          .replace(/\n*源文件：`[^`]+`\s*/g, '\n')
          .replace(/\n---+\s*$/g, '')
          .trim();

        const sig = parseAuthorSignature(body);
        body = sig.clean;
        const author = sig.author || '落叶带走秋风';
        const createdMs = parseFlexibleDate(sig.dateRaw) || fileMtimeMs(filePath) || Date.now();
        const images = collectImages(mdDir, body);

        entries.push(buildEntry({
          sourceId,
          author,
          title,
          body,
          images,
          noteId: md5(`luoye|${title}`).slice(0, 16),
          url: '',
          type: '图文',
          tags: extractTagsFromBody(body),
          createdMs,
          stableKey: `luoye|${path.basename(filePath)}|${title}`,
        }));
      }
    } catch (error) {
      failed += 1;
      console.warn(`[xhs-kb] skip 落叶 ${filePath}:`, error.message || error);
    }
  }

  entries.sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
  upsertBatch(entries);
  return { sourceId, imported: entries.length, failed, missing: false, root };
}

// ─── 薯条 ────────────────────────────────────────────────

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(full, out);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function importShutiao() {
  const root = path.join(KB_ROOT, '08_求职与成长 (Career)', '博客', '薯条');
  const sourceId = 'xhs-shutiao';
  if (!fs.existsSync(root)) {
    return { sourceId, imported: 0, failed: 0, missing: true, root };
  }
  const files = walkMd(root).filter(f => {
    const base = path.basename(f);
    return base !== '00_索引.md' && !base.startsWith('00_');
  });

  const entries = [];
  let failed = 0;
  for (const filePath of files) {
    try {
      const raw = readText(filePath);
      const mdDir = path.dirname(filePath);
      const titleM = raw.match(/^\s{0,3}#\s+(.+)$/m);
      const title = (titleM && titleM[1].trim()) || path.basename(filePath, '.md');

      // 多篇合并文件：按一级标题再切（公司合集 / 基础算法等）
      const hasMultiH1 = (raw.match(/^\s{0,3}#\s+/gm) || []).length > 1;
      const chunks = hasMultiH1
        ? raw.split(/(?=^\s{0,3}#\s+)/m).filter(c => /^\s{0,3}#\s+/.test(c))
        : [raw];

      let partIndex = 0;
      for (const chunk of chunks) {
        partIndex += 1;
        const tM = chunk.match(/^\s{0,3}#\s+(.+)$/m);
        const chunkTitle = (tM && tM[1].trim()) || title;
        // 跳过空壳「XX合集」标题块（正文在后续同文件 H1 里）
        if (/合集\s*$/.test(chunkTitle) && chunks.length > 1) {
          const rest = chunk.replace(/^\s{0,3}#\s+.+\n?/, '').trim();
          if (!rest || rest.length < 40) continue;
        }

        let body = chunk.replace(/^\s{0,3}#\s+.+\n?/, '');
        // 若本段以重复 H1 开头（合集导出常见），去掉重复标题行
        body = body.replace(/^\s{0,3}#\s+.+\n+/, (m) => {
          const same = m.match(/^\s{0,3}#\s+(.+)$/m);
          return same && same[1].trim() === chunkTitle ? '' : m;
        });

        const allSigs = [...String(chunk).matchAll(/\*([^*\n|]+?)\s*\|\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)[^*\n]*\*/g)];
        let author = '整点🍟';
        let dateRaw = '';
        if (allSigs.length) {
          const last = allSigs[allSigs.length - 1];
          author = last[1].trim() || author;
          dateRaw = last[2].trim().replace(/\//g, '-');
          body = body
            .replace(/\*[^*\n|]+?\s*\|\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}[^*\n]*\*/g, '')
            .trim();
        } else {
          const sig = parseAuthorSignature(body);
          body = sig.clean;
          author = sig.author || author;
          dateRaw = sig.dateRaw;
        }

        const images = collectImages(mdDir, body);
        const plain = markdownPlainText(body);
        // 跳过空壳块（重复标题 / 无正文无图）
        if (plain.length < 40 && images.length === 0) continue;

        const createdMs = parseFlexibleDate(dateRaw) || fileMtimeMs(filePath) || Date.now();
        const rel = path.relative(root, filePath);
        entries.push(buildEntry({
          sourceId,
          author,
          title: chunkTitle,
          body,
          images,
          noteId: md5(`shutiao|${rel}|${partIndex}|${chunkTitle}`).slice(0, 16),
          url: '',
          type: '图文',
          tags: extractTagsFromBody(body),
          createdMs,
          // 带 partIndex，避免同文件同标题互相覆盖
          stableKey: `shutiao|${rel}|${partIndex}|${chunkTitle}`,
        }));
      }
    } catch (error) {
      failed += 1;
      console.warn(`[xhs-kb] skip 薯条 ${filePath}:`, error.message || error);
    }
  }

  entries.sort((a, b) => (b.publishedTs || 0) - (a.publishedTs || 0));
  upsertBatch(entries);
  return { sourceId, imported: entries.length, failed, missing: false, root, files: files.length };
}

function isKbSourceSyncable(fetcher, sourceId) {
  if (!fetcher || typeof fetcher.getSourceById !== 'function') return true;
  const src = fetcher.getSourceById(sourceId);
  if (!src) return false;
  if (typeof fetcher.isEnabled === 'function') return fetcher.isEnabled(src);
  return src.enabled !== false;
}

function syncAll(options = {}) {
  const fetcher = options && options.fetcher || null;
  const importers = [
    { id: 'xhs-wanyouyinli', run: importWanyouyinli },
    { id: 'xhs-luoye', run: importLuoye },
    { id: 'xhs-shutiao', run: importShutiao },
  ];
  const results = [];
  for (const item of importers) {
    if (!isKbSourceSyncable(fetcher, item.id)) {
      results.push({
        sourceId: item.id,
        imported: 0,
        failed: 0,
        missing: false,
        skipped: true,
        disabled: true,
      });
      continue;
    }
    results.push(item.run());
  }
  return results;
}

function refreshLocalSources(fetcher) {
  if (!fetcher || typeof fetcher.fetchSource !== 'function' || typeof fetcher.getSourceById !== 'function') return;
  for (const src of KB_SOURCES) {
    try {
      if (!isKbSourceSyncable(fetcher, src.id)) continue;
      const source = fetcher.getSourceById(src.id);
      if (!source) continue;
      // localOnly：同步从 DB 灌 cache
      fetcher.fetchSource(source).catch(() => {});
    } catch (error) {
      console.warn(`[xhs-kb] refresh ${src.id}:`, error.message || error);
    }
  }
}

module.exports = {
  KB_ROOT,
  MEDIA_MOUNT,
  KB_SOURCES,
  syncAll,
  refreshLocalSources,
  importWanyouyinli,
  importLuoye,
  importShutiao,
  mediaWebPath,
};
