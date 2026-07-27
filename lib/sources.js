// Zen 自用信息源：来自 Web/ 博客书签 + 可抓 RSS
// 完整上游列表已裁剪，避免变成公开门户

const fs = require('fs');
const path = require('path');

const SOURCE_ICON_MANIFEST = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'blog-crawl', 'source-icons.json'), 'utf8'));
  } catch {
    return {};
  }
})();

function sourceIcon(id, fallback = '') {
  return SOURCE_ICON_MANIFEST[id] || fallback;
}

const RSSHUB_INSTANCES = [
  'https://rsshub.rssforever.com',
  'https://rsshub.ktachibana.party',
  'https://rsshub.app',
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const REFRESH_POLICIES = {
  'zen-imported': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'user-submitted': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'github-projects': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'x-likes': { refreshIntervalMs: 30 * MINUTE_MS, refreshPriority: 0.2, refreshCost: 0 },
  'xhs-likes': { refreshIntervalMs: 30 * MINUTE_MS, refreshPriority: 0.2, refreshCost: 0 },
  'bili-watchlater': { refreshIntervalMs: 15 * MINUTE_MS, refreshPriority: 0.2, refreshCost: 0 },
  'xhs-wanyouyinli': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.15, refreshCost: 0 },
  'xhs-luoye': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.15, refreshCost: 0 },
  'xhs-shutiao': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.15, refreshCost: 0 },
  lilianweng: { refreshIntervalMs: 2 * HOUR_MS, refreshPriority: 4, refreshCost: 1 },
  baoyu: { refreshIntervalMs: 1 * HOUR_MS, refreshPriority: 4, refreshCost: 1 },
  karpathy: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  arthurchiao: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  aleksagordic: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  normaluhr: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  shichaoxin: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  sebastianraschka: { refreshIntervalMs: 2 * HOUR_MS, refreshPriority: 4, refreshCost: 1 },
  dwarkesh: { refreshIntervalMs: 6 * HOUR_MS, refreshPriority: 3, refreshCost: 1 },
  maarten: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 2, refreshCost: 1 },
  qingkeai: { refreshIntervalMs: 12 * HOUR_MS, refreshPriority: 2, refreshCost: 1 },
  rlhfbook: { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 1, refreshCost: 1 },
  'zhihu-tianqing': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'zhihu-lemonround': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'zhihu-fafa': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'zhihu-yuanchao': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'zhihu-tongsanpang': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
  'zhihu-haotian': { refreshIntervalMs: 24 * HOUR_MS, refreshPriority: 0.1, refreshCost: 0 },
};

// category: article | news | podcast
// icon: 本地 public/source-icons（避免线上 favicon 代理被 SSRF 拦截）
// 文章分组最上方固定：个人精选 → GitHub 项目 → X 收藏 → 小红书（displayPin 控制默认排序）
const SOURCES = [
  {
    id: 'zen-imported',
    name: '已导入（本地爬取）',
    category: 'article',
    siteUrl: 'http://127.0.0.1:3780',
    icon: sourceIcon('zen-imported', '/source-icons/zen-imported.ico'),
    enabled: false,
    limit: 500,
    feeds: [],
    description: '未知域名导入兜底（默认关闭；有主机映射的源会直接归入对应博客）',
  },
  {
    id: 'user-submitted',
    name: '个人精选',
    category: 'article',
    siteUrl: 'http://127.0.0.1:3780',
    icon: sourceIcon('user-submitted', '/source-icons/user-submitted.svg'),
    enabled: true,
    manual: true,
    displayPin: 1,
    limit: 500,
    feeds: [],
    description: '粘贴任意网页链接，抓取标题与正文后收入本源',
  },
  {
    id: 'github-projects',
    name: 'GitHub 项目',
    category: 'article',
    siteUrl: 'https://github.com',
    icon: sourceIcon('github-projects', '/source-icons/github-projects.svg'),
    enabled: true,
    manual: true,
    contentKind: 'repo',
    displayPin: 2,
    limit: 500,
    feeds: [],
    description: '粘贴 GitHub 仓库链接，收录项目卡片（非文章）',
  },
  {
    id: 'x-likes',
    name: 'X 收藏',
    category: 'article',
    siteUrl: 'https://x.com',
    icon: sourceIcon('x-likes', '/source-icons/x-likes.svg'),
    enabled: true,
    localOnly: true,
    displayPin: 3,
    contentKind: 'social-x',
    limit: 2000,
    feeds: [],
    description: '本地 Typora/X_Likes · 外部爬虫更新后自动入库',
  },
  {
    id: 'xhs-likes',
    name: '小红书收藏',
    category: 'article',
    siteUrl: 'https://www.xiaohongshu.com',
    icon: sourceIcon('xhs-likes', '/source-icons/xhs-likes.png'),
    enabled: true,
    localOnly: true,
    displayPin: 4,
    contentKind: 'social-xhs',
    limit: 2000,
    feeds: [],
    description: '本地 Typora/XHS_Likes · 外部爬虫更新后自动入库；图集左右切换',
  },
  {
    id: 'bili-watchlater',
    name: 'b站收藏',
    category: 'article',
    siteUrl: 'https://www.bilibili.com/watchlater/',
    icon: sourceIcon('bili-watchlater', '/source-icons/bili-watchlater.svg'),
    enabled: true,
    localOnly: true,
    displayPin: 5,
    contentKind: 'social-bili',
    limit: 2000,
    feeds: [],
    description: '从 Zen 已登录 Cookie 同步 B站稍后再看 + 收藏夹；封面为视频封面',
  },
  {
    id: 'xhs-wanyouyinli',
    name: '万有引力AI',
    category: 'article',
    siteUrl: 'https://www.xiaohongshu.com',
    icon: sourceIcon('xhs-wanyouyinli', '/source-icons/xhs-likes.png'),
    enabled: true,
    localOnly: true,
    displayPin: 4,
    contentKind: 'social-xhs',
    limit: 500,
    feeds: [],
    description: '知识库 · 万有引力AI 主页归档（Claude / Agent / Vibe Coding）',
  },
  {
    id: 'xhs-luoye',
    name: '落叶带走秋风',
    category: 'article',
    siteUrl: 'https://www.xiaohongshu.com',
    icon: sourceIcon('xhs-luoye', '/source-icons/xhs-likes.png'),
    enabled: true,
    localOnly: true,
    displayPin: 5,
    contentKind: 'social-xhs',
    limit: 500,
    feeds: [],
    description: '知识库 · 大模型算法面经与研究观察',
  },
  {
    id: 'xhs-shutiao',
    name: '整点薯条',
    category: 'article',
    siteUrl: 'https://www.xiaohongshu.com',
    icon: sourceIcon('xhs-shutiao', '/source-icons/xhs-likes.png'),
    enabled: true,
    localOnly: true,
    displayPin: 6,
    contentKind: 'social-xhs',
    limit: 500,
    feeds: [],
    description: '知识库 · LLM 秋招 / 面试 / RL 笔记',
  },
  {
    id: 'lilianweng',
    name: "Lil'Log",
    category: 'article',
    siteUrl: 'https://lilianweng.github.io/posts/',
    icon: sourceIcon('lilianweng', '/source-icons/lilianweng.ico'),
    enabled: true,
    limit: 30,
    feeds: ['https://lilianweng.github.io/posts/index.xml'],
    description: 'Lilian Weng 深度学习/Agent 笔记',
  },
  {
    id: 'baoyu',
    name: '宝玉的分享',
    category: 'article',
    siteUrl: 'https://baoyu.io/blog',
    icon: sourceIcon('baoyu', '/source-icons/baoyu.ico'),
    enabled: true,
    limit: 30,
    feeds: ['https://baoyu.io/feed.xml', 'https://baoyu.io/blog/feed.xml'],
    description: 'AI / 工程实践中文博客',
  },
  {
    id: 'karpathy',
    name: 'Karpathy Blog',
    category: 'article',
    siteUrl: 'https://karpathy.bearblog.dev/blog/',
    icon: sourceIcon('karpathy', '/source-icons/karpathy.ico'),
    enabled: true,
    limit: 20,
    feeds: ['https://karpathy.bearblog.dev/feed/', 'https://karpathy.bearblog.dev/blog/feed/'],
  },
  {
    id: 'arthurchiao',
    name: "ArthurChiao's Blog",
    category: 'article',
    siteUrl: 'https://arthurchiao.art/articles-zh/',
    icon: sourceIcon('arthurchiao', '/source-icons/arthurchiao.ico'),
    enabled: true,
    limit: 20,
    feeds: ['https://arthurchiao.art/feed.xml'],
  },
  {
    id: 'aleksagordic',
    name: 'Aleksa Gordić',
    category: 'article',
    siteUrl: 'https://www.aleksagordic.com/blog',
    icon: sourceIcon('aleksagordic', '/source-icons/aleksagordic.png'),
    enabled: true,
    limit: 20,
    feeds: ['https://www.aleksagordic.com/feed.xml'],
  },
  {
    id: 'normaluhr',
    name: "Yihua's Blog",
    category: 'article',
    siteUrl: 'https://normaluhr.github.io/',
    icon: sourceIcon('normaluhr', '/source-icons/normaluhr.ico'),
    enabled: true,
    limit: 20,
    feeds: ['https://normaluhr.github.io/feed', 'https://normaluhr.github.io/feed.xml'],
  },
  {
    id: 'shichaoxin',
    name: 'x-jeff blog',
    category: 'article',
    siteUrl: 'https://shichaoxin.com/tags/',
    icon: sourceIcon('shichaoxin', '/source-icons/shichaoxin.ico'),
    enabled: true,
    limit: 20,
    feeds: ['https://shichaoxin.com/feed', 'https://shichaoxin.com/rss.xml'],
  },
  {
    id: 'sebastianraschka',
    name: 'Ahead of AI',
    category: 'article',
    siteUrl: 'https://magazine.sebastianraschka.com/archive',
    icon: sourceIcon('sebastianraschka', '/source-icons/sebastianraschka.png'),
    enabled: true,
    limit: 20,
    feeds: ['https://magazine.sebastianraschka.com/feed'],
  },
  {
    id: 'dwarkesh',
    name: 'Dwarkesh Patel',
    category: 'article',
    siteUrl: 'https://www.dwarkesh.com',
    icon: sourceIcon('dwarkesh', '/source-icons/dwarkesh.jpg'),
    enabled: true,
    limit: 15,
    feeds: ['https://www.dwarkesh.com/feed', 'https://www.dwarkeshpatel.com/feed'],
  },
  {
    id: 'maarten',
    name: 'Maarten Grootendorst',
    category: 'article',
    siteUrl: 'https://newsletter.maartengrootendorst.com',
    icon: sourceIcon('maarten', '/source-icons/maarten.jpg'),
    enabled: true,
    limit: 15,
    feeds: ['https://newsletter.maartengrootendorst.com/feed'],
  },
  {
    id: 'qingkeai',
    name: '青稞社区',
    category: 'article',
    siteUrl: 'https://qingkeai.online',
    icon: sourceIcon('qingkeai', '/source-icons/qingkeai.png'),
    enabled: true,
    limit: 15,
    feeds: ['https://qingkeai.online/atom.xml', 'https://qingkeai.online/rss.xml', 'https://qingkeai.online/feed'],
  },
  {
    id: 'rlhfbook',
    name: 'RLHF Book',
    category: 'article',
    siteUrl: 'https://rlhfbook.com',
    icon: sourceIcon('rlhfbook', '/source-icons/rlhfbook.ico'),
    enabled: true,
    limit: 10,
    feeds: ['https://github.com/natolambert/rlhf-book/releases.atom'],
  },
  {
    id: 'zhihu-tianqing',
    name: '天晴',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/tian-qing-71-69/posts',
    icon: sourceIcon('zhihu-tianqing'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · 天晴；仅保留近三年浏览器导入内容',
  },
  {
    id: 'zhihu-lemonround',
    name: '猛猿',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/lemonround/posts/posts_by_votes',
    icon: sourceIcon('zhihu-lemonround'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · 猛猿；仅保留近三年浏览器导入内容',
  },
  {
    id: 'zhihu-fafa',
    name: '良睦路程序员',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/fa-fa-1-94/posts',
    icon: sourceIcon('zhihu-fafa', '/source-icons/zhihu-tianqing.ico'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · 良睦路程序员；仅保留近三年浏览器导入内容',
  },
  {
    id: 'zhihu-yuanchao',
    name: '好奇的小逸',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/yuan-chao-yi-83/posts',
    icon: sourceIcon('zhihu-yuanchao', '/source-icons/zhihu-tianqing.ico'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · 好奇的小逸；仅保留近三年浏览器导入内容',
  },
  {
    id: 'zhihu-tongsanpang',
    name: '手抓饼熊',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/tongsanpang/posts',
    icon: sourceIcon('zhihu-tongsanpang', '/source-icons/zhihu-tianqing.ico'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · 手抓饼熊；仅保留近三年浏览器导入内容',
  },
  {
    id: 'zhihu-haotian',
    name: 'haotian',
    category: 'article',
    siteUrl: 'https://www.zhihu.com/people/hao-tian-87/posts',
    icon: sourceIcon('zhihu-haotian', '/source-icons/zhihu-tianqing.ico'),
    enabled: true,
    localOnly: true,
    limit: 500,
    feeds: [],
    description: '知乎 · haotian；通过已登录浏览器导出后本地导入全部文章',
  },
];

const BUILTIN_SOURCE_IDS = new Set(SOURCES.map(source => source.id));

function customSourceDefinition(row = {}) {
  return {
    id: String(row.id || '').trim(),
    name: String(row.name || '').trim(),
    category: ['article', 'news', 'podcast'].includes(row.category) ? row.category : 'article',
    siteUrl: String(row.siteUrl || '').trim(),
    enabled: row.enabled !== false,
    custom: true,
    limit: 100,
    feeds: [String(row.feedUrl || '').trim()].filter(Boolean),
    description: String(row.description || '').trim() || '自定义 RSS / Atom 订阅',
    refreshIntervalMs: Number(row.refreshIntervalMs) || 60 * MINUTE_MS,
    refreshPriority: 1.2,
    refreshCost: 1,
  };
}

function upsertCustomSource(row) {
  const source = customSourceDefinition(row);
  if (!source.id || !source.name || !source.siteUrl || !source.feeds.length) {
    throw new Error('custom source is incomplete');
  }
  if (BUILTIN_SOURCE_IDS.has(source.id)) {
    const error = new Error('custom source id conflicts with a built-in source');
    error.statusCode = 409;
    throw error;
  }
  const existing = SOURCES.find(item => item.id === source.id);
  if (existing) Object.assign(existing, source);
  else SOURCES.push(source);
  return existing || source;
}

function removeCustomSource(id) {
  const index = SOURCES.findIndex(source => source.id === id && source.custom);
  if (index < 0) return false;
  SOURCES.splice(index, 1);
  return true;
}

function loadCustomSources(rows = []) {
  for (let index = SOURCES.length - 1; index >= 0; index -= 1) {
    if (SOURCES[index] && SOURCES[index].custom) SOURCES.splice(index, 1);
  }
  for (const row of rows || []) upsertCustomSource(row);
  return SOURCES;
}

module.exports = {
  SOURCES,
  RSSHUB_INSTANCES,
  REFRESH_POLICIES,
  BUILTIN_SOURCE_IDS,
  loadCustomSources,
  removeCustomSource,
  upsertCustomSource,
};
