(function initContentNormalizers(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QMContentNormalizers = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createContentNormalizers() {
  'use strict';

  const GLUED_ITEM_SEPARATOR = /(?<=[,.;:!?，。；：！？)])\s*-\s+(?=(?:\*\*|\*|`|\[|[A-Z0-9\u3400-\u9fff“]))/u;

  function mapOutsideFences(value, transform) {
    return String(value || '')
      .split(/(```[\s\S]*?```)/g)
      .map((part, index) => index % 2 ? part : transform(part))
      .join('');
  }

  function normalizeEmphasisAndCodeSpacing(value) {
    const codes = [];
    let source = String(value || '').replace(/`[^`\n]+`/g, code => {
      const token = `\uE000${codes.length}\uE001`;
      codes.push({ token, code });
      return token;
    });
    const strong = [];
    source = source.replace(/\*\*([^*\n]*?)\*\*/g, (match, body) => {
      const token = `\uE002${strong.length}\uE003`;
      strong.push({ token, value: `**${body.trim()}**` });
      return token;
    });
    source = source
      .replace(/([\p{L}\p{N}])(\uE002\d+\uE003)/gu, '$1 $2')
      .replace(/(\uE002\d+\uE003)(?=[\p{L}\p{N}])/gu, '$1 ')
      .replace(/([\p{L}\p{N}])(\uE000\d+\uE001)/gu, '$1 $2')
      .replace(/(\uE000\d+\uE001)(?=[\p{L}\p{N}])/gu, '$1 ');
    for (const item of strong) source = source.replaceAll(item.token, () => item.value);
    for (const item of codes) source = source.replaceAll(item.token, () => item.code);
    return source;
  }

  function joinBrokenInlineCode(value) {
    let source = String(value || '');
    // A single newline before an isolated code span is a wrapped sentence, not
    // a paragraph boundary. Two newlines are preserved so a preceding paragraph
    // does not get pulled into the code span.
    source = source.replace(/([^\n])\n(?=`[^`\n]+`(?:\n|$))/g, '$1 ');
    // These crawlers frequently put the remainder of the same sentence after
    // one or more blank lines following an inline code span.
    source = source.replace(/(`[^`\n]+`)\n+(?=\s*(?!(?:#{1,6}|[-+*]\s+|```|\||!\[))\S)/g, '$1 ');
    return source;
  }

  function splitGluedItems(text, { broad = false } = {}) {
    const separator = broad
      ? /\s+-\s+(?=(?:\*\*|\*|`|\[|[A-Za-z0-9\u3400-\u9fff“]))/u
      : GLUED_ITEM_SEPARATOR;
    return String(text || '').split(separator).map(item => item.trim()).filter(Boolean);
  }

  function reflowDashListItems(value, { broad = false } = {}) {
    const lines = String(value || '').split('\n');
    const output = [];
    for (let index = 0; index < lines.length;) {
      const match = /^(\s*)[-+]\s+(.+)$/.exec(lines[index]);
      if (!match) {
        output.push(lines[index]);
        index += 1;
        continue;
      }
      const indent = match[1];
      let content = match[2].trim();
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor];
        const trimmed = next.trim();
        if (!trimmed || /^\s*[-+]\s+/.test(next) || /^(?:#{1,6}\s+|```|!\[|\|)/.test(trimmed)) break;
        content += ` ${trimmed}`;
        cursor += 1;
      }
      const items = splitGluedItems(content, { broad });
      output.push(...items.map(item => `${indent}- ${item}`));
      index = cursor;
    }
    return output.join('\n');
  }

  function promoteGluedEmphasisItems(value) {
    return String(value || '').split('\n').flatMap(line => {
      const trimmed = line.trim();
      if (/^[-+*]\s+/.test(trimmed) || !/^(?:\*\*[^*]+\*\*|\*[^*]+\*)/.test(trimmed)) return [line];
      const items = splitGluedItems(trimmed);
      return items.length > 1 ? items.map(item => `- ${item}`) : [line];
    }).join('\n');
  }

  function tightenListSpacing(value) {
    let source = String(value || '');
    let previous;
    do {
      previous = source;
      source = source.replace(/^(\s*[-+]\s+.+)\n\n(?=\s*[-+]\s+)/gm, '$1\n');
    } while (source !== previous);
    return source;
  }

  function stabilizeStrongMarkup(value) {
    const codes = [];
    let source = String(value || '').replace(/`[^`\n]+`/g, code => {
      const token = `\uE004${codes.length}\uE005`;
      codes.push({ token, code });
      return token;
    });
    source = source.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, (match, body) => `<strong>${body.trim()}</strong>`);
    for (const item of codes) source = source.replaceAll(item.token, () => item.code);
    return source;
  }

  function splitLabeledEmphasisRuns(value) {
    return String(value || '').split('\n').flatMap(line => {
      const labels = line.match(/\*[A-Z][^*\n]{0,60}\*:\s*/g) || [];
      if (labels.length < 2) return [line];
      return line.split(/(?=\*[A-Z][^*\n]{0,60}\*:\s*)/g)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => `- ${item}`);
    }).join('\n');
  }

  function joinMarkdownFragments(parts) {
    return parts.join(' ')
      .replace(/(\]\([^)]+\))(?=[\p{L}\p{N}\[])/gu, '$1 ')
      .replace(/([^\s!])(?=\[[^\]]+\]\()/gu, '$1 ')
      .replace(/\(\s+(?=\[)/g, '(')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function repairStandaloneDashLists(value) {
    const lines = String(value || '').split('\n');
    const output = [];
    for (let index = 0; index < lines.length;) {
      if (lines[index].trim() !== '-') {
        output.push(lines[index]);
        index += 1;
        continue;
      }
      let boundary = index + 1;
      let separators = 0;
      while (boundary < lines.length && !/^#{1,6}\s+/.test(lines[boundary].trim())) {
        if (/\s-\s*$/.test(lines[boundary])) separators += 1;
        boundary += 1;
      }
      if (!separators) {
        output.push(lines[index]);
        index += 1;
        continue;
      }
      const items = [];
      let fragments = [];
      for (let cursor = index + 1; cursor < boundary; cursor += 1) {
        const line = lines[cursor].trim();
        if (!line) continue;
        const separated = /\s-\s*$/.test(line);
        fragments.push(separated ? line.replace(/\s-\s*$/, '') : line);
        if (separated) {
          const item = joinMarkdownFragments(fragments);
          if (item) items.push(item);
          fragments = [];
        }
      }
      const finalItem = joinMarkdownFragments(fragments);
      if (finalItem) items.push(finalItem);
      if (items.length < 2) output.push(...lines.slice(index, boundary));
      else {
        if (output.length && output[output.length - 1].trim()) output.push('');
        output.push(...items.map(item => `- ${item}`), '');
      }
      index = boundary;
    }
    return output.join('\n');
  }

  function normalizeLilianImageCaptions(value) {
    const lines = String(value || '').split('\n');
    const output = [];
    for (let index = 0; index < lines.length;) {
      const image = lines[index].trim();
      if (!/^!\[[^\]]*\]\([^)]+\)$/.test(image)) {
        output.push(lines[index]);
        index += 1;
        continue;
      }
      output.push(lines[index]);
      let cursor = index + 1;
      while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
      let explicitLabel = false;
      if (lines[cursor]?.trim() === '(Image source:') {
        explicitLabel = true;
        cursor += 1;
        while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
      }
      const caption = lines[cursor]?.trim() || '';
      const linkedCaption = /^(\[[^\]]+\]\([^)]+\))\)$/.exec(caption);
      if (linkedCaption && (explicitLabel || caption.endsWith('))'))) {
        output.push('', `*Image source: ${linkedCaption[1]}*`, '');
        index = cursor + 1;
      } else {
        index += 1;
      }
    }
    return output.join('\n');
  }

  function normalizeArthurChiao(value) {
    const normalized = mapOutsideFences(value, segment => {
      let source = segment
        .replace(/^(?:\[[^\]\n]+\]\(https:\/\/arthurchiao\.art#[^)]+\)){3,}[ \t]*$/gm, '---')
        .replace(/（\s*）；\s*`([^`\n]+)`/g, '（`$1`）');
      source = joinBrokenInlineCode(source);
      source = normalizeEmphasisAndCodeSpacing(source);
      source = reflowDashListItems(source, { broad: true });
      source = promoteGluedEmphasisItems(source);
      return tightenListSpacing(source);
    });
    return mapOutsideFences(normalized, segment => stabilizeStrongMarkup(segment).replace(/\n{3,}/g, '\n\n'));
  }

  function normalizeKarpathy(value) {
    const normalized = mapOutsideFences(value, segment => {
      let source = segment
        .replace(/^(# [^\n]+\n\n)\*\s*\n\*\s*\n+/m, '$1')
        .replace(/^(TLDR:\s+\S+)\n\n(?!---)/m, '$1\n\n---\n\n');
      source = joinBrokenInlineCode(source);
      source = normalizeEmphasisAndCodeSpacing(source);
      return tightenListSpacing(reflowDashListItems(source));
    });
    return mapOutsideFences(normalized, segment => stabilizeStrongMarkup(segment).replace(/\n{3,}/g, '\n\n'));
  }

  function normalizeLilianWeng(value) {
    let source = String(value || '')
      .replace(/^(#{1,6}\s+.*?)\[#\]\([^)]+\)[ \t]*$/gm, '$1');
    source = repairStandaloneDashLists(source);
    source = normalizeLilianImageCaptions(source);
    source = mapOutsideFences(source, segment => {
      let next = joinBrokenInlineCode(segment);
      next = normalizeEmphasisAndCodeSpacing(next);
      next = reflowDashListItems(next);
      next = splitLabeledEmphasisRuns(next);
      next = promoteGluedEmphasisItems(next);
      return tightenListSpacing(next);
    });
    return mapOutsideFences(source, segment => stabilizeStrongMarkup(segment).replace(/\n{3,}/g, '\n\n'));
  }

  /**
   * 知乎专栏 HTML→MD 后的共性问题：
   * - 零宽字符 / 公式两侧双空格
   * - 标题被 **加粗** 包裹
   * - 系列文链接粘成一行
   * - 加粗与中文/行内代码粘连
   * - <think> 等字面标签被 HTML 解析吞掉
   * - 列表项间距过大
   * - 加粗只包一层公式时多余
   */
  function stripZeroWidth(value) {
    return String(value || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  }

  function normalizeZhihuMathSpacing(value) {
    let source = String(value || '');
    // 保护 display math，避免被行内规则拆坏
    const displays = [];
    source = source.replace(/\$\$[\s\S]+?\$\$/g, match => {
      const token = `\uE010${displays.length}\uE011`;
      displays.push({ token, value: match.replace(/[ \t]+\n/g, '\n').trim() });
      return token;
    });
    // 行内：$ 两侧多重空白压成单空格；中文旁保留最多一个空格
    source = source
      .replace(/[ \t]{2,}\$(?!\$)/g, ' $')
      .replace(/(?<!\$)\$(?!\$)[ \t]{2,}/g, '$ ')
      .replace(/([\p{Script=Han}])[ \t]+(\$(?!\$))/gu, '$1 $2')
      .replace(/(\$(?!\$)[^$\n]+\$)[ \t]+([\p{Script=Han}])/gu, '$1 $2');
    // ** $math$ ** → **$math$**；若加粗内几乎只有公式则去掉加粗
    source = source.replace(/\*\*[ \t]*(\$[^$\n]+\$)[ \t]*\*\*/g, '$1');
    for (const item of displays) source = source.replaceAll(item.token, () => item.value);
    return source;
  }

  function unwrapZhihuHeadingBold(value) {
    return String(value || '')
      .replace(/^(#{1,6})[ \t]+\*\*([^*\n]+?)\*\*[ \t]*$/gm, '$1 $2')
      .replace(/^(#{1,6})[ \t]+\*\s*([^*\n]+?)\s*\*[ \t]*$/gm, '$1 $2');
  }

  function repairZhihuBrokenBold(value) {
    // 跨行断开的 **title\n** → **title**
    return String(value || '')
      .replace(/\*\*[ \t]*([^*\n]{1,80}?)\n\*\*/g, '**$1**')
      .replace(/\*\*[ \t]*\n[ \t]*([^*\n]{1,80}?)\*\*/g, '**$1**');
  }

  function splitZhihuGluedLinks(value) {
    // 知乎系列文常把 N 个专栏链接粘在同一段：](url)[下一篇](
    return String(value || '')
      .replace(/(\[[^\]]{0,200}\]\([^)]+\))(?=\[)/g, '$1\n')
      // 【系列名】后的链接列表前补空行
      .replace(/(【[^】]{1,40}】)\n?(?=\[)/g, '$1\n\n');
  }

  function escapeZhihuLiteralTags(value) {
    // 正文讨论 agent/模型协议标签时，避免被 Marked 当 HTML 剥离
    // 覆盖 think / answer / plan / reflection 等常见字面标签
    const tag = String.raw`think|answer|plan|reflection|observation|wiki_search|search|redacted_reasoning`;
    const re = new RegExp(String.raw`(?<![\\\`])(</?(?:${tag})>)(?!\`)`, 'gi');
    return String(value || '')
      .replace(re, '`$1`')
      .replace(/`{2,}(<\/?[a-z_]+>)`{2,}/gi, '`$1`');
  }

  function normalizeZhihuBlockquotes(value) {
    // 开篇导语被整段变成多行 > ，保留；压缩 > 行间多余空行
    let source = String(value || '');
    source = source.replace(/(^>[^\n]*\n)\n+(?=^>)/gm, '$1');
    return source;
  }

  function normalizeZhihuImages(value) {
    // 连续图片之间保证空行，避免挤成一团
    return String(value || '')
      .replace(/(!\[[^\]]*\]\([^)]+\))\n(?=!\[[^\]]*\]\()/g, '$1\n\n')
      .replace(/(!\[[^\]]*\]\([^)]+\))\n{3,}/g, '$1\n\n');
  }

  function normalizeZhihu(value) {
    let source = stripZeroWidth(String(value || ''))
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');

    source = unwrapZhihuHeadingBold(source);
    source = repairZhihuBrokenBold(source);
    source = splitZhihuGluedLinks(source);
    source = normalizeZhihuBlockquotes(source);
    source = normalizeZhihuImages(source);

    source = mapOutsideFences(source, segment => {
      let next = escapeZhihuLiteralTags(segment);
      next = joinBrokenInlineCode(next);
      next = normalizeZhihuMathSpacing(next);
      next = normalizeEmphasisAndCodeSpacing(next);
      next = reflowDashListItems(next, { broad: true });
      next = promoteGluedEmphasisItems(next);
      next = tightenListSpacing(next);
      return next;
    });

    return mapOutsideFences(source, segment => {
      let next = stabilizeStrongMarkup(segment);
      // 中文场景：加粗后紧贴汉字时补空格（stabilize 已转 strong）
      next = next
        .replace(/(<\/strong>)(?=[\p{Script=Han}\p{L}\p{N}])/gu, '$1 ')
        .replace(/([\p{Script=Han}\p{L}\p{N}])(<strong>)/gu, '$1 $2')
        .replace(/\n{3,}/g, '\n\n');
      return next;
    });
  }

  function isZhihuSource(sourceId) {
    return String(sourceId || '').startsWith('zhihu-');
  }

  const MONTH_NAME = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';

  const EN_DATE = `${MONTH_NAME}\\.?\\s+\\d{1,2},?\\s+\\d{4}`;
  const ZH_DATE = String.raw`\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日`;

  /** 正文/摘要里的 Substack 作者+日期（HTML 与纯文本，含译后「2026年6月10日」） */
  function stripSubstackAuthorDateByline(value) {
    let source = String(value || '');
    if (!source) return '';
    // <a href="https://substack.com/@user"...>Name</a>Jun 03, 2026
    source = source.replace(
      new RegExp(
        String.raw`<a\b[^>]*\b(?:href\s*=\s*["'][^"']*substack\.com/@[^"']*["']|substack\.com/@)[^>]*>[\s\S]*?<\/a>\s*(?:${EN_DATE}|${ZH_DATE})`,
        'gi',
      ),
      '',
    );
    // Maarten GrootendorstJun 03, 2026 / Maarten Grootendorst 2026年6月10日
    source = source.replace(
      new RegExp(
        String.raw`\bMaarten\s+Grootendorst\s*(?:${EN_DATE}|${ZH_DATE})`,
        'gi',
      ),
      '',
    );
    // 译后摘要常见：。Maarten Grootendorst 2026年6月10日
    source = source.replace(
      new RegExp(
        String.raw`([。.!！？\s])Maarten\s+Grootendorst\s*(?:${EN_DATE}|${ZH_DATE})\s*`,
        'gi',
      ),
      '$1',
    );
    source = source.replace(
      new RegExp(
        String.raw`(<\/h[1-3]>\s*)(?:<p[^>]*>\s*)?(?:${EN_DATE}|${ZH_DATE})\s*(?:<\/p>)?`,
        'gi',
      ),
      '$1',
    );
    return source.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  }

  function normalizeMaarten(value) {
    return stripSubstackAuthorDateByline(String(value || ''));
  }

  function normalizeBySource(value, sourceId) {
    const source = String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    if (sourceId === 'arthurchiao') return normalizeArthurChiao(source);
    if (sourceId === 'karpathy') return normalizeKarpathy(source);
    if (sourceId === 'lilianweng') return normalizeLilianWeng(source);
    if (sourceId === 'maarten') return normalizeMaarten(source);
    // 其它 Substack 正文也可能粘 byline
    if (/substack\.com\/@/i.test(source) && /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(source)) {
      return stripSubstackAuthorDateByline(source);
    }
    if (isZhihuSource(sourceId)) return normalizeZhihu(source);
    return source;
  }

  return {
    normalizeBySource,
    normalizeArthurChiao,
    normalizeKarpathy,
    normalizeLilianWeng,
    normalizeMaarten,
    normalizeZhihu,
    stripSubstackAuthorDateByline,
    isZhihuSource,
  };
}));
