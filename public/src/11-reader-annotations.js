
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

