
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

// bundle 由 esbuild 打成 IIFE，顶层函数声明不会挂到全局；
// 内联 onerror="fallbackFavicon(...)" 需要 window 上可访问，否则 ReferenceError。
window.fallbackFavicon = fallbackFavicon;

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
