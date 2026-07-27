
/* ---------- Reader ---------- */
/** 动态加载外部 script（KaTeX / DOMPurify 按需） */
function loadScriptOnce(src, { globalKey = '' } = {}) {
  if (globalKey && window[globalKey]) return Promise.resolve(window[globalKey]);
  const existing = document.querySelector(`script[data-qm-src="${src}"]`);
  if (existing) {
    if (globalKey && window[globalKey]) return Promise.resolve(window[globalKey]);
    return existing._qmPromise || Promise.resolve();
  }
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.dataset.qmSrc = src;
  const promise = new Promise((resolve, reject) => {
    s.onload = () => resolve(globalKey ? window[globalKey] : undefined);
    s.onerror = () => reject(new Error(`failed to load ${src}`));
  });
  s._qmPromise = promise;
  document.head.appendChild(s);
  return promise;
}

function loadStylesheetOnce(href) {
  if (document.querySelector(`link[data-qm-href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.qmHref = href;
  document.head.appendChild(link);
}

let domPurifyPromise = null;
function ensureDomPurify() {
  if (window.DOMPurify) return Promise.resolve(window.DOMPurify);
  if (!domPurifyPromise) {
    domPurifyPromise = loadScriptOnce('/purify.min.js?v=3.4.11', { globalKey: 'DOMPurify' })
      .catch((err) => {
        domPurifyPromise = null;
        throw err;
      });
  }
  return domPurifyPromise;
}

let katexPromise = null;
function ensureKatex() {
  if (window.renderMathInElement && window.katex) return Promise.resolve();
  if (!katexPromise) {
    katexPromise = (async () => {
      loadStylesheetOnce('/vendor/katex/katex.min.css?v=0.17.0');
      await loadScriptOnce('/vendor/katex/katex.min.js?v=0.17.0', { globalKey: 'katex' });
      await loadScriptOnce('/vendor/katex/contrib/auto-render.min.js?v=0.17.0');
      // copy-tex 可选，失败忽略
      await loadScriptOnce('/vendor/katex/contrib/copy-tex.min.js?v=0.17.0').catch(() => null);
    })().catch((err) => {
      katexPromise = null;
      throw err;
    });
  }
  return katexPromise;
}

/** 弱路径 URL scheme：仅 http(s): / # 相对路径 data:image/；拒 javascript/data:text/html/vbscript */
function isSafeResourceUrl(value) {
  const raw = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return false;
  if (lower.startsWith('data:')) return lower.startsWith('data:image/');
  if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('?')) return true;
  // 协议相对 //cdn… 按 http(s) 处理
  if (raw.startsWith('//') && raw.length > 2) return true;
  // 无 scheme 的相对路径
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true;
  return false;
}

/** 无 DOMPurify 时清理 a/img/source 等危险 URL */
function scrubUnsafeUrlAttributes(doc) {
  doc.querySelectorAll('a[href], area[href]').forEach((el) => {
    if (!isSafeResourceUrl(el.getAttribute('href'))) el.removeAttribute('href');
  });
  doc.querySelectorAll('img[src], source[src], video[src], audio[src], track[src], embed[src]').forEach((el) => {
    if (!isSafeResourceUrl(el.getAttribute('src'))) {
      if (el.tagName === 'IMG') el.remove();
      else el.removeAttribute('src');
    }
  });
  doc.querySelectorAll('img[data-src], source[data-src]').forEach((el) => {
    if (!isSafeResourceUrl(el.getAttribute('data-src'))) el.removeAttribute('data-src');
  });
  doc.querySelectorAll('video[poster]').forEach((el) => {
    if (!isSafeResourceUrl(el.getAttribute('poster'))) el.removeAttribute('poster');
  });
}

function sanitize(html, { prioritizeFirstImage = false } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,form,iframe,object,embed,button,input,select,textarea,svg,canvas').forEach(n => n.remove());
  doc.querySelectorAll('.pencraft,.pc-reset,.icon-container,.image-link-expand,.view-image,[class*="image-link"],[class*="view-image"]').forEach(n => {
    if (!n.querySelector('img') && !n.textContent.replace(/\s+/g, '').trim()) n.remove();
  });
  doc.querySelectorAll('a,div,span').forEach(n => {
    if (n.querySelector('img,video,audio,table,hr')) return;
    if (n.textContent.replace(/\s+/g, '').trim()) return;
    n.remove();
  });
  doc.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if (/^on/i.test(a.name) || a.name.toLowerCase() === 'style') n.removeAttribute(a.name);
  }));
  doc.querySelectorAll('img').forEach((img) => {
    const src = String(img.getAttribute('src') || img.getAttribute('data-src') || '');
    const width = Number.parseInt(img.getAttribute('width') || '', 10);
    const height = Number.parseInt(img.getAttribute('height') || '', 10);
    if (
      !src
      || /^file:/i.test(src)
      || /telemetry\.(?:gif|png)|\/pixel(?:\.|\/|$)|1x1\.(?:gif|png)|spacer\.(?:gif|png)/i.test(src)
      || (Number.isFinite(width) && Number.isFinite(height) && width <= 2 && height <= 2)
    ) {
      img.remove();
    }
  });
  doc.querySelectorAll('img').forEach((img, index) => {
    const prioritized = prioritizeFirstImage && index === 0;
    const src = String(img.getAttribute('src') || '');
    img.setAttribute('loading', prioritized ? 'eager' : 'lazy');
    img.setAttribute('decoding', 'async');
    // 本地镜像图不需要 referrer；外链图保留默认策略，避免知乎等 CDN 防盗链
    if (src.startsWith('/article-images/') || src.startsWith('data:')) {
      img.setAttribute('referrerpolicy', 'no-referrer');
    } else {
      img.removeAttribute('referrerpolicy');
    }
    if (prioritized) img.setAttribute('fetchpriority', 'high');
    else img.removeAttribute('fetchpriority');
  });
  if (window.DOMPurify) {
    return DOMPurify.sanitize(doc.body.innerHTML, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'svg', 'canvas', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['style'],
      ADD_ATTR: ['target'],
    });
  }
  // 弱路径：无 DOMPurify 时仍限制 URL scheme
  scrubUnsafeUrlAttributes(doc);
  return doc.body.innerHTML;
}

async function sanitizeAsync(html, opts = {}) {
  await ensureDomPurify().catch(() => null);
  // ensure 失败且无 DOMPurify 时 sanitize 内部仍会 scrub scheme
  return sanitize(html, opts);
}

function plainTextFromHtml(value) {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function entryOriginalTextLength(entry = state.activeEntry) {
  if (!entry) return 0;
  const content = contentCache.get(entry.id) || entry.content || '';
  return plainTextFromHtml(content).length;
}

function hasUsableOriginalContent(entry = state.activeEntry) {
  if (!entry) return false;
  const content = contentCache.get(entry.id) || entry.content || '';
  // 本地 crawl / 镜像图：正文与图已在库，无需再联网抓
  if (/\/article-images\//i.test(content) || /\/article-images\//i.test(String(entry.image || ''))) return true;
  return entryOriginalTextLength(entry) >= 700;
}

function looksLikeHtmlDocument(value) {
  const source = String(value || '').trim();
  if (!source) return false;
  // 原文抓取结果多为 HTML 片段；不能再走 Markdown，否则缩进会被当成代码块
  if (/^(?:<!--[\s\S]*?-->\s*)*</.test(source) && /<\/(?:p|div|article|section|h[1-6]|ul|ol|li|blockquote|table|figure|pre|img)>/i.test(source.slice(0, 4000))) {
    return true;
  }
  return /<(?:p|div|article|section|h[1-6]|ul|ol|blockquote|table|figure)\b/i.test(source.slice(0, 1200))
    && (source.match(/<\/?(?:p|div|h[1-6]|li|br)\b/gi) || []).length >= 3;
}

function isRetryableOriginalFetchError(error) {
  return /无法解析|内网地址|timed out|request timed out|Status code 5|ECONN|ENOTFOUND|EAI_AGAIN|没有从原文页面提取/i.test(String(error || ''));
}

function isLocalOfflineSourceId(sourceId) {
  const id = String(sourceId || '');
  if (!id) return false;
  // 知乎 / X·小红书收藏 / 知识库：正文已在本地，禁止匿名直抓原文（知乎会 403）
  if (id === 'xhs-likes' || id === 'x-likes' || id === 'bili-watchlater' || /^xhs-/.test(id) || /^zhihu-/.test(id)) return true;
  if (typeof isLocalOnlySource === 'function' && isLocalOnlySource(id)) return true;
  return false;
}

function shouldAutoFetchOriginalOnOpen(entry = state.activeEntry) {
  if (!entry || !/^https?:\/\//i.test(entry.link || '')) return false;
  if (isLocalOfflineSourceId(entry.sourceId)) return false;
  if (entry.originalFetchedAt) return false;
  if (entry.originalFetchAttemptedAt) {
    if (!isRetryableOriginalFetchError(entry.originalFetchError)) return false;
    const age = Date.now() - Number(entry.originalFetchAttemptedAt || 0);
    if (Number.isFinite(age) && age >= 0 && age < 30 * 60 * 1000) return false;
  }
  // 本地已有全文 / 本地图（宝玉·Arthur·Lil'Log 等 crawl 导入）：绝不再因「Markdown 无图」去抓网页
  if (hasUsableOriginalContent(entry)) return false;
  // 仅真正薄内容（RSS 摘要级）才开文补抓
  return true;
}

function translationPairText(pair) {
  if (!pair) return '';
  return String(pair.target || '').trim() || plainTextFromHtml(pair.targetHtml);
}

function normalizeBlockText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const TRANSLATION_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,figure,img,hr,li';
const TRANSLATION_BLOCK_TAGS = new Set(
  TRANSLATION_BLOCK_SELECTOR.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
);
const LINK_TOOLBAR_SCAN_SELECTOR = 'div,nav,section,p,span';

function isNestedTranslationBlock(el) {
  const parent = el.parentElement && el.parentElement.closest(TRANSLATION_BLOCK_SELECTOR);
  return Boolean(parent);
}

function isBrowserLinkToolbar(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (!/^(div|nav|section|p|span)$/.test(tag)) return false;
  if (isNestedTranslationBlock(el)) return false;
  if (el.querySelector(TRANSLATION_BLOCK_SELECTOR)) return false;
  const anchors = [...el.querySelectorAll('a[href]')];
  if (!anchors.length) return false;
  const classId = `${el.className || ''} ${el.id || ''}`.toLowerCase();
  if (/talk-actions|btn-group|button-row|action-row|quick-links|resource-links|download-links|lecture-actions|syllabus-actions|page-actions|(?:^|\s)actions(?:\s|$)/i.test(classId)) {
    return true;
  }
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelLen = anchors.reduce((n, a) => n + (a.textContent || '').replace(/\s+/g, ' ').trim().length, 0);
  const avg = labelLen / anchors.length;
  if (anchors.length >= 2 && text.length <= Math.max(96, labelLen + 24) && avg <= 48) return true;
  if (anchors.length >= 2 && /watch|pdf|slides?|source|video|download|github/i.test(text) && text.length < 120) return true;
  if (anchors.length === 1 && text.length < 48 && /watch|pdf|slides?|source|download|video|arxiv|github/i.test(text)) return true;
  return false;
}

function sourceHtmlForBrowserBlock(el) {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (/^h[1-6]$/.test(tag) && parent && parent.tagName && parent.tagName.toLowerCase() === 'a') {
    const href = parent.getAttribute('href') || '';
    return `<${tag}><a href="${escapeHtml(href)}">${el.innerHTML}</a></${tag}>`;
  }
  return el.outerHTML;
}

function extractTranslationSourceBlocks(entry = state.activeEntry) {
  const html = (entry && (entry.content || contentCache.get(entry.id))) || '';
  if (!html) return [];
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const scan = `${TRANSLATION_BLOCK_SELECTOR},${LINK_TOOLBAR_SCAN_SELECTOR}`;
  const nodes = [...doc.body.querySelectorAll(scan)].filter(el => {
    if (isNestedTranslationBlock(el)) return false;
    if (isBrowserLinkToolbar(el)) return true;
    return TRANSLATION_BLOCK_TAGS.has(el.tagName.toLowerCase());
  });
  // 嵌套工具条只保留最外层
  const filtered = nodes.filter(el => {
    if (!isBrowserLinkToolbar(el)) return true;
    return !nodes.some(other => other !== el && isBrowserLinkToolbar(other) && other.contains(el));
  });
  return filtered.map(el => {
    const tag = el.tagName.toLowerCase();
    if (isBrowserLinkToolbar(el)) {
      const source = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const raw = el.outerHTML;
      return {
        tag: 'div',
        html: /translation-link-toolbar/.test(raw)
          ? raw
          : `<div class="translation-link-toolbar">${raw}</div>`,
        source,
        kind: 'media',
      };
    }
    const htmlBlock = sourceHtmlForBrowserBlock(el);
    const source = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const kind = tag === 'img' || tag === 'hr' || (tag === 'figure' && !source) ? 'media' : 'text';
    return { tag, html: htmlBlock, source, kind };
  }).filter(block => block.kind === 'media' || block.source.length >= 2);
}

function sourceLinksFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return [...doc.querySelectorAll('a[href]')]
    .map(a => ({
      href: a.getAttribute('href') || '',
      label: (a.textContent || '').replace(/\s+/g, ' ').trim() || '源链接',
    }))
    .filter(link => /^https?:\/\//i.test(link.href))
    .slice(0, 6);
}

function sourceImagesFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return [...doc.querySelectorAll('img[src]')]
    .map(img => {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
      return img.outerHTML;
    })
    .join('');
}

function targetWithSourceLinks(target, sourceHtml, source = '') {
  const text = escapeHtml(target || '');
  const links = sourceLinksFromHtml(sourceHtml);
  if (!links.length) return text;
  const existing = String(target || '');
  const missing = links.filter(link => !existing.includes(link.href));
  if (!missing.length) return text;
  if (missing.length === 1) {
    const link = missing[0];
    const sourceText = normalizeBlockText(source);
    const linkText = normalizeBlockText(link.label);
    const linkCoversBlock = sourceText && linkText && linkText.length >= sourceText.length * 0.65;
    if (linkCoversBlock) {
      return `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${text}</a>`;
    }
  }
  const refs = missing
    .map(link => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`)
    .join('、');
  return `${text}<span class="translation-links">链接：${refs}</span>`;
}

function splitTranslatedListItemsClient(text) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) return [];
  let parts = raw.split(/\n+/).map(s => s.replace(/^\s*[-*•·]\s+/, '').trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  parts = raw.split(/(?<=[。；;])\s+(?=[^\s]{1,40}[:：])/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  return [raw];
}

function targetHtmlFromSourceBlock(block, target) {
  const tag = block && block.tag || 'p';
  const cleanTarget = String(target || '').trim();
  const sourceHtml = String(block && (block.html || block.sourceHtml) || '').trim();
  // 无译文时：表格/列表保留源结构，绝不吐空或乱包 p
  if (!cleanTarget) {
    if ((tag === 'table' || tag === 'ul' || tag === 'ol') && sourceHtml) return sourceHtml;
    return '';
  }
  const linked = targetWithSourceLinks(cleanTarget, sourceHtml, block.source);
  const media = sourceImagesFromHtml(sourceHtml);
  if (tag === 'blockquote') return `<blockquote><p>${linked}</p>${media}</blockquote>`;
  if (/^h[1-6]$/.test(tag)) return `<${tag}>${linked}</${tag}>`;
  if (tag === 'figure') return `<figure>${media}<figcaption>${linked}</figcaption></figure>`;
  if (tag === 'pre') return `<pre><code>${escapeHtml(cleanTarget)}</code></pre>`;
  if (tag === 'li') return `<ul><li>${linked}</li></ul>`;
  if (tag === 'ul' || tag === 'ol') {
    const items = splitTranslatedListItemsClient(cleanTarget);
    if (items.length > 1) {
      return `<${tag}>${items.map(item => `<li>${targetWithSourceLinks(item, sourceHtml, '')}</li>`).join('')}</${tag}>`;
    }
    return `<${tag}><li>${linked}</li></${tag}>`;
  }
  if (tag === 'table') {
    // 只有纯文本时：保留源表行列/链接，避免「Github仓库 RL算法 …」糊成一整段 p
    if (sourceHtml && /<table[\s>]/i.test(sourceHtml)) return sourceHtml;
    return `<p>${linked}</p>`;
  }
  if (tag === 'td' || tag === 'th') return `<p>${linked}</p>`;
  return `<p>${linked}</p>${media}`;
}

/**
 * 旧译文缺 Watch/PDF 工具条时：按原文文档序，在对应 h3/标题后插入透传链接行。
 */
function mergeMissingLinkToolbars(pairs) {
  const sourceBlocks = extractTranslationSourceBlocks();
  if (!sourceBlocks.length || !pairs.length) return pairs;
  const toolbars = sourceBlocks.filter(b => b && b.kind === 'media' && /translation-link-toolbar|<a\s/i.test(b.html || ''));
  if (!toolbars.length) return pairs;
  // 已有足够链接工具条则不插
  const existingToolbars = pairs.filter(p => p && (
    p.kind === 'media'
    || /translation-link-toolbar/i.test(String(p.targetHtml || p.sourceHtml || ''))
  ) && /<a\s/i.test(String(p.targetHtml || p.sourceHtml || ''))
    && /watch|pdf|slides?|source/i.test(String(p.targetHtml || p.sourceHtml || p.source || '')));
  if (existingToolbars.length >= toolbars.length) return pairs;

  const out = [];
  let pairIndex = 0;
  for (const block of sourceBlocks) {
    if (block.kind === 'media') {
      out.push({
        kind: 'media',
        tag: block.tag || 'div',
        source: block.source || '',
        sourceHtml: block.html,
        target: '',
        targetHtml: block.html,
      });
      continue;
    }
    let matchIndex = -1;
    const blockText = normalizeBlockText(block.source);
    for (let i = pairIndex; i < Math.min(pairs.length, pairIndex + 6); i++) {
      const pair = pairs[i];
      if (!pair || pair.kind === 'media') continue;
      const pairText = normalizeBlockText(pair.source || pair.target);
      if (pairText && blockText && (pairText === blockText || pairText.includes(blockText) || blockText.includes(pairText))) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) {
      // 找不到源对齐时尽量顺序取下一个非 media 译文
      while (pairIndex < pairs.length && pairs[pairIndex] && pairs[pairIndex].kind === 'media') pairIndex += 1;
      matchIndex = pairIndex < pairs.length ? pairIndex : -1;
    }
    if (matchIndex < 0) continue;
    const pair = pairs[matchIndex];
    pairIndex = Math.max(matchIndex + 1, pairIndex + 1);
    out.push(pair);
  }
  return out.length ? out : pairs;
}

/** 本机删除 quote 列表（与 storage 同步） */
function localDeletionQuotes(entryId = state.activeEntry?.id) {
  if (typeof localContentMarksFor !== 'function') return [];
  const marks = localContentMarksFor(entryId);
  return (marks.deletions || [])
    .map(d => String(d && d.quote || '').replace(/\s+/g, ' ').trim())
    .filter(q => q.length >= 2);
}

function pairCoveredByLocalDeletion(pair, quotes) {
  const source = String(pair && pair.source || '').replace(/\s+/g, ' ').trim();
  if (!source || !quotes.length) return false;
  for (const q of quotes) {
    if (source === q) return true;
    if (q.length >= 8 && source.includes(q)
      && (source.length - q.length) <= Math.max(24, Math.floor(q.length * 0.3))) {
      return true;
    }
    if (source.length >= 8 && q.includes(source) && q.length >= source.length) return true;
  }
  return false;
}

/** 译文展示时剔除本机已删除的源块（旧缓存未 omit 时也能藏住） */
function filterPairsByLocalDeletions(pairs, entryId = state.activeEntry?.id) {
  const quotes = localDeletionQuotes(entryId);
  if (!quotes.length || !Array.isArray(pairs)) return pairs || [];
  return pairs.filter(pair => pair && !pairCoveredByLocalDeletion(pair, quotes));
}

function extractHtmlTableRows(html) {
  const rows = [];
  const re = /<tr\b[\s\S]*?<\/tr>/gi;
  let m;
  const src = String(html || '');
  while ((m = re.exec(src))) rows.push(m[0]);
  return rows;
}

function isTranslationTablePair(pair) {
  if (!pair) return false;
  if (String(pair.tag || '').toLowerCase() === 'table') return true;
  return /<table[\s>]/i.test(String(pair.targetHtml || pair.sourceHtml || ''));
}

/** 合并连续 table 碎片（旧缓存把课表拆成多张小表）→ 一张完整表 */
function mergeConsecutiveTranslationTables(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 2) return pairs || [];
  const out = [];
  for (const pair of pairs) {
    if (!pair) continue;
    const prev = out[out.length - 1];
    if (isTranslationTablePair(pair) && prev && isTranslationTablePair(prev)) {
      const htmlA = String(prev.targetHtml || prev.sourceHtml || '');
      const htmlB = String(pair.targetHtml || pair.sourceHtml || '');
      const rowsA = extractHtmlTableRows(htmlA);
      const rowsB = extractHtmlTableRows(htmlB);
      if (rowsA.length && rowsB.length) {
        let start = 0;
        if (/<th[\s>]/i.test(rowsB[0]) && /<th[\s>]/i.test(rowsA[0])) start = 1;
        const colgroup = (htmlA.match(/<colgroup\b[\s\S]*?<\/colgroup>/i) || [])[0] || '';
        const mergedHtml = `<table class="table">${colgroup}<tbody>${rowsA.concat(rowsB.slice(start)).join('')}</tbody></table>`;
        const srcA = String(prev.sourceHtml || '');
        const srcB = String(pair.sourceHtml || '');
        const srcRowsA = extractHtmlTableRows(srcA);
        const srcRowsB = extractHtmlTableRows(srcB);
        let srcStart = 0;
        if (srcRowsA.length && srcRowsB.length
          && /<th[\s>]/i.test(srcRowsB[0]) && /<th[\s>]/i.test(srcRowsA[0])) {
          srcStart = 1;
        }
        const srcCol = (srcA.match(/<colgroup\b[\s\S]*?<\/colgroup>/i) || [])[0] || colgroup;
        const mergedSrc = srcRowsA.length
          ? `<table class="table">${srcCol}<tbody>${srcRowsA.concat(srcRowsB.slice(srcStart)).join('')}</tbody></table>`
          : mergedHtml;
        out[out.length - 1] = {
          ...prev,
          tag: 'table',
          kind: 'text',
          source: `${prev.source || ''} ${pair.source || ''}`.replace(/\s+/g, ' ').trim(),
          target: `${prev.target || ''} ${pair.target || ''}`.replace(/\s+/g, ' ').trim(),
          sourceHtml: mergedSrc,
          targetHtml: mergedHtml,
        };
        continue;
      }
    }
    out.push(pair);
  }
  return out;
}

function enrichedTranslationBlocks(translation) {
  let pairs = translation && Array.isArray(translation.content) ? translation.content : [];
  if (!pairs.length) return [];
  // 本机删除过的源块不展示（含旧缓存已译出的中文）
  pairs = filterPairsByLocalDeletions(pairs);
  // 旧缓存课表碎片合并
  pairs = mergeConsecutiveTranslationTables(pairs);
  if (!pairs.length) return [];
  const hasRichBlocks = pairs.some(pair => pair && (pair.targetHtml || pair.sourceHtml || pair.tag || pair.kind === 'media'));
  if (hasRichBlocks) {
    const mapped = pairs.map((pair, index) => {
      const target = translationPairText(pair);
      const existingHtml = String(pair.targetHtml || '').trim();
      const sourceHtml = String(pair.sourceHtml || '').trim();
      const tag = pair.tag || 'p';
      // 表被压成 <p>墙（旧 bug）：有源 table 则强制回源结构，绝不渲染中文墙
      const demotedTableSoup = /<table[\s>]/i.test(sourceHtml)
        && (!existingHtml || (/^<p[\s>]/i.test(existingHtml) && !/<table[\s>]/i.test(existingHtml)))
        && (tag === 'table' || /Github\s*Repo|RL\s*Algorithm|Paper\s*Link|Github仓库|RL算法/i.test(pair.source || target));
      // 已有结构化 HTML 直接用；空/被校验丢弃时按 tag+sourceHtml 回建（勿一律包 p）
      const needsRebuild = demotedTableSoup
        || !existingHtml
        || ((tag === 'ul' || tag === 'ol' || tag === 'table')
          && !new RegExp(`<${tag}[\\s>]`, 'i').test(existingHtml));
      return {
        ...pair,
        i: Number(pair.i ?? index),
        target: demotedTableSoup ? (pair.source || target) : target,
        targetHtml: needsRebuild
          ? (demotedTableSoup && sourceHtml
            ? sourceHtml
            : targetHtmlFromSourceBlock({
              tag: demotedTableSoup ? 'table' : tag,
              html: sourceHtml,
              source: pair.source || '',
            }, demotedTableSoup ? (pair.source || target) : target))
          : existingHtml,
      };
    });
    // 旧缓存缺讲次工具条：从原文补回 Watch/PDF/Slides
    return mergeMissingLinkToolbars(mapped);
  }

  const sourceBlocks = extractTranslationSourceBlocks();
  if (!sourceBlocks.length) return pairs;
  const out = [];
  let pairIndex = 0;
  for (const block of sourceBlocks) {
    if (block.kind === 'media') {
      out.push({
        kind: 'media',
        tag: block.tag,
        source: block.source,
        sourceHtml: block.html,
        target: '',
        targetHtml: block.html,
      });
      continue;
    }
    let matchIndex = -1;
    const blockText = normalizeBlockText(block.source);
    for (let i = pairIndex; i < Math.min(pairs.length, pairIndex + 4); i++) {
      const pairText = normalizeBlockText(pairs[i] && pairs[i].source);
      if (pairText && (pairText === blockText || pairText.includes(blockText) || blockText.includes(pairText))) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) matchIndex = pairIndex;
    const pair = pairs[matchIndex];
    if (!pair) continue;
    pairIndex = Math.max(matchIndex + 1, pairIndex + 1);
    const target = translationPairText(pair);
    out.push({
      ...pair,
      tag: block.tag,
      sourceHtml: block.html,
      target,
      targetHtml: targetHtmlFromSourceBlock(block, target),
    });
  }
  return out.some(block => block.target || block.targetHtml) ? out : pairs;
}

function translationBlockTargetHtml(block) {
  const html = block && block.targetHtml ? block.targetHtml : targetHtmlFromSourceBlock({
    tag: block && block.tag || 'p',
    html: block && block.sourceHtml || '',
    source: block && block.source || '',
  }, translationPairText(block));
  return sanitize(html || `<p>${escapeHtml(translationPairText(block))}</p>`);
}

const contentCache = new Map();

function formatAssetTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeReaderPrefs(raw = {}) {
  const prefs = raw && typeof raw === 'object' ? raw : {};
  const font = READER_FONTS[prefs.font] ? prefs.font : READER_PREF_DEFAULTS.font;
  return {
    fontSize: clampNumber(prefs.fontSize, 15, 20, READER_PREF_DEFAULTS.fontSize),
    lineHeight: clampNumber(prefs.lineHeight, 1.65, 2.05, READER_PREF_DEFAULTS.lineHeight),
    measure: clampNumber(prefs.measure, 56, 84, READER_PREF_DEFAULTS.measure),
    font,
  };
}

function migrateReaderPrefs() {
  if (storage.getItem('qm_reader_prefs_v') === '2') return;
  try {
    const raw = JSON.parse(storage.getItem('qm_reader_prefs') || 'null');
    if (raw && typeof raw === 'object' && Number(raw.measure) === 70) {
      raw.measure = READER_PREF_DEFAULTS.measure;
      storage.setItem('qm_reader_prefs', JSON.stringify(raw));
      state.readerPrefs = normalizeReaderPrefs(raw);
    }
  } catch { /* ignore */ }
  storage.setItem('qm_reader_prefs_v', '2');
}
migrateReaderPrefs();

function persistReaderPrefs() {
  storage.setItem('qm_reader_prefs', JSON.stringify(state.readerPrefs));
}

function readerLanguageRoot(tab = state.readerTab) {
  if (tab === 'rewrite') return $('#rewrite-content');
  if (tab === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function readerLanguageSample(tab = state.readerTab) {
  const root = readerLanguageRoot(tab);
  const text = elementTextForCopy(root);
  if (text) return text.slice(0, 6000);
  const entry = state.activeEntry;
  return [entry?.titleZh || entry?.title || '', entry?.titleZh ? entry?.title || '' : '', entry?.summary || '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}

function readerLanguageProfile(text) {
  const sample = String(text || '');
  const cjk = (sample.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const total = Math.max(1, cjk + latin);
  const ratio = cjk / total;
  if (cjk >= 80 && ratio >= 0.2) return 'cjk';
  if (cjk >= 24 && ratio >= 0.1) return 'mixed';
  return 'latin';
}

function updateReaderLanguageProfile() {
  const reader = $('#reader');
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  const profile = state.activeEntry ? readerLanguageProfile(readerLanguageSample()) : 'latin';
  // Language detection is metadata only. Changing measure, line height, or
  // paragraph spacing between articles makes source/article navigation look
  // like a browser zoom even though the viewport itself never changes.
  document.documentElement.style.setProperty('--reader-measure-setting', `${prefs.measure}ch`);
  document.documentElement.style.setProperty('--reader-measure', `${prefs.measure}ch`);
  document.documentElement.style.setProperty('--reader-line-height-effective', prefs.lineHeight.toFixed(2));
  document.documentElement.style.setProperty('--reader-paragraph-gap', '1.08em');
  if (reader) {
    reader.dataset.readerLanguage = profile;
    reader.dataset.readerMeasureUnit = 'ch';
  }
  return profile;
}

function applyReaderPrefs() {
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  state.readerPrefs = prefs;
  const app = $('#app');
  const reader = $('#reader');
  document.documentElement.style.setProperty('--reader-font-size', `${prefs.fontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', prefs.lineHeight.toFixed(2));
  if (reader) reader.dataset.readerFont = prefs.font;
  if (app) app.classList.toggle('reader-immersive', Boolean(state.readerImmersive && state.activeEntry));
  updateReaderLanguageProfile();
  renderLeftCollapseToggle();
  renderReaderPrefs();
}

function renderReaderPrefs() {
  const prefs = normalizeReaderPrefs(state.readerPrefs);
  const panel = $('#reader-preferences');
  const toggle = $('#reader-prefs-toggle');
  if (panel) panel.classList.toggle('hidden', !state.readerPrefsOpen);
  if (toggle) {
    toggle.classList.toggle('active', Boolean(state.readerPrefsOpen));
    toggle.setAttribute('aria-expanded', state.readerPrefsOpen ? 'true' : 'false');
  }
  const immersive = $('#reader-immersive');
  if (immersive) {
    immersive.classList.toggle('active', Boolean(state.readerImmersive));
    immersive.setAttribute('aria-pressed', state.readerImmersive ? 'true' : 'false');
    setButtonIconLabel(immersive, state.readerImmersive ? 'minimize-2' : 'maximize-2', '沉浸阅读');
    immersive.title = state.readerImmersive ? '退出沉浸阅读' : '沉浸阅读';
  }
  const fontSizeValue = $('#reader-font-size-value');
  if (fontSizeValue) fontSizeValue.textContent = prefs.fontSize.toFixed(prefs.fontSize % 1 ? 1 : 0);
  const lineHeight = $('#reader-line-height');
  if (lineHeight) {
    lineHeight.value = prefs.lineHeight.toFixed(2);
    lineHeight.title = `行高 ${prefs.lineHeight.toFixed(2)}`;
  }
  const measure = $('#reader-measure');
  if (measure) {
    measure.value = String(Math.round(prefs.measure));
    measure.title = `栏宽 ${Math.round(prefs.measure)}ch`;
  }
  const font = $('#reader-font-family');
  if (font) font.value = prefs.font;
}

function setReaderPrefsOpen(open) {
  state.readerPrefsOpen = Boolean(open);
  renderReaderPrefs();
}

function setReaderPref(name, value) {
  state.readerPrefs = normalizeReaderPrefs({ ...state.readerPrefs, [name]: value });
  persistReaderPrefs();
  applyReaderPrefs();
}

function setReaderImmersive(enabled) {
  state.readerImmersive = Boolean(enabled);
  storage.setItem('qm_reader_immersive', state.readerImmersive ? '1' : '0');
  applyReaderPrefs();
}

function createAgentPromptId() {
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAgentPrompt(item, index = 0) {
  const raw = item && typeof item === 'object' ? item : {};
  const label = String(raw.label || '').trim().slice(0, 24);
  const prompt = String(raw.prompt || '').trim().slice(0, 2400);
  if (!label || !prompt) return null;
  return {
    id: String(raw.id || `default-${index}`).trim() || `default-${index}`,
    label,
    prompt,
  };
}

function defaultAgentPrompts() {
  return DEFAULT_AGENT_PROMPTS
    .map((item, index) => normalizeAgentPrompt({ ...item, id: `default-${index + 1}` }, index))
    .filter(Boolean);
}

function loadAgentPrompts() {
  const stored = readJson('qm_agent_prompts', 'null');
  if (Array.isArray(stored)) return stored.map(normalizeAgentPrompt).filter(Boolean).slice(0, AGENT_PROMPT_LIMIT);
  return defaultAgentPrompts();
}

function persistAgentPrompts() {
  storage.setItem('qm_agent_prompts', JSON.stringify((state.agentPrompts || []).map(item => ({
    id: item.id,
    label: item.label,
    prompt: item.prompt,
  }))));
}

function agentPromptById(id) {
  return (state.agentPrompts || []).find(item => item.id === id) || null;
}

function visibleAgentPrompts() {
  return Array.isArray(state.agentPrompts) ? state.agentPrompts : defaultAgentPrompts();
}

function renderAgentPrompts() {
  const wrap = $('.agent-prompts');
  if (!wrap) return;
  const prompts = visibleAgentPrompts().slice(0, 5);
  wrap.innerHTML = `
    <div class="agent-prompt-row" role="list">
      ${prompts.map(item => `
        <button class="agent-prompt agent-prompt-chip" type="button" role="listitem" data-agent-prompt-id="${escapeHtml(item.id)}" data-prompt="${escapeHtml(item.prompt)}" title="${escapeHtml(item.prompt)}">${escapeHtml(item.label)}</button>
      `).join('')}
    </div>
    <button class="agent-prompt-manage" type="button" data-agent-prompt-manage title="管理常用提示词" aria-label="管理常用提示词">${lucideIcon('ellipsis')}</button>
  `;
}

function renderAgentPromptManager() {
  const list = $('#agent-prompt-list');
  const queryInput = $('#agent-prompt-search');
  if (queryInput && queryInput.value !== state.agentPromptQuery) queryInput.value = state.agentPromptQuery || '';
  if (!list) return;
  const query = String(state.agentPromptQuery || '').trim().toLowerCase();
  const prompts = visibleAgentPrompts()
    .filter(item => !query || `${item.label}\n${item.prompt}`.toLowerCase().includes(query));
  list.innerHTML = prompts.length ? prompts.map(item => `
    <div class="agent-prompt-library-item" data-agent-prompt-item="${escapeHtml(item.id)}">
      <div class="agent-prompt-library-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.prompt)}</p>
      </div>
      <div class="agent-prompt-library-actions">
        <button type="button" class="ghost-btn" data-agent-prompt-use="${escapeHtml(item.id)}">使用</button>
        <button type="button" class="ghost-btn" data-agent-prompt-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="ghost-btn danger" data-agent-prompt-delete="${escapeHtml(item.id)}">删除</button>
      </div>
    </div>
  `).join('') : '<div class="agent-prompt-empty">没有匹配的提示词</div>';
}

function setAgentPromptForm(item = null) {
  state.agentPromptEditingId = item ? item.id : '';
  const id = $('#agent-prompt-id');
  const label = $('#agent-prompt-label');
  const prompt = $('#agent-prompt-content');
  const save = $('#agent-prompt-save');
  if (id) id.value = item ? item.id : '';
  if (label) label.value = item ? item.label : '';
  if (prompt) prompt.value = item ? item.prompt : '';
  if (save) save.textContent = item ? '保存修改' : '添加';
}

function openAgentPromptManager(editId = '') {
  const modal = $('#agent-prompt-modal');
  if (!modal) return;
  const editItem = editId ? agentPromptById(editId) : null;
  setAgentPromptForm(editItem);
  renderAgentPromptManager();
  modal.classList.remove('hidden');
  setTimeout(() => (editItem ? $('#agent-prompt-content') : $('#agent-prompt-label'))?.focus(), 30);
}

function closeAgentPromptManager() {
  $('#agent-prompt-modal')?.classList.add('hidden');
}

function saveAgentPromptFromForm() {
  const label = String($('#agent-prompt-label')?.value || '').trim();
  const prompt = String($('#agent-prompt-content')?.value || '').trim();
  const id = String($('#agent-prompt-id')?.value || '').trim();
  if (!label || !prompt) {
    toast('请填写名称和提示词');
    return;
  }
  const normalized = normalizeAgentPrompt({ id: id || createAgentPromptId(), label, prompt });
  if (!normalized) return;
  const list = Array.isArray(state.agentPrompts) ? [...state.agentPrompts] : [];
  const index = list.findIndex(item => item.id === normalized.id);
  if (index >= 0) list[index] = normalized;
  else {
    if (list.length >= AGENT_PROMPT_LIMIT) {
      toast(`最多保存 ${AGENT_PROMPT_LIMIT} 条常用提示词`);
      return;
    }
    list.unshift(normalized);
  }
  state.agentPrompts = list;
  persistAgentPrompts();
  setAgentPromptForm(index >= 0 ? normalized : null);
  renderAgentPrompts();
  renderAgentPromptManager();
  updateAgentControls();
  refreshPersonaAgent();
  toast(index >= 0 ? '提示词已更新' : '提示词已添加');
}

async function deleteAgentPrompt(id) {
  const item = agentPromptById(id);
  if (!item) return;
  const ok = await showConfirmDialog({
    title: '删除提示词',
    message: `确认删除“${item.label}”？`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.agentPrompts = (state.agentPrompts || []).filter(prompt => prompt.id !== id);
  persistAgentPrompts();
  if (state.agentPromptEditingId === id) setAgentPromptForm(null);
  renderAgentPrompts();
  renderAgentPromptManager();
  updateAgentControls();
  refreshPersonaAgent();
  toast('提示词已删除');
}

function personaAgentAvailable() {
  return false;
}

function personaAgentActive() {
  return Boolean(
    state.personaAgentReady &&
    state.personaAgentController &&
    state.personaAgentEntryId &&
    state.activeEntry &&
    state.personaAgentEntryId === state.activeEntry.id
  );
}

function personaMessageDate(value) {
  const time = Number(value) || Date.parse(value || '');
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : new Date().toISOString();
}

function personaInitialMessages() {
  return (state.agentMessages || [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim())
    .map((message, index) => ({
      id: message.id || `qmreader-${state.activeEntry?.id || 'entry'}-${index}`,
      role: message.role,
      content: String(message.content || ''),
      createdAt: personaMessageDate(message.createdAt),
      sequence: index + 1,
    }));
}

function personaMessagesKey() {
  return personaInitialMessages()
    .map(message => `${message.id}:${message.role}:${message.content.length}:${message.createdAt}`)
    .join('|');
}

function personaPayloadMessages(payload) {
  const normalized = (payload && Array.isArray(payload.messages) ? payload.messages : [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => {
      const raw = Array.isArray(message.content)
        ? message.content.map(part => part && (part.text || part.content || '')).join('\n')
        : message.content;
      return { role: message.role, content: String(raw || '').trim() };
    })
    .filter(message => message.content)
    .slice(-12);
  const lastUserIndex = normalized.map(message => message.role).lastIndexOf('user');
  if (lastUserIndex >= 0) {
    normalized[lastUserIndex] = {
      ...normalized[lastUserIndex],
      content: withAgentContext(normalized[lastUserIndex].content),
    };
  }
  return normalized;
}

function personaParseSseEvent(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'delta') return { text: String(data.text || '') };
  if (data.type === 'done') return { done: true };
  if (data.type === 'error') return { error: String(data.error || '对话失败') };
  if (typeof data.text === 'string') return { text: data.text };
  return null;
}

async function personaCustomFetch(_url, init = {}, payload = {}) {
  const entry = state.activeEntry;
  if (!entry || !entry.id) throw new Error('请先选择一篇文章');
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) throw new Error('请先保存一个可用的 AI 配置');
  return fetch(`/api/entry/${encodeURIComponent(entry.id)}/chat/stream`, {
    method: 'POST',
    credentials: 'same-origin',
    signal: init.signal,
    headers: {
      'Content-Type': 'application/json',
      ...aiHeadersFromConfig(agentConfig),
    },
    body: JSON.stringify({ messages: personaPayloadMessages(payload) }),
  });
}

function createPersonaPromptPlugin() {
  return {
    id: 'qmreader-prompt-row',
    renderComposer({ defaultRenderer, onSubmit, streaming }) {
      const root = document.createElement('div');
      root.className = 'persona-qm-composer';

      const prompts = document.createElement('div');
      prompts.className = 'persona-qm-prompts';

      const row = document.createElement('div');
      row.className = 'persona-qm-prompt-row';
      row.setAttribute('role', 'list');
      const canSend = Boolean(state.activeEntry && hasUsableAiConfig(aiConfigForPurpose('agent')) && !streaming);
      visibleAgentPrompts().slice(0, 5).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'persona-qm-prompt';
        btn.textContent = item.label;
        btn.title = item.prompt;
        btn.disabled = !canSend;
        btn.setAttribute('role', 'listitem');
        btn.addEventListener('click', () => onSubmit(item.prompt));
        row.appendChild(btn);
      });

      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'persona-qm-prompt-manage';
      setElementIcon(manage, 'ellipsis');
      manage.title = '管理常用提示词';
      manage.setAttribute('aria-label', '管理常用提示词');
      manage.addEventListener('click', openAgentPromptManager);

      prompts.appendChild(row);
      prompts.appendChild(manage);
      root.appendChild(prompts);
      const contextNode = agentContextNode();
      if (contextNode) root.appendChild(contextNode);
      root.appendChild(defaultRenderer());
      return root;
    },
  };
}

function agentContextTitle(context = state.agentContext) {
  if (!context) return '';
  if (context.type === 'comment') return '人工点评';
  if (context.type === 'selection') return '选中文本';
  return context.body ? '划线点评' : '划线';
}

function agentContextSurfaceLabel(context = state.agentContext) {
  if (!context) return '';
  if (context.surface) return ANNOTATION_SURFACE_LABELS[normalizeAnnotationSurface(context.surface)] || '';
  return '';
}

function agentContextBodyText(context = state.agentContext) {
  if (!context) return '';
  const lines = [];
  if (context.quote) lines.push(`引用：${context.quote}`);
  if (context.body) lines.push(`${context.type === 'comment' ? '点评' : '说明'}：${context.body}`);
  const replies = Array.isArray(context.replies)
    ? context.replies.map(reply => String(reply && reply.body || '').trim()).filter(Boolean)
    : [];
  if (replies.length) lines.push(`回复：${replies.slice(0, 3).join(' / ')}`);
  return lines.join('\n');
}

function agentContextPromptPrefix(context = state.agentContext) {
  const body = agentContextBodyText(context);
  if (!body) return '';
  const scope = [agentContextTitle(context), agentContextSurfaceLabel(context)].filter(Boolean).join(' · ');
  return [
    '【当前引用上下文】',
    scope ? `类型：${scope}` : '',
    body,
  ].filter(Boolean).join('\n');
}

function withAgentContext(content) {
  const text = String(content || '').trim();
  const prefix = agentContextPromptPrefix();
  if (!text || !prefix || text.includes('【当前引用上下文】')) return text;
  return `${prefix}\n\n【用户问题】\n${text}`;
}

function agentContextCardHtml(context = state.agentContext) {
  if (!context) return '';
  const title = agentContextTitle(context);
  const surface = agentContextSurfaceLabel(context);
  const quote = plainSnippet(context.quote || context.body || '', 160);
  const body = context.quote && context.body ? plainSnippet(context.body, 140) : '';
  const meta = [surface, context.author, context.createdAt ? formatAssetTime(context.createdAt) : ''].filter(Boolean).join(' · ');
  return `
    <div class="agent-inline-context-card">
      <div class="agent-inline-context-top">
        <span>${escapeHtml(title)}</span>
        <button type="button" class="agent-context-clear" data-agent-context-clear title="清除引用上下文" aria-label="清除引用上下文">${lucideIcon('x')}</button>
      </div>
      ${meta ? `<div class="agent-inline-context-meta">${escapeHtml(meta)}</div>` : ''}
      <blockquote>${escapeHtml(quote || '已加入当前上下文')}</blockquote>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    </div>`;
}

function bindAgentContextNode(root) {
  if (!root) return;
  const clear = root.querySelector('[data-agent-context-clear]');
  if (clear) clear.onclick = () => clearAgentContext();
}

function agentContextNode() {
  if (!state.agentContext) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = agentContextCardHtml();
  const node = wrapper.firstElementChild;
  bindAgentContextNode(node);
  return node;
}

function renderAgentInlineContext() {
  const el = $('#agent-inline-context');
  if (!el) return;
  if (!state.agentContext) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = agentContextCardHtml();
  el.classList.remove('hidden');
  bindAgentContextNode(el);
}

function clearAgentContext({ refresh = true } = {}) {
  state.agentContext = null;
  renderAgentInlineContext();
  renderAgentContextStrip();
  if (refresh) refreshPersonaAgent();
}

function setAgentContext(context, { focus = true } = {}) {
  if (!context) return;
  state.agentContext = {
    ...context,
    entryId: state.activeEntry?.id || '',
    createdAt: context.createdAt || Date.now(),
  };
  setContextPanel('agent', { expand: true });
  renderAgentInlineContext();
  renderAgentContextStrip();
  refreshPersonaAgent();
  updateAgentControls();
  if (focus) focusAgentComposer();
  toast('已加入 AI 上下文');
}

function focusAgentComposer() {
  setTimeout(() => {
    const personaInput = $('#persona-agent-host textarea, #persona-agent-host [contenteditable="true"], #persona-agent-host input');
    const fallbackInput = $('#agent-input');
    const input = personaInput || fallbackInput;
    if (!input || input.disabled) return;
    input.focus({ preventScroll: true });
    if ('selectionStart' in input) input.selectionStart = input.selectionEnd = input.value.length;
  }, 180);
}

function contextFromAnnotation(item) {
  if (!item) return null;
  return {
    type: 'annotation',
    annotationId: item.id,
    surface: item.surface,
    quote: item.quote || '',
    body: item.body || '',
    replies: item.replies || [],
    author: item.author || '',
    createdAt: item.updatedAt || item.createdAt || Date.now(),
  };
}

function contextFromComment(comment) {
  if (!comment) return null;
  const display = commentDisplayParts(comment.body);
  return {
    type: 'comment',
    commentId: comment.id,
    quote: '',
    body: display.body || comment.body || '',
    author: comment.author || '',
    createdAt: comment.updatedAt || comment.createdAt || Date.now(),
  };
}

function sendAnnotationDraftToAgent() {
  const draft = state.annotationDraft;
  if (!draft) return;
  setAgentContext({
    type: 'selection',
    surface: draft.surface,
    quote: draft.quote,
    body: $('#annotation-popover-input')?.value.trim() || '',
    author: state.me?.displayName || '读者',
  });
  hideAnnotationPopover();
  window.getSelection()?.removeAllRanges();
}

function sendAnnotationToAgent(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return toast('找不到这条划线点评');
  setAgentContext(contextFromAnnotation(item));
}

function sendCommentToAgent(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment) return toast('找不到这条点评');
  setAgentContext(contextFromComment(comment));
}

function personaThemeConfig() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';
  return {
    semantic: {
      colors: {
        accent,
        container: 'transparent',
      },
    },
  };
}

function buildPersonaAgentConfig() {
  const persona = window.AgentWidget || {};
  return {
    ...(persona.DEFAULT_WIDGET_CONFIG || {}),
    apiUrl: '/api/persona/local',
    launcher: { enabled: false },
    autoFocusInput: false,
    colorScheme: document.body?.dataset.theme === 'dark' ? 'dark' : 'light',
    copy: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.copy) || {}),
      welcomeTitle: '围绕当前文章提问',
      welcomeSubtitle: '',
      inputPlaceholder: state.activeEntry ? '问当前文章…' : '先选择一篇文章',
      sendButtonLabel: '发送',
      stopButtonLabel: '停止',
      showWelcomeCard: false,
    },
    layout: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.layout) || {}),
      showHeader: false,
      contentMaxWidth: '100%',
    },
    theme: personaThemeConfig(),
    parserType: 'plain',
    initialMessages: personaInitialMessages(),
    suggestionChips: [],
    plugins: [createPersonaPromptPlugin()],
    postprocessMessage: ({ text }) => (
      persona.markdownPostprocessor ? persona.markdownPostprocessor(text) : renderMarkdownLite(text)
    ),
    sanitize: html => (window.DOMPurify ? window.DOMPurify.sanitize(html) : escapeHtml(html)),
    customFetch: personaCustomFetch,
    parseSSEEvent: personaParseSseEvent,
    errorMessage: (error) => `对话失败：${error && error.message ? error.message : '请稍后重试'}`,
    features: {
      ...((persona.DEFAULT_WIDGET_CONFIG && persona.DEFAULT_WIDGET_CONFIG.features) || {}),
      showEventStreamToggle: false,
      showReasoning: false,
      showToolCalls: false,
      scrollBehavior: { mode: 'follow' },
      streamAnimation: { type: 'typewriter', buffer: 'word' },
    },
    messageActions: {
      copy: { enabled: true },
      feedback: { enabled: false },
    },
    webmcp: { enabled: false },
    textToSpeech: { enabled: false },
    voiceRecognition: { enabled: false },
  };
}

function syncPersonaAgentVisibility() {
  const panel = $('#agent-side-panel');
  if (!panel) return;
  panel.classList.toggle('persona-agent-active', personaAgentActive());
}

function destroyPersonaAgent() {
  if (state.personaAgentController && typeof state.personaAgentController.destroy === 'function') {
    try { state.personaAgentController.destroy(); } catch { /* best effort cleanup */ }
  }
  state.personaAgentController = null;
  state.personaAgentEntryId = '';
  state.personaAgentMessageKey = '';
  state.personaAgentReady = false;
  const host = $('#persona-agent-host');
  if (host) host.innerHTML = '';
  syncPersonaAgentVisibility();
}

function mountPersonaAgent({ force = false } = {}) {
  const host = $('#persona-agent-host');
  const entryId = state.activeEntry?.id || '';
  if (!host || !entryId || !personaAgentAvailable()) {
    if (!entryId || !personaAgentAvailable()) destroyPersonaAgent();
    return;
  }
  const nextKey = `${PERSONA_AGENT_VERSION}:${entryId}:${personaMessagesKey()}`;
  if (
    !force &&
    state.personaAgentController &&
    state.personaAgentEntryId === entryId &&
    state.personaAgentMessageKey &&
    !personaInitialMessages().length
  ) {
    if (typeof state.personaAgentController.update === 'function') {
      state.personaAgentController.update(buildPersonaAgentConfig());
    }
    syncPersonaAgentVisibility();
    return;
  }
  if (
    !force &&
    state.personaAgentController &&
    state.personaAgentEntryId === entryId &&
    state.personaAgentMessageKey === nextKey
  ) {
    if (typeof state.personaAgentController.update === 'function') {
      state.personaAgentController.update(buildPersonaAgentConfig());
    }
    syncPersonaAgentVisibility();
    return;
  }

  destroyPersonaAgent();
  try {
    const controller = window.AgentWidget.createAgentExperience(host, buildPersonaAgentConfig());
    state.personaAgentController = controller;
    state.personaAgentEntryId = entryId;
    state.personaAgentMessageKey = nextKey;
    state.personaAgentReady = true;
    controller.on?.('user:message', () => {
      state.agentBusy = true;
      updateAgentControls();
    });
    controller.on?.('assistant:complete', async () => {
      state.agentBusy = false;
      updateAgentControls();
      if (state.activeEntry?.id === entryId) await loadAgentMessages(state.activeEntry);
    });
    syncPersonaAgentVisibility();
  } catch (err) {
    console.warn('Persona agent failed to mount', err);
    destroyPersonaAgent();
  }
}

function refreshPersonaAgent() {
  if (!personaAgentActive()) return;
  mountPersonaAgent({ force: true });
}

function submitPersonaAgentMessage(text) {
  const content = String(text || '').trim();
  if (!content || !personaAgentActive()) return false;
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) {
    openAiConfigModal('agent', 'agent', content);
    toast('请先保存一个可用的 AI 配置');
    return true;
  }
  const controller = state.personaAgentController;
  const submitted = controller.submitMessage?.(withAgentContext(content));
  if (!submitted) {
    controller.setMessage?.(withAgentContext(content));
    controller.submitMessage?.();
  }
  return true;
}

function renderAgentContextStrip() {
  const el = $('#agent-context-strip');
  if (!el) return;
  const entry = state.activeEntry;
  if (!entry) {
    el.innerHTML = '<span>未选择文章</span>';
    return;
  }
  const assets = mergeAssets(entry);
  const stats = entryStats(entry);
  const parts = [
    ['上下文', '当前文章'],
    state.agentContext ? ['引用', agentContextTitle(state.agentContext)] : null,
    ['划线', formatCompactCount((state.annotations || []).length) || '0'],
    ['点评', formatCompactCount((state.comments || []).length) || '0'],
    ['对话', formatCompactCount((state.agentMessages || []).length) || '0'],
  ].filter(Boolean);
  if (assets.latestAt) parts.push(['资产', formatAssetTime(assets.latestAt)]);
  if (stats.viewCount) parts.push(['访问', formatCompactCount(stats.viewCount)]);
  el.innerHTML = parts.map(([label, value]) => `
    <span class="agent-context-chip"><em>${escapeHtml(label)}</em>${escapeHtml(value)}</span>
  `).join('');
}

function agentEmptyHtml(kind = 'empty') {
  const hasArticle = Boolean(state.activeEntry);
  const title = !hasArticle ? '先选择一篇文章' : kind === 'busy' ? '正在组织回答' : '围绕当前文章开始伴读';
  const note = !hasArticle
    ? '未选择上下文。'
    : '回答会尽量围绕正文；关键事实请回到原文核查。';
  return `
    <div class="agent-empty agent-empty-state">
      <div class="agent-empty-mark">AI</div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(note)}</p>
    </div>`;
}

function setReaderTitleLink(anchor, text, url, ariaPrefix = '打开原文') {
  if (!anchor) return;
  const value = String(text || '').trim() || '未命名文章';
  anchor.textContent = value;
  anchor.title = url ? '打开原文' : '';
  anchor.setAttribute('aria-label', url ? `${ariaPrefix}：${value}` : value);
  anchor.classList.toggle('disabled', !url);
  if (url) {
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  } else {
    anchor.removeAttribute('href');
  }
}

function renderTitle(e) {
  // 译后只保留一行中文主标题，不再并列显示英文副标题
  const mainTitle = e.titleZh || e.title;
  const mainLink = $('#reader-title-link');
  const originalLink = $('#reader-title-original-link');
  if (mainLink) {
    setReaderTitleLink(mainLink, mainTitle, e.link, '打开原文');
  } else {
    $('#reader-title').textContent = mainTitle;
  }
  const originalWrap = $('#reader-title-zh');
  if (originalWrap) originalWrap.classList.add('hidden');
  if (originalLink) setReaderTitleLink(originalLink, '', e.link, '打开原文');
}

function updateFetchOriginalButton(entry = state.activeEntry) {
  const btn = $('#reader-fetch-original');
  if (!btn) return;
  const offline = Boolean(entry && isLocalOfflineSourceId(entry.sourceId));
  const canFetch = Boolean(entry && /^https?:\/\//i.test(entry.link || '')) && !offline;
  const hasFull = Boolean(entry && (entry.originalFetchedAt || hasUsableOriginalContent(entry) || offline));
  // 失败后仍显示按钮，方便重试（尤其是 DNS/内网误杀）；本地离线源始终隐藏
  btn.classList.toggle('hidden', !canFetch || hasFull);
  btn.disabled = !canFetch || hasFull || state.fetchingOriginal;
  setButtonIconLabel(btn, state.fetchingOriginal ? 'loader-circle' : 'book-open-text', state.fetchingOriginal ? '获取中…' : '获取原文', {
    className: state.fetchingOriginal ? 'app-icon app-icon-spin' : 'app-icon',
  });
  btn.title = offline
    ? '本地导入源，无需抓取网页'
    : (entry && entry.originalFetchError ? `上次获取失败：${entry.originalFetchError}` : '从原始网页提取正文');
}

function updateReaderTocVisibility(tab = state.readerTab) {
  const toc = $('#reader-toc');
  if (!toc) return;
  toc.classList.toggle('hidden', tab !== 'original' || !state.readerTocAvailable);
}

function syllabusScheduleTableScore(table) {
  const rows = [...table.querySelectorAll('tr')];
  if (rows.length < 2) return -100;
  const header = [...(rows[0]?.children || [])].map(cell => cell.textContent || '').join(' ');
  const text = table.textContent.replace(/\s+/g, ' ').trim();
  const context = [
    table.getAttribute('class') || '',
    table.getAttribute('id') || '',
    table.previousElementSibling?.textContent || '',
    table.closest('section,article,div')?.getAttribute('class') || '',
  ].join(' ');
  let score = Math.min(rows.length, 24) + Math.min(rows[0]?.children.length || 0, 8) * 2;
  if (/date|week|lecture|topic|schedule|calendar|session|material|日期|周次|讲次|主题|日程|课程安排|课程内容/i.test(header)) score += 32;
  if (/日期|周次|讲次|主题|课程资料|截止日期|课程内容|内容/i.test(header)) score += 18;
  if (/schedule|calendar|lecture|syllabus|课程日程|课表|课程安排/i.test(context)) score += 20;
  if (/assignment|deadline|reading|slides|video|作业|截止|阅读|讲义|视频/i.test(header)) score += 8;
  if (/grading|grade breakdown|staff|office hours|assessment|评分|成绩|教师|办公时间/i.test(`${header} ${context}`)) score -= 28;
  if (text.length < 80) score -= 15;
  return score;
}

function syllabusScheduleFromCourseCards(body) {
  const cardSelector = '.course-entry, .lecture-entry, .lesson, .week-overview, [class*="lecture-card"]';
  const cards = [...body.querySelectorAll(cardSelector)]
    .filter(card => !card.querySelector(cardSelector));
  if (cards.length < 3) return null;
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>讲次</th><th>课程内容</th><th>资源</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  cards.forEach((card, index) => {
    const isWeek = card.classList.contains('week-overview');
    const heading = card.querySelector(isWeek ? 'h2' : 'h1,h2,h3,h4,h5,strong');
    const weekLabel = isWeek
      ? (card.querySelector('h3')?.textContent.replace(/\s+/g, ' ').trim() || card.dataset.number || '')
      : '';
    const links = [...card.querySelectorAll('a[href]')];
    const details = [...card.querySelectorAll('p,.meta,.description')]
      .map(el => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
    const row = document.createElement('tr');
    const lesson = document.createElement('td');
    const content = document.createElement('td');
    const resources = document.createElement('td');
    lesson.textContent = weekLabel || String(index + 1);
    content.textContent = [heading?.textContent.replace(/\s+/g, ' ').trim(), details].filter(Boolean).join(' · ');
    links.forEach((link) => {
      const clone = link.cloneNode(true);
      clone.textContent = clone.textContent.replace(/\s+/g, ' ').trim() || '打开';
      resources.appendChild(clone);
    });
    row.append(lesson, content, resources);
    tbody.appendChild(row);
  });
  return table;
}

function syllabusScheduleFromLectureList(body) {
  const headings = [...body.querySelectorAll('h1,h2,h3,h4')];
  const candidates = [];
  const seenLists = new Set();
  const addCandidate = (items, headingText = '') => {
    if (!items.length || seenLists.has(items[0]?.parentElement)) return;
    const text = items.map(item => item.textContent).join(' ');
    const dated = items.filter(item => /^\s*\d{1,2}\/\d{1,2}\b/.test(item.textContent || '')).length;
    seenLists.add(items[0]?.parentElement);
    candidates.push({
      items,
      score: (/[\u3400-\u9fff]/.test(text) ? 30 : 0)
        + (/[\u3400-\u9fff]/.test(headingText) ? 10 : 0)
        + Math.min(items.length, 20)
        + Math.min(dated, 12) * 3,
    });
  };
  for (const heading of headings) {
    if (!/lectures?|schedule|calendar|课程日程|课表|讲次|讲座|课程安排|20\d{2}\s*lectures?/i.test(heading.textContent || '')) continue;
    let list = heading.nextElementSibling;
    while (list && !/^(UL|OL)$/.test(list.tagName)) {
      if (/^H[1-4]$/.test(list.tagName)) break;
      list = list.nextElementSibling;
    }
    const items = list ? [...list.children].filter(el => el.tagName === 'LI') : [];
    if (items.length < 3) continue;
    addCandidate(items, heading.textContent || '');
  }
  body.querySelectorAll('ul,ol').forEach((list) => {
    const items = [...list.children].filter(el => el.tagName === 'LI');
    const dated = items.filter(item => /^\s*\d{1,2}\/\d{1,2}\b/.test(item.textContent || '')).length;
    if (items.length >= 3 && dated >= Math.min(3, items.length)) addCandidate(items);
  });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>日期</th><th>课程内容</th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  best.items.forEach((item, index) => {
    const row = document.createElement('tr');
    const date = document.createElement('td');
    const content = document.createElement('td');
    const text = item.textContent.replace(/\s+/g, ' ').trim();
    date.textContent = item.querySelector('strong,time')?.textContent.replace(/\s+/g, ' ').trim()
      || (text.match(/^(\d{1,2}\/\d{1,2}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\w+\s+\d{1,2})\s*[:：-]?/i) || [])[1]
      || String(index + 1);
    const links = [...item.querySelectorAll('a[href]')];
    if (links.length) {
      links.forEach((link, linkIndex) => {
        if (linkIndex) content.append(' · ');
        content.appendChild(link.cloneNode(true));
      });
    } else {
      content.textContent = text
        .replace(new RegExp(`^${date.textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：-]?\\s*`), '');
    }
    row.append(date, content);
    tbody.appendChild(row);
  });
  return table;
}

function retainSyllabusScheduleOnly(body) {
  if (!body || body.dataset.scheduleOnly === 'true') return;
  const tables = [...body.querySelectorAll('table')];
  let schedule = tables
    .map(table => ({ table, score: syllabusScheduleTableScore(table) }))
    .sort((a, b) => b.score - a.score)[0];
  let table = schedule && schedule.score >= 12 ? schedule.table : null;
  if (!table) table = syllabusScheduleFromCourseCards(body);
  if (!table) table = syllabusScheduleFromLectureList(body);

  body.innerHTML = '';
  body.dataset.scheduleOnly = 'true';
  if (!table) {
    const empty = document.createElement('p');
    empty.className = 'syllabus-schedule-empty';
    empty.textContent = '暂未识别到课程表。';
    body.appendChild(empty);
    return;
  }
  body.append(table);
}

function restoreSyllabusScheduleFromOriginal(body, entry = state.activeEntry) {
  if (!body || body.querySelector('table')) return;
  const originalHtml = contentCache.get(entry?.id) || entry?.content || '';
  if (!/<table\b/i.test(String(originalHtml))) return;
  const doc = new DOMParser().parseFromString(String(originalHtml), 'text/html');
  const best = [...doc.querySelectorAll('.syllabus-body table, table')]
    .map(table => ({ table, score: syllabusScheduleTableScore(table) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 12) return;
  body.innerHTML = '';
  body.dataset.scheduleOnly = 'true';
  body.append(best.table.cloneNode(true));
}

function restoreSyllabusScheduleImages(body, entry = state.activeEntry) {
  const targetTable = body?.querySelector('table');
  const originalHtml = contentCache.get(entry?.id) || entry?.content || '';
  const translationPairs = Array.isArray(state.translation?.content) ? state.translation.content : [];
  const translationHtml = translationPairs.map(pair => pair?.targetHtml || '').join('');
  const imageSourceHtml = /<img\b/i.test(String(originalHtml)) ? originalHtml : translationHtml;
  if (!targetTable || !/<img\b/i.test(String(imageSourceHtml))) return;
  const doc = new DOMParser().parseFromString(String(imageSourceHtml), 'text/html');
  const originalTables = [...doc.querySelectorAll('.syllabus-body table, table')];
  const best = originalTables
    .map(table => ({ table, score: syllabusScheduleTableScore(table) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 12) return;

  const sourceRows = [...best.table.querySelectorAll('tr')];
  const targetRows = [...targetTable.querySelectorAll('tr')];
  const existing = new Set(
    [...targetTable.querySelectorAll('img[src]')]
      .map(img => String(img.getAttribute('src') || '').split('#')[0]),
  );
  sourceRows.forEach((sourceRow, rowIndex) => {
    const targetRow = targetRows[rowIndex];
    if (!targetRow) return;
    const sourceCells = [...sourceRow.children];
    const targetCells = [...targetRow.children];
    sourceRow.querySelectorAll('img[src]').forEach((sourceImage) => {
      const src = String(sourceImage.getAttribute('src') || '').trim();
      const key = src.split('#')[0];
      if (!src || existing.has(key) || !/^https?:\/\//i.test(src)) return;
      const sourceCell = sourceImage.closest('td,th');
      const columnIndex = Math.max(0, sourceCells.indexOf(sourceCell));
      const targetCell = targetCells[columnIndex] || targetCells[targetCells.length - 1];
      if (!targetCell) return;

      const image = document.createElement('img');
      image.src = src;
      image.alt = sourceImage.getAttribute('alt') || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.className = 'syllabus-restored-image';
      const sourceLink = sourceImage.closest('a[href]');
      if (sourceLink && /^https?:\/\//i.test(sourceLink.getAttribute('href') || '')) {
        const link = document.createElement('a');
        link.href = sourceLink.getAttribute('href');
        link.target = '_blank';
        link.rel = 'noopener';
        link.appendChild(image);
        targetCell.appendChild(link);
      } else {
        targetCell.appendChild(image);
      }
      existing.add(key);
    });
  });
}

function translateSyllabusScheduleTable(table, translation = state.translation) {
  if (!table || !translation || !Array.isArray(translation.content)) return;
  const replacements = translation.content
    .map((pair) => ({
      source: String(pair?.source || '').replace(/\s+/g, ' ').trim(),
      target: String(pair?.target || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(item => (
      item.source.length >= 3
      && item.target
      && item.source !== item.target
      && /[\u3400-\u9fff]/.test(item.target)
    ))
    .sort((a, b) => b.source.length - a.source.length);
  if (!replacements.length) return;

  table.querySelectorAll('th,td').forEach((cell) => {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.parentElement?.closest('a[href]')) return;
      let text = node.nodeValue || '';
      for (const item of replacements) {
        if (text.includes(item.source)) text = text.split(item.source).join(item.target);
      }
      node.nodeValue = text;
    });
  });

  const resourceLabels = {
    Watch: '视频',
    Slides: '幻灯片',
    Source: '源码',
    Video: '视频',
    Recording: '录像',
  };
  table.querySelectorAll('a[href]').forEach((link) => {
    const label = String(link.textContent || '').trim();
    if (resourceLabels[label]) link.textContent = resourceLabels[label];
  });
}

function enhanceSyllabusContent(root = $('#reader-content'), entry = state.activeEntry) {
  if (!root) return;
  const brief = root.querySelector('.syllabus-brief');
  const body = root.querySelector('.syllabus-body');
  if (!brief && !body) return;

  if (brief) {
    brief.dataset.enhanced = 'true';
    // 阅读区只保留课程日程；课号、学校和入口已在左侧课程目录中提供。
    [...brief.children].forEach((child) => {
      if (child !== body) child.remove();
    });
  }

  if (!body) return;
  body.querySelectorAll(
    '.search, .search-input-wrap, .search-results, .search-label, '
    + '.main-header:empty, nav:empty, header:empty',
  ).forEach(el => el.remove());
  body.querySelectorAll('.main-header, nav, header').forEach((el) => {
    if (!el.textContent.replace(/\s+/g, '').trim() && !el.querySelector('img,video,table,a[href]')) el.remove();
  });
  retainSyllabusScheduleOnly(body);
  restoreSyllabusScheduleFromOriginal(body, entry);
  restoreSyllabusScheduleImages(body, entry);
  if (state.readerZhMode) {
    body.querySelectorAll('table').forEach(table => translateSyllabusScheduleTable(table, state.translation));
  }

  body.querySelectorAll('a[href]').forEach((link) => {
    const label = `${link.textContent || ''} ${link.getAttribute('href') || ''}`;
    if (/\b(pdf|slides?|video|watch|recording|source|github|colab|notebook|download|code|preview|讲义|课件|视频|源码|作业)\b|\.(?:pdf|py|ipynb)(?:$|[?#])/i.test(label)) {
      link.classList.add('syllabus-resource-link');
    }
  });

  const cmeTable = brief?.classList.contains('syllabus-brief--cme295')
    || brief?.classList.contains('syllabus-brief--cme296');
  if (cmeTable) {
    body.querySelectorAll('table tr').forEach((row) => {
      const dateCell = row.querySelector('td:first-child');
      if (!dateCell) return;
      dateCell.querySelectorAll('sup').forEach(sup => sup.remove());
      dateCell.textContent = dateCell.textContent
        .replace(/(\d)(?:st|nd|rd|th)(?=日|$)/gi, '$1')
        .replace(/日{2,}/g, '日')
        .trim();
    });
  }

  body.querySelectorAll('table').forEach((table) => {
    const rows = [...table.querySelectorAll('tr')];
    const columnCount = rows.reduce((max, row) => Math.max(max, row.children.length), 0);
    table.dataset.columns = String(columnCount);
    table.classList.toggle('syllabus-table--wide', columnCount >= 5);
    table.classList.toggle('syllabus-table--compact', columnCount > 0 && columnCount <= 4);
    const headerCells = [...(rows[0]?.children || [])];
    const topicIndex = headerCells.findIndex(cell => /topic|title|lecture|content|主题|课程|内容|讲次/i.test(cell.textContent || ''));
    if (topicIndex >= 0) {
      rows.forEach(row => row.children[topicIndex]?.classList.add('syllabus-table-topic'));
    }
    if (!table.parentElement?.classList.contains('syllabus-table-scroll')) {
      const scroll = document.createElement('div');
      scroll.className = 'syllabus-table-scroll';
      table.parentNode.insertBefore(scroll, table);
      scroll.appendChild(table);
    }
  });
}

function renderReaderToc(root = $('#reader-content')) {
  const toc = $('#reader-toc');
  const list = $('#reader-toc-list');
  if (!toc || !list || !root) return;
  const reader = $('#reader');
  const isSyllabus = Boolean(
    reader?.classList.contains('reader--syllabus')
    || root.querySelector('.syllabus-brief, .syllabus-body'),
  );
  // 大纲：优先扫 body 内标题（含 h1）；普通文章仍 h2–h4
  const scope = isSyllabus
    ? (root.querySelector('.syllabus-body') || root)
    : root;
  const selector = isSyllabus ? 'h1,h2,h3,h4' : 'h2,h3,h4';
  const headings = [...scope.querySelectorAll(selector)]
    .map((el, index) => {
      if (el.classList.contains('syllabus-title')) return null;
      if (el.closest('.syllabus-header')) return null;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return null;
      el.id = el.id || `reader-section-${index + 1}`;
      return { id: el.id, text, level: el.tagName.toLowerCase() };
    })
    .filter(Boolean)
    .slice(0, isSyllabus ? 48 : 24);
  state.readerTocAvailable = headings.length >= (isSyllabus ? 1 : 2);
  if (!state.readerTocAvailable) {
    toc.open = false;
    list.innerHTML = '';
    updateReaderTocVisibility();
    return;
  }
  toc.open = isSyllabus;
  list.innerHTML = headings.map(item => `
    <a class="reader-toc-link reader-toc-${item.level}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>
  `).join('');
  updateReaderTocVisibility();
}

let markdownRendererPromise = null;

function normalizeMarkdownCompatibility(value, { sourceId = '' } = {}) {
  const normalized = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');
  const source = window.QMContentNormalizers
    ? window.QMContentNormalizers.normalizeBySource(normalized, sourceId)
    : normalized;
  return source
    .replace(/\*\*\s+([^*\n]{1,240}?)\s*\*\*/g, '**$1**')
    // 部分正文抽取器会吞掉加粗片段后的空格，导致 CommonMark 无法闭合 **。
    .replace(/(\*\*[^*\n]{1,240}\*\*)(?=[\p{L}\p{N}])/gu, '$1 ')
    // 容忍从 HTML 标题转换而来的 “##标题”。
    .replace(/^(#{1,6})(?=[^\s#])/gm, '$1 ')
    .trim();
}

function protectMarkdownMath(value) {
  const expressions = [];
  const stash = expression => {
    const token = `QMMATHPLACEHOLDER${String(expressions.length).padStart(5, '0')}TOKEN`;
    expressions.push({ token, expression });
    return token;
  };
  let source = String(value || '')
    .replace(/\$\$[\s\S]+?\$\$/g, match => stash(match))
    .replace(/\\\[[\s\S]+?\\\]/g, match => stash(match))
    .replace(/\\\([^\n]+?\\\)/g, match => stash(match));
  source = source.replace(/(?<!\\)\$(?!\$)([^\n$]+?)(?<!\\)\$/g, (match, body) => {
    const formula = String(body || '');
    if (!formula || formula !== formula.trim()) return match;
    return stash(`\\(${formula}\\)`);
  });
  return {
    source,
    restore(html) {
      let output = String(html || '');
      // A replacement string treats `$$` as an escape for one literal `$`.
      // Use a callback so display-math delimiters survive restoration intact.
      for (const item of expressions) output = output.replaceAll(item.token, () => escapeHtml(item.expression));
      return output;
    },
  };
}

async function renderMarkdownDocument(markdown, { sourceId = '' } = {}) {
  const source = normalizeMarkdownCompatibility(markdown, { sourceId });
  if (!source) return '';
  if (!markdownRendererPromise) {
    markdownRendererPromise = import('/vendor/persona/markdown-parsers.js')
      .then(({ Marked }) => new Marked())
      .catch(error => {
        markdownRendererPromise = null;
        throw error;
      });
  }
  try {
    const parser = await markdownRendererPromise;
    const math = protectMarkdownMath(source);
    return math.restore(parser.parse(math.source, { gfm: true, breaks: false, pedantic: false, silent: true }));
  } catch (error) {
    console.warn('Markdown rendering failed', error);
    return renderMarkdownLite(source);
  }
}

function parseSocialPayload(content) {
  const text = String(content || '');
  const marker = '<!--qm-social-v1';
  if (!text.startsWith(marker)) return null;
  // A comment/reply can contain a literal `-->`; stop only at the marker line.
  let end = text.indexOf('\n-->', marker.length);
  if (end === -1) end = text.indexOf('-->', marker.length);
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(marker.length, end).trim());
  } catch {
    return null;
  }
}

function comparableSocialText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

/**
 * X：有中文译文时丢掉文末「原文」英文章节（仍可通过原网址打开）。
 */
function stripXOriginalIfChinesePresent(body) {
  let text = String(body || '');
  const re = /(?:^|\n)[ \t]*(?:>[ \t]*)?(?:\*\*)?原文(?:\*\*)?[ \t]*(?:\n|$)/;
  const m = re.exec(text);
  if (!m) return text;
  const before = text.slice(0, m.index).trim();
  const chineseChars = (before.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseChars < 8) return text;
  return before;
}

/** 去掉标题与正文重复、首尾空段，避免顶上多出一行空白 */
function prepareSocialBodyMarkdown(body, title = '', { platform = '' } = {}) {
  let text = String(body || '').replace(/^\uFEFF/, '').trim();
  if (!text) return '';
  if (platform === 'x' || platform === 'x-likes') {
    text = stripXOriginalIfChinesePresent(text);
  }
  const titleKey = comparableSocialText(title);
  if (titleKey) {
    // 正文以同名一级标题开头时去掉
    text = text.replace(new RegExp(`^#{1,3}\\s+${titleKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'i'), '');
    // 正文首段与标题完全相同则去掉
    const firstPara = text.split(/\n{2,}/)[0] || '';
    if (comparableSocialText(firstPara) === titleKey) {
      text = text.slice(firstPara.length).replace(/^\s+/, '');
    }
  }
  const nlRegex = /^\n+/;
  const multiNlRegex = /\n{3,}/g;
  return text.replace(nlRegex, '').replace(multiNlRegex, '\n\n').trim();
}

function tidySocialHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  // 去掉开头连续空段落 / 仅含 br 的段
  return raw
    .replace(/^(?:\s*<(?:p|div)[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*\s*<\/(?:p|div)>\s*)+/i, '')
    .replace(/(?:\s*<(?:p|div)[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*\s*<\/(?:p|div)>\s*)+$/i, '')
    .trim();
}

async function socialMarkdownHtml(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // 完整 GFM：列表、引用、代码、链接；breaks 对推文更友好
  try {
    const html = await renderMarkdownDocument(raw, { sourceId: 'social' });
    return tidySocialHtml(html || '');
  } catch {
    return tidySocialHtml(renderMarkdownLite(raw));
  }
}

function socialAvatarHtml(name, platform) {
  const label = String(name || (platform === 'xhs' ? '红' : platform === 'bili' ? 'B' : 'X')).trim();
  // 优先用汉字/字母；跳过符号，避免顶上出现怪字符
  const ch = (label.match(/[\p{L}\p{N}]/u) || ['·'])[0];
  const cls = platform === 'xhs'
    ? 'social-avatar social-avatar--xhs'
    : platform === 'bili'
      ? 'social-avatar social-avatar--bili'
      : 'social-avatar social-avatar--x';
  return `<span class="${cls}" aria-hidden="true"><span class="social-avatar-letter">${escapeHtml(ch)}</span></span>`;
}

/** 社交卡作者名旁的收藏星（与 #reader-star 同步） */
function socialStarButtonHtml(entry, starred) {
  const id = entry && entry.id ? String(entry.id) : '';
  if (!id) return '';
  const on = Boolean(starred);
  return `<button type="button" class="social-star-btn${on ? ' starred' : ''}" data-entry-star="${escapeHtml(id)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? '取消收藏' : '收藏'}" title="${on ? '取消收藏' : '收藏'}">${on ? '★' : '☆'}</button>`;
}

function syncSocialStarButtons(entryId, starred) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const on = Boolean(starred);
  document.querySelectorAll(`.social-star-btn[data-entry-star="${CSS.escape(id)}"]`).forEach((btn) => {
    btn.classList.toggle('starred', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.title = on ? '取消收藏' : '收藏';
    btn.textContent = on ? '★' : '☆';
  });
}

function formatSocialCount(n) {
  const num = Number(n) || 0;
  if (num >= 10000) return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(num);
}

function isLikesSourceId(sourceId) {
  // 收藏流 + 知识库小红书博主 + B站稍后再看（均为 qm-social 时间语义）
  return sourceId === 'xhs-likes'
    || sourceId === 'x-likes'
    || sourceId === 'bili-watchlater'
    || sourceId === 'xhs-wanyouyinli'
    || sourceId === 'xhs-luoye'
    || sourceId === 'xhs-shutiao'
    || /^xhs-/.test(String(sourceId || ''));
}

/** `2026-07-13 17:34:23 +0800` / ISO → `2026-07-13 17:34:23`（墙钟展示，无时区后缀） */
function formatFavoritedClock(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')} ${String(m[4]).padStart(2, '0')}:${String(m[5]).padStart(2, '0')}:${String(m[6] || '0').padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t <= 0) return '';
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

/** 列表相对时间：小红书/X 用 published（展示时间），不用排序用的 publishedTs */
function entryDisplayTimeTs(entry) {
  if (!entry) return 0;
  if (isLikesSourceId(entry.sourceId)) {
    const fromPublished = Date.parse(entry.published || '');
    if (Number.isFinite(fromPublished) && fromPublished > 0) return fromPublished;
  }
  return Number(entry.publishedTs) || Date.parse(entry.published || '') || 0;
}

function socialDisplayTime(payload, entry) {
  // X / 小红书：均展示收藏（like）时间；displayAt 优先，其次 likedAt / favoritedAt
  const raw = (payload && (
    payload.displayAt
    || payload.favoritedAt
    || payload.likedAt
    || payload.collectedAt
    || payload.fileCreatedAt
  )) || '';
  const clock = formatFavoritedClock(raw);
  if (clock) return clock;
  const ts = entryDisplayTimeTs(entry);
  return ts ? formatFavoritedClock(new Date(ts).toISOString()) : '';
}

/** 透明 1×1，作图廊懒加载占位（真实尺寸由 CSS min-height + content-visibility 兜底） */
const SOCIAL_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
/** 阅读区长边上限（Retina 下约 720–900 逻辑 CSS px 足够；原图可达 5MB+/2K） */
const SOCIAL_IMG_MAX_EDGE = 1440;

function disposeSocialGalleryPerf() {
  if (state.socialGalleryIo) {
    try { state.socialGalleryIo.disconnect(); } catch { /* ignore */ }
    state.socialGalleryIo = null;
  }
  const blobs = state.socialGalleryBlobs || [];
  for (const url of blobs) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  state.socialGalleryBlobs = [];
}

async function downscaleSocialImageIfNeeded(img, maxEdge = SOCIAL_IMG_MAX_EDGE) {
  if (!img || !img.isConnected) return;
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) return;
  // 固定 intrinsic，避免后续 CSS 约束时反复测布局
  if (!img.getAttribute('width')) {
    img.width = w;
    img.height = h;
  }
  const edge = Math.max(w, h);
  if (edge <= maxEdge || typeof createImageBitmap !== 'function') return;
  if (String(img.currentSrc || img.src || '').startsWith('blob:')) return;
  try {
    const scale = maxEdge / edge;
    const rw = Math.max(1, Math.round(w * scale));
    const rh = Math.max(1, Math.round(h * scale));
    const bmp = await createImageBitmap(img, {
      resizeWidth: rw,
      resizeHeight: rh,
      resizeQuality: 'high',
    });
    if (!img.isConnected) {
      bmp.close();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = rw;
    canvas.height = rh;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      bmp.close();
      return;
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.86);
    });
    if (!blob || !img.isConnected) return;
    const url = URL.createObjectURL(blob);
    if (!Array.isArray(state.socialGalleryBlobs)) state.socialGalleryBlobs = [];
    state.socialGalleryBlobs.push(url);
    img.src = url;
    img.width = rw;
    img.height = rh;
  } catch {
    /* 同源/解码失败时保留原图 */
  }
}

/**
 * 小红书图廊滚动性能：
 * - 视口外用 data-src，IO 进入预取区再挂 src（限并发，避免滚太快一次解码十几张）
 * - 加载后写 width/height，过大图 createImageBitmap 降采样到 ~1440 边
 */
function bindSocialGalleryPerf(root) {
  disposeSocialGalleryPerf();
  if (!root) return;
  const pane = $('#reader-pane') || null;
  const imgs = [...root.querySelectorAll('.xhs-gallery-item img[data-src], .xhs-gallery-item img[src]')];
  if (!imgs.length) return;

  let inflight = 0;
  const queue = [];
  const MAX_INFLIGHT = 2;

  const markLoaded = (img) => {
    img.closest('.xhs-gallery-item')?.classList.add('is-loaded');
  };

  const onReady = (img) => {
    markLoaded(img);
    // 降采样放到 idle，避免堵滚动手势
    const run = () => { downscaleSocialImageIfNeeded(img); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 0);
  };

  const startLoad = (img) => {
    if (!img || !img.isConnected || img.dataset.socialLoad === '1') return;
    img.dataset.socialLoad = '1';
    const pendingSrc = String(img.dataset.src || '').trim();
    const currentSrc = String(img.getAttribute('src') || '').trim();
    const real = pendingSrc || currentSrc;
    if (!real || real.startsWith('data:')) {
      markLoaded(img);
      return;
    }
    inflight += 1;
    const finish = () => {
      inflight = Math.max(0, inflight - 1);
      pump();
    };
    const onLoad = () => {
      img.removeEventListener('error', onErr);
      onReady(img);
      finish();
    };
    const onErr = () => {
      img.removeEventListener('load', onLoad);
      markLoaded(img);
      finish();
    };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onErr, { once: true });
    if (pendingSrc && currentSrc !== pendingSrc) {
      // 换 src 后勿读旧图 complete，等 load/error
      img.src = pendingSrc;
      return;
    }
    if (img.complete && img.naturalWidth > 1) {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onErr);
      onReady(img);
      finish();
    }
  };

  const pump = () => {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const next = queue.shift();
      if (next && next.isConnected && next.dataset.socialLoad !== '1') startLoad(next);
    }
  };

  const enqueue = (img) => {
    if (!img || img.dataset.socialLoad === '1' || queue.includes(img)) return;
    queue.push(img);
    pump();
  };

  // 前 2 张立即开载；其余 IO 进预取区再载
  imgs.forEach((img, i) => {
    if (i < 2 || !img.dataset.src) enqueue(img);
  });

  if (typeof IntersectionObserver !== 'function') {
    imgs.forEach(enqueue);
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      io.unobserve(img);
      enqueue(img);
    }
  }, {
    root: pane,
    // 上下约 1.2 屏预取，滚读时刚好够解码又不抢当前帧
    rootMargin: '120% 0px',
    threshold: 0.01,
  });
  state.socialGalleryIo = io;
  imgs.forEach((img, i) => {
    if (i >= 2 && img.dataset.src) io.observe(img);
  });
}

async function renderXhsNativeHtml(entry, payload) {
  const images = Array.isArray(payload.images) ? payload.images.filter(i => i && i.src) : [];
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const author = payload.author || entry.author || '用户';
  const title = payload.title || entry.title || '';
  const time = socialDisplayTime(payload, entry);
  const bodyMd = prepareSocialBodyMarkdown(payload.body || entry.summary || '', title, { platform: 'xhs' });
  const bodyHtml = await socialMarkdownHtml(bodyMd);

  // 图片纵向铺开；首 2 张 eager，其余 data-src 由 bindSocialGalleryPerf 视口预取
  const gallery = images.length
    ? `<div class="xhs-gallery" data-count="${images.length}">
        ${images.map((img, i) => {
          const src = escapeHtml(img.src);
          const alt = escapeHtml(img.alt || `图 ${i + 1}`);
          const eager = i < 2;
          const imgAttrs = eager
            ? `src="${src}" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high"' : ''}`
            : `src="${SOCIAL_IMG_PLACEHOLDER}" data-src="${src}" loading="lazy"`;
          return `<figure class="xhs-gallery-item${eager ? ' is-pending' : ''}">
            <a href="${src}" target="_blank" rel="noopener" class="xhs-gallery-link">
              <img ${imgAttrs} alt="${alt}" decoding="async" referrerpolicy="no-referrer" />
            </a>
            ${images.length > 1 ? `<figcaption class="xhs-gallery-cap">${i + 1} / ${images.length}</figcaption>` : ''}
          </figure>`;
        }).join('')}
      </div>`
    : '';

  const tagHtml = tags.length
    ? `<div class="xhs-tags">${tags.map(t => `<span class="xhs-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const stats = `<div class="xhs-stats">
    <span><em>${formatSocialCount(payload.likes)}</em> 赞</span>
    <span><em>${formatSocialCount(payload.collected)}</em> 收藏</span>
    <span><em>${formatSocialCount(payload.commentsCount || comments.length)}</em> 评论</span>
  </div>`;

  // 评论 Markdown 并行渲染，避免 20+ 条串行 await 堵主线程
  const commentParts = await Promise.all(comments.map(async (c, i) => {
    const replies = Array.isArray(c.replies) ? c.replies : [];
    const [textHtml, ...replyHtmls] = await Promise.all([
      socialMarkdownHtml(c.text || ''),
      ...replies.map(r => socialMarkdownHtml(r.text || '')),
    ]);
    const replyParts = replies.map((r, ri) => `<div class="xhs-reply">
        <div class="xhs-reply-head"><strong>${escapeHtml(r.author || '')}</strong>${r.time ? `<span>${escapeHtml(r.time)}</span>` : ''}${r.likes ? `<span class="xhs-like">👍 ${r.likes}</span>` : ''}</div>
        <div class="xhs-reply-text social-md">${replyHtmls[ri] || ''}</div>
      </div>`);
    return `<div class="xhs-comment${c.highlight || i < 3 ? ' is-hot' : ''}">
      <div class="xhs-comment-head">
        ${socialAvatarHtml(c.author, 'xhs')}
        <div class="xhs-comment-meta">
          <strong>${escapeHtml(c.author || '')}</strong>
          <span>${escapeHtml(c.time || '')}</span>
        </div>
        ${c.likes ? `<span class="xhs-like">👍 ${c.likes}</span>` : ''}
      </div>
      <div class="xhs-comment-text social-md">${textHtml}</div>
      ${replyParts.length ? `<div class="xhs-replies">${replyParts.join('')}</div>` : ''}
    </div>`;
  }));

  const commentHtml = comments.length
    ? `<div class="xhs-comments">
        <div class="xhs-comments-head">评论 <span>${comments.length}</span></div>
        ${commentParts.join('')}
      </div>`
    : '';

  const starred = Boolean(entry && entry.id && state.starred.has(entry.id));
  return `<article class="xhs-note xhs-note--stack">
    <div class="xhs-panel">
      <header class="xhs-author-row">
        ${socialAvatarHtml(author, 'xhs')}
        <div class="xhs-author-meta">
          <div class="xhs-author-name">
            <span class="xhs-author-name-text">${escapeHtml(author)}</span>
            ${socialStarButtonHtml(entry, starred)}
          </div>
          <div class="xhs-author-sub">${escapeHtml(time)}${payload.type ? ` · ${escapeHtml(payload.type)}` : ''}</div>
        </div>
        ${payload.url ? `<a class="xhs-open" href="${escapeHtml(payload.url)}" target="_blank" rel="noopener noreferrer" data-direct-open="1">原笔记</a>` : ''}
      </header>
      ${title ? `<h1 class="xhs-title">${escapeHtml(title)}</h1>` : ''}
      ${bodyHtml ? `<div class="xhs-body social-md reader-prose">${bodyHtml}</div>` : ''}
      ${gallery}
      ${tagHtml}
      ${stats}
      ${commentHtml}
    </div>
  </article>`;
}

function xArticleHeadingFromBody(body) {
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
  return match ? match[1].trim() : '';
}

function formatBiliCount(n) {
  const num = Number(n) || 0;
  if (num >= 10000) return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(num);
}

/** B站稍后再看：大封面 + UP + 时长/播放 + 简介 + 打开原视频 */
async function renderBiliNativeHtml(entry, payload) {
  const cover = String(payload.cover || (payload.images && payload.images[0] && payload.images[0].src) || entry.image || '').trim();
  const author = payload.author || entry.author || 'UP主';
  const title = payload.title || entry.title || '';
  const time = socialDisplayTime(payload, entry);
  const durationText = payload.durationText || '';
  const views = formatBiliCount(payload.views);
  const likes = formatBiliCount(payload.likes);
  const danmaku = formatBiliCount(payload.danmaku);
  const bodyMd = prepareSocialBodyMarkdown(payload.body || entry.summary || '', title, { platform: 'bili' });
  const bodyHtml = await socialMarkdownHtml(bodyMd);
  const face = String(payload.authorFace || '').trim();
  const avatar = face
    ? `<img class="bili-avatar-img" src="${escapeHtml(face)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : socialAvatarHtml(author, 'bili');
  const coverHtml = cover
    ? `<a class="bili-cover-link" href="${escapeHtml(payload.url || entry.link || '#')}" target="_blank" rel="noopener noreferrer" data-direct-open="1">
        <img class="bili-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" loading="eager" decoding="async" referrerpolicy="no-referrer" fetchpriority="high" />
        ${durationText ? `<span class="bili-duration">${escapeHtml(durationText)}</span>` : ''}
        <span class="bili-play-badge" aria-hidden="true">▶</span>
      </a>`
    : '';
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const tagHtml = tags.length
    ? `<div class="bili-tags">${tags.map(t => `<span class="bili-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const starred = Boolean(entry && entry.id && state.starred.has(entry.id));
  return `<article class="bili-video">
    <div class="bili-panel">
      ${coverHtml}
      <header class="bili-author-row">
        <div class="bili-avatar">${avatar}</div>
        <div class="bili-author-meta">
          <div class="bili-author-name">
            <span class="bili-author-name-text">${escapeHtml(author)}</span>
            ${socialStarButtonHtml(entry, starred)}
          </div>
          <div class="bili-author-sub">${escapeHtml(time)}${payload.type ? ` · ${escapeHtml(payload.type)}` : ''}</div>
        </div>
        ${payload.url || entry.link
          ? `<a class="bili-open" href="${escapeHtml(payload.url || entry.link)}" target="_blank" rel="noopener noreferrer" data-direct-open="1">原视频</a>`
          : ''}
      </header>
      ${title ? `<h1 class="bili-title">${escapeHtml(title)}</h1>` : ''}
      <div class="bili-stats">
        <span><em>${views}</em> 播放</span>
        <span><em>${danmaku}</em> 弹幕</span>
        <span><em>${likes}</em> 赞</span>
      </div>
      ${tagHtml}
      ${bodyHtml ? `<div class="bili-body social-md reader-prose">${bodyHtml}</div>` : ''}
    </div>
  </article>`;
}

async function renderXNativeHtml(entry, payload) {
  const images = Array.isArray(payload.images) ? payload.images.filter(i => i && i.src) : [];
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const author = payload.author || entry.author || 'User';
  const username = payload.username || '';
  const time = socialDisplayTime(payload, entry);
  const title = payload.title || entry.title || '';
  const rawBody = String(payload.body || entry.summary || title || '').trim();
  // New imports carry an explicit kind. For existing entries, X Article exports
  // are identifiable by their leading level-2/3 Markdown heading.
  const legacyArticleHeading = xArticleHeadingFromBody(rawBody);
  const isArticle = payload.kind === 'article'
    || payload.isArticle === true
    || Boolean(legacyArticleHeading);
  const articleTitle = isArticle
    ? (title || legacyArticleHeading)
    : '';
  // A normal post's generated title is only for the list. Preserve the whole
  // post as body text instead of splitting its first line into a fake h1.
  const bodyMd = prepareSocialBodyMarkdown(rawBody, articleTitle, { platform: 'x' });
  const bodyHtml = await socialMarkdownHtml(bodyMd);
  // 图片宫格缩略图，点击灯箱放大
  const mediaHtml = images.length
    ? `<div class="x-gallery" data-count="${images.length}">
        ${images.map((img, i) => (
          `<figure class="x-gallery-item">
            <div class="x-gallery-link" data-lb-index="${i}" role="button" tabindex="0" aria-label="查看大图">
              <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || '')}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" />
            </div>
          </figure>`
        )).join('')}
      </div>`
    : '';

  const quote = payload.quote;
  let quoteHtml = '';
  if (quote && (quote.text || quote.body)) {
    // 嵌入转发帖：有中文译文时不展示「原文」英文（与主帖一致）
    const quoteMd = stripXOriginalIfChinesePresent(quote.body || quote.text || '');
    quoteHtml = `<div class="x-quote">
      <div class="x-quote-head">
        <strong>${escapeHtml(quote.author || quote.username || '引用')}</strong>
        ${quote.username ? `<span class="x-handle">@${escapeHtml(String(quote.username).replace(/^@/, ''))}</span>` : ''}
      </div>
      <div class="x-quote-body social-md">${await socialMarkdownHtml(quoteMd)}</div>
      ${quote.url ? `<a class="x-quote-link" href="${escapeHtml(quote.url)}" target="_blank" rel="noopener noreferrer" data-direct-open="1">查看原推</a>` : ''}
    </div>`;
  }

  const replyParts = await Promise.all(comments.map(async (c) => {
    const textHtml = await socialMarkdownHtml(c.text || '');
    return `<div class="x-reply">
      <div class="x-reply-head">
        ${socialAvatarHtml(c.author || c.username, 'x')}
        <div class="x-reply-meta">
          <strong>${escapeHtml(c.author || '')}</strong>
          ${c.username ? `<span class="x-handle">@${escapeHtml(c.username)}</span>` : ''}
          ${c.likes ? `<span class="x-like">❤ ${c.likes}</span>` : ''}
        </div>
      </div>
      <div class="x-reply-body social-md">${textHtml}</div>
    </div>`;
  }));
  const replyHtml = comments.length
    ? `<div class="x-replies">
        <div class="x-replies-head">热门回复 · ${comments.length}</div>
        ${replyParts.join('')}
      </div>`
    : '';

  const titleHtml = isArticle && articleTitle
    ? `<h1 class="x-title">${escapeHtml(articleTitle)}</h1>`
    : '';
  const starred = Boolean(entry && entry.id && state.starred.has(entry.id));
  return `<article class="x-tweet${isArticle ? ' x-tweet--article' : ' x-tweet--post'}">
    <header class="x-head">
      ${socialAvatarHtml(author, 'x')}
      <div class="x-identity">
        <div class="x-name-line">
          <strong class="x-name">${escapeHtml(author)}</strong>
          ${socialStarButtonHtml(entry, starred)}
        </div>
        ${time ? `<div class="x-time">${escapeHtml(time)}</div>` : ''}
      </div>
      ${payload.url ? `<a class="x-open" href="${escapeHtml(payload.url)}" target="_blank" rel="noopener noreferrer" data-direct-open="1" title="在 X 打开原帖">原帖</a>` : ''}
    </header>
    ${titleHtml}
    <div class="x-body social-md reader-prose">${bodyHtml}</div>
    ${mediaHtml}
    ${quoteHtml}
    ${replyHtml}
  </article>`;
}

/**
 * X 长文（Article）：社交壳隐藏了顶栏翻译按钮，改在推文卡头部注入同款按钮。
 * sanitize 会移除 <button>，因此只能在正文渲染完成后以 DOM 方式插入。
 */
function insertXTranslateButton(root, entry) {
  if (!root || !entry) return;
  if (typeof isEnglishArticle !== 'function' || !isEnglishArticle(entry)) return;
  const head = root.querySelector('.x-tweet--article .x-head');
  if (!head || head.querySelector('[data-x-translate]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reader-translate-btn x-translate-btn';
  btn.dataset.xTranslate = '1';
  btn.textContent = '翻译';
  btn.title = '译为简体中文（仅首次调用 API，结果永久缓存）';
  btn.setAttribute('aria-label', '译为简体中文');
  btn.setAttribute('aria-pressed', 'false');
  const open = head.querySelector('.x-open');
  if (open) head.insertBefore(btn, open);
  else head.appendChild(btn);
  updateReaderTranslateButton(entry);
}

/** 思考笔记：X/小红书社交卡头部注入「笔记」按钮（sanitize 剥 <button>，渲染后注入） */
function insertSocialNoteButton(root, entry) {
  if (!root || !entry) return;
  if (typeof entrySupportsThinkingNote !== 'function' || !entrySupportsThinkingNote(entry)) return;
  const head = root.querySelector('.x-tweet .x-head, .xhs-note .xhs-author-row');
  if (!head || head.querySelector('[data-note-toggle]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reader-translate-btn social-note-btn';
  btn.dataset.noteToggle = '1';
  btn.textContent = '笔记';
  btn.title = '写思考笔记（Markdown，自动保存）';
  btn.setAttribute('aria-label', '思考笔记');
  btn.setAttribute('aria-pressed', 'false');
  const anchor = head.querySelector('.x-open, .xhs-open');
  if (anchor) head.insertBefore(btn, anchor);
  else head.appendChild(btn);
  if (typeof updateReaderNoteButton === 'function') updateReaderNoteButton(entry);
}

/* ---- X 图片灯箱 ---- */
function openXLightbox(gallery, startIndex) {
  const imgs = Array.from(gallery.querySelectorAll('.x-gallery-item img'));
  if (!imgs.length) return;
  const srcs = imgs.map(img => img.src);
  let idx = startIndex;

  const overlay = document.createElement('div');
  overlay.className = 'x-lightbox';
  overlay.innerHTML = `
    <button class="x-lightbox-close" aria-label="关闭">&times;</button>
    ${srcs.length > 1 ? `<button class="x-lightbox-nav prev" aria-label="上一张">&#8249;</button>
    <button class="x-lightbox-nav next" aria-label="下一张">&#8250;</button>` : ''}
    <img src="${escapeHtml(srcs[idx])}" alt="" />
    ${srcs.length > 1 ? `<div class="x-lightbox-counter">${idx + 1} / ${srcs.length}</div>` : ''}
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector('img');
  const counter = overlay.querySelector('.x-lightbox-counter');

  function show(i) {
    idx = (i + srcs.length) % srcs.length;
    imgEl.src = srcs[idx];
    if (counter) counter.textContent = `${idx + 1} / ${srcs.length}`;
  }
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(idx + 1);
    else if (e.key === 'ArrowLeft') show(idx - 1);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('x-lightbox-close')) close();
    else if (e.target.classList.contains('prev')) show(idx - 1);
    else if (e.target.classList.contains('next')) show(idx + 1);
  });
  document.addEventListener('keydown', onKey);
}

// 事件委托：点击缩略图打开灯箱
document.addEventListener('click', (e) => {
  const link = e.target.closest('.x-gallery-link');
  if (!link) return;
  e.preventDefault();
  const gallery = link.closest('.x-gallery');
  if (!gallery) return;
  const idx = parseInt(link.dataset.lbIndex || '0', 10);
  openXLightbox(gallery, idx);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const link = e.target.closest('.x-gallery-link');
  if (!link) return;
  e.preventDefault();
  const gallery = link.closest('.x-gallery');
  if (!gallery) return;
  openXLightbox(gallery, parseInt(link.dataset.lbIndex || '0', 10));
});

async function renderOriginalContent(entry, content, { openGen = state.openGen } = {}) {
  const fallback = entry && entry.summary ? entry.summary : '（无内容，请打开原文）';
  const root = $('#reader-content');
  const reader = $('#reader');
  const sourceId = entry && entry.sourceId || '';
  const stillCurrent = () => openGen === state.openGen
    && (!entry || !state.activeEntry || state.activeEntry.id === entry.id);
  disposeSocialGalleryPerf();
  const social = parseSocialPayload(content);
  const isXhs = sourceId === 'xhs-likes' || /^xhs-/.test(sourceId) || (social && social.platform === 'xhs');
  const isX = sourceId === 'x-likes' || (social && social.platform === 'x');
  const isBili = sourceId === 'bili-watchlater' || (social && social.platform === 'bili');
  const isSyllabus = sourceId === 'zen-recent'
    || (sourceById(sourceId) && sourceById(sourceId).contentKind === 'syllabus')
    || /class=["']syllabus-brief["']/.test(String(content || ''));

  if (reader) {
    reader.classList.toggle('reader--xhs', Boolean(isXhs && social));
    reader.classList.toggle('reader--x', Boolean(isX && social));
    reader.classList.toggle('reader--bili', Boolean(isBili && social));
    reader.classList.toggle('reader--social', Boolean(social && (isXhs || isX || isBili)));
    reader.classList.toggle('reader--syllabus', Boolean(isSyllabus));
  }

  if (social && (isXhs || isX || isBili)) {
    if (!stillCurrent()) return;
    const metaEl = $('#reader-meta');
    if (metaEl) {
      const show = socialDisplayTime(social, entry);
      if (show) metaEl.textContent = show;
    }
    const socialHtml = isBili
      ? await renderBiliNativeHtml(entry, social)
      : isXhs
        ? await renderXhsNativeHtml(entry, social)
        : await renderXNativeHtml(entry, social);
    if (!stillCurrent()) return;
    root.innerHTML = await sanitizeAsync(socialHtml, { prioritizeFirstImage: true });
    if (!stillCurrent()) return;
    if (isXhs) bindSocialGalleryPerf(root);
    // X 长文：卡片头补翻译按钮（sanitize 会剥 <button>，只能渲染后注入）
    if (isX) insertXTranslateButton(root, entry);
    // 思考笔记按钮：X / 小红书卡片头（知乎、Lil’Log 走顶栏按钮）
    if (isX || isXhs) insertSocialNoteButton(root, entry);
    $$('#reader-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    state.readerTocAvailable = false;
    renderReaderToc(root);
    updateReaderLanguageProfile();
    applyTextAnnotations();
    if (typeof applyLocalContentMarks === 'function') applyLocalContentMarks(root, entry && entry.id);
    if (state.pendingAssetJump) settlePendingAssetJump(state.pendingAssetJump, { clear: false });
    return;
  }

  const source = content || fallback;
  let html;
  if (looksLikeHtmlDocument(source)) {
    // 抓取的 HTML 直接消毒渲染，避免 Markdown 把缩进当代码块
    html = source;
  } else {
    html = await renderMarkdownDocument(source, { sourceId });
  }
  if (!stillCurrent()) return;
  root.innerHTML = await sanitizeAsync(html, { prioritizeFirstImage: true });
  if (!stillCurrent()) return;
  if (isSyllabus) enhanceSyllabusContent(root, entry);
  const comparable = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  // 课程卡：不删 .syllabus-title（与顶栏课号同文会掏空 brief 头）
  const firstHeading = root.querySelector('h1,h2');
  if (
    firstHeading
    && !firstHeading.classList.contains('syllabus-title')
    && !firstHeading.closest('.syllabus-header, .syllabus-brief')
    && comparable(firstHeading.textContent) === comparable(entry && (entry.titleZh || entry.title))
  ) {
    firstHeading.remove();
  }
  // KaTeX 仅在正文疑似含公式时按需加载，并延后到 idle
  const maybeMath = /\$\$|\\\(|\\\[|\\begin\{|(?<!\$)\$(?!\$)[^\s$]/.test(String(source).slice(0, 8000));
  if (maybeMath) {
    const runMath = async () => {
      if (!stillCurrent() || !root.isConnected) return;
      try { await ensureKatex(); } catch { return; }
      if (!stillCurrent() || !root.isConnected || !window.renderMathInElement) return;
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
        strict: false,
        trust: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { runMath(); }, { timeout: 600 });
    else setTimeout(() => { runMath(); }, 0);
  }
  $$('#reader-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  renderReaderToc(root);
  updateReaderLanguageProfile();
  applyTextAnnotations();
  if (typeof applyLocalContentMarks === 'function') applyLocalContentMarks(root, entry && entry.id);
  if (state.pendingAssetJump) settlePendingAssetJump(state.pendingAssetJump, { clear: false });
}

/* ---------- 正文本地高亮 / 删除（不改入库原文，仅本机阅读标记） ---------- */
const LOCAL_CONTENT_MARKS_KEY = 'qm_entry_local_marks';
/** 内存镜像：localStorage 写失败时同会话仍可用；读时与磁盘合并 */
const localContentMarksMemory = new Map();

function loadLocalContentMarksMap() {
  try {
    const raw = storage.getItem(LOCAL_CONTENT_MARKS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalContentMarksMap(map) {
  try {
    storage.setItem(LOCAL_CONTENT_MARKS_KEY, JSON.stringify(map || {}));
    return true;
  } catch (err) {
    console.warn('local content marks persist failed', err);
    return false;
  }
}

function localContentMarksFor(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return { highlights: [], deletions: [], imageDeletions: [] };
  const disk = (loadLocalContentMarksMap()[id]) || {};
  const mem = localContentMarksMemory.get(id) || {};
  const pick = (key) => {
    const m = Array.isArray(mem[key]) ? mem[key] : null;
    const d = Array.isArray(disk[key]) ? disk[key] : [];
    if (m && m.length) return m.slice();
    return d.slice();
  };
  return {
    highlights: pick('highlights'),
    deletions: pick('deletions'),
    imageDeletions: pick('imageDeletions'),
  };
}

function persistLocalContentMarks(entryId, marks) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  const next = {
    highlights: Array.isArray(marks.highlights) ? marks.highlights : [],
    deletions: Array.isArray(marks.deletions) ? marks.deletions : [],
    imageDeletions: Array.isArray(marks.imageDeletions) ? marks.imageDeletions : [],
  };
  localContentMarksMemory.set(id, {
    highlights: next.highlights.slice(),
    deletions: next.deletions.slice(),
    imageDeletions: next.imageDeletions.slice(),
  });
  const all = loadLocalContentMarksMap();
  if (!next.highlights.length && !next.deletions.length && !next.imageDeletions.length) delete all[id];
  else all[id] = next;
  const ok = saveLocalContentMarksMap(all);
  if (!ok && typeof toast === 'function') {
    toast('本机标记未能写入存储（可能空间已满），刷新后可能丢失', 4000);
  }
  return ok;
}

/** 统一正文匹配文本：NFKC、去零宽、空白压成单空格 */
function normalizeLocalMarkText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff\u00ad]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉 HTML 得纯文本（列表概要用） */
function plainTextFromHtmlLoose(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 有本机删除时，列表概要用「删后剩余正文」开头，而不是旧 summary。
 * 返回 null 表示无删除、沿用原 summary（含 summaryZh）。
 * 优先：有 summaryZh 时在中文摘要上抠删除；否则用阅读区/正文剩余文本。
 */
function listSummaryAfterLocalDeletions(entry, currentSummary) {
  const id = entry && entry.id;
  if (!id || typeof localContentMarksFor !== 'function') return null;
  const marks = localContentMarksFor(id);
  if (!marks.deletions || !marks.deletions.length) return null;

  const stripQuotes = (text) => {
    let raw = normalizeLocalMarkText(text);
    for (const d of marks.deletions) {
      const q = normalizeLocalMarkText(d && d.quote);
      if (q) raw = raw.split(q).join(' ');
    }
    return normalizeLocalMarkText(raw);
  };

  // 1) 中文摘要上删：列表默认仍中文
  const zhBase = String(entry.summaryZh || currentSummary || '').trim();
  if (zhBase && /[\u3400-\u9fff]/.test(zhBase)) {
    const next = stripQuotes(zhBase);
    if (next) return next;
  }

  // 2) 当前开文且在简中视图：用阅读区可见文本
  if (state.activeEntry?.id === id && state.readerZhMode) {
    const root = $('#reader-content');
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('.reader-local-deleted').forEach((n) => n.remove());
      const body = String(clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (body) return body;
    }
  }

  // 3) 英文/原文路径：正文去掉删除片段
  let body = '';
  if (state.activeEntry?.id === id) {
    const root = $('#reader-content');
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('.reader-local-deleted').forEach((n) => n.remove());
      body = String(clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
  }
  if (!body) {
    const content = (typeof contentCache !== 'undefined' && contentCache.get(id))
      || entry.content
      || entry.summary
      || '';
    body = stripQuotes(plainTextFromHtmlLoose(content));
  }
  if (body) return body;
  return stripQuotes(currentSummary);
}

/** 删除/改标记后即时刷新左侧卡片概要 */
function refreshListCardSummary(entryId) {
  const id = String(entryId || '').trim();
  if (!id || typeof listSummaryText !== 'function') return;
  const entry = (typeof entryByIdFromList === 'function' && entryByIdFromList(id))
    || (state.activeEntry?.id === id ? state.activeEntry : null)
    || (state.allEntries || []).find((e) => e && e.id === id);
  if (!entry) return;
  const summary = listSummaryText(entry);
  const list = $('#entry-list');
  if (!list) return;
  let card = null;
  try {
    card = list.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
  } catch {
    return;
  }
  if (!card) return;
  let el = card.querySelector('.entry-summary');
  if (!summary) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'entry-summary';
    const title = card.querySelector('.entry-title');
    if (title) title.after(el);
    else card.querySelector('.entry-main')?.appendChild(el);
  }
  el.textContent = summary;
}

function hideContentSelectionMenu() {
  state.contentSelectionDraft = null;
  $('#content-selection-menu')?.classList.add('hidden');
}

function selectionContentDraft() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !state.activeEntry) return null;
  const quote = normalizeLocalMarkText(selection.toString() || '').slice(0, 1200);
  if (quote.length < 1) return null;
  const range = selection.getRangeAt(0);
  const root = $('#reader-content');
  if (!root || !root.contains(range.commonAncestorContainer)) return null;
  // 控件内不标记；链接内文字允许（「近期」大纲页 <a> 极密）
  const el = elementFromNode(range.commonAncestorContainer);
  if (el?.closest('button, input, textarea, select')) return null;
  // 用可见文本（去掉已删片段）算前后文，避免 index 被 display:none 干扰
  const rootClone = root.cloneNode(true);
  rootClone.querySelectorAll('.reader-local-deleted').forEach((n) => n.remove());
  const rootText = normalizeLocalMarkText(rootClone.textContent || '');
  const idx = rootText.indexOf(quote);
  const prefix = idx >= 0 ? rootText.slice(Math.max(0, idx - 80), idx) : '';
  const suffix = idx >= 0 ? rootText.slice(idx + quote.length, idx + quote.length + 80) : '';
  let rect = range.getBoundingClientRect();
  // 跨行/行末选区可能 width=height=0，用 clientRects 或零框（菜单用事件坐标兜底）
  if (!rect || (!rect.width && !rect.height)) {
    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
    if (rects && rects.length) rect = rects[0];
  }
  if (!rect || (!rect.width && !rect.height)) {
    rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  return {
    entryId: state.activeEntry.id,
    quote,
    prefix,
    suffix,
    view: state.readerZhMode ? 'zh' : 'original',
    rect,
  };
}

function localMarkTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      // 含 <a> 内文字：大纲/课程页链接密，排除会导致删除/高亮匹配失败
      if (parent.closest('script,style,textarea,button,select')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.reader-local-deleted')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function clearLocalContentMarks(root = $('#reader-content')) {
  if (!root) return;
  // 拆高亮 / 删除标记，还原文本后再按 storage 重包（勿 remove 掉删除节点，否则二次 apply 找不到 quote）
  root.querySelectorAll('.reader-local-highlight, .reader-local-deleted').forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
  });
  root.normalize();
}

/** 用当前选区 Range 即时包一层（跨链接/多节点比纯文本搜索稳） */
function wrapLiveSelectionMark(kind, mark) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return false;
  const root = $('#reader-content');
  if (!root) return false;
  let range;
  try {
    range = selection.getRangeAt(0).cloneRange();
  } catch {
    return false;
  }
  if (!root.contains(range.commonAncestorContainer)) return false;
  const el = elementFromNode(range.commonAncestorContainer);
  if (el?.closest('button, input, textarea, select')) return false;
  const quote = normalizeLocalMarkText(mark && mark.quote);
  const selected = normalizeLocalMarkText(selection.toString() || '');
  if (quote && selected && selected !== quote && !selected.includes(quote) && !quote.includes(selected)) {
    // 选区已变，不硬包
    return false;
  }
  const wrapper = document.createElement(kind === 'delete' ? 'span' : 'mark');
  wrapper.className = kind === 'delete' ? 'reader-local-deleted' : 'reader-local-highlight';
  wrapper.dataset.localMarkId = mark.id || '';
  wrapper.dataset.localMarkKind = kind;
  if (kind === 'highlight') wrapper.title = '高亮（右键可取消）';
  try {
    range.surroundContents(wrapper);
    return root.contains(wrapper);
  } catch {
    try {
      const frag = range.extractContents();
      wrapper.appendChild(frag);
      range.insertNode(wrapper);
      return root.contains(wrapper);
    } catch {
      return false;
    }
  }
}

/**
 * 从 root 文本节点建「可匹配串 + 映射」。
 * 空白压单空格；零宽/软连字符丢弃且不占 map。
 */
function buildLocalMarkIndex(root) {
  const nodes = localMarkTextNodes(root);
  let normalized = '';
  let inSpace = false;
  const map = [];
  nodes.forEach((node, nodeIndex) => {
    // 必须用 nodeValue 原始下标切片；不可对整串 NFKC（长度会变导致 offset 错位）
    const raw = node.nodeValue || '';
    for (let offset = 0; offset < raw.length; offset += 1) {
      const ch = raw[offset];
      if (/[\u200b-\u200d\ufeff\u00ad]/.test(ch)) continue;
      if (/\s/.test(ch)) {
        if (!inSpace && normalized) {
          normalized += ' ';
          map.push({ nodeIndex, offset });
        }
        inSpace = true;
        continue;
      }
      inSpace = false;
      // 单字符 NFKC 仅用于匹配串（多数 CJK/ASCII 长度不变）
      const normCh = ch.normalize('NFKC');
      if (normCh.length === 1) {
        normalized += normCh;
        map.push({ nodeIndex, offset });
      } else {
        // 罕见多码点：整段按原字符计入，避免 offset 漂移
        normalized += ch;
        map.push({ nodeIndex, offset });
      }
    }
  });
  // 去掉尾部空格及对应 map，保持 index 对齐
  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { nodes, normalized, map };
}

/** 在 normalized 中定位 quote；支持 prefix/suffix、去空白紧凑匹配、长句截断 */
function findLocalMarkStart(normalized, mark) {
  const quote = normalizeLocalMarkText(mark && mark.quote);
  if (!normalized || !quote) return { start: -1, length: 0 };
  let start = normalized.indexOf(quote);
  if (start >= 0) return { start, length: quote.length };

  const prefix = normalizeLocalMarkText(mark && mark.prefix).slice(-48);
  const suffix = normalizeLocalMarkText(mark && mark.suffix).slice(0, 48);
  if (prefix) {
    const needle = `${prefix}${quote}`;
    const hit = normalized.indexOf(needle);
    if (hit >= 0) return { start: hit + prefix.length, length: quote.length };
  }
  if (suffix) {
    const needle = `${quote}${suffix}`;
    const hit = normalized.indexOf(needle);
    if (hit >= 0) return { start: hit, length: quote.length };
  }
  if (prefix && suffix) {
    const needle = `${prefix}${quote}${suffix}`;
    const hit = normalized.indexOf(needle);
    if (hit >= 0) return { start: hit + prefix.length, length: quote.length };
  }

  // 去空格紧凑匹配（表格/换行选区常见）
  const compactNorm = normalized.replace(/ /g, '');
  const compactQuote = quote.replace(/ /g, '');
  if (compactQuote.length >= 2) {
    const cStart = compactNorm.indexOf(compactQuote);
    if (cStart >= 0) {
      // 映射回带空格串：数第 cStart 个非空格字符
      let seen = 0;
      let i = 0;
      for (; i < normalized.length; i += 1) {
        if (normalized[i] === ' ') continue;
        if (seen === cStart) break;
        seen += 1;
      }
      let need = compactQuote.length;
      let j = i;
      for (; j < normalized.length && need > 0; j += 1) {
        if (normalized[j] === ' ') continue;
        need -= 1;
      }
      if (need === 0) return { start: i, length: j - i };
    }
  }

  // 长句：逐步缩短尾部再匹配（渲染后尾标点偶发不一致）
  if (quote.length > 24) {
    for (let cut = 4; cut <= Math.min(40, Math.floor(quote.length / 3)); cut += 4) {
      const partial = quote.slice(0, quote.length - cut);
      if (partial.length < 12) break;
      const hit = normalized.indexOf(partial);
      if (hit >= 0) return { start: hit, length: partial.length };
    }
  }
  return { start: -1, length: 0 };
}

function wrapLocalContentMark(root, mark, kind) {
  const quote = normalizeLocalMarkText(mark && mark.quote);
  if (!root || !quote) return false;
  const { nodes, normalized, map } = buildLocalMarkIndex(root);
  const found = findLocalMarkStart(normalized, { ...mark, quote });
  if (found.start < 0 || found.length < 1) return false;
  const startMap = map[found.start];
  const endMap = map[found.start + found.length - 1];
  if (!startMap || !endMap) return false;
  const ranges = [];
  for (let nodeIndex = startMap.nodeIndex; nodeIndex <= endMap.nodeIndex; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    const start = nodeIndex === startMap.nodeIndex ? startMap.offset : 0;
    const end = nodeIndex === endMap.nodeIndex ? endMap.offset + 1 : (node.nodeValue || '').length;
    if (end > start) ranges.push({ node, start, end });
  }
  if (!ranges.length) return false;
  for (const { node, start, end } of ranges.reverse()) {
    const parent = node.parentNode;
    if (!parent) continue;
    // nodeValue 可能与 NFKC 后的 offset 略有偏差：用原始切片
    const raw = node.nodeValue || '';
    const safeStart = Math.max(0, Math.min(start, raw.length));
    const safeEnd = Math.max(safeStart, Math.min(end, raw.length));
    const before = document.createTextNode(raw.slice(0, safeStart));
    const slice = raw.slice(safeStart, safeEnd);
    const selected = document.createElement(kind === 'delete' ? 'span' : 'mark');
    selected.className = kind === 'delete' ? 'reader-local-deleted' : 'reader-local-highlight';
    selected.dataset.localMarkId = mark.id || '';
    selected.dataset.localMarkKind = kind;
    selected.textContent = slice;
    if (kind === 'highlight') selected.title = '高亮（右键可取消）';
    const after = document.createTextNode(raw.slice(safeEnd));
    parent.replaceChild(after, node);
    parent.insertBefore(selected, after);
    parent.insertBefore(before, selected);
  }
  return true;
}

/** 删除兜底：按 quote 从文本节点直接挖掉（匹配失败时仍尽量生效） */
function spliceLocalDeletionQuote(root, mark) {
  if (!root || !mark) return false;
  // 先走标准包裹
  if (wrapLocalContentMark(root, mark, 'delete')) return true;
  const quote = normalizeLocalMarkText(mark.quote);
  if (!quote || quote.length < 2) return false;
  const { nodes, normalized, map } = buildLocalMarkIndex(root);
  const found = findLocalMarkStart(normalized, { ...mark, quote });
  if (found.start < 0) return false;
  const startMap = map[found.start];
  const endMap = map[found.start + found.length - 1];
  if (!startMap || !endMap) return false;
  const ranges = [];
  for (let nodeIndex = startMap.nodeIndex; nodeIndex <= endMap.nodeIndex; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    const start = nodeIndex === startMap.nodeIndex ? startMap.offset : 0;
    const end = nodeIndex === endMap.nodeIndex ? endMap.offset + 1 : (node.nodeValue || '').length;
    if (end > start) ranges.push({ node, start, end });
  }
  for (const { node, start, end } of ranges.reverse()) {
    const parent = node.parentNode;
    if (!parent) continue;
    const raw = node.nodeValue || '';
    const safeStart = Math.max(0, Math.min(start, raw.length));
    const safeEnd = Math.max(safeStart, Math.min(end, raw.length));
    const before = document.createTextNode(raw.slice(0, safeStart));
    const after = document.createTextNode(raw.slice(safeEnd));
    // 真删除节点：不留 .reader-local-deleted，避免 clear 时把字填回来却匹配不到
    parent.replaceChild(after, node);
    parent.insertBefore(before, after);
  }
  // 记一条「已挖掉」伪标记，仅占位 id，quote 仍存 storage 供列表摘要
  return true;
}

/** 元素是否还有「看得见」的内容（忽略本机删除片段） */
function contentBlockHasVisibleContent(el) {
  if (!el || el.nodeType !== 1) return false;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.reader-local-deleted').forEach((n) => n.remove());
  // 空文本 / 仅空白
  const text = String(clone.textContent || '').replace(/\s+/g, '');
  if (text) return true;
  // 真实媒体
  for (const media of clone.querySelectorAll('img,video,iframe,audio,object,embed,canvas')) {
    const src = String(media.getAttribute('src') || media.getAttribute('data-src') || '').trim();
    if (src && !/^data:,?$/i.test(src)) return true;
  }
  // 有实质内容的 pre/code/svg/table
  for (const node of clone.querySelectorAll('pre,code,svg,table')) {
    if (String(node.textContent || '').replace(/\s+/g, '')) return true;
    if (node.tagName === 'SVG' && node.childNodes.length) return true;
    if (node.tagName === 'TABLE' && node.querySelector('td,th')) return true;
  }
  return false;
}

/**
 * 删文后清掉只剩壳子的块：空 p/div/blockquote/figure 等仍占位会留下「空白框」。
 * 自底向上多轮，顺带清掉只含已删标记的父级。
 */
function pruneEmptyLocalContentBlocks(root = $('#reader-content')) {
  if (!root) return;
  const SELECTOR = [
    'p', 'div', 'section', 'article', 'blockquote', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'figure', 'figcaption', 'header', 'footer', 'aside',
    'ul', 'ol', 'pre',
  ].join(',');
  for (let pass = 0; pass < 8; pass += 1) {
    const nodes = [...root.querySelectorAll(SELECTOR)];
    // 深的先删，避免父先于子被判断
    nodes.sort((a, b) => {
      let da = 0;
      let db = 0;
      for (let n = a; n && n !== root; n = n.parentElement) da += 1;
      for (let n = b; n && n !== root; n = n.parentElement) db += 1;
      return db - da;
    });
    let removed = 0;
    for (const el of nodes) {
      if (!root.contains(el)) continue;
      // 勿动阅读器结构壳
      if (el.id === 'reader-content') continue;
      if (el.classList.contains('reader-local-highlight')) continue;
      if (!contentBlockHasVisibleContent(el)) {
        el.remove();
        removed += 1;
      }
    }
    if (!removed) break;
  }
  // 连续空行 br
  root.querySelectorAll('br').forEach((br) => {
    const prev = br.previousSibling;
    const next = br.nextSibling;
    const prevEmpty = !prev || (prev.nodeType === 3 && !String(prev.textContent || '').trim());
    const nextEmpty = !next || (next.nodeType === 3 && !String(next.textContent || '').trim())
      || (next.nodeType === 1 && next.tagName === 'BR');
    if (prevEmpty && nextEmpty) br.remove();
  });
  root.normalize();
}

function localMarkPresent(root, markId) {
  if (!root || !markId) return false;
  try {
    return Boolean(root.querySelector(`[data-local-mark-id="${CSS.escape(markId)}"]`));
  } catch {
    return Boolean(root.querySelector(`[data-local-mark-id="${markId}"]`));
  }
}

function applyLocalContentMarks(root = $('#reader-content'), entryId = state.activeEntry?.id) {
  const id = String(entryId || '').trim();
  if (!root || !id) return { applied: 0, failed: 0 };
  clearLocalContentMarks(root);
  const marks = localContentMarksFor(id);
  let applied = 0;
  let failed = 0;
  for (const h of marks.highlights) {
    if (wrapLocalContentMark(root, h, 'highlight')) applied += 1;
    else failed += 1;
  }
  for (const d of marks.deletions) {
    // 删除：包裹失败则 splice 硬挖，避免「删了重开又回来」
    if (wrapLocalContentMark(root, d, 'delete') || spliceLocalDeletionQuote(root, d)) applied += 1;
    else failed += 1;
  }
  if (marks.deletions.length) pruneEmptyLocalContentBlocks(root);
  // 应用图片删除
  applyLocalImageDeletions(root, id);
  return { applied, failed };
}

function showContentSelectionMenu(draft, event) {
  const menu = $('#content-selection-menu');
  if (!menu || !draft) return false;
  state.contentSelectionDraft = draft;
  const isImage = Boolean(draft.isImage);
  const onMark = !isImage && event && event.target && event.target.closest
    ? event.target.closest('.reader-local-highlight')
    : null;
  const markId = onMark?.dataset.localMarkId || '';
  state.contentSelectionDraft.markId = markId;
  state.contentSelectionDraft.markKind = markId ? 'highlight' : '';
  const hasQuote = Boolean(String(draft.quote || '').trim());
  menu.querySelector('[data-content-action="highlight"]')?.classList.toggle('hidden', isImage || !hasQuote || Boolean(markId));
  menu.querySelector('[data-content-action="delete"]')?.classList.toggle('hidden', isImage || !hasQuote || Boolean(markId));
  menu.querySelector('[data-content-action="unhighlight"]')?.classList.toggle('hidden', isImage || !markId);
  menu.querySelector('[data-content-action="delete-image"]')?.classList.toggle('hidden', !isImage);
  menu.classList.remove('hidden');
  const width = 120;
  const height = 88;
  const x = event && Number.isFinite(event.clientX) ? event.clientX : draft.rect.left;
  const y = event && Number.isFinite(event.clientY) ? event.clientY : draft.rect.bottom;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  return true;
}

function addLocalContentMark(kind) {
  const draft = state.contentSelectionDraft;
  const entryId = draft?.entryId || state.activeEntry?.id;
  const quote = normalizeLocalMarkText(draft?.quote || '');
  if (!entryId || !quote) {
    toast(kind === 'highlight' ? '请先选中要高亮的文字' : '请先选中要删除的文字');
    hideContentSelectionMenu();
    return;
  }
  const marks = localContentMarksFor(entryId);
  const listKey = kind === 'delete' ? 'deletions' : 'highlights';
  // 去重同句（规范化后）
  if (marks[listKey].some((item) => normalizeLocalMarkText(item.quote) === quote)) {
    hideContentSelectionMenu();
    window.getSelection()?.removeAllRanges();
    // 已有记录：再 apply 一次，防止 DOM 被重渲后标记丢失
    applyLocalContentMarks($('#reader-content'), entryId);
    if (kind === 'delete') {
      pruneEmptyLocalContentBlocks($('#reader-content'));
      refreshListCardSummary(entryId);
    }
    return;
  }
  const item = {
    id: `lm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    quote,
    prefix: normalizeLocalMarkText(draft.prefix || ''),
    suffix: normalizeLocalMarkText(draft.suffix || ''),
    view: draft.view || (state.readerZhMode ? 'zh' : 'original'),
    createdAt: Date.now(),
  };
  const root = $('#reader-content');
  // 1) 选区即时包裹（链接密正文更稳）
  const liveOk = wrapLiveSelectionMark(kind, item);
  if (liveOk) {
    // 用包裹节点的规范文本写回 quote，保证重开后能匹配
    try {
      const el = root?.querySelector(`[data-local-mark-id="${CSS.escape(item.id)}"]`);
      const liveQuote = normalizeLocalMarkText(el && el.textContent);
      if (liveQuote) item.quote = liveQuote;
    } catch { /* keep original quote */ }
    marks[listKey].push(item);
    persistLocalContentMarks(entryId, marks);
    if (kind === 'delete') pruneEmptyLocalContentBlocks(root);
    // 不 clear 重包：避免「现场删掉 → apply 匹配失败 → 字又回来」
    // 重开路径依赖 storage + 增强后的 findLocalMarkStart
  } else {
    // 2) 无选区 Range：依赖 quote 全文匹配
    marks[listKey].push(item);
    persistLocalContentMarks(entryId, marks);
    window.getSelection()?.removeAllRanges();
    applyLocalContentMarks(root, entryId);
    let found = localMarkPresent(root, item.id);
    if (!found && kind === 'delete') {
      // 再试一次硬挖
      found = spliceLocalDeletionQuote(root, item);
      if (found) pruneEmptyLocalContentBlocks(root);
    }
    if (!found) {
      marks[listKey] = marks[listKey].filter((m) => m.id !== item.id);
      persistLocalContentMarks(entryId, marks);
      applyLocalContentMarks(root, entryId);
      toast(kind === 'highlight' ? '高亮失败，请重新选中文字' : '删除失败，请重新选中文字');
      hideContentSelectionMenu();
      return;
    }
  }

  if (kind === 'delete') refreshListCardSummary(entryId);
  hideContentSelectionMenu();
  window.getSelection()?.removeAllRanges();
}

function removeLocalHighlight(markId) {
  const entryId = state.activeEntry?.id;
  if (!entryId || !markId) return;
  const marks = localContentMarksFor(entryId);
  marks.highlights = marks.highlights.filter(item => item.id !== markId);
  persistLocalContentMarks(entryId, marks);
  applyLocalContentMarks($('#reader-content'), entryId);
  hideContentSelectionMenu();
}

function handleContentSelectionAction(action) {
  if (action === 'highlight') return addLocalContentMark('highlight');
  if (action === 'delete') return addLocalContentMark('delete');
  const draft = state.contentSelectionDraft || {};
  if (action === 'unhighlight') return removeLocalHighlight(draft.markId);
  if (action === 'delete-image') return addLocalImageDeletion();
}

/** 图片右键删除：将图片 src 存入本机标记，隐藏该图片 */
function addLocalImageDeletion() {
  const draft = state.contentSelectionDraft;
  const entryId = draft?.entryId || state.activeEntry?.id;
  const imgSrc = draft?.imgSrc;
  if (!entryId || !imgSrc) {
    toast('未选中图片');
    hideContentSelectionMenu();
    return;
  }
  const marks = localContentMarksFor(entryId);
  // 去重：同一张图不重复存
  if (marks.imageDeletions.some((item) => item.src === imgSrc)) {
    hideContentSelectionMenu();
    applyLocalImageDeletions($('#reader-content'), entryId);
    return;
  }
  const item = {
    id: `imgd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    src: imgSrc,
    alt: draft.imgAlt || '',
    createdAt: Date.now(),
  };
  marks.imageDeletions.push(item);
  persistLocalContentMarks(entryId, marks);
  applyLocalImageDeletions($('#reader-content'), entryId);
  hideContentSelectionMenu();
  toast('图片已隐藏', 1400);
}

/** 应用本机图片删除：匹配 src 的 img 添加隐藏类并移除空容器 */
function applyLocalImageDeletions(root = $('#reader-content'), entryId = state.activeEntry?.id) {
  const id = String(entryId || '').trim();
  if (!root || !id) return;
  const marks = localContentMarksFor(id);
  if (!marks.imageDeletions.length) return;
  const srcSet = new Set(marks.imageDeletions.map((d) => d.src));
  root.querySelectorAll('img').forEach((img) => {
    const resolved = img.currentSrc || img.src || img.getAttribute('src') || '';
    const dataSrc = img.getAttribute('data-src') || '';
    if (srcSet.has(resolved) || srcSet.has(dataSrc) || srcSet.has(img.getAttribute('src') || '')) {
      // 隐藏图片及其 figure/picture 容器
      const container = img.closest('figure, picture') || img;
      container.classList.add('reader-local-img-deleted');
      container.style.display = 'none';
    }
  });
  pruneEmptyLocalContentBlocks(root);
}

function elementFromNode(node) {
  return node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;
}

function articleContentLinkUrl(anchor) {
  if (!anchor || !anchor.closest('#reader-content, #rewrite-content, #translation-list')) return '';
  const raw = String(anchor.getAttribute('href') || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  try {
    const url = new URL(raw, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function articleContentLinkFromTarget(target) {
  const el = elementFromNode(target);
  const anchor = el && el.closest ? el.closest('a') : null;
  return articleContentLinkUrl(anchor) ? anchor : null;
}

function suppressAnnotationPopoverForLink() {
  state.suppressAnnotationUntil = Date.now() + 500;
  hideAnnotationPopover();
  window.getSelection?.()?.removeAllRanges();
}

function hideArticleLinkMenu() {
  // 滚动热路径：已隐藏则直接返回，避免每帧 classList 写入
  if (!state.articleLinkMenuUrl) {
    const menu = $('#article-link-menu');
    if (!menu || menu.classList.contains('hidden')) return;
  }
  state.articleLinkMenuUrl = '';
  const menu = $('#article-link-menu');
  if (!menu) return;
  menu.classList.add('hidden');
}

function showArticleLinkMenu(anchor, event) {
  const url = articleContentLinkUrl(anchor);
  if (!url) return false;
  state.articleLinkMenuUrl = url;
  const menu = $('#article-link-menu');
  const label = $('#article-link-menu-url');
  if (!menu || !label) return false;
  label.textContent = compactUrlLabel(url);
  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 10;
  const preferredX = Number.isFinite(event.clientX) ? event.clientX : rect.left;
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  let left = Math.min(Math.max(margin, preferredX), maxLeft);
  let top = rect.bottom + 8;
  if (top + menuRect.height > window.innerHeight - margin) top = rect.top - menuRect.height - 8;
  if (top < margin) top = margin;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  return true;
}

async function submitArticleLinkToSite() {
  const url = state.articleLinkMenuUrl;
  hideArticleLinkMenu();
  if (!url) return;
  const title = state.activeEntry && (state.activeEntry.titleZh || state.activeEntry.title);
  const note = title ? `来自《${title}》正文链接` : '';
  // 与侧栏「个人精选」同一流程
  openSubmitLinkModal({ url, note });
}

function openArticleLinkInWindow() {
  const url = state.articleLinkMenuUrl;
  hideArticleLinkMenu();
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}
