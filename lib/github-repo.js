/**
 * GitHub 项目书签：URL 归一化 + REST API 拉元数据/README。
 * 不走 HTML 文章抽取（extractReadableContent）。
 */
const cheerio = require('cheerio');

const GITHUB_PROJECTS_SOURCE_ID = 'github-projects';
const API_HOST = 'api.github.com';
const INPUT_HOSTS = new Set(['github.com', 'www.github.com']);
const RESERVED_OWNERS = new Set([
  'settings', 'marketplace', 'explore', 'topics', 'collections', 'events',
  'features', 'enterprise', 'pricing', 'login', 'join', 'logout', 'session',
  'organizations', 'orgs', 'users', 'search', 'notifications', 'account',
  'new', 'codespaces', 'copilot', 'customer-stories', 'readme', 'sponsors',
  'about', 'site', 'security', 'pulls', 'issues', 'gist',
]);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Awesome List 等 README 常塞满 shields 徽章 + 巨型表格；书签只保留可读正文 */
const README_MAX_HTML_CHARS = Math.max(
  20_000,
  Math.min(200_000, parseInt(process.env.GITHUB_README_MAX_HTML || '80000', 10) || 80_000),
);
/** 单表只留前几行（含表头；默认 4 = 表头+约 3 条，完整去 GitHub） */
const README_MAX_TABLE_ROWS = Math.max(3, Math.min(40, parseInt(process.env.GITHUB_README_MAX_TABLE_ROWS || '4', 10) || 4));
/** 允许多分类多表；超出静默丢弃，不写「已省略」占位句 */
const README_MAX_TABLES = Math.max(2, Math.min(60, parseInt(process.env.GITHUB_README_MAX_TABLES || '24', 10) || 24));
const BADGE_URL_RE = /shields\.io|badgen\.net|badge\.fury|img\.forthebadge|travis-ci|circleci\.com|codecov\.io|coveralls\.io|david-dm|snyk\.io|dependabot|api\.star-history\.com|progressed\.io|gitpod\.io\/button|codespaces|buymeacoffee|ko-fi\.com|liberapay|patreon\.com|opencollective|trendshift\.io|github\.com\/[^/]+\/[^/]+\/actions\/workflows|camo\.githubusercontent\.com\/[a-f0-9]{20,}|pepy\.tech|static\.pepy|commitactivity|github\/stars|github\/forks|github\/license|github\/v\/release|github\/issues|github\/last-commit/i;
const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);
const LOGO_IMG_RE = /logo|banner|social[-_]?preview|opengraph|og-image|header[-_]?image|brand/i;
const CHROME_LINE_RE = /repository of the day|trendshift|sponsor|buy me a coffee|made with|powered by|built with|backers?|contributors?|stargazers|forks?|watchers?/i;
const BADGE_LABEL_RE = /^(latest\s+release|license|mit|apache|sponsor|agent skills?|formats? supported|downloads?|npm|pypi|build|coverage|docs?|version|stars?|forks?)$/i;

function githubError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatStars(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(num);
}

/**
 * 解析并归一化为 { owner, repo, canonicalUrl }
 * 支持 tree/blob/issues 等深层路径，截到 owner/repo。
 */
function parseGitHubRepoUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw githubError('请填写 GitHub 仓库链接');

  // 纯 owner/repo
  if (!/^https?:\/\//i.test(raw) && !raw.includes('github.com') && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(raw)) {
    raw = `https://github.com/${raw.replace(/\/$/, '')}`;
  }

  // git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(raw);
  if (ssh) {
    raw = `https://github.com/${ssh[1]}/${ssh[2].replace(/\.git$/i, '')}`;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw githubError('这不是有效的 GitHub 仓库地址，请粘贴 https://github.com/所有者/仓库名');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw githubError('只支持 http/https 链接');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') {
    throw githubError('这不是有效的 GitHub 仓库地址，请粘贴 https://github.com/所有者/仓库名');
  }
  if (url.port) {
    throw githubError('GitHub 链接只支持标准端口');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw githubError('这不是有效的 GitHub 仓库地址，请粘贴 https://github.com/所有者/仓库名');
  }

  let owner = parts[0];
  let repo = parts[1].replace(/\.git$/i, '');
  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    throw githubError('这不是仓库首页，请粘贴 https://github.com/所有者/仓库名');
  }
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') {
    throw githubError('仓库名格式不正确');
  }

  // 规范大小写：保留用户输入的 owner/repo 拼写（API 会回 full_name）
  const canonicalUrl = `https://github.com/${owner}/${repo}`;
  return { owner, repo, canonicalUrl };
}

function normalizeGitHubRepoUrl(input) {
  return parseGitHubRepoUrl(input).canonicalUrl;
}

function githubHeaders({ accept } = {}) {
  const headers = {
    Accept: accept || 'application/vnd.github+json',
    'User-Agent': 'QMReader-Zen/1.0 (personal reader; +https://github.com)',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubApi(apiPath, { accept, timeout = 20000, fetchImpl = fetch } = {}) {
  const url = `https://${API_HOST}${apiPath}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: githubHeaders({ accept }),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw githubError('连接 GitHub 超时，请检查网络后重试', 504);
    }
    throw githubError('无法连接 GitHub，请检查网络后重试', 502);
  }

  // 仅允许同 host 重定向（极少见）
  if (response.status >= 300 && response.status < 400) {
    const loc = response.headers.get('location') || '';
    try {
      const next = new URL(loc, url);
      if (next.hostname.toLowerCase() !== API_HOST) {
        throw githubError('GitHub 接口返回了非预期跳转', 502);
      }
    } catch (e) {
      if (e.statusCode) throw e;
      throw githubError('GitHub 接口返回了非预期跳转', 502);
    }
  }
  return response;
}

async function throwIfGitHubError(response, { owner, repo } = {}) {
  if (response.ok) return;
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  let bodyMessage = '';
  try {
    const data = await response.clone().json();
    bodyMessage = String(data && data.message || '').trim();
  } catch {
    /* ignore */
  }

  const status = response.status;
  if (status === 404) {
    throw githubError('无法访问该仓库：可能不存在、已设为私有，或需要 GITHUB_TOKEN', 404);
  }
  if (status === 401) {
    throw githubError('GitHub 凭证无效，请检查 GITHUB_TOKEN', 401);
  }
  if (status === 403) {
    if (remaining === '0' || /rate limit/i.test(bodyMessage)) {
      const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString('zh-CN') : '';
      throw githubError(
        when
          ? `GitHub 接口次数已用完，约 ${when} 后可重试，或在本机配置 GITHUB_TOKEN`
          : 'GitHub 接口次数已用完，请稍后再试或在本机配置 GITHUB_TOKEN',
        429,
      );
    }
    throw githubError('这是私有仓库，当前无权访问。可在本机设置有权限的 GITHUB_TOKEN 后重试', 403);
  }
  if (status === 451) {
    throw githubError('该仓库因访问限制无法获取', 403);
  }
  if (status >= 500) {
    throw githubError('GitHub 服务暂时异常，请稍后重试', 502);
  }
  throw githubError(bodyMessage || `GitHub 返回错误（${status}）`, status >= 400 && status < 600 ? status : 502);
}

function isBadgeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (BADGE_URL_RE.test(raw)) return true;
  if (/\/badge(?:s)?(?:\.|\/|$)/i.test(raw) && /\.(svg|png|gif)(?:$|[?#])/i.test(raw)) return true;
  return false;
}

function stripBloatAttributes($, el) {
  const node = $(el);
  for (const attr of Object.keys(el.attribs || {})) {
    if (KEEP_ATTRS.has(attr)) continue;
    // 允许 a[target|rel] 稍后统一加
    if (attr === 'target' || attr === 'rel') continue;
    node.removeAttr(attr);
  }
}

function normalizeCompareText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyLogoImg(src, alt) {
  return LOGO_IMG_RE.test(`${src || ''} ${alt || ''}`);
}

/** 几乎只有链接/短标签的目录行或徽章行 */
function isChromeOnlyBlock($, node) {
  const text = node.text().replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (text.length > 280) return false;
  if (CHROME_LINE_RE.test(text) && text.length < 220) return true;
  if (/^#\d+\b/.test(text) && /repository of the day|trendshift/i.test(text)) return true;
  if (/^🏆/.test(text) && text.length < 200) return true;

  const links = node.find('a').toArray();
  const imgs = node.find('img').toArray();
  if (imgs.length && !links.length && text.length < 40) return true;

  // 纯徽章文案
  if (BADGE_LABEL_RE.test(text)) return true;
  // 「Latest release · MIT · Sponsor」类一行
  const labels = text.split(/[·|•,/]/).map(s => s.trim()).filter(Boolean);
  if (labels.length >= 2 && labels.every(l => BADGE_LABEL_RE.test(l) || l.length <= 18)) return true;

  if (links.length >= 3) {
    const linkTextLen = links.reduce((n, a) => n + String($(a).text() || '').trim().length, 0);
    if (linkTextLen >= text.length * 0.75 && text.length < 240) return true;
  }
  // Why · What · Usage 目录
  if (links.length >= 4 && /why|what|usage|faq|install|changelog|architecture|requirements/i.test(text) && text.length < 220) {
    return true;
  }
  return false;
}

function isMostlyBadgeTable($, table) {
  const text = table.text().replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const imgs = table.find('img').length;
  const cells = table.find('td,th').length || 1;
  if (imgs >= Math.max(2, cells - 1) && text.length < 120) return true;
  if (text.length < 80 && table.find('a').length >= 2 && !/[.。]/.test(text)) return true;
  return false;
}

/**
 * 清洗 GitHub README HTML（所有项目统一）：
 * - 去徽章 / logo / Trendshift 排行 / 赞助行 / 目录锚点行
 * - 去掉与仓库同名的 h1、与 API 简介重复的首段
 * - 剥 class/style 膨胀；限制表格；硬顶长度
 */
function sanitizeGithubReadmeHtml(html, {
  owner,
  repo,
  defaultBranch = 'main',
  description = '',
  fullName = '',
} = {}) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  const $ = cheerio.load(raw, { decodeEntities: false }, false);
  $('script,style,iframe,object,embed,form,button,input,select,textarea,svg,video,audio,canvas,noscript,picture,source').remove();
  $('[onclick],[onload],[onerror]').each((_, el) => {
    const node = $(el);
    for (const attr of Object.keys(el.attribs || {})) {
      if (/^on/i.test(attr)) node.removeAttr(attr);
    }
  });

  const baseBlob = `https://github.com/${owner}/${repo}/blob/${defaultBranch}/`;
  const baseRaw = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/`;
  const nameKey = normalizeCompareText(repo);
  const fullKey = normalizeCompareText(fullName || `${owner}/${repo}`);
  const descKey = normalizeCompareText(description);

  // 图片：徽章 / logo 删；其余绝对化
  $('img').each((_, el) => {
    const img = $(el);
    const src = String(img.attr('src') || img.attr('data-canonical-src') || '').trim();
    const alt = String(img.attr('alt') || '').trim();
    if (
      isBadgeImageUrl(src)
      || isBadgeImageUrl(alt)
      || isLikelyLogoImg(src, alt)
      || /^data:image\/svg/i.test(src)
      || !src
      || src.startsWith('data:')
    ) {
      img.remove();
      return;
    }
    if (!/^https?:\/\//i.test(src)) {
      try {
        if (src.startsWith('/')) img.attr('src', `https://github.com${src}`);
        else img.attr('src', new URL(src, baseRaw).toString());
      } catch {
        img.remove();
        return;
      }
    }
    // 绝对化后仍可能是 badge CDN
    const abs = String(img.attr('src') || '');
    if (isBadgeImageUrl(abs)) {
      img.remove();
      return;
    }
    for (const attr of Object.keys(el.attribs || {})) {
      if (attr !== 'src' && attr !== 'alt') img.removeAttr(attr);
    }
  });

  $('a').each((_, el) => {
    const a = $(el);
    const href = String(a.attr('href') || '').trim();
    // 拒绝 javascript:/vbscript:/data: 跳转（相对化前先砍）
    if (/^(?:javascript|vbscript|data):/i.test(href)) {
      a.removeAttr('href');
      return;
    }
    if (href && !href.startsWith('#') && !/^https?:\/\//i.test(href) && !href.startsWith('mailto:')) {
      try {
        if (href.startsWith('/')) a.attr('href', `https://github.com${href}`);
        else a.attr('href', new URL(href, baseBlob).toString());
      } catch {
        a.removeAttr('href');
      }
    }
    // 指向 shields / sponsor 的空链
    if (isBadgeImageUrl(href) || /sponsors?|opencollective|buymeacoffee|ko-fi/i.test(href)) {
      if (!a.text().replace(/\s+/g, '').trim() || a.text().trim().length < 24) {
        a.remove();
        return;
      }
    }
    if (!a.text().replace(/\s+/g, '').trim() && !a.find('img').length) {
      a.replaceWith(a.contents());
    }
  });

  // 与仓库同名的首个 h1（README 标题重复侧栏标题）
  $('h1').each((index, el) => {
    if (index > 0) return;
    const t = normalizeCompareText($(el).text());
    if (!t) {
      $(el).remove();
      return;
    }
    if (t === nameKey || t === fullKey || t.includes(nameKey) && t.length <= nameKey.length + 8) {
      $(el).remove();
    }
  });

  // 与 API 简介重复的前几段
  if (descKey && descKey.length >= 24) {
    let checked = 0;
    $('p').each((_, el) => {
      if (checked >= 4) return false;
      const node = $(el);
      const t = normalizeCompareText(node.text());
      if (!t) return;
      checked += 1;
      if (t === descKey || (t.length >= 24 && (descKey.includes(t) || t.includes(descKey)) && Math.abs(t.length - descKey.length) < 40)) {
        node.remove();
      }
    });
  }

  // 去 chrome 段落 / div（标题 h2+ 只删明确的排行/赞助行，避免误伤正文章节）
  $('p,div,section,center').each((_, el) => {
    const node = $(el);
    if (isChromeOnlyBlock($, node)) node.remove();
  });
  $('h2,h3,h4,h5,h6').each((_, el) => {
    const node = $(el);
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!text) {
      node.remove();
      return;
    }
    if (CHROME_LINE_RE.test(text) && text.length < 80) node.remove();
  });

  // 徽章表 / 空表
  $('table').each((_, el) => {
    if (isMostlyBadgeTable($, $(el))) $(el).remove();
  });

  // Awesome List 折叠「📋 Click to view technical details」：
  // 阅读区几乎只见标题+空白，却塞进 8 列宽表数据表（RL Algorithm / Reward Type…），
  // 体量常≈主列表的 1 倍 → 翻译 dual 输出直接爆。书签只保留主表，细节回 GitHub。
  $('details').each((_, el) => {
    const node = $(el);
    const summaryText = node.children('summary').first().text().replace(/\s+/g, ' ').trim()
      || node.find('summary').first().text().replace(/\s+/g, ' ').trim();
    const hasTable = node.find('table').length > 0;
    if (
      hasTable
      && /technical details|技术细节|click to view|查看技术|tech(?:nical)?\s*details/i.test(summaryText)
    ) {
      node.remove();
      return;
    }
    // 其它 details：去掉外壳，保留正文（避免 summary 占一行噪音）
    const inner = node.contents().not('summary').toArray().map(child => $.html(child)).join('');
    node.replaceWith(inner || '');
  });
  // 简介里「See Click to view technical details under each table」——折叠表已删，这句变死链噪音
  $('li,p').each((_, el) => {
    const node = $(el);
    const t = node.text().replace(/\s+/g, ' ').trim();
    if (/click to view technical details/i.test(t) && /under each table/i.test(t) && t.length < 400) {
      // 若前半句还有实质介绍，只砍掉 See … table 尾巴
      const stripped = t.replace(/\s*See\s*\[[^\]]*click to view technical details[^\]]*\][^.。]*[.。]?\s*$/i, '').trim();
      if (stripped && stripped.length >= 40 && stripped !== t) {
        node.html(escapeHtml(stripped));
      } else {
        node.remove();
      }
    }
  });
  // GitHub 渲染残留的无语义包装（会干扰块切分）
  $('markdown-accessiblity-table, markdown-accessibility-table').each((_, el) => {
    const node = $(el);
    node.replaceWith(node.contents());
  });

  // 表格：每表只留前 N 行；超出表数静默去掉。不写「已省略 / 已截断」占位（尬且无信息量）
  const tables = $('table').toArray();
  tables.forEach((el, index) => {
    const table = $(el);
    if (index >= README_MAX_TABLES) {
      table.remove();
      return;
    }
    const rows = table.find('tr').toArray();
    if (rows.length > README_MAX_TABLE_ROWS) {
      rows.slice(README_MAX_TABLE_ROWS).forEach(row => $(row).remove());
    }
  });

  $('*').each((_, el) => stripBloatAttributes($, el));

  // 再清空壳
  for (let pass = 0; pass < 3; pass += 1) {
    $('p,span,div,li,td,th,h1,h2,h3,h4,h5,h6').each((_, el) => {
      const node = $(el);
      if (node.find('img,a,table,pre,code,ul,ol,li,blockquote').length) {
        // 只剩空链
        if (!node.text().replace(/\s+/g, '').trim() && !node.find('img,table,pre,code').length) node.remove();
        return;
      }
      if (!node.text().replace(/\s+/g, '').trim()) node.remove();
    });
    $('ul,ol').each((_, el) => {
      if (!$(el).children('li').length) $(el).remove();
    });
  }

  let out = String($.root().html() || '').trim();
  if (out.length > README_MAX_HTML_CHARS) {
    let cut = README_MAX_HTML_CHARS;
    const lastClose = out.lastIndexOf('>', cut);
    if (lastClose > README_MAX_HTML_CHARS * 0.7) cut = lastClose + 1;
    // 静默截断：不插「过长已截断」提示
    out = out.slice(0, cut);
  }
  return out;
}

/**
 * 正文：可选备注 + 清洗后的 README（不要「简介」区块）。
 * 标题用仓库名（AgentsMeetRL），不含 owner；⭐ / 最近推送在标题旁。
 */
function buildRepoBriefHtml(meta, { note = '' } = {}) {
  const metaJson = escapeHtml(JSON.stringify({
    owner: meta.owner,
    repo: meta.name,
    stars: meta.stars,
    language: meta.language || '',
    defaultBranch: meta.defaultBranch || '',
    pushedAt: meta.pushedAt || '',
  }));

  const noteHtml = note
    ? `<p class="repo-note">${escapeHtml(note)}</p>`
    : '';
  const readmeBody = String(meta.readmeHtml || '').trim();
  const readme = readmeBody
    ? `<section class="repo-readme">${readmeBody}</section>`
    : '';

  return [
    `<!--repo-meta:${metaJson}-->`,
    noteHtml ? `<article class="repo-brief">${noteHtml}</article>` : '',
    readme || (noteHtml ? '' : '<section class="repo-readme"><p>暂无 README 或无法加载。</p></section>'),
  ].filter(Boolean).join('\n');
}

/** 展示标题：仅仓库名，不带 owner/ */
function buildRepoDisplayTitle(meta) {
  const name = String(meta && (meta.name || meta.repo) || '').trim();
  if (name) return name;
  const full = String(meta && meta.fullName || '').trim();
  if (full.includes('/')) return full.split('/').pop() || full;
  return full || 'repository';
}

function buildRepoSummary(meta) {
  // 列表卡：⭐ + description；语言/Topics 不展示
  const parts = [
    `⭐ ${formatStars(meta.stars)}`,
    meta.description || '',
  ].filter(Boolean);
  return parts.join(' · ').replace(/\s+/g, ' ').trim().slice(0, 320);
}

/** 阅读区标题旁：⭐ + 最近推送 */
function buildRepoReaderMetaLine(meta) {
  const parts = [];
  if (meta && (meta.stars != null && meta.stars !== '')) {
    parts.push(`⭐ ${formatStars(meta.stars)}`);
  }
  if (meta && meta.pushedAt) {
    let when = '';
    try {
      when = new Date(meta.pushedAt).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      when = String(meta.pushedAt);
    }
    if (when) parts.push(`最近推送 ${when}`);
  }
  return parts.join(' · ');
}

/**
 * 拉取仓库书签数据（meta + 可选 README HTML）
 */
async function fetchRepoBookmark(inputUrl, { fetchImpl = fetch } = {}) {
  const { owner, repo, canonicalUrl } = parseGitHubRepoUrl(inputUrl);

  const metaRes = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { fetchImpl });
  await throwIfGitHubError(metaRes, { owner, repo });
  const data = await metaRes.json();

  const defaultBranch = data.default_branch || 'main';
  let readmeHtml = '';
  try {
    const readmeRes = await githubApi(
      `/repos/${encodeURIComponent(data.owner?.login || owner)}/${encodeURIComponent(data.name || repo)}/readme`,
      { accept: 'application/vnd.github.html', fetchImpl },
    );
    if (readmeRes.ok) {
      const html = await readmeRes.text();
      readmeHtml = sanitizeGithubReadmeHtml(html, {
        owner: data.owner?.login || owner,
        repo: data.name || repo,
        defaultBranch,
        description: data.description || '',
        fullName: data.full_name || `${owner}/${repo}`,
      });
    }
  } catch {
    /* README 失败不阻断 */
  }

  return {
    owner: data.owner?.login || owner,
    name: data.name || repo,
    fullName: data.full_name || `${owner}/${repo}`,
    description: data.description || '',
    stars: Number(data.stargazers_count) || 0,
    language: data.language || '',
    topics: Array.isArray(data.topics) ? data.topics : [],
    homepage: data.homepage || '',
    defaultBranch,
    pushedAt: data.pushed_at || data.updated_at || data.created_at || null,
    avatar: data.owner?.avatar_url || '',
    link: data.html_url || canonicalUrl,
    readmeHtml,
  };
}

module.exports = {
  GITHUB_PROJECTS_SOURCE_ID,
  README_MAX_HTML_CHARS,
  README_MAX_TABLE_ROWS,
  README_MAX_TABLES,
  parseGitHubRepoUrl,
  normalizeGitHubRepoUrl,
  fetchRepoBookmark,
  buildRepoBriefHtml,
  buildRepoDisplayTitle,
  buildRepoSummary,
  buildRepoReaderMetaLine,
  formatStars,
  sanitizeGithubReadmeHtml,
  isBadgeImageUrl,
  __test: {
    parseGitHubRepoUrl,
    normalizeGitHubRepoUrl,
    buildRepoBriefHtml,
    buildRepoDisplayTitle,
    buildRepoSummary,
    buildRepoReaderMetaLine,
    formatStars,
    sanitizeGithubReadmeHtml,
    isBadgeImageUrl,
    githubHeaders,
    README_MAX_HTML_CHARS,
    README_MAX_TABLE_ROWS,
    README_MAX_TABLES,
  },
};
