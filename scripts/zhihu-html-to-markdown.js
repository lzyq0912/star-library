#!/usr/bin/env node
/**
 * 将知乎专栏 HTML 正文转为可读 Markdown。
 * 用于 content_md 被错误存成 raw HTML 的条目修复。
 */
'use strict';

const { load } = require('cheerio');
const { URL } = require('url');

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function unwrapZhihuLink(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.zhihu.com');
    if (url.hostname.includes('link.zhihu.com') && url.searchParams.get('target')) {
      return decodeURIComponent(url.searchParams.get('target'));
    }
    return url.href;
  } catch {
    return raw;
  }
}

function pickImageSrc($, el) {
  const $el = $(el);
  const candidates = [
    $el.attr('data-original'),
    $el.attr('data-actualsrc'),
    $el.attr('data-src'),
    $el.attr('src'),
  ].filter(Boolean);

  for (const src of candidates) {
    if (!src || src.startsWith('data:')) continue;
    if (/zhimg\.com|pic[a-z]?\.zhimg|zhihu\.com\/equation/.test(src) || /^https?:\/\//i.test(src)) {
      return src.replace(/_720w\.(jpg|jpeg|png|webp)/i, '_r.$1');
    }
  }

  // noscript 里常有真实图片
  const noscript = $el.closest('figure').find('noscript').html() || $el.parent().find('noscript').html() || '';
  if (noscript) {
    const m = noscript.match(/\bsrc=["']([^"']+)["']/i)
      || noscript.match(/\bdata-original=["']([^"']+)["']/i);
    if (m && m[1] && !m[1].startsWith('data:')) return m[1];
  }
  return candidates.find(s => s && !s.startsWith('data:')) || '';
}

function latexFromEquationImg($, el) {
  const $el = $(el);
  const alt = decodeEntities($el.attr('alt') || '').trim();
  if (alt) return alt;
  const src = $el.attr('src') || '';
  try {
    const url = new URL(src);
    const tex = url.searchParams.get('tex');
    if (tex) return decodeURIComponent(tex);
  } catch {
    /* ignore */
  }
  return '';
}

function isEquationImg($, el) {
  const $el = $(el);
  if ($el.attr('eeimg')) return true;
  const src = String($el.attr('src') || '');
  return /zhihu\.com\/equation/.test(src);
}

function collapseWs(text) {
  return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

function escapeMdText(text) {
  // 仅转义会破坏行内结构的字符，保留中文标点
  return String(text || '').replace(/([\\`*_{}\[\]<>|])/g, '\\$1');
}

function cellText(value) {
  return String(value || '')
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function zhihuHtmlToMarkdown(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';

  // 已是 Markdown：保留
  if (!/<(?:p|div|blockquote|h[1-6]|ul|ol|table|figure)\b/i.test(raw.slice(0, 800))) {
    return raw;
  }

  const $ = load(`<div id="__root">${raw}</div>`, {
    decodeEntities: false,
    xmlMode: false,
  });
  const root = $('#__root');

  // 清理无用节点
  root.find('script, style, button, svg, canvas').remove();
  root.find('.RichText-LinkCardContainer, .LinkCard, .ztext-empty, .content-image-hidden').remove();

  function convertInline(node) {
    if (!node) return '';
    if (node.type === 'text') {
      return decodeEntities(node.data || '').replace(/\s+/g, ' ');
    }
    if (node.type !== 'tag') return '';

    const name = node.name.toLowerCase();
    const $el = $(node);
    const children = () => (node.children || []).map(convertInline).join('');

    if (name === 'br') return '\n';
    if (name === 'strong' || name === 'b') {
      const inner = children().trim();
      return inner ? `**${inner}**` : '';
    }
    if (name === 'em' || name === 'i') {
      const inner = children().trim();
      return inner ? `*${inner}*` : '';
    }
    if (name === 'code' && !$el.closest('pre').length) {
      const inner = decodeEntities($el.text()).replace(/\n+/g, ' ').trim();
      return inner ? `\`${inner.replace(/`/g, '\\`')}\`` : '';
    }
    if (name === 'a') {
      const href = unwrapZhihuLink($el.attr('href'));
      // 知乎外链拆成 invisible/visible/ellipsis 时，text() 会拼回完整 URL
      let label = decodeEntities($el.text()).replace(/\s+/g, ' ').trim();
      if (!label || label === '…' || label === '...') label = href;
      // 仍被 UI 截断时，退回真实目标 URL
      if (href && label && !label.includes('://') && href.includes(label.replace(/\.\.\.$/, '')) === false && label.length < 24) {
        try {
          const u = new URL(href);
          label = u.hostname + (u.pathname === '/' ? '' : u.pathname);
        } catch {
          label = href;
        }
      }
      if (!label) label = href;
      if (!href) return label;
      return `[${label}](${href})`;
    }
    if (name === 'img') {
      if (isEquationImg($, node)) {
        const latex = latexFromEquationImg($, node);
        if (!latex) return '';
        // eeimg=2 多为独立公式行；含对齐/分式也用 display
        const display = String($el.attr('eeimg') || '') === '2'
          || /\\begin|\\sum_|\\frac\s*\{|\\tag/.test(latex);
        if (display) return `\n\n$$\n${latex}\n$$\n\n`;
        return `$${latex}$`;
      }
      const src = pickImageSrc($, node);
      if (!src) return '';
      const alt = decodeEntities($el.attr('alt') || $el.attr('data-caption') || '').trim();
      return `![${alt}](${src})`;
    }
    if (name === 'span') {
      if ($el.hasClass('invisible') || $el.hasClass('ellipsis')) return '';
      return children();
    }
    if (name === 'sup' || name === 'sub') return children();
    if (name === 'u' || name === 's' || name === 'del') return children();
    return children();
  }

  function convertBlock(node, ctx = { listDepth: 0 }) {
    if (!node) return '';
    if (node.type === 'text') {
      const t = decodeEntities(node.data || '').replace(/\s+/g, ' ').trim();
      return t ? `${t}\n\n` : '';
    }
    if (node.type !== 'tag') return '';

    const name = node.name.toLowerCase();
    const $el = $(node);
    const inline = () => (node.children || []).map(convertInline).join('').replace(/[ \t]+\n/g, '\n').trim();
    const blocks = () => (node.children || []).map(child => convertBlock(child, ctx)).join('');

    if (name === 'h1' || name === 'h2' || name === 'h3' || name === 'h4' || name === 'h5' || name === 'h6') {
      const level = Number(name[1]);
      let text = inline().replace(/\n+/g, ' ').trim();
      // 知乎标题常包一层 <b>，转 MD 后变成 ## **标题**，统一拆掉
      text = text.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^\*(.+)\*$/, '$1').trim();
      return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
    }
    if (name === 'p') {
      const text = inline();
      return text ? `${text}\n\n` : '';
    }
    if (name === 'blockquote') {
      const body = inline() || blocks().trim();
      if (!body) return '';
      const quoted = body
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `> ${line}`)
        .join('\n');
      return `${quoted}\n\n`;
    }
    if (name === 'hr') return '---\n\n';
    if (name === 'ul' || name === 'ol') {
      const ordered = name === 'ol';
      const items = $el.children('li').toArray();
      const lines = items.map((li, index) => {
        const $li = $(li);
        // li 内可能嵌套块级
        const parts = [];
        for (const child of li.children || []) {
          if (child.type === 'tag' && (child.name === 'ul' || child.name === 'ol')) {
            parts.push(convertBlock(child, { listDepth: ctx.listDepth + 1 }).trimEnd());
          } else if (child.type === 'tag' && (child.name === 'p' || child.name === 'div')) {
            parts.push((child.children || []).map(convertInline).join('').trim());
          } else {
            parts.push(convertInline(child));
          }
        }
        const flat = parts.join(' ').replace(/\s+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
        const [first, ...rest] = flat.split('\n');
        const bullet = ordered ? `${index + 1}. ` : '- ';
        const indent = '  '.repeat(ctx.listDepth);
        let out = `${indent}${bullet}${first || ''}`.trimEnd();
        for (const line of rest) {
          if (/^\s*[-*]|\d+\.\s/.test(line) || line.startsWith('  ')) out += `\n${line}`;
          else out += `\n${indent}  ${line}`;
        }
        return out;
      });
      return `${lines.join('\n')}\n\n`;
    }
    if (name === 'pre' || (name === 'div' && $el.hasClass('highlight'))) {
      const $code = $el.is('pre') ? $el.find('code').first() : $el.find('pre code').first();
      const codeEl = $code.length ? $code.get(0) : ($el.is('pre') ? node : $el.find('pre').get(0));
      let lang = '';
      const cls = ($code.attr('class') || $el.attr('class') || '');
      const langMatch = /language-([a-z0-9_+-]+)/i.exec(cls);
      if (langMatch) lang = langMatch[1] === 'text' ? '' : langMatch[1];
      let code = decodeEntities($(codeEl || node).text());
      // 去掉 pygments 空 span 遗留
      code = code.replace(/^\u200b/, '').replace(/\n$/, '');
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    if (name === 'table') {
      const rows = [];
      $el.find('tr').each((_, tr) => {
        const cells = $(tr).find('th,td').toArray().map(cell => {
          const text = (cell.children || []).map(convertInline).join('');
          return cellText(text);
        });
        if (cells.length) rows.push(cells);
      });
      if (!rows.length) return '';
      const width = Math.max(...rows.map(r => r.length));
      const pad = row => {
        const next = row.slice();
        while (next.length < width) next.push('');
        return next;
      };
      const header = pad(rows[0]);
      const body = rows.slice(1).map(pad);
      const line = cells => `| ${cells.join(' | ')} |`;
      const sep = `| ${header.map(() => '---').join(' | ')} |`;
      return `${[line(header), sep, ...body.map(line)].join('\n')}\n\n`;
    }
    if (name === 'figure') {
      const img = $el.find('img').filter((_, el) => !isEquationImg($, el)).first();
      if (img.length) {
        const src = pickImageSrc($, img.get(0));
        const alt = decodeEntities(img.attr('alt') || img.attr('data-caption') || $el.find('figcaption').text() || '').trim();
        if (src) return `![${alt}](${src})\n\n`;
      }
      // figure 里可能只有公式
      const eq = $el.find('img').filter((_, el) => isEquationImg($, el)).first();
      if (eq.length) {
        const latex = latexFromEquationImg($, eq.get(0));
        if (latex) return `$$\n${latex}\n$$\n\n`;
      }
      return blocks();
    }
    if (name === 'li') {
      // 仅在 ul/ol 外偶然出现时
      const text = inline();
      return text ? `- ${text}\n\n` : '';
    }
    if (name === 'div' || name === 'section' || name === 'article' || name === 'noscript') {
      // noscript 中的图片已在 pickImageSrc 处理；避免重复输出
      if (name === 'noscript') return '';
      return blocks();
    }
    // 行内标签落到块级时
    if (['span', 'a', 'b', 'strong', 'em', 'i', 'code', 'img', 'br'].includes(name)) {
      const text = convertInline(node).trim();
      return text ? `${text}\n\n` : '';
    }
    return blocks();
  }

  let md = (root.get(0).children || []).map(child => convertBlock(child)).join('');
  md = md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // 替换串里 $$ 会被当成字面 $，必须用回调返回真实 $$
    .replace(/\$\$\n\n+/g, () => '$$\n')
    .replace(/\n\n+\$\$/g, () => '\n$$')
    // 清理空加粗
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();

  return md ? `${md}\n` : '';
}

function markdownSummary(md, limit = 280) {
  const plain = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, limit);
}

function firstMarkdownImage(md) {
  const re = /!\[[^\]]*\]\((\/article-images\/[^)\s]+|https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = re.exec(String(md || '')))) {
    const url = match[1];
    if (/zhihu\.com\/equation|equation\?tex=/i.test(url)) continue;
    return url;
  }
  return null;
}

module.exports = {
  zhihuHtmlToMarkdown,
  markdownSummary,
  firstMarkdownImage,
  unwrapZhihuLink,
};

if (require.main === module) {
  const fs = require('fs');
  const input = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  process.stdout.write(zhihuHtmlToMarkdown(input));
}
