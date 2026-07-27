
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
    hasApiKey: Boolean(raw && (raw.hasApiKey || raw.has_api_key || raw.apiKey || raw.api_key)),
    apiKeyMasked: String(raw && (raw.apiKeyMasked || raw.api_key_masked) || '').trim(),
    serverPersisted: Boolean(raw && raw.serverPersisted),
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
