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

