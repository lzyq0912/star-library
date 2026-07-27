const cheerio = require('cheerio');

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlForHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // data:image 在 isLikelyContentImageUrl 等处处理；此处拒绝 data: / 危险 scheme
  if (/^data:/i.test(raw)) return null;
  if (/^(?:javascript|vbscript):/i.test(raw)) return null;
  try {
    const resolved = new URL(raw, baseUrl || undefined);
    // 解析后只允许 http(s)；file:/blob:/about: 等一律拒绝
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function metaContent(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, 'i')
      , re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, 'i');
    const m = re.exec(html) || re2.exec(html);
    if (m) return m[1];
  }
  return null;
}

function decodeEntities(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function isTrackingPixelUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  return /telemetry\.(?:gif|png|jpe?g)|\/pixel(?:\.|\/|$)|\/track(?:\.|\/|$)|1x1\.(?:gif|png)|spacer\.(?:gif|png)|beacon|\/collect(?:\?|$)/i.test(raw);
}

function isTrackingPixelImg($img) {
  if (!$img || !$img.length) return false;
  // 与 resolveExtractedImgSrc 对齐：lazy-only 图没有 src 时不能当 tracking 像素删掉
  const src = String(
    $img.attr('src')
    || $img.attr('data-src')
    || $img.attr('data-original')
    || $img.attr('data-lazy-src')
    || $img.attr('data-actualsrc')
    || $img.attr('data-url')
    || $img.attr('data-original-src')
    || $img.attr('data-lazy')
    || $img.attr('data-image')
    || firstSrcsetUrl($img.attr('srcset'))
    || firstSrcsetUrl($img.attr('data-srcset'))
    || ''
  ).trim();
  // 尚无任何 URL 时不要当像素删——交给后续 resolve；空串在 isTrackingPixelUrl 里恒 true
  if (src && isTrackingPixelUrl(src)) return true;
  const width = Number.parseInt(String($img.attr('width') || '').replace(/px$/i, ''), 10);
  const height = Number.parseInt(String($img.attr('height') || '').replace(/px$/i, ''), 10);
  if (Number.isFinite(width) && Number.isFinite(height) && width <= 2 && height <= 2) return true;
  const style = String($img.attr('style') || '');
  if (/opacity\s*:\s*0(?:\.0+)?(?:\s|;|$)/i.test(style) && (width <= 4 || height <= 4 || !Number.isFinite(width))) return true;
  return false;
}

/**
 * 已本地化的配图必须走本站 /article-images/…
 * 导入时若用 absoluteUrl(pageBase) 会变成 https://qingkeai.online/article-images/…（远程 404）
 */
function toLocalArticleImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^\/article-images\//i.test(raw)) return raw.replace(/[?#].*$/, '');
  try {
    const u = new URL(raw);
    if (/^\/article-images\//i.test(u.pathname)) return u.pathname;
  } catch {
    /* ignore */
  }
  const m = raw.match(/https?:\/\/[^/]+(\/article-images\/[^?#]+)/i);
  if (m) return m[1];
  return raw;
}

function firstImage(html, baseUrl = '') {
  const re = /<img\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html || ''))) {
    const tag = match[0];
    const srcMatch = /\bsrc=["']([^"']+)["']/i.exec(tag)
      || /\bdata-src=["']([^"']+)["']/i.exec(tag)
      || /\bdata-original=["']([^"']+)["']/i.exec(tag);
    if (!srcMatch) continue;
    const rawSrc = String(srcMatch[1] || '').trim();
    // 已是本站路径：绝不要拼成外站绝对 URL
    let src = /^\/article-images\//i.test(rawSrc)
      ? rawSrc.replace(/[?#].*$/, '')
      : absoluteUrl(rawSrc, baseUrl);
    src = toLocalArticleImageUrl(src);
    if (!src || isTrackingPixelUrl(src) || isGenericCoverImage(src)) continue;
    const width = Number.parseInt((/\bwidth=["']?(\d+)/i.exec(tag) || [])[1] || '', 10);
    const height = Number.parseInt((/\bheight=["']?(\d+)/i.exec(tag) || [])[1] || '', 10);
    if (Number.isFinite(width) && Number.isFinite(height) && width <= 2 && height <= 2) continue;
    return src;
  }
  return null;
}

/** 全站默认 og / logo / 占位图，不能当文章封面（bearblog /static/og-image.png 等） */
function isGenericCoverImage(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  if (/\/static\/og-image(?:\.\w+)?(?:$|[?#])/i.test(u)) return true;
  if (/(?:^|\/)og-image\.(?:png|jpe?g|webp|gif|svg)(?:$|[?#])/i.test(u)) return true;
  if (/default[-_]?og|site[-_]?logo|placeholder|gravatar|\/favicon\./i.test(u)) return true;
  if (/(?:^|[\/._-])(?:logo|icon|favicon|avatar|badge|emoji|sprite|spinner)(?:[\/._-]|$)/i.test(u)) return true;
  if (/(?:doubleword-icon|apple-touch-icon|android-chrome|mstile)/i.test(u)) return true;
  // 本地化后的全站 og：文件名哈希固定、且正文无图时会误当封面（见 Sequoia 卡）
  if (/\/article-images\/[^/]+\/[a-f0-9]+\/da47ec081fc39a48c0bd\.png(?:$|[?#])/i.test(u)) return true;
  return false;
}

/**
 * 正文无实图时，仍可用作封面的「文章级」og（CMS/CDN 配图）。
 * 故意保守：只认常见媒体 CDN / 大尺寸路径，避开站标。
 */
function isLikelyArticleOgImage(url) {
  const u = String(url || '').trim();
  if (!u || isGenericCoverImage(u) || isTrackingPixelUrl(u)) return false;
  if (/cdn\.sanity\.io\/images\//i.test(u)) return true;
  if (/(?:images\.unsplash\.com|res\.cloudinary\.com|media\.cloudinary\.com)\//i.test(u)) return true;
  if (/(?:cdn-images-\d+\.medium\.com|miro\.medium\.com)\//i.test(u)) return true;
  if (/substackcdn\.com\//i.test(u)) return true;
  if (/wp-content\/uploads\//i.test(u)) return true;
  if (/\/content\/images\//i.test(u)) return true;
  if (/(?:imagedelivery\.net|images\.ctfassets\.net|cdn\.shopify\.com\/s\/files)\//i.test(u)) return true;
  if (/assets\.st-note\.com\//i.test(u)) return true;
  const wMatch = /(?:[?&](?:w|width)=)(\d{3,5})\b/i.exec(u);
  if (wMatch && Number(wMatch[1]) >= 600) return true;
  const dim = /\b(\d{3,4})x(\d{3,4})\b/.exec(u);
  if (dim && Number(dim[1]) >= 400 && Number(dim[2]) >= 200) return true;
  return false;
}

/** 正文是否真有配图（HTML 或 Markdown） */
function contentHasRealImage(content) {
  const raw = String(content || '');
  if (!raw) return false;
  if (/<img\b[^>]+src=["'][^"']+/i.test(raw)) {
    // 排除仅含 generic 的
    const srcs = [...raw.matchAll(/<img\b[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
    if (srcs.some(src => src && !isGenericCoverImage(src) && !isTrackingPixelUrl(src))) return true;
  }
  if (/!\[[^\]]*]\((?!\/static\/og-image)[^)\s]+\)/i.test(raw)) return true;
  return false;
}

/**
 * href 是否像正文配图（Substack 等常把图包在 <a href=cdn> 里；清理后可能只剩空锚点）。
 * 故意保守，避免把普通外链当成图。
 */
function isLikelyContentImageUrl(url) {
  const u = String(url || '').trim();
  if (!u || isTrackingPixelUrl(u) || isGenericCoverImage(u)) return false;
  if (/^data:image\//i.test(u)) return true;
  if (/^\/article-images\//i.test(u)) return true;
  if (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(u)) return true;
  if (/substackcdn\.com\/(?:image|img)\//i.test(u)) return true;
  if (/(?:zhimg\.com|pic[0-9]?\.zhimg\.com)\//i.test(u)) return true;
  if (/cdn\.sanity\.io\/images\//i.test(u)) return true;
  if (/(?:images\.unsplash\.com|res\.cloudinary\.com|media\.cloudinary\.com)\//i.test(u)) return true;
  if (/(?:cdn-images-\d+\.medium\.com|miro\.medium\.com)\//i.test(u)) return true;
  if (/wp-content\/uploads\//i.test(u)) return true;
  if (/\/content\/images\//i.test(u)) return true;
  if (/(?:imagedelivery\.net|images\.ctfassets\.net)\//i.test(u)) return true;
  if (/assets\.st-note\.com\//i.test(u)) return true;
  if (/googleusercontent\.com\//i.test(u) && /[=/](?:s|w|h)\d{2,}/i.test(u)) return true;
  // Substack/S3 包装：…/fetch/…/https%3A%2F%2F…images%2F….png
  if (/%2Fimages%2F|\/images\/[0-9a-f-]{8,}/i.test(u) && /(?:amazonaws|substack|cdn)/i.test(u)) return true;
  return false;
}

/**
 * 把「空的图片锚点」补成 <img>：
 *   <a href="https://…/foo.png"></a>  →  <a href="…"><img src="…" alt=""></a>
 * Substack 抓取/白名单清洗后偶发只剩 href、丢掉内部 <img>/<picture>。
 */
function promoteEmptyImageAnchors($, $root, baseUrl = '') {
  const root = $root && typeof $root.find === 'function' ? $root : $($root || $.root());
  root.find('a[href]').each((_, el) => {
    const a = $(el);
    if (a.find('img').length) return;
    // 有可见文字的链接不当图（避免误伤「查看原图」类文案链接）
    const text = String(a.text() || '').replace(/\s+/g, '');
    if (text.length > 0) return;
    // 内部若还有其它媒体/表格，不动
    if (a.find('video,audio,table,iframe,svg').length) return;
    const rawHref = String(a.attr('href') || '').trim();
    const href = toLocalArticleImageUrl(absoluteUrl(rawHref, baseUrl) || rawHref);
    if (!isLikelyContentImageUrl(href) && !isLikelyContentImageUrl(rawHref)) return;
    const src = isLikelyContentImageUrl(href) ? href : (absoluteUrl(rawHref, baseUrl) || rawHref);
    if (!src) return;
    a.empty();
    a.append(`<img src="${escapeHtmlForHtml(src)}" alt="">`);
    if (!a.attr('target')) a.attr('target', '_blank');
    if (!a.attr('rel')) a.attr('rel', 'noopener noreferrer nofollow');
  });
}

/** 纯 HTML 字符串入口（存量修复 / 本地化前置） */
function repairEmptyImageAnchorsHtml(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw || !/<a\b/i.test(raw)) return raw;
  // 快路径：无空锚/空壳（含 <br>/<span>）且无像配图的 href 时跳过 cheerio
  const emptyOrShellRe = /<a\b[^>]*\bhref=["'][^"']+["'][^>]*>\s*(?:(?:<!--[\s\S]*?-->|<br\s*\/?[^>]*>|<span\b[^>]*>\s*<\/span>)\s*)*<\/a>/i;
  if (!emptyOrShellRe.test(raw)) {
    const hrefRe = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
    let m;
    let hasImageHref = false;
    while ((m = hrefRe.exec(raw))) {
      if (isLikelyContentImageUrl(m[1])) {
        hasImageHref = true;
        break;
      }
    }
    if (!hasImageHref) return raw;
  }
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  promoteEmptyImageAnchors($, $.root(), baseUrl);
  return $.root().html() || raw;
}

/** 选定文章封面：正文实图优先；全站默认 og 永不使用；CMS 级 og 在无正文图时可用 */
function pickArticleCoverImage(content, metaImage, baseUrl = '') {
  const body = firstImage(content, baseUrl);
  if (body) return toLocalArticleImageUrl(body);
  if (!metaImage || isTrackingPixelUrl(metaImage) || isGenericCoverImage(metaImage)) return null;
  // 正文无配图：仅允许「像文章配图」的 og（Sanity 等），避免 bearblog 全站默认图
  if (!contentHasRealImage(content) && !isLikelyArticleOgImage(metaImage)) return null;
  const abs = absoluteUrl(metaImage, baseUrl) || metaImage || null;
  return abs ? toLocalArticleImageUrl(abs) : null;
}

/** srcset 选最大 w/x 候选（第一候选常是最小图） */
function bestSrcsetCandidate(value) {
  const parts = String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  let bestUrl = '';
  let bestScore = -1;
  for (const part of parts) {
    const bits = part.split(/\s+/).filter(Boolean);
    const url = bits[0] || '';
    if (!url) continue;
    let score = 0;
    for (const bit of bits.slice(1)) {
      if (/^\d+w$/i.test(bit)) score = Math.max(score, Number.parseInt(bit, 10) || 0);
      else if (/^\d+(?:\.\d+)?x$/i.test(bit)) score = Math.max(score, Math.round(Number.parseFloat(bit) * 10000));
    }
    if (!bestUrl || score >= bestScore) {
      bestUrl = url;
      bestScore = score;
    }
  }
  return bestUrl || parts[0].split(/\s+/)[0] || '';
}

function firstSrcsetUrl(value) {
  return bestSrcsetCandidate(value);
}

function normalizeSrcset(value, baseUrl) {
  return String(value || '')
    .split(',')
    .map(part => {
      const pieces = part.trim().split(/\s+/).filter(Boolean);
      const src = absoluteUrl(pieces[0], baseUrl);
      return src ? [src, ...pieces.slice(1)].join(' ') : '';
    })
    .filter(Boolean)
    .join(', ');
}

function isEmptyImageAnchorNode(node) {
  if (!node || !node.length) return false;
  const tag = String((node.get(0) && node.get(0).name) || node.prop('tagName') || '').toLowerCase();
  if (tag !== 'a') return false;
  if (node.find('img,video,audio,table,hr,picture,source').length) return false;
  if (String(node.text() || '').replace(/\s+/g, '').trim()) return false;
  const href = String(node.attr('href') || '').trim();
  return isLikelyContentImageUrl(href);
}

function removeArticleChrome($, root = $.root()) {
  const $root = root && typeof root.find === 'function' ? root : $(root || $.root());
  $root.find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas').remove();
  $root.find('.pencraft,.pc-reset,.icon-container,.image-link-expand,.view-image,[class*="image-link"],[class*="view-image"]').each((_, el) => {
    const node = $(el);
    // Substack image-link 空壳：保留 href，后续 promoteEmptyImageAnchors 补 <img>
    if (isEmptyImageAnchorNode(node)) return;
    if (!node.find('img').length && !node.text().replace(/\s+/g, '').trim()) node.remove();
  });
  $root.find('a,div,span').each((_, el) => {
    const node = $(el);
    if (node.find('img,video,audio,table,hr').length) return;
    if (node.text().replace(/\s+/g, '').trim()) return;
    // 空图片锚点不能删：否则 figure 只剩 figcaption
    if (isEmptyImageAnchorNode(node)) return;
    node.remove();
  });
}

/** Substack 正文/摘要里嵌的作者链 + 日期（含译后中文日期） */
const MONTH_NAME_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';
const EN_BYLINE_DATE_RE = `${MONTH_NAME_RE}\\.?\\s+\\d{1,2},?\\s+\\d{4}`;
const ZH_BYLINE_DATE_RE = String.raw`\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日`;

function stripSubstackAuthorDateByline(html) {
  let source = String(html || '');
  if (!source) return '';
  // <a href="https://substack.com/@user"...>Name</a>Jun 03, 2026
  source = source.replace(
    new RegExp(
      String.raw`<a\b[^>]*\b(?:href\s*=\s*["'][^"']*substack\.com/@[^"']*["']|substack\.com/@)[^>]*>[\s\S]*?<\/a>\s*(?:${EN_BYLINE_DATE_RE}|${ZH_BYLINE_DATE_RE})`,
      'gi',
    ),
    '',
  );
  // 纯文本 EN/ZH：Maarten Grootendorst Jun 03, 2026 / Maarten Grootendorst 2026年6月10日
  source = source.replace(
    new RegExp(
      String.raw`\bMaarten\s+Grootendorst\s*(?:${EN_BYLINE_DATE_RE}|${ZH_BYLINE_DATE_RE})`,
      'gi',
    ),
    '',
  );
  source = source.replace(
    new RegExp(
      String.raw`([。.!！？\s])Maarten\s+Grootendorst\s*(?:${EN_BYLINE_DATE_RE}|${ZH_BYLINE_DATE_RE})\s*`,
      'gi',
    ),
    '$1',
  );
  // 紧贴在 h1/h2/h3 后的孤立日期
  source = source.replace(
    new RegExp(
      String.raw`(<\/h[1-3]>\s*)(?:<p[^>]*>\s*)?(?:${EN_BYLINE_DATE_RE}|${ZH_BYLINE_DATE_RE})\s*(?:<\/p>)?`,
      'gi',
    ),
    '$1',
  );
  return source.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

function normalizeFeedContent(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw) return '';
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  // 先补空图片锚点，避免 removeArticleChrome 把 image-link 空壳整段清掉
  promoteEmptyImageAnchors($, $.root(), baseUrl);
  removeArticleChrome($);
  $('img').each((_, el) => {
    const img = $(el);
    if (isTrackingPixelImg(img)) {
      img.remove();
      return;
    }
    const src = absoluteUrl(
      img.attr('src') || img.attr('data-src') || img.attr('data-original') || firstSrcsetUrl(img.attr('srcset')),
      baseUrl
    );
    if (src) img.attr('src', src);
    else {
      img.remove();
      return;
    }
    const srcset = normalizeSrcset(img.attr('srcset'), baseUrl);
    if (srcset) img.attr('srcset', srcset);
    else img.removeAttr('srcset');
  });
  $('a').each((_, el) => {
    const a = $(el);
    const href = absoluteUrl(a.attr('href'), baseUrl);
    if (href) a.attr('href', href);
  });
  // 再兜底一次（chrome 清理后若仍有空锚）
  promoteEmptyImageAnchors($, $.root(), baseUrl);
  const out = $.root().html() || raw;
  // Substack 作者 byline 常粘在标题后、首段前
  return stripSubstackAuthorDateByline(out);
}

function normalizeRenderedContent(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw) return '';
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  return cleanExtractedRoot($, $.root(), baseUrl)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** srcset 最佳候选 URL（优先最大 w/x；无描述子时取第一项） */
function firstSrcsetCandidate(value) {
  return bestSrcsetCandidate(value);
}

/** 从 img 的 src / lazy / srcset 解析可用绝对地址（个人精选与抓原文共用） */
function resolveExtractedImgSrc(img, baseUrl) {
  const candidates = [
    img.attr('src'),
    img.attr('data-src'),
    img.attr('data-original'),
    img.attr('data-lazy-src'),
    img.attr('data-actualsrc'),
    img.attr('data-url'),
    img.attr('data-original-src'),
    img.attr('data-lazy'),
    img.attr('data-image'),
    img.attr('data-bg'),
    img.attr('data-original-url'),
    firstSrcsetCandidate(img.attr('srcset')),
    firstSrcsetCandidate(img.attr('data-srcset')),
  ];
  for (const raw of candidates) {
    const s = String(raw || '').trim();
    if (!s || /^data:/i.test(s) || /^blob:/i.test(s) || /^file:/i.test(s) || /^about:/i.test(s) || s.startsWith('#')) continue;
    // 1×1 占位 / 透明 gif 路径常见，仍交给 isTrackingPixelUrl 再滤
    const src = absoluteUrl(s, baseUrl);
    if (src && !isTrackingPixelUrl(src) && !/^file:/i.test(src)) return src;
  }
  return '';
}

function collapseWsText(value) {
  return String(value || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim();
}

function tableFigureFromRows(rows) {
  const clean = (rows || []).filter(([k, v]) => collapseWsText(k) || collapseWsText(v));
  if (!clean.length) return '';
  const body = clean.map(([label, value]) => (
    `<tr><th>${escapeHtmlForHtml(collapseWsText(label))}</th><td>${escapeHtmlForHtml(collapseWsText(value))}</td></tr>`
  )).join('');
  return `<figure><table><tbody>${body}</tbody></table></figure>`;
}

/** 救出 noscript / picture 里的真实图片，避免 clean 阶段丢掉 */
function promoteMediaElements($, $root, baseUrl) {
  $root.find('noscript').each((_, el) => {
    const html = String($(el).html() || '');
    if (/<img\b/i.test(html)) $(el).replaceWith(html);
  });

  $root.find('picture').each((_, el) => {
    const pic = $(el);
    let img = pic.find('img').first();
    if (!img.length) {
      // 仅 source 无 img：从最佳 srcset 造一张
      let best = '';
      pic.find('source[srcset], source[src]').each((__, sourceEl) => {
        const cand = firstSrcsetCandidate($(sourceEl).attr('srcset')) || String($(sourceEl).attr('src') || '').trim();
        if (cand) best = cand;
      });
      if (!best) {
        pic.remove();
        return;
      }
      const abs = absoluteUrl(best, baseUrl) || best;
      pic.replaceWith(`<img src="${escapeHtmlForHtml(abs)}" alt="">`);
      return;
    }
    if (!resolveExtractedImgSrc(img, baseUrl)) {
      let best = '';
      let bestScore = -1;
      pic.find('source[srcset], source[src]').each((__, sourceEl) => {
        const srcset = String($(sourceEl).attr('srcset') || '');
        if (srcset) {
          const cand = firstSrcsetCandidate(srcset);
          // bestSrcsetCandidate 已选最大；多 source 时后写覆盖前写（通常更大）
          if (cand) {
            best = cand;
            bestScore = 1;
          }
        } else {
          const src = String($(sourceEl).attr('src') || '').trim();
          if (src && bestScore < 0) best = src;
        }
      });
      if (best) img.attr('src', absoluteUrl(best, baseUrl) || best);
    }
    pic.replaceWith(img);
  });
}

/**
 * Tufte / Doubleword 等边注：展开成括号附注，避免 input/label 被删后正文黏成「investmentsOur first investments」。
 */
function normalizeInlineNotes($, $root) {
  $root.find('.sidenote-wrapper, .marginnote-wrapper, [data-sidenote-id]').each((_, el) => {
    const wrap = $(el);
    wrap.find('input, label, .sidenote-number, .sidenote-number-copy, .margin-toggle').remove();
    const note = wrap.find('.sidenote, .marginnote, .footnote-content').first();
    const inner = note.length ? (note.html() || '') : (wrap.html() || '');
    const text = collapseWsText(stripHtml(inner));
    if (!text) {
      wrap.remove();
      return;
    }
    // 保留链接；em 在白名单内
    wrap.replaceWith(` <em>(${inner})</em>`);
  });

  // 独立边注块（无 wrapper）
  $root.find('.sidenote, .marginnote').each((_, el) => {
    const note = $(el);
    if (note.parents('.sidenote-wrapper, .marginnote-wrapper, em').length) return;
    const text = collapseWsText(note.text());
    if (!text) {
      note.remove();
      return;
    }
    note.replaceWith(` <em>(${note.html() || text})</em>`);
  });
}

/**
 * 把 SSR 纯 HTML/CSS 图表（非 <img>）收成表格，避免 unwrap 后变成「TP4 baseline5,856 tok/s」垃圾。
 * 覆盖 Doubleword throughput-ladder / roofline-breakdown，以及 label+value 行结构。
 */
function convertStructuredCharts($, $root) {
  $root.find('.throughput-ladder').each((_, el) => {
    const node = $(el);
    const rows = [];
    node.find('.tl-group').each((__, groupEl) => {
      const group = $(groupEl);
      const label = collapseWsText(group.find('.tl-label').first().text());
      const value = collapseWsText(group.find('.tl-value').first().text());
      if (label || value) rows.push([label, value]);
    });
    const table = tableFigureFromRows(rows);
    if (table) node.replaceWith(table);
    else node.remove();
  });

  $root.find('.roofline-breakdown').each((_, el) => {
    const node = $(el);
    const rows = [];
    node.find('.rb-row').each((__, rowEl) => {
      const row = $(rowEl);
      const label = collapseWsText(row.find('.rb-label').first().text());
      const value = collapseWsText(row.find('.rb-value').first().text());
      if (label || value) rows.push([label, value]);
    });
    const table = tableFigureFromRows(rows);
    if (table) node.replaceWith(table);
    else node.remove();
  });

  // 残留的交互/提示壳
  $root.find('.tl-tooltip, .rb-tooltip, .tl-track, .rb-track, .rb-legend').remove();
}

function stripFootnoteChrome($, $root) {
  $root.find([
    'section.footnotes',
    'section[data-footnotes]',
    '.footnotes',
    'ol.footnotes',
    '#footnotes',
    '[data-footnote-section]',
  ].join(',')).remove();
}

function isFootnoteLikeAnchor(a, href) {
  const h = String(href || a.attr('href') || '');
  const cls = String(a.attr('class') || '');
  const id = String(a.attr('id') || '');
  const role = String(a.attr('role') || '');
  if (a.attr('data-footnote-ref') != null || a.attr('data-footnote-backref') != null) return true;
  if (/footnote|fnref|fn-ref|footnote-ref|footnote-back|cite-back|sidenote-number/i.test(`${cls} ${id} ${role}`)) return true;
  if (/#(?:fn|footnote|user-content-fn|endnote)[\w.:-]*/i.test(h)) return true;
  const t = collapseWsText(a.text()).replace(/\s+/g, '');
  if (/^\[\d{1,3}\]$|^\d{1,3}$/.test(t) && (/#/.test(h) || !/^https?:/i.test(h))) return true;
  return false;
}

function cleanExtractedRoot($, root, baseUrl) {
  const $root = root.clone();

  // 先救图 / 结构化内容，再删 chrome（顺序很重要）
  promoteMediaElements($, $root, baseUrl);
  // 空图片锚点尽早补 <img>，防止 removeArticleChrome 清掉 image-link 空壳
  promoteEmptyImageAnchors($, $root, baseUrl);
  normalizeInlineNotes($, $root);
  convertStructuredCharts($, $root);
  stripFootnoteChrome($, $root);

  // noscript 已提升过；余下与脚本壳一并删除
  $root.find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas,nav,aside,footer,header').remove();
  removeArticleChrome($, $root);

  // 有图的 aria-hidden/hidden 包装：解包保图（Next 装饰 wrapper 常见）；无图再删
  $root.find('[hidden], [aria-hidden="true"], [aria-hidden=true]').each((_, el) => {
    const node = $(el);
    if (node.is('img') || node.find('img').length) {
      node.removeAttr('hidden').removeAttr('aria-hidden');
      if (!node.is('img')) node.replaceWith(node.contents());
      return;
    }
    node.remove();
  });

  $root.find('img').each((_, el) => {
    const img = $(el);
    if (isTrackingPixelImg(img)) {
      img.remove();
      return;
    }
    const src = resolveExtractedImgSrc(img, baseUrl);
    if (!src) {
      img.remove();
      return;
    }
    img.attr('src', src);
    if (!img.attr('alt')) img.attr('alt', '');
    img.removeAttr('srcset sizes loading decoding style class id width height data-src data-original data-lazy-src data-actualsrc data-url data-original-src data-lazy data-srcset data-image data-bg data-original-url');
  });

  $root.find('a').each((_, el) => {
    const a = $(el);
    const rawHref = a.attr('href');
    const href = absoluteUrl(rawHref, baseUrl);
    if (isFootnoteLikeAnchor(a, href || rawHref)) {
      const t = collapseWsText(a.text()).replace(/\s+/g, '');
      if (/^\[\d{1,3}\]$|^\d{1,3}$/.test(t)) {
        a.replaceWith(`<sup>${escapeHtmlForHtml(t.replace(/[\[\]]/g, ''))}</sup>`);
      } else {
        // 长标题脚注引用：去掉夹心文案，不把 cite 标题塞进正文
        a.replaceWith('');
      }
      return;
    }
    if (href) {
      a.attr('href', href);
      a.attr('target', '_blank');
      a.attr('rel', 'noopener noreferrer nofollow');
      a.removeAttr('style class id');
      return;
    }
    // 无有效 URL：解包保留可读文字（避免裸 <a>cite</a>）
    a.replaceWith(a.contents());
  });

  // 空图片锚点 → 补 <img>（须在 a/img 规范化之后；Substack figure 偶发只剩 href）
  promoteEmptyImageAnchors($, $root, baseUrl);

  // Halo 等博客用 <span class="language-math"> / <div class="language-math"> 标记公式，
  // 白名单过滤会把 span/div 拆成裸文本导致 KaTeX 无法识别；先转成标准定界符。
  $root.find('span.language-math, span[class*="language-math"]').each((_, el) => {
    const tex = $(el).text();
    if (tex.trim()) $(el).replaceWith(`\\(${tex}\\)`);
  });
  $root.find('div.language-math, div[class*="language-math"]').each((_, el) => {
    const tex = $(el).text();
    if (tex.trim()) $(el).replaceWith(`<p>$$${tex}$$</p>`);
  });

  const allowed = new Set([
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'u', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'sup', 'sub',
  ]);
  $root.find('*').each((_, el) => {
    const node = $(el);
    const tag = String(el.name || '').toLowerCase();
    if (!allowed.has(tag)) {
      node.replaceWith(node.contents());
      return;
    }
    for (const attr of Object.keys(el.attribs || {})) {
      if (tag === 'a' && ['href', 'target', 'rel'].includes(attr)) continue;
      if (tag === 'img' && ['src', 'alt'].includes(attr)) continue;
      node.removeAttr(attr);
    }
  });

  // 压平缩进：否则前端 Markdown 会把缩进 HTML 当成代码块，导致“啥都没显示”
  return String($root.html() || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/>\s+</g, '><')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isPaulGrahamUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase() === 'paulgraham.com';
  } catch {
    return false;
  }
}

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};
const JAMES_CLEAR_NEWSLETTER_RE = /^\/3-2-1\/(january|february|march|april|may|june|july|august|september|october|november|december)-([1-9]|[12]\d|3[01])-(20\d{2})\/?$/i;

function jamesClearNewsletterTimestamp(value) {
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'jamesclear.com') return 0;
    const match = JAMES_CLEAR_NEWSLETTER_RE.exec(url.pathname);
    if (!match) return 0;
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return 0;
    return date.getTime();
  } catch {
    return 0;
  }
}

function isJamesClearNewsletterUrl(value) {
  return Boolean(jamesClearNewsletterTimestamp(value));
}

function extractPaulGrahamContent(html, baseUrl) {
  if (!isPaulGrahamUrl(baseUrl)) return null;
  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const roots = [];
  $('td').each((_, el) => {
    const width = String($(el).attr('width') || '').trim();
    if (width === '435') roots.push($(el));
  });
  $('font').each((_, el) => {
    const face = String($(el).attr('face') || '');
    if (/verdana/i.test(face)) roots.push($(el));
  });

  const candidates = roots
    .map(root => {
      const cleaned = cleanExtractedRoot($, root, baseUrl);
      return { content: cleaned, textLength: stripHtml(cleaned).length };
    })
    .filter(c => c.textLength >= 80)
    .sort((a, b) => b.textLength - a.textLength);

  if (!candidates.length) return null;
  const content = candidates[0].content.replace(/\n{3,}/g, '\n\n').trim();
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('td[width="435"] img[alt]').first().attr('alt')
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').trim();
  const metaImage = absoluteUrl(decodeEntities(metaContent(html, ['og:image', 'twitter:image']) || ''), baseUrl);
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    image: pickArticleCoverImage(content, metaImage, baseUrl),
  };
}

function extractJamesClearNewsletterContent(html, baseUrl) {
  if (!isJamesClearNewsletterUrl(baseUrl)) return null;
  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const root = $('.container-outmargin__left .page__content').first();
  if (!root.length) return null;
  const content = cleanExtractedRoot($, root, baseUrl).replace(/\n{3,}/g, '\n\n').trim();
  if (stripHtml(content).length < 80) return null;
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('.container-outmargin__left h1').first().text()
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').replace(/\s-\sJames Clear$/, '').trim();
  const metaImage = absoluteUrl(decodeEntities(metaContent(html, ['og:image', 'twitter:image']) || ''), baseUrl);
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    image: pickArticleCoverImage(content, metaImage, baseUrl),
  };
}

function contentContainerScore(el, text) {
  const tag = String(el && el.name || '').toLowerCase();
  const id = String((el && el.attribs && el.attribs.id) || '');
  const cls = String((el && el.attribs && el.attribs.class) || '');
  const signal = `${id} ${cls}`.toLowerCase();
  let score = Math.min(Number(text && text.length) || 0, 20000);
  if (id === 'post-content' || /(?:^|[\s_-])(?:post|entry|article|markdown)(?:-|_ )?content(?:$|[\s_-])/i.test(signal)) score += 12000;
  if (/articlebody|entry-body|post-body|article-body|rich-text|vditor|tailwind-typography/i.test(signal)) score += 8000;
  if (/\bprose\b|markdown-body|article-content|entry-content|post-content/i.test(signal)) score += 7000;
  if (tag === 'article') score += 4000;
  if (tag === 'main') score -= 2500;
  // 面包屑 / 导航常见开头
  if (/^(?:首页|home|导航|目录|breadcrumb)/i.test(String(text || '').slice(0, 24))) score -= 4000;
  return score;
}

function extractReadableContent(html, baseUrl) {
  const jamesClear = extractJamesClearNewsletterContent(html, baseUrl);
  if (jamesClear && stripHtml(jamesClear.content).length >= 80) return jamesClear;

  const paulGraham = extractPaulGrahamContent(html, baseUrl);
  if (paulGraham && stripHtml(paulGraham.content).length >= 80) return paulGraham;

  const $ = cheerio.load(String(html || ''), { decodeEntities: false });
  const title = decodeEntities(
    metaContent(html, ['og:title', 'twitter:title'])
    || $('title').first().text()
    || ''
  ).replace(/\s+/g, ' ').trim();
  const metaImage = absoluteUrl(
    decodeEntities(metaContent(html, ['og:image', 'twitter:image']) || ''),
    baseUrl
  );
  const candidates = [];
  const selector = [
    'article#post-content',
    '#post-content',
    '[itemprop="articleBody"]',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.markdown-body',
    '.prose',
    'article.tailwind-typography',
    'article',
    'main',
  ].join(',');
  $(selector).each((_, el) => {
    const root = $(el);
    const cleaned = cleanExtractedRoot($, root, baseUrl);
    const text = stripHtml(cleaned);
    if (text.length < 80) return;
    candidates.push({
      content: cleaned,
      textLength: text.length,
      score: contentContainerScore(el, text),
    });
  });
  if (!candidates.length) {
    $('body').find('script,style,noscript,iframe,object,embed,form,button,input,select,textarea,svg,canvas,nav,aside,footer,header').remove();
    const paragraphs = [];
    $('body').find('h1,h2,h3,h4,p,blockquote,li,pre,img').each((_, el) => {
      const cleaned = cleanExtractedRoot($, $(el), baseUrl);
      if (stripHtml(cleaned).length >= 12 || /<img/i.test(cleaned)) paragraphs.push(cleaned);
    });
    const content = paragraphs.join('\n');
    const text = stripHtml(content);
    if (text.length >= 80) candidates.push({ content, textLength: text.length, score: text.length });
  }
  candidates.sort((a, b) => (b.score - a.score) || (b.textLength - a.textLength));
  const content = (candidates[0] && candidates[0].content || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title,
    content,
    summary: stripHtml(content).slice(0, 320),
    // 无正文图时不要用 /static/og-image 等全站默认图
    image: pickArticleCoverImage(content, metaImage, baseUrl),
  };
}

module.exports = {
  stripHtml,
  escapeHtmlForHtml,
  absoluteUrl,
  hostnameOf,
  decodeEntities,
  metaContent,
  isTrackingPixelUrl,
  isTrackingPixelImg,
  toLocalArticleImageUrl,
  firstImage,
  isGenericCoverImage,
  isLikelyArticleOgImage,
  contentHasRealImage,
  isLikelyContentImageUrl,
  promoteEmptyImageAnchors,
  repairEmptyImageAnchorsHtml,
  pickArticleCoverImage,
  bestSrcsetCandidate,
  firstSrcsetUrl,
  normalizeSrcset,
  removeArticleChrome,
  stripSubstackAuthorDateByline,
  normalizeFeedContent,
  normalizeRenderedContent,
  firstSrcsetCandidate,
  resolveExtractedImgSrc,
  collapseWsText,
  tableFigureFromRows,
  promoteMediaElements,
  normalizeInlineNotes,
  convertStructuredCharts,
  stripFootnoteChrome,
  isFootnoteLikeAnchor,
  cleanExtractedRoot,
  isPaulGrahamUrl,
  jamesClearNewsletterTimestamp,
  isJamesClearNewsletterUrl,
  extractPaulGrahamContent,
  extractJamesClearNewsletterContent,
  contentContainerScore,
  extractReadableContent,
};
