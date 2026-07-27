
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
