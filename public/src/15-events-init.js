
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
  syncEntriesRead(ids);
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
$('#toc-fab').onclick = () => {
  const panel = $('#toc-panel');
  setTocPanelOpen(Boolean(panel && panel.classList.contains('hidden')));
};
$('#toc-panel-list').onclick = (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  e.preventDefault();
  // offset 要大于 scroll-spy 的 top rootMargin(72px)，让目标标题落进高亮带
  scrollReaderTarget(link.getAttribute('href'), { offset: 84 });
};
const readerPaneScroller = $('#reader-pane');
let readerProgressRaf = 0;
const updateReaderProgress = () => {
  const max = readerPaneScroller.scrollHeight - readerPaneScroller.clientHeight;
  const ratio = max > 0 ? Math.min(1, readerPaneScroller.scrollTop / max) : 0;
  const bar = $('#reader-progress');
  if (bar) bar.style.transform = `scaleX(${ratio})`;
  const label = $('#toc-progress');
  if (label) label.textContent = `${Math.round(ratio * 100)}%`;
};
readerPaneScroller.addEventListener('scroll', () => {
  if (readerProgressRaf) return;
  readerProgressRaf = requestAnimationFrame(() => {
    readerProgressRaf = 0;
    updateReaderProgress();
  });
}, { passive: true });
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
    return; // 主应用已由服务端 owner Session 保护
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
// 固定 owner：主应用只提供退出，登录由 /login 页面处理。
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
$('#admin-manage-modal-btn').onclick = () => { renderManage(); setSubscriptionFormOpen(false); $('#manage-modal').classList.remove('hidden'); };
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
$('#manage-btn').onclick = () => { renderManage(); setSubscriptionFormOpen(false); $('#manage-modal').classList.remove('hidden'); };
$('#manage-add-source').onclick = () => setSubscriptionFormOpen($('#subscription-form').classList.contains('hidden'));
$('#subscription-form').onsubmit = (event) => {
  event.preventDefault();
  submitCustomSubscription();
};
$('#manage-close').onclick = () => {
  setSubscriptionFormOpen(false);
  $('#manage-modal').classList.add('hidden');
};
$('#manage-modal').onclick = (e) => { if (e.target.id === 'manage-modal') $('#manage-modal').classList.add('hidden'); };
$('#logout-btn')?.addEventListener('click', logout);
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
  if (!e.target.closest('#toc-float')) setTocPanelOpen(false);
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
    setTocPanelOpen(false);
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
  try {
    await loadMe();
  } catch {
    return;
  }
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
