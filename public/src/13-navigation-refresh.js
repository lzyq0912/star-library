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
