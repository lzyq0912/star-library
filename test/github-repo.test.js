const { test } = require('node:test');
const assert = require('node:assert/strict');
const githubRepo = require('../lib/github-repo');

const {
  parseGitHubRepoUrl,
  normalizeGitHubRepoUrl,
  buildRepoBriefHtml,
  buildRepoDisplayTitle,
  buildRepoSummary,
  formatStars,
  sanitizeGithubReadmeHtml,
} = githubRepo.__test;

test('parseGitHubRepoUrl normalizes tree/blob/issues/.git/www and bare owner/repo', () => {
  const cases = [
    ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
    ['https://www.github.com/owner/repo/', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo/tree/main/src', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo/blob/main/README.md', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo/issues/12', 'https://github.com/owner/repo'],
    ['owner/repo', 'https://github.com/owner/repo'],
    ['git@github.com:owner/repo.git', 'https://github.com/owner/repo'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeGitHubRepoUrl(input), expected, input);
  }
});

test('parseGitHubRepoUrl rejects non-repo GitHub URLs', () => {
  for (const bad of [
    'https://gist.github.com/x/y',
    'https://owner.github.io/page',
    'https://github.com/explore',
    'https://github.com/settings/profile',
    'https://example.com/owner/repo',
    'https://github.com/onlyone',
  ]) {
    assert.throws(() => parseGitHubRepoUrl(bad), /GitHub|仓库/, bad);
  }
});

test('buildRepoBriefHtml is README-only without 简介 block', () => {
  const html = buildRepoBriefHtml({
    owner: 'thinkwee',
    name: 'AgentsMeetRL',
    fullName: 'thinkwee/AgentsMeetRL',
    description: 'Awesome List for Agentic RL',
    stars: 1280,
    language: 'Python',
    topics: ['rl', 'agents'],
    homepage: 'https://example.com',
    defaultBranch: 'main',
    pushedAt: '2026-07-01T00:00:00Z',
    link: 'https://github.com/thinkwee/AgentsMeetRL',
    readmeHtml: '<p>Hello <a href="docs/x.md">docs</a></p>',
  }, { note: '值得跟' });
  assert.match(html, /class="repo-readme"/);
  assert.match(html, /值得跟/);
  assert.match(html, /repo-meta:/);
  assert.doesNotMatch(html, />简介</);
  assert.doesNotMatch(html, /repo-desc/);
  assert.doesNotMatch(html, /项目信息/);
  assert.doesNotMatch(html, /repo-meta-list/);
  assert.doesNotMatch(html, />GitHub</);
  assert.doesNotMatch(html, /extractReadableContent/);
});

test('buildRepoDisplayTitle is repo name only without owner', () => {
  assert.equal(buildRepoDisplayTitle({ name: 'AgentsMeetRL', fullName: 'thinkwee/AgentsMeetRL', owner: 'thinkwee' }), 'AgentsMeetRL');
  assert.equal(buildRepoDisplayTitle({ fullName: 'virgiliojr94/book-to-skill' }), 'book-to-skill');
});

test('buildRepoSummary and formatStars are list-friendly', () => {
  assert.equal(formatStars(1280), '1.3k');
  assert.equal(formatStars(12), '12');
  const summary = buildRepoSummary({
    stars: 1280,
    language: 'Python',
    description: 'Awesome List for Agentic RL',
  });
  assert.match(summary, /⭐ 1\.3k/);
  assert.doesNotMatch(summary, /Python/);
  assert.match(summary, /Awesome List/);
});

test('sanitizeGithubReadmeHtml strips scripts and absolutizes relative links', () => {
  const out = sanitizeGithubReadmeHtml(
    '<p>Hi<script>alert(1)</script></p><a href="docs/a.md">a</a><img src="img.png">',
    { owner: 'o', repo: 'r', defaultBranch: 'main' },
  );
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /https:\/\/github\.com\/o\/r\/blob\/main\/docs\/a\.md/);
  assert.match(out, /https:\/\/raw\.githubusercontent\.com\/o\/r\/main\/img\.png/);
});

test('sanitizeGithubReadmeHtml rejects javascript: and data: href', () => {
  // 嵌在实质段落里；避免 links≥4 + install/usage 等被 isChromeOnlyBlock 整段丢掉
  const out = sanitizeGithubReadmeHtml(
    [
      '<p>This paragraph documents how the library loads configuration files ',
      'and keeps enough ordinary prose around untrusted anchors so sanitizer ',
      'chrome filters do not discard the whole block: ',
      '<a href="javascript:alert(1)">xss</a> and ',
      '<a href="data:text/html,hi">data</a> should lose href while ',
      '<a href="https://example.com/ok">safe</a> remains.</p>',
    ].join(''),
    { owner: 'o', repo: 'r', defaultBranch: 'main' },
  );
  assert.ok(out.length > 0, 'expected non-empty sanitized html');
  assert.doesNotMatch(out, /javascript:/i);
  assert.doesNotMatch(out, /href=["']data:/i);
  assert.match(out, /href="https:\/\/example\.com\/ok"/);
  assert.match(out, />xss</);
});

test('sanitizeGithubReadmeHtml drops shields badges and caps huge awesome-list tables', () => {
  const rows = Array.from({ length: 60 }, (_, i) => (
    `<tr><td><a href="https://github.com/org/repo${i}">repo${i}</a></td><td>desc ${i}</td>`
    + `<td><a href="https://img.shields.io/github/stars/org/repo${i}"><img src="https://img.shields.io/github/stars/org/repo${i}" alt="stars"></a></td></tr>`
  )).join('');
  const html = [
    '<p><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></p>',
    '<h2>Papers</h2>',
    `<table class="foo" style="width:100%">${rows}</table>`,
    `<table>${rows}</table>`,
    '<p>Footer note with enough text.</p>',
  ].join('');
  const out = sanitizeGithubReadmeHtml(html, { owner: 'o', repo: 'r', defaultBranch: 'main' });
  assert.doesNotMatch(out, /shields\.io/);
  assert.doesNotMatch(out, /\sclass=/);
  assert.doesNotMatch(out, /\sstyle=/);
  const trCount = (out.match(/<tr\b/gi) || []).length;
  // 两表 × 上限行（静默截断，无提示行）
  const maxTr = githubRepo.__test.README_MAX_TABLE_ROWS * 2;
  assert.ok(trCount <= maxTr, `trCount=${trCount} max=${maxTr}`);
  assert.doesNotMatch(out, /已省略|已截断|完整列表见/);
  assert.ok(out.length < html.length / 2, `out=${out.length} html=${html.length}`);
});

test('sanitizeGithubReadmeHtml keeps first rows and drops extra tables silently', () => {
  const mkTable = (id, n) => {
    const head = '<tr><th>Repo</th><th>Note</th></tr>';
    const body = Array.from({ length: n }, (_, i) => `<tr><td>${id}-r${i}</td><td>x</td></tr>`).join('');
    return `<table>${head}${body}</table>`;
  };
  const maxTables = githubRepo.__test.README_MAX_TABLES;
  const maxRows = githubRepo.__test.README_MAX_TABLE_ROWS;
  const tables = Array.from({ length: maxTables + 3 }, (_, i) => mkTable(`t${i}`, maxRows + 10)).join('');
  const out = sanitizeGithubReadmeHtml(`<h2>List</h2>${tables}<p>tail</p>`, {
    owner: 'o', repo: 'r', defaultBranch: 'main',
  });
  assert.doesNotMatch(out, /其余表格已省略|表格过长|完整列表见|README 过长/);
  assert.ok((out.match(/<table\b/gi) || []).length <= maxTables);
  // 第 0 表首行在、末尾超额行不在
  assert.match(out, /t0-r0/);
  assert.doesNotMatch(out, new RegExp(`t0-r${maxRows}`));
  // 超额表整表不在
  assert.doesNotMatch(out, new RegExp(`t${maxTables}-r0`));
});

test('sanitizeGithubReadmeHtml drops collapsible technical-details tables (AgentsMeetRL style)', () => {
  const main = '<table><tr><th>Github Repo</th><th>Date</th></tr><tr><td>AgentJet</td><td>2026.6</td></tr></table>';
  const tech = '<table><tr><th>Github Repo</th><th>RL Algorithm</th><th>Reward Type</th></tr>'
    + '<tr><td>AgentJet</td><td>GRPO</td><td>Rule-Based</td></tr></table>';
  const html = [
    '<h2>Base Framework</h2>',
    main,
    `<details><summary>📋 Click to view technical details</summary><markdown-accessiblity-table>${tech}</markdown-accessiblity-table></details>`,
    '<h2>Search</h2>',
    main,
    `<details><summary>Click to view technical details</summary>${tech}</details>`,
    '<p>Footer.</p>',
  ].join('');
  const out = sanitizeGithubReadmeHtml(html, { owner: 'thinkwee', repo: 'AgentsMeetRL', defaultBranch: 'main' });
  assert.doesNotMatch(out, /technical details/i);
  assert.doesNotMatch(out, /RL Algorithm/);
  assert.doesNotMatch(out, /<details/i);
  assert.doesNotMatch(out, /markdown-accessiblity-table/i);
  assert.match(out, /AgentJet/);
  assert.match(out, /Base Framework/);
  // 只剩主表，不该再有 8 列细节表
  assert.equal((out.match(/<table\b/gi) || []).length, 2);
});

test('sanitizeGithubReadmeHtml strips book-to-skill style chrome and keeps body', () => {
  const html = [
    '<h1>book-to-skill</h1>',
    '<p><img src="https://raw.githubusercontent.com/x/y/logo.png" alt="book-to-skill logo"></p>',
    '<p>Turn any technical book PDF into a Claude Code skill — ready to study, reference, and use while you work.</p>',
    '<p><a href="https://img.shields.io/badge/license-MIT-blue"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>',
    '<a href="#">Latest release</a> · <a href="#">Sponsor</a></p>',
    '<p>🏆 #10 Python Repository of the Day on Trendshift</p>',
    '<p><a href="#why">Why</a> · <a href="#usage">Usage</a> · <a href="#faq">FAQ</a> · <a href="#install">Install</a></p>',
    '<h2>How it works, in 3 steps</h2>',
    '<p>Point it at a file, folder, or glob — real content here with enough English prose to keep.</p>',
  ].join('');
  const out = sanitizeGithubReadmeHtml(html, {
    owner: 'virgiliojr94',
    repo: 'book-to-skill',
    defaultBranch: 'master',
    description: 'Turn any technical book PDF into a Claude Code skill — ready to study, reference, and use while you work.',
    fullName: 'virgiliojr94/book-to-skill',
  });
  assert.doesNotMatch(out, /<h1/i);
  assert.doesNotMatch(out, /logo\.png|shields\.io|Trendshift|Latest release|Sponsor/i);
  assert.doesNotMatch(out, /Why ·|FAQ ·|Install/i);
  assert.match(out, /How it works|Point it at a file/i);
  assert.match(out, /real content here/);
});
