
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
