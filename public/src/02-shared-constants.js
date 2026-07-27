
const CATEGORY_LABELS = { article: '文章', news: '资讯', podcast: '播客' };
const READER_TABS = ['original', 'translation'];
const READER_NAV_TABS = ['original'];
const DEFAULT_READER_OPEN_TAB = 'original';
const READER_OPEN_TABS = ['original'];

/** 固定单 owner 模式；登录由服务端页面和 Session 处理。 */
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
