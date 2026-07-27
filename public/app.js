/* QMReader front-end */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// localStorage throws SecurityError inside sandboxed iframes — fall back to in-memory
const storage = (() => {
  try {
    const t = window.localStorage;
    t.getItem('__probe__');
    return t;
  } catch {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();

function readJson(key, fallback) {
  try { return JSON.parse(storage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
}

function readStoredNumber(key) {
  const n = parseInt(storage.getItem(key) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- 共享性能工具 ---------- */

/** 尾随防抖：高频输入（搜索框、窗口 resize）合并为最后一次调用 */
function debounce(fn, wait = 200) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
  }
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}

/** rAF 节流：滚动/拖拽等每帧至多执行一次，自动合并同一帧内的重复触发 */
function rafThrottle(fn) {
  let raf = 0;
  let pendingArgs = null;
  function throttled(...args) {
    pendingArgs = args;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn.apply(this, pendingArgs);
      pendingArgs = null;
    });
  }
  throttled.cancel = () => { cancelAnimationFrame(raf); raf = 0; pendingArgs = null; };
  return throttled;
}

const CATEGORY_LABELS = { article: '文章', news: '资讯', podcast: '播客' };
const READER_TABS = ['original', 'translation'];
const READER_NAV_TABS = ['original'];
const DEFAULT_READER_OPEN_TAB = 'original';
const READER_OPEN_TABS = ['original'];

/** 个人唯一模式，无登录 */
function isZenPersonalMode() {
  return true;
}
const ASSET_FILTER_TYPES = ['translation'];
const PROFILE_TAB_TYPES = ['translation'];
const DASHBOARD_TABS = ['profile', 'ai', 'contributions'];
const ASSET_FOCUS_LABELS = { translation: '中文翻译' };
const ANNOTATION_SURFACE_LABELS = { original: '原文', rewrite: '中文改写', translation: '中文翻译' };
const ANNOTATION_SURFACES = Object.keys(ANNOTATION_SURFACE_LABELS);
const ENTRY_PANE_MIN_WIDTH = 260;
const ENTRY_PANE_MAX_WIDTH = 620;
const CONTEXT_PANE_MIN_WIDTH = 260;
const CONTEXT_PANE_MAX_WIDTH = 620;
const READER_PANE_MIN_WIDTH = 700;
const SOURCE_REFRESH_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const SOURCE_ORDER_KEY = 'qm_source_order';
const COURSE_ORDER_KEY = 'qm_syllabus_course_order';
const SOURCE_NAMES_KEY = 'qm_source_names';
const SOURCE_TREE_OPEN_KEY = 'qm_source_tree_open';
/** 每篇阅读语言偏好：{ [entryId]: true=简中视图, false=原文 }；有服务端译文且未显式 false 时默认简中 */
const READER_ZH_VIEW_KEY = 'qm_entry_zh_view';
/** 侧栏父子树分组：小红书博主 / 知乎 */
const SOURCE_TREE_GROUPS = [
  {
    id: 'xhs-bloggers',
    name: '小红书博主',
    /** 收藏流 xhs-likes 保持顶层；其余 xhs-* 归入本文件夹 */
    test: (s) => /^xhs-/.test(String(s && s.id || '')) && s.id !== 'xhs-likes',
    iconFallback: '/source-icons/xhs-likes.png',
  },
  {
    id: 'zhihu',
    name: '知乎',
    test: (s) => /^zhihu-/.test(String(s && s.id || '')),
    iconFallback: '/source-icons/zhihu-tianqing.ico',
  },
];
/** 历史误用 URL slug 的知乎展示名，加载时清掉，避免覆盖服务端正确昵称 */
const OBSOLETE_SOURCE_NAMES = {
  'zhihu-fafa': new Set(['发发', 'fa-fa', 'fa-fa-1-94']),
  'zhihu-yuanchao': new Set(['袁超', 'yuan-chao', 'yuan-chao-yi-83']),
};
const COMMENT_TEMPLATES = {
  insight: '观点：',
  question: '疑问：',
  action: '行动：',
  quote: '引用：',
  source: '资料：',
};
const COMMENT_TEMPLATE_LABELS = {
  insight: '观点',
  question: '疑问',
  action: '行动',
  quote: '引用',
  source: '资料',
};
const COMMENT_SORTS = ['helpful', 'latest'];
const DEFAULT_REWRITE_MODEL = 'deepseek-v4-flash';
const READER_PREF_DEFAULTS = {
  fontSize: 16.5,
  lineHeight: 1.88,
  measure: 78,
  font: 'default',
};
const READER_FONTS = {
  default: '默认混排',
  pingfang: '苹方黑体',
  song: '宋体',
  kai: '楷体',
  serif: '衬线',
  mono: '等宽',
  hei: '系统黑体',
};
const AI_READING_TASKS = [
  {
    group: '理解',
    items: [
      ['总结要点', '用 5 条 bullet 总结这篇文章最值得关注的观点。'],
      ['结构拆解', '把这篇文章的论证结构拆成：问题、证据、结论、隐含假设。'],
    ],
  },
  {
    group: '核查',
    items: [
      ['事实清单', '把文章里的关键事实、数据、案例列出来，并逐条说明它们分别证明了什么。'],
      ['待验证点', '这篇文章有哪些值得怀疑或需要验证的地方？按重要性排序。'],
    ],
  },
  {
    group: '反驳',
    items: [
      ['反方观点', '站在反方立场，指出这篇文章最可能被挑战的 5 个点。'],
      ['前提测试', '这篇文章的论证依赖哪些前提？哪些前提一旦不成立，结论就会变弱？'],
    ],
  },
  {
    group: '行动',
    items: [
      ['行动建议', '如果我是 AI 产品创作者，读完这篇文章下一步可以做什么？'],
      ['产品机会', '这篇文章里有哪些可以变成产品、工具或自动化流程的机会？'],
    ],
  },
  {
    group: '写作',
    items: [
      ['分享文案', '帮我写一段适合发到 X / 即刻的中文分享文案，短一点但有观点。'],
      ['选题角度', '如果向阳乔木要基于这篇文章写一篇中文内容，最有传播潜力的切入角度有哪些？给 3 个。'],
    ],
  },
  {
    group: '延伸',
    items: [
      ['延伸阅读', '基于这篇文章，给我 5 个值得继续追问或延伸阅读的方向。'],
      ['关联概念', '列出这篇文章背后的关键概念、人物、产品或论文，并说明为什么相关。'],
    ],
  },
];
const DEFAULT_AGENT_PROMPTS = AI_READING_TASKS
  .flatMap(group => group.items.map(([label, prompt]) => ({ label, prompt })))
  .slice(0, 8);
const AGENT_PROMPT_LIMIT = 24;
const PERSONA_AGENT_VERSION = 'persona-qmreader-v1';
const ENTRY_RENDER_BATCH_SIZE = 100;
/** 切源首屏窗口（虚拟列表 overscan 前的目标可见数） */
const ENTRY_RENDER_FAST_BATCH = 36;
/** 虚拟列表：卡片高度估计（与 CSS contain-intrinsic 对齐） */
const LIST_CARD_ESTIMATE_PX = 110;
const LIST_CARD_MEDIA_ESTIMATE_PX = 132;
/** 虚拟列表：上下 overscan 条数 + 单次最多驻留 DOM */
const LIST_OVERSCAN = 10;
const LIST_WINDOW_MAX = 48;
const LIST_SUMMARY_MAX = 160;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const LUCIDE_DEFAULT_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  focusable: 'false',
  'aria-hidden': 'true',
};
const ICON_FALLBACK_GLYPHS = {
  'panel-left-close': '‹',
  'panel-left-open': '›',
  'panel-right-close': '›',
  'panel-right-open': '‹',
  'arrow-left': '←',
  'arrow-right': '→',
  x: '×',
};
const AI_PROVIDER_CATEGORIES = ['海外大模型', '海外聚合', '国内大模型', '国内聚合'];
const AI_PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: DEFAULT_REWRITE_MODEL,
    quickModels: [DEFAULT_REWRITE_MODEL],
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    description: 'DeepSeek 官方接口',
    recommended: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    quickModels: ['anthropic/claude-sonnet-4', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    description: '多模型聚合平台，模型最全',
    recommended: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    quickModels: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    description: 'OpenAI 官方接口',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.5-flash-lite',
    quickModels: [
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
    ],
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    description: 'Google AI Studio 官方 Gemini（OpenAI 兼容端点）',
    recommended: true,
  },
  {
    id: 'codex',
    name: 'Codex / aigocode',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.aigocode.app',
    defaultModel: 'codex-auto-review',
    quickModels: ['codex-auto-review', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'],
    apiKeyUrl: 'https://api.aigocode.app',
    description: 'aigocode 的 OpenAI 兼容接口，会自动使用 /v1/chat/completions。',
    recommended: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic / Claude',
    providerType: 'anthropic_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.aigocode.app',
    defaultModel: 'claude-sonnet-4-6',
    quickModels: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8'],
    apiKeyUrl: 'https://api.aigocode.app',
    description: 'Anthropic Messages 兼容接口，会自动使用 /v1/messages。',
    recommended: true,
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4-0709',
    quickModels: ['grok-4-0709', 'grok-3-mini'],
    apiKeyUrl: 'https://console.x.ai/team/api-keys',
    description: 'xAI 官方 Grok',
  },
  {
    id: 'groq',
    name: 'Groq',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    quickModels: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'gemma2-9b-it'],
    apiKeyUrl: 'https://console.groq.com/keys',
    description: '高吞吐低延迟',
  },
  {
    id: 'together',
    name: 'Together',
    providerType: 'openai_compatible',
    category: '海外聚合',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'deepseek-ai/DeepSeek-R1-0528',
    quickModels: ['deepseek-ai/DeepSeek-R1-0528', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    description: '开源模型聚合',
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    quickModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    description: '月之暗面 Kimi',
  },
  {
    id: 'zhipu',
    name: '智谱',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    quickModels: ['glm-4-plus', 'glm-4-flash'],
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    description: '智谱 GLM 系列',
  },
  {
    id: 'qwen',
    name: '阿里百炼',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    quickModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    description: '通义千问',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    providerType: 'openai_compatible',
    category: '国内聚合',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    quickModels: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    description: '国产聚合平台',
    recommended: true,
  },
  {
    id: 'doubao',
    name: '火山方舟',
    providerType: 'openai_compatible',
    category: '国内大模型',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'ep-20250616135538-zdz4b',
    quickModels: ['ep-20250616135538-zdz4b'],
    apiKeyUrl: 'https://www.volcengine.com/experience/ark',
    description: '豆包 / 火山引擎',
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    providerType: 'openai_compatible',
    category: '国内聚合',
    baseUrl: 'https://aihubmix.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    quickModels: ['claude-sonnet-4-20250514', 'o3-mini', 'gemini-2.5-pro-search'],
    apiKeyUrl: 'https://aihubmix.com/token',
    description: '国内聚合平台',
  },
  {
    id: 'workers_ai',
    name: 'Cloudflare Workers AI',
    providerType: 'openai_compatible',
    category: '海外大模型',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    quickModels: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b'],
    apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    description: 'Cloudflare 官方 Workers AI，Base URL 里的 <ACCOUNT_ID> 需替换为你的账号 ID。',
  },
];
const AI_PROVIDER_MAP = Object.fromEntries(AI_PROVIDER_PRESETS.map(preset => [preset.id, preset]));
const DEFAULT_AI_PRESET_ID = 'deepseek';

function createId(prefix) {
  const random = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}

function attrHtml(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => ` ${name}="${escapeHtml(value === true ? name : value)}"`)
    .join('');
}

function lucideNodeHtml(node) {
  if (!Array.isArray(node) || !node.length) return '';
  const [tag, attrs = {}, children = []] = node;
  const childHtml = Array.isArray(children) ? children.map(lucideNodeHtml).join('') : '';
  return `<${tag}${attrHtml(attrs)}>${childHtml}</${tag}>`;
}

function lucideIcon(name, { className = 'app-icon', title = '', attrs = {} } = {}) {
  const nodes = window.QM_LUCIDE_ICONS && window.QM_LUCIDE_ICONS[name];
  if (!nodes) return '';
  const svgAttrs = { ...LUCIDE_DEFAULT_ATTRS, class: className, ...attrs };
  const titleHtml = title ? `<title>${escapeHtml(title)}</title>` : '';
  return `<svg${attrHtml(svgAttrs)}>${titleHtml}${nodes.map(lucideNodeHtml).join('')}</svg>`;
}

function fallbackIcon(name, { className = 'app-icon' } = {}) {
  const glyph = ICON_FALLBACK_GLYPHS[name] || '·';
  return `<span class="${escapeHtml(`${className} app-icon-fallback`)}" aria-hidden="true">${escapeHtml(glyph)}</span>`;
}

function iconMarkup(name, options = {}) {
  return lucideIcon(name, options) || fallbackIcon(name, options);
}

function iconButtonLabel(icon, label = '', { className = 'app-icon', labelClass = 'button-label' } = {}) {
  return `${iconMarkup(icon, { className })}${label ? `<span class="${labelClass}">${escapeHtml(label)}</span>` : ''}`;
}

function iconSlotFor(el) {
  if (!el) return null;
  if (el.matches && el.matches('[data-qm-icon]')) return el;
  return el.querySelector ? el.querySelector('[data-qm-icon]') : null;
}

function setElementIcon(el, icon, options = {}) {
  if (!el) return;
  const slot = iconSlotFor(el);
  const html = iconMarkup(icon, options);
  if (slot) {
    slot.dataset.qmIcon = icon;
    if (options.className) slot.dataset.qmIconClass = options.className;
    slot.innerHTML = html;
    return;
  }
  el.innerHTML = html;
}

function setButtonIconLabel(el, icon, label, options = {}) {
  if (!el) return;
  el.innerHTML = iconButtonLabel(icon, label, options);
}

function hydrateLucideIcons(root = document) {
  root.querySelectorAll('[data-qm-icon]').forEach(slot => {
    const icon = slot.dataset.qmIcon;
    const className = slot.dataset.qmIconClass || 'app-icon';
    slot.innerHTML = iconMarkup(icon, { className });
  });
}

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    // 只填域名时自动补 /v1（OpenAI 兼容 / New API / 多数国内网关）
    const path = url.pathname.replace(/\/+$/, '');
    if (!path || path === '/') return `${url.origin}/v1`;
  } catch {
    /* keep raw */
  }
  return raw;
}

function normalizeReaderTab(tab) {
  return READER_TABS.includes(tab) ? tab : 'original';
}

function normalizeDefaultReaderTab(tab) {
  return READER_OPEN_TABS.includes(tab) ? tab : DEFAULT_READER_OPEN_TAB;
}

function currentDefaultReaderTab() {
  return normalizeDefaultReaderTab((state.me && state.me.defaultReaderTab) || state.defaultReaderTab);
}

function normalizeReaderOpenTab(tab) {
  return tab === undefined || tab === null || tab === ''
    ? currentDefaultReaderTab()
    : normalizeReaderTab(tab);
}

function setCurrentUser(user, { resetProfileDraft = true } = {}) {
  state.me = user || null;
  state.defaultReaderTab = normalizeDefaultReaderTab(state.me && state.me.defaultReaderTab);
  if (resetProfileDraft) state.profileDefaultReaderTabDraft = state.defaultReaderTab;
}

function activeSourceForEntry(entry = state.activeEntry) {
  return entry ? sourceById(entry.sourceId) : null;
}

function isPaperEntry(entry = state.activeEntry) {
  const source = activeSourceForEntry(entry);
  return Boolean(entry && (entry.sourceId === 'huggingface' || source?.contentKind === 'paper'));
}

function rewriteUiCopy(entry = state.activeEntry) {
  if (isPaperEntry(entry)) {
    return {
      tab: '论文解读',
      section: '论文解读',
      asset: '论文解读',
      action: '生成解读',
      generating: '解读中…',
      stale: '更新解读',
      redo: '重写解读',
      empty: '这篇论文还没有 AI 解读。',
      copyTitle: '复制论文解读',
      copied: '论文解读已复制',
      generateTitle: '生成乔木风格论文解读',
      updateTitle: '更新乔木风格论文解读',
      redoTitle: '重新生成乔木风格论文解读',
      saved: '论文解读已保存',
      cached: '已显示缓存解读',
      fetched: '已获取论文页面并保存解读',
      failedPrefix: '解读失败: ',
      railIcon: 'file-search',
    };
  }
  return {
    tab: '中文改写',
    section: '中文改写',
    asset: '中文改写',
    action: '生成',
    generating: '改写中…',
    stale: '更新',
    redo: '重写',
    empty: '这篇文章还没有中文改写。',
    copyTitle: '复制中文改写',
    copied: '重写已复制',
    generateTitle: '生成中文改写',
    updateTitle: '更新中文改写',
    redoTitle: '重新生成中文改写',
    saved: '中文改写已保存',
    cached: '已显示缓存重写',
    fetched: '已获取原文并保存中文改写',
    failedPrefix: '重写失败: ',
    railIcon: 'sparkles',
  };
}

function updateRewriteUiLabels(entry = state.activeEntry) {
  const copy = rewriteUiCopy(entry);
  const tab = $('.reader-tab[data-tab="rewrite"]');
  if (tab) tab.textContent = copy.tab;
  const section = $('#rewrite-section-label');
  if (section) section.textContent = copy.section;
  const emptyText = $('#rewrite-empty p');
  if (emptyText) emptyText.textContent = copy.empty;
  const copyBtn = $('#rewrite-copy');
  if (copyBtn) {
    copyBtn.title = copy.copyTitle;
    copyBtn.setAttribute('aria-label', copy.copyTitle);
  }
  const rail = $('#reader-rail-rewrite');
  if (rail) {
    rail.title = copy.section;
    rail.setAttribute('aria-label', copy.section);
    const icon = rail.querySelector('.reader-signal-icon');
    if (icon) setElementIcon(icon, copy.railIcon);
  }
}

function clampTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(2, n));
}

function clampMaxTokens(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  const n = Number(digits || 2000);
  if (!Number.isFinite(n) || n <= 0) return 2000;
  return Math.max(1, Math.min(32768, Math.floor(n)));
}

function maskApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function presetById(id) {
  return AI_PROVIDER_MAP[id] || AI_PROVIDER_MAP[DEFAULT_AI_PRESET_ID];
}

function createProfileFromPreset(presetId = DEFAULT_AI_PRESET_ID, overrides = {}) {
  const preset = presetById(presetId);
  const now = Date.now();
  return {
    id: createId('ai'),
    name: preset.name,
    provider: preset.id,
    providerName: preset.name,
    providerType: preset.providerType,
    providerCategory: preset.category,
    apiKeyUrl: preset.apiKeyUrl || '',
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    temperature: 0.7,
    maxTokens: 2000,
    apiKey: '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createCustomProfile(overrides = {}) {
  const now = Date.now();
  return {
    id: createId('ai'),
    name: '自定义模型',
    provider: 'custom',
    providerName: '自定义',
    providerType: 'openai_compatible',
    providerCategory: '',
    apiKeyUrl: '',
    baseUrl: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2000,
    apiKey: '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function normalizeProfile(raw, index = 0) {
  const provider = String(raw && raw.provider || DEFAULT_AI_PRESET_ID).trim() || DEFAULT_AI_PRESET_ID;
  const preset = AI_PROVIDER_MAP[provider];
  const hasDefaultFlag = raw && (Object.prototype.hasOwnProperty.call(raw, 'isDefault') || Object.prototype.hasOwnProperty.call(raw, 'is_default'));
  return {
    id: String(raw && raw.id || createId('ai')),
    name: String(raw && raw.name || (preset ? preset.name : '自定义模型')).trim(),
    provider,
    providerName: String(raw && (raw.providerName || raw.provider_name) || (preset ? preset.name : provider)).trim(),
    providerType: String(raw && (raw.providerType || raw.provider_type) || (preset ? preset.providerType : 'openai_compatible')).trim(),
    providerCategory: String(raw && (raw.providerCategory || raw.provider_category) || (preset ? preset.category : '')).trim(),
    apiKeyUrl: String(raw && (raw.apiKeyUrl || raw.api_key_url) || (preset ? preset.apiKeyUrl || '' : '')).trim(),
    baseUrl: normalizeBaseUrl(raw && (raw.baseUrl || raw.base_url) || (preset ? preset.baseUrl : '')),
    model: String(raw && raw.model || (preset ? preset.defaultModel : '')).trim(),
    temperature: clampTemperature(raw && raw.temperature),
    maxTokens: clampMaxTokens(raw && (raw.maxTokens || raw.max_tokens)),
    apiKey: String(raw && (raw.apiKey || raw.api_key) || '').trim(),
    isDefault: hasDefaultFlag ? Boolean(raw.isDefault || raw.is_default) : index === 0,
    createdAt: Number(raw && raw.createdAt) || Date.now(),
    updatedAt: Number(raw && raw.updatedAt) || Date.now(),
  };
}

function normalizeHistory(raw) {
  const items = Array.isArray(raw) ? raw : [];
  const map = new Map();
  for (const item of items) {
    const entryId = String((item && (item.entryId || item.id)) || item || '').trim();
    if (!entryId) continue;
    const viewedAt = Number(item && (item.viewedAt || item.at)) || Date.now();
    map.set(entryId, viewedAt);
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1000));
}

function historyEntriesForStorage(map) {
  return [...(map || new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1000)
    .map(([entryId, viewedAt]) => ({ entryId, viewedAt }));
}

const state = {
  sources: [],
  /** sourceId → source 缓存 */
  sourceMap: new Map(),
  /** 全量条目目录（切源本地 filter，避免每次网络 reload） */
  allEntries: [],
  /** sourceId → entries[] 预分组，O(1) 切源 */
  entriesBySource: new Map(),
  /** category → entries[] */
  entriesByCategory: new Map(),
  /** entryId → entry O(1) 查找/patch */
  entryById: new Map(),
  /** 预计算热门 top 列表 */
  hotEntriesCached: [],
  sourceCountMap: new Map(),
  sourceUnreadMap: new Map(),
  hotCountCached: 0,
  catalogIndexedAt: 0,
  /** 打开文章代数，取消过期正文渲染 */
  openGen: 0,
  entries: [],
  entryRenderLimit: ENTRY_RENDER_BATCH_SIZE,
  /** 虚拟列表窗口 [start, end) 与 spacer */
  listWindowStart: 0,
  listWindowEnd: 0,
  listVirtualEnabled: true,
  listScrollRaf: 0,
  entriesFetchGen: 0,
  entriesLoadedAt: 0,
  /** rAF 合并连点 paint */
  paintRaf: 0,
  paintPending: null,
  paintGen: 0,
  sidebarBuilt: false,
  listDelegated: false,
  listVirtualBound: false,
  contributors: [],
  adminSubmissionUsers: [],
  adminSubmissionRequests: [],
  adminSubmissionRequestsLoaded: false,
  adminSubmissionQuery: '',
  adminSelectedSubmissionUserId: '',
  adminSubmissionDetail: null,
  adminSubmissionUsersLoaded: false,
  adminSubmissionLoading: false,
  view: 'all',            // 默认最新（all）；all | hot | unread | starred | history | assets | contributors
  filterSource: null,
  filterCategory: null,
  assetFilter: null,
  assetSort: 'latest',
  contributorSort: 'latest',
  homeTab: storage.getItem('qm_home_tab') === 'assets' ? 'assets' : 'entries',
  q: '',
  refreshing: false,
  refreshProgress: { done: 0, total: 0 },
  sourceRefreshStatusTimer: null,
  autoRewrite: { running: false, last: null },
  activeEntry: null,
  /** 本会话已从列表 drop 的 entryId（取消稍后再看等）；merge/load 不得复活 */
  localDroppedEntryIds: new Set(),
  biliCancelMergeGen: 0,
  biliCancelMergeTimer: null,
  guestRead: new Set(readJson('fr_read', '[]')),
  guestStarred: new Set(readJson('fr_starred', '[]')),
  guestHistory: normalizeHistory(readJson('qm_history', '[]')),
  read: new Set(readJson('fr_read', '[]')),
  starred: new Set(readJson('fr_starred', '[]')),
  ratings: readJson('qm_ratings', '{}'),
  ratingFilter: 0,
  history: normalizeHistory(readJson('qm_history', '[]')),
  agentMessages: [],
  comments: [],
  annotations: [],
  annotationDraft: null,
  annotationBusy: false,
  activeAnnotationId: '',
  annotationFilter: storage.getItem('qm_annotation_filter') || 'all',
  annotationOnlyDiscussed: storage.getItem('qm_annotation_only_discussed') === '1',
  pendingAnnotationId: '',
  agentContext: null,
  readerNavBusy: false,
  contextPanel: 'agent',
  myTranslations: [],
  myRewrites: [],
  myAnnotations: [],
  myComments: [],
  myChatMessages: [],
  notifications: [],
  profileLinksDraft: [],
  profileAvatarDraft: '',
  dashboardTab: normalizeDashboardTab(storage.getItem('qm_dashboard_tab')),
  myAssetTab: 'translation',
  myAssetSort: storage.getItem('qm_my_asset_sort') === 'helpful' ? 'helpful' : 'latest',
  contributor: { id: '', profile: null, translations: [], rewrites: [], annotations: [], comments: [], messages: [], tab: 'translation', sort: 'latest', loading: false },
  workspacePage: '',
  commentSort: storage.getItem('qm_comment_sort') === 'latest' ? 'latest' : 'helpful',
  editingCommentId: '',
  translation: null,
  translationLoading: false,
  translationGenerating: false,
  translationCompare: false,
  pendingTranslationGenerate: false,
  /** 阅读区是否正显示简中译文（Zen 一键翻译） */
  readerZhMode: false,
  /** 思考笔记（X/小红书/知乎/Lil'Log）：当前笔记与视图态 */
  thinkingNote: null,
  thinkingNoteLoading: false,
  readerNoteMode: false,
  noteReturnZh: false,
  translationAiProfileId: '',
  rewrite: null,
  rewriteLoading: false,
  rewriteGenerating: false,
  pendingRewriteGenerate: false,
  readerTab: 'original',
  defaultReaderTab: DEFAULT_READER_OPEN_TAB,
  profileDefaultReaderTabDraft: DEFAULT_READER_OPEN_TAB,
  readerPrefs: normalizeReaderPrefs(readJson('qm_reader_prefs', JSON.stringify(READER_PREF_DEFAULTS))),
  readerPrefsOpen: false,
  readerImmersive: false,
  readerAssetsExpanded: false,
  readerTocAvailable: false,
  readerFocus: null,
  readerAssetId: '',
  pendingAssetJump: null,
  suppressAnnotationUntil: 0,
  pendingCommentId: '',
  pendingChatMessageId: '',
  fetchingOriginal: false,
  agentBusy: false,
  agentPrompts: loadAgentPrompts(),
  agentPromptEditingId: '',
  agentPromptQuery: '',
  personaAgentController: null,
  personaAgentEntryId: '',
  personaAgentMessageKey: '',
  personaAgentReady: false,
  agentCollapsed: storage.getItem('qm_agent_collapsed') === '1',
  agentAutoCollapsed: false,
  sidebarCollapsed: storage.getItem('qm_sidebar_collapsed') === '1',
  leftCollapsed: storage.getItem('qm_left_collapsed') === '1',
  sidebarMoreOpen: storage.getItem('qm_sidebar_more_open') === '1',
  entryPaneWidth: readStoredNumber('qm_entry_pane_width'),
  contextPaneWidth: readStoredNumber('qm_context_pane_width'),
  me: null,
  authMode: 'login',
  aiProfiles: [],
  activeAiProfileId: '',
  rewriteAiProfileId: '',
  agentAiProfileId: '',
  editingAiProfileId: '',
  aiConfigReason: '',
  pendingAiAction: '',
  pendingAgentText: '',
  pendingSubmitLink: null,
  articleLinkMenuUrl: '',
  articleLinkSubmitting: false,
  /** 正文选区右键：高亮/删除草稿 */
  contentSelectionDraft: null,
  loadedAiScope: '',
  /** 小红书图廊：IO 懒加载 + 降采样 blob 回收 */
  socialGalleryIo: null,
  socialGalleryBlobs: [],
};
const sourceRefreshHintAt = new Map();
const sourceRefreshPolls = new Map();

function routeStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const pathMatch = window.location.pathname.match(/^\/assets(?:\/([^/.]+))?\/?$/);
  const contributorsPath = /^\/contributors\/?$/.test(window.location.pathname);
  const contributorMatch = window.location.pathname.match(/^\/contributors\/([^/?#]+)\/?$/);
  const dashboardPath = /^\/(?:me|dashboard)\/?$/.test(window.location.pathname);
  const adminPath = /^\/admin\/?$/.test(window.location.pathname);
  const articleRoute = articleRouteFromPath(window.location.pathname);
  const pathAssetFilter = pathMatch ? (ASSET_FILTER_TYPES.includes(pathMatch[1]) ? pathMatch[1] : null) : null;
  const isAssetPath = Boolean(pathMatch);
  const queryAssetFilter = ASSET_FILTER_TYPES.includes(params.get('asset')) ? params.get('asset') : null;
  const hash = decodeURIComponent(String(window.location.hash || '').replace(/^#/, ''));
  const queryCommentId = String(params.get('comment') || '').trim();
  const queryAnnotationId = String(params.get('annotation') || '').trim();
  const queryChatMessageId = String(params.get('chat') || '').trim();
  const queryAssetId = String(params.get('assetId') || '').trim();
  const pathCommentId = articleRoute && articleRoute.focus === 'comments' ? articleRoute.itemId : '';
  const pathAnnotationId = articleRoute && articleRoute.focus === 'annotations' ? articleRoute.itemId : '';
  const pathChatMessageId = articleRoute && articleRoute.focus === 'chat' ? articleRoute.itemId : '';
  const pathAssetId = articleRoute && ['translation', 'rewrite'].includes(articleRoute.focus) ? articleRoute.itemId : '';
  const commentId = hash.startsWith('comment-') ? hash.slice('comment-'.length).trim() : (pathCommentId || queryCommentId);
  const annotationId = hash.startsWith('annotation-') ? hash.slice('annotation-'.length).trim() : (pathAnnotationId || queryAnnotationId);
  const chatMessageId = hash.startsWith('chat-') ? hash.slice('chat-'.length).trim() : (pathChatMessageId || queryChatMessageId);
  const queryFocus = ASSET_FILTER_TYPES.includes(params.get('focus')) ? params.get('focus') : null;
  const focus = commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : (articleRoute && articleRoute.focus ? articleRoute.focus : queryFocus);
  const queryReaderTab = params.has('tab') ? normalizeReaderTab(params.get('tab')) : null;
  const routeReaderTab = articleRoute && articleRoute.focus === 'translation'
    ? 'translation'
    : articleRoute && articleRoute.focus === 'rewrite'
      ? 'rewrite'
      : queryReaderTab !== null
        ? queryReaderTab
        : focus
          ? 'original'
          : null;
  return {
    entryId: articleRoute && articleRoute.id ? articleRoute.id : String(params.get('entry') || '').trim(),
    dashboard: dashboardPath,
    admin: adminPath,
    dashboardTab: dashboardPath ? normalizeDashboardTab(params.get('tab')) : 'profile',
    contributorId: contributorMatch ? decodeURIComponent(contributorMatch[1]).trim() : '',
    contributorAssetType: contributorMatch ? normalizeUserAssetTab(params.get('type')) : 'translation',
    contributorAssetSort: contributorMatch && params.get('sort') === 'helpful' ? 'helpful' : 'latest',
    tab: routeReaderTab,
    view: contributorsPath ? 'contributors' : (isAssetPath || params.get('view') === 'assets' ? 'assets' : ''),
    assetFilter: isAssetPath ? pathAssetFilter : queryAssetFilter,
    assetSort: params.get('sort') === 'helpful' ? 'helpful' : 'latest',
    contributorSort: contributorsPath ? normalizeContributorSort(params.get('sort')) : 'latest',
    focus: commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : focus,
    assetId: pathAssetId || queryAssetId,
    commentId,
    annotationId,
    chatMessageId,
    q: String(params.get('q') || '').trim(),
  };
}

function articleRouteFromPath(pathname) {
  const match = String(pathname || '').match(/^\/articles\/(.+?)\/?$/);
  if (!match) return null;
  const segments = String(match[1] || '').split('/').filter(Boolean).map(value => {
    try {
      return decodeURIComponent(value).trim();
    } catch {
      return String(value || '').trim();
    }
  });
  const first = segments[0] || '';
  const locator = splitArticleLocator(first);
  if (locator) {
    const focus = ASSET_FILTER_TYPES.includes(segments[1]) ? segments[1] : '';
    return {
      id: locator.shortId,
      slug: locator.slug,
      focus,
      itemId: focus ? (segments[2] || '') : '',
      shortId: locator.shortId,
      legacy: false,
    };
  }
  const id = first;
  if (!id) return null;
  const raw = segments.slice(1);
  let slug = raw[0] || '';
  let focus = '';
  let itemId = '';
  const assetIndex = raw.findIndex(value => ASSET_FILTER_TYPES.includes(value));
  if (assetIndex >= 0) {
    focus = raw[assetIndex];
    slug = raw.slice(0, assetIndex).filter(Boolean).join('-');
    itemId = raw[assetIndex + 1] || '';
  }
  return { id, slug, focus, itemId, shortId: '', legacy: true };
}

function slugifyForUrl(value, fallback = 'article') {
  const slug = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’"“”‘]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function entrySlug(entry) {
  const fallback = slugifyForUrl(entry && entry.id, 'article');
  return slugifyForUrl(entry && (entry.titleZh || entry.title || entry.id), fallback);
}

function entryShortId(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId && entryOrId.id;
  return String(id || '').trim().slice(0, 12);
}

function entryArticleLocator(entry) {
  return `${entrySlug(entry)}--${entryShortId(entry)}`;
}

function splitArticleLocator(locator) {
  const value = String(locator || '').trim();
  const marker = value.lastIndexOf('--');
  if (marker <= 0) return null;
  const slug = value.slice(0, marker).replace(/^-+|-+$/g, '');
  const shortId = value.slice(marker + 2).trim();
  if (!slug || shortId.length < 6) return null;
  return { slug, shortId };
}

function listRouteTitle(view = state.view, assetFilter = state.assetFilter, q = state.q) {
  if (view === 'contributors') {
    const sortPrefix = state.contributorSort === 'helpful' ? '有用 · ' : state.contributorSort === 'assets' ? '资产 · ' : '';
    return q ? `${sortPrefix}贡献榜 · “${q}” · QMReader` : `${sortPrefix}贡献榜 · QMReader`;
  }
  if (view === 'assets') {
    const sortPrefix = state.assetSort === 'helpful' ? '有用 · ' : '';
    const prefix = `${sortPrefix}${assetFilter ? `${assetDirectoryLabel(assetFilter)}资产` : '公开资产'}`;
    return q ? `${prefix} · “${q}” · QMReader` : `${prefix} · QMReader`;
  }
  return 'QMReader · RSS 阅读器';
}

function readerRouteTitle(entry = state.activeEntry, focus = state.readerFocus) {
  const title = entry ? (entry.titleZh || entry.title || '文章') : '文章';
  const prefix = focus && ASSET_FOCUS_LABELS[focus] ? `${ASSET_FOCUS_LABELS[focus]} · ` : '';
  return `${prefix}${title} · QMReader`;
}

function readerUrlFor(entry = state.activeEntry, tab = state.readerTab, focus = state.readerFocus, assetId = state.readerAssetId) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  if (entry && entry.id) {
    const nextTab = normalizeReaderTab(tab);
    const nextFocus = focus && ASSET_FILTER_TYPES.includes(focus)
      ? focus
      : nextTab === 'translation'
      ? 'translation'
      : nextTab === 'rewrite'
      ? 'rewrite'
      : '';
    url.pathname = `/articles/${encodeURIComponent(entryArticleLocator(entry))}`;
    if (nextFocus) {
      url.pathname += `/${nextFocus}`;
      if (assetId) url.pathname += `/${encodeURIComponent(assetId)}`;
    }
  }
  return url;
}

function readerAssetUrl(type, entry = state.activeEntry, assetId = '') {
  if (!entry || !ASSET_FILTER_TYPES.includes(type)) return '';
  const tab = type === 'translation' ? 'translation' : type === 'rewrite' ? 'rewrite' : 'original';
  return readerUrlFor(entry, tab, type, assetId).href;
}

function commentUrl(commentId, entry = state.activeEntry) {
  if (!entry || !commentId) return '';
  const url = readerUrlFor(entry, 'original', 'comments', commentId);
  url.hash = `comment-${encodeURIComponent(commentId)}`;
  return url.href;
}

function annotationUrl(annotationId, entry = state.activeEntry) {
  if (!entry || !annotationId) return '';
  const url = readerUrlFor(entry, 'original', 'annotations', annotationId);
  url.hash = `annotation-${encodeURIComponent(annotationId)}`;
  return url.href;
}

function chatMessageUrl(messageId, entry = state.activeEntry) {
  if (!entry || !messageId) return '';
  const url = readerUrlFor(entry, 'original', 'chat', messageId);
  url.hash = `chat-${encodeURIComponent(messageId)}`;
  return url.href;
}

function assetItemUrl(type, entry, itemId = '') {
  if ((type === 'translation' || type === 'rewrite') && itemId) return readerAssetUrl(type, entry, itemId);
  if (type === 'comments' && itemId) return commentUrl(itemId, entry);
  if (type === 'annotations' && itemId) return annotationUrl(itemId, entry);
  if (type === 'chat' && itemId) return chatMessageUrl(itemId, entry);
  return readerAssetUrl(type, entry);
}

function readerShareFocus() {
  if (state.readerFocus && ASSET_FILTER_TYPES.includes(state.readerFocus)) return state.readerFocus;
  if (state.readerTab === 'translation' && state.translation) return 'translation';
  if (state.readerTab === 'rewrite' && state.rewrite) return 'rewrite';
  return null;
}

function copyReaderLink() {
  const entry = state.activeEntry;
  if (!entry) return;
  const focus = readerShareFocus();
  const tab = focus === 'translation' ? 'translation' : focus === 'rewrite' ? 'rewrite' : state.readerTab;
  const url = readerUrlFor(entry, tab, focus, state.readerAssetId);
  document.title = readerRouteTitle(entry, focus);
  if (url.href !== window.location.href) {
    history.replaceState({ entryId: entry.id, tab, focus }, '', url);
  }
  copyText(url.href, focus && ASSET_FOCUS_LABELS[focus] ? `${ASSET_FOCUS_LABELS[focus]}链接已复制` : '文章链接已复制');
}

function readerVisibleContentRoot() {
  if (state.readerTab === 'rewrite') return $('#rewrite-content');
  if (state.readerTab === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function elementTextForCopy(root) {
  if (!root) return '';
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.katex-display').forEach(display => {
    const tex = display.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (tex) display.replaceWith(document.createTextNode(`\n$$${tex}$$\n`));
  });
  clone.querySelectorAll('.katex').forEach(math => {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (tex) math.replaceWith(document.createTextNode(`$${tex}$`));
  });
  clone.querySelectorAll('h1 > a, h2 > a, h3 > a, h4 > a, h5 > a, h6 > a').forEach(anchor => {
    if (anchor.textContent.trim() === '#') anchor.remove();
  });
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:var(--reader-measure);opacity:0;pointer-events:none;';
  stage.appendChild(clone);
  document.body.appendChild(stage);
  const text = clone.innerText || clone.textContent || '';
  stage.remove();
  return String(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function activeReaderCopyText(entry = state.activeEntry) {
  if (!entry) return '';
  const src = sourceById(entry.sourceId);
  const mainTitle = entry.titleZh || entry.title || '未命名文章';
  const date = entry.published ? new Date(entry.published).toLocaleString('zh-CN') : '';
  const meta = [src?.name, entry.author, date].filter(Boolean).join(' · ');
  let body = elementTextForCopy(readerVisibleContentRoot());
  if (!body && state.readerTab === 'rewrite' && state.rewrite?.body) body = String(state.rewrite.body).trim();
  if (!body && state.readerTab === 'original') body = plainTextFromHtml(contentCache.get(entry.id) || entry.content || entry.summary || '');
  const versionLabel = state.readerTab === 'rewrite'
    ? rewriteUiCopy(entry).section
    : state.readerTab === 'translation'
      ? '中文翻译'
      : '原文';
  return [
    mainTitle,
    meta,
    entry.link || '',
    versionLabel ? `版本：${versionLabel}` : '',
    '',
    body,
  ].filter((line, index) => index === 4 || String(line || '').trim()).join('\n');
}

function copyReaderContent() {
  const text = activeReaderCopyText();
  copyText(text, '文章内容已复制');
}

function listUrlFor(view = state.view, assetFilter = state.assetFilter) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  if (view === 'assets') {
    url.pathname = assetFilter && ASSET_FILTER_TYPES.includes(assetFilter)
      ? `/assets/${assetFilter}`
      : '/assets';
    if (state.q) url.searchParams.set('q', state.q);
    if (state.assetSort === 'helpful') url.searchParams.set('sort', 'helpful');
  } else if (view === 'contributors') {
    url.pathname = '/contributors';
    if (state.q) url.searchParams.set('q', state.q);
    if (state.contributorSort !== 'latest') url.searchParams.set('sort', state.contributorSort);
  }
  return url;
}

function contributorUrlFor(contributorId, { sort = 'latest', tab = '' } = {}) {
  const url = new URL(window.location.href);
  url.pathname = `/contributors/${encodeURIComponent(contributorId)}`;
  url.search = '';
  url.hash = '';
  const assetTab = normalizeUserAssetTab(tab);
  if (assetTab !== 'translation') url.searchParams.set('type', assetTab);
  if (sort === 'helpful') url.searchParams.set('sort', 'helpful');
  return url;
}

function contributorFeedUrlFor(contributorId) {
  const url = contributorUrlFor(contributorId);
  url.pathname = `/contributors/${encodeURIComponent(contributorId)}.xml`;
  return url;
}

function dashboardUrlFor(tab = state.dashboardTab) {
  const url = new URL(window.location.href);
  url.pathname = '/me';
  url.search = '';
  url.hash = '';
  const nextTab = normalizeDashboardTab(tab);
  if (nextTab !== 'profile') url.searchParams.set('tab', nextTab);
  return url;
}

function adminUrlFor() {
  const url = new URL(window.location.href);
  url.pathname = '/admin';
  url.search = '';
  url.hash = '';
  return url;
}

function setWorkspacePage(page = '') {
  const next = page === 'dashboard' || page === 'contributor' || page === 'admin' ? page : '';
  state.workspacePage = next;
  const app = $('#app');
  app.classList.toggle('workspace-page-open', Boolean(next));
  $('#my-dashboard-page')?.classList.toggle('hidden', next !== 'dashboard');
  $('#contributor-page')?.classList.toggle('hidden', next !== 'contributor');
  $('#admin-page')?.classList.toggle('hidden', next !== 'admin');
  if (next) {
    $('#reader').classList.add('hidden');
    $('#reader-empty').classList.add('hidden');
    app.classList.remove('reading');
    $('#reader-pane').scrollTop = 0;
    return;
  }
  $('#reader').classList.toggle('hidden', !state.activeEntry);
  $('#reader-empty').classList.toggle('hidden', Boolean(state.activeEntry));
  app.classList.toggle('reading', Boolean(state.activeEntry));
}

function syncReaderUrl({ replace = false, commentId = '', annotationId = '', chatMessageId = '' } = {}) {
  const entry = state.activeEntry;
  if (!entry || !entry.id) return;
  const focus = commentId ? 'comments' : annotationId ? 'annotations' : chatMessageId ? 'chat' : state.readerFocus;
  const itemId = commentId || annotationId || chatMessageId || state.readerAssetId;
  const url = readerUrlFor(entry, state.readerTab, focus, itemId);
  document.title = readerRouteTitle(entry, focus);
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ entryId: entry.id, tab: state.readerTab, commentId, annotationId, chatMessageId }, '', url);
}

function syncListUrl({ replace = false } = {}) {
  const url = listUrlFor();
  document.title = listRouteTitle();
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ view: state.view, assetFilter: state.assetFilter }, '', url);
}

function clearReaderUrl({ replace = true } = {}) {
  const url = readerUrlFor(null);
  document.title = 'QMReader · RSS 阅读器';
  if (url.href === window.location.href) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ entryId: null }, '', url);
}

function persist() {
  if (state.me) return;
  state.guestRead = new Set(state.read);
  state.guestStarred = new Set(state.starred);
  state.guestHistory = new Map(state.history);
  storage.setItem('fr_read', JSON.stringify([...state.guestRead].slice(-5000)));
  storage.setItem('fr_starred', JSON.stringify([...state.guestStarred]));
  storage.setItem('qm_ratings', JSON.stringify(state.ratings || {}));
  storage.setItem('qm_history', JSON.stringify(historyEntriesForStorage(state.guestHistory)));
}

function getEntryRating(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return 0;
  if (state.ratings && state.ratings[id]) {
    return Math.max(1, Math.min(5, Number(state.ratings[id]) || 0));
  }
  if (state.starred && state.starred.has(id)) return 5;
  return 0;
}

function setEntryRating(entryId, score) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const rating = Math.max(1, Math.min(5, Number(score) || 0));
  if (!state.ratings) state.ratings = {};
  state.ratings[id] = rating;
  state.starred.add(id);
  persist();
}

function removeEntryRating(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return;
  if (state.ratings) delete state.ratings[id];
  state.starred.delete(id);
  persist();
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function delay(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showConfirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise(resolve => {
    const modal = $('#confirm-modal');
    const titleEl = $('#confirm-title');
    const messageEl = $('#confirm-message');
    const iconEl = $('#confirm-icon');
    const okBtn = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }
    const previousFocus = document.activeElement;
    let settled = false;
    const close = value => {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      modal.classList.remove('danger');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKeydown);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(value);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) close(true);
    };
    titleEl.textContent = title;
    messageEl.textContent = message;
    setElementIcon(iconEl, danger ? 'circle-alert' : 'circle-help', { className: 'app-icon confirm-symbol' });
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    modal.classList.toggle('danger', Boolean(danger));
    modal.classList.remove('hidden');
    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    modal.onclick = event => {
      if (event.target === modal) close(false);
    };
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => okBtn.focus(), 20);
  });
}

function domainOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

function escapeJsString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function avatarInitial(user) {
  return ((user && (user.displayName || user.email)) || 'Q').trim().slice(0, 1).toUpperCase() || 'Q';
}

function avatarHtml(user, className = 'account-avatar') {
  const src = user && user.avatarUrl;
  const initial = avatarInitial(user);
  if (src) return `<span class="${className}"><img src="${escapeHtml(src)}" alt="${escapeHtml(initial)}" loading="lazy" /></span>`;
  return `<span class="${className}">${escapeHtml(initial)}</span>`;
}

function normalizeProfileLinks(links = []) {
  const seen = new Set();
  return (Array.isArray(links) ? links : [])
    .map(item => {
      const url = String(item && item.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return null;
      seen.add(url);
      const title = String(item && item.title || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      return { title: title || domainOf(url) || '链接', url };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function compactUrlLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}

function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '')) {
      reject(new Error('请选择 PNG、JPG、WebP 或 GIF 图片'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取头像失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('头像图片无法解析'));
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/webp', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" />`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdownLite(value) {
  const escaped = escapeHtml(value).replace(/\r\n/g, '\n').replace(/\n\s*-{3,}\s*\n/g, '\n\n');
  const output = [];
  let paragraph = [];
  let quote = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    output.push(`<blockquote>${quote.map(renderInlineMarkdown).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (!list || !list.items.length) return;
    output.push(`<${list.type}>${list.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (const line of escaped.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushQuote();
      flushList();
      const level = Math.min(heading[1].length, 4);
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quoteLine = /^&gt;\s+(.+)$/.exec(trimmed);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    flushQuote();

    const unordered = /^(?:[-*+]|•)\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushQuote();
  flushList();
  return output.join('');
}

async function copyText(value, success = '已复制') {
  const text = String(value || '');
  if (!text.trim()) {
    toast('没有可复制的内容');
    return false;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(success);
    return true;
  } catch {
    toast('复制失败，请手动选中复制', 4000);
    return false;
  }
}

function fallbackFavicon(img, letter) {
  const icon = document.createElement('span');
  icon.className = 'letter-icon';
  icon.style.setProperty('--icon-size', img.style.getPropertyValue('--icon-size') || '17px');
  icon.textContent = letter || '?';
  img.replaceWith(icon);
}

function faviconTargetUrl(siteUrl, domain) {
  const raw = String(siteUrl || '').trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  } catch (error) {
    // Fall back to the extracted domain below.
  }
  return domain ? `https://${domain}` : '';
}

function faviconHtml(siteUrl, name, size = 17, iconUrl = '') {
  const letter = ((name || '?').trim()[0] || '?').toUpperCase();
  const safeSize = Math.max(12, Math.min(Number(size) || 17, 48));
  const localIcon = String(iconUrl || '').trim();
  if (localIcon) {
    return `<img class="favicon" style="--icon-size:${safeSize}px" src="${escapeHtml(localIcon)}" loading="lazy" decoding="async" alt=""
      onerror="fallbackFavicon(this, '${escapeJsString(letter)}')" />`;
  }
  const d = domainOf(siteUrl);
  if (!d) return `<span class="letter-icon" style="--icon-size:${safeSize}px">${escapeHtml(letter)}</span>`;
  const src = `/favicons?domain_url=${encodeURIComponent(faviconTargetUrl(siteUrl, d))}&sz=${Math.max(32, safeSize * 4)}`;
  return `<img class="favicon" style="--icon-size:${safeSize}px" src="${escapeHtml(src)}" loading="lazy" referrerpolicy="no-referrer"
    onerror="fallbackFavicon(this, '${escapeJsString(letter)}')" />`;
}

function sourceFaviconHtml(src, size = 17) {
  if (!src) return faviconHtml('', '?', size);
  return faviconHtml(src.siteUrl, src.name, size, src.icon || '');
}

function isLikelyEnglishTitle(title) {
  const text = String(title || '');
  const letters = text.match(/[A-Za-z]/g) || [];
  const cjk = text.match(/[\u3400-\u9fff]/g) || [];
  return letters.length >= 6 && cjk.length <= 2;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  // 未来时间（错误数据）不当作「刚刚」
  if (diff < 0) return new Date(ts).toLocaleDateString('zh-CN');
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function shanghaiParts(ts = Date.now()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(new Date(ts));
  const pick = type => parts.find(part => part.type === type)?.value || '';
  return {
    year: Number(pick('year')) || 0,
    month: Number(pick('month')) || 0,
    day: Number(pick('day')) || 0,
    hour: pick('hour') || '00',
    minute: pick('minute') || '00',
  };
}

function shanghaiDayIndex(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function friendlyDateTime(ts) {
  const time = Number(ts) || 0;
  if (!time) return '';
  const current = shanghaiParts(Date.now());
  const target = shanghaiParts(time);
  const dayDiff = shanghaiDayIndex(current) - shanghaiDayIndex(target);
  const hour = Number(target.hour);
  const minute = String(target.minute || '00');
  // RSS 常只有日期：落在 0:00 / 2:00 / 8:00 等整点且分钟为 0 → 只显示日期，避免「2:00」误导
  const dateOnly = Number(minute) === 0 && (hour === 0 || hour === 2 || hour === 8);
  const clock = `${hour}:${minute.padStart ? minute.padStart(2, '0') : minute}`;
  const datePart = target.year === current.year
    ? `${Number(target.month)}月${Number(target.day)}日`
    : `${target.year}年${Number(target.month)}月${Number(target.day)}日`;
  if (dateOnly) {
    if (dayDiff === 0) return '今天';
    if (dayDiff === 1) return '昨天';
    if (dayDiff > 1 && dayDiff <= 6) return `${dayDiff}天前`;
    return datePart;
  }
  if (dayDiff === 0) return `今天 ${clock}`;
  if (dayDiff === 1) return `昨天 ${clock}`;
  if (dayDiff > 1 && dayDiff <= 6) return `${dayDiff}天前 ${clock}`;
  return `${datePart} ${clock}`;
}

/* ---------- API ---------- */
function aiScope() {
  return state.me ? `user:${state.me.id || state.me.email}` : 'guest';
}

function aiProfilesKey(scope = aiScope()) {
  return `qm_ai_profiles:${scope}`;
}

function aiActiveProfileKey(scope = aiScope()) {
  return `qm_ai_active_profile:${scope}`;
}

function aiPurposeProfileKey(purpose, scope = aiScope()) {
  return `qm_ai_${purpose}_profile:${scope}`;
}

function migrateLegacyAiProfiles() {
  const profiles = [];
  const legacyConfigs = readJson('qm_ai_configs', '{}');
  const legacyKey = String(storage.getItem('qm_deepseek_key') || '').trim();

  for (const [provider, config] of Object.entries(legacyConfigs || {})) {
    if (!config || typeof config !== 'object') continue;
    const preset = AI_PROVIDER_MAP[provider];
    if (!preset && !config.baseUrl && !config.model && !config.apiKey) continue;
    profiles.push(createProfileFromPreset(preset ? provider : DEFAULT_AI_PRESET_ID, {
      name: preset ? preset.name : String(provider || '自定义模型'),
      provider: preset ? preset.id : String(provider || 'custom'),
      providerName: preset ? preset.name : String(provider || '自定义'),
      providerCategory: preset ? preset.category : '',
      apiKeyUrl: preset ? preset.apiKeyUrl || '' : '',
      baseUrl: normalizeBaseUrl(config.baseUrl || (preset ? preset.baseUrl : '')),
      model: String(config.model || (preset ? preset.defaultModel : '')).trim(),
      apiKey: String(config.apiKey || '').trim(),
      isDefault: String(storage.getItem('qm_ai_provider') || DEFAULT_AI_PRESET_ID) === provider,
    }));
  }

  if (legacyKey && !profiles.some(profile => profile.provider === 'deepseek' && profile.apiKey)) {
    profiles.push(createProfileFromPreset('deepseek', { apiKey: legacyKey, isDefault: profiles.length === 0 }));
  }

  return profiles;
}

function ensureSingleDefault(profiles) {
  if (!profiles.length) return [];
  const defaultIndex = Math.max(0, profiles.findIndex(profile => profile.isDefault));
  return profiles.map((profile, index) => ({ ...profile, isDefault: index === defaultIndex }));
}

function loadAiProfilesForScope() {
  const scope = aiScope();
  const stored = readJson(aiProfilesKey(scope), 'null');
  let profiles = Array.isArray(stored) ? stored.map(normalizeProfile) : migrateLegacyAiProfiles();
  if (!profiles.length) profiles = [createProfileFromPreset(DEFAULT_AI_PRESET_ID, { isDefault: true })];
  profiles = ensureSingleDefault(profiles);
  state.aiProfiles = profiles;
  const activeId = storage.getItem(aiActiveProfileKey(scope));
  state.activeAiProfileId = profiles.some(profile => profile.id === activeId)
    ? activeId
    : (profiles.find(profile => profile.isDefault) || profiles[0]).id;
  const rewriteId = storage.getItem(aiPurposeProfileKey('rewrite', scope));
  const agentId = storage.getItem(aiPurposeProfileKey('agent', scope));
  const translationId = storage.getItem(aiPurposeProfileKey('translation', scope));
  state.translationAiProfileId = profiles.some(profile => profile.id === translationId) ? translationId : state.activeAiProfileId;
  state.rewriteAiProfileId = profiles.some(profile => profile.id === rewriteId) ? rewriteId : state.activeAiProfileId;
  state.agentAiProfileId = profiles.some(profile => profile.id === agentId) ? agentId : state.activeAiProfileId;
  state.editingAiProfileId = state.activeAiProfileId;
  state.loadedAiScope = scope;
  persistAiProfiles();
}

function persistAiProfiles() {
  const scope = aiScope();
  storage.setItem(aiProfilesKey(scope), JSON.stringify(ensureSingleDefault(state.aiProfiles)));
  if (state.activeAiProfileId) storage.setItem(aiActiveProfileKey(scope), state.activeAiProfileId);
  if (state.translationAiProfileId) storage.setItem(aiPurposeProfileKey('translation', scope), state.translationAiProfileId);
  if (state.rewriteAiProfileId) storage.setItem(aiPurposeProfileKey('rewrite', scope), state.rewriteAiProfileId);
  if (state.agentAiProfileId) storage.setItem(aiPurposeProfileKey('agent', scope), state.agentAiProfileId);
}

function profileByIdOrDefault(profileId = '') {
  return state.aiProfiles.find(profile => profile.id === profileId)
    || state.aiProfiles.find(profile => profile.isDefault)
    || state.aiProfiles[0]
    || createProfileFromPreset(DEFAULT_AI_PRESET_ID, { isDefault: true });
}

function currentAiProfile() {
  return profileByIdOrDefault(state.activeAiProfileId);
}

function aiProfileForPurpose(purpose = '') {
  if (purpose === 'translation') return profileByIdOrDefault(state.translationAiProfileId || state.activeAiProfileId);
  if (purpose === 'rewrite') return profileByIdOrDefault(state.rewriteAiProfileId || state.activeAiProfileId);
  if (purpose === 'agent') return profileByIdOrDefault(state.agentAiProfileId || state.activeAiProfileId);
  return currentAiProfile();
}

function configFromProfile(profile) {
  return {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider || DEFAULT_AI_PRESET_ID,
    providerName: profile.providerName || profile.name || profile.provider || 'AI',
    providerType: profile.providerType || 'openai_compatible',
    apiKey: String(profile.apiKey || '').trim(),
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    model: String(profile.model || '').trim(),
    temperature: clampTemperature(profile.temperature),
    maxTokens: clampMaxTokens(profile.maxTokens),
  };
}

function currentAiConfig() {
  return configFromProfile(currentAiProfile());
}

function aiConfigForPurpose(purpose = '') {
  return configFromProfile(aiProfileForPurpose(purpose));
}

function hasUsableAiConfig(config = currentAiConfig()) {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function aiHeaderValue(value, fallback = '') {
  const clean = String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
  return clean || String(fallback || '').replace(/[^\x20-\x7e]/g, '').trim();
}

function aiHeadersFromConfig(config) {
  if (!String(config.apiKey || '').trim()) return {};
  return {
    'X-AI-Provider': aiHeaderValue(config.provider, 'custom'),
    'X-AI-Provider-Name': aiHeaderValue(config.providerName || config.profileName, config.provider || 'AI'),
    'X-AI-Provider-Type': aiHeaderValue(config.providerType, 'openai_compatible'),
    'X-AI-Key': aiHeaderValue(config.apiKey),
    'X-AI-Base-URL': aiHeaderValue(config.baseUrl),
    'X-AI-Model': aiHeaderValue(config.model),
    'X-AI-Temperature': String(config.temperature ?? ''),
    'X-AI-Max-Tokens': String(config.maxTokens ?? ''),
  };
}

function aiHeaders() {
  return aiHeadersFromConfig(currentAiConfig());
}

function translationAiConfig() {
  const config = aiConfigForPurpose('translation');
  // 与改写一致：翻译输出预算不低于 8000（聊天 Profile 默认 2000 不够 dual JSON）
  if (hasUsableAiConfig(config)) {
    return {
      ...config,
      temperature: config.temperature || 0.15,
      maxTokens: Math.max(Number(config.maxTokens) || 0, 8000),
    };
  }
  return {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    apiKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.15,
    maxTokens: 8000,
  };
}

function rewriteAiConfig() {
  const config = aiConfigForPurpose('rewrite');
  if (hasUsableAiConfig(config)) {
    return { ...config, temperature: config.temperature || 0.6, maxTokens: Math.max(config.maxTokens || 0, 7000) };
  }
  return {
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    apiKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.6,
    maxTokens: 7000,
  };
}

async function api(path, opts) {
  const headers = { ...(opts && opts.headers ? opts.headers : {}) };
  if (opts && opts.aiConfig) Object.assign(headers, aiHeadersFromConfig(opts.aiConfig));
  else if (opts && opts.ai) Object.assign(headers, aiHeaders());
  const rest = { ...(opts || {}) };
  delete rest.ai;
  delete rest.aiConfig;
  let res;
  try {
    res = await fetch(path, { ...rest, headers });
  } catch (err) {
    const raw = String(err && err.message || err || '');
    // Firefox: "NetworkError when attempting to fetch resource."
    if (/NetworkError|Failed to fetch|Load failed|network/i.test(raw)) {
      throw new Error(
        '网络中断：浏览器连不上本机 Reader 或请求过久被断开。'
        + '请确认服务在跑；AI 设置里 DeepSeek Key 已保存；'
        + 'Base URL 用 https://api.deepseek.com/v1，模型 deepseek-v4-flash；再重试翻译',
      );
    }
    throw err instanceof Error ? err : new Error(raw || '请求失败');
  }
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch { /* keep HTTP status */ }
    throw new Error(message);
  }
  return res.json();
}
async function loadSources() {
  const data = await api('/api/sources');
  state.sources = applySourcePreferences(data.sources || []);
  rebuildSourceMap();
  // sources 就绪后补建分类桶（与 loadEntries 并行时的竞态）
  if (state.allEntries && state.allEntries.length) rebuildCatalogIndexes();
  state.refreshing = Boolean(data.refreshing);
  state.refreshProgress = data.progress || { done: 0, total: 0 };
  state.autoRewrite = data.autoRewrite || { running: false, last: null };
  if (!$('#manage-modal')?.classList.contains('hidden')) renderManageStatus();
  if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
  renderSourceRefreshButton();
  return data;
}

function hintSourceRefresh(sourceId, reason = 'source-interaction') {
  const id = String(sourceId || '').trim();
  if (!id) return;
  const now = Date.now();
  const last = sourceRefreshHintAt.get(id) || 0;
  if (now - last < SOURCE_REFRESH_HINT_COOLDOWN_MS) return;
  sourceRefreshHintAt.set(id, now);
  fetch(`/api/sources/${encodeURIComponent(id)}/refresh-hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
    keepalive: true,
  })
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      const refresh = data && data.refresh;
      if (!refresh) return;
      // 本地 likes：后端同步扫盘后立刻 merge 目录（无需 worker 轮询）
      if (refresh.local && refresh.started) {
        mergeSourceEntries(id, { keepReader: true }).catch(() => {});
        return;
      }
      if (refresh.started || refresh.running) pollHintedSourceRefresh(id);
    })
    .catch(() => {});
}

/** 本地 X/小红书收藏：切源时强制扫盘+拉目录（不受 5 分钟 softRefresh 冷却限制） */
function hintLocalLikesSync(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id || !isLocalOnlySource(id)) return;
  // 绕过 hint cooldown：本地源用更短间隔，保证刚进 Typora 的 md 可见
  sourceRefreshHintAt.delete(id);
  hintSourceRefresh(id, 'local-likes-select');
}

/** 串行 merge 队列：避免并发 merge 同一/多源时 allEntries 互盖丢条 */
let mergeSourceEntriesChain = Promise.resolve();

/**
 * 远程 refresh 完成后只拉该源目录并 merge，避免全站 2MB+ 重载
 */
async function mergeSourceEntries(sourceId, { keepReader = true, gen = null, preserveScroll = false } = {}) {
  const run = async () => {
    const id = String(sourceId || '').trim();
    if (!id) return false;
    const data = await api(`/api/entries?${new URLSearchParams({ source: id }).toString()}`);
    // 过期 merge（连续取消稍后再看时旧请求后到）一律丢弃，否则会把后取消的卡又写回
    if (gen != null && Number(gen) !== Number(state.biliCancelMergeGen || 0)) return false;
    const next = Array.isArray(data.entries) ? data.entries : [];
    // 与本地已 drop 的 id 取交集：merge 不得复活本会话已取消/删除的条目
    const localDropped = state.localDroppedEntryIds;
    const filteredNext = localDropped && localDropped.size
      ? next.filter(e => e && e.id && !localDropped.has(e.id))
      : next;
    const listEl = preserveScroll ? $('#entry-list') : null;
    const scrollTop = listEl ? listEl.scrollTop : 0;
    const rest = (state.allEntries || []).filter(e => e && e.sourceId !== id);
    state.allEntries = rest.concat(filteredNext);
    state.allEntries.sort((a, b) => (Number(b.publishedTs) || 0) - (Number(a.publishedTs) || 0));
    state.entriesLoadedAt = Date.now();
    rebuildCatalogIndexes();
    syncSourcesEntryCountFromCatalog();
    applyLocalEntryFilter({
      fastBatch: Boolean(state.filterSource),
      resetWindow: !preserveScroll,
    });
    updateListTitle();
    renderList();
    if (preserveScroll && listEl) listEl.scrollTop = scrollTop;
    // 侧栏已建好时只改计数/高亮，禁止整树 rebuild（X/小红书收藏切源闪烁主因）
    if (state.sidebarBuilt && typeof patchSidebarSourceCounts === 'function') {
      patchSidebarSourceCounts();
      updateSidebarSelection();
    } else {
      renderSidebar();
    }
    updateSidebarNavCounts();
    if (!keepReader) {
      closeReaderChrome({ clearUrl: true });
      // 关闭后补画一次，未读列表去掉刚读完的篇
      renderList();
    }
    return true;
  };
  const next = mergeSourceEntriesChain.then(run, run);
  mergeSourceEntriesChain = next.then(() => {}, () => {});
  return next;
}

function pollHintedSourceRefresh(sourceId) {
  const id = String(sourceId || '').trim();
  if (!id || sourceRefreshPolls.has(id)) return;
  const task = (async () => {
    for (let i = 0; i < 90; i++) {
      await delay(1500);
      const data = await loadSources().catch(() => null);
      if (!data) continue;
      if (!data.refreshing) {
        // 按源增量 merge；失败再回退全量 reload
        try {
          await mergeSourceEntries(id, { keepReader: true });
        } catch {
          await reload({ keepReader: true, clearUrl: false }).catch(() => null);
        }
        return;
      }
    }
  })().finally(() => {
    sourceRefreshPolls.delete(id);
  });
  sourceRefreshPolls.set(id, task);
}

/** 重建切源索引：按源分组 + 计数 + 未读 + 热门缓存 */
function rebuildCatalogIndexes() {
  const bySource = new Map();
  const byCategory = new Map();
  const byId = new Map();
  const counts = new Map();
  const unread = new Map();
  const hotScored = [];
  const list = Array.isArray(state.allEntries) ? state.allEntries : [];
  for (const e of list) {
    if (!e || !e.id) continue;
    byId.set(e.id, e);
    if (!e.sourceId) continue;
    let bucket = bySource.get(e.sourceId);
    if (!bucket) {
      bucket = [];
      bySource.set(e.sourceId, bucket);
    }
    bucket.push(e);
    counts.set(e.sourceId, (counts.get(e.sourceId) || 0) + 1);
    if (!state.read.has(e.id)) {
      unread.set(e.sourceId, (unread.get(e.sourceId) || 0) + 1);
    }
    const src = sourceById(e.sourceId);
    const cat = src && src.category;
    if (cat) {
      let catBucket = byCategory.get(cat);
      if (!catBucket) {
        catBucket = [];
        byCategory.set(cat, catBucket);
      }
      catBucket.push(e);
    }
    if (!entryExcludedFromAll(e)) {
      const score = entryQualityScore(e);
      if (score > 0.4) hotScored.push({ e, score, ts: Number(e.publishedTs) || 0 });
    }
  }
  hotScored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
  state.entriesBySource = bySource;
  state.entriesByCategory = byCategory;
  state.entryById = byId;
  state.sourceCountMap = counts;
  state.sourceUnreadMap = unread;
  state.hotCountCached = hotScored.length;
  state.hotEntriesCached = hotScored.slice(0, 80).map(item => item.e);
  state.catalogIndexedAt = Date.now();
}

function rebuildSourceMap() {
  const map = new Map();
  for (const s of state.sources || []) {
    if (s && s.id) map.set(s.id, s);
  }
  state.sourceMap = map;
}

function entryExcludedFromAll(entry) {
  if (!entry || !entry.sourceId) return false;
  if (entry.sourceId === 'zen-recent') return true;
  const src = sourceById(entry.sourceId);
  return Boolean(src && src.excludeFromAll);
}

/** 从 allEntries 本地套用源/分类/搜索过滤（切源零网络） */
function applyLocalEntryFilter({ fastBatch = false, resetWindow = true } = {}) {
  let list;
  if (state.filterSource) {
    list = state.entriesBySource.get(state.filterSource) || [];
  } else if (state.filterCategory && state.entriesByCategory && state.entriesByCategory.size) {
    list = (state.entriesByCategory.get(state.filterCategory) || [])
      .filter(e => !entryExcludedFromAll(e));
  } else {
    list = Array.isArray(state.allEntries) ? state.allEntries : [];
    // 课程库等 excludeFromAll：点过源后会 merge 进 allEntries，全部/分类视图仍排除
    list = list.filter(e => !entryExcludedFromAll(e));
    if (state.filterCategory) {
      list = list.filter(e => {
        const src = sourceById(e && e.sourceId);
        return src && src.category === state.filterCategory;
      });
    }
  }
  if (state.q && state.view !== 'assets' && state.view !== 'contributors') {
    list = list.filter(e => entryMatchesSearch(e));
  }
  // 预分组数组勿原地改；视图层再 slice
  state.entries = list;
  state.entryRenderLimit = fastBatch ? ENTRY_RENDER_FAST_BATCH : ENTRY_RENDER_BATCH_SIZE;
  // 切源/筛选才重置虚拟窗口；删卡/取消稍后再看须保留滚动，避免中栏跳动闪烁
  if (resetWindow) {
    state.listWindowStart = 0;
    state.listWindowEnd = 0;
  }
}

function entryCatalog() {
  return (state.allEntries && state.allEntries.length) ? state.allEntries : state.entries;
}

function sourceEntryCount(sourceOrId) {
  const id = typeof sourceOrId === 'string' ? sourceOrId : (sourceOrId && sourceOrId.id);
  if (!id) return 0;
  const src = (typeof sourceOrId === 'object' && sourceOrId && sourceOrId.id)
    ? sourceOrId
    : sourceById(id);
  const fromMeta = Number(src && src.entryCount) || 0;
  const fromMap = state.sourceCountMap && state.sourceCountMap.has(id)
    ? (Number(state.sourceCountMap.get(id)) || 0)
    : null;
  // 目录可能尚未灌满；侧栏数字取「本地目录 vs 服务端 meta」较大值，避免只显示 2 之类残缺计数
  if (fromMap != null && fromMeta) return Math.max(fromMap, fromMeta);
  if (fromMap != null) return fromMap;
  if (fromMeta) return fromMeta;
  return entryCatalog().filter(e => e && e.sourceId === id).length;
}

/** loadEntries 后把 sourceCountMap 写回 sources.entryCount，侧栏与 meta 一致 */
function syncSourcesEntryCountFromCatalog() {
  if (!state.sources || !state.sourceCountMap) return;
  for (const s of state.sources) {
    if (!s || !s.id) continue;
    if (!state.sourceCountMap.has(s.id)) continue;
    const n = Number(state.sourceCountMap.get(s.id)) || 0;
    // 不把更大的服务端计数压小；只在本地更多时抬高
    if (n > (Number(s.entryCount) || 0)) s.entryCount = n;
  }
  rebuildSourceMap();
}

function sourceUnreadCount(sourceOrId) {
  const id = typeof sourceOrId === 'string' ? sourceOrId : (sourceOrId && sourceOrId.id);
  if (!id) return 0;
  if (state.sourceUnreadMap && state.sourceUnreadMap.size) {
    return state.sourceUnreadMap.get(id) || 0;
  }
  return unreadCountFor(e => e.sourceId === id);
}

/**
 * 拉取全量列表进 allEntries，再本地 filter。
 * 切源不再带 source=，避免丢目录、侧栏计数归零。
 */
async function loadEntries({ background = false } = {}) {
  const gen = ++state.entriesFetchGen;
  const p = new URLSearchParams();
  // 全量目录；搜索/源筛选在 applyLocalEntryFilter 完成
  const data = await api('/api/entries?' + p.toString());
  if (gen !== state.entriesFetchGen) return null;
  let list = Array.isArray(data.entries) ? data.entries : [];
  // 本会话已取消/删除的卡不得被全量 load 写回（连续取消竞态）
  if (state.localDroppedEntryIds && state.localDroppedEntryIds.size) {
    list = list.filter(e => e && e.id && !state.localDroppedEntryIds.has(e.id));
  }
  state.allEntries = list;
  state.entriesLoadedAt = Date.now();
  rebuildCatalogIndexes();
  syncSourcesEntryCountFromCatalog();
  applyLocalEntryFilter();
  return data;
}

function isLocalOnlySource(sourceOrId) {
  const src = typeof sourceOrId === 'string' ? sourceById(sourceOrId) : sourceOrId;
  if (!src) {
    const id = typeof sourceOrId === 'string' ? sourceOrId : '';
    return id === 'xhs-likes' || id === 'x-likes' || id === 'bili-watchlater' || id === 'zen-recent'
      || /^xhs-/.test(id) || /^zhihu-/.test(id);
  }
  return Boolean(src.localOnly) || isLikesSourceId(src.id) || src.id === 'bili-watchlater'
    || src.id === 'zen-recent' || /^zhihu-/.test(String(src.id || ''));
}

/**
 * 硬刷新后对账：侧栏 meta.entryCount 大于本地 allEntries 分桶时，按源 merge 补齐；
 * 并在短暂延迟后全量 reload 一次，接住 listen 后的 local ingest。
 * 修复：全部视图首屏缺 X / 小红书 / 知乎，点进源后才出现。
 */
async function reconcileLocalCatalogAfterBoot() {
  const localSources = (state.sources || []).filter(src => src && isLocalOnlySource(src) && src.enabled !== false);
  if (!localSources.length) return;
  let merged = false;
  for (const src of localSources) {
    const expectN = Number(src.entryCount) || 0;
    const localN = (state.entriesBySource && state.entriesBySource.get(src.id) || []).length;
    // meta 有数但目录少 → 按源 merge（点源后才出现的根因）
    if (expectN > localN) {
      try {
        // 触发服务端 local 重灌（DB→cache），再 merge 进 allEntries
        await fetch(`/api/sources/${encodeURIComponent(src.id)}/refresh-hint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'boot-reconcile' }),
        }).catch(() => null);
        await mergeSourceEntries(src.id, { keepReader: true });
        merged = true;
      } catch {
        /* continue other sources */
      }
    }
  }
  // 再全量拉一次，覆盖 ingest 刚写完 DB 的情况
  try {
    await loadEntries({ background: true });
    merged = true;
  } catch {
    /* ignore */
  }
  if (!merged) return;
  // 仅在仍停在「全部」时重画列表，避免打断用户已点进的源
  if (!state.filterSource && state.view === 'all') {
    applyLocalEntryFilter({ fastBatch: false });
    updateListTitle();
    renderList();
  }
  updateSidebarNavCounts();
  renderSidebar();
}
async function loadContributors() {
  state.contributors = [];
}

function applyGuestEntryStates() {
  state.read = new Set(state.guestRead);
  state.starred = new Set(state.guestStarred);
  state.history = new Map(state.guestHistory);
}

async function loadUserEntryStates() {
  applyGuestEntryStates();
}

function defaultEntryStats(entryId = '') {
  return {
    entryId,
    viewCount: 0,
    favoriteCount: 0,
    likeCount: 0,
    dislikeCount: 0,
    reactionByMe: '',
    lastViewedAt: null,
    updatedAt: null,
  };
}

function entryStats(entry = state.activeEntry) {
  if (!entry) return defaultEntryStats();
  return { ...defaultEntryStats(entry.id), ...(entry.stats || {}) };
}

function formatCompactCount(value) {
  const n = Number(value) || 0;
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n ? String(n) : '';
}

function entryStatsLabel(entry) {
  const stats = entryStats(entry);
  return [
    stats.viewCount ? `阅 ${formatCompactCount(stats.viewCount)}` : '',
    stats.favoriteCount ? `藏 ${formatCompactCount(stats.favoriteCount)}` : '',
    stats.likeCount ? `赞 ${formatCompactCount(stats.likeCount)}` : '',
    stats.dislikeCount ? `负反馈 ${formatCompactCount(stats.dislikeCount)}` : '',
  ].filter(Boolean).join(' · ');
}

function entryTitlePenalty(entry) {
  const title = String(entry && (entry.titleZh || entry.title) || '');
  let penalty = 0;
  if (/[!?！？]{3,}/.test(title)) penalty += 1.2;
  if (/(震惊|必看|速看|爆火|封神|赢麻|逆天|标题党)/i.test(title)) penalty += 1.4;
  if (title.length > 88) penalty += 0.8;
  return penalty;
}

function entryQualityBreakdown(entry) {
  const stats = entryStats(entry);
  const assets = entry && entry.assets ? entry.assets : {};
  const ageHours = Math.max(0, (Date.now() - (Number(entry && entry.publishedTs) || Date.now())) / 36e5);
  const decay = Math.max(1, Math.log2(2 + ageHours / 12));
  const signals = {
    likes: (Number(stats.likeCount) || 0) * 4,
    favorites: (Number(stats.favoriteCount) || 0) * 2.5,
    helpful: (Number(assets.helpfulCount) || 0) * 3,
    comments: (Number(assets.comments) || 0) * 2,
    annotations: (Number(assets.annotations) || 0) * 1.6,
    aiAssets: (assetCountForType(entry, 'translation') + assetCountForType(entry, 'rewrite')) * 1.4,
    chat: (Number(assets.chatMessages) || 0) * 1.1,
    reads: Math.min(8, (Number(stats.viewCount) || 0) / 8),
  };
  const penalties = {
    dislikes: (Number(stats.dislikeCount) || 0) * 3,
    title: entryTitlePenalty(entry),
  };
  const positive = Object.values(signals).reduce((sum, value) => sum + value, 0);
  const negative = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const raw = Math.max(0, positive - negative);
  return {
    score: raw / decay,
    raw,
    positive,
    negative,
    decay,
    ageHours,
    signals,
    penalties,
  };
}

function entryQualityScore(entry) {
  return entryQualityBreakdown(entry).score;
}

function qScoreParts(entry) {
  const q = entryQualityBreakdown(entry);
  const parts = [
    q.signals.likes ? `赞 +${q.signals.likes.toFixed(1)}` : '',
    q.signals.favorites ? `收藏 +${q.signals.favorites.toFixed(1)}` : '',
    q.signals.helpful ? `有用 +${q.signals.helpful.toFixed(1)}` : '',
    q.signals.comments ? `点评 +${q.signals.comments.toFixed(1)}` : '',
    q.signals.annotations ? `划线 +${q.signals.annotations.toFixed(1)}` : '',
    q.signals.aiAssets ? `AI 资产 +${q.signals.aiAssets.toFixed(1)}` : '',
    q.signals.chat ? `对话 +${q.signals.chat.toFixed(1)}` : '',
    q.signals.reads ? `阅读 +${q.signals.reads.toFixed(1)}` : '',
    q.penalties.dislikes ? `负反馈 -${q.penalties.dislikes.toFixed(1)}` : '',
    q.penalties.title ? `标题惩罚 -${q.penalties.title.toFixed(1)}` : '',
    `时间衰减 ÷${q.decay.toFixed(2)}`,
  ].filter(Boolean);
  return { ...q, parts };
}

function hotEntryCount(entries) {
  // 默认用目录索引缓存，避免侧栏每次全表打分
  if (entries == null && state.catalogIndexedAt) return state.hotCountCached || 0;
  const list = entries || entryCatalog();
  return list.filter(entry => entryQualityScore(entry) > 0.4).length;
}

function patchCatalogEntry(entryId, patch) {
  const id = String(entryId || '').trim();
  if (!id || !patch) return;
  const prev = state.entryById?.get(id)
    || state.allEntries.find(entry => entry && entry.id === id)
    || state.entries.find(entry => entry && entry.id === id);
  if (!prev) return;
  const next = { ...prev, ...patch };
  state.entryById?.set(id, next);
  const idxAll = state.allEntries.indexOf(prev);
  if (idxAll >= 0) state.allEntries[idxAll] = next;
  else {
    const i = state.allEntries.findIndex(entry => entry && entry.id === id);
    if (i >= 0) state.allEntries[i] = next;
  }
  const idx = state.entries.indexOf(prev);
  if (idx >= 0) state.entries[idx] = next;
  else {
    const i = state.entries.findIndex(entry => entry && entry.id === id);
    if (i >= 0) state.entries[i] = next;
  }
  // 同步预分组桶（可能与 allEntries 同引用）
  if (next.sourceId && state.entriesBySource) {
    const bucket = state.entriesBySource.get(next.sourceId);
    if (bucket) {
      const bi = bucket.indexOf(prev);
      if (bi >= 0) bucket[bi] = next;
      else {
        const j = bucket.findIndex(item => item && item.id === id);
        if (j >= 0) bucket[j] = next;
      }
    }
  }
  if (next.sourceId && state.entriesByCategory) {
    const src = sourceById(next.sourceId);
    const cat = src && src.category;
    if (cat) {
      const bucket = state.entriesByCategory.get(cat);
      if (bucket) {
        const bi = bucket.indexOf(prev);
        if (bi >= 0) bucket[bi] = next;
      }
    }
  }
}

function entrySourceIdForReadState(entryOrId, id) {
  let sourceId = typeof entryOrId === 'object' && entryOrId ? entryOrId.sourceId : '';
  if (!sourceId) {
    const hit = (state.entryById && state.entryById.get(id))
      || (state.allEntries || []).find(e => e && e.id === id)
      || (state.entries || []).find(e => e && e.id === id)
      || (state.activeEntry?.id === id ? state.activeEntry : null);
    sourceId = hit && hit.sourceId;
  }
  return sourceId || '';
}

/** 标记已读并维护未读索引（O(1)） */
function markCatalogEntryRead(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : (entryOrId && entryOrId.id);
  if (!id) return false;
  const wasUnread = !state.read.has(id);
  state.read.add(id);
  if (!wasUnread) return false;
  const sourceId = entrySourceIdForReadState(entryOrId, id);
  if (sourceId && state.sourceUnreadMap) {
    const n = state.sourceUnreadMap.get(sourceId) || 0;
    if (n > 0) state.sourceUnreadMap.set(sourceId, n - 1);
  }
  return true;
}

/** 标回未读并维护未读索引 */
function markCatalogEntryUnread(entryOrId) {
  const id = typeof entryOrId === 'string' ? entryOrId : (entryOrId && entryOrId.id);
  if (!id || !state.read.has(id)) return false;
  state.read.delete(id);
  const sourceId = entrySourceIdForReadState(entryOrId, id);
  if (sourceId && state.sourceUnreadMap) {
    state.sourceUnreadMap.set(sourceId, (state.sourceUnreadMap.get(sourceId) || 0) + 1);
  }
  return true;
}

function setCatalogEntryRead(entryOrId, read) {
  return read ? markCatalogEntryRead(entryOrId) : markCatalogEntryUnread(entryOrId);
}

function mergeEntryStats(entryId, stats = {}, { rerenderList = false } = {}) {
  const id = String(entryId || stats.entryId || '').trim();
  if (!id) return;
  const normalized = { ...defaultEntryStats(id), ...(stats || {}), entryId: id };
  patchCatalogEntry(id, { stats: normalized });
  if (state.activeEntry?.id === id) {
    state.activeEntry = { ...state.activeEntry, stats: normalized };
    renderReaderStatsUi();
  }
  if (rerenderList) renderList();
  else patchEntryCardMeta(id);
}

function renderReaderStatsUi() {
  const entry = state.activeEntry;
  const stats = entryStats(entry);
  const starred = Boolean(entry && state.starred.has(entry.id));
  const favoriteText = formatCompactCount(stats.favoriteCount);
  const starBtn = $('#reader-star');
  if (starBtn) {
    starBtn.classList.toggle('starred', starred);
    starBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    starBtn.title = starred ? '取消收藏' : '收藏';
    starBtn.setAttribute('aria-label', starred ? '取消收藏' : '收藏这篇文章');
    // 顶栏 🌟 纯星标；无需 pill 文案
    if (!starBtn.classList.contains('reader-star-btn')) {
      starBtn.innerHTML = readerActionPillHtml('star', favoriteText, starred ? '已收藏' : '收藏');
    } else {
      starBtn.textContent = starred ? '★' : '☆';
    }
  }
  // 社交卡作者名旁星标
  if (entry?.id) syncSocialStarButtons(entry.id, starred);
  const likeBtn = $('#reader-like');
  if (likeBtn) {
    likeBtn.classList.toggle('active', stats.reactionByMe === 'like');
    likeBtn.setAttribute('aria-pressed', stats.reactionByMe === 'like' ? 'true' : 'false');
    likeBtn.setAttribute('aria-label', `${stats.reactionByMe === 'like' ? '取消点赞' : '点赞这篇文章'}，当前 ${formatCompactCount(stats.likeCount) || '0'} 个赞`);
    likeBtn.innerHTML = readerActionPillHtml('thumbs-up', formatCompactCount(stats.likeCount) || '0', '赞');
    likeBtn.title = '点赞';
  }
  const railLike = $('#reader-rail-like');
  const railStar = $('#reader-rail-star');
  const railComment = $('#reader-rail-comment');
  const railAnnotation = $('#reader-rail-annotation');
  const railRewrite = $('#reader-rail-rewrite');
  const railTranslate = $('#reader-rail-translate');
  if (railLike) {
    railLike.classList.toggle('active', stats.reactionByMe === 'like');
    railLike.setAttribute('aria-pressed', stats.reactionByMe === 'like' ? 'true' : 'false');
    $('#reader-rail-like-count').textContent = formatCompactCount(stats.likeCount) || '0';
  }
  if (railStar) {
    railStar.classList.toggle('active', starred);
    railStar.setAttribute('aria-pressed', starred ? 'true' : 'false');
    $('#reader-rail-star-count').textContent = favoriteText || '0';
  }
  if (railComment) $('#reader-rail-comment-count').textContent = formatCompactCount((state.comments || []).length) || '0';
  if (railAnnotation) $('#reader-rail-annotation-count').textContent = formatCompactCount((state.annotations || []).length) || '0';
  if (railRewrite) railRewrite.classList.toggle('active', Boolean(state.rewrite));
  if (railTranslate) railTranslate.classList.toggle('active', Boolean(state.translation));
  const viewCount = $('#reader-view-count');
  if (viewCount) viewCount.textContent = `访问 ${formatCompactCount(stats.viewCount) || 0}`;
  renderArticleInfoPanel();
}

function readerActionPillHtml(icon, count, label) {
  return `
    ${lucideIcon(icon, { className: 'app-icon reader-action-symbol' })}
    <span class="reader-action-label">${escapeHtml(label)}</span>
    ${count ? `<span class="reader-action-count">${escapeHtml(count)}</span>` : ''}`;
}

/**
 * 开文/已读：优先单卡 class patch，避免整表 list + 整树 sidebar
 * @param {{ active?: boolean, read?: boolean }} opts
 *   read: true 加 .read；false 去 .read；undefined 不改已读样式
 */
function patchEntryCardState(entryId, { active = true, read } = {}) {
  const root = $('#entry-list');
  if (!root) return false;
  const id = String(entryId || '').trim();
  if (!id) return false;
  if (active) {
    root.querySelector('.entry-card.active')?.classList.remove('active');
  }
  let card = null;
  try {
    card = root.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
  } catch {
    card = [...root.querySelectorAll('.entry-card')].find(el => el.dataset.id === id) || null;
  }
  if (!card) return false;
  if (active) card.classList.add('active');
  if (read === true) card.classList.add('read');
  else if (read === false) card.classList.remove('read');
  return true;
}

/** 仅刷新单卡 stats/meta 文案（view 回写不重画整表） */
function patchEntryCardMeta(entryId) {
  const root = $('#entry-list');
  if (!root || isZenPersonalMode()) return false;
  const id = String(entryId || '').trim();
  const entry = entryByIdFromList(id);
  if (!entry) return false;
  let card = null;
  try {
    card = root.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
  } catch {
    return false;
  }
  if (!card) return false;
  const statsLine = entryStatsLabel(entry);
  let row = card.querySelector('.entry-meta-row');
  let statsEl = card.querySelector('.entry-stats');
  if (!statsLine) {
    if (statsEl) statsEl.remove();
    return true;
  }
  if (statsEl) {
    statsEl.textContent = statsLine;
    return true;
  }
  if (!row) {
    row = document.createElement('div');
    row.className = 'entry-meta-row';
    const main = card.querySelector('.entry-main');
    const summary = card.querySelector('.entry-summary');
    if (summary) summary.after(row);
    else if (main) main.appendChild(row);
    else return false;
  }
  statsEl = document.createElement('span');
  statsEl.className = 'entry-stats';
  statsEl.textContent = statsLine;
  row.prepend(statsEl);
  return true;
}

function renderEntryStateUi() {
  const id = state.activeEntry?.id;
  const isRead = Boolean(id && state.read.has(id));
  // 切卡只 patch active，禁止整表 renderList（未读默认视图下整表重建是闪烁主因）
  // 列表成员变化（真正标已读移出未读等）由 toggleEntryRead / mark-read-btn 自己 renderList
  if (id && patchEntryCardState(id, { active: true, read: isRead })) {
    // 角标数字：未读未变时不必重算侧栏；view 统计等走 patchEntryCardMeta
    if (state.activeEntry?.sourceId) {
      const btn = document.querySelector(`.feed-item[data-source-id="${CSS.escape(state.activeEntry.sourceId)}"] .fcount`);
      if (btn) {
        const n = sourceUnreadCount(state.activeEntry.sourceId);
        btn.textContent = n ? String(n) : '';
      }
    }
  } else if (id) {
    // 虚拟列表窗外：只补 active，仍尽量避免整表
    const list = $('#entry-list');
    list?.querySelector('.entry-card.active')?.classList.remove('active');
    if (!state.sidebarBuilt) renderSidebar();
  }
  if (state.activeEntry) renderReaderStatsUi();
  updateReaderReadButton();
}

function updateReaderReadButton() {
  const btn = $('#reader-mark-read');
  if (!btn) return;
  const id = state.activeEntry?.id;
  const show = Boolean(id);
  btn.classList.toggle('hidden', !show);
  if (!show) return;
  const isRead = state.read.has(id);
  const text = isRead ? '未读' : '已读';
  btn.setAttribute('aria-pressed', isRead ? 'true' : 'false');
  btn.title = text;
  btn.setAttribute('aria-label', text);
  btn.textContent = text;
}

/** 切换当前/指定文章已读；sync 服务端 */
async function toggleEntryRead(entryId, force) {
  const id = String(entryId || state.activeEntry?.id || '').trim();
  if (!id) return false;
  const next = typeof force === 'boolean' ? force : !state.read.has(id);
  setCatalogEntryRead(id, next);
  persist();
  syncEntryState(id, { read: next });
  if (state.view === 'unread') renderList();
  else patchEntryCardState(id, { active: state.activeEntry?.id === id, read: next });
  updateSidebarNavCounts();
  if (state.activeEntry?.sourceId) {
    const btn = document.querySelector(`.feed-item[data-source-id="${CSS.escape(state.activeEntry.sourceId)}"] .fcount`);
    if (btn) {
      const n = sourceUnreadCount(state.activeEntry.sourceId);
      btn.textContent = n ? String(n) : '';
    }
  }
  updateReaderReadButton();
  toast(next ? '已标为已读' : '已标为未读');
  return true;
}

async function syncEntryState(entryId, patch) {
  persist();
  return null;
}

function recordEntryView(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return;
  state.history.delete(id);
  state.history.set(id, Date.now());
  state.history = new Map(historyEntriesForStorage(state.history).map(item => [item.entryId, item.viewedAt]));
  api(`/api/entry/${encodeURIComponent(id)}/view`, { method: 'POST' })
    .then(data => {
      if (data && data.stats) mergeEntryStats(id, data.stats);
    })
    .catch(() => {});
}

async function loadMe() {
  state.me = null;
  applyGuestEntryStates();
  loadAiProfilesForScope();
  renderAuthState();
  renderEntryStateUi();
  renderComments();
  renderAgent();
  renderAiSettings();
  return null;
}

/* ---------- Sidebar ---------- */
function applySourcePreferences(sources) {
  const names = readJson(SOURCE_NAMES_KEY, '{}');
  let namesDirty = false;
  for (const [id, obsolete] of Object.entries(OBSOLETE_SOURCE_NAMES)) {
    const saved = String(names[id] || '').trim();
    if (saved && obsolete.has(saved)) {
      delete names[id];
      namesDirty = true;
    }
  }
  if (namesDirty) storage.setItem(SOURCE_NAMES_KEY, JSON.stringify(names));
  const order = readJson(SOURCE_ORDER_KEY, '[]');
  const orderIds = (Array.isArray(order) ? order : []).filter(Boolean);
  const rank = new Map(orderIds.map((id, index) => [id, index]));
  // 有本地拖拽序时：完全尊重 qm_source_order（个人精选 / GitHub 项目等也可换位）
  // 无序时：displayPin 仅作默认置顶（个人精选→项目→X→小红书…）
  const hasCustomOrder = rank.size > 0;
  return sources
    .map((source, index) => ({
      ...source,
      defaultName: source.defaultName || source.name,
      name: String(names[source.id] || source.name || source.id).trim() || source.name || source.id,
      _sourceIndex: index,
      _displayPin: Number(source.displayPin) || 0,
    }))
    .sort((a, b) => {
      if (hasCustomOrder) {
        const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (ar !== br) return ar - br;
        // 均未写入 order 的新源：仍按 pin 默认排
        const ap = a._displayPin || 0;
        const bp = b._displayPin || 0;
        if (ap && bp && ap !== bp) return ap - bp;
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        return a._sourceIndex - b._sourceIndex;
      }
      const ap = a._displayPin || 0;
      const bp = b._displayPin || 0;
      if (ap && bp && ap !== bp) return ap - bp;
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;
      return a._sourceIndex - b._sourceIndex;
    });
}

function persistSourceOrder(ids) {
  const order = [...new Set((ids || []).filter(Boolean))];
  storage.setItem(SOURCE_ORDER_KEY, JSON.stringify(order));
  // 本地 order 优先；无 order 时 displayPin 才默认置顶
  state.sources = applySourcePreferences(state.sources || []);
  rebuildSourceMap();
}

function renameSource(sourceId, name) {
  const source = sourceById(sourceId);
  if (!source) return;
  const names = readJson(SOURCE_NAMES_KEY, '{}');
  const next = String(name || '').trim();
  if (!next || next === source.defaultName) delete names[sourceId];
  else names[sourceId] = next.slice(0, 48);
  storage.setItem(SOURCE_NAMES_KEY, JSON.stringify(names));
  source.name = next || source.defaultName || source.id;
}

let sourceContextId = '';
let suppressSourceClickUntil = 0;

/** 侧栏源拖拽（对齐 douban-showcase：全局非 passive pointer + touch-action:none，支持三指拖）
 * scope:
 *  - top  : 顶层源 / 整棵树分组（小红书博主、知乎）在 #feed-groups 内排序
 *  - tree : 分组内子源在 .feed-tree-children 内排序
 */
const SOURCE_DRAG_THRESHOLD = 5;
const sourceDrag = {
  pointerId: null,
  armed: false,
  active: false,
  id: '',
  btn: null,       // 手势起点（视觉 clone 源）
  moveEl: null,    // DOM 实际移动节点（源项 / .feed-tree / 子源）
  wrap: null,
  scope: 'top',    // 'top' | 'tree'
  groupId: '',
  category: '',
  startX: 0,
  startY: 0,
  grabY: 0,
  fixedLeft: 0,
  ghost: null,
  placeholder: null,
  pendingY: 0,
  raf: 0,
  clearSelectTimer: null,
};

function sourceDragReset() {
  sourceDrag.armed = false;
  sourceDrag.active = false;
  sourceDrag.pointerId = null;
  sourceDrag.id = '';
  sourceDrag.btn = null;
  sourceDrag.moveEl = null;
  sourceDrag.wrap = null;
  sourceDrag.scope = 'top';
  sourceDrag.groupId = '';
  sourceDrag.category = '';
  sourceDrag.ghost = null;
  sourceDrag.placeholder = null;
  sourceDrag.clearSelectTimer = null;
  if (sourceDrag.raf) {
    cancelAnimationFrame(sourceDrag.raf);
    sourceDrag.raf = 0;
  }
}

function sourceDragCleanupVisual() {
  document.querySelectorAll('.source-drag-ghost').forEach((el) => el.remove());
  document.querySelectorAll('.source-drag-placeholder').forEach((el) => el.remove());
  document.querySelectorAll('.is-source-dragging').forEach((el) => {
    el.classList.remove('is-source-dragging', 'dragging');
    el.style.removeProperty('display');
    el.style.removeProperty('height');
  });
  document.body.classList.remove('is-source-reordering');
  const scroller = document.querySelector('.sidebar-scroll');
  if (scroller) scroller.classList.remove('is-source-drag-scroll-lock');
}

/** 同容器内可插入节点 */
function sourceReorderCandidates(wrap, category, excludeEl, scope) {
  if (scope === 'tree') {
    return [...(wrap?.children || [])].filter((el) => {
      if (!el || el === excludeEl) return false;
      if (el.classList.contains('source-drag-placeholder')) return false;
      if (el.classList.contains('is-source-dragging')) return false;
      return Boolean(el.matches?.('.feed-item[data-source-id]'));
    });
  }
  return [...(wrap?.children || [])].filter((el) => {
    if (!el || el === excludeEl) return false;
    if (el.classList.contains('source-drag-placeholder')) return false;
    if (el.classList.contains('group-label')) return false;
    if (el.classList.contains('is-source-dragging')) return false;
    if (el.classList.contains('feed-tree')) return el.dataset.category === category;
    if (el.matches?.('.feed-item[data-source-id]:not([data-tree-child])')) {
      return el.dataset.category === category;
    }
    return false;
  });
}

function sourceDragMovePlaceholder(clientY) {
  const wrap = sourceDrag.wrap;
  const placeholder = sourceDrag.placeholder;
  const moveEl = sourceDrag.moveEl;
  if (!wrap || !placeholder) return;
  const candidates = sourceReorderCandidates(wrap, sourceDrag.category, moveEl, sourceDrag.scope);
  let insertBefore = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      insertBefore = el;
      break;
    }
  }
  if (insertBefore) {
    if (placeholder.nextSibling !== insertBefore) wrap.insertBefore(placeholder, insertBefore);
  } else {
    const last = candidates[candidates.length - 1];
    if (last && last.nextSibling !== placeholder) last.insertAdjacentElement('afterend', placeholder);
  }
}

function sourceDragAutoScroll(clientY) {
  const wrap = sourceDrag.wrap;
  const scroller = wrap?.closest?.('.sidebar-scroll') || wrap;
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  const edge = 48;
  const maxStep = 22;
  if (clientY < r.top + edge) {
    const t = Math.min(1, (r.top + edge - clientY) / edge);
    scroller.scrollTop -= Math.ceil(maxStep * (0.35 + 0.65 * t));
  } else if (clientY > r.bottom - edge) {
    const t = Math.min(1, (clientY - (r.bottom - edge)) / edge);
    scroller.scrollTop += Math.ceil(maxStep * (0.35 + 0.65 * t));
  }
}

function sourceDragStart(e) {
  const btn = sourceDrag.btn;
  const moveEl = sourceDrag.moveEl || btn;
  const wrap = sourceDrag.wrap;
  if (!btn || !moveEl || !wrap || sourceDrag.active) return;
  sourceDrag.active = true;
  if (typeof sourceDrag.clearSelectTimer === 'function') sourceDrag.clearSelectTimer();

  const rect = btn.getBoundingClientRect();
  sourceDrag.grabY = Math.min(rect.height - 4, Math.max(4, e.clientY - rect.top));
  sourceDrag.fixedLeft = rect.left;

  const placeholder = document.createElement('div');
  placeholder.className = 'source-drag-placeholder';
  placeholder.style.height = `${Math.max(28, rect.height)}px`;
  placeholder.dataset.category = sourceDrag.category;
  moveEl.insertAdjacentElement('beforebegin', placeholder);
  sourceDrag.placeholder = placeholder;

  const ghost = btn.cloneNode(true);
  ghost.classList.add('source-drag-ghost');
  ghost.classList.remove('active', 'dragging', 'is-source-dragging', 'has-active-child');
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  sourceDrag.ghost = ghost;

  moveEl.classList.add('is-source-dragging', 'dragging');
  if (btn !== moveEl) btn.classList.add('is-source-dragging', 'dragging');
  document.body.classList.add('is-source-reordering');
  const scroller = wrap.closest?.('.sidebar-scroll') || document.querySelector('.sidebar-scroll');
  if (scroller) scroller.classList.add('is-source-drag-scroll-lock');

  try { btn.setPointerCapture(e.pointerId); } catch { /* optional */ }
  sourceDragMovePlaceholder(e.clientY);
}

function sourceDragTick() {
  sourceDrag.raf = 0;
  if (!sourceDrag.active) return;
  const y = sourceDrag.pendingY;
  if (sourceDrag.ghost) {
    sourceDrag.ghost.style.left = `${sourceDrag.fixedLeft || 0}px`;
    sourceDrag.ghost.style.top = `${y - sourceDrag.grabY}px`;
  }
  sourceDragAutoScroll(y);
  sourceDragMovePlaceholder(y);
}

function onSourceDragPointerMove(e) {
  if (!sourceDrag.armed && !sourceDrag.active) return;
  if (sourceDrag.pointerId != null && e.pointerId !== sourceDrag.pointerId) return;

  if (!sourceDrag.active) {
    const dx = e.clientX - sourceDrag.startX;
    const dy = e.clientY - sourceDrag.startY;
    // 与 douban 一致：欧氏距离阈值，三指拖常有横向抖动，不按轴过滤
    if (dx * dx + dy * dy < SOURCE_DRAG_THRESHOLD * SOURCE_DRAG_THRESHOLD) return;
    sourceDragStart(e);
  }
  if (!sourceDrag.active) return;

  sourceDrag.pendingY = e.clientY;
  if (!sourceDrag.raf) sourceDrag.raf = requestAnimationFrame(sourceDragTick);
  // 非 passive：抢过侧栏滚动 / 三指系统手势
  e.preventDefault();
}

function collectTopLevelOrderIds(wrap) {
  const orderIds = [];
  for (const el of wrap.children) {
    if (el.classList?.contains('source-drag-placeholder')) continue;
    if (el.classList?.contains('feed-tree')) {
      const gid = el.dataset.treeGroup;
      const children = state.sources
        .filter(src => src.enabled && sourceTreeGroupOf(src)?.id === gid)
        .map(src => src.id);
      if (children[0]) orderIds.push(children[0]);
      continue;
    }
    if (el.matches?.('.feed-item[data-source-id]:not([data-tree-child])')) {
      orderIds.push(el.dataset.sourceId);
    }
  }
  return orderIds;
}

function collectTreeChildOrderIds(wrap) {
  return [...(wrap?.children || [])]
    .filter((el) => el.matches?.('.feed-item[data-source-id]') && !el.classList.contains('source-drag-placeholder'))
    .map((el) => el.dataset.sourceId)
    .filter(Boolean);
}

function onSourceDragPointerEnd(e) {
  if (!sourceDrag.armed && !sourceDrag.active) return;
  if (sourceDrag.pointerId != null && e && e.pointerId != null && e.pointerId !== sourceDrag.pointerId) return;

  if (sourceDrag.raf) {
    cancelAnimationFrame(sourceDrag.raf);
    sourceDrag.raf = 0;
  }

  const wasActive = sourceDrag.active;
  const { wrap, btn, moveEl, placeholder, ghost, pointerId, scope, groupId } = sourceDrag;
  const reloc = moveEl || btn;

  if (wasActive) {
    // 末帧定位
    const y = (e && Number.isFinite(e.clientY)) ? e.clientY : sourceDrag.pendingY;
    sourceDragMovePlaceholder(y);
    if (placeholder && reloc && placeholder.parentNode) {
      placeholder.insertAdjacentElement('beforebegin', reloc);
    }
    if (ghost) {
      if (btn) {
        const r = btn.getBoundingClientRect();
        ghost.style.transition = 'left 140ms ease, top 140ms ease, opacity 120ms ease, transform 140ms ease';
        ghost.style.left = `${r.left}px`;
        ghost.style.top = `${r.top}px`;
        ghost.style.opacity = '0.35';
        ghost.style.transform = 'scale(1)';
        setTimeout(() => ghost.remove(), 150);
      } else {
        ghost.remove();
      }
      sourceDrag.ghost = null;
    }
    try { btn?.releasePointerCapture?.(pointerId); } catch { /* optional */ }

    if (wrap) {
      if (scope === 'tree' && groupId) {
        const childIds = collectTreeChildOrderIds(wrap);
        sourceDragCleanupVisual();
        suppressSourceClickUntil = Date.now() + 420;
        persistTreeChildOrder(groupId, childIds);
        renderSidebar();
      } else {
        const orderIds = collectTopLevelOrderIds(wrap);
        sourceDragCleanupVisual();
        suppressSourceClickUntil = Date.now() + 420;
        persistSourceOrderWithTree(orderIds);
        renderSidebar();
      }
    } else {
      sourceDragCleanupVisual();
      suppressSourceClickUntil = Date.now() + 420;
    }
  } else {
    sourceDragCleanupVisual();
  }
  sourceDragReset();
}

/**
 * @param {HTMLElement} btn 手势与 ghost 源
 * @param {{ id?: string, category?: string }} source
 * @param {HTMLElement} wrap 排序容器
 * @param {() => void} [clearSelectTimer]
 * @param {{ scope?: 'top'|'tree', moveEl?: HTMLElement, groupId?: string }} [opts]
 */
function armSourceDrag(btn, source, wrap, clearSelectTimer, opts = {}) {
  if (!btn || !source || !wrap) return;
  const scope = opts.scope || 'top';
  const moveEl = opts.moveEl || btn;
  const groupId = opts.groupId || '';
  btn.classList.add('feed-item--draggable');
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest?.('.source-rename-input')) return;
    // 残留清理
    if (sourceDrag.armed || sourceDrag.active) onSourceDragPointerEnd({ pointerId: sourceDrag.pointerId });
    sourceDrag.armed = true;
    sourceDrag.active = false;
    sourceDrag.pointerId = e.pointerId;
    sourceDrag.id = source.id || groupId || '';
    sourceDrag.btn = btn;
    sourceDrag.moveEl = moveEl;
    sourceDrag.wrap = wrap;
    sourceDrag.scope = scope;
    sourceDrag.groupId = groupId;
    sourceDrag.category = source.category || btn.dataset.category || moveEl.dataset?.category || 'article';
    sourceDrag.startX = e.clientX;
    sourceDrag.startY = e.clientY;
    sourceDrag.pendingY = e.clientY;
    sourceDrag.clearSelectTimer = clearSelectTimer || null;
  });
}

function bindSourceDragGlobalsOnce() {
  if (window.__qmSourceDragGlobalsBound) return;
  window.__qmSourceDragGlobalsBound = true;
  // 与 douban-showcase 一致：window 级 + passive:false，三指拖才能 preventDefault 住滚动
  window.addEventListener('pointermove', onSourceDragPointerMove, { passive: false });
  window.addEventListener('pointerup', onSourceDragPointerEnd);
  window.addEventListener('pointercancel', onSourceDragPointerEnd);
  window.addEventListener('dragstart', (e) => {
    if (sourceDrag.armed || sourceDrag.active) e.preventDefault();
  }, true);
  window.addEventListener('lostpointercapture', (e) => {
    if (sourceDrag.active && e.pointerId === sourceDrag.pointerId) {
      onSourceDragPointerEnd(e);
    }
  });
}
bindSourceDragGlobalsOnce();

function beginSourceRename(button, source) {
  const label = button && button.querySelector('.fname');
  if (!label || label.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'source-rename-input';
  input.value = source.name;
  input.maxLength = 48;
  label.textContent = '';
  label.appendChild(input);
  button.draggable = false;
  let settled = false;
  const finish = (save) => {
    if (settled) return;
    settled = true;
    if (save) renameSource(source.id, input.value);
    button.draggable = false;
    renderSidebar();
  };
  input.onclick = event => event.stopPropagation();
  input.ondblclick = event => event.stopPropagation();
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function hideSourceContextMenu() {
  const menu = $('#source-context-menu');
  if (menu) menu.classList.add('hidden');
  sourceContextId = '';
}

function showSourceContextMenu(event, source) {
  const menu = $('#source-context-menu');
  if (!menu || !source) return;
  event.preventDefault();
  sourceContextId = source.id;
  const delBtn = menu.querySelector('[data-source-action="delete"]');
  const canDelete = Boolean(
    (typeof isAdmin === 'function' ? isAdmin() : false)
    || (typeof isZenPersonalMode === 'function' ? isZenPersonalMode() : false)
  );
  if (delBtn) delBtn.classList.toggle('hidden', !canDelete);
  menu.classList.remove('hidden');
  const width = 158;
  const visibleCount = [...menu.querySelectorAll('[data-source-action]')].filter(btn => !btn.classList.contains('hidden')).length;
  const height = Math.max(88, 8 + visibleCount * 40);
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
  menu.querySelector('button:not(.hidden)')?.focus();
}

function unreadCountFor(pred) {
  // 全量未读：直接汇总索引
  if (!pred || pred === true || (typeof pred === 'function' && pred.length === 0)) {
    if (state.sourceUnreadMap && state.sourceUnreadMap.size) {
      let n = 0;
      for (const v of state.sourceUnreadMap.values()) n += v;
      return n;
    }
  }
  return entryCatalog().filter(e => pred(e) && !state.read.has(e.id)).length;
}

function sourceTreeGroupOf(sourceOrId) {
  const id = typeof sourceOrId === 'string' ? sourceOrId : (sourceOrId && sourceOrId.id);
  if (!id) return null;
  return SOURCE_TREE_GROUPS.find(g => g.test({ id })) || null;
}

function readSourceTreeOpenMap() {
  const raw = readJson(SOURCE_TREE_OPEN_KEY, '{}');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function isSourceTreeOpen(groupId) {
  const map = readSourceTreeOpenMap();
  if (Object.prototype.hasOwnProperty.call(map, groupId)) return Boolean(map[groupId]);
  return false;
}

function setSourceTreeOpen(groupId, open) {
  const map = readSourceTreeOpenMap();
  map[groupId] = Boolean(open);
  storage.setItem(SOURCE_TREE_OPEN_KEY, JSON.stringify(map));
}

/**
 * 选中分组内子源时展开该组（只在选中变化时调用，不覆盖用户手动折叠）。
 * 旧逻辑在 render 时 forceOpen，导致「选中子源后点标题无法折叠」。
 */
function ensureTreeOpenForSource(sourceId) {
  const g = sourceTreeGroupOf(sourceId);
  if (!g) return;
  if (!isSourceTreeOpen(g.id)) setSourceTreeOpen(g.id, true);
  const wrap = $('#feed-groups');
  if (!wrap || !state.sidebarBuilt) return;
  let tree = null;
  try {
    tree = wrap.querySelector(`.feed-tree[data-tree-group="${CSS.escape(g.id)}"]`);
  } catch {
    tree = wrap.querySelector(`.feed-tree[data-tree-group="${g.id}"]`);
  }
  if (!tree) return;
  tree.classList.add('is-open');
  const body = tree.querySelector('.feed-tree-children');
  if (body) body.hidden = false;
  const head = tree.querySelector('.feed-tree-head');
  if (head) {
    head.setAttribute('aria-expanded', 'true');
    head.classList.toggle('has-active-child', Boolean(tree.querySelector('.feed-item.active')));
  }
}

/** 只更新侧栏计数，避免 merge/扫盘后整树销毁重建闪烁 */
function patchSidebarSourceCounts() {
  const wrap = $('#feed-groups');
  if (!wrap || !state.sidebarBuilt) return false;
  wrap.querySelectorAll('.feed-item[data-source-id]').forEach((btn) => {
    const s = sourceById(btn.dataset.sourceId);
    if (!s) return;
    const fcount = btn.querySelector('.fcount');
    if (fcount) fcount.textContent = sourceEntryCount(s) || '';
    const unread = sourceUnreadCount(s);
    const total = sourceEntryCount(s);
    btn.title = unread ? `${s.name} · ${total} 篇 · ${unread} 未读` : `${s.name} · ${total} 篇`;
  });
  wrap.querySelectorAll('.feed-tree').forEach((tree) => {
    const gid = tree.dataset.treeGroup;
    const group = SOURCE_TREE_GROUPS.find(g => g.id === gid);
    if (!group) return;
    const children = (state.sources || []).filter(s => s.enabled && group.test(s));
    const total = children.reduce((n, s) => n + sourceEntryCount(s), 0);
    const unread = children.reduce((n, s) => n + sourceUnreadCount(s), 0);
    const fcount = tree.querySelector('.feed-tree-head .fcount');
    if (fcount) fcount.textContent = total || '';
    const head = tree.querySelector('.feed-tree-head');
    if (head) {
      head.title = unread
        ? `${group.name} · ${children.length} 个源 · ${total} 篇 · ${unread} 未读`
        : `${group.name} · ${children.length} 个源 · ${total} 篇`;
    }
  });
  return true;
}

/**
 * 将源列表折叠为树节点：flat source 或 group(含 children)。
 * 分组出现在其首个子源在排序中的位置。
 */
function buildSourceTreeNodes(list) {
  const membersByGroup = new Map();
  for (const g of SOURCE_TREE_GROUPS) {
    membersByGroup.set(g.id, list.filter(s => g.test(s)));
  }
  const nodes = [];
  const emitted = new Set();
  for (const s of list) {
    const g = sourceTreeGroupOf(s);
    if (!g) {
      nodes.push({ type: 'source', source: s });
      continue;
    }
    if (emitted.has(g.id)) continue;
    emitted.add(g.id);
    const children = membersByGroup.get(g.id) || [];
    if (!children.length) continue;
    nodes.push({ type: 'group', group: g, children });
  }
  return nodes;
}

/** 可投稿源：进入源后列表顶栏才显示「+」 */
function sourceSubmitAction(s) {
  if (!s) return null;
  if (s.id === 'user-submitted') {
    return { mode: 'article', title: '加入个人精选' };
  }
  if (s.id === 'github-projects' || s.contentKind === 'repo') {
    return { mode: 'repo', title: '加入 GitHub 项目' };
  }
  return null;
}

function bindSourceFeedItem(btn, s, { child = false, wrap, treeBody = null, groupId = '' } = {}) {
  btn.type = 'button';
  const isSyllabusSrc = s.id === 'zen-recent' || s.contentKind === 'syllabus';
  btn.className = 'feed-item'
    + (child ? ' feed-item--child' : '')
    + (isSyllabusSrc ? ' feed-item--syllabus' : '')
    + (state.filterSource === s.id ? ' active' : '');
  btn.dataset.sourceId = s.id;
  btn.dataset.category = s.category;
  if (isSyllabusSrc) btn.dataset.contentKind = 'syllabus';
  if (child) btn.dataset.treeChild = '1';
  btn.draggable = false;
  const total = sourceEntryCount(s);
  const unread = sourceUnreadCount(s);
  const countLabel = total || '';
  // 课程库：强调「课数」，不强调未读收件箱心智
  btn.title = isSyllabusSrc
    ? `${s.name} · 本地课程大纲库 · ${total || 0} 门 · 不进全部`
    : (unread ? `${s.name} · ${total} 篇 · ${unread} 未读` : `${s.name} · ${total} 篇`);
  btn.innerHTML = `${sourceFaviconHtml(s)}
    <span class="fname" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
    ${s.status === 'error' ? '<span class="err-dot" title="抓取失败"></span>' : ''}
    <span class="fcount">${countLabel}</span>`;
  let selectTimer = null;
  btn.onclick = event => {
    if (Date.now() < suppressSourceClickUntil || event.target.closest('.source-rename-input') || event.detail > 1) return;
    clearTimeout(selectTimer);
    // 切换到其它源：立即生效。再点当前源（取消筛选）才短延迟，避免与双击重命名冲突
    if (state.filterSource === s.id) {
      selectTimer = setTimeout(() => selectSource(s.id), 200);
      return;
    }
    selectSource(s.id);
  };
  btn.ondblclick = event => {
    clearTimeout(selectTimer);
    event.preventDefault();
    event.stopPropagation();
    beginSourceRename(btn, s);
  };
  btn.oncontextmenu = event => showSourceContextMenu(event, s);
  // 顶层源：在 #feed-groups 排序；树子源：在 .feed-tree-children 内排序
  if (child) {
    if (treeBody && groupId) {
      armSourceDrag(btn, s, treeBody, () => clearTimeout(selectTimer), {
        scope: 'tree',
        moveEl: btn,
        groupId,
      });
    }
    return;
  }
  armSourceDrag(btn, s, wrap, () => clearTimeout(selectTimer), { scope: 'top', moveEl: btn });
}

/** 拖拽后合并顺序：顶层锚点 + 各树分组内部原有相对序 */
function persistSourceOrderWithTree(anchorIds) {
  const anchors = [...new Set((anchorIds || []).filter(Boolean))];
  const prev = Array.isArray(readJson(SOURCE_ORDER_KEY, '[]')) ? readJson(SOURCE_ORDER_KEY, '[]') : [];
  const enabled = state.sources.filter(s => s.enabled);
  const byGroup = new Map();
  for (const g of SOURCE_TREE_GROUPS) {
    const members = enabled.filter(s => g.test(s)).map(s => s.id);
    // 保持 prev 内相对序，其余按当前 applySourcePreferences 序
    const prevRank = new Map(prev.map((id, i) => [id, i]));
    members.sort((a, b) => {
      const ar = prevRank.has(a) ? prevRank.get(a) : Number.MAX_SAFE_INTEGER;
      const br = prevRank.has(b) ? prevRank.get(b) : Number.MAX_SAFE_INTEGER;
      return ar - br || a.localeCompare(b);
    });
    byGroup.set(g.id, members);
  }
  const result = [];
  const placed = new Set();
  for (const id of anchors) {
    const g = sourceTreeGroupOf(id);
    if (g) {
      for (const mid of (byGroup.get(g.id) || [])) {
        if (!placed.has(mid)) {
          result.push(mid);
          placed.add(mid);
        }
      }
      continue;
    }
    if (!placed.has(id)) {
      result.push(id);
      placed.add(id);
    }
  }
  for (const s of enabled) {
    if (!placed.has(s.id)) result.push(s.id);
  }
  persistSourceOrder(result);
}

/** 分组内子源重排：替换该组在 order 中的相对序，保留组外锚点位置 */
function persistTreeChildOrder(groupId, childIds) {
  const group = SOURCE_TREE_GROUPS.find(g => g.id === groupId);
  if (!group) return;
  const prev = Array.isArray(readJson(SOURCE_ORDER_KEY, '[]')) ? readJson(SOURCE_ORDER_KEY, '[]') : [];
  const enabled = state.sources.filter(s => s.enabled);
  const memberSet = new Set(enabled.filter(s => group.test(s)).map(s => s.id));
  if (!memberSet.size) return;

  const orderedChildren = [];
  for (const id of childIds || []) {
    if (memberSet.has(id) && !orderedChildren.includes(id)) orderedChildren.push(id);
  }
  for (const id of memberSet) {
    if (!orderedChildren.includes(id)) orderedChildren.push(id);
  }

  const result = [];
  const placed = new Set();
  let groupEmitted = false;
  for (const id of prev) {
    if (memberSet.has(id)) {
      if (!groupEmitted) {
        for (const mid of orderedChildren) {
          result.push(mid);
          placed.add(mid);
        }
        groupEmitted = true;
      }
      continue;
    }
    if (!placed.has(id)) {
      result.push(id);
      placed.add(id);
    }
  }
  if (!groupEmitted) {
    for (const mid of orderedChildren) {
      if (!placed.has(mid)) {
        result.push(mid);
        placed.add(mid);
      }
    }
  }
  for (const s of enabled) {
    if (!placed.has(s.id)) result.push(s.id);
  }
  persistSourceOrder(result);
}

function renderSourceTreeGroup(wrap, group, children, category) {
  // 仅读用户展开记忆；选中子源时的展开由 ensureTreeOpenForSource 负责
  const open = isSourceTreeOpen(group.id);

  const tree = document.createElement('div');
  tree.className = 'feed-tree' + (open ? ' is-open' : '');
  tree.dataset.treeGroup = group.id;
  tree.dataset.category = category;

  const total = children.reduce((n, s) => n + sourceEntryCount(s), 0);
  const unread = children.reduce((n, s) => n + sourceUnreadCount(s), 0);
  const childActive = children.some(s => s.id === state.filterSource);
  const iconSrc = children[0]
    ? { siteUrl: children[0].siteUrl, name: group.name, icon: group.iconFallback || children[0].icon }
    : { siteUrl: '', name: group.name, icon: group.iconFallback || '' };

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'feed-item feed-tree-head' + (childActive ? ' has-active-child' : '');
  head.dataset.treeGroup = group.id;
  head.dataset.category = category;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.title = unread
    ? `${group.name} · ${children.length} 个源 · ${total} 篇 · ${unread} 未读`
    : `${group.name} · ${children.length} 个源 · ${total} 篇`;
  // 无箭头；靠文件夹名 + 可点标题暗示可展开，左侧与普通 feed-item 对齐
  head.innerHTML = `
    ${sourceFaviconHtml(iconSrc)}
    <span class="fname" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</span>
    <span class="fcount">${total || ''}</span>`;
  head.onclick = (event) => {
    if (Date.now() < suppressSourceClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
    const next = !isSourceTreeOpen(group.id);
    // 允许在子源仍选中时折叠；就地切换，禁止整栏 rebuild 闪烁
    setSourceTreeOpen(group.id, next);
    tree.classList.toggle('is-open', next);
    body.hidden = !next;
    head.setAttribute('aria-expanded', next ? 'true' : 'false');
  };
  // 拖整组：moveEl 为 .feed-tree，锚点取首个子源 id
  const anchorSource = children[0] || { id: group.id, category };
  armSourceDrag(head, anchorSource, wrap, null, {
    scope: 'top',
    moveEl: tree,
    groupId: group.id,
  });
  tree.appendChild(head);

  const body = document.createElement('div');
  body.className = 'feed-tree-children';
  body.hidden = !open;
  for (const s of children) {
    const btn = document.createElement('button');
    bindSourceFeedItem(btn, s, { child: true, wrap, treeBody: body, groupId: group.id });
    body.appendChild(btn);
  }
  tree.appendChild(body);
  wrap.appendChild(tree);
}

function updateSidebarNavCounts() {
  const setCount = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value || '';
  };
  setCount('#count-all', entryCatalog().length);
  setCount('#count-hot', hotEntryCount());
  setCount('#count-unread', unreadCountFor(() => true));
  setCount('#count-starred', state.starred.size);
  setCount('#count-history', state.history.size);
  setCount('#count-contributors', state.contributors.length);
}

/** 切源时只改 active class，不整树销毁重建 */
function updateSidebarSelection() {
  const wrap = $('#feed-groups');
  if (!wrap || !state.sidebarBuilt) {
    renderSidebar();
    return;
  }
  wrap.querySelectorAll('.feed-item[data-source-id]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sourceId === state.filterSource);
  });
  wrap.querySelectorAll('.feed-tree').forEach((tree) => {
    const head = tree.querySelector('.feed-tree-head');
    if (!head) return;
    const hasActive = Boolean(tree.querySelector('.feed-item.active'));
    head.classList.toggle('has-active-child', hasActive);
    // 不再在此强制展开：避免「折叠后被 updateSidebarSelection 再次撑开」
  });
  $$('.view-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view && !state.filterSource && !state.filterCategory));
  renderSidebarMore();
  renderSourceRefreshButton();
}

function renderSidebar() {
  const groups = { article: [], news: [], podcast: [] };
  for (const s of state.sources) if (s.enabled) groups[s.category]?.push(s);

  const wrap = $('#feed-groups');
  wrap.innerHTML = '';
  for (const [cat, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = CATEGORY_LABELS[cat];
    label.style.cursor = 'pointer';
    label.title = `查看全部${CATEGORY_LABELS[cat]}`;
    label.onclick = () => selectCategory(cat);
    wrap.appendChild(label);

    const nodes = buildSourceTreeNodes(list);
    for (const node of nodes) {
      if (node.type === 'group') {
        renderSourceTreeGroup(wrap, node.group, node.children, cat);
        continue;
      }
      const s = node.source;
      const btn = document.createElement('button');
      bindSourceFeedItem(btn, s, { child: false, wrap });
      wrap.appendChild(btn);
    }
  }

  updateSidebarNavCounts();
  renderAssetDashboard();
  renderSidebarMore();
  state.sidebarBuilt = true;

  $$('.view-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view && !state.filterSource && !state.filterCategory));
}

function renderSidebarMore() {
  const menu = $('#nav-more-menu');
  const toggle = $('#nav-more-toggle');
  if (!menu || !toggle) return;
  const secondaryActive = ['starred', 'history', 'assets'].includes(state.view) && !state.filterSource && !state.filterCategory;
  const open = state.sidebarMoreOpen || secondaryActive;
  menu.classList.toggle('hidden', !open);
  toggle.classList.toggle('active', secondaryActive);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ---------- Entry list ---------- */
function hasEntryAssets(entry) {
  return ASSET_FILTER_TYPES.some(type => assetCountForType(entry, type) > 0);
}

function assetCountForType(entry, type) {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation' || type === 'rewrite') {
    const count = Number(assets[`${type}Count`]) || 0;
    if (count) return count;
    const items = assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
    if (items.length) return items.length;
    return assets[type] ? 1 : 0;
  }
  if (type === 'comments') return Number(assets.comments) || 0;
  if (type === 'annotations') return Number(assets.annotations) || 0;
  if (type === 'chat') return Number(assets.chatMessages) || 0;
  return 0;
}

function entryHasAssetType(entry, type) {
  if (ASSET_FILTER_TYPES.includes(type)) return assetCountForType(entry, type) > 0;
  return hasEntryAssets(entry);
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isCompactViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
}

function sourceNameForEntry(entry) {
  return sourceById(entry && entry.sourceId)?.name || (entry && entry.sourceId) || '';
}

function assetSearchText(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const items = assets.items || {};
  const parts = [];
  for (const type of ASSET_FILTER_TYPES) {
    const preview = previews[type];
    if (!entryHasAssetType(entry, type)) continue;
    if (preview) {
      const display = assetPreviewDisplay(preview);
      parts.push(
        ASSET_TYPE_LABELS[type],
        ASSET_FOCUS_LABELS[type],
        display.label,
        display.text,
        preview.author,
        preview.title,
        preview.model,
        preview.role,
      );
    }
    for (const item of items[type] || []) {
      const display = assetPreviewDisplay(item);
      parts.push(display.label, display.text, item.author, item.title, item.model, item.role);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function entrySearchText(entry, { includeAssets = false } = {}) {
  let host = '';
  try {
    if (entry && entry.link) host = new URL(entry.link).hostname.replace(/^www\./, '');
  } catch { /* ignore */ }
  return [
    entry.title,
    entry.titleZh,
    entry.summary,
    entry.summaryZh,
    entry.author,
    host,
    sourceNameForEntry(entry),
    includeAssets ? assetSearchText(entry) : '',
  ].filter(Boolean).join(' ');
}

/** 是否为课程/大纲条目 */
function isSyllabusEntry(entry) {
  if (!entry) return false;
  if (entry.sourceId === 'zen-recent') return true;
  const src = sourceById(entry.sourceId);
  return Boolean(src && src.contentKind === 'syllabus');
}

/** 当前是否筛选「近期」课程库 */
function isSyllabusSourceFilter() {
  const id = state.filterSource;
  if (!id) return false;
  if (id === 'zen-recent') return true;
  const src = sourceById(id);
  return Boolean(src && src.contentKind === 'syllabus');
}

/** 解析 summary 约定：课名 · 学校 · 学期 … */
function parseSyllabusSummary(entry) {
  const raw = String(entry?.summaryZh || entry?.summary || '').replace(/\s+/g, ' ').trim();
  const bits = raw.split('·').map(s => s.trim()).filter(Boolean);
  const courseName = bits[0] || String(entry?.author || '').replace(/\s+/g, ' ').trim();
  const meta = bits.slice(1);
  const schoolRe = /^(Stanford|UC Berkeley|Berkeley|CMU|UCSD|MIT|UVA|Harvard|Princeton|NTU|UC\s*Berkeley|斯坦福|斯坦福大学|伯克利|加州大学伯克利分校|卡内基梅隆|卡内基梅隆大学|加州大学圣迭戈分校|麻省理工|弗吉尼亚|弗吉尼亚大学)$/i;
  const termRe = /^(Spring|Fall|Winter|Summer|Autumn)\s+20\d{2}$|^\d{4}\s+Lectures?$|^20\d{2}$|^(春季|秋季|冬季|夏季)\s*20\d{2}|^20\d{2}\s*年\s*(春|秋|冬|夏)/i;
  let school = '';
  let term = '';
  for (const bit of meta) {
    if (!school && schoolRe.test(bit)) school = bit.replace(/^Berkeley$/i, 'UC Berkeley');
    else if (!term && termRe.test(bit)) term = bit;
  }
  if (!school && meta[0] && !/\.(edu|io|com|org|me|net)/i.test(meta[0]) && !/^https?:/i.test(meta[0])) {
    school = meta[0];
  }
  if (!term) {
    const t = meta.find(b => /20\d{2}|Spring|Fall|Winter|Summer|Autumn|春|秋|冬|夏/i.test(b) && b !== school);
    if (t) term = t;
  }
  return { courseName, school, term, meta, bits, raw };
}

function syllabusEntryKindLabel(entry) {
  const title = String(entry?.titleZh || entry?.title || '');
  const summary = String(entry?.summaryZh || entry?.summary || '');
  const link = String(entry?.link || '');
  const haystack = `${title} ${summary} ${link}`;
  if (/paper|论文|huggingface\.co\/papers/i.test(haystack)) return '论文库';
  if (/bilibili|b23\.tv|视频课|课程合集/i.test(haystack)) return '视频课';
  if (isSyllabusCourseCode(entry?.title)) return '课程大纲';
  if (/course|课程|lecture|课堂/i.test(haystack)) return '课程';
  return '学习站点';
}

/** 是否为课号标题（CS336 / CME295 / 11-785），有课号才双行：课号 + 课名 */
function isSyllabusCourseCode(title) {
  const t = String(title || '').trim();
  if (!t || t.length > 20 || /[\u4e00-\u9fff]/.test(t)) return false;
  return /^[A-Z]{2,}\s*\d+[A-Z]?$/i.test(t) || /^\d{2}-\d{3}(?:\/\d{2}-\d{3})?$/.test(t);
}

/** 列表卡摘要：有课号时给中文课名；无课号且标题已是课名则空（不显示两遍） */
function syllabusCardSummary(entry, syl = null) {
  const parsed = syl || parseSyllabusSummary(entry);
  let name = String(parsed.courseName || '').replace(/\s+/g, ' ').trim();
  const title = String(entry?.title || '').trim();
  const titleZh = String(entry?.titleZh || '').trim();
  // summary 第一段若其实是学校/学期/域名，改用 titleZh
  const looksLikeMeta = !name
    || /大学|学院|Stanford|Berkeley|CMU|MIT|UVA|UCSD|20\d{2}|春季|秋季|冬季|夏季/i.test(name)
    || /\.(edu|io|com|org|me|net)$/i.test(name)
    || name === title
    || name === titleZh;
  if (looksLikeMeta) {
    if (titleZh && titleZh !== title && /[\u4e00-\u9fff]/.test(titleZh)) name = titleZh;
    else if (parsed.bits && parsed.bits.length > 1) {
      const alt = parsed.bits.find((b) => b
        && b !== parsed.school
        && b !== parsed.term
        && !/大学|学院|Stanford|Berkeley|20\d{2}|春季|秋季/i.test(b)
        && !/\.(edu|io|com|org|me|net)/i.test(b));
      if (alt) name = alt;
    } else {
      name = '';
    }
  }
  // 无课号：列表主标题会是中文课名 → 摘要不要再写一遍
  if (!isSyllabusCourseCode(title)) {
    const displayTitle = titleZh || title;
    if (!name || name === displayTitle || name === title || name === titleZh) return '';
    return name;
  }
  // 有课号：摘要给中文课名（与课号不同才显示）
  if (!name || name === title) name = titleZh && titleZh !== title ? titleZh : '';
  if (name === title) return '';
  return name || '';
}

function formatSyllabusReaderMeta(entry) {
  const syl = parseSyllabusSummary(entry);
  // 阅读区 meta：课名优先；不堆叠重复学校
  const name = syllabusCardSummary(entry, syl) || syl.courseName;
  if (name) return name;
  return String(entry?.summaryZh || entry?.summary || entry?.author || '课程入口')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryMatchesSearch(entry, { includeAssets = false } = {}) {
  const needle = normalizeSearchText(state.q);
  if (!needle) return true;
  return normalizeSearchText(entrySearchText(entry, { includeAssets })).includes(needle);
}

function contributorSearchText(contributor) {
  return [
    contributor.displayName,
    `${contributor.assetCount || 0} 条`,
    `${contributor.helpfulCount || 0} 有用`,
    `${contributor.helpfulAssets || 0} 受认可`,
    `${contributor.translationCount || 0} 中译`,
    `${contributor.rewriteCount || 0} 重写`,
    `${contributor.annotationCount || 0} 划线`,
    `${contributor.commentCount || 0} 点评`,
    `${contributor.chatCount || 0} 对话`,
  ].filter(Boolean).join(' ');
}

function visibleContributors() {
  const needle = normalizeSearchText(state.q);
  return (state.contributors || [])
    .filter(contributor => !needle || normalizeSearchText(contributorSearchText(contributor)).includes(needle));
}

function applySyllabusCourseOrder(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const saved = readJson(COURSE_ORDER_KEY, '[]');
  const ids = Array.isArray(saved) ? saved.filter(Boolean) : [];
  if (!ids.length) return list;
  const rank = new Map(ids.map((id, index) => [String(id), index]));
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aid = String(a.entry?.id || '');
      const bid = String(b.entry?.id || '');
      const ar = rank.has(aid) ? rank.get(aid) : Number.MAX_SAFE_INTEGER;
      const br = rank.has(bid) ? rank.get(bid) : Number.MAX_SAFE_INTEGER;
      return (ar - br) || (a.index - b.index);
    })
    .map(item => item.entry);
}

function persistSyllabusCourseOrder(ids) {
  const order = [...new Set((ids || []).map(String).filter(Boolean))];
  storage.setItem(COURSE_ORDER_KEY, JSON.stringify(order));
}

function visibleEntries() {
  let list = state.entries;
  if (state.view === 'hot') {
    // 课程库无互动热度：退回目录序
    if (isSyllabusSourceFilter()) {
      // keep pin order (publishedTs)
    } else if (!state.q && !state.filterSource && !state.filterCategory
      && state.hotEntriesCached && state.hotEntriesCached.length) {
      list = state.hotEntriesCached;
    } else {
      const scored = list.map(e => ({
        e,
        score: entryQualityScore(e),
        ts: Number(e.publishedTs) || 0,
      }));
      scored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
      list = scored.slice(0, 80).map(item => item.e);
    }
  }
  // 未读：仅手动标已读后才过滤；开文不自动已读
  if (state.view === 'unread') list = list.filter(e => !state.read.has(e.id));
  if (state.view === 'starred') list = list.filter(e => state.starred.has(e.id));
  if (state.view === 'history') {
    list = list
      .filter(e => state.history.has(e.id))
      .slice()
      .sort((a, b) => (Number(state.history.get(b.id)) || 0) - (Number(state.history.get(a.id)) || 0));
  }
  if (state.view === 'assets') {
    list = list
      .filter(hasEntryAssets)
      .filter(entry => !state.assetFilter || entryHasAssetType(entry, state.assetFilter))
      .filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      .slice()
      .sort(compareAssetEntries);
  }
  if (isSyllabusSourceFilter()) list = applySyllabusCourseOrder(list);
  return list;
}

function sourceById(id) {
  if (!id) return null;
  if (state.sourceMap && state.sourceMap.size) {
    return state.sourceMap.get(id) || null;
  }
  return state.sources.find(s => s.id === id) || null;
}

function entryAssetItems(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const items = [];
  if (assets.translation) items.push({ type: 'translation', label: '中文翻译', count: 0, title: '查看中文翻译' });
  if (assets.rewrite) items.push({ type: 'rewrite', label: '中文改写', count: 0, title: '查看中文改写' });
  if (assets.annotations) items.push({ type: 'annotations', label: '划线点评', count: Number(assets.annotations) || 0, title: '查看划线点评' });
  if (assets.comments) items.push({ type: 'comments', label: '人工点评', count: Number(assets.comments) || 0, title: '查看人工点评' });
  if (assets.chatMessages) items.push({ type: 'chat', label: '文章对话', count: Number(assets.chatMessages) || 0, title: '查看文章对话' });
  return items;
}

const ASSET_ICON_NAMES = {
  translation: 'languages',
  rewrite: 'sparkles',
  annotations: 'highlighter',
  comments: 'message-square-text',
  chat: 'bot',
};

function assetBadgeContent(item) {
  const icon = ASSET_ICON_NAMES[item.type] || 'boxes';
  const count = Number(item.count || 0);
  return `${lucideIcon(icon, { className: 'app-icon asset-badge-icon' })}${count ? `<span class="asset-badge-count">${formatCompactCount(count)}</span>` : ''}`;
}

function assetBadgesHtml(entry, { interactive = false, copyable = false } = {}) {
  return entryAssetItems(entry).map(item => {
    const cls = `asset-badge asset-${item.type}${interactive ? ' asset-jump' : ''}`;
    const accessibleLabel = item.count ? `${item.label} ${formatCompactCount(item.count)}` : item.label;
    const content = assetBadgeContent(item);
    if (!interactive) return `<span class="${cls}" title="${escapeHtml(accessibleLabel)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</span>`;
    const badge = `<button type="button" class="${cls}" data-asset="${item.type}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</button>`;
    if (!copyable) return badge;
    const label = ASSET_FOCUS_LABELS[item.type] || accessibleLabel;
    return `<span class="asset-badge-group">${badge}<button type="button" class="asset-badge-copy" data-asset-copy="${item.type}" title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button></span>`;
  }).join('');
}

const ASSET_TYPE_LABELS = {
  translation: '中译',
  rewrite: '重写',
  annotations: '划线',
  comments: '点评',
  chat: '对话',
};

const ASSET_DIRECTORY_LABELS = {
  translation: '中文翻译',
  rewrite: '中文改写',
  annotations: '划线点评',
  comments: '人工点评',
  chat: '文章对话',
};

function assetDirectoryLabel(type) {
  return ASSET_DIRECTORY_LABELS[type] || ASSET_TYPE_LABELS[type] || '公开';
}

const ASSET_FILTERS = {
  translation: { label: '中译', count: entry => assetCountForType(entry, 'translation'), title: '查看有中文翻译的文章' },
  rewrite: { label: '重写', count: entry => assetCountForType(entry, 'rewrite'), title: '查看有中文改写的文章' },
  annotations: { label: '划线', count: entry => assetCountForType(entry, 'annotations'), title: '查看有划线点评的文章' },
  comments: { label: '点评', count: entry => assetCountForType(entry, 'comments'), title: '查看有人工点评的文章' },
  chat: { label: '对话', count: entry => assetCountForType(entry, 'chat'), title: '查看有文章对话的文章' },
};

const ASSET_SORTS = {
  latest: { label: '最新', title: '按最近沉淀时间排序' },
  helpful: { label: '有用', title: '优先显示被读者标记有用的 AI 资产、点评和对话' },
};

const CONTRIBUTOR_SORTS = {
  latest: { label: '最新', title: '按最近沉淀公开资产的时间排序' },
  helpful: { label: '有用', title: '优先显示获得读者有用反馈的贡献主页' },
  assets: { label: '资产', title: '优先显示公开资产数量更多的贡献主页' },
};

function normalizeContributorSort(sort = '') {
  return CONTRIBUTOR_SORTS[sort] ? sort : 'latest';
}

function normalizeAssetSort(sort = '') {
  return sort === 'helpful' ? 'helpful' : 'latest';
}

function normalizeContributorAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeUserAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeDashboardTab(tab = '') {
  return DASHBOARD_TABS.includes(tab) ? tab : 'profile';
}

function assetTypeCount(entries, type) {
  const def = ASSET_FILTERS[type];
  if (!def) return 0;
  return entries.reduce((sum, entry) => sum + def.count(entry), 0);
}

function assetTotalCount(entries) {
  return Object.keys(ASSET_FILTERS).reduce((sum, type) => sum + assetTypeCount(entries, type), 0);
}

function assetLatestAtForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (!type) return Number(assets.latestAt || 0);
  const itemAt = Number((assets.items && assets.items[type] && assets.items[type][0] && assets.items[type][0].at) || 0);
  const previewAt = Number((assets.previews && assets.previews[type] && assets.previews[type].at) || 0);
  return Math.max(itemAt, previewAt);
}

function assetHelpfulScoreForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return Number(assets.translationHelpfulCount) || 0;
  if (type === 'rewrite') return Number(assets.rewriteHelpfulCount) || 0;
  if (type === 'annotations') return Number(assets.annotationHelpfulCount) || 0;
  if (type === 'comments') return Number(assets.commentHelpfulCount ?? assets.helpfulCount) || 0;
  if (type === 'chat') return Number(assets.chatHelpfulCount) || 0;
  return Number(assets.helpfulCount) || 0;
}

function assetHelpfulItemCount(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return helpfulAiAssetItemCount(assets, 'translation');
  if (type === 'rewrite') return helpfulAiAssetItemCount(assets, 'rewrite');
  if (type === 'annotations') return Number(assets.helpfulAnnotations) || 0;
  if (type === 'comments') return Number(assets.helpfulComments) || 0;
  if (type === 'chat') return Number(assets.helpfulChats) || 0;
  return helpfulAiAssetItemCount(assets, 'translation')
    + helpfulAiAssetItemCount(assets, 'rewrite')
    + (Number(assets.helpfulAnnotations) || 0)
    + (Number(assets.helpfulComments) || 0)
    + (Number(assets.helpfulChats) || 0);
}

function compareAssetEntries(a, b) {
  const latestDelta = assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter);
  if (state.assetSort === 'helpful') {
    const helpfulDelta = assetHelpfulScoreForType(b, state.assetFilter) - assetHelpfulScoreForType(a, state.assetFilter);
    if (helpfulDelta) return helpfulDelta;
    const helpfulCommentDelta = assetHelpfulItemCount(b, state.assetFilter) - assetHelpfulItemCount(a, state.assetFilter);
    if (helpfulCommentDelta) return helpfulCommentDelta;
  }
  return latestDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
}

function assetDashboardStats() {
  const entries = state.entries.filter(hasEntryAssets);
  const latest = entries
    .slice()
    .sort((a, b) => Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0))[0] || null;
  const counts = Object.fromEntries(Object.keys(ASSET_FILTERS).map(type => [type, assetTypeCount(entries, type)]));
  const helpfulTotal = entries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry), 0);
  const helpfulEntries = entries.reduce((sum, entry) => sum + (assetHelpfulScoreForType(entry) > 0 ? 1 : 0), 0);
  return {
    entries,
    latest,
    counts,
    helpfulEntries,
    helpfulTotal,
    totalAssets: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function renderAssetDashboard() {
  const dashboard = $('#asset-dashboard');
  if (!dashboard) return;
  dashboard.classList.add('hidden');
}

function assetActivityLabel(entry) {
  if (state.view !== 'assets') return '';
  const assets = entry && entry.assets ? entry.assets : {};
  if (state.assetSort === 'helpful' && assetHelpfulScoreForType(entry, state.assetFilter) > 0) {
    const helpful = assetHelpfulScoreForType(entry, state.assetFilter);
    const latest = assetLatestAtForType(entry, state.assetFilter);
    return `有用 ${helpful} 次${latest ? ` · 最近沉淀 ${formatAssetTime(latest)}` : ''}`;
  }
  if (state.assetFilter) {
    const filteredAt = assetLatestAtForType(entry, state.assetFilter);
    if (!filteredAt) return '';
    const filteredLabel = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
    return `${filteredLabel} · 最近沉淀 ${formatAssetTime(filteredAt)}`;
  }
  if (!assets.latestAt) return '';
  const types = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const labels = types.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean);
  const prefix = labels.length ? labels.join(' / ') : '资产';
  return `${prefix} · 最近沉淀 ${formatAssetTime(assets.latestAt)}`;
}

function entryHistoryLabel(entry) {
  if (state.view !== 'history' || !entry || !state.history.has(entry.id)) return '';
  return `最近阅读 ${formatAssetTime(state.history.get(entry.id))}`;
}

function hotEntryLabel(entry) {
  if (state.view !== 'hot') return '';
  const q = qScoreParts(entry);
  const stats = entryStats(entry);
  const parts = [
    `QScore ${q.score.toFixed(1)}`,
    stats.likeCount ? `赞 ${formatCompactCount(stats.likeCount)}` : '',
    stats.dislikeCount ? `负反馈 ${formatCompactCount(stats.dislikeCount)}` : '',
    stats.favoriteCount ? `收藏 ${formatCompactCount(stats.favoriteCount)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function assetPreviewForEntry(entry) {
  if (state.view !== 'assets') return null;
  if (
    state.assetSort === 'helpful'
    && !state.assetFilter
    && entry?.assets?.topHelpfulAsset
  ) {
    return entry.assets.topHelpfulAsset;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'translation'
    && entry?.assets?.topHelpfulTranslation
  ) {
    return entry.assets.topHelpfulTranslation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'rewrite'
    && entry?.assets?.topHelpfulRewrite
  ) {
    return entry.assets.topHelpfulRewrite;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'annotations'
    && entry?.assets?.topHelpfulAnnotation
  ) {
    return entry.assets.topHelpfulAnnotation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'comments'
    && entry?.assets?.topHelpfulComment
  ) {
    return entry.assets.topHelpfulComment;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'chat'
    && entry?.assets?.topHelpfulChat
  ) {
    return entry.assets.topHelpfulChat;
  }
  return assetPreviewForType(entry, state.assetFilter);
}

function assetPreviewForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const preview = type && previews[type] ? previews[type] : assets.preview;
  if (!preview || !preview.type || !preview.text) return null;
  return preview;
}

function assetPreviewDisplay(preview) {
  const type = ASSET_FILTER_TYPES.includes(preview && preview.type) ? preview.type : 'comments';
  const baseLabel = ASSET_TYPE_LABELS[type] || '资产';
  if (type === 'comments') {
    const display = commentDisplayParts(preview.text);
    return {
      type,
      label: display.label ? `${baseLabel} · ${display.label}` : baseLabel,
      text: display.body || preview.text,
      commentType: display.type,
    };
  }
  if (type === 'chat') {
    const roleLabel = preview.role === 'user' ? '提问' : preview.role === 'assistant' ? '回答' : '';
    return {
      type,
      label: roleLabel ? `${baseLabel} · ${roleLabel}` : baseLabel,
      text: preview.text,
      commentType: '',
    };
  }
  return {
    type,
    label: baseLabel,
    text: preview.text,
    commentType: '',
  };
}

function assetPreviewHtml(preview) {
  const display = assetPreviewDisplay(preview);
  const { type, label } = display;
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean).join(' · ');
  const itemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const copyItemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  return `
    <div class="entry-asset-preview-row">
      <button type="button" class="entry-asset-preview asset-preview-${type}" data-asset="${escapeHtml(type)}"${itemId} title="查看${escapeHtml(label)}资产">
        <span class="entry-asset-preview-type">${escapeHtml(label)}</span>
        <span class="entry-asset-preview-text">${escapeHtml(display.text)}</span>
        ${meta ? `<span class="entry-asset-preview-meta">${escapeHtml(meta)}</span>` : ''}
      </button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy-content="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}内容" aria-label="复制${escapeHtml(label)}内容">${lucideIcon('file-text')}</button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button>
    </div>`;
}

function assetItemListHtml(entry) {
  if (state.view !== 'assets' || !ASSET_FILTER_TYPES.includes(state.assetFilter)) return '';
  const assets = entry && entry.assets ? entry.assets : {};
  let items = (assets.items && assets.items[state.assetFilter]) || [];
  if (state.assetSort === 'helpful') {
    const top = state.assetFilter === 'chat'
      ? assets.topHelpfulChat
      : state.assetFilter === 'translation'
        ? assets.topHelpfulTranslation
        : state.assetFilter === 'rewrite'
          ? assets.topHelpfulRewrite
          : state.assetFilter === 'annotations'
            ? assets.topHelpfulAnnotation
            : assets.topHelpfulComment;
    const byId = new Map();
    for (const item of [top, ...items]) {
      const key = item && item.id ? item.id : `${item && item.at}:${item && item.text}`;
      if (item && key && !byId.has(key)) byId.set(key, item);
    }
    items = [...byId.values()]
      .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))
      .slice(0, 3);
  }
  if (!items.length) return '';
  const total = assetCountForType(entry, state.assetFilter);
  const label = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
  const more = total > items.length && ['annotations', 'comments', 'chat'].includes(state.assetFilter)
    ? `<button type="button" class="entry-asset-more" data-asset="${escapeHtml(state.assetFilter)}">查看全部 ${total} 条${escapeHtml(label)}</button>`
    : total > items.length
      ? `<span class="entry-asset-more">还有 ${total - items.length} 条${escapeHtml(label)}</span>`
    : '';
  return `<div class="entry-asset-items">
    ${items.map(item => assetPreviewHtml(item)).join('')}
    ${more}
  </div>`;
}

function entryPrimaryAssetType(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const latestTypes = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const latest = latestTypes.find(type => ASSET_FILTER_TYPES.includes(type) && entryHasAssetType(entry, type));
  if (latest) return latest;
  return ASSET_FILTER_TYPES.find(type => entryHasAssetType(entry, type)) || '';
}

function latestAssetActivity(limit = 4) {
  return state.entries
    .filter(entry => hasEntryAssets(entry) && Number(entry.assets?.latestAt || 0) > 0)
    .slice()
    .sort((a, b) => {
      const assetDelta = Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0);
      return assetDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
    })
    .slice(0, limit)
    .map(entry => {
      const type = entryPrimaryAssetType(entry);
      const latestTypes = Array.isArray(entry.assets?.latestTypes) ? entry.assets.latestTypes : [];
      const labels = latestTypes.map(item => ASSET_TYPE_LABELS[item]).filter(Boolean);
      const preview = assetPreviewForType(entry, type);
      const previewMeta = preview
        ? [preview.author, preview.model].filter(Boolean).join(' · ')
        : '';
      return {
        entry,
        type,
        labels: labels.length ? labels.join(' / ') : (ASSET_TYPE_LABELS[type] || '资产'),
        preview,
        previewMeta,
      };
    });
}

function isHomeScope() {
  return state.view === 'all' && !state.filterSource && !state.filterCategory && !state.q;
}

function homeAssetActivityItems(limit = 24) {
  return latestAssetActivity(limit).filter(item => item.type);
}

function renderEntryPaneTabs() {
  const tabs = $('#entry-pane-tabs');
  if (!tabs) return;
  const show = isHomeScope() && state.entries.length > 0;
  tabs.classList.toggle('hidden', !show);
  if (!show) return;
  const assetCount = homeAssetActivityItems(1000).length;
  const entryCount = state.entries.length;
  $('#home-entry-count').textContent = entryCount;
  $('#home-asset-count').textContent = assetCount;
  $$('#entry-pane-tabs [data-home-tab]').forEach(btn => {
    const active = btn.dataset.homeTab === state.homeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function currentListScope() {
  if (state.view === 'hot') return 'hot';
  if (state.view === 'unread') return 'unread';
  return 'latest';
}

function renderListScopeBar() {
  const bar = $('#list-scope-bar');
  if (!bar) return;
  const hidden = state.view === 'contributors';
  bar.classList.toggle('hidden', hidden);
  if (hidden) return;
  const syllabus = isSyllabusSourceFilter();
  bar.classList.toggle('list-scope-bar--syllabus', syllabus);
  // 课程库是目录，不是收件箱：隐藏未读/热门，强制回到目录序
  if (syllabus && (state.view === 'unread' || state.view === 'hot')) {
    state.view = 'all';
  }
  const active = currentListScope();
  $$('#list-scope-bar [data-list-scope]').forEach(btn => {
    const scope = btn.dataset.listScope;
    if (scope === 'latest') btn.textContent = syllabus ? '目录' : '最新';
    if (scope === 'unread' || scope === 'hot') {
      btn.classList.toggle('hidden', syllabus);
      btn.hidden = syllabus;
    }
    const isActive = scope === active || (syllabus && scope === 'latest' && active === 'latest');
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function selectListScope(scope = 'latest') {
  const next = ['latest', 'hot', 'unread'].includes(scope) ? scope : 'latest';
  const nextView = next === 'latest' ? 'all' : next;
  // 同模式连点：只校正高亮，不重绘
  if (state.view === nextView) {
    renderListScopeBar();
    return;
  }
  state.view = nextView;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  // 未读/最新/热门仅本地筛选：不 loadEntries、不关阅读区、不整侧栏重建（消闪烁）
  state.listWindowStart = 0;
  state.listWindowEnd = 0;
  const listEl = $('#entry-list');
  if (listEl) listEl.scrollTop = 0;
  updateListTitle();
  renderList();
  // 同步侧栏「全部/未读」高亮；侧栏已建好时 O(1) class 切换
  if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
}

function assetActivityItemHtml({ entry, type, labels, preview, previewMeta }, { large = false } = {}) {
  const src = sourceById(entry.sourceId);
  const itemId = preview && preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const previewDisplay = preview ? assetPreviewDisplay(preview) : null;
  const previewText = previewDisplay && previewDisplay.text ? previewDisplay.text : '';
  const labelText = previewDisplay && previewDisplay.commentType && labels === ASSET_TYPE_LABELS.comments
    ? previewDisplay.label
    : labels;
  const helpfulMeta = preview && Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [src && src.name, previewMeta, helpfulMeta, formatAssetTime(entry.assets.latestAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="asset-activity-item${large ? ' asset-activity-item-large' : ''} asset-activity-${type}" data-asset-entry="${escapeHtml(entry.id)}" data-asset-focus="${escapeHtml(type)}"${itemId}>
    <span class="asset-activity-type">${escapeHtml(labelText)}</span>
    <strong>${escapeHtml(entry.titleZh || entry.title || '无标题')}</strong>
    ${previewText ? `<span class="asset-activity-preview">${escapeHtml(previewText)}</span>` : ''}
    <span class="asset-activity-meta">${escapeHtml(meta)}</span>
  </button>`;
}

function renderHomeAssetActivityList(el) {
  const items = homeAssetActivityItems(30);
  el.classList.add('home-asset-activity-list');
  if (!items.length) {
    el.innerHTML = '<div class="list-empty">还没有公开资产动态<br/>翻译、重写、点评或对话后会出现在这里</div>';
    return;
  }
  const { totalAssets, entries, helpfulTotal } = assetDashboardStats();
  el.innerHTML = `
    <div class="home-asset-hero">
      <div>
        <span>公开资产动态</span>
        <strong>${totalAssets} 条资产 · ${entries.length} 篇文章</strong>
        <em>${helpfulTotal ? `读者标记有用 ${helpfulTotal} 次` : '按最新沉淀排序'}</em>
      </div>
      <button type="button" class="ghost-btn" data-asset-open-all>全部资产</button>
    </div>
    <div class="home-asset-activity-grid">
      ${items.map(item => assetActivityItemHtml(item, { large: true })).join('')}
    </div>`;
}

async function openAssetActivityButton(btn) {
  if (!btn) return;
  const entry = state.entries.find(item => item.id === btn.dataset.assetEntry);
  if (!entry) return;
  const focus = btn.dataset.assetFocus;
  const itemId = btn.dataset.assetItemId || '';
  await openEntry(entry, {
    focus,
    aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
    commentId: focus === 'comments' ? itemId : '',
    chatMessageId: focus === 'chat' ? itemId : '',
  });
}

function renderAssetActivityStrip() {
  const el = $('#asset-activity-strip');
  if (!el) return;
  el.classList.remove('asset-filter-strip', 'qscore-strip');
  if (state.view === 'hot') {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  if (state.view === 'assets') {
    const { entries, latest, counts, totalAssets } = assetDashboardStats();
    const total = entries.length;
    const allActiveEntries = state.assetFilter
      ? entries.filter(entry => entryHasAssetType(entry, state.assetFilter))
      : entries;
    const scopedEntries = state.q
      ? allActiveEntries.filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      : allActiveEntries;
    const activeAssetCount = state.assetFilter ? assetTypeCount(scopedEntries, state.assetFilter) : assetTotalCount(scopedEntries);
    const activeEntryCount = scopedEntries.length;
    const activeLabel = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    el.classList.toggle('hidden', !total && !state.assetFilter);
    if (!total && !state.assetFilter) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const activeLatest = scopedEntries
      .slice()
      .sort((a, b) => assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter))[0] || null;
    const activeLatestAt = activeLatest ? assetLatestAtForType(activeLatest, state.assetFilter) : 0;
    const latestTypes = !state.assetFilter && latest && Array.isArray(latest.assets?.latestTypes)
      ? latest.assets.latestTypes.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean)
      : [];
    const latestLabel = state.assetFilter
      ? (ASSET_TYPE_LABELS[state.assetFilter] || '资产')
      : (latestTypes.length ? latestTypes.join(' / ') : '资产');
    const latestText = activeLatestAt
      ? `${latestLabel} · ${formatAssetTime(activeLatestAt)}`
      : '暂无沉淀';
    const activeHelpfulCount = scopedEntries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry, state.assetFilter), 0);
    const sortText = state.assetSort === 'helpful'
      ? (activeHelpfulCount ? `有用 ${activeHelpfulCount} 次` : '暂无有用标记')
      : '按最新沉淀';
    const scopeText = `${activeAssetCount} 条 · ${activeEntryCount} 篇文章`;
    const statusText = state.q
      ? `匹配 ${scopeText} · ${sortText} · ${latestText}`
      : `${scopeText} · ${sortText} · ${latestText}`;
    const feedHref = `${state.assetFilter ? `/assets/${state.assetFilter}.xml` : '/assets.xml'}${state.assetSort === 'helpful' ? '?sort=helpful' : ''}`;
    const sortButtons = Object.entries(ASSET_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.assetSort === sort ? ' active' : ''}" data-asset-sort="${escapeHtml(sort)}" aria-pressed="${state.assetSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    const chips = [
      `<button type="button" class="asset-filter-chip${!state.assetFilter ? ' active' : ''}" data-asset-strip-filter="" title="查看全部公开资产">
        <span>全部</span><strong>${totalAssets}</strong>
      </button>`,
      ...Object.entries(ASSET_FILTERS).map(([type, def]) => {
        const count = counts[type] || 0;
        return `<button type="button" class="asset-filter-chip asset-filter-${type}${state.assetFilter === type ? ' active' : ''}" data-asset-strip-filter="${escapeHtml(type)}" ${count ? '' : 'disabled'} title="${escapeHtml(count ? def.title : '暂无这类资产')}">
          <span>${escapeHtml(def.label)}</span><strong>${count}</strong>
        </button>`;
      }),
    ];
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>${escapeHtml(activeLabel)}</span>
        <strong>${activeAssetCount} 条</strong>
        <em>${escapeHtml(statusText)}</em>
        <button type="button" class="asset-copy-link" data-asset-copy-list title="复制当前资产页链接" aria-label="复制当前资产页链接">${lucideIcon('copy')}</button>
        <a class="asset-feed-link" href="${escapeHtml(feedHref)}" target="_blank" rel="noopener" title="订阅公开资产 RSS">RSS</a>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="公开资产排序">${sortButtons}</div>
      </div>
      <div class="asset-filter-list" aria-label="资产类型筛选">
        ${chips.join('')}
      </div>`;
    return;
  }
  if (state.view === 'contributors') {
    const total = (state.contributors || []).length;
    const list = visibleContributors();
    const contributorCount = list.length;
    const assetCount = list.reduce((sum, contributor) => sum + (Number(contributor.assetCount) || 0), 0);
    const helpfulCount = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) || 0), 0);
    const helpfulContributors = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) > 0 ? 1 : 0), 0);
    const latestAt = list.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
    el.classList.toggle('hidden', !total && !state.q);
    if (!total && !state.q) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const latestText = latestAt ? `最近 ${formatAssetTime(latestAt)}` : '暂无沉淀';
    const sortText = state.contributorSort === 'helpful'
      ? (helpfulCount ? `有用 ${helpfulCount} 次` : '暂无有用标记')
      : state.contributorSort === 'assets'
      ? '按资产数'
      : '按最新沉淀';
    const statusText = state.q
      ? `匹配 ${contributorCount} 人 · ${assetCount} 条资产 · ${sortText} · ${latestText}`
      : `${contributorCount} 人 · ${assetCount} 条资产 · ${helpfulContributors} 人获认可 · ${sortText} · ${latestText}`;
    const sortButtons = Object.entries(CONTRIBUTOR_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.contributorSort === sort ? ' active' : ''}" data-contributor-sort="${escapeHtml(sort)}" aria-pressed="${state.contributorSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>贡献榜</span>
        <strong>${contributorCount} 人</strong>
        <em>${escapeHtml(statusText)}</em>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="贡献榜排序">${sortButtons}</div>
      </div>`;
    return;
  }
  el.classList.add('hidden');
  el.innerHTML = '';
}

function mergeAssets(entry, patch = {}) {
  return {
    translation: false,
    rewrite: false,
    comments: 0,
    annotations: 0,
    chatMessages: 0,
    latestAt: 0,
    latestTypes: [],
    preview: null,
    previews: {},
    items: {},
    translationCount: 0,
    rewriteCount: 0,
    helpfulCount: 0,
    commentHelpfulCount: 0,
    annotationHelpfulCount: 0,
    chatHelpfulCount: 0,
    translationHelpfulCount: 0,
    rewriteHelpfulCount: 0,
    helpfulComments: 0,
    helpfulAnnotations: 0,
    helpfulChats: 0,
    helpfulAssets: 0,
    topHelpfulComment: null,
    topHelpfulAnnotation: null,
    topHelpfulChat: null,
    topHelpfulTranslation: null,
    topHelpfulRewrite: null,
    topHelpfulAsset: null,
    ...(entry && entry.assets ? entry.assets : {}),
    ...patch,
  };
}

function renderReaderAssets(entry = state.activeEntry) {
  const el = $('#reader-assets');
  if (!el) return;
  const html = assetBadgesHtml(entry, { interactive: true });
  el.innerHTML = html;
  // 有 asset badges 时显示，无则隐藏
  el.classList.toggle('hidden', !String(html || '').trim());
}

function setReaderAssetsExpanded(expanded) {
  state.readerAssetsExpanded = Boolean(expanded);
  renderReaderAssetSummary();
}

function updateReaderAssetsToggle(count = 0) {
  const btn = $('#reader-assets-toggle');
  if (!btn) return;
  btn.classList.toggle('hidden', !count);
  btn.disabled = !count;
  btn.setAttribute('aria-expanded', state.readerAssetsExpanded ? 'true' : 'false');
  btn.textContent = state.readerAssetsExpanded ? '收起资产' : `资产导航 ${count}`;
}

function assetMetaLine(parts) {
  return parts.filter(Boolean).join(' · ') || '正在加载详情';
}

function assetSummaryText(value, max = 150) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function readerAssetPreview(entry, type, fallback = '') {
  const direct = assetSummaryText(type === 'comments' ? commentDisplayParts(fallback).body : fallback);
  if (direct) return direct;
  const preview = assetPreviewForType(entry, type);
  return assetSummaryText(preview ? assetPreviewDisplay(preview).text : '');
}

function readerAssetPreviewMeta(entry, type, leading = []) {
  const preview = assetPreviewForType(entry, type);
  if (!preview) return '';
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean);
  return meta.length ? assetMetaLine([...leading, ...meta]) : '';
}

function assetHelpfulMeta(asset) {
  const count = Number(asset && asset.helpfulCount) || 0;
  return count > 0 ? `有用 ${count}` : '';
}

function readerAssetSummaryLabel(entry, type, fallback) {
  const preview = assetPreviewForType(entry, type);
  const display = preview ? assetPreviewDisplay(preview) : null;
  return display && display.commentType ? display.label : fallback;
}

function latestAssetItem(items, pickLast = false) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return pickLast ? list[list.length - 1] : list[0];
}

function renderReaderAssetSummary(entry = state.activeEntry) {
  const el = $('#reader-asset-summary');
  if (!el) return;
  if (!entry) {
    el.classList.add('hidden');
    el.innerHTML = '';
    updateReaderAssetsToggle(0);
    return;
  }
  const assets = mergeAssets(entry);
  const rows = [];
  const translation = state.translation && state.translation.entryId === entry.id ? state.translation : null;
  const rewrite = state.rewrite && state.rewrite.entryId === entry.id ? state.rewrite : null;
  const annotations = (state.annotations || []).filter(annotation => annotation.entryId === entry.id);
  const comments = (state.comments || []).filter(comment => comment.entryId === entry.id);
  const messages = (state.agentMessages || []).filter(message => !message.entryId || message.entryId === entry.id);

  if (assets.translation) {
    const total = assetCountForType(entry, 'translation');
    const firstTranslatedParagraph = translation && Array.isArray(translation.content)
      ? translation.content.map(translationPairText).find(Boolean)
      : '';
    rows.push({
      type: 'translation',
      label: '中文翻译',
      value: translation ? assetMetaLine([total > 1 ? `${total} 条` : '', translation.createdBy, translation.model, assetHelpfulMeta(translation), formatAssetTime(translation.updatedAt)]) : (readerAssetPreviewMeta(entry, 'translation', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'translation', firstTranslatedParagraph),
    });
  }
  if (assets.rewrite) {
    const total = assetCountForType(entry, 'rewrite');
    const copy = rewriteUiCopy(entry);
    rows.push({
      type: 'rewrite',
      label: copy.asset,
      value: rewrite ? assetMetaLine([total > 1 ? `${total} 条` : '', rewrite.createdBy, rewrite.model, assetHelpfulMeta(rewrite), formatAssetTime(rewrite.updatedAt)]) : (readerAssetPreviewMeta(entry, 'rewrite', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'rewrite', rewrite && rewrite.body),
    });
  }
  if (assets.comments) {
    const latest = [...comments].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'comments',
      label: readerAssetSummaryLabel(entry, 'comments', '人工点评'),
      value: latest ? assetMetaLine([`${assets.comments} 条`, latest.author, helpfulMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'comments', [`${assets.comments} 条`]) || `${assets.comments} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'comments', latest && latest.body),
    });
  }
  if (assets.annotations) {
    const latest = [...annotations].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    const replyMeta = latest && Number(latest.replyCount || 0) > 0 ? `回复 ${Number(latest.replyCount || 0)}` : '';
    rows.push({
      type: 'annotations',
      label: readerAssetSummaryLabel(entry, 'annotations', '划线点评'),
      value: latest ? assetMetaLine([`${assets.annotations} 条`, latest.author, ANNOTATION_SURFACE_LABELS[latest.surface], helpfulMeta, replyMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'annotations', [`${assets.annotations} 条`]) || `${assets.annotations} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'annotations', latest && `${latest.quote} ${latest.body}`),
    });
  }
  if (assets.chatMessages) {
    const latest = latestAssetItem(messages, true);
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'chat',
      label: '文章对话',
      value: latest ? assetMetaLine([`${assets.chatMessages} 条`, latest.author, helpfulMeta, formatAssetTime(latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'chat', [`${assets.chatMessages} 条`]) || `${assets.chatMessages} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'chat', latest && latest.content),
    });
  }

  updateReaderAssetsToggle(rows.length);
  el.innerHTML = rows.map(row => `
    <div class="asset-summary-row asset-summary-${row.type}">
      <button type="button" class="asset-summary-item" data-asset-summary="${row.type}">
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(row.value)}</strong>
        ${row.preview ? `<em class="asset-summary-preview">${escapeHtml(row.preview)}</em>` : ''}
      </button>
      <button type="button" class="asset-summary-copy" data-asset-copy="${row.type}" title="复制${escapeHtml(row.label)}链接" aria-label="复制${escapeHtml(row.label)}链接">${lucideIcon('copy')}</button>
    </div>`).join('');
  el.classList.toggle('hidden', !rows.length || !state.readerAssetsExpanded);
  renderArticleInfoPanel();
}

function renderArticleInfoPanel(entry = state.activeEntry) {
  const titleEl = $('#article-info-title');
  const body = $('#article-info-body');
  const workbenchTitle = $('#context-workbench-title');
  if (!entry) {
    if (workbenchTitle) workbenchTitle.textContent = '讨论、伴读和文章信号';
    if (!titleEl || !body) return;
    titleEl.textContent = '未选择文章';
    body.innerHTML = '<div class="article-info-empty">选择一篇文章后，这里会显示来源、链接、资产和反馈信号。</div>';
    return;
  }
  const src = sourceById(entry.sourceId);
  const stats = entryStats(entry);
  const assets = mergeAssets(entry);
  const assetItems = entryAssetItems(entry);
  const qScore = qScoreParts(entry);
  const canonicalUrl = readerUrlFor(entry, state.readerTab, readerShareFocus(), state.readerAssetId).href;
  if (workbenchTitle) workbenchTitle.textContent = plainSnippet(entry.titleZh || entry.title || '当前文章', 28);
  if (!titleEl || !body) return;
  titleEl.textContent = entry.titleZh || entry.title || '无标题';
  const originalState = hasUsableOriginalContent(entry)
    ? '已保存完整原文'
    : entry.originalFetchAttemptedAt
      ? `获取失败 · ${entry.originalFetchError || '可重试'}`
      : '可尝试获取原文';
  const assetRows = assetItems.length
    ? assetItems.map(item => `
      <button type="button" class="article-info-asset asset-${item.type}" data-info-asset="${escapeHtml(item.type)}">
        <span>${escapeHtml(item.type === 'rewrite' ? rewriteUiCopy(entry).asset : (ASSET_FOCUS_LABELS[item.type] || item.label))}</span>
        <strong>${escapeHtml(String(assetCountForType(entry, item.type) || 1))}</strong>
      </button>`).join('')
    : '<span class="article-info-muted">暂无公开资产</span>';
  body.innerHTML = `
    <div class="article-info-group">
      <span class="article-info-label">来源</span>
      <div class="article-info-source">${src ? sourceFaviconHtml(src, 16) : ''}<strong>${escapeHtml(src ? src.name : entry.sourceId || '未知来源')}</strong></div>
      <div class="article-info-meta">${escapeHtml([entry.author, entry.published ? new Date(entry.published).toLocaleString('zh-CN') : ''].filter(Boolean).join(' · ') || '无时间信息')}</div>
    </div>
    <div class="article-info-grid">
      <div><span>访问</span><strong>${escapeHtml(formatCompactCount(stats.viewCount) || '0')}</strong></div>
      <div><span>收藏</span><strong>${escapeHtml(formatCompactCount(stats.favoriteCount) || '0')}</strong></div>
      <div><span>赞</span><strong>${escapeHtml(formatCompactCount(stats.likeCount) || '0')}</strong></div>
    </div>
    <div class="article-info-group article-qscore">
      <span class="article-info-label">QScore</span>
      <div class="article-qscore-head">
        <strong>${escapeHtml(qScore.score.toFixed(1))}</strong>
        <span>质量信号 ${escapeHtml(qScore.positive.toFixed(1))} · 降权 ${escapeHtml(qScore.negative.toFixed(1))} · 时间衰减 ÷${escapeHtml(qScore.decay.toFixed(2))}</span>
      </div>
      <div class="article-qscore-parts">${qScore.parts.map(part => `<span>${escapeHtml(part)}</span>`).join('')}</div>
    </div>
    <div class="article-info-group">
      <span class="article-info-label">原文状态</span>
      <strong>${escapeHtml(originalState)}</strong>
      ${assets.latestAt ? `<div class="article-info-meta">最近资产：${escapeHtml(formatAssetTime(assets.latestAt))}</div>` : ''}
    </div>
    <div class="article-info-group">
      <span class="article-info-label">公开资产</span>
      <div class="article-info-assets">${assetRows}</div>
    </div>
    <div class="article-info-actions">
      <a class="ghost-btn" href="${escapeHtml(entry.link || '#')}" target="_blank" rel="noopener">${iconButtonLabel('external-link', '打开原文')}</a>
      <button type="button" class="ghost-btn" data-info-copy="${escapeHtml(canonicalUrl)}">${iconButtonLabel('copy', '复制链接')}</button>
    </div>`;
}

function scrollReaderTarget(selector, { behavior = 'smooth', offset = 12 } = {}) {
  const target = $(selector);
  if (!target) return;
  const pane = $('#reader-pane');
  if (pane && pane.contains(target)) {
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = pane.scrollTop + targetRect.top - paneRect.top - offset;
    pane.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  target.scrollIntoView({ behavior, block: 'start' });
}

function performArticleAssetJump(type, { syncUrl = true, replaceUrl = false } = {}) {
  if (!state.activeEntry) return;
  if (type === 'translation') {
    state.readerFocus = 'translation';
    handleReaderTab('translation', { preserveFocus: true, replaceUrl });
    scrollReaderTarget('#reader-translation');
    return;
  }
  if (type === 'rewrite') {
    state.readerFocus = 'rewrite';
    setReaderTab('rewrite', { syncUrl, replaceUrl });
    scrollReaderTarget('#reader-rewrite-panel');
    return;
  }
  if (type === 'comments') {
    state.readerFocus = 'comments';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    scrollReaderTarget('#reader-comments');
    return;
  }
  if (type === 'annotations') {
    state.readerFocus = 'annotations';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    const first = visibleAnnotationsForReader()[0];
    if (first) {
      jumpToAnnotation(first.id);
      return;
    }
    scrollReaderTarget('#reader-annotations');
    return;
  }
  if (type === 'chat') {
    state.readerFocus = 'chat';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    setContextPanel('agent', { expand: true });
    if (highlightAgentMessageFromRoute()) return;
    const messages = $('#agent-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    scrollReaderTarget('#agent-pane');
  }
}

function settlePendingAssetJump(type, { clear = true } = {}) {
  if (state.pendingAssetJump !== type) return;
  const entryId = state.activeEntry && state.activeEntry.id;
  [0, 180, 520].forEach((delay, index, delays) => {
    setTimeout(() => {
      if (!state.activeEntry || state.activeEntry.id !== entryId || state.pendingAssetJump !== type) return;
      performArticleAssetJump(type, { syncUrl: false });
      if (clear && index === delays.length - 1) state.pendingAssetJump = null;
    }, delay);
  });
}

function jumpToArticleAsset(type) {
  if (type === 'translation' || type === 'rewrite') state.readerAssetId = '';
  state.pendingAssetJump = type;
  performArticleAssetJump(type);
}

function copyArticleAssetLink(type) {
  const url = readerAssetUrl(type);
  if (!url) {
    toast('没有可复制的资产链接');
    return;
  }
  const label = ASSET_FOCUS_LABELS[type] || '资产';
  copyText(url, `${label}链接已复制`);
}

function updateEntryAssets(entryId, patch = {}, { rerenderList = false } = {}) {
  if (!entryId) return;
  const base = entryByIdFromList(entryId) || state.activeEntry;
  if (!base && !state.activeEntry) return;
  const assets = mergeAssets(base || state.activeEntry, patch);
  patchCatalogEntry(entryId, { assets });
  if (state.activeEntry?.id === entryId) {
    state.activeEntry = { ...state.activeEntry, assets };
    renderReaderAssets(state.activeEntry);
    renderReaderAssetSummary(state.activeEntry);
  }
  if (rerenderList) renderList();
  else if (!patchEntryCardState(entryId, {
    active: state.activeEntry?.id === entryId,
    read: state.read.has(entryId),
  })) {
    /* card not in viewport batch — skip full list for assets-only patch */
  }
}

function applyServerEntryUpdate(entry) {
  if (!entry || !entry.id) return null;
  const current = state.activeEntry && state.activeEntry.id === entry.id ? state.activeEntry : (entryByIdFromList(entry.id) || {});
  const updated = { ...current, ...entry };
  // 目录只保留瘦字段，全文进 contentCache
  const listPatch = {
    title: updated.title,
    titleZh: updated.titleZh,
    summary: updated.summary && String(updated.summary).slice(0, 160),
    summaryZh: updated.summaryZh && String(updated.summaryZh).slice(0, 160),
    image: updated.image,
    published: updated.published,
    publishedTs: updated.publishedTs,
    author: updated.author,
    link: updated.link,
    assets: updated.assets,
    stats: updated.stats,
  };
  patchCatalogEntry(entry.id, listPatch);
  if (updated.content) contentCache.set(updated.id, updated.content);
  if (state.activeEntry?.id === entry.id) {
    // 保留已有中文标题/摘要，避免服务端 entry 无 titleZh 时冲掉列表中文
    state.activeEntry = {
      ...updated,
      titleZh: updated.titleZh || current.titleZh || '',
      summaryZh: updated.summaryZh || current.summaryZh || '',
    };
    // 简中视图中：只更新数据，勿 renderOriginal 把正文打回英文
    if (state.readerZhMode && state.translation && translationHasContent(state.translation)) {
      updateFetchOriginalButton(state.activeEntry);
      if (typeof patchEntryCardZhFields === 'function') patchEntryCardZhFields(entry.id);
    } else {
      renderTitle(state.activeEntry);
      renderOriginalContent(state.activeEntry, state.activeEntry.content || contentCache.get(updated.id) || '');
      updateFetchOriginalButton(state.activeEntry);
    }
  }
  // 不整表重绘；若当前可见卡需更新标题可 patch active
  patchEntryCardState(entry.id, {
    active: state.activeEntry?.id === entry.id,
    read: state.read.has(entry.id),
  });
  return updated;
}

/** 本机主人，恒为 true */
function isAdmin() {
  return true;
}

function isBiliWatchlaterEntry(entry) {
  if (!entry) return false;
  if (entry.sourceId === 'bili-watchlater') return true;
  const src = typeof sourceById === 'function' ? sourceById(entry.sourceId) : null;
  return Boolean(src && src.contentKind === 'social-bili');
}

function renderAdminEntryControls() {
  const btn = $('#reader-delete');
  const cancelBtn = $('#reader-cancel-watchlater');
  const canMutate = Boolean(state.activeEntry && state.activeEntry.id);
  const isBili = canMutate && isBiliWatchlaterEntry(state.activeEntry);
  if (btn) {
    // b站收藏优先用「取消收藏」；普通删除仍可用右键
    btn.classList.toggle('hidden', !canMutate || isBili);
    btn.disabled = !canMutate;
    if (canMutate) btn.title = '删除这篇文章';
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !isBili);
    cancelBtn.disabled = !isBili;
  }
}

/** 列表卡不再显示星标；保留函数避免旧调用报错 */
function patchEntryCardStar() {
  return false;
}

let entryContextId = '';

function hideEntryContextMenu() {
  const menu = $('#entry-context-menu');
  if (menu) menu.classList.add('hidden');
  entryContextId = '';
}

function showEntryContextMenu(event, entry) {
  const menu = $('#entry-context-menu');
  if (!menu || !entry) return;
  event.preventDefault();
  event.stopPropagation();
  hideSourceContextMenu();
  if (typeof hideArticleLinkMenu === 'function') hideArticleLinkMenu();
  entryContextId = entry.id;
  const starred = state.starred.has(entry.id);
  const starLabel = menu.querySelector('[data-entry-star-label]');
  if (starLabel) starLabel.textContent = starred ? '取消收藏' : '收藏';
  const readLabel = menu.querySelector('[data-entry-read-label]');
  if (readLabel) readLabel.textContent = state.read.has(entry.id) ? '未读' : '已读';
  const canMutate = true;
  const delBtn = menu.querySelector('[data-entry-action="delete"]');
  if (delBtn) delBtn.classList.toggle('hidden', !canMutate);
  const cancelWl = menu.querySelector('[data-entry-action="cancel-watchlater"]');
  if (cancelWl) cancelWl.classList.toggle('hidden', !(canMutate && isBiliWatchlaterEntry(entry)));
  menu.classList.remove('hidden');
  const width = 158;
  const height = 148;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
  menu.querySelector('button:not(.hidden)')?.focus();
}

function renderAuthState() {
  // 个人模式：无登录 UI，只保留侧栏 footer / AI 设置 / 删文控件
  $('#auth-open')?.classList.add('hidden');
  $('#account-info')?.classList.add('hidden');
  $('#account-settings-open')?.classList.add('hidden');
  const footer = $('.sidebar-footer');
  if (footer) footer.classList.remove('hidden');
  renderAdminEntryControls();
  renderSidebarAiSettings();
  updateAgentControls();
}

function setAccountMenuOpen() { /* no-op：无账号菜单 */ }

function toggleAccountMenu() { /* no-op */ }

function renderSidebarAiSettings() {
  const config = currentAiConfig();
  const profile = currentAiProfile();
  const ready = hasUsableAiConfig(config);
  const aiBtn = $('#ai-settings-btn');
  if (aiBtn) {
    aiBtn.classList.toggle('needs-key', !ready);
    aiBtn.title = ready
      ? `AI 设置 · ${profile.name || 'DeepSeek'} · ${config.model}`
      : '填写 API Key / Base URL / 模型名（翻译必填）';
    const label = aiBtn.querySelector('.button-label');
    if (label) label.textContent = ready ? 'AI 设置' : '填 Key';
  }
}

function setAuthMode() { /* no-op：无登录 */ }
function setAuthFormEnabled() { /* no-op */ }
function setChangePasswordFormEnabled() { /* no-op */ }
function openAuth() { /* no-op：个人模式永不登录 */ }
function closeAuth() { /* no-op */ }
function openChangePasswordModal() { /* no-op */ }
function closeChangePasswordModal() { /* no-op */ }

/** 个人本机：无需登录 */
function requireAuth() {
  return true;
}

function submitModalMode() {
  return String($('#submit-link-modal')?.dataset?.mode || 'article') === 'repo' ? 'repo' : 'article';
}

function configureSubmitModal(mode = 'article') {
  const isRepo = mode === 'repo';
  const modal = $('#submit-link-modal');
  if (modal) modal.dataset.mode = isRepo ? 'repo' : 'article';
  if ($('#submit-link-title')) $('#submit-link-title').textContent = isRepo ? 'GitHub 项目' : '个人精选';
  if ($('#submit-link-desc')) {
    $('#submit-link-desc').textContent = isRepo
      ? '粘贴 GitHub 仓库链接，收录为项目卡片（元数据 + README，不是文章）。'
      : '粘贴任意文章链接，抓取后收入「个人精选」，稍后慢慢读。';
  }
  if ($('#submit-link-url')) {
    $('#submit-link-url').placeholder = isRepo
      ? 'https://github.com/owner/repo'
      : 'https://example.com/article';
  }
  if ($('#submit-link-note')) {
    $('#submit-link-note').placeholder = isRepo
      ? '为什么收藏这个项目，或一句话备忘'
      : '为什么值得读，或一句话备忘';
  }
  if ($('#submit-link-submit')) {
    $('#submit-link-submit').textContent = isRepo ? '加入项目' : '加入个人精选';
  }
}

function openSubmitLinkModal(prefill = {}) {
  const next = {
    url: String(prefill.url || '').trim(),
    note: String(prefill.note || '').trim(),
    mode: prefill.mode === 'repo' ? 'repo' : 'article',
  };
  configureSubmitModal(next.mode);
  $('#submit-link-url').value = next.url || '';
  $('#submit-link-note').value = next.note || '';
  $('#submit-link-submit').disabled = false;
  $('#submit-link-modal').classList.remove('hidden');
  setTimeout(() => (next.url ? $('#submit-link-note') : $('#submit-link-url')).focus(), 30);
  return true;
}

function openSubmitGitHubModal(prefill = {}) {
  return openSubmitLinkModal({ ...prefill, mode: 'repo' });
}

function closeSubmitLinkModal() {
  $('#submit-link-modal').classList.add('hidden');
  configureSubmitModal('article');
}

async function focusSourceAndOpen(sourceId, entry) {
  state.filterSource = sourceId || null;
  state.filterCategory = null;
  state.assetFilter = null;
  if (!['all', 'unread', 'hot'].includes(state.view)) state.view = 'all';
  state.readerFocus = null;
  state.readerAssetId = '';
  await Promise.all([
    loadSources().catch(() => null),
    loadEntries().catch(() => null),
  ]);
  if (state.allEntries.length) {
    applyLocalEntryFilter({ fastBatch: false });
  }
  updateListTitle();
  renderSidebar();
  renderList();
  if (entry && entry.id) {
    const full = entryByIdFromList(entry.id) || entry;
    try { await openEntry(full); } catch { /* 列表已就绪即可 */ }
  }
}

async function focusClipSourceAndOpen(entry) {
  return focusSourceAndOpen('user-submitted', entry);
}

async function submitReaderLink() {
  const mode = submitModalMode();
  const url = $('#submit-link-url').value.trim();
  const note = $('#submit-link-note').value.trim();
  if (!url) {
    toast(mode === 'repo' ? '请填写 GitHub 仓库链接' : '请填写链接');
    return;
  }
  const btn = $('#submit-link-submit');
  const idleLabel = mode === 'repo' ? '加入项目' : '加入个人精选';
  btn.disabled = true;
  btn.textContent = '收录中…';
  try {
    const endpoint = mode === 'repo' ? '/api/submit-github-repo' : '/api/submit-link';
    const data = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, note }),
    });
    closeSubmitLinkModal();
    if (data.pending) {
      toast('已进入审核队列，通过后才会抓取和公开');
      return;
    }
    if (mode === 'repo') {
      toast('已加入 GitHub 项目');
      await focusSourceAndOpen(data.sourceId || 'github-projects', data.entry || null);
    } else {
      toast('已加入个人精选');
      await focusClipSourceAndOpen(data.entry || null);
    }
  } catch (err) {
    toast((mode === 'repo' ? '加入项目失败: ' : '加入个人精选失败: ') + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = idleLabel;
  }
}

async function submitAuth() { /* no-op：无登录 API */ }
async function submitChangePassword() { /* no-op */ }
async function logout() { /* no-op */ }

function renderContributorDirectory() {
  const list = visibleContributors();
  const el = $('#entry-list');
  el.innerHTML = '';
  renderAssetActivityStrip();
  if (!list.length) {
    const text = state.q
      ? `没有匹配“${escapeHtml(state.q)}”的贡献主页<br/>换个关键词试试`
      : '还没有公开贡献榜<br/>先发布点评或文章对话';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((contributor, index) => {
    const card = document.createElement('div');
    card.className = 'contributor-card';
    card.dataset.contributorId = contributor.id;
    const assetCount = Number(contributor.assetCount || 0);
    const helpfulCount = Number(contributor.helpfulCount || 0);
    const helpfulAssets = Number(contributor.helpfulAssets || 0);
    const followerCount = Number(contributor.followerCount || 0);
    const metaParts = [];
    if (contributor.bio) metaParts.push(contributor.bio);
    metaParts.push(`最近 ${formatAssetTime(contributor.latestAt)}`);
    card.innerHTML = `
      <div class="contributor-rank">#${index + 1}</div>
      ${avatarHtml(contributor, 'contributor-avatar')}
      <div class="contributor-main">
        <div class="contributor-name">${escapeHtml(contributor.displayName || '读者')}</div>
        <div class="contributor-meta">${escapeHtml(metaParts.join(' · '))}</div>
        <div class="contributor-stats">
          <span><strong>${assetCount}</strong> 资产</span>
          <span><strong>${Number(contributor.translationCount || 0)}</strong> 中译</span>
          <span><strong>${Number(contributor.rewriteCount || 0)}</strong> 改写</span>
          <span><strong>${Number(contributor.commentCount || 0)}</strong> 点评</span>
          <span><strong>${Number(contributor.chatCount || 0)}</strong> 对话</span>
          ${helpfulCount > 0 ? `<span class="contributor-stat-helpful"><strong>${helpfulCount}</strong> 有用</span>` : ''}
          ${followerCount > 0 ? `<span><strong>${followerCount}</strong> 关注者</span>` : ''}
        </div>
      </div>
      <div class="contributor-actions">
        <button type="button" class="contributor-open">查看贡献</button>
        <a class="contributor-rss-button" data-contributor-rss="${escapeHtml(contributor.id)}" href="${escapeHtml(contributorFeedUrlFor(contributor.id).href)}" target="_blank" rel="noopener" title="订阅贡献 RSS" aria-label="订阅贡献 RSS">RSS</a>
      </div>
    `;
    card.onclick = (event) => {
      if (event.target.closest('[data-contributor-rss]')) return;
      openContributor(contributor.id);
    };
    frag.appendChild(card);
  });
  el.appendChild(frag);
}

function entryByIdFromList(id) {
  const clean = String(id || '');
  if (!clean) return null;
  if (state.entryById && state.entryById.size) {
    const hit = state.entryById.get(clean);
    if (hit) return hit;
  }
  return state.entries.find(e => e && e.id === clean)
    || state.allEntries.find(e => e && e.id === clean)
    || null;
}

function estimateListCardHeight(entry) {
  return entry && entry.image ? LIST_CARD_MEDIA_ESTIMATE_PX : LIST_CARD_ESTIMATE_PX;
}

/** 根据 scrollTop/视口计算虚拟窗口 */
function computeListVirtualWindow(list, scrollTop, viewportH) {
  const n = list.length;
  if (!n) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  // 用均匀估计快速定位，避免 O(n) 累加；有图/无图混排可接受轻微偏差
  const avg = LIST_CARD_ESTIMATE_PX;
  let start = Math.max(0, Math.floor(scrollTop / avg) - LIST_OVERSCAN);
  const need = Math.ceil((viewportH || 600) / avg) + LIST_OVERSCAN * 2;
  let end = Math.min(n, start + Math.min(Math.max(need, ENTRY_RENDER_FAST_BATCH), LIST_WINDOW_MAX));
  if (end - start > LIST_WINDOW_MAX) end = start + LIST_WINDOW_MAX;
  if (end >= n) {
    end = n;
    start = Math.max(0, end - LIST_WINDOW_MAX);
  }
  const topPad = start * avg;
  const bottomPad = Math.max(0, (n - end) * avg);
  return { start, end, topPad, bottomPad };
}

function ensureListVirtualScroll() {
  if (state.listVirtualBound) return;
  const el = $('#entry-list');
  if (!el) return;
  state.listVirtualBound = true;
  el.addEventListener('scroll', () => {
    if (!state.listVirtualEnabled) return;
    if (state.listScrollRaf) return;
    state.listScrollRaf = requestAnimationFrame(() => {
      state.listScrollRaf = 0;
      // 仅重画窗口，不碰侧栏/标题
      renderListWindowOnly();
    });
  }, { passive: true });
}

function entryCardHtml(e, {
  zen = false,
  assetsView = false,
} = {}) {
  const src = sourceById(e.sourceId);
  // Zen：列表卡不显示「文A」翻译徽章等资产标（翻译只在阅读区按钮）
  const hasAssets = !zen && entryHasListAssets(e);
  const assetsHtml = hasAssets ? assetBadgesHtml(e, { interactive: true }) : '';
  const entryActivity = zen
    ? ''
    : (assetsView || hasAssets
      ? (assetActivityLabel(e) || entryHistoryLabel(e) || hotEntryLabel(e))
      : (entryHistoryLabel(e) || (state.view === 'hot' ? hotEntryLabel(e) : '')));
  const statsLine = zen ? '' : entryStatsLabel(e);
  const metaRow = [
    statsLine ? `<span class="entry-stats">${escapeHtml(statsLine)}</span>` : '',
    assetsHtml ? `<span class="asset-badges entry-asset-badges">${assetsHtml}</span>` : '',
  ].filter(Boolean).join('');
  const assetPreview = !zen && assetsView ? assetPreviewForEntry(e) : null;
  const assetItems = !zen && assetsView ? assetItemListHtml(e) : '';
  const isSyllabus = isSyllabusEntry(e);
  const syl = isSyllabus ? parseSyllabusSummary(e) : null;
  // 课程库：不显示右上角学校/学期 pill，也不显示「刚刚」
  const publishedLabel = isSyllabus ? '' : timeAgo(entryDisplayTimeTs(e));
  const sourceName = src ? src.name : e.sourceId;
  // 译过：列表卡强制中文标题/摘要；有课号 → 课号+课名；无课号 → 只显示中文课名一遍
  let title = String(e.titleZh || '').trim() || e.title || '';
  let summary = isSyllabus
    ? syllabusCardSummary(e, syl)
    : listSummaryText(e);
  if (isSyllabus) {
    const codeLike = String(e.title || '').trim();
    const zh = String(e.titleZh || '').trim();
    if (isSyllabusCourseCode(codeLike)) {
      title = codeLike;
      if (!summary || summary === codeLike) {
        summary = (zh && zh !== codeLike) ? zh : '';
      }
    } else if (zh) {
      title = zh;
      // 无课号：摘要与标题相同则去掉
      if (summary === title || summary === zh || summary === codeLike) summary = '';
    }
    if (summary && summary.replace(/\s+/g, '') === title.replace(/\s+/g, '')) summary = '';
  }
  const thumb = listCardThumbUrl(e);
  const cls = 'entry-card'
    + (state.read.has(e.id) ? ' read' : '')
    + (state.activeEntry?.id === e.id ? ' active' : '')
    + (isSyllabus ? ' entry-card--syllabus' : '');
  const mediaCls = thumb ? ' entry-card--media' : '';
  // B站等横版视频封面：16:9 + contain，避免 72² cover 裁掉半张
  const isVideoCover = Boolean(
    thumb
    && (
      e.sourceId === 'bili-watchlater'
      || (src && src.contentKind === 'social-bili')
    ),
  );
  const kickerLeft = `<div class="entry-source-line">${src ? sourceFaviconHtml(src, 13) : ''}<span class="src">${escapeHtml(sourceName)}</span></div>`;
  const ariaLabel = isSyllabus
    ? [title, summary, syl?.school, syl?.term].filter(Boolean).join(' · ') || '打开课程'
    : (title || '打开文章');
  if (isSyllabus) {
    const code = isSyllabusCourseCode(e.title) ? String(e.title).trim() : '';
    const mainTitle = summary || title;
    const kind = syllabusEntryKindLabel(e);
    const facts = [syl?.school, syl?.term, kind].filter(Boolean);
    return `<div class="${cls}" data-id="${escapeHtml(e.id)}" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
      <span class="entry-course-drag-handle" title="拖拽调整课程顺序" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="entry-main entry-main--syllabus">
        ${code ? `<div class="entry-course-code">${escapeHtml(code)}</div>` : ''}
        <div class="entry-title">${escapeHtml(mainTitle)}</div>
        ${code && title !== code && title !== mainTitle ? `<div class="entry-course-alias">${escapeHtml(title)}</div>` : ''}
        ${facts.length ? `<div class="entry-course-meta">${facts.map((fact, index) => (
          `<span${index === facts.length - 1 ? ' class="entry-course-kind"' : ''}>${escapeHtml(fact)}</span>`
        )).join('')}</div>` : ''}
      </div>
    </div>`;
  }
  return `<div class="${cls}${mediaCls}" data-id="${escapeHtml(e.id)}" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
      <div class="entry-main">
        <div class="entry-kicker">
          ${kickerLeft}
          ${publishedLabel
            ? `<time class="entry-time" datetime="${escapeHtml(e.published || '')}">${escapeHtml(publishedLabel)}</time>`
            : (isSyllabus ? '' : `<time class="entry-time" datetime="${escapeHtml(e.published || '')}"></time>`)}
        </div>
        <div class="entry-title">${escapeHtml(title)}</div>
        ${summary ? `<div class="entry-summary${isSyllabus ? ' entry-summary--course' : ''}">${escapeHtml(summary)}</div>` : ''}
        ${metaRow ? `<div class="entry-meta-row">${metaRow}</div>` : ''}
        ${assetItems || (assetPreview ? assetPreviewHtml(assetPreview) : '')}
        ${entryActivity ? `<div class="entry-asset-activity">${escapeHtml(entryActivity)}</div>` : ''}
      </div>
      ${thumb ? `<div class="entry-media${isVideoCover ? ' entry-media--video' : ''}"><img class="entry-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.entry-media')?.remove()" /></div>` : ''}
    </div>`;
}

/**
 * 仅根据当前 scroll 更新虚拟窗口（滚动热路径）。
 * 按 data-id 复用已渲染卡片 DOM：窗口滑动时 <img> 节点只移动不重建，
 * 已解码位图得以保留 → 消除 X/小红书收藏列表滚动时缩略图整片闪烁。
 * innerHTML 全量重建只保留在 renderList()（切源/数据变更等离散场景）。
 */
function renderListWindowOnly() {
  if (state.view === 'contributors') return;
  if (isHomeScope() && state.homeTab === 'assets') return;
  const list = visibleEntries();
  const el = $('#entry-list');
  if (!el || !list.length) return;
  const win = computeListVirtualWindow(list, el.scrollTop, el.clientHeight);
  if (win.start === state.listWindowStart && win.end === state.listWindowEnd) return;
  state.listWindowStart = win.start;
  state.listWindowEnd = win.end;
  const zen = isZenPersonalMode();
  const assetsView = state.view === 'assets';
  const slice = list.slice(win.start, win.end);
  // 现存卡片索引（spacer 无 data-id 自然跳过）
  const existing = new Map();
  for (const node of el.children) {
    const id = node.dataset && node.dataset.id;
    if (id) existing.set(id, node);
  }
  const spacer = (h) => {
    const div = document.createElement('div');
    div.className = 'list-virtual-spacer';
    div.style.height = `${h}px`;
    div.setAttribute('aria-hidden', 'true');
    return div;
  };
  const frag = document.createDocumentFragment();
  if (win.topPad > 0) frag.appendChild(spacer(win.topPad));
  const tpl = document.createElement('template');
  for (const e of slice) {
    const cur = existing.get(e.id);
    if (cur) {
      // 复用：内容静态，read/active 态由 patchEntryCardState/renderList 维护
      existing.delete(e.id);
      frag.appendChild(cur);
    } else {
      tpl.innerHTML = entryCardHtml(e, { zen, assetsView });
      const node = tpl.content.firstElementChild;
      if (node) frag.appendChild(node);
    }
  }
  if (win.bottomPad > 0) frag.appendChild(spacer(win.bottomPad));
  el.replaceChildren(frag);
}

let suppressCourseClickUntil = 0;
const COURSE_DRAG_THRESHOLD = 5;
const courseDrag = {
  pointerId: null,
  armed: false,
  active: false,
  card: null,
  wrap: null,
  placeholder: null,
  ghost: null,
  startX: 0,
  startY: 0,
  grabY: 0,
  fixedLeft: 0,
};

function courseDragCleanup() {
  courseDrag.ghost?.remove();
  courseDrag.placeholder?.remove();
  courseDrag.card?.classList.remove('is-course-dragging');
  courseDrag.wrap?.classList.remove('is-course-drag-scroll-lock');
  document.body.classList.remove('is-course-reordering');
  courseDrag.pointerId = null;
  courseDrag.armed = false;
  courseDrag.active = false;
  courseDrag.card = null;
  courseDrag.wrap = null;
  courseDrag.placeholder = null;
  courseDrag.ghost = null;
}

function moveCoursePlaceholder(clientY) {
  const { wrap, card, placeholder } = courseDrag;
  if (!wrap || !card || !placeholder) return;
  const candidates = [...wrap.children].filter(el => (
    el !== card
    && el !== placeholder
    && el.matches?.('.entry-card--syllabus[data-id]')
  ));
  const before = candidates.find(el => {
    const rect = el.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (before) wrap.insertBefore(placeholder, before);
  else wrap.appendChild(placeholder);
}

function courseDragAutoScroll(clientY) {
  const wrap = courseDrag.wrap;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const edge = 52;
  if (clientY < rect.top + edge) wrap.scrollTop -= 18;
  else if (clientY > rect.bottom - edge) wrap.scrollTop += 18;
}

function startCourseDrag(event) {
  const { card, wrap } = courseDrag;
  if (!card || !wrap || courseDrag.active) return;
  courseDrag.active = true;
  const rect = card.getBoundingClientRect();
  courseDrag.grabY = Math.min(rect.height - 4, Math.max(4, event.clientY - rect.top));
  courseDrag.fixedLeft = rect.left;

  const placeholder = document.createElement('div');
  placeholder.className = 'course-drag-placeholder';
  placeholder.style.height = `${Math.max(56, rect.height)}px`;
  card.insertAdjacentElement('beforebegin', placeholder);
  courseDrag.placeholder = placeholder;

  const ghost = card.cloneNode(true);
  ghost.classList.add('course-drag-ghost');
  ghost.classList.remove('active', 'read', 'is-course-dragging');
  ghost.removeAttribute('tabindex');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  courseDrag.ghost = ghost;

  card.classList.add('is-course-dragging');
  wrap.classList.add('is-course-drag-scroll-lock');
  document.body.classList.add('is-course-reordering');
  try { card.setPointerCapture(event.pointerId); } catch { /* optional */ }
  moveCoursePlaceholder(event.clientY);
}

function onCourseDragMove(event) {
  if (!courseDrag.armed && !courseDrag.active) return;
  if (courseDrag.pointerId !== event.pointerId) return;
  if (!courseDrag.active) {
    const dx = event.clientX - courseDrag.startX;
    const dy = event.clientY - courseDrag.startY;
    if (dx * dx + dy * dy < COURSE_DRAG_THRESHOLD * COURSE_DRAG_THRESHOLD) return;
    startCourseDrag(event);
  }
  if (!courseDrag.active) return;
  if (courseDrag.ghost) {
    courseDrag.ghost.style.left = `${courseDrag.fixedLeft}px`;
    courseDrag.ghost.style.top = `${event.clientY - courseDrag.grabY}px`;
  }
  courseDragAutoScroll(event.clientY);
  moveCoursePlaceholder(event.clientY);
  event.preventDefault();
}

function onCourseDragEnd(event) {
  if (!courseDrag.armed && !courseDrag.active) return;
  if (event?.pointerId != null && courseDrag.pointerId !== event.pointerId) return;
  const { active, card, wrap, placeholder, pointerId } = courseDrag;
  if (active && card && wrap && placeholder?.parentNode) {
    placeholder.insertAdjacentElement('beforebegin', card);
    const order = [...wrap.querySelectorAll(':scope > .entry-card--syllabus[data-id]')]
      .map(el => el.dataset.id)
      .filter(Boolean);
    try { card.releasePointerCapture(pointerId); } catch { /* optional */ }
    persistSyllabusCourseOrder(order);
    suppressCourseClickUntil = Date.now() + 420;
    courseDragCleanup();
    renderList();
    return;
  }
  courseDragCleanup();
}

function bindCourseDragToList(el) {
  if (!el || el.dataset.courseDragBound === '1') return;
  el.dataset.courseDragBound = '1';
  el.addEventListener('pointerdown', (event) => {
    if (!isSyllabusSourceFilter() || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('a, button, input, textarea, select')) return;
    const card = event.target.closest('.entry-card--syllabus[data-id]');
    if (!card || !el.contains(card)) return;
    if (courseDrag.armed || courseDrag.active) courseDragCleanup();
    courseDrag.pointerId = event.pointerId;
    courseDrag.armed = true;
    courseDrag.active = false;
    courseDrag.card = card;
    courseDrag.wrap = el;
    courseDrag.startX = event.clientX;
    courseDrag.startY = event.clientY;
  });
  window.addEventListener('pointermove', onCourseDragMove, { passive: false });
  window.addEventListener('pointerup', onCourseDragEnd);
  window.addEventListener('pointercancel', onCourseDragEnd);
  window.addEventListener('dragstart', (event) => {
    if (courseDrag.armed || courseDrag.active) event.preventDefault();
  }, true);
}

function ensureEntryListDelegation() {
  if (state.listDelegated) return;
  const el = $('#entry-list');
  if (!el) return;
  state.listDelegated = true;
  ensureListVirtualScroll();
  el.addEventListener('click', (event) => {
    if (Date.now() < suppressCourseClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const more = event.target.closest('.list-load-more');
    if (more && el.contains(more)) {
      // 兼容旧按钮：扩展窗口 cap（虚拟列表下通常不出现）
      event.preventDefault();
      const scrollTop = el.scrollTop;
      const list = visibleEntries();
      state.entryRenderLimit = Math.min(
        (state.entryRenderLimit || ENTRY_RENDER_BATCH_SIZE) + ENTRY_RENDER_BATCH_SIZE,
        Math.max(list.length, ENTRY_RENDER_BATCH_SIZE)
      );
      renderList();
      requestAnimationFrame(() => { el.scrollTop = scrollTop; });
      return;
    }
    const card = event.target.closest('.entry-card');
    if (!card || !el.contains(card)) return;
    const e = entryByIdFromList(card.dataset.id);
    if (!e) return;
    const previewCopyContent = event.target.closest('[data-asset-preview-copy-content]');
    if (previewCopyContent) {
      event.preventDefault();
      event.stopPropagation();
      const type = previewCopyContent.dataset.assetPreviewCopyContent;
      const item = entryAssetPreviewForCopy(e, type, previewCopyContent.dataset.assetItemId || '');
      copyAssetContent(type, item);
      return;
    }
    const previewCopy = event.target.closest('[data-asset-preview-copy]');
    if (previewCopy) {
      event.preventDefault();
      event.stopPropagation();
      const url = assetItemUrl(previewCopy.dataset.assetPreviewCopy, e, previewCopy.dataset.assetItemId || '');
      const label = ASSET_FOCUS_LABELS[previewCopy.dataset.assetPreviewCopy] || '资产';
      copyText(url, `${label}链接已复制`);
      return;
    }
    const copy = event.target.closest('[data-asset-copy]');
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      const url = readerAssetUrl(copy.dataset.assetCopy, e);
      const label = ASSET_FOCUS_LABELS[copy.dataset.assetCopy] || '资产';
      copyText(url, `${label}链接已复制`);
      return;
    }
    const asset = event.target.closest('[data-asset]');
    if (asset) {
      event.preventDefault();
      event.stopPropagation();
      const itemId = asset.dataset.assetItemId || '';
      const focus = asset.dataset.asset;
      openEntry(e, {
        focus,
        aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
        commentId: focus === 'comments' ? itemId : '',
        annotationId: focus === 'annotations' ? itemId : '',
        chatMessageId: focus === 'chat' ? itemId : '',
      });
      return;
    }
    openEntry(e);
  });
  el.addEventListener('keydown', (event) => {
    const card = event.target.closest('.entry-card');
    if (!card || event.target !== card || !el.contains(card)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const e = entryByIdFromList(card.dataset.id);
    if (e) openEntry(e);
  });
  el.addEventListener('contextmenu', (event) => {
    const card = event.target.closest('.entry-card');
    if (!card || !el.contains(card)) return;
    const e = entryByIdFromList(card.dataset.id);
    if (!e) return;
    showEntryContextMenu(event, e);
  });
  bindCourseDragToList(el);
}

function listSummaryText(entry) {
  // 译过必用中文摘要；无 summaryZh 才回退英文
  const zh = String(entry && entry.summaryZh || '').replace(/\s+/g, ' ').trim();
  let raw = (zh && /[\u3400-\u9fff]/.test(zh) ? zh : String(entry && entry.summary || '')).replace(/\s+/g, ' ').trim();
  // 本机正文删除后：列表概要跟剩余正文开头走（不改入库 summary）
  if (typeof listSummaryAfterLocalDeletions === 'function') {
    const next = listSummaryAfterLocalDeletions(entry, raw);
    if (next != null) raw = next;
  }
  // Substack / Maarten 列表概述里的作者+日期（含译后「2026年6月10日」）
  if (typeof window !== 'undefined' && window.QMContentNormalizers?.stripSubstackAuthorDateByline) {
    raw = window.QMContentNormalizers.stripSubstackAuthorDateByline(raw).replace(/\s+/g, ' ').trim();
  } else {
    raw = raw
      .replace(/\bMaarten\s+Grootendorst\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/gi, '')
      .replace(/\bMaarten\s+Grootendorst\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const title = String(entry && (entry.titleZh || entry.title) || '').replace(/\s+/g, ' ').trim();
  if (title && raw.toLowerCase().startsWith(title.toLowerCase())) {
    raw = raw.slice(title.length).replace(/^[\s\-–—:：|]+/, '').trim();
  }
  // 英文标题前缀 / 日期噪音
  const enTitle = String(entry && entry.title || '').replace(/\s+/g, ' ').trim();
  if (enTitle && raw.toLowerCase().startsWith(enTitle.toLowerCase())) {
    raw = raw.slice(enTitle.length).replace(/^[\s\-–—:：|]+/, '').trim();
  }
  raw = raw.replace(/^\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}\s+/, '').trim();
  raw = raw.replace(/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*/, '').trim();
  if (!raw) return '';
  if (raw.length <= LIST_SUMMARY_MAX) return raw;
  return `${raw.slice(0, LIST_SUMMARY_MAX)}…`;
}

/** 列表缩略图：跳过全站默认 og / 本地化后的占位图（无正文图不应显示缩略图） */
function listCardThumbUrl(entry) {
  let url = String(entry && entry.image || '').trim();
  if (!url) return '';
  // 误存 https://host/article-images/...（远程 404）→ 本站路径
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith('/article-images/')) url = u.pathname;
  } catch { /* keep */ }
  const m = url.match(/https?:\/\/[^/]+(\/article-images\/[^?#]+)/i);
  if (m) url = m[1];
  // bearblog 等：/static/og-image.png 或本地化哈希 da47ec…（站点默认图）
  if (/\/static\/og-image|og-image\.(png|jpe?g|webp|gif)|da47ec081fc39a48c0bd|default[-_]?og|site[-_]?logo|placeholder/i.test(url)) {
    return '';
  }
  return url;
}

function entryHasListAssets(entry) {
  const a = entry && entry.assets;
  if (!a) return false;
  return Boolean(a.translation || a.rewrite || a.comments || a.annotations || a.chatMessages
    || a.translationCount || a.rewriteCount);
}

function renderList() {
  ensureEntryListDelegation();
  ensureListVirtualScroll();
  $('#app').classList.toggle('view-assets', state.view === 'assets');
  $('#app').classList.toggle('view-contributors', state.view === 'contributors');
  $('#app').classList.toggle('home-assets', isHomeScope() && state.homeTab === 'assets');
  renderListScopeBar();
  renderEntryPaneTabs();
  $('#mark-read-btn').classList.toggle('hidden', state.view === 'contributors' || (isHomeScope() && state.homeTab === 'assets'));
  if (state.view === 'contributors') {
    state.listVirtualEnabled = false;
    renderContributorDirectory();
    return;
  }
  const list = visibleEntries();
  const el = $('#entry-list');
  el.classList.remove('home-asset-activity-list');
  // 普通切源不刷资产条；仅 assets / home-assets 需要
  if (state.view === 'assets' || (isHomeScope() && state.homeTab === 'assets')) {
    renderAssetActivityStrip();
  }
  if (isHomeScope() && state.homeTab === 'assets') {
    state.listVirtualEnabled = false;
    renderHomeAssetActivityList(el);
    return;
  }
  if (!list.length) {
    state.listVirtualEnabled = false;
    const assetScope = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    const filterSrc = state.filterSource ? sourceById(state.filterSource) : null;
    const submitAction = typeof sourceSubmitAction === 'function' ? sourceSubmitAction(filterSrc) : null;
    const text = state.view === 'assets' && state.q
      ? `没有匹配“${escapeHtml(state.q)}”的${assetScope}<br/>换个关键词试试`
      : state.view === 'assets' && state.assetFilter
      ? `还没有${assetScope}<br/>换个类型或先沉淀一篇文章`
      : state.view === 'assets'
      ? '还没有沉淀资产<br/>先翻译、重写、点评或对话一篇文章'
      : state.view === 'history'
      ? '还没有浏览记录<br/>打开几篇文章后会出现在这里'
      : state.view === 'hot'
      ? '还没有足够反馈<br/>提交链接、点赞或收藏后会逐步形成热门列表'
      : state.view === 'unread'
      ? '没有未读文章<br/>切换到「最新」可看全部'
      : submitAction && submitAction.mode === 'repo'
      ? '还没有 GitHub 项目<br/>点右上角 + 粘贴仓库链接加入'
      : isSyllabusSourceFilter()
      ? '课程库还是空的<br/>本地大纲库：可在终端运行 refresh:courses 导入'
      : submitAction
      ? '还没有个人精选<br/>点右上角 + 粘贴链接加入'
      : '这里空空如也<br/>试试刷新或切换视图';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  // 课程目录数量有限，完整驻留 DOM 才能在拖拽时得到准确的全量顺序。
  if (isSyllabusSourceFilter()) {
    state.listVirtualEnabled = false;
    const zen = isZenPersonalMode();
    const assetsView = state.view === 'assets';
    el.innerHTML = list.map(e => entryCardHtml(e, { zen, assetsView })).join('');
    return;
  }
  // 真虚拟列表：仅驻留视口 ± overscan，上限 LIST_WINDOW_MAX 张卡
  // 一次写入 innerHTML（不先清空），避免未读/最新切换时空一帧闪白
  state.listVirtualEnabled = true;
  const zen = isZenPersonalMode();
  const assetsView = state.view === 'assets';
  // 切源时若未显式保留滚动，从顶部开窗
  const scrollTop = el.scrollTop || 0;
  const win = computeListVirtualWindow(list, scrollTop, el.clientHeight || 640);
  state.listWindowStart = win.start;
  state.listWindowEnd = win.end;
  let html = '';
  if (win.topPad > 0) html += `<div class="list-virtual-spacer" style="height:${win.topPad}px" aria-hidden="true"></div>`;
  for (const e of list.slice(win.start, win.end)) {
    html += entryCardHtml(e, { zen, assetsView });
  }
  if (win.bottomPad > 0) html += `<div class="list-virtual-spacer" style="height:${win.bottomPad}px" aria-hidden="true"></div>`;
  el.innerHTML = html;
}

function updateListTitle() {
  let title = '全部';
  let syllabusCount = 0;
  if (state.filterSource) {
    const src = sourceById(state.filterSource);
    const name = src?.name || state.filterSource;
    const n = sourceEntryCount(state.filterSource) || (state.entries || []).length;
    if (src && (src.id === 'zen-recent' || src.contentKind === 'syllabus')) {
      title = '近期';
      syllabusCount = n;
    } else {
      title = n ? `${name} · ${n}` : name;
    }
  } else if (state.filterCategory) title = CATEGORY_LABELS[state.filterCategory];
  else if (state.view === 'hot') title = '热门';
  else if (state.view === 'unread') title = '未读';
  else if (state.view === 'starred') title = '收藏';
  else if (state.view === 'history') title = '浏览记录';
  else if (state.view === 'assets') {
    const prefix = state.assetSort === 'helpful' ? '有用 · ' : '';
    title = `${prefix}${state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产'}`;
  }
  else if (state.view === 'contributors') title = '贡献榜';
  if (state.q) title += ` · “${state.q}”`;
  const titleEl = $('#list-title');
  titleEl.classList.toggle('pane-title--syllabus', Boolean(syllabusCount || isSyllabusSourceFilter()));
  if (isSyllabusSourceFilter()) {
    titleEl.innerHTML = `<span>${escapeHtml(title)}</span>${syllabusCount ? `<span class="pane-title-count">${syllabusCount}</span>` : ''}`;
  } else {
    titleEl.textContent = title;
  }
  updateSearchPlaceholder();
  renderSourceRefreshButton();
  renderSourceSubmitButton();
  renderListScopeBar();
}

function updateSearchPlaceholder() {
  const search = $('#search');
  if (!search) return;
  search.placeholder = state.view === 'contributors'
    ? '搜索贡献榜…'
    : state.view === 'assets'
      ? '搜索资产…'
      : isSyllabusSourceFilter()
        ? '搜索课号、课名、学校…'
        : '搜索文章…';
  if (search.value !== state.q) search.value = state.q;
}

/** 仅进入「个人精选 / GitHub 项目」源后，列表顶栏显示加入入口 */
function renderSourceSubmitButton() {
  const btn = $('#source-submit-btn');
  if (!btn) return;
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  const action = typeof sourceSubmitAction === 'function' ? sourceSubmitAction(source) : null;
  btn.classList.toggle('hidden', !action);
  if (!action) {
    delete btn.dataset.mode;
    return;
  }
  btn.dataset.mode = action.mode;
  btn.title = action.title;
  btn.setAttribute('aria-label', action.title);
  setElementIcon(btn, 'plus', { className: 'app-icon' });
}

function renderSourceRefreshButton() {
  const btn = $('#source-refresh-btn');
  if (!btn) return;
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  // 手动投稿源用顶栏「+」加入；课程库基本不更新，不显示刷新
  const submitOnly = Boolean(typeof sourceSubmitAction === 'function' && sourceSubmitAction(source));
  const staticCatalog = Boolean(
    source
    && (
      source.excludeFromAll
      || source.id === 'zen-recent'
      || source.contentKind === 'syllabus'
    ),
  );
  const sourceRefreshing = Boolean(
    source
      && state.refreshing
      && (!state.refreshProgress.sourceId || state.refreshProgress.sourceId === source.id)
  );
  btn.classList.toggle('hidden', !source || submitOnly || staticCatalog);
  btn.classList.toggle('refreshing', sourceRefreshing);
  btn.disabled = sourceRefreshing;
  setElementIcon(btn, sourceRefreshing ? 'loader-circle' : 'refresh-cw', {
    className: sourceRefreshing ? 'app-icon app-icon-spin' : 'app-icon',
  });
  if (source && !submitOnly) {
    btn.title = `${sourceRefreshing ? '正在检查' : '检查'} ${source.name} 更新`;
    btn.setAttribute('aria-label', btn.title);
  }
}

function setSourceRefreshStatus(message = '', kind = '', { timeout = 0 } = {}) {
  const el = $('#source-refresh-status');
  if (!el) return;
  clearTimeout(state.sourceRefreshStatusTimer);
  state.sourceRefreshStatusTimer = null;
  el.textContent = message;
  el.className = `source-refresh-status${message ? '' : ' hidden'}${kind ? ` ${kind}` : ''}`;
  if (message && timeout) {
    state.sourceRefreshStatusTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'source-refresh-status hidden';
      state.sourceRefreshStatusTimer = null;
    }, timeout);
  }
}

async function sourceEntriesSnapshot(sourceId) {
  if (!sourceId) return [];
  const params = new URLSearchParams({ source: sourceId });
  const data = await api('/api/entries?' + params.toString());
  return Array.isArray(data.entries) ? data.entries : [];
}

function newEntryCount(beforeEntries = [], afterEntries = []) {
  const beforeIds = new Set(beforeEntries.map(entry => entry && entry.id).filter(Boolean));
  return afterEntries.filter(entry => entry && entry.id && !beforeIds.has(entry.id)).length;
}

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
function setReaderTab(tab, { syncUrl = true, replaceUrl = true } = {}) {
  const next = normalizeReaderTab(tab);
  state.readerTab = next;
  $$('.reader-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === next));
  $('#reader-original-panel').classList.toggle('hidden', next !== 'original');
  $('#reader-translation').classList.toggle('hidden', next !== 'translation');
  $('#reader-rewrite-panel').classList.toggle('hidden', next !== 'rewrite');
  updateReaderTocVisibility(next);
  updateReaderLanguageProfile();
  applyTextAnnotations();
  if (syncUrl) syncReaderUrl({ replace: replaceUrl });
}

function handleReaderTab(tab, { preserveFocus = false, replaceUrl = true } = {}) {
  if (!preserveFocus) {
    state.readerFocus = null;
    state.readerAssetId = '';
  }
  setReaderTab(tab, { replaceUrl });
}

function maybeGenerateRewriteAfterLoad() {
  state.pendingRewriteGenerate = false;
}

function entryAssetHasContent(type, asset) {
  if (type === 'translation') return Boolean(asset && Array.isArray(asset.content) && asset.content.length);
  if (type === 'rewrite') return Boolean(asset && asset.body);
  return false;
}

function assetPreviewFromCurrent(type, asset) {
  if (!entryAssetHasContent(type, asset)) return null;
  const text = type === 'translation'
    ? asset.content.map(translationPairText).find(Boolean)
    : asset.body;
  const previewText = assetSummaryText(text || '');
  if (!previewText) return null;
  return {
    type,
    id: asset.id || state.readerAssetId || '',
    role: '',
    author: asset.createdBy || '',
    title: type === 'translation' ? asset.titleZh || '' : asset.title || '',
    model: asset.model || '',
    text: previewText,
    at: Number(asset.updatedAt || asset.createdAt || 0) || Date.now(),
    helpfulCount: Number(asset.helpfulCount) || 0,
  };
}

function topHelpfulAssetPreview(items) {
  return items
    .filter(item => item && Number(item.helpfulCount || 0) > 0)
    .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))[0] || null;
}

function helpfulAiAssetItemCount(assets, type) {
  const items = assets && assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
  if (items.length) {
    return items.reduce((sum, item) => sum + (Number(item && item.helpfulCount) > 0 ? 1 : 0), 0);
  }
  const count = type === 'translation' ? assets && assets.translationHelpfulCount : assets && assets.rewriteHelpfulCount;
  return Number(count) > 0 ? 1 : 0;
}

function entryAssetHelpfulPatch(type, asset, entry = state.activeEntry) {
  const assets = mergeAssets(entry);
  const nextCount = Number(asset && asset.helpfulCount) || 0;
  const commentHelpfulCount = Number(assets.commentHelpfulCount) || 0;
  const chatHelpfulCount = Number(assets.chatHelpfulCount) || 0;
  const previews = { ...(assets.previews || {}) };
  const preview = assetPreviewFromCurrent(type, asset) || previews[type] || null;
  const assetId = String((asset && asset.id) || state.readerAssetId || '').trim();
  const items = { ...(assets.items || {}) };
  let typeItems = Array.isArray(items[type]) ? items[type].map(item => ({ ...item })) : [];
  if (preview && assetId) {
    let found = false;
    typeItems = typeItems.map(item => {
      if (item.id !== assetId) return item;
      found = true;
      return { ...item, ...preview, id: assetId, helpfulCount: nextCount };
    });
    if (!found) typeItems.unshift({ ...preview, id: assetId, helpfulCount: nextCount });
    items[type] = typeItems;
  }
  if (preview) {
    const currentPreview = previews[type];
    const shouldUpdatePreview = !assetId
      || !currentPreview
      || currentPreview.id === assetId
      || Number(preview.at || 0) >= Number(currentPreview.at || 0);
    if (shouldUpdatePreview) previews[type] = { ...preview, helpfulCount: nextCount };
  }
  const typeHelpfulCount = typeItems.length
    ? typeItems.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0)
    : nextCount;
  const translationHelpfulCount = type === 'translation' ? typeHelpfulCount : Number(assets.translationHelpfulCount) || 0;
  const rewriteHelpfulCount = type === 'rewrite' ? typeHelpfulCount : Number(assets.rewriteHelpfulCount) || 0;

  const topHelpfulTranslation = type === 'translation'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.translation])
    : assets.topHelpfulTranslation;
  const topHelpfulRewrite = type === 'rewrite'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.rewrite])
    : assets.topHelpfulRewrite;
  const topHelpfulAsset = topHelpfulAssetPreview([
    topHelpfulTranslation,
    topHelpfulRewrite,
    assets.topHelpfulComment,
    assets.topHelpfulChat,
  ]);
  const primaryPreview = preview && (
    !assets.preview
    || assets.preview.type === type
    || Number(preview.at || 0) >= Number(assets.preview.at || 0)
  ) ? previews[type] : assets.preview;

  return {
    [type]: entryAssetHasContent(type, asset) || Boolean(assets[type]),
    items,
    previews,
    preview: primaryPreview || null,
    translationHelpfulCount,
    rewriteHelpfulCount,
    helpfulAssets: helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'translation')
      + helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'rewrite'),
    helpfulCount: translationHelpfulCount + rewriteHelpfulCount + commentHelpfulCount + chatHelpfulCount,
    topHelpfulTranslation,
    topHelpfulRewrite,
    topHelpfulAsset,
  };
}

function renderAssetHelpfulButton(type, asset) {
  const btn = $(`#${type}-helpful`);
  if (!btn) return;
  const hasContent = entryAssetHasContent(type, asset);
  btn.classList.toggle('hidden', !hasContent);
  btn.disabled = !hasContent;
  if (!hasContent) {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '有用';
    return;
  }
  const helpfulCount = Number(asset.helpfulCount) || 0;
  const active = Boolean(asset.helpfulByMe);
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.textContent = helpfulCount ? `有用 ${helpfulCount}` : '有用';
  btn.title = active ? '取消有用标记' : '觉得这个资产有用';
}

function renderTranslation(translation, { loading = false } = {}) {
  const hasContent = Boolean(translation && Array.isArray(translation.content) && translation.content.length);
  state.translation = hasContent ? translation : null;
  renderReaderStatsUi();
  const list = $('#translation-list');
  const empty = $('#translation-empty');
  const emptyText = empty.querySelector('p');
  const action = $('#reader-bilingual');
  const mode = $('#translation-view-toggle');
  const copy = $('#translation-copy');
  list.innerHTML = '';
  list.classList.toggle('translation-compare', state.translationCompare);
  list.classList.toggle('translation-zh', !state.translationCompare);
  mode.classList.toggle('hidden', !hasContent);
  mode.disabled = !hasContent;
  mode.classList.toggle('active', Boolean(state.translationCompare));
  mode.setAttribute('aria-pressed', state.translationCompare ? 'true' : 'false');
  mode.textContent = state.translationCompare ? '纯中文' : '对照';
  mode.title = state.translationCompare ? '切回纯中文译文' : '显示双语对照';
  copy.classList.toggle('hidden', !hasContent);
  copy.disabled = !hasContent;
  renderAssetHelpfulButton('translation', state.translation);
  if (loading) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '正在检查这篇文章的翻译缓存…';
    action.disabled = true;
    action.textContent = '检查中…';
    $('#translation-meta').textContent = '检查中';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  if (!hasContent) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '这篇文章还没有中文翻译。';
    action.disabled = false;
    action.textContent = '生成中文翻译';
    $('#translation-meta').textContent = '暂无';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  empty.classList.add('hidden');
  action.disabled = false;
  action.textContent = translation.stale ? '更新中文翻译' : '重新生成中文翻译';
  $('#translation-meta').textContent = [translation.stale ? '原文已更新' : '', translation.createdBy, translation.model, formatAssetTime(translation.updatedAt)].filter(Boolean).join(' · ');
  renderAssetHelpfulButton('translation', state.translation);
  const blocks = enrichedTranslationBlocks(translation);
  list.innerHTML = blocks.map(pair => state.translationCompare
    ? `<div class="translation-pair">
        <div class="translation-source">${pair.sourceHtml ? sanitize(pair.sourceHtml) : `<p>${escapeHtml(pair.source || '')}</p>`}</div>
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`
    : `<div class="translation-block">
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`).join('');
  $$('#translation-list a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('translation');
}

function copyTranslationText() {
  const translation = state.translation;
  const lines = translation && Array.isArray(translation.content)
    ? translation.content.map(translationPairText).filter(Boolean)
    : [];
  copyText(lines.join('\n\n'), '译文已复制');
}

async function loadTranslation(entry) {
  state.translationLoading = true;
  renderTranslation(null, { loading: true });
  updateReaderTranslateButton(entry);
  try {
    const assetId = state.readerFocus === 'translation' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/translation${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderTranslation(data.translation);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      rememberTranslation(entry.id, data.translation);
      syncCatalogFromTranslation(entry.id, data.translation);
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
      // 有可展示译文就默认贴简中（stale 不挡）
      if (shouldOpenInZhView(entry.id, true) && translationHasDisplayableZh(data.translation)) {
        setEntryZhViewPref(entry.id, true);
        await applyZhArticleView(entry, data.translation);
      }
      renderList();
    }
  } catch {
    renderTranslation(null);
  } finally {
    state.translationLoading = false;
    updateReaderTranslateButton(state.activeEntry);
    if (state.pendingTranslationGenerate && state.activeEntry?.id === entry.id && state.readerTab === 'translation' && !state.translation) {
      state.pendingTranslationGenerate = false;
      generateTranslation();
    }
  }
}

/** 客户端译文内存缓存（避免重复 GET/POST） */
const translationMemory = new Map();

function rememberTranslation(entryId, translation) {
  const id = String(entryId || '').trim();
  if (!id || !translationHasContent(translation)) return;
  translationMemory.set(id, translation);
}

function rememberedTranslation(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const hit = translationMemory.get(id);
  return translationHasContent(hit) ? hit : null;
}

function readZhViewPrefMap() {
  const raw = readJson(READER_ZH_VIEW_KEY, '{}');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** null=未记录, true=偏好简中, false=用户显式要原文 */
function getEntryZhViewPref(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const map = readZhViewPrefMap();
  if (!Object.prototype.hasOwnProperty.call(map, id)) return null;
  return Boolean(map[id]);
}

function setEntryZhViewPref(entryId, zh) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const map = readZhViewPrefMap();
  map[id] = Boolean(zh);
  storage.setItem(READER_ZH_VIEW_KEY, JSON.stringify(map));
}

/**
 * 有服务端/内存译文时：默认永远开简中（列表卡 + 正文）。
 * 「原文」仅本次阅读临时切换，关掉再开 / 切卡再回来仍回中文。
 */
function shouldOpenInZhView(entryId, hasTranslation) {
  return Boolean(hasTranslation);
}

/**
 * 译文是否可默认展示为简中。
 * 规则：只要有 content 块就展示——stale 只表示可点「更新」，绝不挡默认简中。
 */
function translationHasDisplayableZh(translation) {
  return translationHasContent(translation);
}

/** GET 服务端永久缓存，不触发 Gemini */
async function fetchTranslationCache(entry) {
  if (!entry || !entry.id) return null;
  const mem = rememberedTranslation(entry.id);
  // 内存有可展示中文：直接用（含 soft-stale）
  if (mem && translationHasDisplayableZh(mem)) return mem;
  const data = await api(`/api/entry/${entry.id}/translation`);
  const has = data.translation && Array.isArray(data.translation.content) && data.translation.content.length;
  if (!has) return null;
  // 永久进内存：含 stale 标记的译文也缓存，默认展示简中不因 stale 丢弃
  rememberTranslation(entry.id, data.translation);
  return data.translation;
}

/**
 * 开文默认贴简中：内存 → 预取 Promise → 服务端缓存 → applyZh。
 * 有译文块就贴中文（切卡 / stale 一样）；无译文返回 false。
 * @param {object} [opts.prefetch] 已启动的 GET translation Promise，避免重复请求
 * @returns {Promise<boolean>} 是否已贴上简中
 */
async function ensureDefaultZhView(entry, { openGen = state.openGen, prefetch = null } = {}) {
  if (!entry || !entry.id) return false;
  const stillHere = () => (
    openGen === state.openGen
    && state.activeEntry?.id === entry.id
  );
  state.translationLoading = true;
  updateReaderTranslateButton(entry);
  try {
    let translation = null;
    // 1) 当前 state / 内存缓存
    if (translationHasDisplayableZh(state.translation)
      && String((state.translation && state.translation.entryId) || entry.id) === entry.id) {
      translation = state.translation;
    }
    if (!translationHasDisplayableZh(translation)) {
      translation = rememberedTranslation(entry.id);
    }
    // 2) 开文时并行预取的 Promise
    if (!translationHasDisplayableZh(translation) && prefetch) {
      try {
        const pre = await prefetch;
        if (translationHasDisplayableZh(pre)) translation = pre;
      } catch { /* fallthrough */ }
    }
    // 3) 服务端永久缓存
    if (!translationHasDisplayableZh(translation)) {
      try {
        translation = await fetchTranslationCache(entry);
      } catch {
        translation = rememberedTranslation(entry.id);
      }
    }
    if (!stillHere()) return false;

    if (!translationHasDisplayableZh(translation)) {
      if (translation && (translation.titleZh || translation.summaryZh)) {
        syncCatalogFromTranslation(entry.id, translation);
      }
      if (!translationHasContent(translation)) state.translation = null;
      updateReaderTranslateButton(entry);
      return false;
    }

    state.translation = translation;
    rememberTranslation(entry.id, translation);
    syncCatalogFromTranslation(entry.id, translation);
    // 有译文：永远默认简中（「原文」只是本次临时，下次开文仍中文）
    setEntryZhViewPref(entry.id, true);
    await applyZhArticleView(entry, translation, { openGen });
    if (!stillHere()) return false;
    updateReaderTranslateButton(entry);
    return Boolean(state.readerZhMode);
  } catch (err) {
    console.warn('ensureDefaultZhView failed', err);
    if (stillHere()) {
      const mem = rememberedTranslation(entry.id);
      if (translationHasDisplayableZh(mem)) {
        try {
          state.translation = mem;
          await applyZhArticleView(entry, mem, { openGen });
          return Boolean(state.readerZhMode);
        } catch { /* fallthrough */ }
      }
      updateReaderTranslateButton(entry);
    }
    return false;
  } finally {
    if (stillHere()) {
      state.translationLoading = false;
      updateReaderTranslateButton(state.activeEntry);
    } else {
      state.translationLoading = false;
    }
  }
}

/** 兼容旧名：静默拉翻译缓存并默认贴简中 */
async function loadTranslationForZenButton(entry) {
  return ensureDefaultZhView(entry);
}

function rewriteMetaText(rewrite) {
  if (!rewrite || !rewrite.body) return '';
  return [
    rewrite.stale ? '原文/链接已更新' : '',
    rewrite.model || DEFAULT_REWRITE_MODEL,
    formatAssetTime(rewrite.updatedAt),
  ].filter(Boolean).join(' · ');
}

function renderRewrite(rewrite) {
  state.rewrite = rewrite || null;
  const copyTextForEntry = rewriteUiCopy();
  updateRewriteUiLabels();
  renderReaderStatsUi();
  const content = $('#rewrite-content');
  const empty = $('#rewrite-empty');
  const copy = $('#rewrite-copy');
  const action = $('#reader-rewrite');
  const meta = $('#rewrite-meta');
  content.innerHTML = '';
  copy.classList.toggle('hidden', !rewrite || !rewrite.body);
  copy.disabled = !rewrite || !rewrite.body;
  renderAssetHelpfulButton('rewrite', state.rewrite);
  if (!rewrite || !rewrite.body) {
    empty.classList.remove('hidden');
    if (meta) {
      meta.textContent = '';
      meta.classList.add('hidden');
    }
    if (action) {
      action.textContent = copyTextForEntry.action;
      action.title = copyTextForEntry.generateTitle;
    }
    renderAssetHelpfulButton('rewrite', null);
    return;
  }
  empty.classList.add('hidden');
  const metaText = rewriteMetaText(rewrite);
  if (action) {
    action.textContent = rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
    action.title = [rewrite.stale ? copyTextForEntry.updateTitle : copyTextForEntry.redoTitle, metaText].filter(Boolean).join(' · ');
  }
  if (meta) {
    meta.textContent = metaText;
    meta.classList.add('hidden');
  }
  renderAssetHelpfulButton('rewrite', state.rewrite);
  content.innerHTML = renderMarkdownLite(rewrite.body);
  $$('#rewrite-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('rewrite');
}

function copyRewriteText() {
  copyText(state.rewrite && state.rewrite.body, rewriteUiCopy().copied);
}

async function loadRewrite(entry) {
  state.rewriteLoading = true;
  renderRewrite(null);
  try {
    const assetId = state.readerFocus === 'rewrite' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/rewrite${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
  } catch {
    renderRewrite(null);
  } finally {
    state.rewriteLoading = false;
    if (state.activeEntry?.id === entry.id) maybeGenerateRewriteAfterLoad(entry);
  }
}

async function toggleEntryAssetHelpful(type) {
  const entry = state.activeEntry;
  const asset = type === 'translation' ? state.translation : type === 'rewrite' ? state.rewrite : null;
  if (!entry || !entryAssetHasContent(type, asset)) return;
  const btn = $(`#${type}-helpful`);
  const nextHelpful = !asset.helpfulByMe;
  const assetId = String(asset.id || state.readerAssetId || '').trim();
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/assets/${encodeURIComponent(type)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful, assetId }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    const nextAsset = state.readerAssetId && (type === 'translation' || type === 'rewrite')
      ? { ...asset, ...(data.reaction || {}) }
      : data[type] || { ...asset, ...(data.reaction || {}) };
    if (type === 'translation') renderTranslation(nextAsset);
    if (type === 'rewrite') renderRewrite(nextAsset);
    updateEntryAssets(entry.id, entryAssetHelpfulPatch(type, nextAsset, state.activeEntry), { rerenderList: false });
    renderList();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  } finally {
    renderAssetHelpfulButton(type, type === 'translation' ? state.translation : state.rewrite);
  }
}

/** X 收藏：仅长文（Article）走结构翻译；短推/图帖不翻。返回可译的 social payload 或 null */
function xTranslatableArticlePayload(entry) {
  if (!entry) return null;
  const sid = String(entry.sourceId || '');
  if (sid !== 'x-likes') return null;
  const content = contentCache.get(entry.id) || entry.content || '';
  const social = parseSocialPayload(content);
  if (!social || (social.platform && social.platform !== 'x')) return null;
  const isArticle = social.kind === 'article'
    || social.isArticle === true
    || Boolean(xArticleHeadingFromBody(String(social.body || '')));
  return isArticle ? social : null;
}

/** 判断是否显示翻译按钮：英文原文，或已有永久译文缓存（切回原文后仍要能切） */
function isEnglishArticle(entry) {
  if (!entry) return false;
  // 社交流（小红书）不走这篇结构翻译；X 收藏仅长文（Article）放行；GitHub 项目允许翻译 README/简介
  const sid = String(entry.sourceId || '');
  if (sid === 'xhs-likes' || /^xhs-/.test(sid)) return false;
  let xArticle = null;
  if (sid === 'x-likes') {
    xArticle = xTranslatableArticlePayload(entry);
    if (!xArticle) return false;
  }
  // 课程库：一律当「可译」→ 默认简中 + 显示切换
  if (sid === 'zen-recent' || (typeof isSyllabusEntry === 'function' && isSyllabusEntry(entry))) {
    return true;
  }
  // 已有译文 / 列表已有中文标题摘要 / 资产标：始终显示切换，并走默认简中
  if (entry.id && (
    translationHasContent(state.translation)
    || rememberedTranslation(entry.id)
    || getEntryZhViewPref(entry.id) !== null
    || String(entry.titleZh || '').trim()
    || String(entry.summaryZh || '').trim()
    || (entry.assets && entry.assets.translation)
  )) {
    return true;
  }
  const title = String(entry.title || '');
  // X 长文：英文判定用正文 Markdown，不含 qm-social JSON 头
  const body = xArticle
    ? String(xArticle.body || '').slice(0, 4000)
    : String(contentCache.get(entry.id) || entry.content || entry.summary || '').slice(0, 4000);
  const sample = `${title}\n${body}`;
  const latin = sample.match(/\p{Script=Latin}/gu) || [];
  const cjk = sample.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
  return latin.length >= 24 && latin.length / Math.max(1, latin.length + cjk.length) >= 0.55;
}

function translationHasContent(translation = state.translation) {
  return Boolean(translation && Array.isArray(translation.content) && translation.content.length);
}

function updateReaderTranslateButton(entry = state.activeEntry) {
  // 顶栏按钮 + X 社交卡内按钮（data-x-translate）状态保持一致
  const buttons = [$('#reader-translate-btn'), ...$$('[data-x-translate]')].filter(Boolean);
  if (typeof updateReaderNoteButton === 'function') updateReaderNoteButton(entry);
  if (!buttons.length) return;
  // 笔记视图下隐藏翻译切换，避免出现两个「原文」按钮
  const english = isEnglishArticle(entry) && !state.readerNoteMode;
  const apply = (fn) => buttons.forEach(fn);
  apply(btn => btn.classList.toggle('hidden', !english));
  if (!english) {
    apply((btn) => {
      btn.disabled = false;
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  const hasCached = translationHasContent()
    || Boolean(entry && rememberedTranslation(entry.id));
  const busy = Boolean(state.translationGenerating || (state.translationLoading && !hasCached));
  apply(btn => { btn.disabled = busy; });
  if (busy) {
    apply((btn) => {
      btn.textContent = state.translationGenerating ? '翻译中…' : '检查中…';
      btn.title = '正在处理翻译';
      btn.classList.toggle('is-zh', Boolean(state.readerZhMode));
      btn.setAttribute('aria-pressed', state.readerZhMode ? 'true' : 'false');
    });
    return;
  }
  // 有永久缓存后：按钮只做 原文 ⇄ 中文，永不显示「翻译」
  if (state.readerZhMode && hasCached) {
    apply((btn) => {
      btn.textContent = '原文';
      btn.title = '切回英文原文（不重新翻译）';
      btn.classList.add('is-zh');
      btn.setAttribute('aria-pressed', 'true');
    });
    return;
  }
  if (hasCached) {
    apply((btn) => {
      btn.textContent = '中文';
      btn.title = '显示已缓存的简体中文译文（不重新请求 API）';
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  apply((btn) => {
    btn.textContent = '翻译';
    btn.title = '译为简体中文（仅首次调用 API，结果永久缓存）';
    btn.classList.remove('is-zh');
    btn.setAttribute('aria-pressed', 'false');
  });
}

/* ---------- 思考笔记（原文 ⇄ 笔记，Markdown，自动保存，自动进收藏） ---------- */

/** 思考笔记开放范围：X/小红书收藏、小红书博主知识库、知乎导入、Lil'Log */
function entrySupportsThinkingNote(entry) {
  if (!entry || !entry.id) return false;
  const sid = String(entry.sourceId || '');
  return sid === 'x-likes'
    || sid === 'xhs-likes'
    || /^xhs-/.test(sid)
    || /^zhihu-/.test(sid)
    || sid === 'lilianweng';
}

/** 客户端笔记内存缓存（避免重复 GET） */
const thinkingNoteMemory = new Map();

function rememberedThinkingNote(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  return thinkingNoteMemory.get(id) || null;
}

let thinkingNotePendingEntryId = '';
let thinkingNotePendingBody = null;
let thinkingNoteSaveTimer = null;

function setThinkingNoteStatus(text) {
  const el = $('#thinking-note-status');
  if (el) el.textContent = text || '';
}

async function loadThinkingNote(entry) {
  if (!entry || !entrySupportsThinkingNote(entry)) {
    state.thinkingNote = null;
    updateReaderNoteButton(entry);
    return null;
  }
  const cached = rememberedThinkingNote(entry.id);
  if (cached) {
    state.thinkingNote = cached;
    updateReaderNoteButton(entry);
    return cached;
  }
  state.thinkingNoteLoading = true;
  try {
    const data = await api(`/api/entry/${entry.id}/note`);
    const note = (data && data.note) || null;
    if (note) thinkingNoteMemory.set(entry.id, note);
    if (state.activeEntry?.id === entry.id) state.thinkingNote = note;
    return note;
  } catch {
    return null;
  } finally {
    state.thinkingNoteLoading = false;
    updateReaderNoteButton(state.activeEntry);
  }
}

function scheduleThinkingNoteSave(entryId, body) {
  thinkingNotePendingEntryId = String(entryId || '');
  thinkingNotePendingBody = String(body == null ? '' : body);
  setThinkingNoteStatus('未保存…');
  if (thinkingNoteSaveTimer) clearTimeout(thinkingNoteSaveTimer);
  thinkingNoteSaveTimer = setTimeout(() => { flushThinkingNoteSave(); }, 900);
}

async function flushThinkingNoteSave() {
  if (thinkingNoteSaveTimer) {
    clearTimeout(thinkingNoteSaveTimer);
    thinkingNoteSaveTimer = null;
  }
  if (thinkingNotePendingBody === null || !thinkingNotePendingEntryId) return;
  const entryId = thinkingNotePendingEntryId;
  const body = thinkingNotePendingBody;
  thinkingNotePendingEntryId = '';
  thinkingNotePendingBody = null;
  try {
    setThinkingNoteStatus('保存中…');
    const data = await api(`/api/entry/${entryId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const note = (data && data.note) || null;
    if (note) thinkingNoteMemory.set(entryId, note);
    else thinkingNoteMemory.delete(entryId);
    if (state.activeEntry?.id === entryId) state.thinkingNote = note;
    setThinkingNoteStatus(note ? `已保存 ${new Date().toTimeString().slice(0, 5)}` : '已清空');
    // 有思考笔记的文章自动进收藏
    if (note && !state.starred.has(entryId) && typeof toggleEntryStarred === 'function') {
      toggleEntryStarred(entryId, true);
    }
    updateReaderNoteButton(state.activeEntry);
  } catch (err) {
    // 失败重新排队，避免丢字
    thinkingNotePendingEntryId = entryId;
    thinkingNotePendingBody = body;
    setThinkingNoteStatus('保存失败，稍后自动重试');
    toast('笔记保存失败: ' + err.message, 4000);
    if (!thinkingNoteSaveTimer) {
      thinkingNoteSaveTimer = setTimeout(() => { flushThinkingNoteSave(); }, 5000);
    }
  }
}

// 刷新/关页兜底：sendBeacon 落盘未保存内容
window.addEventListener('beforeunload', () => {
  if (thinkingNotePendingBody === null || !thinkingNotePendingEntryId) return;
  try {
    navigator.sendBeacon(
      `/api/entry/${thinkingNotePendingEntryId}/note`,
      new Blob([JSON.stringify({ body: thinkingNotePendingBody })], { type: 'application/json' }),
    );
  } catch { /* ignore */ }
});

function updateReaderNoteButton(entry = state.activeEntry) {
  const buttons = [$('#reader-note-btn'), ...$$('[data-note-toggle]')].filter(Boolean);
  if (!buttons.length) return;
  const supported = entrySupportsThinkingNote(entry);
  buttons.forEach((btn) => btn.classList.toggle('hidden', !supported));
  if (!supported) return;
  const hasNote = Boolean(
    (state.thinkingNote && String(state.thinkingNote.body || '').trim())
    || (entry && rememberedThinkingNote(entry.id)),
  );
  buttons.forEach((btn) => {
    btn.disabled = false;
    if (state.readerNoteMode) {
      btn.textContent = '原文';
      btn.title = '返回文章（笔记已自动保存）';
      btn.classList.add('is-zh');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.textContent = '笔记';
      btn.title = hasNote ? '查看/编辑思考笔记' : '写思考笔记（Markdown，自动保存）';
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.classList.toggle('has-note', hasNote && !state.readerNoteMode);
  });
}

function thinkingNoteViewHtml() {
  return `<div class="thinking-note">
    <div class="thinking-note-bar">
      <div class="thinking-note-title">思考笔记</div>
      <div class="thinking-note-actions">
        <span id="thinking-note-status" class="thinking-note-status"></span>
        <button type="button" id="thinking-note-preview" class="thinking-note-mode-btn">预览</button>
      </div>
    </div>
    <textarea id="thinking-note-editor" class="thinking-note-editor" placeholder="记录读完这篇后的想法、AI 对话中的启发…（支持 Markdown，自动保存）" spellcheck="false"></textarea>
    <div id="thinking-note-render" class="thinking-note-render reader-content hidden"></div>
    <div class="thinking-note-hint">支持 Markdown · 输入后自动保存 · 有笔记的文章自动进收藏</div>
  </div>`;
}

async function toggleThinkingNotePreview() {
  const ta = $('#thinking-note-editor');
  const render = $('#thinking-note-render');
  const btn = $('#thinking-note-preview');
  if (!ta || !render || !btn) return;
  const showPreview = render.classList.contains('hidden');
  if (!showPreview) {
    render.classList.add('hidden');
    ta.classList.remove('hidden');
    btn.textContent = '预览';
    ta.focus();
    return;
  }
  ta.classList.add('hidden');
  render.classList.remove('hidden');
  btn.textContent = '编辑';
  const md = ta.value;
  if (!md.trim()) {
    render.innerHTML = '<p style="color:var(--text-2)">（空笔记）</p>';
    return;
  }
  render.innerHTML = '<p style="color:var(--text-2)">渲染中…</p>';
  try {
    const html = await renderMarkdownDocument(md, { sourceId: 'thinking-note' });
    render.innerHTML = await sanitizeAsync(html || '');
  } catch {
    render.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(md)}</pre>`;
  }
}

/** 进入笔记视图：与简中视图同权，收起社交壳，正文区变编辑器 */
async function applyNoteView(entry = state.activeEntry) {
  if (!entry || !entrySupportsThinkingNote(entry)) return false;
  const openGen = state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;
  state.noteReturnZh = Boolean(state.readerZhMode);
  state.readerNoteMode = true;
  state.readerZhMode = false;
  const reader = $('#reader');
  if (reader) {
    reader.classList.add('reader--note-view');
    reader.classList.remove('reader--zh-view');
    if (reader.classList.contains('reader--social')) {
      reader.classList.remove('reader--social', 'reader--x', 'reader--xhs', 'reader--bili');
    }
  }
  renderTitle(entry);
  const root = $('#reader-content');
  if (!root) return false;
  root.innerHTML = thinkingNoteViewHtml();
  state.readerTocAvailable = false;
  renderReaderToc(root);
  updateReaderTranslateButton(entry);
  const note = rememberedThinkingNote(entry.id) || state.thinkingNote || await loadThinkingNote(entry);
  if (!stillCurrent() || !state.readerNoteMode) return false;
  const ta = $('#thinking-note-editor');
  if (ta) {
    ta.value = (note && note.body) || '';
    ta.oninput = () => scheduleThinkingNoteSave(entry.id, ta.value);
    ta.focus();
  }
  const previewBtn = $('#thinking-note-preview');
  if (previewBtn) previewBtn.onclick = () => toggleThinkingNotePreview();
  setThinkingNoteStatus(note ? `已保存 ${typeof formatAssetTime === 'function' ? formatAssetTime(note.updatedAt) : ''}`.trim() : '');
  return true;
}

/** 退出笔记视图：先落盘，再回简中或原文 */
async function exitNoteView(entry = state.activeEntry) {
  await flushThinkingNoteSave();
  state.readerNoteMode = false;
  const wantZh = state.noteReturnZh;
  state.noteReturnZh = false;
  $('#reader')?.classList.remove('reader--note-view');
  if (!entry) return;
  if (wantZh && translationHasContent(state.translation)) {
    await applyZhArticleView(entry, state.translation);
  } else {
    await restoreOriginalArticleView(entry);
  }
  updateReaderNoteButton(entry);
}

async function handleReaderNoteClick() {
  const entry = state.activeEntry;
  if (!entry || !entrySupportsThinkingNote(entry)) return;
  if (state.readerNoteMode) await exitNoteView(entry);
  else await applyNoteView(entry);
}

function renderTitleForZh(entry, translation) {
  const titleZh = String(translation && translation.titleZh || '').trim();
  const mainLink = $('#reader-title-link');
  const originalLink = $('#reader-title-original-link');
  const originalWrap = $('#reader-title-zh');
  if (titleZh) {
    if (mainLink) setReaderTitleLink(mainLink, titleZh, entry && entry.link, '打开原文');
    else if ($('#reader-title')) $('#reader-title').textContent = titleZh;
    // 只保留中文主标题，隐藏英文副标题行
    if (originalWrap) originalWrap.classList.add('hidden');
    if (originalLink) setReaderTitleLink(originalLink, '', entry && entry.link, '打开原文');
  } else {
    renderTitle(entry);
  }
}

function comparableTitleText(value) {
  return String(value || '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 译文是否更像 Markdown（# ** -）而非 HTML 块 */
function translationLooksLikeMarkdown(translation) {
  const pairs = translation && Array.isArray(translation.content) ? translation.content : [];
  if (!pairs.length) return false;
  const withHtml = pairs.filter(p => p && p.targetHtml && /<\w[\s\S]*>/.test(p.targetHtml)).length;
  if (withHtml >= Math.ceil(pairs.length * 0.4)) return false;
  const mdHits = pairs.filter((p) => {
    const t = String(p && p.target || '');
    return /^#{1,6}\s/m.test(t) || /^\s*[-*+]\s+/m.test(t) || /\*\*[^*]+\*\*/.test(t) || /^>\s/m.test(t);
  }).length;
  return mdHits > 0 || withHtml === 0;
}

/**
 * 把译文块拼成 Markdown 正文：
 * - 去掉与标题重复的首行 # 标题
 * - 保留 **粗体** / 列表 / 二级标题等 md 语法，交给 renderMarkdownDocument
 */
function buildZhMarkdownFromTranslation(translation, entry) {
  const titleZh = String(translation && translation.titleZh || '').trim();
  const titleEn = String(entry && entry.title || '').trim();
  const skipTitles = new Set(
    [titleZh, titleEn].map(comparableTitleText).filter(Boolean),
  );
  const parts = [];
  for (const pair of translation.content || []) {
    if (!pair) continue;
    if (pair.kind === 'media' || pair.tag === 'img' || pair.tag === 'hr') {
      const html = String(pair.targetHtml || pair.sourceHtml || '').trim();
      if (html) parts.push(html);
      continue;
    }
    // 目标 HTML 已含图：直接保留结构（段内图 / figure）
    const th = String(pair.targetHtml || '').trim();
    if (th && /<img\b/i.test(th)) {
      parts.push(th);
      continue;
    }
    let text = String(pair.target || '').trim();
    if (!text && th) {
      text = th
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
    }
    // 译文纯文本但源 HTML 有图：图 + 中文（防校验清空 targetHtml 后丢图）
    const mediaFrom = sourceImagesFromHtml(pair.sourceHtml || '') || sourceImagesFromHtml(th);
    if (!text && mediaFrom) {
      parts.push(mediaFrom);
      continue;
    }
    if (!text) continue;
    // 装饰性 * * 当分隔线
    if (/^(\*\s*){1,3}$/.test(text) || /^(-+\s*){1,3}$/.test(text)) {
      parts.push('---');
      continue;
    }
    const plain = comparableTitleText(text);
    if (plain && skipTitles.has(plain)) {
      if (mediaFrom) parts.push(mediaFrom);
      continue;
    }
    // 去掉与标题重复的 # 标题行
    if (/^#{1,6}\s+/.test(text) && skipTitles.has(comparableTitleText(text.replace(/^#{1,6}\s+/, '')))) {
      if (mediaFrom) parts.push(mediaFrom);
      continue;
    }
    parts.push(mediaFrom ? `${mediaFrom}\n\n${text}` : text);
  }
  return parts.join('\n\n').trim();
}

function stripDuplicateReaderHeading(root, entry, translation) {
  if (!root) return;
  const comparable = comparableTitleText;
  const titles = [
    translation && translation.titleZh,
    entry && entry.titleZh,
    entry && entry.title,
  ].map(comparable).filter(Boolean);
  // 优先只剥 body 内重复标题；绝不拆 syllabus-brief 课程壳标题
  const body = root.querySelector('.syllabus-body');
  const firstHeading = (body || root).querySelector('h1,h2');
  if (
    firstHeading
    && !firstHeading.classList.contains('syllabus-title')
    && !firstHeading.closest('.syllabus-header')
    && titles.includes(comparable(firstHeading.textContent))
  ) {
    firstHeading.remove();
  }
}

/** 从译文抽出列表用中文标题/摘要 */
function listFieldsFromTranslation(translation) {
  if (!translationHasContent(translation)) return null;
  let titleZh = String(translation.titleZh || '').trim();
  let summaryZh = String(translation.summaryZh || '').trim();
  if (!summaryZh) {
    for (const pair of translation.content || []) {
      if (!pair || pair.kind === 'media') continue;
      const text = String(pair.target || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^#+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length >= 12 && comparableTitleText(text) !== comparableTitleText(titleZh)) {
        summaryZh = text.slice(0, 160);
        break;
      }
    }
  }
  if (!titleZh && !summaryZh) return null;
  return {
    titleZh: titleZh ? titleZh.slice(0, 120) : '',
    summaryZh: summaryZh ? summaryZh.slice(0, 160) : '',
  };
}

/** 译后：目录标题/摘要改中文（列表默认中文），并标 assets */
function syncCatalogFromTranslation(entryId, translation) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const fields = listFieldsFromTranslation(translation);
  const prev = entryByIdFromList(id) || (state.activeEntry?.id === id ? state.activeEntry : null);
  const patch = {};
  if (fields) {
    if (fields.titleZh) patch.titleZh = fields.titleZh;
    if (fields.summaryZh) patch.summaryZh = fields.summaryZh;
  }
  if (prev) patch.assets = mergeAssets(prev, { translation: true });
  if (!Object.keys(patch).length) return;
  patchCatalogEntry(id, patch);
  if (state.activeEntry?.id === id) {
    state.activeEntry = { ...state.activeEntry, ...patch };
  }
  patchEntryCardZhFields(id);
}

/** 单卡 DOM：标题+摘要改中文（不显示文A徽章） */
function patchEntryCardZhFields(entryId) {
  const root = $('#entry-list');
  if (!root) return false;
  const id = String(entryId || '').trim();
  const entry = entryByIdFromList(id);
  if (!entry) return false;
  let card = null;
  try {
    card = root.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
  } catch {
    card = [...root.querySelectorAll('.entry-card')].find(el => el.dataset.id === id) || null;
  }
  if (!card) return false;
  const isSyllabus = typeof isSyllabusEntry === 'function' && isSyllabusEntry(entry);
  let title = String(entry.titleZh || entry.title || '').trim();
  let summary = isSyllabus && typeof syllabusCardSummary === 'function'
    ? syllabusCardSummary(entry)
    : listSummaryText(entry);
  if (isSyllabus) {
    const codeLike = String(entry.title || '').trim();
    const zh = String(entry.titleZh || '').trim();
    if (typeof isSyllabusCourseCode === 'function' && isSyllabusCourseCode(codeLike)) {
      title = codeLike;
      if (!summary || summary === codeLike) summary = (zh && zh !== codeLike) ? zh : '';
    } else if (zh) {
      title = zh;
      if (summary === title || summary === zh || summary === codeLike) summary = '';
    }
    if (summary && summary.replace(/\s+/g, '') === title.replace(/\s+/g, '')) summary = '';
  }
  const titleEl = card.querySelector('.entry-title');
  if (titleEl) titleEl.textContent = title;
  // 去掉英文副标题行（若有）
  card.querySelector('.entry-original')?.remove();
  // 课程卡不显示右上角学校 time
  if (isSyllabus) card.querySelector('.entry-time')?.remove();
  let summaryEl = card.querySelector('.entry-summary');
  if (summary) {
    if (!summaryEl) {
      summaryEl = document.createElement('div');
      summaryEl.className = isSyllabus ? 'entry-summary entry-summary--course' : 'entry-summary';
      titleEl?.after(summaryEl);
    }
    summaryEl.textContent = summary;
  } else if (summaryEl) {
    summaryEl.remove();
  }
  if (title) card.setAttribute('aria-label', [title, summary].filter(Boolean).join(' · '));
  return true;
}

/**
 * 同一张图的身份键：原文本地化后路径与译文里仍保留的 CDN URL 往往字面不同，
 * 若只用 full URL includes() 判断，会把已有配图再整批插到标题下（堆图/重复）。
 */
function imageIdentityKeys(src) {
  const raw = String(src || '').trim();
  if (!raw) return [];
  const keys = new Set([raw]);
  try {
    const noHash = raw.split('#')[0];
    keys.add(noHash);
    const pathOnly = noHash.split('?')[0];
    keys.add(pathOnly);
    const base = pathOnly.split('/').pop() || '';
    if (base) keys.add(base);
    const local = pathOnly.match(/\/article-images\/[^\s"'<>]+/i);
    if (local) keys.add(local[0]);
    // 本地文件名哈希（sha256 截断）
    const fileHash = base.match(/^([a-f0-9]{16,40})\.[a-z0-9]+$/i);
    if (fileHash) keys.add(fileHash[1].toLowerCase());
  } catch { /* ignore */ }
  // Substack / S3 媒体 UUID
  for (const m of raw.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    keys.add(m[0].toLowerCase());
  }
  // 常见 CDN 裸文件名：xxx_1999x1237.png
  for (const m of raw.matchAll(/([0-9a-f]{8,}(?:-[0-9a-f]{4,})*_\d{2,5}x\d{2,5}\.(?:png|jpe?g|gif|webp))/gi)) {
    keys.add(m[1].toLowerCase());
  }
  return [...keys].filter(Boolean);
}

function htmlAlreadyHasImage(html, src) {
  const source = String(html || '');
  if (!source || !src) return false;
  return imageIdentityKeys(src).some((key) => key.length >= 8 && source.includes(key));
}

/**
 * 译文 HTML 补回原文丢失的 img（支持 HTML <img> 与 Markdown ![]()）
 * 仅在译文几乎无图时做标题下兜底；译文已有配图时绝不整批前置，避免重复堆图。
 */
function mergeMissingOriginalImages(zhHtml, originalHtml) {
  let html = String(zhHtml || '');
  const original = String(originalHtml || '');
  if (!original) return html;

  const zhImgCount = (html.match(/<img\b/gi) || []).length;
  const origImgCount = (original.match(/<img\b/gi) || []).length
    + (original.match(/!\[[^\]]*\]\([^)\s]+\)/g) || []).length;

  // 译文侧已有像样配图：只认「身份键」缺失，且不把漏图堆到文首
  // （漏图应留在块级 structure；文首堆图比丢一两张更糟）
  if (zhImgCount > 0 && (origImgCount === 0 || zhImgCount >= Math.max(1, Math.ceil(origImgCount * 0.35)))) {
    return html;
  }

  const isAllowedImgSrc = (src) => {
    const key = String(src || '').trim();
    return /^https?:\/\//i.test(key) || key.startsWith('/article-images/');
  };
  const missing = [];
  const seen = new Set();
  const add = (src, alt = '') => {
    const key = String(src || '').trim();
    if (!key || !isAllowedImgSrc(key) || seen.has(key) || htmlAlreadyHasImage(html, key)) return;
    // 同一身份只收一次
    for (const id of imageIdentityKeys(key)) {
      if (seen.has(`id:${id}`)) return;
    }
    seen.add(key);
    for (const id of imageIdentityKeys(key)) seen.add(`id:${id}`);
    missing.push(`<img src="${escapeHtml(key)}" alt="${escapeHtml(alt)}">`);
  };
  for (const m of original.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    add(m[1]);
  }
  for (const m of original.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    add(m[2], m[1] || '');
  }
  if (!missing.length) return html;
  const inject = missing
    .map(tag => `<figure class="translation-recovered-image">${tag}</figure>`)
    .join('\n');
  if (/<\/h1>/i.test(html)) return html.replace(/<\/h1>/i, `</h1>\n${inject}`);
  if (/<\/h2>/i.test(html)) return html.replace(/<\/h2>/i, `</h2>\n${inject}`);
  return `${inject}\n${html}`;
}

/**
 * 用译文替换阅读区为简中，格式尽量与原文一致：
 * - Markdown 源：拼 md → Marked 渲染
 * - HTML 块译文：拼 targetHtml
 * - 补回丢失图片；去掉与页头重复的首标题
 * openGen 守卫：切文后过期请求不得写 DOM / 不得提前锁 readerZhMode
 */
async function applyZhArticleView(entry, translation, opts = {}) {
  if (!entry || !translationHasContent(translation)) return false;
  // 笔记视图打开时不贴简中；退出笔记时按 noteReturnZh 再回简中
  if (state.readerNoteMode) return false;
  const openGen = opts.openGen ?? state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;

  const original = contentCache.get(entry.id) || entry.content || '';
  const isSyllabus = Boolean(
    entry.sourceId === 'zen-recent'
    || (typeof sourceById === 'function' && sourceById(entry.sourceId)?.contentKind === 'syllabus')
    || /class=["'][^"']*syllabus-brief/.test(String(original)),
  );

  let zhInner = '';
  let shellHtml = '';
  try {
    let html = '';
    if (translationLooksLikeMarkdown(translation)) {
      const md = buildZhMarkdownFromTranslation(translation, entry);
      html = md
        ? await renderMarkdownDocument(md, { sourceId: entry.sourceId || '' })
        : '';
      if (!stillCurrent()) return false;
    } else {
      // 课程译文保留已缓存的完整 table targetHtml；重新按当前原文对齐会在课程重抓后
      // 丢掉旧译文中的图片/表格块（CME295/296 尤其明显）。
      const blocks = isSyllabus && Array.isArray(translation.content)
        ? translation.content
        : enrichedTranslationBlocks(translation);
      html = blocks.map(pair => translationBlockTargetHtml(pair)).join('');
    }
    // 块里 p>img 或 media 可能漏图：从原文补全
    if (looksLikeHtmlDocument(original)) {
      html = mergeMissingOriginalImages(html, original);
    } else if (html && !/<img\b/i.test(html)) {
      const imgs = sourceImagesFromHtml(original);
      if (imgs) html = `${imgs}\n${html}`;
    }
    zhInner = html
      ? await sanitizeAsync(html, { prioritizeFirstImage: true })
      : '<p style="color:var(--text-2)">译文为空</p>';
    if (!stillCurrent()) return false;

    // 课程大纲：保留 syllabus-brief 壳（徽章/打开/chips），只替换 body 为简中
    if (isSyllabus && looksLikeHtmlDocument(original) && /syllabus-brief/.test(original)) {
      const shell = document.createElement('div');
      shell.innerHTML = await sanitizeAsync(original, { prioritizeFirstImage: true });
      if (!stillCurrent()) return false;
      const brief = shell.querySelector('article.syllabus-brief, .syllabus-brief');
      if (brief) {
        let body = brief.querySelector('.syllabus-body');
        if (!body) {
          body = document.createElement('section');
          body.className = 'syllabus-body';
          brief.appendChild(body);
        }
        body.innerHTML = zhInner;
        brief.querySelectorAll('.syllabus-empty').forEach((el) => el.remove());
        shellHtml = shell.innerHTML;
      } else {
        shellHtml = `<section class="syllabus-body">${zhInner}</section>`;
      }
    }
  } catch (err) {
    console.warn('applyZhArticleView render failed', err);
    if (!stillCurrent()) return false;
    const fallback = buildZhMarkdownFromTranslation(translation, entry);
    zhInner = fallback
      ? `<div class="reader-content">${escapeHtml(fallback).replace(/\n\n/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>')}</div>`
      : '<p style="color:var(--text-2)">译文渲染失败</p>';
    shellHtml = '';
  }

  if (!stillCurrent()) return false;

  // 校验 gen 通过后再写 mode / DOM，避免切文竞态盖错正文
  state.readerZhMode = true;
  state.translation = translation;
  rememberTranslation(entry.id, translation);
  setEntryZhViewPref(entry.id, true);
  syncCatalogFromTranslation(entry.id, translation);
  const reader = $('#reader');
  if (reader) {
    reader.classList.add('reader--zh-view');
    if (isSyllabus) reader.classList.add('reader--syllabus');
    // X 长文简中视图：译文是标准文章结构，收起社交壳（顶栏标题/翻译按钮恢复显示）；
    // 切回原文时 renderOriginalContent 会重新加回这些类
    if (reader.classList.contains('reader--social')) {
      reader.classList.remove('reader--social', 'reader--x', 'reader--xhs', 'reader--bili');
    }
  }
  renderTitleForZh(entry, translation);
  const root = $('#reader-content');
  if (!root) {
    updateReaderTranslateButton(entry);
    return true;
  }

  if (shellHtml) root.innerHTML = shellHtml;
  else root.innerHTML = zhInner;

  if (isSyllabus && typeof enhanceSyllabusContent === 'function') {
    enhanceSyllabusContent(root, entry);
  }
  stripDuplicateReaderHeading(root, entry, translation);
  $$('#reader-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  renderReaderToc(root);
  updateReaderLanguageProfile();
  updateReaderTranslateButton(entry);
  if (typeof applyLocalContentMarks === 'function') applyLocalContentMarks(root, entry && entry.id);
  return true;
}

async function restoreOriginalArticleView(entry = state.activeEntry) {
  state.readerZhMode = false;
  const reader = $('#reader');
  if (reader) reader.classList.remove('reader--zh-view');
  if (!entry) {
    updateReaderTranslateButton(null);
    return;
  }
  // 不持久化「偏好原文」：下次开文仍默认简中；仅本次会话看原文
  renderTitle(entry);
  const content = contentCache.get(entry.id) || entry.content || entry.summary || '';
  await renderOriginalContent(entry, content);
  updateReaderTranslateButton(entry);
}

function omitQuotesForTranslation(entryId = state.activeEntry?.id) {
  if (typeof localDeletionQuotes === 'function') return localDeletionQuotes(entryId);
  if (typeof localContentMarksFor !== 'function') return [];
  const marks = localContentMarksFor(entryId);
  return (marks.deletions || [])
    .map(d => String(d && d.quote || '').replace(/\s+/g, ' ').trim())
    .filter(q => q.length >= 2);
}

async function generateTranslation({ force = false, inplace = false } = {}) {
  let entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-bilingual');
  const omitQuotes = omitQuotesForTranslation(entry.id);
  // 有本机删除时必须走服务端（hash 含 omit），勿直接吃旧全文缓存
  // 一键翻译路径：有有效缓存则不再 POST；stale（原文已变）必须重译
  if (inplace && !force && !omitQuotes.length) {
    const existing = translationHasDisplayableZh(state.translation)
      ? state.translation
      : await fetchTranslationCache(entry).catch(() => null);
    if (translationHasDisplayableZh(existing)) {
      state.translation = existing;
      await applyZhArticleView(entry, existing);
      toast(existing.stale ? '已显示简中译文（原文有更新，可再点翻译刷新）' : '已显示缓存简中译文');
      return;
    }
  }
  if (state.translation && !force && !inplace) {
    setReaderTab('translation');
    return;
  }
  if (state.translationLoading && !inplace) {
    state.pendingTranslationGenerate = true;
    setReaderTab('translation');
    updateReaderTranslateButton(entry);
    return;
  }
  if (state.translationGenerating) return;

  // 优先用浏览器 AI Profile 的 key / baseUrl / model；未填则直接打开配置
  let aiConfig = translationAiConfig();
  // DeepSeek 缺省补全，避免只填了 key 却因 baseUrl/model 空而走服务端 Gemini 卡住
  if (String(aiConfig.provider || '').toLowerCase() === 'deepseek' || !aiConfig.provider) {
    aiConfig = {
      ...aiConfig,
      provider: 'deepseek',
      providerName: aiConfig.providerName || 'DeepSeek',
      providerType: 'openai_compatible',
      baseUrl: normalizeBaseUrl(aiConfig.baseUrl || 'https://api.deepseek.com/v1'),
      model: String(aiConfig.model || DEFAULT_REWRITE_MODEL || 'deepseek-v4-flash').trim() || 'deepseek-v4-flash',
    };
  }
  if (!hasUsableAiConfig(aiConfig)) {
    openAiConfigModal('translation', 'translation');
    toast('请先填写 DeepSeek 的 API Key（Base URL / 模型可自动补全）');
    return;
  }

  // 译前仅在真正缺正文时补抓；本地 crawl 全文 / 已有镜像图不再联网
  if (
    inplace
    && entry
    && typeof shouldAutoFetchOriginalOnOpen === 'function'
    && shouldAutoFetchOriginalOnOpen(entry)
    && !state.fetchingOriginal
  ) {
    try {
      await fetchOriginalContent();
      entry = state.activeEntry || entry;
    } catch (err) {
      console.warn('pre-translate original fetch skipped', err);
    }
  }

  state.readerAssetId = '';
  if (!inplace) setReaderTab('translation');
  state.translationGenerating = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '翻译中…';
  }
  updateReaderTranslateButton(entry);
  try {
    const data = await api(`/api/entry/${entry.id}/translation`, {
      method: 'POST',
      aiConfig,
      headers: { 'Content-Type': 'application/json' },
      // 一键路径永不 force，服务端 contentHash 命中直接返回缓存；omitQuotes 参与 hash
      body: JSON.stringify({
        force: inplace ? false : force,
        omitQuotes,
      }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      rememberTranslation(entry.id, data.translation);
      syncCatalogFromTranslation(entry.id, data.translation);
      renderTranslation(data.translation);
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
    } else {
      renderTranslation(data.translation);
    }
    if (inplace) {
      await applyZhArticleView(state.activeEntry || entry, data.translation);
      toast(data.cached ? '已显示缓存简中译文' : '已译为简体中文（已永久保存）');
    } else {
      setReaderTab('translation');
      toast(data.originalFetched ? '已获取原文并保存双语翻译' : data.cached ? '已显示缓存翻译' : '双语翻译已保存');
    }
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('translation', 'translation');
    }
    toast('翻译失败: ' + err.message, 5000);
  } finally {
    state.translationGenerating = false;
    if (btn) {
      btn.disabled = false;
      if (!state.translation) btn.textContent = '生成中文翻译';
      else btn.textContent = state.translation.stale ? '更新中文翻译' : '重新生成中文翻译';
    }
    updateReaderTranslateButton(state.activeEntry);
  }
}

async function handleReaderTranslateClick() {
  const entry = state.activeEntry;
  if (!entry || !isEnglishArticle(entry)) return;
  if (state.translationGenerating) return;

  // 1) 内存已有译文 → 纯切换，零网络（含 soft-stale）
  if (translationHasDisplayableZh(state.translation) || translationHasContent()) {
    if (state.readerZhMode) {
      await restoreOriginalArticleView(entry);
      return;
    }
    await applyZhArticleView(entry, state.translation);
    return;
  }

  // 2) 内存缓存 / 服务端 SQLite 永久缓存 → GET，仍不调 Gemini
  try {
    state.translationLoading = true;
    updateReaderTranslateButton(entry);
    const cached = rememberedTranslation(entry.id) || await fetchTranslationCache(entry);
    if (state.activeEntry?.id !== entry.id) return;
    if (translationHasDisplayableZh(cached) || translationHasContent(cached)) {
      state.translation = cached;
      if (state.readerZhMode) {
        await restoreOriginalArticleView(entry);
      } else {
        await applyZhArticleView(entry, cached);
      }
      return;
    }
  } catch {
    /* 无缓存则继续首次翻译 */
  } finally {
    state.translationLoading = false;
    updateReaderTranslateButton(state.activeEntry);
  }

  // 3) 真正首次：POST force:false，结果写入 SQLite 永久缓存
  await generateTranslation({ force: false, inplace: true });
}

async function generateRewrite({ force = false } = {}) {
  const entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-rewrite');
  if (state.rewrite && !force) {
    setReaderTab('rewrite');
    return;
  }
  if (state.rewriteGenerating) return;
  state.readerAssetId = '';
  setReaderTab('rewrite');
  state.rewriteGenerating = true;
  btn.disabled = true;
  btn.textContent = rewriteUiCopy(entry).generating;
  try {
    const data = await api(`/api/entry/${entry.id}/rewrite`, {
      method: 'POST',
      aiConfig: rewriteAiConfig(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
    setReaderTab('rewrite');
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    toast(data.originalFetched ? copyTextForEntry.fetched : data.cached ? copyTextForEntry.cached : copyTextForEntry.saved);
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('rewrite', 'rewrite');
    }
    toast(rewriteUiCopy(entry).failedPrefix + err.message, 5000);
  } finally {
    state.rewriteGenerating = false;
    btn.disabled = false;
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    if (!state.rewrite) btn.textContent = copyTextForEntry.action;
    else btn.textContent = state.rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
  }
}

async function fetchOriginalContent() {
  const entry = state.activeEntry;
  if (!entry) return;
  const openGen = state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;
  if (!entry.link || !/^https?:\/\//i.test(entry.link)) {
    toast('这篇文章没有可抓取的原文链接');
    return;
  }
  // 知乎等本地导入源：正文已在库，禁止再匿名 HTTP（会 403 并误报）
  if (typeof isLocalOfflineSourceId === 'function' && isLocalOfflineSourceId(entry.sourceId)) {
    toast('本地导入源已有正文，无需抓取网页');
    updateFetchOriginalButton(entry);
    return;
  }
  state.fetchingOriginal = true;
  updateFetchOriginalButton(entry);
  setReaderTab('original');
  const contentEl = $('#reader-content');
  if (contentEl) contentEl.innerHTML = '<p style="color:var(--text-2)">正在获取原文内容…</p>';
  try {
    const data = await api(`/api/entry/${entry.id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!stillCurrent()) return;
    const updated = { ...entry, ...(data.entry || {}) };
    state.activeEntry = updated;
    const idx = state.entries.findIndex(item => item.id === updated.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], ...updated, content: undefined };
    contentCache.set(updated.id, updated.content || '');
    renderTitle(updated);
    renderOriginalContent(updated, updated.content);
    renderList();
    state.translation = null;
    state.rewrite = null;
    loadTranslation(updated);
    loadRewrite(updated);
    toast('原文已获取并保存');
  } catch (err) {
    if (!stillCurrent()) return;
    const failedEntry = {
      ...entry,
      originalFetchAttemptedAt: Date.now(),
      originalFetchError: err.message,
    };
    state.activeEntry = failedEntry;
    const idx = state.entries.findIndex(item => item.id === failedEntry.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], originalFetchAttemptedAt: failedEntry.originalFetchAttemptedAt, originalFetchError: failedEntry.originalFetchError };
    renderOriginalContent(failedEntry, contentCache.get(entry.id) || entry.content || '');
    toast('获取原文失败: ' + err.message, 5000);
  } finally {
    if (stillCurrent()) {
      state.fetchingOriginal = false;
      updateFetchOriginalButton(state.activeEntry);
    } else {
      state.fetchingOriginal = false;
    }
  }
}

function normalizeAnnotationSurface(surface = '') {
  return ANNOTATION_SURFACES.includes(surface) ? surface : 'original';
}

function annotationSurfaceRoot(surface = state.readerTab) {
  const clean = normalizeAnnotationSurface(surface);
  if (clean === 'rewrite') return $('#rewrite-content');
  if (clean === 'translation') return $('#translation-list');
  return $('#reader-content');
}

function annotationSurfaceFromNode(node) {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!el) return '';
  if ($('#reader-content')?.contains(el)) return 'original';
  if ($('#rewrite-content')?.contains(el)) return 'rewrite';
  if ($('#translation-list')?.contains(el)) return 'translation';
  return '';
}

function normalizeAnnotationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function annotationHashText(value) {
  const text = normalizeAnnotationText(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return text ? `fnv1a:${(hash >>> 0).toString(16)}` : '';
}

function currentAnnotationVersion(surface = state.readerTab) {
  const clean = normalizeAnnotationSurface(surface);
  if (clean === 'translation') {
    return {
      surface: clean,
      assetId: String(state.translation?.id || '').trim(),
      contentHash: String(state.translation?.contentHash || '').trim() || annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
    };
  }
  if (clean === 'rewrite') {
    return {
      surface: clean,
      assetId: String(state.rewrite?.id || '').trim(),
      contentHash: String(state.rewrite?.contentHash || '').trim() || annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
    };
  }
  return {
    surface: clean,
    assetId: '',
    contentHash: annotationHashText(annotationSurfaceRoot(clean)?.textContent || ''),
  };
}

function annotationVersionState(annotation) {
  if (!annotation) return 'current';
  const current = currentAnnotationVersion(annotation.surface);
  const annotationAssetId = String(annotation.assetId || '').trim();
  const annotationHash = String(annotation.contentHash || '').trim();
  if (!annotationAssetId && !annotationHash) return 'legacy';
  if (annotationAssetId && current.assetId && annotationAssetId !== current.assetId) return 'stale';
  if (annotationHash && current.contentHash && annotationHash !== current.contentHash) return 'stale';
  return 'current';
}

function annotationVersionBadge(annotation) {
  const version = annotationVersionState(annotation);
  if (version === 'current') return '';
  const label = version === 'legacy' ? '早期划线' : '旧版本';
  return `<span class="annotation-version-badge ${version === 'legacy' ? 'legacy' : ''}">${label}</span>`;
}

function normalizedRangeInText(text, quote) {
  const target = normalizeAnnotationText(quote);
  if (!target) return null;
  const raw = String(text || '');
  const directIndex = raw.indexOf(target);
  if (directIndex >= 0) return { start: directIndex, end: directIndex + target.length };
  let normalized = '';
  const map = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inSpace && normalized) {
        normalized += ' ';
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    normalized += ch;
    map.push(i);
  }
  normalized = normalized.trim();
  const index = normalized.indexOf(target);
  if (index < 0) return null;
  const start = map[index] ?? 0;
  const last = map[index + target.length - 1] ?? start;
  return { start, end: last + 1 };
}

function clearAnnotationMarks(root) {
  if (!root) return;
  $$('.text-annotation-mark', root).forEach(mark => {
    const text = document.createTextNode(mark.textContent || '');
    mark.replaceWith(text);
    text.parentNode?.normalize();
  });
  $$('.annotation-discussed-block,.annotation-free-block', root).forEach(el => {
    el.classList.remove('annotation-discussed-block', 'annotation-free-block');
  });
  root.classList.remove('annotation-discussion-muted');
}

function annotationTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.text-annotation-mark,script,style,textarea,button,select')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function markAnnotationAnchor(annotation, root) {
  const quote = normalizeAnnotationText(annotation.quote);
  if (!root || !quote) return false;
  const nodes = annotationTextNodes(root);
  let normalized = '';
  let inSpace = false;
  const map = [];
  nodes.forEach((node, nodeIndex) => {
    const raw = node.nodeValue || '';
    for (let offset = 0; offset < raw.length; offset += 1) {
      const ch = raw[offset];
      if (/\s/.test(ch)) {
        if (!inSpace && normalized) {
          normalized += ' ';
          map.push({ nodeIndex, offset });
        }
        inSpace = true;
        continue;
      }
      inSpace = false;
      normalized += ch;
      map.push({ nodeIndex, offset });
    }
  });
  normalized = normalized.trim();
  const startIndex = normalized.indexOf(quote);
  if (startIndex < 0) return false;
  const startMap = map[startIndex];
  const endMap = map[startIndex + quote.length - 1];
  if (!startMap || !endMap) return false;
  const ranges = [];
  for (let nodeIndex = startMap.nodeIndex; nodeIndex <= endMap.nodeIndex; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (!node) continue;
    const start = nodeIndex === startMap.nodeIndex ? startMap.offset : 0;
    const end = nodeIndex === endMap.nodeIndex ? endMap.offset + 1 : (node.nodeValue || '').length;
    if (end > start && node.nodeValue.slice(start, end).trim()) ranges.push({ node, start, end });
  }
  if (!ranges.length) return false;
  for (const { node, start, end } of ranges.reverse()) {
    const before = document.createTextNode(node.nodeValue.slice(0, start));
    const selected = document.createElement('mark');
    selected.className = 'text-annotation-mark';
    selected.dataset.annotationId = annotation.id;
    selected.textContent = node.nodeValue.slice(start, end);
    selected.title = annotation.body ? normalizeAnnotationText(annotation.body).slice(0, 120) : '划线点评';
    const after = document.createTextNode(node.nodeValue.slice(end));
    node.replaceWith(before, selected, after);
    const block = selected.closest('p,li,blockquote,h1,h2,h3,h4,.translation-target,.rewrite-content > div,.reader-content > div') || selected.parentElement;
    block?.classList.add('annotation-discussed-block');
  }
  return true;
}

function applyAnnotationDiscussionFilter() {
  for (const surface of ANNOTATION_SURFACES) {
    const root = annotationSurfaceRoot(surface);
    if (!root) continue;
    const surfaceAnnotations = (state.annotations || []).filter(item => item.surface === surface);
    const blocks = $$('p,li,blockquote,h1,h2,h3,h4,.translation-target', root)
      .filter(block => !block.closest('.annotation-popover'));
    blocks.forEach(block => {
      if (block.querySelector('.text-annotation-mark')) block.classList.add('annotation-discussed-block');
      else block.classList.add('annotation-free-block');
    });
    root.classList.toggle('annotation-discussion-muted', Boolean(state.annotationOnlyDiscussed && surfaceAnnotations.length));
  }
}

function applyTextAnnotations() {
  for (const surface of ANNOTATION_SURFACES) {
    const root = annotationSurfaceRoot(surface);
    if (!root) continue;
    clearAnnotationMarks(root);
    const surfaceAnnotations = (state.annotations || []).filter(item => item.surface === surface);
    for (const annotation of surfaceAnnotations) {
      annotation.versionState = annotationVersionState(annotation);
      if (annotation.versionState === 'stale') {
        annotation.anchorMissing = true;
        continue;
      }
      annotation.anchorMissing = !markAnnotationAnchor(annotation, root);
    }
  }
  applyAnnotationDiscussionFilter();
  requestAnimationFrame(placeAnnotationMarginCards);
}

function selectionAnnotationContext() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !state.activeEntry) return null;
  if (Date.now() < Number(state.suppressAnnotationUntil || 0)) return null;
  const selectedText = String(selection.toString() || '').trim();
  const quote = normalizeAnnotationText(selectedText).slice(0, 800);
  if (quote.length < 2) return null;
  const range = selection.getRangeAt(0);
  const commonEl = elementFromNode(range.commonAncestorContainer);
  const startEl = elementFromNode(range.startContainer);
  const endEl = elementFromNode(range.endContainer);
  if (commonEl?.closest('a') || startEl?.closest('a') || endEl?.closest('a')) return null;
  const surface = annotationSurfaceFromNode(range.commonAncestorContainer);
  if (!surface) return null;
  const root = annotationSurfaceRoot(surface);
  if (!root || !root.contains(range.commonAncestorContainer)) return null;
  const rootText = normalizeAnnotationText(root.textContent || '');
  const idx = rootText.indexOf(quote);
  const prefix = idx >= 0 ? rootText.slice(Math.max(0, idx - 120), idx) : '';
  const suffix = idx >= 0 ? rootText.slice(idx + quote.length, idx + quote.length + 120) : '';
  const version = currentAnnotationVersion(surface);
  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return { surface, quote, selectedText, prefix, suffix, assetId: version.assetId, contentHash: version.contentHash, rect };
}

function hideAnnotationPopover() {
  state.annotationDraft = null;
  $('#annotation-popover')?.classList.add('hidden');
}

function showAnnotationPopover(context) {
  const popover = $('#annotation-popover');
  if (!popover || !context) return;
  state.annotationDraft = {
    surface: context.surface,
    quote: context.quote,
    selectedText: context.selectedText || context.quote,
    prefix: context.prefix,
    suffix: context.suffix,
    assetId: context.assetId || '',
    contentHash: context.contentHash || '',
  };
  $('#annotation-popover-quote').textContent = `${ANNOTATION_SURFACE_LABELS[context.surface]}：${context.quote}`;
  const input = $('#annotation-popover-input');
  input.value = '';
  const width = Math.min(360, window.innerWidth - 28);
  const left = Math.min(Math.max(14, context.rect.left), window.innerWidth - width - 14);
  const top = Math.min(Math.max(14, context.rect.bottom + 10), window.innerHeight - 220);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.remove('hidden');
  setTimeout(() => input.focus(), 0);
}

async function copyAnnotationSelection() {
  const draft = state.annotationDraft;
  const currentSelection = window.getSelection && !window.getSelection()?.isCollapsed
    ? String(window.getSelection().toString() || '').trim()
    : '';
  const text = currentSelection || String(draft?.selectedText || draft?.quote || '').trim();
  if (!text) return toast('没有可复制的选中文本');
  const copied = await copyText(text, '选中文本已复制');
  if (copied) {
    hideAnnotationPopover();
    window.getSelection()?.removeAllRanges();
  }
}

function maybeOpenAnnotationPopover() {
  // Zen 自用：划线弹层隐藏，改用正文右键「高亮 / 删除」
  if (typeof isZenPersonalMode === 'function' && isZenPersonalMode()) return;
  if ($('#annotation-popover')?.contains(document.activeElement)) return;
  const context = selectionAnnotationContext();
  if (context) showAnnotationPopover(context);
}

function annotationAssetPatch(annotations = state.annotations) {
  const list = Array.isArray(annotations) ? annotations : [];
  const assets = mergeAssets(state.activeEntry);
  const latest = [...list].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
  const topHelpful = [...list]
    .filter(item => Number(item.helpfulCount || 0) > 0)
    .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)))[0] || null;
  const items = list.slice(0, 3).map(item => ({
    type: 'annotations',
    id: item.id,
    role: item.surface,
    author: item.author,
    title: ANNOTATION_SURFACE_LABELS[item.surface] || '',
    text: `${item.quote || ''} ${item.body || ''}`,
    at: Number(item.updatedAt || item.createdAt || 0),
    helpfulCount: Number(item.helpfulCount) || 0,
  }));
  const preview = latest ? items.find(item => item.id === latest.id) || {
    type: 'annotations',
    id: latest.id,
    role: latest.surface,
    author: latest.author,
    title: ANNOTATION_SURFACE_LABELS[latest.surface] || '',
    text: `${latest.quote || ''} ${latest.body || ''}`,
    at: Number(latest.updatedAt || latest.createdAt || 0),
    helpfulCount: Number(latest.helpfulCount) || 0,
  } : null;
  return {
    annotations: list.length,
    annotationHelpfulCount: list.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0),
    helpfulAnnotations: list.filter(item => Number(item.helpfulCount || 0) > 0).length,
    topHelpfulAnnotation: topHelpful ? {
      type: 'annotations',
      id: topHelpful.id,
      role: topHelpful.surface,
      author: topHelpful.author,
      title: ANNOTATION_SURFACE_LABELS[topHelpful.surface] || '',
      text: `${topHelpful.quote || ''} ${topHelpful.body || ''}`,
      at: Number(topHelpful.updatedAt || topHelpful.createdAt || 0),
      helpfulCount: Number(topHelpful.helpfulCount) || 0,
    } : null,
    helpfulCount: (Number(assets.translationHelpfulCount) || 0)
      + (Number(assets.rewriteHelpfulCount) || 0)
      + (Number(assets.commentHelpfulCount) || 0)
      + (Number(assets.chatHelpfulCount) || 0)
      + list.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0),
    previews: { ...(assets.previews || {}), ...(preview ? { annotations: preview } : {}) },
    items: { ...(assets.items || {}), annotations: items },
  };
}

function visibleAnnotationsForReader() {
  const annotations = state.annotations || [];
  const filter = ANNOTATION_SURFACES.includes(state.annotationFilter) ? state.annotationFilter : 'all';
  return annotations
    .map(item => ({ ...item, versionState: annotationVersionState(item) }))
    .filter(item => filter === 'all' || item.surface === filter)
    .sort((a, b) => {
      const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
      if (helpfulDelta) return helpfulDelta;
      return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    });
}

function renderAnnotationItem(item, { side = false, margin = false } = {}) {
  const helpfulActive = Boolean(item.helpfulByMe);
  const helpfulCount = Number(item.helpfulCount || 0);
  const authorHtml = item.contributorId
    ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(item.contributorId)}">${escapeHtml(item.contributorName || item.author)}</button>`
    : escapeHtml(item.author);
  const replies = (item.replies || []).map(reply => {
    const replyAuthor = reply.contributorId
      ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(reply.contributorId)}">${escapeHtml(reply.contributorName || reply.author)}</button>`
      : escapeHtml(reply.author);
    return `
      <div class="annotation-reply">
        <div class="annotation-reply-meta">${replyAuthor} · ${formatAssetTime(reply.createdAt)}</div>
        <div class="annotation-reply-body">${renderMarkdownLite(reply.body)}</div>
      </div>`;
  }).join('');
  const versionBadge = annotationVersionBadge(item);
  const staleMessage = item.versionState === 'stale'
    ? '这条划线属于旧版本内容，已保留为历史讨论。'
    : item.anchorMissing
      ? '这段文字暂时没有在当前内容中定位到，可能原文已更新。'
      : '';
  const idPrefix = margin ? 'margin-annotation' : side ? 'side-annotation' : 'annotation';
  const focusLabel = margin ? '回到划线' : side ? '定位' : '定位原文';
  const replyCount = Array.isArray(item.replies) ? item.replies.length : 0;
  const activeClass = state.activeAnnotationId === item.id ? ' annotation-active' : '';
  const className = `annotation-item${margin ? ' annotation-margin-card' : ''}${activeClass}`;
  if (margin) {
    const bodySnippet = plainSnippet(item.body, 110);
    const quoteSnippet = plainSnippet(item.quote, 92);
    const metaText = [formatAssetTime(item.createdAt), replyCount ? `${replyCount} 回复` : ''].filter(Boolean).join(' · ');
    return `
      <article id="${idPrefix}-${escapeHtml(item.id)}" class="${className}" data-annotation-item="${escapeHtml(item.id)}" data-annotation-surface="${escapeHtml(item.surface)}">
        <div class="annotation-margin-top">
          <span class="annotation-surface-badge">${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')}</span>
          <span class="annotation-margin-author">${authorHtml}</span>
          ${metaText ? `<span class="annotation-margin-time">${escapeHtml(metaText)}</span>` : ''}
        </div>
        <p class="annotation-margin-body">${escapeHtml(bodySnippet || '这条划线还没有补充说明。')}</p>
        <div class="annotation-margin-quote">${escapeHtml(quoteSnippet)}</div>
        ${staleMessage ? `<div class="annotation-anchor-missing">${escapeHtml(staleMessage)}</div>` : ''}
        <div class="annotation-margin-actions">
          <button type="button" class="annotation-action${helpfulActive ? ' active' : ''}" data-annotation-helpful="${escapeHtml(item.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
          <button type="button" class="annotation-action" data-annotation-focus="${escapeHtml(item.id)}">${focusLabel}</button>
          <button type="button" class="annotation-action" data-annotation-send-ai="${escapeHtml(item.id)}">问AI</button>
          <button type="button" class="annotation-action" data-annotation-link="${escapeHtml(item.id)}">链接</button>
        </div>
      </article>`;
  }
  return `
      <article id="${idPrefix}-${escapeHtml(item.id)}" class="${className}" data-annotation-item="${escapeHtml(item.id)}" data-annotation-surface="${escapeHtml(item.surface)}">
        <div class="annotation-meta">
          <span class="annotation-surface-badge">${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')}</span>
          ${versionBadge}
          <span>${authorHtml} · ${formatAssetTime(item.createdAt)}</span>
          ${Number(item.updatedAt || 0) > Number(item.createdAt || 0) ? `<span>更新 ${formatAssetTime(item.updatedAt)}</span>` : ''}
        </div>
        <div class="annotation-quote">${escapeHtml(item.quote)}</div>
        ${staleMessage ? `<div class="annotation-anchor-missing">${escapeHtml(staleMessage)}</div>` : ''}
        <div class="annotation-body">${renderMarkdownLite(item.body)}</div>
        ${margin && replyCount ? `<div class="annotation-margin-reply-count">${replyCount} 条回复</div>` : ''}
        <div class="annotation-actions">
          <button type="button" class="annotation-action${helpfulActive ? ' active' : ''}" data-annotation-helpful="${escapeHtml(item.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
          <button type="button" class="annotation-action" data-annotation-focus="${escapeHtml(item.id)}">${focusLabel}</button>
          <button type="button" class="annotation-action" data-annotation-send-ai="${escapeHtml(item.id)}">问AI</button>
          <button type="button" class="annotation-action" data-annotation-link="${escapeHtml(item.id)}">复制链接</button>
          <button type="button" class="annotation-action" data-annotation-copy="${escapeHtml(item.id)}">复制内容</button>
          ${item.canDelete ? `<button type="button" class="annotation-action annotation-action-danger" data-annotation-delete="${escapeHtml(item.id)}">撤回</button>` : ''}
        </div>
        ${replies ? `<div class="annotation-replies">${replies}</div>` : ''}
        <form class="annotation-reply-form" data-annotation-reply-form="${escapeHtml(item.id)}">
          <textarea rows="1" placeholder="回复这条划线点评…"></textarea>
          <button class="ghost-btn" type="submit">回复</button>
        </form>
      </article>`;
}

function renderAnnotationActionList(container, visible, { side = false } = {}) {
  if (!container) return;
  if (!visible.length) {
    container.innerHTML = '<div class="comments-empty">选中文章中的文字，就可以发布划线点评。</div>';
    return;
  }
  container.innerHTML = visible.map(item => renderAnnotationItem(item, { side })).join('');
}

function annotationMarginContainer(surface) {
  return $(`#annotation-margin-${normalizeAnnotationSurface(surface)}`);
}

function renderAnnotationSideMeta(visible = visibleAnnotationsForReader()) {
  const count = visible.length;
  const countEl = $('#context-annotation-count');
  if (countEl) countEl.textContent = formatCompactCount(count) || '0';
  const openCountEl = $('#context-open-annotation-count');
  if (openCountEl) openCountEl.textContent = formatCompactCount(count) || '0';
  const title = $('#annotation-side-title');
  if (title) {
    title.textContent = state.activeEntry
      ? (state.activeEntry.titleZh || state.activeEntry.title || '无标题')
      : '未选择文章';
  }
  const focus = $('#annotation-side-focus');
  if (focus) focus.disabled = !state.activeEntry;
}

function renderAnnotationMargins(visible = visibleAnnotationsForReader()) {
  for (const surface of ANNOTATION_SURFACES) {
    const container = annotationMarginContainer(surface);
    if (!container) continue;
    const items = visible.filter(item => normalizeAnnotationSurface(item.surface) === surface);
    container.classList.toggle('hidden', !items.length);
    container.innerHTML = items.map(item => renderAnnotationItem(item, { margin: true })).join('');
  }
  requestAnimationFrame(placeAnnotationMarginCards);
}

function annotationElementTopWithinPanel(element, panel) {
  if (!element || !panel) return 0;
  const elementRect = element.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return Math.max(0, elementRect.top - panelRect.top);
}

function placeAnnotationMarginCards() {
  for (const surface of ANNOTATION_SURFACES) {
    const panel = document.querySelector(`[data-annotation-surface="${surface}"]`);
    const container = annotationMarginContainer(surface);
    if (!panel || !container || panel.classList.contains('hidden') || container.classList.contains('hidden')) continue;
    let cursor = 0;
    const cards = [...container.querySelectorAll('.annotation-margin-card')];
    for (const card of cards) {
      const id = card.dataset.annotationItem || '';
      const mark = id
        ? panel.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(id)}"]`)
        : null;
      const desired = mark ? annotationElementTopWithinPanel(mark, panel) - 6 : cursor;
      const gap = Math.max(0, desired - cursor);
      card.style.marginTop = `${Math.round(gap)}px`;
      cursor += gap + card.offsetHeight + 10;
    }
  }
}

function renderAnnotations() {
  const list = $('#annotations-list');
  if (!list) return;
  const annotations = state.annotations || [];
  $('#annotations-count').textContent = annotations.length ? `${annotations.length} 条` : '暂无';
  const rail = $('#reader-rail-annotation-count');
  if (rail) rail.textContent = formatCompactCount(annotations.length) || '0';
  const filter = ANNOTATION_SURFACES.includes(state.annotationFilter) ? state.annotationFilter : 'all';
  const select = $('#annotation-surface-filter');
  if (select) select.value = filter;
  const toggle = $('#annotation-discussed-toggle');
  if (toggle) {
    toggle.classList.toggle('active', Boolean(state.annotationOnlyDiscussed));
    toggle.setAttribute('aria-pressed', state.annotationOnlyDiscussed ? 'true' : 'false');
  }
  applyTextAnnotations();
  const visible = visibleAnnotationsForReader();
  $('#annotation-nav').innerHTML = visible.map(item => `
    <button type="button" class="annotation-nav-btn" data-annotation-jump="${escapeHtml(item.id)}">
      ${escapeHtml(ANNOTATION_SURFACE_LABELS[item.surface] || '原文')} · ${escapeHtml(plainSnippet(item.quote, 42))}
    </button>
  `).join('');
  renderAnnotationActionList(list, visible);
  renderAnnotationActionList($('#side-annotations-list'), visible, { side: true });
  renderAnnotationSideMeta(visible);
  renderAnnotationMargins(visible);
  renderReaderAssetSummary();
  applyAnnotationDiscussionFilter();
  highlightAnnotationFromRoute();
  settlePendingAssetJump('annotations');
}

function highlightAnnotationFromRoute() {
  const annotationId = state.pendingAnnotationId;
  if (!annotationId) return;
  state.pendingAnnotationId = '';
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (item) {
    state.activeAnnotationId = annotationId;
    setContextPanel('annotations', { expand: true });
  }
  if (item && state.readerTab !== item.surface) {
    setReaderTab(item.surface, { syncUrl: false });
    applyTextAnnotations();
  }
  const target = document.getElementById(`annotation-${annotationId}`);
  const marginTarget = document.getElementById(`margin-annotation-${annotationId}`);
  const mark = document.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(annotationId)}"]`);
  if (!target && !marginTarget && !mark) return;
  const destination = mark || target;
  destination?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.classList.add('annotation-target');
  marginTarget?.classList.add('annotation-target');
  mark?.classList.add('active');
  setTimeout(() => {
    target?.classList.remove('annotation-target');
    marginTarget?.classList.remove('annotation-target');
    mark?.classList.remove('active');
  }, 2600);
}

function revealSideAnnotation(annotationId) {
  if (!annotationId) return;
  requestAnimationFrame(() => {
    const target = document.getElementById(`side-annotation-${annotationId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('annotation-target');
    setTimeout(() => target.classList.remove('annotation-target'), 2200);
  });
}

function jumpToAnnotation(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return;
  state.activeAnnotationId = annotationId;
  state.readerFocus = 'annotations';
  state.readerAssetId = annotationId;
  if (state.contextPanel !== 'annotations' || state.agentCollapsed) {
    setContextPanel('annotations', { expand: true });
  } else {
    renderAnnotations();
  }
  revealSideAnnotation(annotationId);
  const tab = normalizeAnnotationSurface(item.surface);
  setReaderTab(tab, { syncUrl: true, replaceUrl: true });
  applyTextAnnotations();
  requestAnimationFrame(() => {
    const mark = document.querySelector(`.text-annotation-mark[data-annotation-id="${CSS.escape(annotationId)}"]`);
    const marginTarget = document.getElementById(`margin-annotation-${annotationId}`);
    marginTarget?.classList.add('annotation-target');
    setTimeout(() => marginTarget?.classList.remove('annotation-target'), 2200);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('active');
      setTimeout(() => mark.classList.remove('active'), 2200);
      return;
    }
    if (marginTarget && !isCompactViewport()) {
      marginTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    scrollReaderTarget(`#annotation-${annotationId}`);
  });
}

function copyAnnotation(annotationId) {
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!item) return toast('找不到这条划线点评');
  copyText(`「${item.quote}」\n\n${item.body}`, '划线点评已复制');
}

function copyAnnotationLink(annotationId) {
  const url = annotationUrl(annotationId);
  if (!url) return toast('找不到这条划线点评链接');
  copyText(url, '划线点评链接已复制');
}

async function loadAnnotations(entry) {
  state.annotations = [];
  renderAnnotations();
  try {
    const data = await api(`/api/entry/${entry.id}/annotations`);
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations), { rerenderList: false });
    renderAnnotations();
    renderList();
  } catch {
    renderAnnotations();
  }
}

async function submitAnnotationDraft() {
  const entry = state.activeEntry;
  const draft = state.annotationDraft;
  const body = $('#annotation-popover-input').value.trim();
  if (!entry || !draft) return;
  const btn = $('#annotation-popover-submit');
  btn.disabled = true;
  state.annotationBusy = true;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: draft.surface,
        quote: draft.quote,
        prefix: draft.prefix,
        suffix: draft.suffix,
        assetId: draft.assetId,
        contentHash: draft.contentHash,
        body,
      }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    hideAnnotationPopover();
    window.getSelection()?.removeAllRanges();
    renderAnnotations();
    if (data.annotation?.id) jumpToAnnotation(data.annotation.id);
    toast(body ? '划线点评已发布' : '已划线');
  } catch (err) {
    toast('划线点评失败: ' + err.message, 5000);
  } finally {
    state.annotationBusy = false;
    btn.disabled = false;
  }
}

async function submitAnnotationReply(annotationId, form) {
  const entry = state.activeEntry;
  const input = form && $('textarea', form);
  const body = input ? input.value.trim() : '';
  if (!entry || !annotationId || !body) return;
  const btn = $('button', form);
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    toast('回复已发布');
  } catch (err) {
    toast('回复失败: ' + err.message, 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleAnnotationHelpful(annotationId) {
  const entry = state.activeEntry;
  const item = (state.annotations || []).find(annotation => annotation.id === annotationId);
  if (!entry || !item) return;
  const nextHelpful = !item.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteAnnotation(annotationId) {
  const entry = state.activeEntry;
  if (!entry || !annotationId) return;
  const ok = await showConfirmDialog({
    title: '撤回划线点评',
    message: '撤回后，公开资产页和 RSS 中也会移除这条划线点评。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/annotations/${encodeURIComponent(annotationId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.annotations = data.annotations || [];
    updateEntryAssets(entry.id, annotationAssetPatch(state.annotations));
    renderAnnotations();
    renderList();
    toast('划线点评已撤回');
  } catch (err) {
    toast('撤回划线点评失败: ' + err.message, 5000);
  }
}

/** GitHub 项目：从 content 注释或 summary 取 ⭐ + 最近推送，显示在标题旁 meta */
function formatGithubRepoReaderMeta(entry) {
  if (!entry) return '';
  let stars = '';
  let pushedAt = '';
  const raw = String(entry.content || contentCache.get(entry.id) || '');
  const m = raw.match(/<!--repo-meta:([\s\S]*?)-->/);
  if (m) {
    try {
      const json = m[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
      const meta = JSON.parse(json);
      if (meta && meta.stars != null && meta.stars !== '') {
        const n = Number(meta.stars);
        stars = Number.isFinite(n)
          ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
          : String(meta.stars);
      }
      if (meta && meta.pushedAt) pushedAt = meta.pushedAt;
    } catch {
      /* ignore */
    }
  }
  if (!stars) {
    const sm = String(entry.summary || '').match(/⭐\s*([0-9.]+[kKmM]?)/);
    if (sm) stars = sm[1];
  }
  if (!pushedAt) {
    const ts = entryDisplayTimeTs(entry);
    if (ts) pushedAt = new Date(ts).toISOString();
  }
  const parts = [];
  if (stars) parts.push(`⭐ ${stars}`);
  if (pushedAt) {
    const when = friendlyDateTime(Date.parse(pushedAt) || entryDisplayTimeTs(entry));
    if (when) parts.push(`最近推送 ${when}`);
  }
  return parts.join(' · ') || friendlyDateTime(entryDisplayTimeTs(entry)) || '';
}

function renderComments() {
  const list = $('#comments-list');
  const comments = state.comments || [];
  const sortedComments = sortComments(comments);
  const canWrite = true; // 个人本机：直接可写
  $('#comments-count').textContent = comments.length ? `${comments.length} 条` : '暂无';
  const railCommentCount = $('#reader-rail-comment-count');
  if (railCommentCount) railCommentCount.textContent = formatCompactCount(comments.length) || '0';
  $$('.comment-sort-btn').forEach(btn => {
    const active = btn.dataset.commentSort === state.commentSort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('#comment-form')?.classList.toggle('hidden', !canWrite);
  $('#comment-gate')?.classList.toggle('hidden', canWrite);
  if (!comments.length) {
    list.innerHTML = '<div class="comments-empty">还没有人工点评</div>';
    return;
  }
  list.innerHTML = sortedComments.map(comment => {
    const display = commentDisplayParts(comment.body);
    const isEditing = state.editingCommentId === comment.id;
    const editedAt = Number(comment.updatedAt || 0) > Number(comment.createdAt || 0)
      ? ` · 已编辑 ${formatAssetTime(comment.updatedAt)}`
      : '';
    const helpfulCount = Number(comment.helpfulCount || 0);
    const helpfulActive = Boolean(comment.helpfulByMe);
    const authorHtml = comment.contributorId
      ? `<button type="button" class="contributor-inline" data-contributor-id="${escapeHtml(comment.contributorId)}">${escapeHtml(comment.contributorName || comment.author)}</button>`
      : escapeHtml(comment.author);
    return `
      <div id="comment-${escapeHtml(comment.id)}" class="comment-item${display.type ? ` comment-type-${display.type}` : ''}">
        <div class="comment-head">
          <div class="comment-head-left">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <div class="comment-meta">${authorHtml} · ${formatAssetTime(comment.createdAt)}${escapeHtml(editedAt)}</div>
          </div>
          <div class="comment-actions">
            <button type="button" class="comment-action comment-link-copy" data-comment-link="${escapeHtml(comment.id)}" title="复制这条点评链接" aria-label="复制这条点评链接">${lucideIcon('hash')}</button>
            <button type="button" class="comment-action comment-send-ai" data-comment-send-ai="${escapeHtml(comment.id)}" title="发给 AI 伴读" aria-label="发给 AI 伴读">${lucideIcon('bot')}</button>
            <button type="button" class="comment-action comment-copy" data-comment-copy="${escapeHtml(comment.id)}" title="复制这条点评" aria-label="复制这条点评">${lucideIcon('copy')}</button>
            ${comment.canEdit && !isEditing ? `<button type="button" class="comment-action comment-edit" data-comment-edit="${escapeHtml(comment.id)}" title="编辑这条点评" aria-label="编辑这条点评">${lucideIcon('pencil')}</button>` : ''}
            ${comment.canDelete && !isEditing ? `<button type="button" class="comment-action comment-action-danger" data-comment-delete="${escapeHtml(comment.id)}" title="撤回这条点评" aria-label="撤回这条点评">${lucideIcon('trash-2')}</button>` : ''}
          </div>
        </div>
        ${isEditing ? `
          <div class="comment-edit-box">
            <textarea class="comment-edit-input" data-comment-edit-input="${escapeHtml(comment.id)}" rows="4">${escapeHtml(comment.body)}</textarea>
            <div class="comment-edit-actions">
              <button type="button" class="comment-edit-save" data-comment-save="${escapeHtml(comment.id)}">保存</button>
              <button type="button" class="comment-edit-cancel" data-comment-cancel="${escapeHtml(comment.id)}">取消</button>
            </div>
          </div>
        ` : `<div class="comment-body">${renderMarkdownLite(display.body)}</div>`}
        <div class="comment-feedback">
          <button type="button" class="comment-helpful${helpfulActive ? ' active' : ''}" data-comment-helpful="${escapeHtml(comment.id)}" aria-pressed="${helpfulActive ? 'true' : 'false'}" title="${helpfulActive ? '取消有用标记' : '标记这条点评有用'}">有用${helpfulCount ? ` ${helpfulCount}` : ''}</button>
        </div>
      </div>`;
  }).join('');
  renderReaderAssetSummary();
  highlightCommentFromRoute();
  settlePendingAssetJump('comments');
}

function sortComments(comments) {
  const list = [...(comments || [])];
  if (state.commentSort === 'latest') {
    return list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }
  return list.sort((a, b) => {
    const helpfulDelta = Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0);
    if (helpfulDelta) return helpfulDelta;
    const activityDelta = Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
    if (activityDelta) return activityDelta;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function setCommentSort(sort) {
  if (!COMMENT_SORTS.includes(sort) || state.commentSort === sort) return;
  state.commentSort = sort;
  storage.setItem('qm_comment_sort', sort);
  renderComments();
}

function commentDisplayParts(body) {
  const raw = String(body || '');
  const trimmed = raw.trimStart();
  for (const [type, prefix] of Object.entries(COMMENT_TEMPLATES)) {
    if (trimmed.startsWith(prefix)) {
      return {
        type,
        label: COMMENT_TEMPLATE_LABELS[type] || prefix.replace(/：$/, ''),
        body: trimmed.slice(prefix.length).trimStart() || trimmed,
      };
    }
  }
  return { type: '', label: '', body: raw };
}

function plainSnippet(value, max = 220) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function copyComment(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment) {
    toast('找不到这条点评');
    return;
  }
  copyText(comment.body, '点评已复制');
}

function copyCommentLink(commentId) {
  const url = commentUrl(commentId);
  if (!url) {
    toast('找不到这条点评链接');
    return;
  }
  copyText(url, '点评链接已复制');
}

function myAssetUrl(type, item) {
  if (!item) return '';
  const entry = item.entry || { id: item.entryId };
  if (type === 'likes') return readerUrlFor(entry);
  if (type === 'translation' || type === 'rewrite') return readerAssetUrl(type, entry, item.id);
  if (type === 'annotations') return annotationUrl(item.id, entry);
  if (type === 'chat') return chatMessageUrl(item.id, entry);
  return commentUrl(item.id, entry);
}

function myPublicProfileUrl() {
  if (!state.me || !state.me.id) return '';
  return contributorUrlFor(state.me.id, {
    sort: state.myAssetSort,
    tab: state.myAssetTab,
  }).href;
}

function myPublicRssUrl() {
  if (!state.me || !state.me.id) return '';
  return contributorFeedUrlFor(state.me.id).href;
}

function normalizeUserAssetTab(type) {
  return PROFILE_TAB_TYPES.includes(type) ? type : 'translation';
}

function userAssetLabel(type) {
  if (type === 'likes') return '点赞文章';
  return ASSET_DIRECTORY_LABELS[type] || ASSET_TYPE_LABELS[type] || '资产';
}

function myAssetCounts() {
  return {
    translation: (state.myTranslations || []).length,
    rewrite: (state.myRewrites || []).length,
    annotations: (state.myAnnotations || []).length,
    comments: (state.myComments || []).length,
    chat: (state.myChatMessages || []).length,
  };
}

function renderMyAssetTabs() {
  const counts = myAssetCounts();
  $('#my-translation-count').textContent = counts.translation;
  $('#my-rewrite-count').textContent = counts.rewrite;
  $('#my-annotations-count').textContent = counts.annotations;
  $('#my-comments-count').textContent = counts.comments;
  $('#my-chat-count').textContent = counts.chat;
  $$('#my-dashboard-page [data-my-asset-tab]').forEach(btn => {
    const active = btn.dataset.myAssetTab === state.myAssetTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('#my-dashboard-page [data-my-asset-sort]').forEach(btn => {
    const active = normalizeUserAssetSort(btn.dataset.myAssetSort) === state.myAssetSort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderMyPublicProfileActions();
}

function renderMyPublicProfileActions() {
  const url = myPublicProfileUrl();
  const rssUrl = myPublicRssUrl();
  const link = $('#my-public-profile-link');
  const rss = $('#my-public-rss-link');
  if (link) {
    link.classList.toggle('hidden', !url);
    link.href = url || '#';
  }
  if (rss) {
    rss.classList.toggle('hidden', !rssUrl);
    rss.href = rssUrl || '#';
  }
}

function mountAiConfigPanel(target = 'modal') {
  const content = $('.ai-config-content');
  const mount = target === 'dashboard' ? $('#dashboard-ai-mount') : $('#ai-config-modal-mount');
  if (!content || !mount || content.parentElement === mount) return;
  mount.appendChild(content);
}

function renderDashboardTabs() {
  const tab = normalizeDashboardTab(state.dashboardTab);
  $$('#my-dashboard-page [data-dashboard-tab]').forEach(btn => {
    const active = btn.dataset.dashboardTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#dashboard-profile-panel')?.classList.toggle('hidden', tab !== 'profile');
  $('#dashboard-ai-panel')?.classList.toggle('hidden', tab !== 'ai');
  $('#dashboard-contributions-panel')?.classList.toggle('hidden', tab !== 'contributions');
  if (tab === 'ai') {
    mountAiConfigPanel('dashboard');
    renderAiSettings();
  }
  renderMyPublicProfileActions();
}

function setDashboardTab(tab = 'profile', { push = false, persist = true } = {}) {
  state.dashboardTab = normalizeDashboardTab(tab);
  if (persist) storage.setItem('qm_dashboard_tab', state.dashboardTab);
  renderDashboardTabs();
  if (push && state.workspacePage === 'dashboard') {
    history.pushState({ dashboard: true, tab: state.dashboardTab }, '', dashboardUrlFor(state.dashboardTab));
  }
}

function renderProfileAvatarPreview(user = state.me) {
  const target = $('#profile-avatar-preview');
  if (!target) return;
  const src = state.profileAvatarDraft || (user && user.avatarUrl) || '';
  target.innerHTML = src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(avatarInitial(user))}" />`
    : escapeHtml(avatarInitial(user));
}

function renderProfileLinksEditor() {
  const wrap = $('#profile-links-editor');
  if (!wrap) return;
  const links = (Array.isArray(state.profileLinksDraft) ? state.profileLinksDraft : []).slice(0, 12);
  if (!links.length) {
    wrap.innerHTML = '<div class="notification-empty">还没有添加公开链接</div>';
    return;
  }
  wrap.innerHTML = links.map((link, index) => `
    <div class="profile-link-row" data-profile-link-row="${index}">
      <input data-profile-link-title="${index}" type="text" maxlength="48" placeholder="标题" value="${escapeHtml(link.title)}" />
      <input data-profile-link-url="${index}" type="url" placeholder="https://example.com" value="${escapeHtml(link.url)}" />
      <button class="icon-btn profile-link-remove" type="button" data-profile-link-remove="${index}" title="移除链接" aria-label="移除链接">${lucideIcon('x')}</button>
    </div>
  `).join('');
}

function collectProfileLinks({ strict = false } = {}) {
  const rows = $$('#profile-links-editor [data-profile-link-row]');
  const links = rows.map(row => {
    const index = row.dataset.profileLinkRow;
    return {
      title: $(`[data-profile-link-title="${index}"]`, row)?.value || '',
      url: $(`[data-profile-link-url="${index}"]`, row)?.value || '',
    };
  }).slice(0, 12);
  return strict ? normalizeProfileLinks(links) : links;
}

function renderProfileDefaultReaderTab() {
  const selected = normalizeDefaultReaderTab(state.profileDefaultReaderTabDraft);
  $$('[data-profile-reader-tab]').forEach(btn => {
    const active = btn.dataset.profileReaderTab === selected;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function setProfileDefaultReaderTab(tab) {
  state.profileDefaultReaderTabDraft = normalizeDefaultReaderTab(tab);
  renderProfileDefaultReaderTab();
}

function renderProfileEditor() {
  if (!state.me) return;
  $('#profile-display-name').value = state.me.displayName || '';
  $('#profile-bio').value = state.me.bio || '';
  state.profileAvatarDraft = '';
  state.profileLinksDraft = normalizeProfileLinks(state.me.links || []);
  state.profileDefaultReaderTabDraft = normalizeDefaultReaderTab(state.me.defaultReaderTab || state.defaultReaderTab);
  renderProfileAvatarPreview();
  renderProfileLinksEditor();
  renderProfileDefaultReaderTab();
  const adminActions = $('#profile-admin-actions');
  if (adminActions) adminActions.classList.toggle('hidden', !isAdmin());
}

function renderNotifications() {
  const list = $('#notification-list');
  if (!list) return;
  const items = state.notifications || [];
  if (!items.length) {
    list.innerHTML = '<div class="notification-empty">暂无通知</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="notification-item${item.read ? '' : ' unread'}">
      <div>${escapeHtml(item.message || '新的通知')}</div>
      <div class="notification-meta">${escapeHtml([item.actorName, item.entryTitle, timeAgo(item.createdAt)].filter(Boolean).join(' · '))}</div>
    </div>
  `).join('');
}

async function loadNotifications() {
  if (!state.me) return;
  try {
    const data = await api('/api/me/notifications?limit=80');
    state.notifications = data.notifications || [];
    setCurrentUser({ ...state.me, notificationUnreadCount: Number(data.unreadCount) || 0 }, { resetProfileDraft: false });
    renderNotifications();
    renderAuthState();
  } catch (err) {
    state.notifications = [];
    renderNotifications();
    toast('读取通知失败: ' + err.message, 4000);
  }
}

async function markMyNotificationsRead() {
  if (!state.me) return;
  try {
    const data = await api('/api/me/notifications/read', { method: 'POST' });
    if (data.user) setCurrentUser(data.user, { resetProfileDraft: false });
    state.notifications = (state.notifications || []).map(item => ({ ...item, read: true }));
    renderNotifications();
    renderAuthState();
    toast('通知已标记为已读');
  } catch (err) {
    toast('更新通知失败: ' + err.message, 4000);
  }
}

async function saveProfile() {
  if (!state.me) return;
  const btn = $('#profile-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const payload = {
      displayName: $('#profile-display-name').value.trim(),
      bio: $('#profile-bio').value.trim(),
      avatarUrl: state.profileAvatarDraft || state.me.avatarUrl || '',
      links: collectProfileLinks({ strict: true }),
      defaultReaderTab: normalizeDefaultReaderTab(state.profileDefaultReaderTabDraft),
    };
    const data = await api('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (data.user) setCurrentUser(data.user);
    renderAuthState();
    renderProfileEditor();
    renderMyPublicProfileActions();
    toast('个人资料已保存');
  } catch (err) {
    toast('保存资料失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存资料';
  }
}

function renderMyAssets() {
  const list = $('#my-comments-list');
  if (!list) return;
  renderMyAssetTabs();
  const type = normalizeUserAssetTab(state.myAssetTab);
  const items = myAssetItemsForTab(type);
  if (!items.length) {
    list.innerHTML = `<div class="my-comments-empty">还没有沉淀过公开${escapeHtml(userAssetLabel(type))}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const entry = item.entry || {};
    const display = userAssetDisplay(type, item);
    const title = type === 'translation'
      ? (item.titleZh || entry.titleZh || entry.title || '未命名文章')
      : type === 'rewrite'
        ? (item.title || entry.titleZh || entry.title || '未命名文章')
        : (entry.titleZh || entry.title || '未命名文章');
    const meta = type === 'chat' ? [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'annotations' ? [
      sourceName(entry.sourceId),
      ANNOTATION_SURFACE_LABELS[item.surface] || '原文',
      Number(item.replyCount || 0) ? `回复 ${Number(item.replyCount)}` : '',
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `更新 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'comments' ? [
      sourceName(entry.sourceId),
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `编辑 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
    ].filter(Boolean).join(' · ') : [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? formatAssetTime(item.updatedAt)
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ');
    return `
      <article class="my-comment-item">
        <div class="my-comment-head">
          <div class="my-comment-title">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <strong>${escapeHtml(title)}</strong>
          </div>
          <span class="my-comment-meta">${escapeHtml(meta)}</span>
        </div>
        <p class="my-comment-body">${escapeHtml(plainSnippet(display.body || item.bodySnippet || item.contentSnippet || item.body || item.content, 260))}</p>
        <div class="my-comment-actions">
          <button type="button" class="ghost-btn" data-my-asset-open="${escapeHtml(item.id)}">${iconButtonLabel('external-link', '打开文章')}</button>
          <button type="button" class="ghost-btn" data-my-asset-copy-content="${escapeHtml(item.id)}">${iconButtonLabel('file-text', '复制内容')}</button>
          <button type="button" class="ghost-btn" data-my-asset-copy="${escapeHtml(item.id)}">${iconButtonLabel('copy', '复制链接')}</button>
        </div>
      </article>`;
  }).join('');
}

async function openMyCommentsModal({ push = true, tab = state.dashboardTab } = {}) {
  if (!state.me) return false; // me 恒 null：无远程 dashboard
  setWorkspacePage('dashboard');
  setDashboardTab(tab, { persist: true, push: false });
  document.title = '个人后台 · QMReader';
  if (push) history.pushState({ dashboard: true, tab: state.dashboardTab }, '', dashboardUrlFor(state.dashboardTab));
  renderProfileEditor();
  loadNotifications();
  renderMyAssetTabs();
  $('#my-comments-list').innerHTML = '<div class="my-comments-empty">正在读取我的资产…</div>';
  try {
    const [translationData, rewriteData, annotationData, commentData, chatData] = await Promise.all([
      api('/api/me/translations?limit=100'),
      api('/api/me/rewrites?limit=100'),
      api('/api/me/annotations?limit=100'),
      api('/api/me/comments?limit=100'),
      api('/api/me/chat-messages?limit=100'),
    ]);
    state.myTranslations = translationData.translations || [];
    state.myRewrites = rewriteData.rewrites || [];
    state.myAnnotations = annotationData.annotations || [];
    state.myComments = commentData.comments || [];
    state.myChatMessages = chatData.messages || [];
    renderMyAssets();
    return true;
  } catch (err) {
    $('#my-comments-list').innerHTML = `<div class="my-comments-empty">读取失败：${escapeHtml(err.message)}</div>`;
    return false;
  }
}

function closeMyCommentsModal({ clearUrl = true } = {}) {
  setWorkspacePage('');
  if (clearUrl && /^\/(?:me|dashboard)\/?$/.test(window.location.pathname)) {
    const url = state.activeEntry ? readerUrlFor(state.activeEntry, state.readerTab, state.readerFocus) : listUrlFor();
    history.pushState({}, '', url);
    document.title = state.activeEntry ? readerRouteTitle(state.activeEntry, state.readerFocus) : listRouteTitle();
  }
}

function myAssetItemsForTab(type) {
  const items = type === 'translation'
    ? state.myTranslations || []
    : type === 'rewrite'
    ? state.myRewrites || []
    : type === 'annotations'
    ? state.myAnnotations || []
    : type === 'chat'
    ? state.myChatMessages || []
    : state.myComments || [];
  return sortAssetItems(items, state.myAssetSort);
}

function myAssetItemsForCurrentTab() {
  return myAssetItemsForTab(normalizeUserAssetTab(state.myAssetTab));
}

function userAssetDisplay(type, item) {
  if (type === 'likes') return { label: '点赞文章', body: item.summaryZh || item.summary || item.entry?.summaryZh || item.entry?.summary || '' };
  if (type === 'translation') return { label: '中文翻译', body: item.contentSnippet || item.summaryZh || '' };
  if (type === 'rewrite') return { label: '中文改写', body: item.bodySnippet || '' };
  if (type === 'annotations') return { label: `划线 · ${ANNOTATION_SURFACE_LABELS[item.surface] || '原文'}`, body: `「${item.quoteSnippet || item.quote || ''}」\n${item.bodySnippet || item.body || ''}` };
  if (type === 'chat') return { label: item.role === 'assistant' ? '回答' : '提问', body: item.content || item.contentSnippet || '' };
  return commentDisplayParts(item.body || item.bodySnippet || '');
}

function translationAssetText(translation, item = {}) {
  const content = translation && Array.isArray(translation.content) ? translation.content : [];
  return [
    translation?.titleZh || item.titleZh || '',
    translation?.summaryZh || item.summaryZh || '',
    ...content.map(translationPairText).filter(Boolean),
  ].map(part => String(part || '').trim()).filter(Boolean).join('\n\n');
}

function assetContentText(type, item, fullAsset = null) {
  if (!item) return '';
  const assetType = normalizeUserAssetTab(type);
  if (assetType === 'translation') return translationAssetText(fullAsset || item, item);
  if (assetType === 'rewrite') return String((fullAsset && fullAsset.body) || item.body || item.bodySnippet || '').trim();
  if (assetType === 'annotations') {
    const quote = String(item.quote || item.quoteSnippet || '').trim();
    const body = String(item.body || item.bodySnippet || item.text || '').trim();
    return [quote ? `「${quote}」` : '', body].filter(Boolean).join('\n\n');
  }
  if (assetType === 'chat') {
    const label = item.role === 'assistant' ? '回答' : '提问';
    const content = String(item.content || item.contentSnippet || item.text || '').trim();
    return content ? `${label}：\n${content}` : '';
  }
  return String(item.body || item.bodySnippet || item.text || '').trim();
}

async function fullAiAssetForCopy(type, item) {
  const assetType = normalizeUserAssetTab(type);
  if (!item || !item.id || !['translation', 'rewrite'].includes(assetType)) return null;
  const entryId = item.entry?.id || item.entryId;
  if (!entryId) return null;
  const endpoint = assetType === 'translation' ? 'translation' : 'rewrite';
  const data = await api(`/api/entry/${encodeURIComponent(entryId)}/${endpoint}?assetId=${encodeURIComponent(item.id)}`);
  return data && data[endpoint] ? data[endpoint] : null;
}

async function copyAssetContent(type, item) {
  const assetType = normalizeUserAssetTab(type);
  if (!item) {
    toast('找不到这条资产');
    return;
  }
  try {
    const fullAsset = await fullAiAssetForCopy(assetType, item);
    const text = assetContentText(assetType, item, fullAsset);
    if (!text) {
      toast('这条资产没有可复制的内容');
      return;
    }
    copyText(text, `${userAssetLabel(assetType)}内容已复制`);
  } catch (err) {
    toast('复制内容失败: ' + err.message, 5000);
  }
}

async function openMyAsset(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const entryId = item && (item.entry?.id || item.entryId);
  if (!entryId) {
    toast('找不到这条资产对应的文章');
    return;
  }
  closeMyCommentsModal();
  const type = normalizeUserAssetTab(state.myAssetTab);
  const ok = type === 'translation' || type === 'rewrite'
    ? await openEntryById(entryId, { focus: type, aiAssetId: item.id, updateUrl: true, replaceUrl: false })
    : type === 'annotations'
    ? await openEntryById(entryId, { focus: 'annotations', annotationId: itemId, updateUrl: true, replaceUrl: false })
    : type === 'chat'
    ? await openEntryById(entryId, { focus: 'chat', chatMessageId: itemId, updateUrl: true, replaceUrl: false })
    : await openEntryById(entryId, { focus: 'comments', commentId: itemId, updateUrl: true, replaceUrl: false });
  if (!ok) toast('找不到这篇文章');
}

function copyMyAssetLink(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const url = myAssetUrl(state.myAssetTab, item);
  if (!url) {
    toast('找不到这条资产链接');
    return;
  }
  copyText(url, `${userAssetLabel(normalizeUserAssetTab(state.myAssetTab))}链接已复制`);
}

function copyMyAssetContent(itemId) {
  const item = myAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  copyAssetContent(state.myAssetTab, item);
}

function copyMyPublicProfileLink() {
  const url = myPublicProfileUrl();
  if (!url) {
    toast('还没有可复制的公开资产页');
    return;
  }
  copyText(url, '我的公开资产页已复制');
}

function copyMyPublicRssLink() {
  const url = myPublicRssUrl();
  if (!url) {
    toast('还没有可复制的公开资产 RSS');
    return;
  }
  copyText(url, '我的公开资产 RSS 已复制');
}

function contributorAssetItemsForCurrentTab() {
  const type = normalizeUserAssetTab(state.contributor.tab);
  const items = type === 'translation'
    ? state.contributor.translations || []
    : type === 'rewrite'
    ? state.contributor.rewrites || []
    : type === 'annotations'
    ? state.contributor.annotations || []
    : type === 'chat'
    ? state.contributor.messages || []
    : type === 'likes'
    ? state.contributor.likedEntries || []
    : state.contributor.comments || [];
  return sortContributorAssets(items, state.contributor.sort);
}

function renderContributorTabs() {
  const translationCount = (state.contributor.translations || []).length;
  const rewriteCount = (state.contributor.rewrites || []).length;
  const annotationCount = (state.contributor.annotations || []).length;
  const commentCount = (state.contributor.comments || []).length;
  const chatCount = (state.contributor.messages || []).length;
  const likesCount = (state.contributor.likedEntries || []).length;
  $('#contributor-translation-count').textContent = translationCount;
  $('#contributor-rewrite-count').textContent = rewriteCount;
  $('#contributor-annotations-count').textContent = annotationCount;
  $('#contributor-comments-count').textContent = commentCount;
  $('#contributor-chat-count').textContent = chatCount;
  $('#contributor-likes-count').textContent = likesCount;
  $$('#contributor-page [data-contributor-tab]').forEach(btn => {
    const active = btn.dataset.contributorTab === state.contributor.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('#contributor-page [data-contributor-asset-sort]').forEach(btn => {
    const active = normalizeContributorAssetSort(btn.dataset.contributorAssetSort) === state.contributor.sort;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function assetItemTime(item) {
  return Math.max(Number(item && item.updatedAt) || 0, Number(item && item.createdAt) || 0, Number(item && item.at) || 0);
}

function sortContributorAssets(items, sort = 'latest') {
  return sortAssetItems(items, sort);
}

function sortAssetItems(items, sort = 'latest') {
  const assetSort = normalizeAssetSort(sort);
  return [...(items || [])].sort((a, b) => {
    if (assetSort === 'helpful') {
      const helpfulDelta = Number(b && b.helpfulCount || 0) - Number(a && a.helpfulCount || 0);
      if (helpfulDelta) return helpfulDelta;
    }
    return assetItemTime(b) - assetItemTime(a);
  });
}

function syncContributorUrl({ replace = true } = {}) {
  const id = state.contributor.id || (state.contributor.profile && state.contributor.profile.id);
  if (!id || !window.location.pathname.startsWith('/contributors/')) return;
  const url = contributorUrlFor(id, { sort: state.contributor.sort, tab: state.contributor.tab });
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ contributorId: id }, '', url);
}

function contributorPageTitle() {
  const profile = state.contributor.profile;
  if (!profile) return '贡献主页 · QMReader';
  const sortPrefix = state.contributor.sort === 'helpful' ? '有用 · ' : '';
  const tab = normalizeUserAssetTab(state.contributor.tab);
  const label = tab === 'translation' ? '公开资产' : userAssetLabel(tab);
  return `${sortPrefix}${profile.displayName} 的${label} · QMReader`;
}

function renderContributorProfile() {
  const profile = state.contributor.profile;
  const box = $('#contributor-profile');
  if (!box) return;
  if (!profile) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const links = normalizeProfileLinks(profile.links || []);
  box.classList.remove('hidden');
  box.innerHTML = `
    ${avatarHtml(profile, 'contributor-profile-avatar')}
      <div class="contributor-profile-body">
        <div class="contributor-profile-stats">
        ${Number(profile.followerCount) || 0} 关注者 · ${Number(profile.followingCount) || 0} 正在关注 · ${Number(profile.helpfulCount) || 0} 有用反馈 · ${(state.contributor.likedEntries || []).length} 篇点赞
      </div>
      ${profile.bio ? `<div class="contributor-profile-bio">${escapeHtml(profile.bio)}</div>` : ''}
      ${links.length ? `<div class="contributor-profile-links">${links.map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.title || compactUrlLabel(link.url))}</a>`).join('')}</div>` : ''}
    </div>
  `;
  const follow = $('#contributor-follow');
  if (follow) {
    const isSelf = Boolean(state.me && state.me.id === profile.id);
    follow.classList.toggle('hidden', !state.me || isSelf);
    follow.textContent = profile.followedByMe ? '已关注' : '关注';
    follow.classList.toggle('active', Boolean(profile.followedByMe));
    follow.setAttribute('aria-pressed', profile.followedByMe ? 'true' : 'false');
  }
}

function renderContributorAssets() {
  const list = $('#contributor-list');
  if (!list) return;
  const profile = state.contributor.profile;
  const rssLink = $('#contributor-rss-link');
  const rssUrl = profile ? contributorFeedUrlFor(profile.id).href : '';
  const helpfulCount = Number(profile && profile.helpfulCount) || 0;
  const helpfulAssets = Number(profile && profile.helpfulAssets) || 0;
  $('#contributor-title').textContent = profile ? `${profile.displayName} 的贡献主页` : '贡献主页';
  $('#contributor-subtitle').textContent = profile
    ? `公开沉淀的翻译、重写、划线点评、点评、文章对话和点赞文章。${helpfulCount ? `获得 ${helpfulCount} 次有用反馈，覆盖 ${helpfulAssets} 条资产。` : ''}`
    : '正在读取公开资产…';
  renderContributorProfile();
  if (rssLink) {
    rssLink.classList.toggle('hidden', !rssUrl);
    rssLink.href = rssUrl || '#';
  }
  renderContributorTabs();
  if (state.contributor.loading) {
    list.innerHTML = '<div class="my-comments-empty">正在读取贡献主页…</div>';
    return;
  }
  const type = normalizeUserAssetTab(state.contributor.tab);
  const items = contributorAssetItemsForCurrentTab();
  if (!items.length) {
    list.innerHTML = `<div class="my-comments-empty">还没有公开${escapeHtml(userAssetLabel(type))}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const entry = item.entry || {};
    const display = userAssetDisplay(type, item);
    const title = type === 'likes'
      ? (item.titleZh || entry.titleZh || item.title || entry.title || '未命名文章')
      : type === 'translation'
      ? (item.titleZh || entry.titleZh || entry.title || '未命名文章')
      : type === 'rewrite'
        ? (item.title || entry.titleZh || entry.title || '未命名文章')
        : (entry.titleZh || entry.title || '未命名文章');
    const meta = type === 'likes' ? [
      sourceName(entry.sourceId || item.sourceId),
      Number(item.stats?.likeCount || 0) ? `赞 ${Number(item.stats.likeCount)}` : '',
      Number(item.stats?.dislikeCount || 0) ? `负反馈 ${Number(item.stats.dislikeCount)}` : '',
      Number(item.stats?.viewCount || 0) ? `阅 ${Number(item.stats.viewCount)}` : '',
      `点赞 ${formatAssetTime(item.updatedAt || item.createdAt)}`,
    ].filter(Boolean).join(' · ') : type === 'chat' ? [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'annotations' ? [
      sourceName(entry.sourceId),
      ANNOTATION_SURFACE_LABELS[item.surface] || '原文',
      Number(item.replyCount || 0) ? `回复 ${Number(item.replyCount)}` : '',
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `更新 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ') : type === 'comments' ? [
      sourceName(entry.sourceId),
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? `编辑 ${formatAssetTime(item.updatedAt)}`
        : formatAssetTime(item.createdAt),
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
    ].filter(Boolean).join(' · ') : [
      sourceName(entry.sourceId),
      item.author,
      item.model,
      Number(item.helpfulCount || 0) ? `有用 ${Number(item.helpfulCount)}` : '',
      Number(item.updatedAt || 0) > Number(item.createdAt || 0)
        ? formatAssetTime(item.updatedAt)
        : formatAssetTime(item.createdAt),
    ].filter(Boolean).join(' · ');
    return `
      <article class="my-comment-item">
        <div class="my-comment-head">
          <div class="my-comment-title">
            ${display.label ? `<span class="comment-kind">${escapeHtml(display.label)}</span>` : ''}
            <strong>${escapeHtml(title)}</strong>
          </div>
          <span class="my-comment-meta">${escapeHtml(meta)}</span>
        </div>
        <p class="my-comment-body">${escapeHtml(plainSnippet(display.body || item.bodySnippet || item.contentSnippet || item.body || item.content, 260))}</p>
        <div class="my-comment-actions">
          <button type="button" class="ghost-btn" data-contributor-asset-open="${escapeHtml(item.id)}">${iconButtonLabel('external-link', '打开文章')}</button>
          ${type === 'likes' ? '' : `<button type="button" class="ghost-btn" data-contributor-asset-copy-content="${escapeHtml(item.id)}">${iconButtonLabel('file-text', '复制内容')}</button>`}
          <button type="button" class="ghost-btn" data-contributor-asset-copy="${escapeHtml(item.id)}">${iconButtonLabel('copy', '复制链接')}</button>
        </div>
      </article>`;
  }).join('');
}

async function openContributor(contributorId, { push = true, sort = state.contributor.sort, tab = state.contributor.tab } = {}) {
  const id = String(contributorId || '').trim();
  if (!id) return;
  const contributorAssetSort = normalizeContributorAssetSort(sort);
  const contributorAssetTab = normalizeUserAssetTab(tab);
  state.contributor = { id, profile: null, translations: [], rewrites: [], annotations: [], comments: [], messages: [], likedEntries: [], tab: contributorAssetTab, sort: contributorAssetSort, loading: true };
  setWorkspacePage('contributor');
  renderContributorAssets();
  try {
    const data = await api(`/api/contributors/${encodeURIComponent(id)}?limit=100`);
    if (state.contributor.id !== id) return;
    state.contributor = {
      id,
      profile: data.contributor || null,
      translations: data.translations || [],
      rewrites: data.rewrites || [],
      annotations: data.annotations || [],
      comments: data.comments || [],
      messages: data.messages || [],
      likedEntries: data.likedEntries || [],
      tab: contributorAssetTab,
      sort: contributorAssetSort,
      loading: false,
    };
    renderContributorAssets();
    document.title = contributorPageTitle();
    if (push) history.pushState({ contributorId: id }, '', contributorUrlFor(id, { sort: state.contributor.sort, tab: state.contributor.tab }));
  } catch (err) {
    if (state.contributor.id !== id) return;
    state.contributor.loading = false;
    $('#contributor-list').innerHTML = `<div class="my-comments-empty">读取失败：${escapeHtml(err.message)}</div>`;
    toast('读取贡献主页失败: ' + err.message, 5000);
  }
}

async function toggleContributorFollow() {
  const profile = state.contributor.profile;
  if (!profile || !state.me || state.me.id === profile.id) return;
  const next = !profile.followedByMe;
  const btn = $('#contributor-follow');
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/contributors/${encodeURIComponent(profile.id)}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow: next }),
    });
    if (data.contributor) {
      state.contributor.profile = { ...state.contributor.profile, ...data.contributor };
      renderContributorAssets();
    }
    toast(next ? '已关注' : '已取消关注');
  } catch (err) {
    toast('关注失败: ' + err.message, 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function closeContributorModal({ clearUrl = true } = {}) {
  setWorkspacePage('');
  if (clearUrl && window.location.pathname.startsWith('/contributors/')) {
    const url = state.activeEntry ? readerUrlFor(state.activeEntry, state.readerTab, state.readerFocus) : listUrlFor();
    history.pushState({}, '', url);
    document.title = state.activeEntry ? readerRouteTitle() : listRouteTitle();
  }
}

async function openContributorAsset(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const entryId = item && (item.entry?.id || item.entryId);
  if (!entryId) {
    toast('找不到这条资产对应的文章');
    return;
  }
  closeContributorModal({ clearUrl: false });
  const type = normalizeUserAssetTab(state.contributor.tab);
  const ok = type === 'likes'
    ? await openEntryById(entryId, { updateUrl: true, replaceUrl: false })
    : type === 'translation' || type === 'rewrite'
    ? await openEntryById(entryId, { focus: type, aiAssetId: item.id, updateUrl: true, replaceUrl: false })
    : type === 'annotations'
    ? await openEntryById(entryId, { focus: 'annotations', annotationId: itemId, updateUrl: true, replaceUrl: false })
    : type === 'chat'
    ? await openEntryById(entryId, { focus: 'chat', chatMessageId: itemId, updateUrl: true, replaceUrl: false })
    : await openEntryById(entryId, { focus: 'comments', commentId: itemId, updateUrl: true, replaceUrl: false });
  if (!ok) toast('找不到这篇文章');
}

function copyContributorAssetLink(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  const url = myAssetUrl(state.contributor.tab, item);
  if (!url) {
    toast('找不到这条资产链接');
    return;
  }
  copyText(url, `${userAssetLabel(normalizeUserAssetTab(state.contributor.tab))}链接已复制`);
}

function copyContributorAssetContent(itemId) {
  const item = contributorAssetItemsForCurrentTab().find(asset => asset.id === itemId);
  copyAssetContent(state.contributor.tab, item);
}

function entryAssetPreviewForCopy(entry, type, itemId = '') {
  const assetType = normalizeUserAssetTab(type);
  const assets = entry && entry.assets ? entry.assets : {};
  const id = String(itemId || '').trim();
  const items = assets.items && Array.isArray(assets.items[assetType]) ? assets.items[assetType] : [];
  const preview = (id && items.find(item => item && item.id === id))
    || (id && assets.previews && assets.previews[assetType] && assets.previews[assetType].id === id ? assets.previews[assetType] : null)
    || (assets.previews && assets.previews[assetType])
    || (assets.preview && assets.preview.type === assetType ? assets.preview : null);
  if (!preview) return null;
  return {
    ...preview,
    id: preview.id || id,
    entryId: entry && entry.id,
    entry,
  };
}

function autosizeCommentEditInput(input) {
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
}

function editComment(commentId) {
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!comment || !comment.canEdit) {
    toast('没有权限编辑这条点评');
    return;
  }
  state.editingCommentId = commentId;
  renderComments();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
    if (!input) return;
    autosizeCommentEditInput(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function cancelEditComment(commentId) {
  if (state.editingCommentId !== commentId) return;
  state.editingCommentId = '';
  renderComments();
}

async function saveCommentEdit(commentId) {
  const entry = state.activeEntry;
  const input = document.querySelector(`[data-comment-edit-input="${CSS.escape(commentId)}"]`);
  const body = input ? input.value.trim() : '';
  if (!entry || !commentId) return;
  if (!body) {
    toast('点评不能为空');
    return;
  }
  const btn = document.querySelector(`[data-comment-save="${CSS.escape(commentId)}"]`);
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    state.editingCommentId = '';
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    renderList();
    toast('点评已更新');
  } catch (err) {
    toast('更新点评失败: ' + err.message, 5000);
    if (btn) btn.disabled = false;
  }
}

async function toggleCommentHelpful(commentId) {
  const entry = state.activeEntry;
  const comment = (state.comments || []).find(item => item.id === commentId);
  if (!entry || !commentId || !comment) return;
  const nextHelpful = !comment.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    renderComments();
    renderReaderAssetSummary();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteComment(commentId) {
  const entry = state.activeEntry;
  if (!entry || !commentId) return;
  const ok = await showConfirmDialog({
    title: '撤回点评',
    message: '撤回后，公开资产页和 RSS 中也会移除这条点评。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    renderList();
    toast('点评已撤回');
  } catch (err) {
    toast('撤回点评失败: ' + err.message, 5000);
  }
}

function highlightCommentFromRoute() {
  const commentId = state.pendingCommentId;
  if (!commentId) return;
  const target = document.getElementById(`comment-${commentId}`);
  if (!target) return;
  state.pendingCommentId = '';
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('comment-target');
  setTimeout(() => target.classList.remove('comment-target'), 2400);
}

function autosizeCommentInput() {
  const input = $('#comment-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function insertCommentTemplate(type) {
  const prefix = COMMENT_TEMPLATES[type];
  const input = $('#comment-input');
  if (!prefix || !input) return;
  const value = input.value;
  const start = input.selectionStart ?? value.length;
  const end = input.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leading = before && !before.endsWith('\n') ? '\n' : '';
  const insert = `${leading}${prefix}${selected ? selected : ' '}`;
  input.value = `${before}${insert}${after}`;
  const nextCursor = before.length + insert.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);
  autosizeCommentInput();
}

async function loadComments(entry) {
  state.comments = [];
  state.editingCommentId = '';
  renderComments();
  try {
    const data = await api(`/api/entry/${entry.id}/comments`);
    if (state.activeEntry?.id !== entry.id) return;
    state.comments = data.comments || [];
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
  } catch {
    renderComments();
  }
}

async function submitComment() {
  const entry = state.activeEntry;
  const body = $('#comment-input').value.trim();
  if (!entry || !body) return;
  $('#comment-send').disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    state.comments = data.comments || [];
    $('#comment-input').value = '';
    autosizeCommentInput();
    updateEntryAssets(entry.id, { comments: state.comments.length });
    renderComments();
    toast('点评已发布');
  } catch (err) {
    toast('点评失败: ' + err.message, 5000);
  } finally {
    $('#comment-send').disabled = false;
  }
}

function renderAgentMessages(extraPending = false, { preserveScroll = false } = {}) {
  const el = $('#agent-messages');
  if (!el) return;
  renderAgentContextStrip();
  const thread = state.agentMessages || [];
  const hadPendingChatMessage = Boolean(state.pendingChatMessageId);
  const previousScrollTop = el.scrollTop;
  el.innerHTML = '';
  if (!state.activeEntry) {
    el.innerHTML = agentEmptyHtml('no-entry');
    return;
  }
  if (!thread.length && !extraPending) {
    el.innerHTML = agentEmptyHtml();
    return;
  }

  const frag = document.createDocumentFragment();
  const messages = extraPending ? [...thread, { role: 'assistant', content: '思考中…', pending: true }] : thread;
  for (const message of messages) {
    const row = document.createElement('div');
    row.className = `agent-msg ${message.role}${message.pending ? ' pending' : ''}`;
    if (message.id) row.id = `chat-${message.id}`;
    const head = document.createElement('div');
    head.className = 'agent-msg-head';
    const role = document.createElement('div');
    role.className = 'agent-msg-role';
    const metaText = agentMessageMeta(message);
    if (message.contributorId && message.role === 'user') {
      const author = message.author || message.contributorName || '读者';
      const authorBtn = document.createElement('button');
      authorBtn.type = 'button';
      authorBtn.className = 'contributor-inline agent-contributor-link';
      authorBtn.textContent = message.contributorName || author;
      authorBtn.onclick = () => openContributor(message.contributorId);
      role.appendChild(authorBtn);
      const rest = metaText.startsWith(author) ? metaText.slice(author.length) : '';
      role.appendChild(document.createTextNode(rest));
    } else {
      role.textContent = metaText;
    }
    role.title = metaText;
    head.appendChild(role);
    const footer = document.createElement('div');
    footer.className = 'agent-msg-footer';
    if (!message.pending) {
      const actions = document.createElement('div');
      actions.className = 'agent-msg-actions';
      if (message.id) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'agent-msg-action agent-msg-link';
        link.title = '复制这条对话链接';
        link.setAttribute('aria-label', '复制这条对话链接');
        setElementIcon(link, 'hash');
        link.onclick = () => copyAgentMessageLink(message.id);
        actions.appendChild(link);
      }
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'agent-msg-action agent-msg-copy';
      copy.title = '复制这条消息';
      copy.setAttribute('aria-label', '复制这条消息');
      setElementIcon(copy, 'copy');
      copy.onclick = () => copyText(message.content, '消息已复制');
      actions.appendChild(copy);
      const draft = document.createElement('button');
      draft.type = 'button';
      draft.className = 'agent-msg-action agent-msg-draft';
      draft.title = '放入人工点评';
      draft.setAttribute('aria-label', '放入人工点评');
      setElementIcon(draft, 'message-circle-plus');
      draft.onclick = () => draftCommentFromAgentMessage(message);
      actions.appendChild(draft);
      if (message.canDelete && message.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'agent-msg-action agent-msg-action-danger';
        del.title = '撤回这条对话';
        del.setAttribute('aria-label', '撤回这条对话');
        setElementIcon(del, 'trash-2');
        del.onclick = () => deleteAgentMessage(message.id);
        actions.appendChild(del);
      }
      if (actions.childElementCount) footer.appendChild(actions);
    }
    const body = document.createElement('div');
    body.className = 'agent-msg-body';
    body.innerHTML = renderMarkdownLite(message.content);
    row.appendChild(head);
    row.appendChild(body);
    if (!message.pending && message.id) {
      const feedback = document.createElement('div');
      feedback.className = 'agent-msg-feedback';
      const helpfulCount = Number(message.helpfulCount || 0);
      const helpful = document.createElement('button');
      helpful.type = 'button';
      helpful.className = `agent-msg-helpful${message.helpfulByMe ? ' active' : ''}`;
      helpful.setAttribute('aria-pressed', message.helpfulByMe ? 'true' : 'false');
      helpful.title = message.helpfulByMe ? '取消有用标记' : '标记这条对话有用';
      helpful.textContent = `有用${helpfulCount ? ` ${helpfulCount}` : ''}`;
      helpful.onclick = () => toggleAgentHelpful(message.id);
      feedback.appendChild(helpful);
      footer.appendChild(feedback);
    }
    if (footer.childElementCount) row.appendChild(footer);
    frag.appendChild(row);
  }
  el.appendChild(frag);
  if (hadPendingChatMessage) {
    if (highlightAgentMessageFromRoute()) state.pendingAssetJump = null;
  } else if (preserveScroll) {
    el.scrollTop = previousScrollTop;
  } else {
    el.scrollTop = el.scrollHeight;
  }
  renderReaderAssetSummary();
  settlePendingAssetJump('chat');
}

function agentMessageMeta(message) {
  const author = message.author || (message.role === 'user' ? '读者' : 'AI');
  const parts = [author];
  if (message.role === 'assistant' && message.model) parts.push(message.model);
  const time = formatAssetTime(message.createdAt);
  if (time) parts.push(time);
  return parts.join(' · ');
}

function copyAgentMessageLink(messageId) {
  const url = chatMessageUrl(messageId);
  if (!url) {
    toast('找不到这条对话链接');
    return;
  }
  copyText(url, '对话链接已复制');
}

function draftCommentFromAgentMessage(message) {
  if (!state.activeEntry || !message || !String(message.content || '').trim()) return;
  const input = $('#comment-input');
  if (!input) return;
  const content = String(message.content || '').trim();
  const prefix = message.role === 'user' ? '疑问：' : '观点：';
  const draft = `${prefix}${content.length > 1600 ? `${content.slice(0, 1599).trim()}…` : content}`;
  const current = input.value.trim();
  input.value = current ? `${current}\n\n${draft}` : draft;
  if (input.value.length > 5000) input.value = input.value.slice(0, 4999).trimEnd();
  state.readerFocus = 'comments';
  scrollReaderTarget('#comment-input', { behavior: 'auto', offset: 120 });
  setTimeout(() => {
    input.focus({ preventScroll: true });
    input.selectionStart = input.selectionEnd = input.value.length;
    autosizeCommentInput();
    scrollReaderTarget('#comment-input', { behavior: 'auto', offset: 120 });
  }, 180);
  toast('已放入点评草稿，可编辑后发布');
}

function chatHelpfulAssetPatch(messages, entry = state.activeEntry) {
  const assets = mergeAssets(entry);
  const chatHelpfulCount = (messages || []).reduce((sum, message) => sum + (Number(message.helpfulCount) || 0), 0);
  const helpfulChats = (messages || []).filter(message => Number(message.helpfulCount || 0) > 0).length;
  const commentHelpfulCount = Number(assets.commentHelpfulCount ?? (Number(assets.helpfulCount || 0) - Number(assets.chatHelpfulCount || 0))) || 0;
  const annotationHelpfulCount = Number(assets.annotationHelpfulCount) || 0;
  return {
    chatMessages: (messages || []).filter(message => message && message.id).length,
    chatHelpfulCount,
    helpfulChats,
    helpfulCount: Math.max(0, commentHelpfulCount) + annotationHelpfulCount + chatHelpfulCount,
  };
}

async function toggleAgentHelpful(messageId) {
  const entry = state.activeEntry;
  const message = (state.agentMessages || []).find(item => item.id === messageId);
  if (!entry || !message) return;
  const nextHelpful = !message.helpfulByMe;
  try {
    const data = await api(`/api/entry/${entry.id}/chat/${encodeURIComponent(messageId)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || state.agentMessages || [];
    updateEntryAssets(entry.id, chatHelpfulAssetPatch(state.agentMessages, state.activeEntry), { rerenderList: false });
    renderAgentMessages(false, { preserveScroll: true });
    renderList();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  }
}

async function deleteAgentMessage(messageId) {
  const entry = state.activeEntry;
  if (!entry || !messageId) return;
  const ok = await showConfirmDialog({
    title: '撤回对话',
    message: '撤回后，公开资产页和 RSS 中也会移除这条对话。',
    confirmText: '撤回',
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/api/entry/${entry.id}/chat/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || [];
    updateEntryAssets(entry.id, { chatMessages: state.agentMessages.length });
    renderAgentMessages();
    renderList();
    toast('对话已撤回');
  } catch (err) {
    toast('撤回对话失败: ' + err.message, 5000);
  } finally {
    updateAgentControls();
  }
}

function highlightAgentMessageFromRoute() {
  const messageId = state.pendingChatMessageId;
  if (!messageId) return false;
  const target = document.getElementById(`chat-${messageId}`);
  if (!target) return false;
  state.pendingChatMessageId = '';
  setAgentCollapsed(false);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('agent-msg-target');
  setTimeout(() => target.classList.remove('agent-msg-target'), 2400);
  return true;
}

function copyAgentThread() {
  const messages = (state.agentMessages || []).filter(message => message && message.content);
  if (!messages.length) {
    toast('当前文章还没有对话');
    return;
  }
  const text = messages.map(message => {
    const role = message.role === 'user' ? (message.author || '读者') : (message.author || 'AI');
    return `${role}:\n${message.content}`;
  }).join('\n\n---\n\n');
  copyText(text, '当前对话已复制');
}

function updateAgentControls() {
  const hasEntry = Boolean(state.activeEntry);
  const hasKey = hasUsableAiConfig(aiConfigForPurpose('agent'));
  const input = $('#agent-input');
  const send = $('#agent-send');
  const panel = $('#agent-side-panel');
  if (!input || !send) return;
  if (!hasEntry) input.placeholder = '问当前文章…';
  else if (!hasKey) input.placeholder = '填写 API Key 后提问';
  else input.placeholder = '问当前文章…';
  input.disabled = !hasEntry || !hasKey || state.agentBusy;
  send.disabled = !hasEntry || !hasKey || state.agentBusy || !input.value.trim();
  setElementIcon(send, state.agentBusy ? 'loader-circle' : 'send', {
    className: state.agentBusy ? 'app-icon app-icon-spin' : 'app-icon',
  });
  send.title = state.agentBusy ? '正在生成' : '发送';
  send.setAttribute('aria-label', state.agentBusy ? '正在生成' : '发送');
  if (panel) panel.classList.toggle('agent-busy', Boolean(state.agentBusy));
  $$('.agent-prompt').forEach(btn => { btn.disabled = !hasEntry || !hasKey || state.agentBusy; });
  const copyThread = $('#agent-copy-thread');
  if (copyThread) copyThread.disabled = !hasEntry || !(state.agentMessages || []).length;
  syncPersonaAgentVisibility();
  renderAiStatus();
}

function renderAgent() {
  renderAgentPrompts();
  const title = $('#agent-title');
  if (!state.activeEntry) {
    if (title) title.textContent = '未选择文章';
    $('#agent-input').value = '';
  } else {
    if (title) title.textContent = state.activeEntry.titleZh || state.activeEntry.title || '无标题';
  }
  renderAgentContextStrip();
  renderAgentInlineContext();
  renderAgentMessages();
  mountPersonaAgent();
  updateAgentControls();
}

async function loadAgentMessages(entry) {
  state.agentMessages = [];
  renderAgent();
  try {
    const data = await api(`/api/entry/${entry.id}/chat`);
    if (state.activeEntry?.id !== entry.id) return;
    state.agentMessages = data.messages || [];
    updateEntryAssets(entry.id, { chatMessages: state.agentMessages.length });
    renderAgent();
  } catch {
    renderAgent();
  }
}

async function sendAgentMessage(text) {
  const entry = state.activeEntry;
  const content = String(text || '').trim();
  if (!entry || !content || state.agentBusy) return;
  if (submitPersonaAgentMessage(content)) return;
  const agentConfig = aiConfigForPurpose('agent');
  if (!hasUsableAiConfig(agentConfig)) {
    openAiConfigModal('agent', 'agent', content);
    toast('请先保存一个可用的 AI 配置');
    return;
  }

  const outboundContent = withAgentContext(content);
  state.agentMessages.push({ role: 'user', author: state.me?.displayName || '读者', content: outboundContent, createdAt: Date.now() });
  $('#agent-input').value = '';
  state.agentBusy = true;
  renderAgentMessages(true);
  updateAgentControls();

  try {
    const data = await api(`/api/entry/${entry.id}/chat`, {
      method: 'POST',
      aiConfig: agentConfig,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: outboundContent }] }),
    });
    if (state.activeEntry?.id === entry.id) {
      state.agentMessages = [...state.agentMessages.filter(m => !m.pending), data.assistantMessage || { role: 'assistant', author: 'DeepSeek', content: data.answer }];
      await loadAgentMessages(entry);
    }
  } catch (err) {
    state.agentMessages.push({ role: 'assistant', author: '系统', content: `对话失败：${err.message}` });
    if (state.activeEntry?.id === entry.id) renderAgentMessages();
  } finally {
    state.agentBusy = false;
    updateAgentControls();
  }
}

async function openEntry(e, { tab = null, focus = null, aiAssetId = '', commentId = '', annotationId = '', chatMessageId = '', updateUrl = true, replaceUrl = false } = {}) {
  setWorkspacePage('');
  const openGen = ++state.openGen;
  const previousEntryId = state.activeEntry?.id || '';
  if (previousEntryId && previousEntryId !== e.id) {
    state.agentContext = null;
    state.activeAnnotationId = '';
  }
  state.activeEntry = e;
  const requestedFocus = ASSET_FILTER_TYPES.includes(focus) ? focus : null;
  const requestedAssetId = (requestedFocus === 'translation' || requestedFocus === 'rewrite')
    ? String(aiAssetId || '').trim()
    : requestedFocus === 'annotations'
      ? String(annotationId || '').trim()
      : '';
  let requestedTab = requestedFocus === 'translation'
    ? 'translation'
    : requestedFocus === 'rewrite'
      ? 'rewrite'
      : normalizeReaderOpenTab(tab);
  // Zen 自用：只读原文，忽略改写/翻译深链
  if (isZenPersonalMode()) requestedTab = 'original';
  // 开文只记浏览历史，不自动已读；须手动点「已读」才标已读
  recordEntryView(e.id);
  syncEntryState(e.id, { viewed: true });
  persist();

  const src = sourceById(e.sourceId);
  $('#reader-empty').classList.add('hidden');
  $('#reader').classList.remove('hidden');
  renderAdminEntryControls();
  $('#reader-source').innerHTML = `${src ? sourceFaviconHtml(src, 14) : ''}<span>${escapeHtml(src ? src.name : '')}</span>`;
  renderTitle(e);
  updateRewriteUiLabels(e);
  document.title = readerRouteTitle(e, requestedFocus);
  // GitHub 项目：标题旁只显示 ⭐ 与最近推送，不铺项目信息表
  if (e.sourceId === 'github-projects' || (src && src.contentKind === 'repo')) {
    $('#reader-meta').textContent = formatGithubRepoReaderMeta(e);
  } else if (e.sourceId === 'zen-recent' || (src && src.contentKind === 'syllabus')) {
    // 课程/大纲：与列表一致，优先 summaryZh；不显示伪发布时间
    const metaEl = $('#reader-meta');
    if (metaEl) {
      metaEl.textContent = typeof formatSyllabusReaderMeta === 'function'
        ? formatSyllabusReaderMeta(e)
        : String(e.summaryZh || e.summary || e.author || '课程入口').replace(/\s+/g, ' ').trim();
    }
  } else {
    const publishedTime = friendlyDateTime(entryDisplayTimeTs(e));
    $('#reader-meta').textContent = publishedTime;
  }
  const readerOpen = $('#reader-open');
  if (readerOpen) readerOpen.href = e.link || '#';
  renderReaderStatsUi();
  $('#comment-input').value = '';
  state.editingCommentId = '';
  state.annotations = [];
  state.annotationDraft = null;
  state.activeAnnotationId = '';
  state.agentContext = null;
  if (!annotationId) state.activeAnnotationId = '';
  state.translation = null;
  state.translationLoading = false;
  state.translationGenerating = false;
  state.translationCompare = false;
  state.pendingTranslationGenerate = false;
  state.readerZhMode = false;
  const readerEl = $('#reader');
  if (readerEl) readerEl.classList.remove('reader--zh-view');
  // 思考笔记：切文先落盘上一篇未保存内容，再重置视图态
  if (typeof flushThinkingNoteSave === 'function') flushThinkingNoteSave();
  state.thinkingNote = null;
  state.thinkingNoteLoading = false;
  state.readerNoteMode = false;
  state.noteReturnZh = false;
  if (readerEl) readerEl.classList.remove('reader--note-view');
  state.rewrite = null;
  state.rewriteLoading = false;
  state.rewriteGenerating = false;
  state.pendingRewriteGenerate = false;
  state.readerFocus = requestedFocus;
  state.readerAssetId = requestedAssetId;
  state.readerAssetsExpanded = false;
  state.readerTocAvailable = false;
  state.pendingAssetJump = requestedFocus === 'annotations' && annotationId ? null : requestedFocus;
  state.pendingCommentId = commentId || '';
  state.pendingAnnotationId = annotationId || '';
  state.pendingChatMessageId = chatMessageId || '';
  renderReaderStatsUi();
  if (requestedFocus === 'chat') {
    setContextPanel('agent', { expand: true });
  } else if (isCompactViewport()) {
    setAgentCollapsed(true);
  }
  state.fetchingOriginal = false;
  renderReaderAssets(e);
  renderReaderAssetSummary(e);
  updateFetchOriginalButton(e);
  setReaderTab(requestedTab, { syncUrl: false });
  if (isZenPersonalMode()) {
    // 纯阅读：不拉改写/划线/评论/AI
    state.rewrite = null;
    state.annotations = [];
    state.comments = [];
    state.agentMessages = [];
  } else {
    // 译文默认贴中文在正文就绪后 await ensureDefaultZhView；此处不抢先 loadTranslation 以免被原文覆盖
    loadRewrite(e);
    loadAnnotations(e);
    loadComments(e);
    loadAgentMessages(e);
  }
  if (updateUrl) syncReaderUrl({ replace: replaceUrl, commentId, annotationId, chatMessageId });

  $('#reader-audio').innerHTML = e.audio ? `<audio controls preload="none" src="${escapeHtml(e.audio.url)}"></audio>` : '';
  $('#reader-pane').scrollTop = 0;
  document.getElementById('app').classList.add('reading');
  normalizeReaderWorkbenchLayout();
  // Zen：列宽由 CSS 固定像素，开文/切博客绝不写 --entry-width，避免中栏缩放感
  if (isZenPersonalMode()) {
    $('#app')?.style.removeProperty('--entry-width');
    $('#app')?.style.removeProperty('--agent-width');
  } else {
    if (state.entryPaneWidth) setEntryPaneWidth(state.entryPaneWidth, { persist: false });
    if (state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
  }
  applyReaderPrefs();
  renderAgent();

  renderEntryStateUi();

  // 不管怎么样：有永久译文就默认简中。正文与译文并行拉取，避免「先英文再闪中文」
  const likelyHasZh = Boolean(
    (e.assets && e.assets.translation)
    || String(e.titleZh || '').trim()
    || String(e.summaryZh || '').trim()
    || e.sourceId === 'zen-recent'
    || (typeof sourceById === 'function' && sourceById(e.sourceId)?.contentKind === 'syllabus')
    || (typeof rememberedTranslation === 'function' && rememberedTranslation(e.id))
    || (typeof getEntryZhViewPref === 'function' && getEntryZhViewPref(e.id) === true)
  );
  const zhPrefetch = (typeof fetchTranslationCache === 'function')
    ? fetchTranslationCache(e).catch(() => (
      typeof rememberedTranslation === 'function' ? rememberedTranslation(e.id) : null
    ))
    : Promise.resolve(
      typeof rememberedTranslation === 'function' ? rememberedTranslation(e.id) : null
    );

  // content is loaded lazily — the list API omits it to stay lightweight
  let content = e.content || contentCache.get(e.id);
  if (!content) {
    $('#reader-content').innerHTML = likelyHasZh
      ? '<p style="color:var(--text-2)">加载简中译文…</p>'
      : '<p style="color:var(--text-2)">加载内容中…</p>';
    try {
      const data = await api(`/api/entry/${e.id}`);
      if (openGen !== state.openGen || state.activeEntry?.id !== e.id) return;
      if (data.entry) {
        state.activeEntry = { ...state.activeEntry, ...data.entry };
        // 回写目录瘦字段，不把全文塞进 allEntries
        patchCatalogEntry(e.id, {
          title: data.entry.title,
          titleZh: data.entry.titleZh,
          summary: data.entry.summary && String(data.entry.summary).slice(0, 160),
          summaryZh: data.entry.summaryZh && String(data.entry.summaryZh).slice(0, 160),
          image: data.entry.image,
        });
      }
      content = data.entry && data.entry.content;
      contentCache.set(e.id, content || '');
    } catch { /* fall through to summary */ }
    if (openGen !== state.openGen || state.activeEntry?.id !== e.id) return;
  } else {
    contentCache.set(e.id, content);
  }

  const openEntry = state.activeEntry || e;
  // 等并行译文：有块就只贴简中，绝不先渲英文原文
  let preZh = null;
  try {
    preZh = await zhPrefetch;
  } catch {
    preZh = typeof rememberedTranslation === 'function' ? rememberedTranslation(openEntry.id) : null;
  }
  if (!preZh && typeof rememberedTranslation === 'function') {
    preZh = rememberedTranslation(openEntry.id);
  }
  const canShowZh = Boolean(
    preZh
    && (
      (typeof translationHasDisplayableZh === 'function' && translationHasDisplayableZh(preZh))
      || (typeof translationHasContent === 'function' && translationHasContent(preZh))
    )
  );

  let appliedZh = false;
  if (canShowZh && typeof applyZhArticleView === 'function') {
    state.translation = preZh;
    try {
      appliedZh = Boolean(await applyZhArticleView(openEntry, preZh, { openGen }));
    } catch (err) {
      console.warn('openEntry applyZh failed', err);
      appliedZh = false;
    }
  }
  if (!appliedZh) {
    // 无缓存译文：先原文；ensureDefaultZhView 再试一次（含服务端）
    await renderOriginalContent(openEntry, content, { openGen });
  }
  if (openGen !== state.openGen || state.activeEntry?.id !== e.id) return;
  updateFetchOriginalButton(state.activeEntry || e);

  // 兜底：仍未简中则再走 ensure（复用已完成的 prefetch）
  if (!state.readerZhMode && typeof ensureDefaultZhView === 'function') {
    appliedZh = await ensureDefaultZhView(state.activeEntry || e, {
      openGen,
      prefetch: Promise.resolve(preZh),
    }) || appliedZh;
  }
  if (openGen !== state.openGen || state.activeEntry?.id !== e.id) return;

  // 三保险：内存/state 有译文却仍英文 → 强制贴
  if (!state.readerZhMode && typeof applyZhArticleView === 'function') {
    const fallback = (
      (typeof translationHasContent === 'function' && translationHasContent(state.translation))
        ? state.translation
        : null
    ) || (typeof rememberedTranslation === 'function' ? rememberedTranslation(openEntry.id) : null) || preZh;
    if (fallback && (typeof translationHasContent !== 'function' || translationHasContent(fallback))) {
      try {
        appliedZh = Boolean(await applyZhArticleView(state.activeEntry || e, fallback, { openGen })) || appliedZh;
      } catch (err) {
        console.warn('force zh fallback failed', err);
      }
    }
  }

  if (typeof updateReaderTranslateButton === 'function') {
    updateReaderTranslateButton(state.activeEntry || e);
  }
  // 思考笔记：预取存量笔记（按钮态 has-note 指示）
  if (typeof loadThinkingNote === 'function') loadThinkingNote(state.activeEntry || e);
  // 共性：RSS 只有摘要/跟踪像素时，打开详情自动补抓全文（不阻塞首屏摘要展示）
  // 已在简中视图时勿用原文抓取结果盖掉译文
  if (
    state.activeEntry?.id === e.id
    && !state.readerZhMode
    && !appliedZh
    && shouldAutoFetchOriginalOnOpen(state.activeEntry || e)
    && !state.fetchingOriginal
  ) {
    fetchOriginalContent().catch(() => {});
  }
}

function closeReaderFromRoute({ rerenderList = true } = {}) {
  setWorkspacePage('');
  if (typeof disposeSocialGalleryPerf === 'function') disposeSocialGalleryPerf();
  state.activeEntry = null;
  state.agentMessages = [];
  state.comments = [];
  state.annotations = [];
  state.annotationDraft = null;
  state.translation = null;
  state.translationLoading = false;
  state.translationGenerating = false;
  state.translationCompare = false;
  state.pendingTranslationGenerate = false;
  state.readerZhMode = false;
  if (typeof flushThinkingNoteSave === 'function') flushThinkingNoteSave();
  state.thinkingNote = null;
  state.readerNoteMode = false;
  state.noteReturnZh = false;
  state.rewrite = null;
  state.rewriteLoading = false;
  state.rewriteGenerating = false;
  state.pendingRewriteGenerate = false;
  state.readerFocus = null;
  state.readerAssetId = '';
  state.readerAssetsExpanded = false;
  state.readerTocAvailable = false;
  state.pendingAssetJump = null;
  state.pendingCommentId = '';
  state.pendingAnnotationId = '';
  state.pendingChatMessageId = '';
  state.fetchingOriginal = false;
  state.readerTab = 'original';
  const readerEl = $('#reader');
  if (readerEl) {
    readerEl.classList.add('hidden');
    readerEl.classList.remove(
      'reader--social', 'reader--xhs', 'reader--x', 'reader--bili',
      'reader--syllabus', 'reader--zh-view', 'reader--note-view',
    );
  }
  $('#reader-empty').classList.remove('hidden');
  renderAdminEntryControls();
  document.getElementById('app').classList.remove('reading');
  applyReaderPrefs();
  document.title = 'QMReader · RSS 阅读器';
  if (rerenderList) renderList();
  renderAgent();
}

function findEntryInCatalog(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const lists = [state.entries, state.allEntries];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const exact = list.find(item => item && item.id === id);
    if (exact) return exact;
  }
  // URL 深链常用 12 位 shortId；全量 id 在 catalog 里
  if (id.length >= 6 && id.length < 32) {
    const hits = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && item.id && item.id.startsWith(id)) hits.push(item);
        if (hits.length > 1) break;
      }
      if (hits.length > 1) break;
    }
    if (hits.length === 1) return hits[0];
  }
  return null;
}

async function openEntryById(entryId, { tab = null, focus = null, aiAssetId = '', commentId = '', annotationId = '', chatMessageId = '', updateUrl = false, replaceUrl = true } = {}) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  // 深链开文前先保证左侧博客树已画，避免只见正文不见源列表
  if (!state.sidebarBuilt) renderSidebar();
  let entry = findEntryInCatalog(id);
  if (!entry) {
    try {
      const data = await api(`/api/entry/${encodeURIComponent(id)}`);
      entry = data.entry;
    } catch (err) {
      // 硬刷新竞态：catalog/API 尚未就绪时再拉一次目录后重试
      const msg = String(err && err.message || '');
      if (/not found|404/i.test(msg)) {
        try { await loadEntries({ background: false }); } catch { /* ignore */ }
        entry = findEntryInCatalog(id);
        if (!entry) {
          try {
            const data = await api(`/api/entry/${encodeURIComponent(id)}`);
            entry = data.entry;
          } catch { /* keep null */ }
        }
      } else {
        throw err;
      }
    }
  }
  if (!entry) return false;
  await openEntry(entry, { tab, focus, aiAssetId, commentId, annotationId, chatMessageId, updateUrl, replaceUrl });
  return true;
}

async function openEntryFromUrl({ reuseLoadedCollections = false } = {}) {
  const route = routeStateFromUrl();
  if (route.admin) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    const opened = await openAdminPage({ push: false });
    if (!opened) setWorkspacePage('');
    return true;
  }
  if (route.dashboard) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    const opened = await openMyCommentsModal({ push: false, tab: route.dashboardTab });
    if (!opened) setWorkspacePage('');
    return true;
  }
  if (route.contributorId) {
    state.view = 'all';
    state.filterSource = null;
    state.filterCategory = null;
    state.assetFilter = null;
    state.assetSort = 'latest';
    state.contributorSort = 'latest';
    state.q = '';
    updateListTitle();
    renderSidebar();
    state.activeEntry = null;
    setWorkspacePage('');
    await openContributor(route.contributorId, { push: false, sort: route.contributorAssetSort, tab: route.contributorAssetType });
    return true;
  }
  setWorkspacePage('');
  if (!route.entryId) {
    if (route.view === 'contributors') {
      state.view = 'contributors';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = null;
      state.assetSort = 'latest';
      state.contributorSort = route.contributorSort;
      state.q = route.q;
    } else if (route.view === 'assets') {
      state.view = 'assets';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = route.assetFilter;
      state.assetSort = route.assetSort;
      state.contributorSort = 'latest';
      state.q = route.q;
    } else {
      // 无深链时保持默认最新（与 state 初值一致）
      state.view = 'all';
      state.filterSource = null;
      state.filterCategory = null;
      state.assetFilter = null;
      state.assetSort = 'latest';
      state.contributorSort = 'latest';
      state.q = '';
    }
    if (!reuseLoadedCollections) {
      await Promise.all([loadEntries(), loadContributors()]);
    } else if (route.contributorSort !== 'latest') {
      await loadContributors();
    }
    updateListTitle();
    renderList();
    renderSidebar();
    closeReaderFromRoute({ rerenderList: false });
    if (route.view === 'assets' || route.view === 'contributors') document.title = listRouteTitle();
    return false;
  }
  try {
    const ok = await openEntryById(route.entryId, {
      tab: route.tab,
      focus: route.focus,
      aiAssetId: route.assetId,
      commentId: route.commentId,
      annotationId: route.annotationId,
      chatMessageId: route.chatMessageId,
      updateUrl: false,
    });
    if (ok) return true;
    // 未抛错但没打开：再等目录一轮（硬刷新并行 load 未写完 allEntries）
    if (!reuseLoadedCollections || !(state.allEntries && state.allEntries.length)) {
      await loadEntries().catch(() => null);
    }
    const retry = await openEntryById(route.entryId, {
      tab: route.tab,
      focus: route.focus,
      aiAssetId: route.assetId,
      commentId: route.commentId,
      annotationId: route.annotationId,
      chatMessageId: route.chatMessageId,
      updateUrl: false,
    });
    if (retry) return true;
    toast('找不到这篇文章', 4000);
    closeReaderFromRoute({ rerenderList: false });
    clearReaderUrl({ replace: true });
    return false;
  } catch (err) {
    toast('找不到这篇文章: ' + err.message, 4000);
    closeReaderFromRoute({ rerenderList: false });
    clearReaderUrl({ replace: true });
    return false;
  }
}

/* ---------- Navigation ---------- */

function closeReaderChrome({ clearUrl = true } = {}) {
  const wasReading = Boolean(state.activeEntry) || document.getElementById('app')?.classList.contains('reading');
  setWorkspacePage('');
  state.activeEntry = null;
  state.agentMessages = [];
  state.comments = [];
  state.annotations = [];
  state.annotationDraft = null;
  state.translation = null;
  state.translationLoading = false;
  state.translationGenerating = false;
  state.translationCompare = false;
  state.pendingTranslationGenerate = false;
  state.readerZhMode = false;
  $('#reader')?.classList.remove('reader--zh-view');
  if (typeof flushThinkingNoteSave === 'function') flushThinkingNoteSave();
  state.thinkingNote = null;
  state.readerNoteMode = false;
  state.noteReturnZh = false;
  $('#reader')?.classList.remove('reader--note-view');
  state.rewrite = null;
  state.rewriteLoading = false;
  state.rewriteGenerating = false;
  state.pendingRewriteGenerate = false;
  state.readerFocus = null;
  state.readerAssetId = '';
  state.readerAssetsExpanded = false;
  state.readerTocAvailable = false;
  state.pendingAssetJump = null;
  state.pendingAnnotationId = '';
  state.fetchingOriginal = false;
  state.readerTab = 'original';
  const readerEl = $('#reader');
  if (readerEl) {
    readerEl.classList.add('hidden');
    readerEl.classList.remove(
      'reader--social', 'reader--xhs', 'reader--x', 'reader--bili',
      'reader--syllabus', 'reader--zh-view', 'reader--note-view',
    );
  }
  $('#reader-empty')?.classList.remove('hidden');
  document.getElementById('app')?.classList.remove('reading');
  if (clearUrl) clearReaderUrl({ replace: true });
  // 未在阅读时跳过 agent 重绘，连点切源省下大块主线程
  if (wasReading) renderAgent();
}

/**
 * 同步 paint（单帧内只应跑一次；连点走 schedulePaintEntryScope）
 * @param {{ keepReader?: boolean, clearUrl?: boolean, fullSidebar?: boolean, fastBatch?: boolean }} opts
 */
function paintEntryScopeNow({
  keepReader = false,
  clearUrl = true,
  fullSidebar = false,
  fastBatch = false,
} = {}) {
  applyLocalEntryFilter({ fastBatch });
  updateListTitle();
  // 切源回到列表顶，避免旧 scrollTop 套到新列表上错位
  const listEl = $('#entry-list');
  if (listEl) listEl.scrollTop = 0;
  // 先关阅读再画列表：未读视图下「离开正文」后当前篇才会从列表消失
  if (!keepReader) closeReaderChrome({ clearUrl });
  renderList();
  if (fullSidebar || !state.sidebarBuilt) renderSidebar();
  else updateSidebarSelection();
}

/** 合并同帧/连帧的切源 paint，只保留最后一次 */
function schedulePaintEntryScope(opts = {}) {
  const next = {
    keepReader: false,
    clearUrl: true,
    fullSidebar: false,
    fastBatch: true,
    ...opts,
  };
  // 后一次覆盖前一次；任一要求 fullSidebar 则保留
  if (state.paintPending) {
    next.fullSidebar = next.fullSidebar || state.paintPending.fullSidebar;
    next.keepReader = next.keepReader && state.paintPending.keepReader;
  }
  state.paintPending = next;
  state.paintGen += 1;
  const gen = state.paintGen;
  if (state.paintRaf) return;
  state.paintRaf = requestAnimationFrame(() => {
    state.paintRaf = 0;
    if (gen !== state.paintGen) return;
    const pending = state.paintPending || {};
    state.paintPending = null;
    paintEntryScopeNow(pending);
  });
}

/** 兼容旧调用：默认同帧合并 */
function paintEntryScope(opts = {}) {
  schedulePaintEntryScope(opts);
}

async function reload({ keepReader = false, clearUrl = true, contributors = false } = {}) {
  const tasks = [loadEntries()];
  // 切源不需要贡献榜；仅显式要求或贡献者视图时拉取
  if (contributors || state.view === 'contributors') tasks.push(loadContributors());
  await Promise.all(tasks);
  // reload 后需要完整侧栏（计数可能变）
  paintEntryScopeNow({ keepReader, clearUrl, fullSidebar: true, fastBatch: false });
}

/** 后台静默刷新目录（不打断当前列表） */
function softRefreshEntries({ maxAgeMs = 60_000 } = {}) {
  if (state.entriesLoadedAt && Date.now() - state.entriesLoadedAt < maxAgeMs) return;
  const genAtStart = state.paintGen;
  loadEntries({ background: true })
    .then(() => {
      // 用户仍在连点切源时，只更新索引与计数，不抢列表 DOM
      if (genAtStart !== state.paintGen) {
        updateSidebarNavCounts();
        return;
      }
      applyLocalEntryFilter({ fastBatch: false });
      updateListTitle();
      renderList();
      updateSidebarNavCounts();
      updateSidebarSelection();
    })
    .catch(() => {});
}

/** 停留在 X/小红书收藏时：周期看 entryCount，变了就扫盘 merge（配合后端 20s poll） */
const LOCAL_LIKES_POLL_MS = 20_000;
let localLikesPollTimer = null;
let localLikesLastCounts = new Map();

function ensureLocalLikesPoll() {
  if (localLikesPollTimer) return;
  localLikesPollTimer = setInterval(() => {
    tickLocalLikesPoll().catch(() => {});
  }, LOCAL_LIKES_POLL_MS);
  if (typeof localLikesPollTimer.unref === 'function') localLikesPollTimer.unref();
}

function isStaticCatalogSource(id) {
  const src = sourceById(id);
  return Boolean(
    src
    && (
      src.excludeFromAll
      || src.id === 'zen-recent'
      || src.contentKind === 'syllabus'
    ),
  );
}

async function tickLocalLikesPoll() {
  const id = state.filterSource;
  if (!id || !isLocalOnlySource(id)) return;
  // 静态课程库：不走收藏流轮询
  if (isStaticCatalogSource(id)) return;
  // 后端轻量扫盘（指纹未变则 skip）
  try {
    const res = await fetch(`/api/sources/${encodeURIComponent(id)}/refresh-hint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'local-likes-poll' }),
      keepalive: true,
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const refresh = data && data.refresh;
      if (refresh && refresh.local && !refresh.skipped) {
        await mergeSourceEntries(id, { keepReader: true });
        await loadSources().catch(() => null);
        return;
      }
    }
  } catch { /* ignore */ }
  // 即使 skip，也对比 entryCount（后端 poll 可能已灌 cache）
  const data = await loadSources().catch(() => null);
  if (!data) return;
  const src = sourceById(id);
  const count = src ? (Number(src.entryCount) || 0) : 0;
  const prev = localLikesLastCounts.get(id);
  localLikesLastCounts.set(id, count);
  if (prev != null && prev !== count) {
    await mergeSourceEntries(id, { keepReader: true }).catch(() => {});
  }
}

function selectSource(id) {
  // 保留最新/未读/热门列表模式；仅从资产/收藏等特殊视图退回时用最新默认
  if (!['all', 'unread', 'hot'].includes(state.view)) {
    state.view = 'all';
  }
  const nextSource = state.filterSource === id ? null : id;
  state.filterSource = nextSource;
  state.filterCategory = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  // 选中分组内子源时展开该组（不覆盖用户之后的手动折叠）
  if (nextSource && typeof ensureTreeOpenForSource === 'function') {
    ensureTreeOpenForSource(nextSource);
  }
  // 有全量目录时本地 filter，rAF 合并连点
  if (state.allEntries.length) {
    schedulePaintEntryScope({ fastBatch: true, fullSidebar: false });
    if (nextSource && isLocalOnlySource(nextSource) && !isStaticCatalogSource(nextSource)) {
      // Typora 抓到新收藏后：扫盘 → merge 本源目录（关键路径）
      hintLocalLikesSync(nextSource);
      softRefreshEntries({ maxAgeMs: 15_000 });
    } else if (nextSource && isStaticCatalogSource(nextSource)) {
      // 课程库：只补齐本地目录，不 likes 轮询、不 source refresh-hint
      const localN = (state.entriesBySource.get(nextSource) || []).length;
      const expectN = Number(sourceById(nextSource)?.entryCount) || 0;
      if (expectN > localN) {
        mergeSourceEntries(nextSource, { keepReader: true }).catch(() => {});
      }
    } else if (nextSource) {
      const localN = (state.entriesBySource.get(nextSource) || []).length;
      const expectN = Number(sourceById(nextSource)?.entryCount) || 0;
      // 本地目录明显少于服务端计数时，按源 merge 补齐（避免侧栏 13、列表只有 2）
      if (expectN > localN) {
        mergeSourceEntries(nextSource, { keepReader: true }).catch(() => {});
      }
      hintSourceRefresh(nextSource, 'source-select');
      softRefreshEntries({ maxAgeMs: 300_000 });
    } else {
      softRefreshEntries({ maxAgeMs: 300_000 });
    }
    ensureLocalLikesPoll();
    return;
  }
  if (nextSource && isLocalOnlySource(nextSource) && !isStaticCatalogSource(nextSource)) {
    hintLocalLikesSync(nextSource);
  } else if (nextSource && !isStaticCatalogSource(nextSource)) {
    hintSourceRefresh(nextSource, 'source-select');
  }
  ensureLocalLikesPoll();
  reload();
}
function selectCategory(cat) {
  if (!['all', 'unread', 'hot'].includes(state.view)) {
    state.view = 'all';
  }
  state.filterCategory = state.filterCategory === cat ? null : cat;
  state.filterSource = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  if (state.allEntries.length) {
    schedulePaintEntryScope({ fastBatch: true });
    softRefreshEntries({ maxAgeMs: 300_000 });
    return;
  }
  reload();
}
function selectView(v) {
  state.view = v;
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.readerFocus = null;
  state.readerAssetId = '';
  if (v !== 'assets') state.assetSort = 'latest';
  if (v !== 'contributors') state.contributorSort = 'latest';
  if (v === 'contributors') {
    syncListUrl();
    reload({ clearUrl: false, contributors: true });
    return;
  }
  if (v === 'assets') {
    syncListUrl();
    if (state.allEntries.length) {
      schedulePaintEntryScope({ clearUrl: false, fastBatch: false, fullSidebar: false });
      softRefreshEntries({ maxAgeMs: 300_000 });
      return;
    }
    reload({ clearUrl: false });
    return;
  }
  if (state.allEntries.length) {
    schedulePaintEntryScope({ fastBatch: true });
    return;
  }
  reload();
}

function goHomeAll() {
  // 首页默认最新（与启动态一致）
  state.view = 'all';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  state.homeTab = 'entries';
  state.q = '';
  state.readerFocus = null;
  state.readerAssetId = '';
  const search = $('#search');
  if (search) search.value = '';
  if (state.allEntries.length) {
    schedulePaintEntryScope({ fastBatch: true });
    return;
  }
  reload();
}

function selectAssetFilter(type = null) {
  state.view = 'assets';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = type && ASSET_FILTERS[type] ? type : null;
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

function selectAssetSort(sort = 'latest') {
  state.view = 'assets';
  state.assetSort = sort === 'helpful' ? 'helpful' : 'latest';
  state.filterSource = null;
  state.filterCategory = null;
  state.contributorSort = 'latest';
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

function selectContributorSort(sort = 'latest') {
  state.view = 'contributors';
  state.contributorSort = normalizeContributorSort(sort);
  state.assetSort = 'latest';
  state.filterSource = null;
  state.filterCategory = null;
  state.assetFilter = null;
  state.readerFocus = null;
  state.readerAssetId = '';
  syncListUrl();
  reload({ clearUrl: false });
}

/* ---------- Refresh ---------- */
async function refreshAll() {
  const buttons = ['#refresh-btn', '#profile-refresh-btn', '#admin-refresh-btn']
    .map(selector => $(selector))
    .filter(Boolean);
  const setButtons = (label, disabled = true) => {
    buttons.forEach(btn => {
      btn.disabled = disabled;
      setButtonIconLabel(btn, disabled ? 'loader-circle' : 'refresh-cw', label, {
        className: disabled ? 'app-icon app-icon-spin' : 'app-icon',
      });
    });
  };
  setButtons('刷新中…', true);
  try {
    await api('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // poll until done
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const data = await loadSources();
      setButtons(data.refreshing ? `${data.progress.done}/${data.progress.total}` : '刷新全部', Boolean(data.refreshing));
      if (!data.refreshing) break;
    }
    await reload({ keepReader: true });
    if (!$('#manage-modal')?.classList.contains('hidden')) renderManage();
    if (state.workspacePage === 'admin') renderAdminPage();
    toast('刷新完成');
  } catch (e) {
    toast('刷新失败: ' + e.message);
  } finally {
    setButtons('刷新全部', false);
  }
}

async function refreshCurrentSource() {
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  if (!source) return;

  const btn = $('#source-refresh-btn');
  btn.disabled = true;
  btn.classList.add('refreshing');
  setElementIcon(btn, 'loader-circle', { className: 'app-icon app-icon-spin' });
  setSourceRefreshStatus('正在检查', 'loading');
  toast(`正在检查 ${source.name} 更新…`, 2600);
  try {
    const beforeEntries = await sourceEntriesSnapshot(source.id).catch(() => []);
    const result = await api('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: source.id }),
    });
    // 本地 Typora 源：后端已同步扫盘，直接 merge，不必等 worker
    if (result && result.local) {
      await loadSources().catch(() => null);
      await mergeSourceEntries(source.id, { keepReader: true }).catch(() => reload({ keepReader: true }));
      const afterEntries = await sourceEntriesSnapshot(source.id).catch(() => []);
      const added = newEntryCount(beforeEntries, afterEntries);
      const doneMessage = added ? `${source.name} 新增 ${added} 篇` : `${source.name} 暂无更新`;
      setSourceRefreshStatus(added ? `新增 ${added} 篇` : '暂无更新', added ? 'success' : 'muted', { timeout: 5200 });
      toast(doneMessage);
      return;
    }
    state.refreshing = Boolean(result.running || result.started);
    state.refreshProgress = result.progress || { done: 0, total: 1, sourceId: source.id };
    renderSourceRefreshButton();
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const data = await loadSources();
      if (!data.refreshing) break;
    }
    const latestSource = sourceById(source.id);
    if (latestSource && latestSource.status === 'error') {
      throw new Error(latestSource.error || '信息源刷新失败');
    }
    const afterEntries = await sourceEntriesSnapshot(source.id).catch(() => []);
    const added = newEntryCount(beforeEntries, afterEntries);
    await reload({ keepReader: true });
    const doneMessage = added ? `${source.name} 新增 ${added} 篇` : `${source.name} 暂无更新`;
    setSourceRefreshStatus(added ? `新增 ${added} 篇` : '暂无更新', added ? 'success' : 'muted', { timeout: 5200 });
    toast(doneMessage);
  } catch (e) {
    setSourceRefreshStatus('检查失败', 'error', { timeout: 5200 });
    toast('刷新失败: ' + e.message, 5000);
  } finally {
    renderSourceRefreshButton();
  }
}

/* ---------- Manage modal ---------- */
function sourceName(id) {
  const source = state.sources.find(item => item.id === id);
  return source ? source.name : id;
}

function manageStatusLine() {
  const total = state.sources.length;
  const enabled = state.sources.filter(source => source.enabled).length;
  const ok = state.sources.filter(source => source.enabled && source.status === 'ok').length;
  const errors = state.sources.filter(source => source.enabled && source.status === 'error').length;
  return { total, enabled, ok, errors };
}

function opsStatusText(value) {
  const text = String(value || '').trim();
  if (text === 'AI not configured') return '站点 API Key 未配置';
  if (text === 'already running') return '已有任务运行中';
  if (text === 'no sources configured') return '未配置重点源';
  return text;
}

function autoRewriteStatusParts() {
  const auto = state.autoRewrite || {};
  const last = auto.last || {};
  const running = Boolean(auto.running || last.running);
  const failed = [
    ...(last.error ? [{ title: '自动重写任务', error: last.error }] : []),
    ...(Array.isArray(last.failed) ? last.failed : []),
  ];
  if (running) {
    return {
      label: '自动重写中',
      value: '后台运行',
      meta: (last.sourceIds || []).map(sourceName).join('、') || '重点源',
      failed,
    };
  }
  if (!last.startedAt) {
    return { label: '自动重写', value: '待命', meta: '刷新后处理重点源', failed };
  }
  const value = last.error
    ? opsStatusText(last.error)
    : last.skipped
    ? opsStatusText(last.skipped)
    : `${Number(last.rewritten) || 0} 新 · ${Number(last.cached) || 0} 缓存 · ${failed.length} 失败`;
  return {
    label: '自动重写完成',
    value,
    meta: [formatAssetTime(last.finishedAt || last.startedAt), (last.sourceIds || []).map(sourceName).join('、')].filter(Boolean).join(' · '),
    failed,
  };
}

function renderManageStatus(target = '#manage-status') {
  const el = $(target);
  if (!el) return;
  const actionId = el.id === 'admin-manage-status' ? 'admin-auto-rewrite' : 'manage-auto-rewrite';
  const counts = manageStatusLine();
  const progress = state.refreshProgress || { done: 0, total: 0 };
  const refreshValue = state.refreshing
    ? `${progress.done || 0}/${progress.total || counts.enabled}`
    : progress.total ? `完成 ${progress.done || 0}/${progress.total}` : '待刷新';
  const refreshMeta = state.refreshing ? '刷新中' : '最近刷新状态';
  const rewrite = autoRewriteStatusParts();
  const failures = rewrite.failed.slice(0, 3);
  el.innerHTML = `
    <div class="manage-status-grid">
      <div class="manage-status-item">
        <span>订阅源</span>
        <strong>${counts.enabled}/${counts.total}</strong>
        <em>${counts.ok} 正常${counts.errors ? ` · ${counts.errors} 失败` : ''}</em>
      </div>
      <div class="manage-status-item ${state.refreshing ? 'active' : ''}">
        <span>抓取刷新</span>
        <strong>${escapeHtml(refreshValue)}</strong>
        <em>${escapeHtml(refreshMeta)}</em>
      </div>
      <div class="manage-status-item ${state.autoRewrite?.running ? 'active' : failures.length ? 'error' : ''}">
        <span>${escapeHtml(rewrite.label)}</span>
        <div class="manage-status-action-row">
          <strong>${escapeHtml(rewrite.value)}</strong>
          <button id="${actionId}" class="manage-status-action" type="button" ${state.autoRewrite?.running ? 'disabled' : ''}>运行</button>
        </div>
        <em title="${escapeHtml(rewrite.meta)}">${escapeHtml(rewrite.meta || '无运行记录')}</em>
      </div>
    </div>
    ${failures.length ? `<div class="manage-status-failures">${failures.map(item => `
      <div><strong>${escapeHtml(item.title || item.entryId || '未命名文章')}</strong><span>${escapeHtml(opsStatusText(item.error) || '未知错误')}</span></div>
    `).join('')}</div>` : ''}`;
  const runBtn = $(`#${actionId}`);
  if (runBtn) runBtn.onclick = runAutoRewriteFromManage;
}

async function runAutoRewriteFromManage() {
  if (!isAdmin()) {
    toast('需要管理员权限');
    return;
  }
  const btn = $('#manage-auto-rewrite') || $('#admin-auto-rewrite');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '运行中';
  }
  try {
    await api('/api/auto-rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    toast('自动重写已启动');
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const data = await loadSources();
      renderManageStatus();
      if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
      if (!data.autoRewrite?.running) break;
    }
    await reload({ keepReader: true });
    renderManage();
    if (state.workspacePage === 'admin') renderAdminPage();
  } catch (error) {
    toast('启动自动重写失败: ' + error.message, 5000);
    await loadSources().catch(() => null);
    renderManageStatus();
    if (state.workspacePage === 'admin') renderManageStatus('#admin-manage-status');
  }
}

function renderManage(target = '#manage-list', statusTarget = '#manage-status') {
  renderManageStatus(statusTarget);
  const el = $(target);
  if (!el) return;
  el.innerHTML = '';
  const sorted = [...state.sources].sort((a, b) => (b.enabled - a.enabled) || a.category.localeCompare(b.category));
  for (const s of sorted) {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const statusTxt = s.enabled
      ? (s.status === 'ok' ? `${s.entryCount} 篇` : s.status === 'error' ? '抓取失败' : s.status === 'stale' ? '缓存' : '待抓取')
      : '已禁用';
    row.innerHTML = `
      ${sourceFaviconHtml(s)}
      <div class="m-info">
        <div class="m-name">${escapeHtml(s.name)} <span style="font-weight:400;color:var(--text-2);font-size:11px">${CATEGORY_LABELS[s.category]}</span></div>
        ${s.note || s.description ? `<div class="m-note">${escapeHtml(s.note || s.description)}</div>` : ''}
      </div>
      <span class="m-status ${s.status === 'error' ? 'error' : s.status === 'ok' ? 'ok' : ''}">${statusTxt}</span>
      <button class="switch ${s.enabled ? 'on' : ''}" title="${s.enabled ? '点击禁用' : '点击启用'}"></button>`;
    row.querySelector('.switch').onclick = async (ev) => {
      ev.stopPropagation();
      const r = await api(`/api/sources/${s.id}/toggle`, { method: 'POST' });
      s.enabled = r.enabled;
      toast(`${s.name} ${r.enabled ? '已启用（抓取中…）' : '已禁用'}`);
      renderManage(target, statusTarget);
      setTimeout(async () => {
        await loadSources();
        renderManage(target, statusTarget);
        reload({ keepReader: true });
      }, r.enabled ? 4000 : 0);
    };
    el.appendChild(row);
  }
}

function renderAdminPage() {
  if (!isAdmin()) return;
  renderManage('#admin-manage-list', '#admin-manage-status');
  renderAdminSubmissionManager();
  renderAdminSubmissionRequests();
  if (!state.adminSubmissionRequestsLoaded) {
    loadAdminSubmissionRequests().catch(error => toast('加载待审核投稿失败: ' + error.message, 5000));
  }
  if (!state.adminSubmissionUsersLoaded && !state.adminSubmissionLoading) {
    loadAdminSubmissionUsers().catch(error => toast('加载用户管理失败: ' + error.message, 5000));
  }
  const refreshBtn = $('#admin-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = Boolean(state.refreshing);
    setButtonIconLabel(refreshBtn, state.refreshing ? 'loader-circle' : 'refresh-cw', state.refreshing ? '刷新中…' : '刷新全部', {
      className: state.refreshing ? 'app-icon app-icon-spin' : 'app-icon',
    });
  }
}

function renderAdminSubmissionRequests() {
  const el = $('#admin-submission-requests');
  if (!el) return;
  const requests = Array.isArray(state.adminSubmissionRequests) ? state.adminSubmissionRequests : [];
  el.innerHTML = requests.length ? requests.map(request => `
    <article class="admin-review-item" role="listitem" data-submission-request-id="${escapeHtml(request.id)}">
      <div class="admin-review-copy">
        <strong>${escapeHtml(request.displayName || request.author || request.email || '用户')}</strong>
        <span>${escapeHtml(request.email || '')} · ${escapeHtml(formatAssetTime(request.createdAt))}</span>
        <a href="${escapeHtml(request.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(request.url)}</a>
        ${request.note ? `<p>${escapeHtml(request.note)}</p>` : ''}
      </div>
      <div class="admin-review-actions">
        <button class="ghost-btn primary" type="button" data-review-action="approve">审核并收录</button>
        <button class="ghost-btn danger" type="button" data-review-action="reject">拒绝</button>
      </div>
    </article>`).join('') : '<div class="admin-submission-empty">暂无待审核投稿</div>';
}

async function loadAdminSubmissionRequests() {
  if (!isAdmin()) return;
  const data = await api('/api/admin/submission-requests?status=pending&limit=200');
  state.adminSubmissionRequests = data.requests || [];
  state.adminSubmissionRequestsLoaded = true;
  renderAdminSubmissionRequests();
}

async function reviewAdminSubmissionRequest(requestId, action) {
  const request = state.adminSubmissionRequests.find(item => item.id === requestId);
  if (!request) return;
  if (action === 'approve') {
    const ok = await showConfirmDialog({
      title: '审核并收录',
      message: `确认访问并抓取 ${request.url}？只有此操作会让服务器访问目标站。`,
      confirmText: '审核并收录',
    });
    if (!ok) return;
    await api(`/api/admin/submission-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST' });
    toast('投稿已审核通过并收录');
  } else {
    await api(`/api/admin/submission-requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '不符合收录要求' }),
    });
    toast('投稿已拒绝');
  }
  await loadAdminSubmissionRequests();
  await Promise.all([loadSources(), loadEntries()]);
  renderSidebar();
  renderList();
}

function adminSubmissionUserById(userId) {
  return state.adminSubmissionUsers.find(item => item.userId === userId) || null;
}

function adminSubmissionCountLabel(user) {
  const active = Number(user && user.activeSubmissionCount) || 0;
  const deleted = Number(user && user.deletedSubmissionCount) || 0;
  return active ? `${active} 篇公开投稿` : (deleted ? `${deleted} 篇已清理` : '暂无投稿');
}

function renderAdminSubmissionManager() {
  const usersEl = $('#admin-submission-users');
  const detailEl = $('#admin-submission-detail');
  if (!usersEl || !detailEl) return;
  if (state.adminSubmissionLoading && !state.adminSubmissionUsersLoaded) {
    usersEl.innerHTML = '<div class="admin-submission-empty">正在加载用户…</div>';
  } else if (!state.adminSubmissionUsers.length) {
    usersEl.innerHTML = '<div class="admin-submission-empty">没有匹配用户</div>';
  } else {
    usersEl.innerHTML = state.adminSubmissionUsers.map(user => {
      const selected = user.userId === state.adminSelectedSubmissionUserId;
      return `<button class="admin-user-row ${selected ? 'active' : ''} ${user.disabled ? 'disabled' : ''}" type="button"
        role="listitem" data-admin-user-id="${escapeHtml(user.userId)}" aria-pressed="${selected ? 'true' : 'false'}">
        <span class="admin-user-avatar">${escapeHtml((user.displayName || user.email || '?').slice(0, 1).toUpperCase())}</span>
        <span class="admin-user-copy">
          <strong>${escapeHtml(user.displayName || '未命名用户')}</strong>
          <small>${escapeHtml(user.email || '')}</small>
        </span>
        <span class="admin-user-meta">
          <em class="admin-user-state ${user.disabled ? 'blocked' : ''}">${user.disabled ? '已封禁' : (user.role === 'admin' ? '管理员' : '正常')}</em>
          <small>${escapeHtml(adminSubmissionCountLabel(user))}</small>
        </span>
      </button>`;
    }).join('');
  }

  const detail = state.adminSubmissionDetail;
  if (state.adminSubmissionLoading && state.adminSelectedSubmissionUserId && !detail) {
    detailEl.innerHTML = '<div class="admin-submission-empty">正在加载投稿详情…</div>';
    return;
  }
  if (!detail || !detail.user) {
    detailEl.innerHTML = '<div class="admin-submission-empty">选择左侧用户查看投稿和处理账号</div>';
    return;
  }
  const user = detail.user;
  const isProtected = user.role === 'admin' || user.userId === state.me?.id;
  const submissions = Array.isArray(detail.submissions) ? detail.submissions : [];
  detailEl.innerHTML = `
    <div class="admin-user-detail-head">
      <div>
        <span class="admin-detail-kicker">${user.disabled ? '已封禁用户' : user.role === 'admin' ? '管理员账号' : '用户'}</span>
        <h3>${escapeHtml(user.displayName || '未命名用户')}</h3>
        <p>${escapeHtml(user.email || '')}</p>
      </div>
      <div class="admin-detail-counts">
        <strong>${Number(detail.activeSubmissionCount) || 0}</strong><span>公开</span>
        <strong>${Number(detail.deletedSubmissionCount) || 0}</strong><span>已清理</span>
      </div>
    </div>
    ${user.disabledReason ? `<div class="admin-moderation-note"><strong>封禁原因</strong><span>${escapeHtml(user.disabledReason)}</span></div>` : ''}
    <label class="admin-moderation-reason">
      <span>处理原因</span>
      <input id="admin-moderation-reason" maxlength="300" value="${escapeHtml(user.disabledReason || '')}" placeholder="例如：批量提交内网探测链接" />
    </label>
    <div class="admin-user-actions">
      <button id="admin-delete-user-submissions" class="ghost-btn" type="button" ${(Number(detail.activeSubmissionCount) || 0) ? '' : 'disabled'}>清理全部投稿</button>
      ${user.disabled
        ? `<button id="admin-restore-user" class="ghost-btn primary" type="button" ${isProtected ? 'disabled' : ''}>恢复账号</button>`
        : `<button id="admin-delete-user" class="ghost-btn danger" type="button" ${isProtected ? 'disabled' : ''}>删除违规用户</button>`}
    </div>
    ${isProtected ? '<p class="admin-protected-note">管理员账号受保护，不能在这里删除。</p>' : ''}
    <div class="admin-submission-records">
      ${submissions.length ? submissions.map(item => `
        <article class="admin-submission-record ${item.deletedAt ? 'deleted' : ''}">
          <div><strong>${escapeHtml(item.title || item.url || '未命名投稿')}</strong><span>${item.deletedAt ? '已清理' : '公开'} · ${escapeHtml(formatAssetTime(item.updatedAt || item.createdAt))}</span></div>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(compactUrlLabel(item.url))}</a>
        </article>
      `).join('') : '<div class="admin-submission-empty compact">该用户还没有投稿</div>'}
    </div>`;
  $('#admin-delete-user-submissions')?.addEventListener('click', deleteAdminUserSubmissions);
  $('#admin-delete-user')?.addEventListener('click', deleteAdminUser);
  $('#admin-restore-user')?.addEventListener('click', restoreAdminUser);
}

async function loadAdminSubmissionUsers(query = state.adminSubmissionQuery) {
  if (!isAdmin()) return;
  state.adminSubmissionQuery = String(query || '').trim();
  state.adminSubmissionLoading = true;
  renderAdminSubmissionManager();
  try {
    const params = new URLSearchParams({ limit: '500' });
    if (state.adminSubmissionQuery) params.set('q', state.adminSubmissionQuery);
    const data = await api(`/api/admin/users?${params}`);
    state.adminSubmissionUsers = data.users || [];
    state.adminSubmissionUsersLoaded = true;
    if (!state.adminSubmissionUsers.some(user => user.userId === state.adminSelectedSubmissionUserId)) {
      state.adminSelectedSubmissionUserId = state.adminSubmissionUsers[0]?.userId || '';
      state.adminSubmissionDetail = null;
    }
  } finally {
    state.adminSubmissionLoading = false;
    renderAdminSubmissionManager();
  }
  if (state.adminSelectedSubmissionUserId) await loadAdminUserSubmissions(state.adminSelectedSubmissionUserId);
}

async function loadAdminUserSubmissions(userId) {
  if (!isAdmin() || !userId) return;
  state.adminSelectedSubmissionUserId = userId;
  state.adminSubmissionDetail = null;
  state.adminSubmissionLoading = true;
  renderAdminSubmissionManager();
  try {
    state.adminSubmissionDetail = await api(`/api/admin/users/${encodeURIComponent(userId)}/submissions?limit=500`);
  } finally {
    state.adminSubmissionLoading = false;
    renderAdminSubmissionManager();
  }
}

async function refreshAdminModerationData(userId = state.adminSelectedSubmissionUserId) {
  await Promise.all([loadSources(), loadEntries(), loadContributors()]);
  state.adminSubmissionUsersLoaded = false;
  state.adminSelectedSubmissionUserId = userId || '';
  await loadAdminSubmissionUsers(state.adminSubmissionQuery);
  updateListTitle();
  renderList();
  renderSidebar();
}

function adminModerationReason() {
  return String($('#admin-moderation-reason')?.value || '').trim() || '发布违规内容';
}

async function deleteAdminUserSubmissions() {
  const detail = state.adminSubmissionDetail;
  if (!detail?.user || !(Number(detail.activeSubmissionCount) || 0)) return;
  const user = detail.user;
  const ok = await showConfirmDialog({
    title: '清理该用户全部投稿',
    message: `确认隐藏「${user.displayName || user.email}」当前公开的 ${detail.activeSubmissionCount} 篇读者投稿？账号本身不会被停用。`,
    confirmText: '清理全部投稿',
    danger: true,
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}/submissions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmUserId: user.userId, reason: adminModerationReason() }),
  });
  await refreshAdminModerationData(user.userId);
  toast('该用户的公开投稿已清理');
}

async function deleteAdminUser() {
  const user = state.adminSubmissionDetail?.user;
  if (!user || user.role === 'admin' || user.userId === state.me?.id) return;
  const ok = await showConfirmDialog({
    title: '删除违规用户',
    message: `确认停用「${user.displayName || user.email}」？系统会立即撤销其会话、禁止再次使用，并隐藏全部读者投稿。审计记录会保留。`,
    confirmText: '删除违规用户',
    danger: true,
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmUserId: user.userId, reason: adminModerationReason() }),
  });
  await refreshAdminModerationData(user.userId);
  toast('违规用户已停用，会话和公开投稿已清理');
}

async function restoreAdminUser() {
  const user = state.adminSubmissionDetail?.user;
  if (!user || !user.disabled || user.role === 'admin') return;
  const ok = await showConfirmDialog({
    title: '恢复用户账号',
    message: `恢复「${user.displayName || user.email}」使用权限？此前清理的投稿不会自动恢复。`,
    confirmText: '恢复账号',
  });
  if (!ok) return;
  await api(`/api/admin/users/${encodeURIComponent(user.userId)}/restore`, { method: 'POST' });
  await refreshAdminModerationData(user.userId);
  toast('用户账号已恢复');
}

async function openAdminPage({ push = true } = {}) {
  setWorkspacePage('admin');
  state.activeEntry = null;
  document.title = '系统后台 · QMReader';
  renderAdminPage();
  if (push) {
    const url = adminUrlFor();
    if (url.href !== window.location.href) history.pushState({ workspacePage: 'admin' }, '', url);
  }
  return true;
}

function closeAdminPage() {
  setWorkspacePage('');
  clearReaderUrl({ replace: true });
}

function getEditingAiProfile() {
  return state.aiProfiles.find(profile => profile.id === state.editingAiProfileId)
    || currentAiProfile();
}

function renderAiStatus() {
  const el = $('#agent-profile');
  renderSidebarAiSettings();
  renderAiProfileControls();
  if (!el) return;
  const profile = aiProfileForPurpose('agent');
  const config = aiConfigForPurpose('agent');
  el.textContent = hasUsableAiConfig(config)
    ? `对话 · ${profile.name} · ${config.model}`
    : `${profile.name || 'AI 配置'} · 未填 API Key`;
}

function aiProfileSelectLabel(profile) {
  const model = String(profile && profile.model || '').trim();
  const name = String(profile && profile.name || profile && profile.providerName || 'AI 配置').trim();
  const suffix = profile && profile.apiKey ? '' : ' · 未配置';
  return `${name}${model ? ` · ${model}` : ''}${suffix}`;
}

function renderAiProfileSelect(selector, purpose) {
  const select = $(selector);
  if (!select) return;
  const profile = aiProfileForPurpose(purpose);
  select.innerHTML = state.aiProfiles.map(item => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(aiProfileSelectLabel(item))}</option>`
  )).join('');
  select.value = profile.id;
  select.disabled = state.aiProfiles.length === 0;
  select.classList.remove('hidden');
}

function renderAiProfileControls() {
  renderAiProfileSelect('#translation-profile-select', 'translation');
  renderAiProfileSelect('#rewrite-profile-select', 'rewrite');
  renderAiProfileSelect('#agent-profile-select', 'agent');
}

function setAiProfileForPurpose(purpose, profileId) {
  const profile = state.aiProfiles.find(item => item.id === profileId);
  if (!profile) return;
  if (purpose === 'translation') state.translationAiProfileId = profile.id;
  if (purpose === 'rewrite') state.rewriteAiProfileId = profile.id;
  if (purpose === 'agent') state.agentAiProfileId = profile.id;
  persistAiProfiles();
  renderAiProfileControls();
  updateAgentControls();
}

function aiAlertText() {
  if (state.aiConfigReason === 'translation') return '生成双语对照翻译需要先保存一个可用的 AI 配置。';
  if (state.aiConfigReason === 'rewrite') return '生成中文改写需要先保存一个可用的 AI 配置，保存后会继续当前文章。';
  if (state.aiConfigReason === 'agent') return '文章对话需要先保存一个可用的 AI 配置，当前问题会保留。';
  return '';
}

function renderAiProfileList() {
  const list = $('#ai-profile-list');
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const profile of state.aiProfiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-profile-item' + (profile.id === state.editingAiProfileId ? ' active' : '');
    btn.innerHTML = `
      <span class="ai-profile-name">${escapeHtml(profile.name)}</span>
      <span class="ai-profile-meta">${escapeHtml(profile.providerName || profile.provider)} · ${escapeHtml(profile.model || '未填模型')}</span>
      <span class="ai-profile-key">${profile.apiKey ? escapeHtml(maskApiKey(profile.apiKey)) : '未填 API Key'}${profile.isDefault ? ' · 默认' : ''}</span>`;
    btn.onclick = () => {
      state.editingAiProfileId = profile.id;
      state.activeAiProfileId = profile.id;
      if (state.aiConfigReason === 'translation') state.translationAiProfileId = profile.id;
      if (state.aiConfigReason === 'rewrite') state.rewriteAiProfileId = profile.id;
      if (state.aiConfigReason === 'agent') state.agentAiProfileId = profile.id;
      persistAiProfiles();
      renderAiSettings();
      updateAgentControls();
    };
    frag.appendChild(btn);
  }
  list.appendChild(frag);
}

function renderTemplateList() {
  const el = $('#ai-template-list');
  if (!el) return;
  const parts = [];
  for (const category of AI_PROVIDER_CATEGORIES) {
    const presets = AI_PROVIDER_PRESETS.filter(preset => preset.category === category);
    if (!presets.length) continue;
    parts.push(`<div class="ai-template-group"><div class="ai-template-category">${escapeHtml(category)}</div><div class="ai-template-buttons">`);
    for (const preset of presets) {
      parts.push(`<button type="button" class="ai-template" data-preset="${escapeHtml(preset.id)}" title="${escapeHtml(preset.description)}">
        <span>${escapeHtml(preset.name)}${preset.recommended ? ' · 推荐' : ''}</span>
      </button>`);
    }
    parts.push('</div></div>');
  }
  parts.push(`<div class="ai-template-group"><div class="ai-template-category">自定义</div><div class="ai-template-buttons"><button type="button" class="ai-template" data-preset="custom"><span>OpenAI 兼容</span></button></div></div>`);
  el.innerHTML = parts.join('');
}

function quickModelsForProfile(profile) {
  const preset = AI_PROVIDER_MAP[profile.provider];
  const models = preset && Array.isArray(preset.quickModels) ? preset.quickModels : [];
  return [...new Set([profile.model, ...models].filter(Boolean))];
}

function renderQuickModels(models) {
  const el = $('#ai-quick-models');
  if (!el) return;
  el.innerHTML = models.slice(0, 18).map(model => (
    `<button type="button" class="ai-model-chip" data-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`
  )).join('');
}

function bindAiSecretInputGuards() {
  const key = $('#ai-api-key');
  if (!key || key.dataset.secretGuardsBound === '1') return;
  key.dataset.secretGuardsBound = '1';
  // 只读到聚焦：降低密码管理器抢填；type=text + CSS 遮罩避免「保存密码」弹窗
  key.setAttribute('readonly', 'readonly');
  key.addEventListener('focus', () => {
    key.removeAttribute('readonly');
  });
  key.addEventListener('blur', () => {
    key.setAttribute('readonly', 'readonly');
  });
}

function fillAiProfileForm(profile) {
  bindAiSecretInputGuards();
  $('#ai-profile-name').value = profile.name || '';
  $('#ai-provider-id').value = profile.provider || 'custom';
  $('#ai-provider-name').value = profile.providerName || profile.provider || '';
  $('#ai-provider-category').value = profile.providerCategory || '';
  $('#ai-provider-type').value = profile.providerType || 'openai_compatible';
  $('#ai-api-key-url').value = profile.apiKeyUrl || '';
  const keyInput = $('#ai-api-key');
  if (keyInput) {
    const active = document.activeElement === keyInput;
    if (!active) keyInput.setAttribute('readonly', 'readonly');
    keyInput.value = profile.apiKey || '';
  }
  $('#ai-base-url').value = profile.baseUrl || '';
  $('#ai-model').value = profile.model || '';
  $('#ai-temperature').value = String(clampTemperature(profile.temperature));
  $('#ai-max-tokens').value = String(clampMaxTokens(profile.maxTokens));
  $('#ai-default-profile').checked = Boolean(profile.isDefault);
  const keyLink = $('#ai-key-link');
  keyLink.href = profile.apiKeyUrl || '#';
  keyLink.classList.toggle('hidden', !profile.apiKeyUrl);
  $('#ai-config-note').textContent = profile.apiKey
    ? `当前 API Key：${maskApiKey(profile.apiKey)}`
    : 'API Key 只保存在当前浏览器，不写入服务器数据库。';
  renderQuickModels(quickModelsForProfile(profile));
}

function renderAiSettings() {
  if (!state.aiProfiles.length) loadAiProfilesForScope();
  if (!state.editingAiProfileId) state.editingAiProfileId = currentAiProfile().id;
  renderAiStatus();
  renderAiProfileList();
  renderTemplateList();
  const profile = getEditingAiProfile();
  if (profile) fillAiProfileForm(profile);
  const alert = $('#ai-config-alert');
  const text = aiAlertText();
  if (alert) {
    alert.textContent = text;
    alert.classList.toggle('hidden', !text);
  }
  $('#ai-delete-profile').disabled = state.aiProfiles.length <= 1;
  updateAgentControls();
}

function readAiProfileForm() {
  const current = getEditingAiProfile() || createCustomProfile();
  return normalizeProfile({
    ...current,
    name: $('#ai-profile-name').value.trim(),
    provider: $('#ai-provider-id').value.trim() || 'custom',
    providerName: $('#ai-provider-name').value.trim() || $('#ai-provider-id').value.trim() || '自定义',
    providerType: $('#ai-provider-type').value.trim() || 'openai_compatible',
    providerCategory: $('#ai-provider-category').value.trim(),
    apiKeyUrl: $('#ai-api-key-url').value.trim(),
    baseUrl: normalizeBaseUrl($('#ai-base-url').value),
    model: $('#ai-model').value.trim(),
    temperature: clampTemperature($('#ai-temperature').value),
    maxTokens: clampMaxTokens($('#ai-max-tokens').value),
    apiKey: $('#ai-api-key').value.trim(),
    isDefault: $('#ai-default-profile').checked,
    updatedAt: Date.now(),
  });
}

function applyAiPreset(presetId) {
  const current = getEditingAiProfile() || createCustomProfile();
  const profile = presetId === 'custom'
    ? createCustomProfile({ id: current.id, apiKey: current.apiKey, isDefault: current.isDefault })
    : createProfileFromPreset(presetId, { id: current.id, apiKey: current.apiKey, isDefault: current.isDefault });
  fillAiProfileForm(profile);
  $('#ai-config-note').textContent = presetId === 'custom'
    ? '自定义服务需要兼容 OpenAI Chat Completions 协议。'
    : (AI_PROVIDER_MAP[presetId]?.description || '');
}

function runPendingAiAction() {
  const action = state.pendingAiAction;
  const text = state.pendingAgentText;
  state.pendingAiAction = '';
  state.pendingAgentText = '';
  if (action === 'translation') setTimeout(() => generateTranslation(), 0);
  if (action === 'rewrite') setTimeout(() => generateRewrite({ force: Boolean(state.rewrite) }), 0);
  if (action === 'agent' && text) setTimeout(() => sendAgentMessage(text), 0);
}

function saveAiProfileFromForm({ silent = false } = {}) {
  // 失焦 secret 字段，避免提交瞬间被密码管理器当成登录
  $('#ai-api-key')?.blur();
  const profile = readAiProfileForm();
  if (!profile.name || !profile.baseUrl || !profile.model) {
    toast('请填写配置名称、Base URL 和模型');
    return null;
  }

  const exists = state.aiProfiles.some(item => item.id === profile.id);
  let nextProfiles = exists
    ? state.aiProfiles.map(item => (item.id === profile.id ? profile : item))
    : [...state.aiProfiles, profile];
  if (profile.isDefault || !nextProfiles.some(item => item.isDefault)) {
    nextProfiles = nextProfiles.map(item => ({ ...item, isDefault: item.id === profile.id }));
  }
  state.aiProfiles = ensureSingleDefault(nextProfiles);
  state.activeAiProfileId = profile.id;
  if (state.aiConfigReason === 'translation') state.translationAiProfileId = profile.id;
  if (state.aiConfigReason === 'rewrite') state.rewriteAiProfileId = profile.id;
  if (state.aiConfigReason === 'agent') state.agentAiProfileId = profile.id;
  state.editingAiProfileId = profile.id;
  persistAiProfiles();
  renderAiSettings();
  if (!silent) toast('AI 配置已保存');
  const reasonConfig = state.aiConfigReason ? aiConfigForPurpose(state.aiConfigReason) : currentAiConfig();
  if (hasUsableAiConfig(reasonConfig) && state.pendingAiAction) {
    closeAiConfigModal();
    runPendingAiAction();
  }
  return profile;
}

function addAiProfile() {
  const profile = createProfileFromPreset(DEFAULT_AI_PRESET_ID, {
    name: `DeepSeek ${state.aiProfiles.length + 1}`,
    isDefault: state.aiProfiles.length === 0,
  });
  state.aiProfiles = ensureSingleDefault([...state.aiProfiles, profile]);
  state.activeAiProfileId = profile.id;
  state.editingAiProfileId = profile.id;
  persistAiProfiles();
  renderAiSettings();
}

async function deleteAiProfile() {
  const profile = getEditingAiProfile();
  if (!profile || state.aiProfiles.length <= 1) return;
  const ok = await showConfirmDialog({
    title: '删除 AI 配置',
    message: `确定删除「${profile.name}」吗？使用这个配置的翻译、改写和对话会切回默认配置。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.aiProfiles = ensureSingleDefault(state.aiProfiles.filter(item => item.id !== profile.id));
  state.activeAiProfileId = (state.aiProfiles.find(item => item.isDefault) || state.aiProfiles[0]).id;
  if (!state.aiProfiles.some(item => item.id === state.translationAiProfileId)) state.translationAiProfileId = state.activeAiProfileId;
  if (!state.aiProfiles.some(item => item.id === state.rewriteAiProfileId)) state.rewriteAiProfileId = state.activeAiProfileId;
  if (!state.aiProfiles.some(item => item.id === state.agentAiProfileId)) state.agentAiProfileId = state.activeAiProfileId;
  state.editingAiProfileId = state.activeAiProfileId;
  persistAiProfiles();
  renderAiSettings();
  toast('AI 配置已删除');
}

function openAiConfigModal(reason = '', pendingAction = '', pendingText = '') {
  state.aiConfigReason = reason;
  state.pendingAiAction = pendingAction || '';
  state.pendingAgentText = pendingText || '';
  mountAiConfigPanel('modal');
  renderAiSettings();
  $('#ai-config-modal').classList.remove('hidden');
  const config = currentAiConfig();
  setTimeout(() => {
    const target = hasUsableAiConfig(config) ? $('#ai-model') : $('#ai-api-key');
    if (target) target.focus();
  }, 30);
  return true;
}

function closeAiConfigModal() {
  $('#ai-config-modal').classList.add('hidden');
  state.aiConfigReason = '';
  if (state.workspacePage === 'dashboard' && state.dashboardTab === 'ai') {
    mountAiConfigPanel('dashboard');
  }
  renderAiSettings();
}

async function fetchAiModels() {
  const profile = readAiProfileForm();
  const config = configFromProfile(profile);
  if (!config.apiKey || !config.baseUrl) {
    toast('请先填写 API Key 和 Base URL');
    return;
  }
  const btn = $('#ai-fetch-models');
  btn.disabled = true;
  btn.textContent = '获取中…';
  $('#ai-config-note').textContent = '正在读取模型列表…';
  try {
    const data = await api('/api/ai/models', {
      method: 'POST',
      aiConfig: config,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const models = data.models || [];
    if (!models.length) {
      $('#ai-config-note').textContent = '连接成功，但接口没有返回模型列表。';
      return;
    }
    renderQuickModels(models);
    if (!$('#ai-model').value.trim()) $('#ai-model').value = models[0];
    $('#ai-config-note').textContent = `已获取 ${models.length} 个模型，点击下方模型可填入。`;
  } catch (err) {
    $('#ai-config-note').textContent = err.message;
    toast('获取模型失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '获取模型';
  }
}

async function testAiConnection() {
  const profile = readAiProfileForm();
  const config = configFromProfile(profile);
  if (!hasUsableAiConfig(config)) {
    toast('请先填写 API Key、Base URL 和模型');
    return;
  }
  const btn = $('#ai-test');
  btn.disabled = true;
  btn.textContent = '测试中…';
  $('#ai-config-note').textContent = '正在测试模型连接…';
  try {
    const data = await api('/api/ai/test', {
      method: 'POST',
      aiConfig: config,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    $('#ai-config-note').textContent = `连接成功：${data.model || config.model} · ${data.latencyMs || data.latency_ms || '-'}ms`;
    toast('连接成功');
  } catch (err) {
    $('#ai-config-note').textContent = err.message;
    toast('连接测试失败: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function setContextPanel(panel = 'agent', { persist = true, expand = false } = {}) {
  // Zen 纯阅读：永不展开右栏
  if (isZenPersonalMode()) {
    state.contextPanel = 'agent';
    setAgentCollapsed(true, { persist: true, auto: false });
    return;
  }
  const next = panel === 'annotations' ? 'annotations' : 'agent';
  state.contextPanel = next;
  if (persist) storage.removeItem('qm_context_panel');
  const isAgent = next === 'agent';
  $('#context-tab-agent')?.classList.toggle('active', isAgent);
  $('#context-tab-agent')?.setAttribute('aria-pressed', isAgent ? 'true' : 'false');
  $('#context-tab-annotations')?.classList.toggle('active', !isAgent);
  $('#context-tab-annotations')?.setAttribute('aria-pressed', isAgent ? 'false' : 'true');
  $('#agent-side-panel')?.classList.toggle('hidden', !isAgent);
  $('#annotation-side-panel')?.classList.toggle('hidden', isAgent);
  $('#app')?.classList.toggle('context-agent-active', isAgent);
  $('#app')?.classList.toggle('context-annotations-active', !isAgent);
  if (expand) setAgentCollapsed(false);
  renderAnnotations();
  renderAgentContextStrip();
}

function setAgentCollapsed(collapsed, { persist: shouldPersist = true, auto = false } = {}) {
  // Zen 纯阅读：右栏永久收起，且不要把左栏挤掉
  if (isZenPersonalMode()) collapsed = true;
  if (!collapsed && state.readerImmersive) setReaderImmersive(false);
  if (!collapsed && shouldCollapseLeftForContext()) setLeftCollapsed(true);
  state.agentCollapsed = collapsed;
  state.agentAutoCollapsed = Boolean(collapsed && auto);
  if (shouldPersist) storage.setItem('qm_agent_collapsed', collapsed ? '1' : '0');
  $('#app').classList.toggle('agent-collapsed', collapsed);
  if (collapsed) $('#app').style.removeProperty('--agent-width');
  const rail = $('#context-open-rail');
  // Zen：展开轨也永远藏
  if (rail) rail.classList.toggle('hidden', isZenPersonalMode() ? true : !collapsed);
  const opener = $('#agent-open');
  if (opener) {
    opener.classList.toggle('hidden', isZenPersonalMode() ? true : !collapsed);
    setElementIcon(opener, 'panel-right-open');
    opener.title = '展开文章侧栏';
    opener.setAttribute('aria-label', '展开文章侧栏');
  }
  const closer = $('#context-close');
  if (closer) {
    setElementIcon(closer, 'panel-right-close');
    closer.title = '收起右侧栏';
    closer.setAttribute('aria-label', '收起右侧栏');
  }
  if (!collapsed && state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
  updateSeparatorMetrics();
}

function setSidebarCollapsed(collapsed) {
  // Zen 也允许收起源列表为窄栏；右 AI 栏仍永久隐藏
  state.sidebarCollapsed = Boolean(collapsed);
  storage.setItem('qm_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');
  $('#app').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const toggle = $('#sidebar-toggle');
  if (toggle) {
    setElementIcon(toggle, state.sidebarCollapsed ? 'panel-left-open' : 'panel-left-close');
    toggle.title = state.sidebarCollapsed ? '展开左侧栏' : '收起左侧栏';
    toggle.setAttribute('aria-label', toggle.title);
  }
  normalizeReaderWorkbenchLayout();
  updateSeparatorMetrics();
}

function renderLeftCollapseToggle() {
  const toggle = $('#left-collapse-toggle');
  if (!toggle) return;
  const effectivelyCollapsed = Boolean(state.leftCollapsed || (state.readerImmersive && state.activeEntry));
  setElementIcon(toggle, effectivelyCollapsed ? 'panel-left-open' : 'panel-left-close');
  toggle.title = effectivelyCollapsed ? '展开左侧' : '收起左侧';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.setAttribute('aria-pressed', effectivelyCollapsed ? 'true' : 'false');
}

function setLeftCollapsed(collapsed) {
  // Zen 允许整左栏（源列表+文章列表）收起，开文专注阅读
  if (!collapsed && state.readerImmersive) setReaderImmersive(false);
  state.leftCollapsed = Boolean(collapsed);
  storage.setItem('qm_left_collapsed', state.leftCollapsed ? '1' : '0');
  $('#app').classList.toggle('left-collapsed', state.leftCollapsed);
  renderLeftCollapseToggle();
  if (!state.leftCollapsed) {
    const storedEntryWidth = readStoredNumber('qm_entry_pane_width');
    if (storedEntryWidth) state.entryPaneWidth = storedEntryWidth;
    normalizeReaderWorkbenchLayout();
    // Zen 列宽由 CSS 固定，避免开文/展开时再写 --entry-width 造成缩放感
    if (!isZenPersonalMode()) {
      if (state.entryPaneWidth) setEntryPaneWidth(state.entryPaneWidth, { persist: false });
      if (state.contextPaneWidth) setContextPaneWidth(state.contextPaneWidth, { persist: false });
    } else {
      $('#app')?.style.removeProperty('--entry-width');
    }
  }
  updateSeparatorMetrics();
}

function readerWorkbenchWidthBudget({ includeContext = !state.agentCollapsed } = {}) {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  const sidebarWidth = state.leftCollapsed ? 0 : (state.sidebarCollapsed ? 64 : 232);
  const entryWidth = state.leftCollapsed ? 0 : ENTRY_PANE_MIN_WIDTH;
  const listResizerWidth = state.leftCollapsed ? 0 : 4;
  const contextWidth = includeContext ? CONTEXT_PANE_MIN_WIDTH : 0;
  const contextResizerWidth = includeContext ? 4 : 0;
  return sidebarWidth + entryWidth + listResizerWidth + minimumReaderPaneWidth() + contextResizerWidth + contextWidth;
}

function shouldAutoCollapseContext() {
  if (!state.activeEntry || state.readerImmersive || state.leftCollapsed || state.agentCollapsed) return false;
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return false;
  return viewport < readerWorkbenchWidthBudget({ includeContext: true });
}

function shouldCollapseLeftForContext() {
  // Zen：始终保留左侧源列表 + 文章列表
  if (isZenPersonalMode()) return false;
  if (!state.activeEntry || state.readerImmersive || state.leftCollapsed) return false;
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return false;
  return viewport < readerWorkbenchWidthBudget({ includeContext: true });
}

function normalizeReaderWorkbenchLayout() {
  if (!state.activeEntry || state.readerImmersive) return;
  // Zen：永不自动展开右栏
  if (isZenPersonalMode()) {
    setAgentCollapsed(true, { persist: false, auto: false });
    return;
  }
  if (shouldAutoCollapseContext()) {
    setAgentCollapsed(true, { persist: false, auto: true });
    return;
  }
  if (state.agentAutoCollapsed && storage.getItem('qm_agent_collapsed') !== '1' && !shouldCollapseLeftForContext()) {
    setAgentCollapsed(false, { persist: false });
  }
}

function entryPaneWidthBounds() {
  if (state.leftCollapsed && $('#app')?.classList.contains('reading')) return { min: 0, max: 0 };
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  let max = Math.min(ENTRY_PANE_MAX_WIDTH, Math.max(ENTRY_PANE_MIN_WIDTH, Math.floor(viewport * 0.45)));
  // Zen：开文不因正文 min 宽度再压窄中栏；非 Zen 仍保证 reader 预算
  if (state.activeEntry && viewport > 980 && !isZenPersonalMode()) {
    const sidebarWidth = visibleElementWidth('#sidebar', state.sidebarCollapsed ? 64 : 232);
    const agentWidth = state.agentCollapsed ? 0 : visibleElementWidth('#agent-pane', state.contextPaneWidth || CONTEXT_PANE_MIN_WIDTH);
    const listResizerWidth = visibleElementWidth('#list-resizer', 4);
    const contextResizerWidth = state.agentCollapsed ? 0 : visibleElementWidth('#context-resizer', 4);
    const available = viewport - sidebarWidth - agentWidth - listResizerWidth - contextResizerWidth - minimumReaderPaneWidth();
    max = Math.min(max, Math.max(ENTRY_PANE_MIN_WIDTH, Math.floor(available)));
  }
  const min = Math.min(ENTRY_PANE_MIN_WIDTH, Math.max(0, max));
  return { min, max: Math.max(min, max) };
}

function clampEntryPaneWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const bounds = entryPaneWidthBounds();
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function setEntryPaneWidth(width, { persist: shouldPersist = true } = {}) {
  // Zen：列宽固定像素，禁止任何路径写 --entry-width（含 list-resizer 拖拽）
  if (isZenPersonalMode()) {
    $('#app')?.style.removeProperty('--entry-width');
    return;
  }
  if (state.leftCollapsed && $('#app')?.classList.contains('reading')) return;
  const next = clampEntryPaneWidth(width);
  state.entryPaneWidth = next;
  if (next) {
    $('#app').style.setProperty('--entry-width', `${next}px`);
    if (shouldPersist) storage.setItem('qm_entry_pane_width', String(next));
  } else {
    $('#app').style.removeProperty('--entry-width');
    if (shouldPersist) storage.removeItem('qm_entry_pane_width');
  }
  updateSeparatorMetrics();
}

function visibleElementWidth(selector, fallback = 0) {
  const el = $(selector);
  if (!el) return fallback;
  const style = getComputedStyle(el);
  if (style.display === 'none') return 0;
  const width = el.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function minimumReaderPaneWidth() {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  if (viewport <= 980) return 0;
  if (viewport <= 1280) return 640;
  if (viewport <= 1500) return 700;
  return READER_PANE_MIN_WIDTH;
}

function contextPaneWidthBounds() {
  const viewport = window.innerWidth || document.documentElement.clientWidth || 1280;
  let max = Math.min(CONTEXT_PANE_MAX_WIDTH, Math.max(CONTEXT_PANE_MIN_WIDTH, Math.floor(viewport * 0.36)));
  if (state.activeEntry && viewport > 980) {
    const sidebarWidth = visibleElementWidth('#sidebar', state.sidebarCollapsed ? 64 : 232);
    const entryWidth = visibleElementWidth('#entry-pane', state.entryPaneWidth || ENTRY_PANE_MIN_WIDTH);
    const listResizerWidth = visibleElementWidth('#list-resizer', 4);
    const contextResizerWidth = visibleElementWidth('#context-resizer', 4);
    const available = viewport - sidebarWidth - entryWidth - listResizerWidth - contextResizerWidth - minimumReaderPaneWidth();
    max = Math.min(max, Math.max(0, Math.floor(available)));
  }
  const min = Math.min(CONTEXT_PANE_MIN_WIDTH, Math.max(0, max));
  return { min, max: Math.max(min, max) };
}

function clampContextPaneWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const bounds = contextPaneWidthBounds();
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function setContextPaneWidth(width, { persist: shouldPersist = true } = {}) {
  if (state.agentCollapsed) {
    const n = Number(width);
    if (Number.isFinite(n) && n > 0) state.contextPaneWidth = Math.round(n);
    $('#app').style.removeProperty('--agent-width');
    updateSeparatorMetrics();
    return;
  }
  const next = clampContextPaneWidth(width);
  state.contextPaneWidth = next;
  if (next) {
    $('#app').style.setProperty('--agent-width', `${next}px`);
    if (shouldPersist) storage.setItem('qm_context_pane_width', String(next));
  } else {
    $('#app').style.removeProperty('--agent-width');
    if (shouldPersist) storage.removeItem('qm_context_pane_width');
  }
  updateSeparatorMetrics();
}

function updateSeparatorMetrics() {
  const listResizer = $('#list-resizer');
  if (listResizer) {
    const bounds = entryPaneWidthBounds();
    const current = state.leftCollapsed ? 0 : Math.round(visibleElementWidth('#entry-pane', state.entryPaneWidth || ENTRY_PANE_MIN_WIDTH));
    listResizer.setAttribute('aria-controls', 'entry-pane');
    listResizer.setAttribute('aria-valuemin', String(bounds.min));
    listResizer.setAttribute('aria-valuemax', String(bounds.max));
    listResizer.setAttribute('aria-valuenow', String(current));
  }
  const contextResizer = $('#context-resizer');
  if (contextResizer) {
    const bounds = contextPaneWidthBounds();
    const current = state.agentCollapsed ? 0 : Math.round(visibleElementWidth('#agent-pane', state.contextPaneWidth || CONTEXT_PANE_MIN_WIDTH));
    contextResizer.setAttribute('aria-controls', 'agent-pane');
    contextResizer.setAttribute('aria-valuemin', String(bounds.min));
    contextResizer.setAttribute('aria-valuemax', String(bounds.max));
    contextResizer.setAttribute('aria-valuenow', String(current));
  }
}

/** 面板拖拽公共逻辑：pointer 捕获 + rAF 节流的 pointermove（每帧至多写一次列宽） */
function bindPaneDrag(resizer, { canStart, activeClass, resizeTo }) {
  let dragging = false;
  const onMove = rafThrottle((clientX) => resizeTo(clientX));
  resizer.addEventListener('pointerdown', (e) => {
    if (!canStart()) return;
    dragging = true;
    $('#app').classList.add(activeClass);
    resizer.setPointerCapture?.(e.pointerId);
    resizeTo(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    onMove(e.clientX);
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    onMove.cancel();
    $('#app').classList.remove(activeClass);
  });
}

function setupListResizer() {
  const resizer = $('#list-resizer');
  if (!resizer) return;
  bindPaneDrag(resizer, {
    canStart: () => (window.innerWidth || 0) > 980,
    activeClass: 'is-resizing',
    resizeTo: (clientX) => {
      const entryRect = $('#entry-pane').getBoundingClientRect();
      setEntryPaneWidth(clientX - entryRect.left);
    },
  });
  resizer.addEventListener('dblclick', () => setEntryPaneWidth(0));
  resizer.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const bounds = entryPaneWidthBounds();
    const current = state.entryPaneWidth || $('#entry-pane').getBoundingClientRect().width;
    if (e.key === 'Home') setEntryPaneWidth(bounds.min);
    if (e.key === 'End') setEntryPaneWidth(bounds.max);
    if (e.key === 'ArrowLeft') setEntryPaneWidth(current - 24);
    if (e.key === 'ArrowRight') setEntryPaneWidth(current + 24);
  });
}

function setupContextResizer() {
  const resizer = $('#context-resizer');
  if (!resizer) return;
  bindPaneDrag(resizer, {
    canStart: () => (window.innerWidth || 0) > 980 && !state.agentCollapsed,
    activeClass: 'is-context-resizing',
    resizeTo: (clientX) => {
      const appRect = $('#app').getBoundingClientRect();
      setContextPaneWidth(appRect.right - clientX);
    },
  });
  resizer.addEventListener('dblclick', () => setContextPaneWidth(0));
  resizer.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const bounds = contextPaneWidthBounds();
    const current = state.contextPaneWidth || $('#agent-pane').getBoundingClientRect().width;
    if (e.key === 'Home') setContextPaneWidth(bounds.min);
    if (e.key === 'End') setContextPaneWidth(bounds.max);
    if (e.key === 'ArrowLeft') setContextPaneWidth(current + 24);
    if (e.key === 'ArrowRight') setContextPaneWidth(current - 24);
  });
}

/* ---------- Events ---------- */
$('#brand-home').onclick = goHomeAll;
$$('.view-btn[data-view]').forEach(b => b.onclick = () => selectView(b.dataset.view));
const navMoreToggle = $('#nav-more-toggle');
if (navMoreToggle) navMoreToggle.onclick = () => {
  state.sidebarMoreOpen = !state.sidebarMoreOpen;
  storage.setItem('qm_sidebar_more_open', state.sidebarMoreOpen ? '1' : '0');
  renderSidebarMore();
};
$('#sidebar-toggle').onclick = () => setSidebarCollapsed(!state.sidebarCollapsed);
const leftCollapseToggle = $('#left-collapse-toggle');
if (leftCollapseToggle) {
  leftCollapseToggle.onclick = () => {
    if (state.readerImmersive) {
      setLeftCollapsed(false);
      return;
    }
    setLeftCollapsed(!state.leftCollapsed);
  };
}
const assetDashboardOpen = $('#asset-dashboard-open');
if (assetDashboardOpen) assetDashboardOpen.onclick = () => {
  state.assetSort = 'latest';
  selectAssetFilter(null);
};
const assetDashboardHelpful = $('#asset-dashboard-helpful');
if (assetDashboardHelpful) assetDashboardHelpful.onclick = () => {
  state.assetFilter = null;
  selectAssetSort('helpful');
};
$('#asset-dashboard').onclick = (e) => {
  const btn = e.target.closest('[data-asset-filter]');
  if (!btn || btn.disabled) return;
  selectAssetFilter(btn.dataset.assetFilter);
};
$('#asset-activity-strip').onclick = async (e) => {
  const copy = e.target.closest('[data-asset-copy-list]');
  if (copy) {
    copyText(listUrlFor('assets', state.assetFilter).href, '资产页链接已复制');
    return;
  }
  const filter = e.target.closest('[data-asset-strip-filter]');
  if (filter && !filter.disabled) {
    selectAssetFilter(filter.dataset.assetStripFilter || null);
    return;
  }
  const sort = e.target.closest('[data-asset-sort]');
  if (sort) {
    selectAssetSort(sort.dataset.assetSort || 'latest');
    return;
  }
  const contributorSort = e.target.closest('[data-contributor-sort]');
  if (contributorSort) {
    selectContributorSort(contributorSort.dataset.contributorSort || 'latest');
    return;
  }
  const all = e.target.closest('[data-asset-open-all]');
  if (all) {
    selectAssetFilter(null);
    return;
  }
  const btn = e.target.closest('[data-asset-entry]');
  await openAssetActivityButton(btn);
};
$('#entry-pane-tabs').onclick = (e) => {
  const btn = e.target.closest('[data-home-tab]');
  if (!btn) return;
  state.homeTab = btn.dataset.homeTab === 'assets' ? 'assets' : 'entries';
  storage.setItem('qm_home_tab', state.homeTab);
  renderList();
};
$('#list-scope-bar').onclick = (e) => {
  const btn = e.target.closest('[data-list-scope]');
  if (!btn) return;
  selectListScope(btn.dataset.listScope);
};
$('#reader-pane').addEventListener('scroll', hideArticleLinkMenu, { passive: true });
$('#entry-list').onclick = async (e) => {
  const all = e.target.closest('[data-asset-open-all]');
  if (all) {
    selectAssetFilter(null);
    return;
  }
  const btn = e.target.closest('.home-asset-activity-list [data-asset-entry]');
  if (!btn) return;
  await openAssetActivityButton(btn);
};
$('#refresh-btn').onclick = refreshAll;
$('#source-refresh-btn').onclick = refreshCurrentSource;
if ($('#source-submit-btn')) {
  $('#source-submit-btn').onclick = () => {
    const mode = $('#source-submit-btn').dataset.mode === 'repo' ? 'repo' : 'article';
    if (mode === 'repo') openSubmitGitHubModal();
    else openSubmitLinkModal({ mode: 'article' });
  };
}
$('#reader-pane').addEventListener('pointerdown', (e) => {
  if (articleContentLinkFromTarget(e.target)) suppressAnnotationPopoverForLink();
}, true);
$('#reader-pane').addEventListener('click', (e) => {
  const xTranslateBtn = e.target.closest('[data-x-translate]');
  if (xTranslateBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleReaderTranslateClick();
    return;
  }
  const noteToggleBtn = e.target.closest('[data-note-toggle]');
  if (noteToggleBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleReaderNoteClick();
    return;
  }
  const starBtn = e.target.closest('[data-entry-star]');
  if (starBtn) {
    e.preventDefault();
    e.stopPropagation();
    toggleEntryStarred(starBtn.dataset.entryStar);
    return;
  }
  const anchor = articleContentLinkFromTarget(e.target);
  if (!anchor) return;
  suppressAnnotationPopoverForLink();
  // Cmd/Ctrl/Shift/Alt 点击交给浏览器默认行为
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const url = articleContentLinkUrl(anchor);
  if (!url) return;
  e.preventDefault();
  e.stopPropagation();
  hideArticleLinkMenu();
  // 正文超链接：直接打开对应网页，不再弹出「打开网页 / 收录到本站」
  window.open(url, '_blank', 'noopener,noreferrer');
});
$('#article-link-open').onclick = openArticleLinkInWindow;
$('#article-link-submit').onclick = submitArticleLinkToSite;
$('#mark-read-btn').onclick = async () => {
  const ids = visibleEntries().map(e => e.id);
  ids.forEach(id => markCatalogEntryRead(id));
  persist();
  renderList();
  updateSidebarNavCounts();
  updateReaderReadButton();
  toast('已全部标为已读');
};
const readerMarkReadBtn = $('#reader-mark-read');
if (readerMarkReadBtn) readerMarkReadBtn.onclick = () => toggleEntryRead(state.activeEntry?.id);
/** 收藏/取消收藏任意条目（正文星标、右键菜单、快捷键共用） */
function toggleEntryStarred(entryId, force) {
  const id = String(entryId || '').trim();
  if (!id) return false;
  const nextStarred = typeof force === 'boolean' ? force : !state.starred.has(id);
  if (nextStarred) state.starred.add(id);
  else state.starred.delete(id);
  persist();
  syncEntryState(id, { starred: nextStarred });
  if (state.activeEntry?.id === id) renderReaderStatsUi();
  else syncSocialStarButtons(id, nextStarred);
  updateSidebarNavCounts();
  if (state.view === 'starred' && !nextStarred) {
    // 从收藏视图摘掉：需要整表重滤
    renderList();
  } else {
    patchEntryCardStar(id, nextStarred);
  }
  toast(nextStarred ? '已收藏' : '已取消收藏', 1400);
  return nextStarred;
}

$('#reader-star').onclick = () => {
  const e = state.activeEntry;
  if (!e) return;
  toggleEntryStarred(e.id);
};
async function setReaderReaction(reaction) {
  // Personal mode: no reactions
  return;
}

function canSoftDeleteEntry() {
  return true;
}

async function deleteEntryById(entryId, { reason = 'front-end delete', confirm = false } = {}) {
  const id = String(entryId || '').trim();
  if (!id || !canSoftDeleteEntry()) {
    toast('当前无法删除', 3000);
    return false;
  }
  const entry = entryByIdFromList(id)
    || (state.activeEntry?.id === id ? state.activeEntry : null)
    || (state.allEntries || []).find(item => item.id === id)
    || null;
  if (!entry) {
    toast('文章不存在', 3000);
    return false;
  }
  // 默认不弹确认（顶栏 / 右键一致）；仅显式 confirm:true 才二次确认
  if (confirm) {
    const title = entry.titleZh || entry.title || '这篇文章';
    const ok = await showConfirmDialog({
      title: '删除文章',
      message: `确认删除《${title}》？将从前台列表与阅读页隐藏；已沉淀的翻译、点评等数据不会被清空。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return false;
  }
  const btn = $('#reader-delete');
  const active = state.activeEntry?.id === id;
  if (active && btn) {
    btn.disabled = true;
    setButtonIconLabel(btn, 'loader-circle', '删除中…', { className: 'app-icon app-icon-spin' });
  }
  try {
    await api(`/api/entry/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const drop = (list) => (list || []).filter(item => item.id !== id);
    state.entries = drop(state.entries);
    state.allEntries = drop(state.allEntries);
    contentCache.delete(id);
    state.read.delete(id);
    state.starred.delete(id);
    state.history.delete(id);
    persist();
    rebuildCatalogIndexes();
    applyLocalEntryFilter({ fastBatch: true });
    if (active) closeReaderFromRoute();
    updateListTitle();
    renderList();
    renderSidebar();
    toast('已删除');
    return true;
  } catch (err) {
    toast('删除失败: ' + err.message, 5000);
    return false;
  } finally {
    if (active && btn) {
      btn.disabled = false;
      setButtonIconLabel(btn, 'trash-2', '删除页面');
    }
    renderAdminEntryControls();
  }
}

async function deleteCurrentEntry() {
  const entry = state.activeEntry;
  if (!entry) return;
  await deleteEntryById(entry.id, { reason: 'personal delete' });
}

/** 本会话已 drop 的 entry id：merge/load 不得复活 */
function rememberLocalDroppedEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return;
  if (!state.localDroppedEntryIds) state.localDroppedEntryIds = new Set();
  state.localDroppedEntryIds.add(id);
  if (state.localDroppedEntryIds.size > 500) {
    state.localDroppedEntryIds = new Set([...state.localDroppedEntryIds].slice(-400));
  }
}

/**
 * 静默摘掉一张列表卡：只删 DOM 节点 + 改内存目录。
 * 禁止 renderList / renderSidebar / merge / closeReader 改 grid —— 零闪烁。
 */
function dropEntryCardSilent(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return;
  rememberLocalDroppedEntry(id);

  // 1) 只摘那张卡
  const listEl = $('#entry-list');
  if (listEl) {
    let card = null;
    try {
      card = listEl.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
    } catch {
      card = [...listEl.querySelectorAll('.entry-card')].find((el) => el.dataset.id === id) || null;
    }
    if (card) card.remove();
  }

  // 2) 内存目录（不 rebuild 全索引、不重画）
  const drop = (list) => (list || []).filter((item) => item && item.id !== id);
  state.entries = drop(state.entries);
  state.allEntries = drop(state.allEntries);
  // 列表删空时给一句空态（不走整表 renderList）
  if (listEl && !listEl.querySelector('.entry-card') && !(state.entries || []).length) {
    listEl.innerHTML = '<div class="list-empty">稍后再看是空的</div>';
  }
  contentCache.delete(id);
  if (state.entryById) state.entryById.delete(id);
  if (state.entriesBySource) {
    for (const [sid, bucket] of state.entriesBySource.entries()) {
      if (!Array.isArray(bucket) || !bucket.length) continue;
      const next = bucket.filter((e) => e && e.id !== id);
      if (next.length === bucket.length) continue;
      state.entriesBySource.set(sid, next);
      if (state.sourceCountMap) state.sourceCountMap.set(sid, next.length);
    }
  }
  if (Array.isArray(state.hotEntriesCached)) {
    state.hotEntriesCached = state.hotEntriesCached.filter((e) => e && e.id !== id);
  }

  // 3) 若正在读这篇：只清正文，**不**去掉 .reading（避免中栏栅格闪一下）
  if (state.activeEntry?.id === id) {
    state.activeEntry = null;
    const reader = $('#reader');
    if (reader) {
      reader.classList.add('hidden');
      reader.classList.remove(
        'reader--social', 'reader--xhs', 'reader--x', 'reader--bili',
        'reader--syllabus', 'reader--zh-view',
      );
    }
    $('#reader-empty')?.classList.remove('hidden');
    renderAdminEntryControls();
  }

  // 4) 标题 / 侧栏数字：只改 textContent
  if (state.filterSource === 'bili-watchlater') {
    const n = (state.entriesBySource && state.entriesBySource.get('bili-watchlater') || []).length;
    const name = (typeof sourceById === 'function' && sourceById('bili-watchlater')?.name) || 'b站收藏';
    const titleEl = $('#list-title');
    if (titleEl) titleEl.textContent = n ? `${name} · ${n}` : name;
  }
  try {
    const fcount = document.querySelector('.feed-item[data-source-id="bili-watchlater"] .fcount');
    if (fcount) {
      const n = (state.entriesBySource && state.entriesBySource.get('bili-watchlater') || []).length;
      fcount.textContent = n ? String(n) : '';
    }
  } catch { /* ignore */ }
}

/** b站收藏：远端取消（稍后再看/收藏夹）+ 本机移除（不是「已读」） */
async function cancelBiliWatchlaterById(entryId) {
  const id = String(entryId || '').trim();
  if (!id || !canSoftDeleteEntry()) {
    toast('当前无法取消收藏', 3000);
    return false;
  }
  const entry = entryByIdFromList(id)
    || (state.activeEntry?.id === id ? state.activeEntry : null)
    || (state.allEntries || []).find((item) => item && item.id === id)
    || null;
  if (!entry || !isBiliWatchlaterEntry(entry)) {
    if (state.localDroppedEntryIds && state.localDroppedEntryIds.has(id)) return true;
    toast('仅支持 b站收藏', 3000);
    return false;
  }
  const btn = $('#reader-cancel-watchlater');
  const active = state.activeEntry?.id === id;
  if (active && btn) {
    btn.disabled = true;
    btn.textContent = '取消中…';
  }

  // 立刻静默摘卡（无 renderList / merge / 关阅读栅格）
  dropEntryCardSilent(id);
  state.entriesFetchGen = (Number(state.entriesFetchGen) || 0) + 1;

  try {
    await api('/api/bili-watchlater/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: id }),
    });
    // 不 merge、不 toast 刷屏（连续取消时 toast 也会抢眼）
    return true;
  } catch (err) {
    toast('取消收藏失败: ' + err.message, 5000);
    return false;
  } finally {
    if (active && btn) {
      btn.disabled = false;
      btn.textContent = '取消收藏';
    }
    // 不调用 renderAdminEntryControls 以外的重绘；按钮态上面已恢复
    if (!active) renderAdminEntryControls();
  }
}

$('#reader-like').onclick = () => setReaderReaction('like');
const readerRailLike = $('#reader-rail-like');
if (readerRailLike) readerRailLike.onclick = () => setReaderReaction('like');
$('#reader-rail-star').onclick = () => $('#reader-star').click();
$('#reader-rail-comment').onclick = () => scrollReaderTarget('#reader-comments', { offset: 72 });
$('#reader-rail-annotation').onclick = () => {
  const visible = visibleAnnotationsForReader();
  if (visible.length) jumpToAnnotation(visible[0].id);
  else scrollReaderTarget('#reader-annotations', { offset: 72 });
};
$('#reader-rail-translate').onclick = () => handleReaderTab('translation');
const readerTranslateBtn = $('#reader-translate-btn');
if (readerTranslateBtn) readerTranslateBtn.onclick = () => handleReaderTranslateClick();
const readerNoteBtn = $('#reader-note-btn');
if (readerNoteBtn) readerNoteBtn.onclick = () => handleReaderNoteClick();
const readerFetchOriginal = $('#reader-fetch-original');
if (readerFetchOriginal) readerFetchOriginal.onclick = fetchOriginalContent;
$('#reader-delete').onclick = deleteCurrentEntry;
if ($('#reader-cancel-watchlater')) {
  $('#reader-cancel-watchlater').onclick = () => {
    if (state.activeEntry?.id) cancelBiliWatchlaterById(state.activeEntry.id);
  };
}
$('#reader-copy-link').onclick = () => {
  copyReaderContent();
};
const readerPrefsToggle = $('#reader-prefs-toggle');
if (readerPrefsToggle) readerPrefsToggle.onclick = () => setReaderPrefsOpen(!state.readerPrefsOpen);
const readerPrefsClose = $('#reader-prefs-close');
if (readerPrefsClose) readerPrefsClose.onclick = () => setReaderPrefsOpen(false);
const readerAssetsToggle = $('#reader-assets-toggle');
if (readerAssetsToggle) readerAssetsToggle.onclick = () => setReaderAssetsExpanded(!state.readerAssetsExpanded);
$('#reader-toc').onclick = (e) => {
  const link = e.target.closest('a[href^="#reader-section-"]');
  if (!link) return;
  e.preventDefault();
  scrollReaderTarget(link.getAttribute('href'), { offset: 58 });
};
$('#reader-assets').onclick = (e) => {
  const btn = e.target.closest('[data-asset]');
  if (!btn) return;
  jumpToArticleAsset(btn.dataset.asset);
};
$('#reader-asset-summary').onclick = (e) => {
  const copy = e.target.closest('[data-asset-copy]');
  if (copy) {
    copyArticleAssetLink(copy.dataset.assetCopy);
    return;
  }
  const btn = e.target.closest('[data-asset-summary]');
  if (!btn) return;
  jumpToArticleAsset(btn.dataset.assetSummary);
};
$('#reader-bilingual').onclick = () => generateTranslation({ force: Boolean(state.translation) });
$('#translation-helpful').onclick = () => toggleEntryAssetHelpful('translation');
$('#translation-view-toggle').onclick = () => {
  state.translationCompare = !state.translationCompare;
  renderTranslation(state.translation);
};
$('#translation-copy').onclick = copyTranslationText;
$$('.reader-tab').forEach(btn => {
  btn.onclick = () => handleReaderTab(btn.dataset.tab);
});
document.addEventListener('mouseup', (e) => {
  if (e.target.closest('#annotation-popover, #article-link-menu, #content-selection-menu, #agent-pane, #my-dashboard-page, #contributor-page')) return;
  if (articleContentLinkFromTarget(e.target)) {
    suppressAnnotationPopoverForLink();
    return;
  }
  setTimeout(maybeOpenAnnotationPopover, 0);
});
// 正文选区右键：高亮 / 删除（不编辑入库原文）
document.addEventListener('contextmenu', (e) => {
  const root = $('#reader-content');
  if (!root || !state.activeEntry) return;
  if (!root.contains(e.target)) return;
  // 控件 / 图库不抢；链接在无选区时放行浏览器菜单，有选区时仍出高亮/删除（大纲链接密）
  if (e.target.closest('button, input, textarea, select, .x-gallery, .xhs-gallery')) return;
  // 图片右键：显示删除图片菜单
  const imgEl = e.target.closest('img');
  if (imgEl && root.contains(imgEl)) {
    const imgSrc = imgEl.currentSrc || imgEl.src || imgEl.getAttribute('src') || '';
    if (imgSrc) {
      e.preventDefault();
      e.stopPropagation();
      hideEntryContextMenu?.();
      hideSourceContextMenu?.();
      hideArticleLinkMenu?.();
      hideAnnotationPopover?.();
      const payload = {
        entryId: state.activeEntry.id,
        isImage: true,
        imgSrc,
        imgAlt: imgEl.alt || '',
        quote: '',
        prefix: '',
        suffix: '',
        rect: imgEl.getBoundingClientRect(),
      };
      showContentSelectionMenu(payload, e);
      return;
    }
  }
  // 优先：点在高亮上可取消；删除无恢复
  const onMark = e.target.closest('.reader-local-highlight');
  const draft = selectionContentDraft();
  if (!draft && !onMark) return;
  if (!draft && e.target.closest('a')) return;
  e.preventDefault();
  e.stopPropagation();
  hideEntryContextMenu?.();
  hideSourceContextMenu?.();
  hideArticleLinkMenu?.();
  hideAnnotationPopover?.();
  const payload = draft || {
    entryId: state.activeEntry.id,
    quote: '',
    prefix: '',
    suffix: '',
    rect: (onMark || e.target).getBoundingClientRect?.() || { left: e.clientX, bottom: e.clientY, width: 0, height: 0 },
  };
  showContentSelectionMenu(payload, e);
});
$('#content-selection-menu')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-content-action]');
  if (!btn) return;
  e.preventDefault();
  handleContentSelectionAction(btn.dataset.contentAction);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#content-selection-menu')) hideContentSelectionMenu();
});
document.addEventListener('selectionchange', () => {
  if (!window.getSelection()?.isCollapsed) return;
  if ($('#annotation-popover')?.contains(document.activeElement)) return;
  hideAnnotationPopover();
});
$('#annotation-popover-copy').onclick = copyAnnotationSelection;
$('#annotation-popover-send-ai').onclick = sendAnnotationDraftToAgent;
$('#annotation-popover-submit').onclick = submitAnnotationDraft;
$('#annotation-popover-input').onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideAnnotationPopover();
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitAnnotationDraft();
  }
};
function setAnnotationSurfaceFilter(value) {
  state.annotationFilter = value === 'all' || ANNOTATION_SURFACES.includes(value) ? value : 'all';
  storage.setItem('qm_annotation_filter', state.annotationFilter);
  renderAnnotations();
}

$('#annotation-surface-filter').onchange = (e) => {
  setAnnotationSurfaceFilter(e.target.value);
};
$$('[data-context-panel]').forEach(btn => {
  btn.onclick = () => setContextPanel(btn.dataset.contextPanel, { expand: true });
});
$('#context-close').onclick = () => setAgentCollapsed(true);
const articleInfoBody = $('#article-info-body');
if (articleInfoBody) {
  articleInfoBody.onclick = (e) => {
    const copy = e.target.closest('[data-info-copy]');
    if (copy) {
      copyText(copy.dataset.infoCopy || readerUrlFor().href, '文章链接已复制');
      return;
    }
    const fetchBtn = e.target.closest('[data-info-fetch-original]');
    if (fetchBtn && !fetchBtn.disabled) {
      fetchOriginalContent();
      return;
    }
    const asset = e.target.closest('[data-info-asset]');
    if (asset) jumpToArticleAsset(asset.dataset.infoAsset);
  };
}
$('#annotation-discussed-toggle').onclick = () => {
  state.annotationOnlyDiscussed = !state.annotationOnlyDiscussed;
  storage.setItem('qm_annotation_only_discussed', state.annotationOnlyDiscussed ? '1' : '0');
  renderAnnotations();
};
$('#annotation-nav').onclick = (e) => {
  const btn = e.target.closest('[data-annotation-jump]');
  if (btn) jumpToAnnotation(btn.dataset.annotationJump);
};
function handleAnnotationListClick(e) {
  const contributor = e.target.closest('[data-contributor-id]');
  if (contributor) {
    openContributor(contributor.dataset.contributorId);
    return;
  }
  if (e.target.closest('[data-annotation-login]')) {
    return; // 个人模式无登录
  }
  const helpful = e.target.closest('[data-annotation-helpful]');
  if (helpful) {
    toggleAnnotationHelpful(helpful.dataset.annotationHelpful);
    return;
  }
  const focus = e.target.closest('[data-annotation-focus]');
  if (focus) {
    jumpToAnnotation(focus.dataset.annotationFocus);
    return;
  }
  const sendAi = e.target.closest('[data-annotation-send-ai]');
  if (sendAi) {
    sendAnnotationToAgent(sendAi.dataset.annotationSendAi);
    return;
  }
  const link = e.target.closest('[data-annotation-link]');
  if (link) {
    copyAnnotationLink(link.dataset.annotationLink);
    return;
  }
  const copy = e.target.closest('[data-annotation-copy]');
  if (copy) {
    copyAnnotation(copy.dataset.annotationCopy);
    return;
  }
  const del = e.target.closest('[data-annotation-delete]');
  if (del) {
    deleteAnnotation(del.dataset.annotationDelete);
    return;
  }
  const item = e.target.closest('[data-annotation-item]');
  if (item && !e.target.closest('button,textarea,a,input,select')) {
    jumpToAnnotation(item.dataset.annotationItem);
  }
}
$('#annotations-list').onclick = handleAnnotationListClick;
$('#side-annotations-list').onclick = handleAnnotationListClick;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('click', handleAnnotationListClick);
});

function handleAnnotationReplySubmit(e) {
  const form = e.target.closest('[data-annotation-reply-form]');
  if (!form) return;
  e.preventDefault();
  submitAnnotationReply(form.dataset.annotationReplyForm, form);
}
$('#annotations-list').onsubmit = handleAnnotationReplySubmit;
$('#side-annotations-list').onsubmit = handleAnnotationReplySubmit;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('submit', handleAnnotationReplySubmit);
});

function handleAnnotationReplyInput(e) {
  const input = e.target.closest('.annotation-reply-form textarea');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}
$('#annotations-list').oninput = handleAnnotationReplyInput;
$('#side-annotations-list').oninput = handleAnnotationReplyInput;
$$('.annotation-margin').forEach(el => {
  el.addEventListener('input', handleAnnotationReplyInput);
});
$('#annotation-side-focus').onclick = () => {
  if (!state.activeEntry) return;
  if (state.activeAnnotationId) {
    jumpToAnnotation(state.activeAnnotationId);
    return;
  }
  document.getElementById('reader-annotations')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
$('#reader').onclick = (e) => {
  const mark = e.target.closest('.text-annotation-mark');
  if (mark) {
    jumpToAnnotation(mark.dataset.annotationId);
    return;
  }
  if (!e.target.closest('#annotation-popover')) hideAnnotationPopover();
};
$('#comment-form').onsubmit = (e) => {
  e.preventDefault();
  submitComment();
};
$('#comment-tools').onclick = (e) => {
  const btn = e.target.closest('[data-comment-template]');
  if (!btn) return;
  insertCommentTemplate(btn.dataset.commentTemplate);
};
$('#comment-input').oninput = autosizeCommentInput;
$('#comment-input').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitComment();
  }
};
$('#comments-list').onclick = (e) => {
  const contributor = e.target.closest('[data-contributor-id]');
  if (contributor) {
    openContributor(contributor.dataset.contributorId);
    return;
  }
  const helpful = e.target.closest('[data-comment-helpful]');
  if (helpful) {
    toggleCommentHelpful(helpful.dataset.commentHelpful);
    return;
  }
  const link = e.target.closest('[data-comment-link]');
  if (link) {
    copyCommentLink(link.dataset.commentLink);
    return;
  }
  const sendAi = e.target.closest('[data-comment-send-ai]');
  if (sendAi) {
    sendCommentToAgent(sendAi.dataset.commentSendAi);
    return;
  }
  const edit = e.target.closest('[data-comment-edit]');
  if (edit) {
    editComment(edit.dataset.commentEdit);
    return;
  }
  const save = e.target.closest('[data-comment-save]');
  if (save) {
    saveCommentEdit(save.dataset.commentSave);
    return;
  }
  const cancel = e.target.closest('[data-comment-cancel]');
  if (cancel) {
    cancelEditComment(cancel.dataset.commentCancel);
    return;
  }
  const del = e.target.closest('[data-comment-delete]');
  if (del) {
    deleteComment(del.dataset.commentDelete);
    return;
  }
  const btn = e.target.closest('[data-comment-copy]');
  if (!btn) return;
  copyComment(btn.dataset.commentCopy);
};
$('#comments-list').oninput = (e) => {
  const input = e.target.closest('[data-comment-edit-input]');
  if (input) autosizeCommentEditInput(input);
};
$('#comments-list').onkeydown = (e) => {
  const input = e.target.closest('[data-comment-edit-input]');
  if (!input) return;
  const commentId = input.dataset.commentEditInput;
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditComment(commentId);
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveCommentEdit(commentId);
  }
};
$$('.comment-sort-btn').forEach(btn => {
  btn.onclick = () => setCommentSort(btn.dataset.commentSort);
});
// 个人模式：无登录/账号菜单绑定
$('#ai-settings-btn')?.addEventListener('click', () => openAiConfigModal('settings'));
const translationProfileSelect = $('#translation-profile-select');
if (translationProfileSelect) translationProfileSelect.onchange = (e) => setAiProfileForPurpose('translation', e.target.value);
if ($('#my-comments-close')) $('#my-comments-close').onclick = closeMyCommentsModal;
$('#profile-save').onclick = saveProfile;
$('#notifications-read').onclick = markMyNotificationsRead;
$('#profile-refresh-btn').onclick = refreshAll;
$('#profile-manage-btn').onclick = () => {
  closeMyCommentsModal();
  openAdminPage();
};
$('#admin-refresh-btn').onclick = refreshAll;
$('#admin-manage-modal-btn').onclick = () => { renderManage(); $('#manage-modal').classList.remove('hidden'); };
$('#admin-back-dashboard').onclick = () => openMyCommentsModal({ tab: 'profile' });
$('#admin-close').onclick = closeAdminPage;
$('#admin-submission-search-form').onsubmit = (event) => {
  event.preventDefault();
  loadAdminSubmissionUsers($('#admin-submission-search').value).catch(error => toast('搜索用户失败: ' + error.message, 5000));
};
$('#admin-submission-users').onclick = (event) => {
  const row = event.target.closest('[data-admin-user-id]');
  if (row) loadAdminUserSubmissions(row.dataset.adminUserId).catch(error => toast('加载投稿失败: ' + error.message, 5000));
};
$('#admin-submission-requests').onclick = (event) => {
  const action = event.target.closest('[data-review-action]');
  const row = event.target.closest('[data-submission-request-id]');
  if (!action || !row) return;
  reviewAdminSubmissionRequest(row.dataset.submissionRequestId, action.dataset.reviewAction)
    .catch(error => toast('审核投稿失败: ' + error.message, 5000));
};
$('#profile-link-add').onclick = () => {
  state.profileLinksDraft = [...collectProfileLinks(), { title: '', url: '' }].slice(0, 12);
  renderProfileLinksEditor();
};
$('#profile-links-editor').onclick = (e) => {
  const remove = e.target.closest('[data-profile-link-remove]');
  if (!remove) return;
  const index = Number(remove.dataset.profileLinkRemove);
  const links = collectProfileLinks();
  links.splice(index, 1);
  state.profileLinksDraft = links;
  renderProfileLinksEditor();
};
$('#profile-links-editor').oninput = () => {
  state.profileLinksDraft = collectProfileLinks();
};
$$('[data-profile-reader-tab]').forEach(btn => {
  btn.onclick = () => setProfileDefaultReaderTab(btn.dataset.profileReaderTab);
});
$('#profile-avatar-input').onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    state.profileAvatarDraft = await fileToAvatarDataUrl(file);
    renderProfileAvatarPreview();
  } catch (err) {
    toast(err.message, 4000);
  } finally {
    e.target.value = '';
  }
};
$$('#my-dashboard-page [data-my-asset-tab]').forEach(btn => {
  btn.onclick = () => {
    state.myAssetTab = normalizeUserAssetTab(btn.dataset.myAssetTab);
    renderMyAssets();
  };
});
$$('#my-dashboard-page [data-my-asset-sort]').forEach(btn => {
  btn.onclick = () => {
    state.myAssetSort = normalizeUserAssetSort(btn.dataset.myAssetSort);
    storage.setItem('qm_my_asset_sort', state.myAssetSort);
    renderMyAssets();
  };
});
$$('#my-dashboard-page [data-dashboard-tab]').forEach(btn => {
  btn.onclick = () => setDashboardTab(btn.dataset.dashboardTab, { push: true });
});
$('#my-comments-list').onclick = (e) => {
  const open = e.target.closest('[data-my-asset-open]');
  if (open) {
    openMyAsset(open.dataset.myAssetOpen);
    return;
  }
  const contentCopy = e.target.closest('[data-my-asset-copy-content]');
  if (contentCopy) {
    copyMyAssetContent(contentCopy.dataset.myAssetCopyContent);
    return;
  }
  const copy = e.target.closest('[data-my-asset-copy]');
  if (copy) copyMyAssetLink(copy.dataset.myAssetCopy);
};
$('#contributor-close').onclick = () => closeContributorModal();
$('#contributor-follow').onclick = toggleContributorFollow;
$$('#contributor-page [data-contributor-tab]').forEach(btn => {
  btn.onclick = () => {
    state.contributor.tab = normalizeUserAssetTab(btn.dataset.contributorTab);
    renderContributorAssets();
    syncContributorUrl();
    document.title = contributorPageTitle();
  };
});
$$('#contributor-page [data-contributor-asset-sort]').forEach(btn => {
  btn.onclick = () => {
    state.contributor.sort = normalizeContributorAssetSort(btn.dataset.contributorAssetSort);
    renderContributorAssets();
    syncContributorUrl();
    document.title = contributorPageTitle();
  };
});
$('#contributor-list').onclick = (e) => {
  const open = e.target.closest('[data-contributor-asset-open]');
  if (open) {
    openContributorAsset(open.dataset.contributorAssetOpen);
    return;
  }
  const contentCopy = e.target.closest('[data-contributor-asset-copy-content]');
  if (contentCopy) {
    copyContributorAssetContent(contentCopy.dataset.contributorAssetCopyContent);
    return;
  }
  const copy = e.target.closest('[data-contributor-asset-copy]');
  if (copy) copyContributorAssetLink(copy.dataset.contributorAssetCopy);
};
$('#ai-config-close').onclick = closeAiConfigModal;
$('#ai-config-modal').onclick = (e) => { if (e.target.id === 'ai-config-modal') closeAiConfigModal(); };
$('#ai-add-profile').onclick = addAiProfile;
$('#ai-delete-profile').onclick = deleteAiProfile;
$('#ai-profile-form').onsubmit = (e) => {
  e.preventDefault();
  saveAiProfileFromForm();
};
$('#ai-template-list').onclick = (e) => {
  const btn = e.target.closest('.ai-template');
  if (btn) applyAiPreset(btn.dataset.preset);
};
$('#ai-quick-models').onclick = (e) => {
  const btn = e.target.closest('.ai-model-chip');
  if (!btn) return;
  $('#ai-model').value = btn.dataset.model || btn.textContent.trim();
};
$('#ai-max-tokens').oninput = (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ''); };
$('#ai-fetch-models').onclick = fetchAiModels;
$('#ai-test').onclick = testAiConnection;
$('#manage-btn').onclick = () => { renderManage(); $('#manage-modal').classList.remove('hidden'); };
$('#manage-close').onclick = () => $('#manage-modal').classList.add('hidden');
$('#manage-modal').onclick = (e) => { if (e.target.id === 'manage-modal') $('#manage-modal').classList.add('hidden'); };
// 个人模式：无 auth / change-password DOM 绑定
// 投稿入口已内嵌到「个人精选 / GitHub 项目」源行；顶层按钮若仍存在则兼容
if ($('#submit-link-open')) {
  $('#submit-link-open').onclick = () => openSubmitLinkModal({ mode: 'article' });
}
if ($('#submit-github-open')) {
  $('#submit-github-open').onclick = () => openSubmitGitHubModal();
}
$('#submit-link-close').onclick = closeSubmitLinkModal;
$('#submit-link-modal').onclick = (e) => { if (e.target.id === 'submit-link-modal') closeSubmitLinkModal(); };
$('#submit-link-form').onsubmit = (e) => {
  e.preventDefault();
  submitReaderLink();
};

$('#search').oninput = debounce((e) => {
  state.q = e.target.value.trim();
  if (state.view === 'contributors') {
    syncListUrl({ replace: true });
    reload({ clearUrl: false, contributors: true });
    return;
  }
  if (state.view === 'assets') {
    syncListUrl({ replace: true });
    if (state.allEntries.length) {
      paintEntryScope({ clearUrl: false });
      return;
    }
    reload({ clearUrl: false });
    return;
  }
  // 普通列表搜索：本地 filter，无需再打 API
  if (state.allEntries.length) {
    paintEntryScope({ keepReader: true, clearUrl: false });
    return;
  }
  reload({ keepReader: true, clearUrl: false });
}, 350);

$('#theme-toggle').onclick = () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  storage.setItem('fr_theme', next);
};

window.addEventListener('error', (e) => {
  const list = $('#entry-list');
  if (list && !list.querySelector('.entry-card')) {
    list.innerHTML = `<div class="list-empty">页面脚本出错：${escapeHtml(e.message)}<br/>请刷新重试</div>`;
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.account-strip')) setAccountMenuOpen(false);
  if (!e.target.closest('#article-link-menu')) hideArticleLinkMenu();
  if (!e.target.closest('#source-context-menu')) hideSourceContextMenu();
  if (!e.target.closest('#entry-context-menu')) hideEntryContextMenu();
  if (!e.target.closest('#reader-preferences, #reader-prefs-toggle')) setReaderPrefsOpen(false);
});

async function deleteSourceById(sourceId, { reason = 'front-end source delete', confirm = false } = {}) {
  const id = String(sourceId || '').trim();
  if (!id || !canSoftDeleteEntry()) {
    toast('当前无法删除源', 3000);
    return false;
  }
  const source = sourceById(id) || (state.sources || []).find(s => s && s.id === id) || null;
  if (!source) {
    toast('源不存在', 3000);
    return false;
  }
  const name = source.name || id;
  const count = Number(source.entryCount) || (state.allEntries || []).filter(e => e && e.sourceId === id).length || 0;
  // 默认不弹确认；仅显式 confirm:true 才二次确认
  if (confirm) {
    const ok = await showConfirmDialog({
      title: '删除源',
      message: `确认删除「${name}」？将停止同步该网站，并永久删除其全部文章及相关数据${count ? `（约 ${count} 篇）` : ''}。此操作不可撤销。`,
      confirmText: '删除源',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    const result = await api(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const deletedCount = Number(result && result.deletedCount) || 0;
    state.sources = (state.sources || []).map(s => (
      s && s.id === id ? { ...s, enabled: false, entryCount: 0 } : s
    ));
    rebuildSourceMap();
    const drop = (list) => (list || []).filter(item => item && item.sourceId !== id);
    state.entries = drop(state.entries);
    state.allEntries = drop(state.allEntries);
    if (state.activeEntry && state.activeEntry.sourceId === id) {
      closeReaderFromRoute({ rerenderList: false });
    }
    if (state.filterSource === id) {
      state.filterSource = null;
    }
    // 清理本源相关本地阅读状态 id（仅当 entry 仍在 catalog 时无此需求；已从目录剔除）
    rebuildCatalogIndexes();
    applyLocalEntryFilter({ fastBatch: true });
    updateListTitle();
    renderList();
    renderSidebar();
    toast(deletedCount > 0 ? `源已删除，清除 ${deletedCount} 篇` : '源已删除并停止同步');
    return true;
  } catch (err) {
    toast('删除源失败: ' + err.message, 5000);
    return false;
  }
}

const sourceContextMenu = $('#source-context-menu');
if (sourceContextMenu) sourceContextMenu.onclick = async (event) => {
  const action = event.target.closest('[data-source-action]')?.dataset.sourceAction;
  const sourceId = sourceContextId;
  const source = sourceById(sourceId);
  if (!action || !source) return;
  event.preventDefault();
  hideSourceContextMenu();
  if (action === 'open') {
    if (source.siteUrl) window.open(source.siteUrl, '_blank', 'noopener');
    return;
  }
  if (action === 'copy') {
    copyText(source.siteUrl, '博客网址已复制');
    return;
  }
  if (action === 'delete') {
    await deleteSourceById(sourceId, {
      reason: 'personal context source delete',
      confirm: false,
    });
  }
};

const entryContextMenu = $('#entry-context-menu');
if (entryContextMenu) entryContextMenu.onclick = async (event) => {
  const action = event.target.closest('[data-entry-action]')?.dataset.entryAction;
  const entryId = entryContextId;
  if (!action || !entryId) return;
  event.preventDefault();
  hideEntryContextMenu();
  if (action === 'star') {
    toggleEntryStarred(entryId);
    return;
  }
  if (action === 'read') {
    await toggleEntryRead(entryId);
    return;
  }
  if (action === 'cancel-watchlater') {
    await cancelBiliWatchlaterById(entryId);
    return;
  }
  if (action === 'delete') {
    await deleteEntryById(entryId, {
      reason: 'personal context delete',
      confirm: false,
    });
  }
};

function isShortcutEditableTarget(target) {
  const el = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
  if (!el) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

function readerNavClass(direction, phase) {
  const dir = direction > 0 ? 'next' : 'prev';
  return `reader-nav-${phase}-${dir}`;
}

function clearReaderNavClasses(reader = $('#reader')) {
  if (!reader) return;
  reader.classList.remove(
    'reader-nav-exit-next',
    'reader-nav-exit-prev',
    'reader-nav-enter-next',
    'reader-nav-enter-prev',
    'reader-nav-edge-next',
    'reader-nav-edge-prev',
  );
}

function pulseReaderNavEdge(direction) {
  const reader = $('#reader');
  if (!reader) return;
  const cls = readerNavClass(direction, 'edge');
  clearReaderNavClasses(reader);
  reader.classList.add(cls);
  setTimeout(() => reader.classList.remove(cls), 260);
}

async function openVisibleEntryWithMotion(entry, direction) {
  if (!entry || state.readerNavBusy) return;
  state.readerNavBusy = true;
  const reader = $('#reader');
  clearReaderNavClasses(reader);
  reader?.classList.add(readerNavClass(direction, 'exit'));
  try {
    await delay(120);
    await openEntry(entry);
    const nextReader = $('#reader');
    clearReaderNavClasses(nextReader);
    nextReader?.classList.add(readerNavClass(direction, 'enter'));
    setTimeout(() => clearReaderNavClasses(nextReader), 280);
  } finally {
    state.readerNavBusy = false;
  }
}

function moveVisibleEntry(delta, { notifyEdge = false } = {}) {
  const list = visibleEntries();
  if (!list.length) {
    if (notifyEdge) toast('当前列表没有文章');
    return;
  }
  const idx = list.findIndex(item => item.id === state.activeEntry?.id);
  const fallback = delta > 0 ? 0 : list.length - 1;
  if (idx < 0 && state.activeEntry) {
    if (notifyEdge) toast('当前文章不在当前列表');
    return;
  }
  const nextIndex = idx < 0 ? fallback : idx + delta;
  if (nextIndex < 0 || nextIndex >= list.length) {
    if (notifyEdge) toast(delta > 0 ? '已是当前列表最后一篇' : '已是当前列表第一篇');
    pulseReaderNavEdge(delta);
    return;
  }
  const next = list[nextIndex];
  if (!next || next.id === state.activeEntry?.id) {
    if (notifyEdge) toast(delta > 0 ? '已是当前列表最后一篇' : '已是当前列表第一篇');
    pulseReaderNavEdge(delta);
    return;
  }
  openVisibleEntryWithMotion(next, delta);
}

function moveReaderVersion(delta) {
  if (!state.activeEntry) return;
  const idx = READER_NAV_TABS.indexOf(state.readerTab);
  const next = READER_NAV_TABS[((idx < 0 ? 0 : idx) + delta + READER_NAV_TABS.length) % READER_NAV_TABS.length];
  handleReaderTab(next);
}

document.addEventListener('keydown', (e) => {
  const editable = isShortcutEditableTarget(e.target);
  if (e.key === 'Escape') {
    if (state.readerImmersive) setReaderImmersive(false);
    setReaderPrefsOpen(false);
    document.getElementById('app').classList.remove('reading');
    setAccountMenuOpen(false);
    $('#manage-modal').classList.add('hidden');
    $('#ai-config-modal').classList.add('hidden');
    $('#submit-link-modal').classList.add('hidden');
    $('#agent-prompt-modal').classList.add('hidden');
    hideArticleLinkMenu();
    hideSourceContextMenu();
    hideEntryContextMenu();
    if (state.workspacePage === 'dashboard') closeMyCommentsModal();
    else if (state.workspacePage === 'contributor') closeContributorModal();
    else if (state.workspacePage === 'admin') closeAdminPage();
    return;
  }
  if (editable || e.metaKey || e.ctrlKey) return;
  if (e.key === 'j' || (e.key === 'ArrowDown' && e.target.closest('#entry-pane'))) {
    e.preventDefault();
    moveVisibleEntry(1, { notifyEdge: e.key === 'j' });
    return;
  }
  if (e.key === 'k' || (e.key === 'ArrowUp' && e.target.closest('#entry-pane'))) {
    e.preventDefault();
    moveVisibleEntry(-1, { notifyEdge: e.key === 'k' });
    return;
  }
  if (state.activeEntry && e.key === 'ArrowRight') {
    e.preventDefault();
    moveVisibleEntry(1, { notifyEdge: true });
    return;
  }
  if (state.activeEntry && e.key === 'ArrowLeft') {
    e.preventDefault();
    moveVisibleEntry(-1, { notifyEdge: true });
    return;
  }
  if (!state.activeEntry) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    if (state.activeEntry) toggleEntryStarred(state.activeEntry.id);
  } else if (key === 'c') {
    e.preventDefault();
    $('#reader-copy-link')?.click();
  }
});

window.addEventListener('popstate', () => {
  openEntryFromUrl();
});

// resize 每帧至多一次：布局归一化涉及 getBoundingClientRect，避免连续 reflow
window.addEventListener('resize', rafThrottle(() => {
  hideArticleLinkMenu();
  normalizeReaderWorkbenchLayout();
  // Zen：列宽完全交给 CSS 固定像素，resize 绝不写 --entry-width（避免开文后缩放感）
  $('#app')?.style.removeProperty('--entry-width');
  $('#app')?.style.removeProperty('--agent-width');
}));
// scroll：课程继续阅读 + hideArticleLinkMenu 已在上方合并

/* ---------- Init ---------- */
(async function init() {
  document.body.dataset.theme = storage.getItem('fr_theme') || 'light';
  document.body.classList.add('zen-personal');
  // 空闲时预取 DOMPurify，首篇打开不卡脚本下载
  const prefetchSanitize = () => { ensureDomPurify().catch(() => {}); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchSanitize, { timeout: 4000 });
  else setTimeout(prefetchSanitize, 2500);
  // 自用：右 AI 永久收起；左源栏/文章列表尊重用户上次收起状态；默认原文
  state.agentCollapsed = true;
  storage.setItem('qm_agent_collapsed', '1');
  state.defaultReaderTab = 'original';
  if (state.readerImmersive) {
    state.readerImmersive = false;
    storage.setItem('qm_reader_immersive', '0');
  }
  hydrateLucideIcons();
  loadAiProfilesForScope();
  renderAgentPrompts();
  applyReaderPrefs();
  renderAiSettings();
  renderAuthState();
  setSidebarCollapsed(state.sidebarCollapsed);
  setLeftCollapsed(state.leftCollapsed);
  // Zen：不写动态 --entry-width，列宽完全交给 CSS 固定值（开文不缩放）
  $('#app')?.style.removeProperty('--entry-width');
  setupListResizer();
  setupContextResizer();
  setAgentCollapsed(true);
  setContextPanel(state.contextPanel, { persist: false, expand: false });
  $('#entry-list').innerHTML = '<div class="list-empty">正在加载订阅内容…</div>';
  try {
    const boot = await Promise.all([
      loadSources(),
      loadEntries(),
    ]);
    const data = boot[0];
    // 源数据一到就先画左侧博客列表，避免深链/竞态漏渲染导致空白
    updateListTitle();
    renderSidebar();
    renderList();
    // 深链开文：目录已齐再开，失败时 openEntryFromUrl 内会再试
    await openEntryFromUrl({ reuseLoadedCollections: true });
    // first boot: server may still be fetching — poll a few times
    if (data.refreshing || state.entries.length === 0) {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const d = await loadSources();
        if (!d.refreshing && state.entries.length) break;
        if (!d.refreshing) break;
      }
      await Promise.all([loadEntries(), loadContributors()]);
      // 启动灌盘/扫盘后补一次深链（首次因空目录未打开时）
      if (!state.activeEntry && routeStateFromUrl().entryId) {
        await openEntryFromUrl({ reuseLoadedCollections: true });
      }
    }
    // 无论是否深链开文，最终都保证侧栏+列表在屏上
    updateListTitle();
    renderSidebar();
    if (!state.activeEntry) renderList();
    else updateSidebarNavCounts();
    // 硬刷新后：若「全部」漏了 X/小红书/知乎（cache 竞态或 ingest 稍后完成），对账补齐
    reconcileLocalCatalogAfterBoot().catch(() => {});
  } catch (e) {
    toast('加载失败: ' + e.message, 5000);
    $('#entry-list').innerHTML = `<div class="list-empty">数据加载失败：${escapeHtml(e.message)}<br/><button class="ghost-btn" onclick="location.reload()" style="margin-top:10px">重新加载</button></div>`;
  }
})();
