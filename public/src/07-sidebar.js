
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
