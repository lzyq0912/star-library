function setReaderTab(tab, { syncUrl = true, replaceUrl = true } = {}) {
  const next = normalizeReaderTab(tab);
  state.readerTab = next;
  $$('.reader-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === next));
  $('#reader-original-panel').classList.toggle('hidden', next !== 'original');
  $('#reader-translation').classList.toggle('hidden', next !== 'translation');
  $('#reader-rewrite-panel').classList.toggle('hidden', next !== 'rewrite');
  updateReaderTocVisibility(next);
  updateReaderLanguageProfile();
  applyTextAnnotations();
  if (syncUrl) syncReaderUrl({ replace: replaceUrl });
}

function handleReaderTab(tab, { preserveFocus = false, replaceUrl = true } = {}) {
  if (!preserveFocus) {
    state.readerFocus = null;
    state.readerAssetId = '';
  }
  setReaderTab(tab, { replaceUrl });
}

function maybeGenerateRewriteAfterLoad() {
  state.pendingRewriteGenerate = false;
}

function entryAssetHasContent(type, asset) {
  if (type === 'translation') return Boolean(asset && Array.isArray(asset.content) && asset.content.length);
  if (type === 'rewrite') return Boolean(asset && asset.body);
  return false;
}

function assetPreviewFromCurrent(type, asset) {
  if (!entryAssetHasContent(type, asset)) return null;
  const text = type === 'translation'
    ? asset.content.map(translationPairText).find(Boolean)
    : asset.body;
  const previewText = assetSummaryText(text || '');
  if (!previewText) return null;
  return {
    type,
    id: asset.id || state.readerAssetId || '',
    role: '',
    author: asset.createdBy || '',
    title: type === 'translation' ? asset.titleZh || '' : asset.title || '',
    model: asset.model || '',
    text: previewText,
    at: Number(asset.updatedAt || asset.createdAt || 0) || Date.now(),
    helpfulCount: Number(asset.helpfulCount) || 0,
  };
}

function topHelpfulAssetPreview(items) {
  return items
    .filter(item => item && Number(item.helpfulCount || 0) > 0)
    .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))[0] || null;
}

function helpfulAiAssetItemCount(assets, type) {
  const items = assets && assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
  if (items.length) {
    return items.reduce((sum, item) => sum + (Number(item && item.helpfulCount) > 0 ? 1 : 0), 0);
  }
  const count = type === 'translation' ? assets && assets.translationHelpfulCount : assets && assets.rewriteHelpfulCount;
  return Number(count) > 0 ? 1 : 0;
}

function entryAssetHelpfulPatch(type, asset, entry = state.activeEntry) {
  const assets = mergeAssets(entry);
  const nextCount = Number(asset && asset.helpfulCount) || 0;
  const commentHelpfulCount = Number(assets.commentHelpfulCount) || 0;
  const chatHelpfulCount = Number(assets.chatHelpfulCount) || 0;
  const previews = { ...(assets.previews || {}) };
  const preview = assetPreviewFromCurrent(type, asset) || previews[type] || null;
  const assetId = String((asset && asset.id) || state.readerAssetId || '').trim();
  const items = { ...(assets.items || {}) };
  let typeItems = Array.isArray(items[type]) ? items[type].map(item => ({ ...item })) : [];
  if (preview && assetId) {
    let found = false;
    typeItems = typeItems.map(item => {
      if (item.id !== assetId) return item;
      found = true;
      return { ...item, ...preview, id: assetId, helpfulCount: nextCount };
    });
    if (!found) typeItems.unshift({ ...preview, id: assetId, helpfulCount: nextCount });
    items[type] = typeItems;
  }
  if (preview) {
    const currentPreview = previews[type];
    const shouldUpdatePreview = !assetId
      || !currentPreview
      || currentPreview.id === assetId
      || Number(preview.at || 0) >= Number(currentPreview.at || 0);
    if (shouldUpdatePreview) previews[type] = { ...preview, helpfulCount: nextCount };
  }
  const typeHelpfulCount = typeItems.length
    ? typeItems.reduce((sum, item) => sum + (Number(item.helpfulCount) || 0), 0)
    : nextCount;
  const translationHelpfulCount = type === 'translation' ? typeHelpfulCount : Number(assets.translationHelpfulCount) || 0;
  const rewriteHelpfulCount = type === 'rewrite' ? typeHelpfulCount : Number(assets.rewriteHelpfulCount) || 0;

  const topHelpfulTranslation = type === 'translation'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.translation])
    : assets.topHelpfulTranslation;
  const topHelpfulRewrite = type === 'rewrite'
    ? topHelpfulAssetPreview(typeItems.length ? typeItems : [previews.rewrite])
    : assets.topHelpfulRewrite;
  const topHelpfulAsset = topHelpfulAssetPreview([
    topHelpfulTranslation,
    topHelpfulRewrite,
    assets.topHelpfulComment,
    assets.topHelpfulChat,
  ]);
  const primaryPreview = preview && (
    !assets.preview
    || assets.preview.type === type
    || Number(preview.at || 0) >= Number(assets.preview.at || 0)
  ) ? previews[type] : assets.preview;

  return {
    [type]: entryAssetHasContent(type, asset) || Boolean(assets[type]),
    items,
    previews,
    preview: primaryPreview || null,
    translationHelpfulCount,
    rewriteHelpfulCount,
    helpfulAssets: helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'translation')
      + helpfulAiAssetItemCount({ ...assets, items, translationHelpfulCount, rewriteHelpfulCount }, 'rewrite'),
    helpfulCount: translationHelpfulCount + rewriteHelpfulCount + commentHelpfulCount + chatHelpfulCount,
    topHelpfulTranslation,
    topHelpfulRewrite,
    topHelpfulAsset,
  };
}

function renderAssetHelpfulButton(type, asset) {
  const btn = $(`#${type}-helpful`);
  if (!btn) return;
  const hasContent = entryAssetHasContent(type, asset);
  btn.classList.toggle('hidden', !hasContent);
  btn.disabled = !hasContent;
  if (!hasContent) {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '有用';
    return;
  }
  const helpfulCount = Number(asset.helpfulCount) || 0;
  const active = Boolean(asset.helpfulByMe);
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.textContent = helpfulCount ? `有用 ${helpfulCount}` : '有用';
  btn.title = active ? '取消有用标记' : '觉得这个资产有用';
}

function renderTranslation(translation, { loading = false } = {}) {
  const hasContent = Boolean(translation && Array.isArray(translation.content) && translation.content.length);
  state.translation = hasContent ? translation : null;
  renderReaderStatsUi();
  const list = $('#translation-list');
  const empty = $('#translation-empty');
  const emptyText = empty.querySelector('p');
  const action = $('#reader-bilingual');
  const mode = $('#translation-view-toggle');
  const copy = $('#translation-copy');
  list.innerHTML = '';
  list.classList.toggle('translation-compare', state.translationCompare);
  list.classList.toggle('translation-zh', !state.translationCompare);
  mode.classList.toggle('hidden', !hasContent);
  mode.disabled = !hasContent;
  mode.classList.toggle('active', Boolean(state.translationCompare));
  mode.setAttribute('aria-pressed', state.translationCompare ? 'true' : 'false');
  mode.textContent = state.translationCompare ? '纯中文' : '对照';
  mode.title = state.translationCompare ? '切回纯中文译文' : '显示双语对照';
  copy.classList.toggle('hidden', !hasContent);
  copy.disabled = !hasContent;
  renderAssetHelpfulButton('translation', state.translation);
  if (loading) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '正在检查这篇文章的翻译缓存…';
    action.disabled = true;
    action.textContent = '检查中…';
    $('#translation-meta').textContent = '检查中';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  if (!hasContent) {
    empty.classList.remove('hidden');
    if (emptyText) emptyText.textContent = '这篇文章还没有中文翻译。';
    action.disabled = false;
    action.textContent = '生成中文翻译';
    $('#translation-meta').textContent = '暂无';
    renderAssetHelpfulButton('translation', null);
    return;
  }
  empty.classList.add('hidden');
  action.disabled = false;
  action.textContent = translation.stale ? '更新中文翻译' : '重新生成中文翻译';
  $('#translation-meta').textContent = [translation.stale ? '原文已更新' : '', translation.createdBy, translation.model, formatAssetTime(translation.updatedAt)].filter(Boolean).join(' · ');
  renderAssetHelpfulButton('translation', state.translation);
  const blocks = enrichedTranslationBlocks(translation);
  list.innerHTML = blocks.map(pair => state.translationCompare
    ? `<div class="translation-pair">
        <div class="translation-source">${pair.sourceHtml ? sanitize(pair.sourceHtml) : `<p>${escapeHtml(pair.source || '')}</p>`}</div>
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`
    : `<div class="translation-block">
        <div class="translation-target reader-content">${translationBlockTargetHtml(pair)}</div>
      </div>`).join('');
  $$('#translation-list a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('translation');
}

function copyTranslationText() {
  const translation = state.translation;
  const lines = translation && Array.isArray(translation.content)
    ? translation.content.map(translationPairText).filter(Boolean)
    : [];
  copyText(lines.join('\n\n'), '译文已复制');
}

async function loadTranslation(entry) {
  state.translationLoading = true;
  renderTranslation(null, { loading: true });
  updateReaderTranslateButton(entry);
  try {
    const assetId = state.readerFocus === 'translation' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/translation${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderTranslation(data.translation);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      rememberTranslation(entry.id, data.translation);
      syncCatalogFromTranslation(entry.id, data.translation);
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
      // 有可展示译文就默认贴简中（stale 不挡）
      if (shouldOpenInZhView(entry.id, true) && translationHasDisplayableZh(data.translation)) {
        setEntryZhViewPref(entry.id, true);
        await applyZhArticleView(entry, data.translation);
      }
      renderList();
    }
  } catch {
    renderTranslation(null);
  } finally {
    state.translationLoading = false;
    updateReaderTranslateButton(state.activeEntry);
    if (state.pendingTranslationGenerate && state.activeEntry?.id === entry.id && state.readerTab === 'translation' && !state.translation) {
      state.pendingTranslationGenerate = false;
      generateTranslation();
    }
  }
}

/** 客户端译文内存缓存（避免重复 GET/POST） */
const translationMemory = new Map();

function rememberTranslation(entryId, translation) {
  const id = String(entryId || '').trim();
  if (!id || !translationHasContent(translation)) return;
  translationMemory.set(id, translation);
}

function rememberedTranslation(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const hit = translationMemory.get(id);
  return translationHasContent(hit) ? hit : null;
}

function readZhViewPrefMap() {
  const raw = readJson(READER_ZH_VIEW_KEY, '{}');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** null=未记录, true=偏好简中, false=用户显式要原文 */
function getEntryZhViewPref(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const map = readZhViewPrefMap();
  if (!Object.prototype.hasOwnProperty.call(map, id)) return null;
  return Boolean(map[id]);
}

function setEntryZhViewPref(entryId, zh) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const map = readZhViewPrefMap();
  map[id] = Boolean(zh);
  storage.setItem(READER_ZH_VIEW_KEY, JSON.stringify(map));
}

/**
 * 有服务端/内存译文时：默认永远开简中（列表卡 + 正文）。
 * 「原文」仅本次阅读临时切换，关掉再开 / 切卡再回来仍回中文。
 */
function shouldOpenInZhView(entryId, hasTranslation) {
  return Boolean(hasTranslation);
}

/**
 * 译文是否可默认展示为简中。
 * 规则：只要有 content 块就展示——stale 只表示可点「更新」，绝不挡默认简中。
 */
function translationHasDisplayableZh(translation) {
  return translationHasContent(translation);
}

/** GET 服务端永久缓存，不触发 Gemini */
async function fetchTranslationCache(entry) {
  if (!entry || !entry.id) return null;
  const mem = rememberedTranslation(entry.id);
  // 内存有可展示中文：直接用（含 soft-stale）
  if (mem && translationHasDisplayableZh(mem)) return mem;
  const data = await api(`/api/entry/${entry.id}/translation`);
  const has = data.translation && Array.isArray(data.translation.content) && data.translation.content.length;
  if (!has) return null;
  // 永久进内存：含 stale 标记的译文也缓存，默认展示简中不因 stale 丢弃
  rememberTranslation(entry.id, data.translation);
  return data.translation;
}

/**
 * 开文默认贴简中：内存 → 预取 Promise → 服务端缓存 → applyZh。
 * 有译文块就贴中文（切卡 / stale 一样）；无译文返回 false。
 * @param {object} [opts.prefetch] 已启动的 GET translation Promise，避免重复请求
 * @returns {Promise<boolean>} 是否已贴上简中
 */
async function ensureDefaultZhView(entry, { openGen = state.openGen, prefetch = null } = {}) {
  if (!entry || !entry.id) return false;
  const stillHere = () => (
    openGen === state.openGen
    && state.activeEntry?.id === entry.id
  );
  state.translationLoading = true;
  updateReaderTranslateButton(entry);
  try {
    let translation = null;
    // 1) 当前 state / 内存缓存
    if (translationHasDisplayableZh(state.translation)
      && String((state.translation && state.translation.entryId) || entry.id) === entry.id) {
      translation = state.translation;
    }
    if (!translationHasDisplayableZh(translation)) {
      translation = rememberedTranslation(entry.id);
    }
    // 2) 开文时并行预取的 Promise
    if (!translationHasDisplayableZh(translation) && prefetch) {
      try {
        const pre = await prefetch;
        if (translationHasDisplayableZh(pre)) translation = pre;
      } catch { /* fallthrough */ }
    }
    // 3) 服务端永久缓存
    if (!translationHasDisplayableZh(translation)) {
      try {
        translation = await fetchTranslationCache(entry);
      } catch {
        translation = rememberedTranslation(entry.id);
      }
    }
    if (!stillHere()) return false;

    if (!translationHasDisplayableZh(translation)) {
      if (translation && (translation.titleZh || translation.summaryZh)) {
        syncCatalogFromTranslation(entry.id, translation);
      }
      if (!translationHasContent(translation)) state.translation = null;
      updateReaderTranslateButton(entry);
      return false;
    }

    state.translation = translation;
    rememberTranslation(entry.id, translation);
    syncCatalogFromTranslation(entry.id, translation);
    // 有译文：永远默认简中（「原文」只是本次临时，下次开文仍中文）
    setEntryZhViewPref(entry.id, true);
    await applyZhArticleView(entry, translation, { openGen });
    if (!stillHere()) return false;
    updateReaderTranslateButton(entry);
    return Boolean(state.readerZhMode);
  } catch (err) {
    console.warn('ensureDefaultZhView failed', err);
    if (stillHere()) {
      const mem = rememberedTranslation(entry.id);
      if (translationHasDisplayableZh(mem)) {
        try {
          state.translation = mem;
          await applyZhArticleView(entry, mem, { openGen });
          return Boolean(state.readerZhMode);
        } catch { /* fallthrough */ }
      }
      updateReaderTranslateButton(entry);
    }
    return false;
  } finally {
    if (stillHere()) {
      state.translationLoading = false;
      updateReaderTranslateButton(state.activeEntry);
    } else {
      state.translationLoading = false;
    }
  }
}

/** 兼容旧名：静默拉翻译缓存并默认贴简中 */
async function loadTranslationForZenButton(entry) {
  return ensureDefaultZhView(entry);
}

function rewriteMetaText(rewrite) {
  if (!rewrite || !rewrite.body) return '';
  return [
    rewrite.stale ? '原文/链接已更新' : '',
    rewrite.model || DEFAULT_REWRITE_MODEL,
    formatAssetTime(rewrite.updatedAt),
  ].filter(Boolean).join(' · ');
}

function renderRewrite(rewrite) {
  state.rewrite = rewrite || null;
  const copyTextForEntry = rewriteUiCopy();
  updateRewriteUiLabels();
  renderReaderStatsUi();
  const content = $('#rewrite-content');
  const empty = $('#rewrite-empty');
  const copy = $('#rewrite-copy');
  const action = $('#reader-rewrite');
  const meta = $('#rewrite-meta');
  content.innerHTML = '';
  copy.classList.toggle('hidden', !rewrite || !rewrite.body);
  copy.disabled = !rewrite || !rewrite.body;
  renderAssetHelpfulButton('rewrite', state.rewrite);
  if (!rewrite || !rewrite.body) {
    empty.classList.remove('hidden');
    if (meta) {
      meta.textContent = '';
      meta.classList.add('hidden');
    }
    if (action) {
      action.textContent = copyTextForEntry.action;
      action.title = copyTextForEntry.generateTitle;
    }
    renderAssetHelpfulButton('rewrite', null);
    return;
  }
  empty.classList.add('hidden');
  const metaText = rewriteMetaText(rewrite);
  if (action) {
    action.textContent = rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
    action.title = [rewrite.stale ? copyTextForEntry.updateTitle : copyTextForEntry.redoTitle, metaText].filter(Boolean).join(' · ');
  }
  if (meta) {
    meta.textContent = metaText;
    meta.classList.add('hidden');
  }
  renderAssetHelpfulButton('rewrite', state.rewrite);
  content.innerHTML = renderMarkdownLite(rewrite.body);
  $$('#rewrite-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  updateReaderLanguageProfile();
  applyTextAnnotations();
  renderReaderAssetSummary();
  settlePendingAssetJump('rewrite');
}

function copyRewriteText() {
  copyText(state.rewrite && state.rewrite.body, rewriteUiCopy().copied);
}

async function loadRewrite(entry) {
  state.rewriteLoading = true;
  renderRewrite(null);
  try {
    const assetId = state.readerFocus === 'rewrite' ? state.readerAssetId : '';
    const query = assetId ? `?assetId=${encodeURIComponent(assetId)}` : '';
    const data = await api(`/api/entry/${entry.id}/rewrite${query}`);
    if (state.activeEntry?.id !== entry.id) return;
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
  } catch {
    renderRewrite(null);
  } finally {
    state.rewriteLoading = false;
    if (state.activeEntry?.id === entry.id) maybeGenerateRewriteAfterLoad(entry);
  }
}

async function toggleEntryAssetHelpful(type) {
  const entry = state.activeEntry;
  const asset = type === 'translation' ? state.translation : type === 'rewrite' ? state.rewrite : null;
  if (!entry || !entryAssetHasContent(type, asset)) return;
  const btn = $(`#${type}-helpful`);
  const nextHelpful = !asset.helpfulByMe;
  const assetId = String(asset.id || state.readerAssetId || '').trim();
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/entry/${entry.id}/assets/${encodeURIComponent(type)}/helpful`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: nextHelpful, assetId }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    const nextAsset = state.readerAssetId && (type === 'translation' || type === 'rewrite')
      ? { ...asset, ...(data.reaction || {}) }
      : data[type] || { ...asset, ...(data.reaction || {}) };
    if (type === 'translation') renderTranslation(nextAsset);
    if (type === 'rewrite') renderRewrite(nextAsset);
    updateEntryAssets(entry.id, entryAssetHelpfulPatch(type, nextAsset, state.activeEntry), { rerenderList: false });
    renderList();
    toast(nextHelpful ? '已标记有用' : '已取消有用标记');
  } catch (err) {
    toast('反馈失败: ' + err.message, 5000);
  } finally {
    renderAssetHelpfulButton(type, type === 'translation' ? state.translation : state.rewrite);
  }
}

/** X 收藏：仅长文（Article）走结构翻译；短推/图帖不翻。返回可译的 social payload 或 null */
function xTranslatableArticlePayload(entry) {
  if (!entry) return null;
  const sid = String(entry.sourceId || '');
  if (sid !== 'x-likes') return null;
  const content = contentCache.get(entry.id) || entry.content || '';
  const social = parseSocialPayload(content);
  if (!social || (social.platform && social.platform !== 'x')) return null;
  const isArticle = social.kind === 'article'
    || social.isArticle === true
    || Boolean(xArticleHeadingFromBody(String(social.body || '')));
  return isArticle ? social : null;
}

/** 判断是否显示翻译按钮：英文原文，或已有永久译文缓存（切回原文后仍要能切） */
function isEnglishArticle(entry) {
  if (!entry) return false;
  // 社交流（小红书）不走这篇结构翻译；X 收藏仅长文（Article）放行；GitHub 项目允许翻译 README/简介
  const sid = String(entry.sourceId || '');
  if (sid === 'xhs-likes' || /^xhs-/.test(sid)) return false;
  let xArticle = null;
  if (sid === 'x-likes') {
    xArticle = xTranslatableArticlePayload(entry);
    if (!xArticle) return false;
  }
  // 课程库：一律当「可译」→ 默认简中 + 显示切换
  if (sid === 'zen-recent' || (typeof isSyllabusEntry === 'function' && isSyllabusEntry(entry))) {
    return true;
  }
  // 已有译文 / 列表已有中文标题摘要 / 资产标：始终显示切换，并走默认简中
  if (entry.id && (
    translationHasContent(state.translation)
    || rememberedTranslation(entry.id)
    || getEntryZhViewPref(entry.id) !== null
    || String(entry.titleZh || '').trim()
    || String(entry.summaryZh || '').trim()
    || (entry.assets && entry.assets.translation)
  )) {
    return true;
  }
  const title = String(entry.title || '');
  // X 长文：英文判定用正文 Markdown，不含 qm-social JSON 头
  const body = xArticle
    ? String(xArticle.body || '').slice(0, 4000)
    : String(contentCache.get(entry.id) || entry.content || entry.summary || '').slice(0, 4000);
  const sample = `${title}\n${body}`;
  const latin = sample.match(/\p{Script=Latin}/gu) || [];
  const cjk = sample.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
  return latin.length >= 24 && latin.length / Math.max(1, latin.length + cjk.length) >= 0.55;
}

function translationHasContent(translation = state.translation) {
  return Boolean(translation && Array.isArray(translation.content) && translation.content.length);
}

function updateReaderTranslateButton(entry = state.activeEntry) {
  // 顶栏按钮 + X 社交卡内按钮（data-x-translate）状态保持一致
  const buttons = [$('#reader-translate-btn'), ...$$('[data-x-translate]')].filter(Boolean);
  if (typeof updateReaderNoteButton === 'function') updateReaderNoteButton(entry);
  if (!buttons.length) return;
  // 笔记视图下隐藏翻译切换，避免出现两个「原文」按钮
  const english = isEnglishArticle(entry) && !state.readerNoteMode;
  const apply = (fn) => buttons.forEach(fn);
  apply(btn => btn.classList.toggle('hidden', !english));
  if (!english) {
    apply((btn) => {
      btn.disabled = false;
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  const hasCached = translationHasContent()
    || Boolean(entry && rememberedTranslation(entry.id));
  const busy = Boolean(state.translationGenerating || (state.translationLoading && !hasCached));
  apply(btn => { btn.disabled = busy; });
  if (busy) {
    apply((btn) => {
      btn.textContent = state.translationGenerating ? '翻译中…' : '检查中…';
      btn.title = '正在处理翻译';
      btn.classList.toggle('is-zh', Boolean(state.readerZhMode));
      btn.setAttribute('aria-pressed', state.readerZhMode ? 'true' : 'false');
    });
    return;
  }
  // 有永久缓存后：按钮只做 原文 ⇄ 中文，永不显示「翻译」
  if (state.readerZhMode && hasCached) {
    apply((btn) => {
      btn.textContent = '原文';
      btn.title = '切回英文原文（不重新翻译）';
      btn.classList.add('is-zh');
      btn.setAttribute('aria-pressed', 'true');
    });
    return;
  }
  if (hasCached) {
    apply((btn) => {
      btn.textContent = '中文';
      btn.title = '显示已缓存的简体中文译文（不重新请求 API）';
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    });
    return;
  }
  apply((btn) => {
    btn.textContent = '翻译';
    btn.title = '译为简体中文（仅首次调用 API，结果永久缓存）';
    btn.classList.remove('is-zh');
    btn.setAttribute('aria-pressed', 'false');
  });
}

/* ---------- 思考笔记（原文 ⇄ 笔记，Markdown，自动保存，自动进收藏） ---------- */

/** 思考笔记开放范围：X/小红书收藏、小红书博主知识库、知乎导入、Lil'Log */
function entrySupportsThinkingNote(entry) {
  if (!entry || !entry.id) return false;
  const sid = String(entry.sourceId || '');
  return sid === 'x-likes'
    || sid === 'xhs-likes'
    || /^xhs-/.test(sid)
    || /^zhihu-/.test(sid)
    || sid === 'lilianweng';
}

/** 客户端笔记内存缓存（避免重复 GET） */
const thinkingNoteMemory = new Map();

function rememberedThinkingNote(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  return thinkingNoteMemory.get(id) || null;
}

let thinkingNotePendingEntryId = '';
let thinkingNotePendingBody = null;
let thinkingNoteSaveTimer = null;

function setThinkingNoteStatus(text) {
  const el = $('#thinking-note-status');
  if (el) el.textContent = text || '';
}

async function loadThinkingNote(entry) {
  if (!entry || !entrySupportsThinkingNote(entry)) {
    state.thinkingNote = null;
    updateReaderNoteButton(entry);
    return null;
  }
  const cached = rememberedThinkingNote(entry.id);
  if (cached) {
    state.thinkingNote = cached;
    updateReaderNoteButton(entry);
    return cached;
  }
  state.thinkingNoteLoading = true;
  try {
    const data = await api(`/api/entry/${entry.id}/note`);
    const note = (data && data.note) || null;
    if (note) thinkingNoteMemory.set(entry.id, note);
    if (state.activeEntry?.id === entry.id) state.thinkingNote = note;
    return note;
  } catch {
    return null;
  } finally {
    state.thinkingNoteLoading = false;
    updateReaderNoteButton(state.activeEntry);
  }
}

function scheduleThinkingNoteSave(entryId, body) {
  thinkingNotePendingEntryId = String(entryId || '');
  thinkingNotePendingBody = String(body == null ? '' : body);
  setThinkingNoteStatus('未保存…');
  if (thinkingNoteSaveTimer) clearTimeout(thinkingNoteSaveTimer);
  thinkingNoteSaveTimer = setTimeout(() => { flushThinkingNoteSave(); }, 900);
}

async function flushThinkingNoteSave() {
  if (thinkingNoteSaveTimer) {
    clearTimeout(thinkingNoteSaveTimer);
    thinkingNoteSaveTimer = null;
  }
  if (thinkingNotePendingBody === null || !thinkingNotePendingEntryId) return;
  const entryId = thinkingNotePendingEntryId;
  const body = thinkingNotePendingBody;
  thinkingNotePendingEntryId = '';
  thinkingNotePendingBody = null;
  try {
    setThinkingNoteStatus('保存中…');
    const data = await api(`/api/entry/${entryId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const note = (data && data.note) || null;
    if (note) thinkingNoteMemory.set(entryId, note);
    else thinkingNoteMemory.delete(entryId);
    if (state.activeEntry?.id === entryId) state.thinkingNote = note;
    setThinkingNoteStatus(note ? `已保存 ${new Date().toTimeString().slice(0, 5)}` : '已清空');
    // 有思考笔记的文章自动进收藏
    if (note && !state.starred.has(entryId) && typeof toggleEntryStarred === 'function') {
      toggleEntryStarred(entryId, true);
    }
    updateReaderNoteButton(state.activeEntry);
  } catch (err) {
    // 失败重新排队，避免丢字
    thinkingNotePendingEntryId = entryId;
    thinkingNotePendingBody = body;
    setThinkingNoteStatus('保存失败，稍后自动重试');
    toast('笔记保存失败: ' + err.message, 4000);
    if (!thinkingNoteSaveTimer) {
      thinkingNoteSaveTimer = setTimeout(() => { flushThinkingNoteSave(); }, 5000);
    }
  }
}

// 刷新/关页兜底：sendBeacon 落盘未保存内容
window.addEventListener('beforeunload', () => {
  if (thinkingNotePendingBody === null || !thinkingNotePendingEntryId) return;
  try {
    navigator.sendBeacon(
      `/api/entry/${thinkingNotePendingEntryId}/note`,
      new Blob([JSON.stringify({ body: thinkingNotePendingBody })], { type: 'application/json' }),
    );
  } catch { /* ignore */ }
});

function updateReaderNoteButton(entry = state.activeEntry) {
  const buttons = [$('#reader-note-btn'), ...$$('[data-note-toggle]')].filter(Boolean);
  if (!buttons.length) return;
  const supported = entrySupportsThinkingNote(entry);
  buttons.forEach((btn) => btn.classList.toggle('hidden', !supported));
  if (!supported) return;
  const hasNote = Boolean(
    (state.thinkingNote && String(state.thinkingNote.body || '').trim())
    || (entry && rememberedThinkingNote(entry.id)),
  );
  buttons.forEach((btn) => {
    btn.disabled = false;
    if (state.readerNoteMode) {
      btn.textContent = '原文';
      btn.title = '返回文章（笔记已自动保存）';
      btn.classList.add('is-zh');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.textContent = '笔记';
      btn.title = hasNote ? '查看/编辑思考笔记' : '写思考笔记（Markdown，自动保存）';
      btn.classList.remove('is-zh');
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.classList.toggle('has-note', hasNote && !state.readerNoteMode);
  });
}

function thinkingNoteViewHtml() {
  return `<div class="thinking-note">
    <div class="thinking-note-bar">
      <div class="thinking-note-title">思考笔记</div>
      <div class="thinking-note-actions">
        <span id="thinking-note-status" class="thinking-note-status"></span>
        <button type="button" id="thinking-note-preview" class="thinking-note-mode-btn">预览</button>
      </div>
    </div>
    <textarea id="thinking-note-editor" class="thinking-note-editor" placeholder="记录读完这篇后的想法、AI 对话中的启发…（支持 Markdown，自动保存）" spellcheck="false"></textarea>
    <div id="thinking-note-render" class="thinking-note-render reader-content hidden"></div>
    <div class="thinking-note-hint">支持 Markdown · 输入后自动保存 · 有笔记的文章自动进收藏</div>
  </div>`;
}

async function toggleThinkingNotePreview() {
  const ta = $('#thinking-note-editor');
  const render = $('#thinking-note-render');
  const btn = $('#thinking-note-preview');
  if (!ta || !render || !btn) return;
  const showPreview = render.classList.contains('hidden');
  if (!showPreview) {
    render.classList.add('hidden');
    ta.classList.remove('hidden');
    btn.textContent = '预览';
    ta.focus();
    return;
  }
  ta.classList.add('hidden');
  render.classList.remove('hidden');
  btn.textContent = '编辑';
  const md = ta.value;
  if (!md.trim()) {
    render.innerHTML = '<p style="color:var(--text-2)">（空笔记）</p>';
    return;
  }
  render.innerHTML = '<p style="color:var(--text-2)">渲染中…</p>';
  try {
    const html = await renderMarkdownDocument(md, { sourceId: 'thinking-note' });
    render.innerHTML = await sanitizeAsync(html || '');
  } catch {
    render.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(md)}</pre>`;
  }
}

/** 进入笔记视图：与简中视图同权，收起社交壳，正文区变编辑器 */
async function applyNoteView(entry = state.activeEntry) {
  if (!entry || !entrySupportsThinkingNote(entry)) return false;
  const openGen = state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;
  state.noteReturnZh = Boolean(state.readerZhMode);
  state.readerNoteMode = true;
  state.readerZhMode = false;
  const reader = $('#reader');
  if (reader) {
    reader.classList.add('reader--note-view');
    reader.classList.remove('reader--zh-view');
    if (reader.classList.contains('reader--social')) {
      reader.classList.remove('reader--social', 'reader--x', 'reader--xhs', 'reader--bili');
    }
  }
  renderTitle(entry);
  const root = $('#reader-content');
  if (!root) return false;
  root.innerHTML = thinkingNoteViewHtml();
  state.readerTocAvailable = false;
  renderReaderToc(root);
  updateReaderTranslateButton(entry);
  const note = rememberedThinkingNote(entry.id) || state.thinkingNote || await loadThinkingNote(entry);
  if (!stillCurrent() || !state.readerNoteMode) return false;
  const ta = $('#thinking-note-editor');
  if (ta) {
    ta.value = (note && note.body) || '';
    ta.oninput = () => scheduleThinkingNoteSave(entry.id, ta.value);
    ta.focus();
  }
  const previewBtn = $('#thinking-note-preview');
  if (previewBtn) previewBtn.onclick = () => toggleThinkingNotePreview();
  setThinkingNoteStatus(note ? `已保存 ${typeof formatAssetTime === 'function' ? formatAssetTime(note.updatedAt) : ''}`.trim() : '');
  return true;
}

/** 退出笔记视图：先落盘，再回简中或原文 */
async function exitNoteView(entry = state.activeEntry) {
  await flushThinkingNoteSave();
  state.readerNoteMode = false;
  const wantZh = state.noteReturnZh;
  state.noteReturnZh = false;
  $('#reader')?.classList.remove('reader--note-view');
  if (!entry) return;
  if (wantZh && translationHasContent(state.translation)) {
    await applyZhArticleView(entry, state.translation);
  } else {
    await restoreOriginalArticleView(entry);
  }
  updateReaderNoteButton(entry);
}

async function handleReaderNoteClick() {
  const entry = state.activeEntry;
  if (!entry || !entrySupportsThinkingNote(entry)) return;
  if (state.readerNoteMode) await exitNoteView(entry);
  else await applyNoteView(entry);
}

function renderTitleForZh(entry, translation) {
  const titleZh = String(translation && translation.titleZh || '').trim();
  const mainLink = $('#reader-title-link');
  const originalLink = $('#reader-title-original-link');
  const originalWrap = $('#reader-title-zh');
  if (titleZh) {
    if (mainLink) setReaderTitleLink(mainLink, titleZh, entry && entry.link, '打开原文');
    else if ($('#reader-title')) $('#reader-title').textContent = titleZh;
    // 只保留中文主标题，隐藏英文副标题行
    if (originalWrap) originalWrap.classList.add('hidden');
    if (originalLink) setReaderTitleLink(originalLink, '', entry && entry.link, '打开原文');
  } else {
    renderTitle(entry);
  }
}

function comparableTitleText(value) {
  return String(value || '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 译文是否更像 Markdown（# ** -）而非 HTML 块 */
function translationLooksLikeMarkdown(translation) {
  const pairs = translation && Array.isArray(translation.content) ? translation.content : [];
  if (!pairs.length) return false;
  const withHtml = pairs.filter(p => p && p.targetHtml && /<\w[\s\S]*>/.test(p.targetHtml)).length;
  if (withHtml >= Math.ceil(pairs.length * 0.4)) return false;
  const mdHits = pairs.filter((p) => {
    const t = String(p && p.target || '');
    return /^#{1,6}\s/m.test(t) || /^\s*[-*+]\s+/m.test(t) || /\*\*[^*]+\*\*/.test(t) || /^>\s/m.test(t);
  }).length;
  return mdHits > 0 || withHtml === 0;
}

/**
 * 把译文块拼成 Markdown 正文：
 * - 去掉与标题重复的首行 # 标题
 * - 保留 **粗体** / 列表 / 二级标题等 md 语法，交给 renderMarkdownDocument
 */
function buildZhMarkdownFromTranslation(translation, entry) {
  const titleZh = String(translation && translation.titleZh || '').trim();
  const titleEn = String(entry && entry.title || '').trim();
  const skipTitles = new Set(
    [titleZh, titleEn].map(comparableTitleText).filter(Boolean),
  );
  const parts = [];
  for (const pair of translation.content || []) {
    if (!pair) continue;
    if (pair.kind === 'media' || pair.tag === 'img' || pair.tag === 'hr') {
      const html = String(pair.targetHtml || pair.sourceHtml || '').trim();
      if (html) parts.push(html);
      continue;
    }
    // 目标 HTML 已含图：直接保留结构（段内图 / figure）
    const th = String(pair.targetHtml || '').trim();
    if (th && /<img\b/i.test(th)) {
      parts.push(th);
      continue;
    }
    let text = String(pair.target || '').trim();
    if (!text && th) {
      text = th
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
    }
    // 译文纯文本但源 HTML 有图：图 + 中文（防校验清空 targetHtml 后丢图）
    const mediaFrom = sourceImagesFromHtml(pair.sourceHtml || '') || sourceImagesFromHtml(th);
    if (!text && mediaFrom) {
      parts.push(mediaFrom);
      continue;
    }
    if (!text) continue;
    // 装饰性 * * 当分隔线
    if (/^(\*\s*){1,3}$/.test(text) || /^(-+\s*){1,3}$/.test(text)) {
      parts.push('---');
      continue;
    }
    const plain = comparableTitleText(text);
    if (plain && skipTitles.has(plain)) {
      if (mediaFrom) parts.push(mediaFrom);
      continue;
    }
    // 去掉与标题重复的 # 标题行
    if (/^#{1,6}\s+/.test(text) && skipTitles.has(comparableTitleText(text.replace(/^#{1,6}\s+/, '')))) {
      if (mediaFrom) parts.push(mediaFrom);
      continue;
    }
    parts.push(mediaFrom ? `${mediaFrom}\n\n${text}` : text);
  }
  return parts.join('\n\n').trim();
}

function stripDuplicateReaderHeading(root, entry, translation) {
  if (!root) return;
  const comparable = comparableTitleText;
  const titles = [
    translation && translation.titleZh,
    entry && entry.titleZh,
    entry && entry.title,
  ].map(comparable).filter(Boolean);
  // 优先只剥 body 内重复标题；绝不拆 syllabus-brief 课程壳标题
  const body = root.querySelector('.syllabus-body');
  const firstHeading = (body || root).querySelector('h1,h2');
  if (
    firstHeading
    && !firstHeading.classList.contains('syllabus-title')
    && !firstHeading.closest('.syllabus-header')
    && titles.includes(comparable(firstHeading.textContent))
  ) {
    firstHeading.remove();
  }
}

/** 从译文抽出列表用中文标题/摘要 */
function listFieldsFromTranslation(translation) {
  if (!translationHasContent(translation)) return null;
  let titleZh = String(translation.titleZh || '').trim();
  let summaryZh = String(translation.summaryZh || '').trim();
  if (!summaryZh) {
    for (const pair of translation.content || []) {
      if (!pair || pair.kind === 'media') continue;
      const text = String(pair.target || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^#+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length >= 12 && comparableTitleText(text) !== comparableTitleText(titleZh)) {
        summaryZh = text.slice(0, 160);
        break;
      }
    }
  }
  if (!titleZh && !summaryZh) return null;
  return {
    titleZh: titleZh ? titleZh.slice(0, 120) : '',
    summaryZh: summaryZh ? summaryZh.slice(0, 160) : '',
  };
}

/** 译后：目录标题/摘要改中文（列表默认中文），并标 assets */
function syncCatalogFromTranslation(entryId, translation) {
  const id = String(entryId || '').trim();
  if (!id) return;
  const fields = listFieldsFromTranslation(translation);
  const prev = entryByIdFromList(id) || (state.activeEntry?.id === id ? state.activeEntry : null);
  const patch = {};
  if (fields) {
    if (fields.titleZh) patch.titleZh = fields.titleZh;
    if (fields.summaryZh) patch.summaryZh = fields.summaryZh;
  }
  if (prev) patch.assets = mergeAssets(prev, { translation: true });
  if (!Object.keys(patch).length) return;
  patchCatalogEntry(id, patch);
  if (state.activeEntry?.id === id) {
    state.activeEntry = { ...state.activeEntry, ...patch };
  }
  patchEntryCardZhFields(id);
}

/** 单卡 DOM：标题+摘要改中文（不显示文A徽章） */
function patchEntryCardZhFields(entryId) {
  const root = $('#entry-list');
  if (!root) return false;
  const id = String(entryId || '').trim();
  const entry = entryByIdFromList(id);
  if (!entry) return false;
  let card = null;
  try {
    card = root.querySelector(`.entry-card[data-id="${CSS.escape(id)}"]`);
  } catch {
    card = [...root.querySelectorAll('.entry-card')].find(el => el.dataset.id === id) || null;
  }
  if (!card) return false;
  const isSyllabus = typeof isSyllabusEntry === 'function' && isSyllabusEntry(entry);
  let title = String(entry.titleZh || entry.title || '').trim();
  let summary = isSyllabus && typeof syllabusCardSummary === 'function'
    ? syllabusCardSummary(entry)
    : listSummaryText(entry);
  if (isSyllabus) {
    const codeLike = String(entry.title || '').trim();
    const zh = String(entry.titleZh || '').trim();
    if (typeof isSyllabusCourseCode === 'function' && isSyllabusCourseCode(codeLike)) {
      title = codeLike;
      if (!summary || summary === codeLike) summary = (zh && zh !== codeLike) ? zh : '';
    } else if (zh) {
      title = zh;
      if (summary === title || summary === zh || summary === codeLike) summary = '';
    }
    if (summary && summary.replace(/\s+/g, '') === title.replace(/\s+/g, '')) summary = '';
  }
  const titleEl = card.querySelector('.entry-title');
  if (titleEl) titleEl.textContent = title;
  // 去掉英文副标题行（若有）
  card.querySelector('.entry-original')?.remove();
  // 课程卡不显示右上角学校 time
  if (isSyllabus) card.querySelector('.entry-time')?.remove();
  let summaryEl = card.querySelector('.entry-summary');
  if (summary) {
    if (!summaryEl) {
      summaryEl = document.createElement('div');
      summaryEl.className = isSyllabus ? 'entry-summary entry-summary--course' : 'entry-summary';
      titleEl?.after(summaryEl);
    }
    summaryEl.textContent = summary;
  } else if (summaryEl) {
    summaryEl.remove();
  }
  if (title) card.setAttribute('aria-label', [title, summary].filter(Boolean).join(' · '));
  return true;
}

/**
 * 同一张图的身份键：原文本地化后路径与译文里仍保留的 CDN URL 往往字面不同，
 * 若只用 full URL includes() 判断，会把已有配图再整批插到标题下（堆图/重复）。
 */
function imageIdentityKeys(src) {
  const raw = String(src || '').trim();
  if (!raw) return [];
  const keys = new Set([raw]);
  try {
    const noHash = raw.split('#')[0];
    keys.add(noHash);
    const pathOnly = noHash.split('?')[0];
    keys.add(pathOnly);
    const base = pathOnly.split('/').pop() || '';
    if (base) keys.add(base);
    const local = pathOnly.match(/\/article-images\/[^\s"'<>]+/i);
    if (local) keys.add(local[0]);
    // 本地文件名哈希（sha256 截断）
    const fileHash = base.match(/^([a-f0-9]{16,40})\.[a-z0-9]+$/i);
    if (fileHash) keys.add(fileHash[1].toLowerCase());
  } catch { /* ignore */ }
  // Substack / S3 媒体 UUID
  for (const m of raw.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    keys.add(m[0].toLowerCase());
  }
  // 常见 CDN 裸文件名：xxx_1999x1237.png
  for (const m of raw.matchAll(/([0-9a-f]{8,}(?:-[0-9a-f]{4,})*_\d{2,5}x\d{2,5}\.(?:png|jpe?g|gif|webp))/gi)) {
    keys.add(m[1].toLowerCase());
  }
  return [...keys].filter(Boolean);
}

function htmlAlreadyHasImage(html, src) {
  const source = String(html || '');
  if (!source || !src) return false;
  return imageIdentityKeys(src).some((key) => key.length >= 8 && source.includes(key));
}

/**
 * 译文 HTML 补回原文丢失的 img（支持 HTML <img> 与 Markdown ![]()）
 * 仅在译文几乎无图时做标题下兜底；译文已有配图时绝不整批前置，避免重复堆图。
 */
function mergeMissingOriginalImages(zhHtml, originalHtml) {
  let html = String(zhHtml || '');
  const original = String(originalHtml || '');
  if (!original) return html;

  const zhImgCount = (html.match(/<img\b/gi) || []).length;
  const origImgCount = (original.match(/<img\b/gi) || []).length
    + (original.match(/!\[[^\]]*\]\([^)\s]+\)/g) || []).length;

  // 译文侧已有像样配图：只认「身份键」缺失，且不把漏图堆到文首
  // （漏图应留在块级 structure；文首堆图比丢一两张更糟）
  if (zhImgCount > 0 && (origImgCount === 0 || zhImgCount >= Math.max(1, Math.ceil(origImgCount * 0.35)))) {
    return html;
  }

  const isAllowedImgSrc = (src) => {
    const key = String(src || '').trim();
    return /^https?:\/\//i.test(key) || key.startsWith('/article-images/');
  };
  const missing = [];
  const seen = new Set();
  const add = (src, alt = '') => {
    const key = String(src || '').trim();
    if (!key || !isAllowedImgSrc(key) || seen.has(key) || htmlAlreadyHasImage(html, key)) return;
    // 同一身份只收一次
    for (const id of imageIdentityKeys(key)) {
      if (seen.has(`id:${id}`)) return;
    }
    seen.add(key);
    for (const id of imageIdentityKeys(key)) seen.add(`id:${id}`);
    missing.push(`<img src="${escapeHtml(key)}" alt="${escapeHtml(alt)}">`);
  };
  for (const m of original.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    add(m[1]);
  }
  for (const m of original.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    add(m[2], m[1] || '');
  }
  if (!missing.length) return html;
  const inject = missing
    .map(tag => `<figure class="translation-recovered-image">${tag}</figure>`)
    .join('\n');
  if (/<\/h1>/i.test(html)) return html.replace(/<\/h1>/i, `</h1>\n${inject}`);
  if (/<\/h2>/i.test(html)) return html.replace(/<\/h2>/i, `</h2>\n${inject}`);
  return `${inject}\n${html}`;
}

/**
 * 用译文替换阅读区为简中，格式尽量与原文一致：
 * - Markdown 源：拼 md → Marked 渲染
 * - HTML 块译文：拼 targetHtml
 * - 补回丢失图片；去掉与页头重复的首标题
 * openGen 守卫：切文后过期请求不得写 DOM / 不得提前锁 readerZhMode
 */
async function applyZhArticleView(entry, translation, opts = {}) {
  if (!entry || !translationHasContent(translation)) return false;
  // 笔记视图打开时不贴简中；退出笔记时按 noteReturnZh 再回简中
  if (state.readerNoteMode) return false;
  const openGen = opts.openGen ?? state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;

  const original = contentCache.get(entry.id) || entry.content || '';
  const isSyllabus = Boolean(
    entry.sourceId === 'zen-recent'
    || (typeof sourceById === 'function' && sourceById(entry.sourceId)?.contentKind === 'syllabus')
    || /class=["'][^"']*syllabus-brief/.test(String(original)),
  );

  let zhInner = '';
  let shellHtml = '';
  try {
    let html = '';
    if (translationLooksLikeMarkdown(translation)) {
      const md = buildZhMarkdownFromTranslation(translation, entry);
      html = md
        ? await renderMarkdownDocument(md, { sourceId: entry.sourceId || '' })
        : '';
      if (!stillCurrent()) return false;
    } else {
      // 课程译文保留已缓存的完整 table targetHtml；重新按当前原文对齐会在课程重抓后
      // 丢掉旧译文中的图片/表格块（CME295/296 尤其明显）。
      const blocks = isSyllabus && Array.isArray(translation.content)
        ? translation.content
        : enrichedTranslationBlocks(translation);
      html = blocks.map(pair => translationBlockTargetHtml(pair)).join('');
    }
    // 块里 p>img 或 media 可能漏图：从原文补全
    if (looksLikeHtmlDocument(original)) {
      html = mergeMissingOriginalImages(html, original);
    } else if (html && !/<img\b/i.test(html)) {
      const imgs = sourceImagesFromHtml(original);
      if (imgs) html = `${imgs}\n${html}`;
    }
    zhInner = html
      ? await sanitizeAsync(html, { prioritizeFirstImage: true })
      : '<p style="color:var(--text-2)">译文为空</p>';
    if (!stillCurrent()) return false;

    // 课程大纲：保留 syllabus-brief 壳（徽章/打开/chips），只替换 body 为简中
    if (isSyllabus && looksLikeHtmlDocument(original) && /syllabus-brief/.test(original)) {
      const shell = document.createElement('div');
      shell.innerHTML = await sanitizeAsync(original, { prioritizeFirstImage: true });
      if (!stillCurrent()) return false;
      const brief = shell.querySelector('article.syllabus-brief, .syllabus-brief');
      if (brief) {
        let body = brief.querySelector('.syllabus-body');
        if (!body) {
          body = document.createElement('section');
          body.className = 'syllabus-body';
          brief.appendChild(body);
        }
        body.innerHTML = zhInner;
        brief.querySelectorAll('.syllabus-empty').forEach((el) => el.remove());
        shellHtml = shell.innerHTML;
      } else {
        shellHtml = `<section class="syllabus-body">${zhInner}</section>`;
      }
    }
  } catch (err) {
    console.warn('applyZhArticleView render failed', err);
    if (!stillCurrent()) return false;
    const fallback = buildZhMarkdownFromTranslation(translation, entry);
    zhInner = fallback
      ? `<div class="reader-content">${escapeHtml(fallback).replace(/\n\n/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>')}</div>`
      : '<p style="color:var(--text-2)">译文渲染失败</p>';
    shellHtml = '';
  }

  if (!stillCurrent()) return false;

  // 校验 gen 通过后再写 mode / DOM，避免切文竞态盖错正文
  state.readerZhMode = true;
  state.translation = translation;
  rememberTranslation(entry.id, translation);
  setEntryZhViewPref(entry.id, true);
  syncCatalogFromTranslation(entry.id, translation);
  const reader = $('#reader');
  if (reader) {
    reader.classList.add('reader--zh-view');
    if (isSyllabus) reader.classList.add('reader--syllabus');
    // X 长文简中视图：译文是标准文章结构，收起社交壳（顶栏标题/翻译按钮恢复显示）；
    // 切回原文时 renderOriginalContent 会重新加回这些类
    if (reader.classList.contains('reader--social')) {
      reader.classList.remove('reader--social', 'reader--x', 'reader--xhs', 'reader--bili');
    }
  }
  renderTitleForZh(entry, translation);
  const root = $('#reader-content');
  if (!root) {
    updateReaderTranslateButton(entry);
    return true;
  }

  if (shellHtml) root.innerHTML = shellHtml;
  else root.innerHTML = zhInner;

  if (isSyllabus && typeof enhanceSyllabusContent === 'function') {
    enhanceSyllabusContent(root, entry);
  }
  stripDuplicateReaderHeading(root, entry, translation);
  $$('#reader-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  renderReaderToc(root);
  updateReaderLanguageProfile();
  updateReaderTranslateButton(entry);
  if (typeof applyLocalContentMarks === 'function') applyLocalContentMarks(root, entry && entry.id);
  return true;
}

async function restoreOriginalArticleView(entry = state.activeEntry) {
  state.readerZhMode = false;
  const reader = $('#reader');
  if (reader) reader.classList.remove('reader--zh-view');
  if (!entry) {
    updateReaderTranslateButton(null);
    return;
  }
  // 不持久化「偏好原文」：下次开文仍默认简中；仅本次会话看原文
  renderTitle(entry);
  const content = contentCache.get(entry.id) || entry.content || entry.summary || '';
  await renderOriginalContent(entry, content);
  updateReaderTranslateButton(entry);
}

function omitQuotesForTranslation(entryId = state.activeEntry?.id) {
  if (typeof localDeletionQuotes === 'function') return localDeletionQuotes(entryId);
  if (typeof localContentMarksFor !== 'function') return [];
  const marks = localContentMarksFor(entryId);
  return (marks.deletions || [])
    .map(d => String(d && d.quote || '').replace(/\s+/g, ' ').trim())
    .filter(q => q.length >= 2);
}

async function generateTranslation({ force = false, inplace = false } = {}) {
  let entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-bilingual');
  const omitQuotes = omitQuotesForTranslation(entry.id);
  // 有本机删除时必须走服务端（hash 含 omit），勿直接吃旧全文缓存
  // 一键翻译路径：有有效缓存则不再 POST；stale（原文已变）必须重译
  if (inplace && !force && !omitQuotes.length) {
    const existing = translationHasDisplayableZh(state.translation)
      ? state.translation
      : await fetchTranslationCache(entry).catch(() => null);
    if (translationHasDisplayableZh(existing)) {
      state.translation = existing;
      await applyZhArticleView(entry, existing);
      toast(existing.stale ? '已显示简中译文（原文有更新，可再点翻译刷新）' : '已显示缓存简中译文');
      return;
    }
  }
  if (state.translation && !force && !inplace) {
    setReaderTab('translation');
    return;
  }
  if (state.translationLoading && !inplace) {
    state.pendingTranslationGenerate = true;
    setReaderTab('translation');
    updateReaderTranslateButton(entry);
    return;
  }
  if (state.translationGenerating) return;

  // 优先用浏览器 AI Profile 的 key / baseUrl / model；未填则直接打开配置
  let aiConfig = translationAiConfig();
  // DeepSeek 缺省补全，避免只填了 key 却因 baseUrl/model 空而走服务端 Gemini 卡住
  if (String(aiConfig.provider || '').toLowerCase() === 'deepseek' || !aiConfig.provider) {
    aiConfig = {
      ...aiConfig,
      provider: 'deepseek',
      providerName: aiConfig.providerName || 'DeepSeek',
      providerType: 'openai_compatible',
      baseUrl: normalizeBaseUrl(aiConfig.baseUrl || 'https://api.deepseek.com/v1'),
      model: String(aiConfig.model || DEFAULT_REWRITE_MODEL || 'deepseek-v4-flash').trim() || 'deepseek-v4-flash',
    };
  }
  if (!hasUsableAiConfig(aiConfig)) {
    openAiConfigModal('translation', 'translation');
    toast('请先填写 DeepSeek 的 API Key（Base URL / 模型可自动补全）');
    return;
  }

  // 译前仅在真正缺正文时补抓；本地 crawl 全文 / 已有镜像图不再联网
  if (
    inplace
    && entry
    && typeof shouldAutoFetchOriginalOnOpen === 'function'
    && shouldAutoFetchOriginalOnOpen(entry)
    && !state.fetchingOriginal
  ) {
    try {
      await fetchOriginalContent();
      entry = state.activeEntry || entry;
    } catch (err) {
      console.warn('pre-translate original fetch skipped', err);
    }
  }

  state.readerAssetId = '';
  if (!inplace) setReaderTab('translation');
  state.translationGenerating = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '翻译中…';
  }
  updateReaderTranslateButton(entry);
  try {
    const data = await api(`/api/entry/${entry.id}/translation`, {
      method: 'POST',
      aiConfig,
      headers: { 'Content-Type': 'application/json' },
      // 一键路径永不 force，服务端 contentHash 命中直接返回缓存；omitQuotes 参与 hash
      body: JSON.stringify({
        force: inplace ? false : force,
        omitQuotes,
      }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    if (data.translation && Array.isArray(data.translation.content) && data.translation.content.length) {
      rememberTranslation(entry.id, data.translation);
      syncCatalogFromTranslation(entry.id, data.translation);
      renderTranslation(data.translation);
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('translation', data.translation), { rerenderList: false });
    } else {
      renderTranslation(data.translation);
    }
    if (inplace) {
      await applyZhArticleView(state.activeEntry || entry, data.translation);
      toast(data.cached ? '已显示缓存简中译文' : '已译为简体中文（已永久保存）');
    } else {
      setReaderTab('translation');
      toast(data.originalFetched ? '已获取原文并保存双语翻译' : data.cached ? '已显示缓存翻译' : '双语翻译已保存');
    }
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('translation', 'translation');
    }
    toast('翻译失败: ' + err.message, 5000);
  } finally {
    state.translationGenerating = false;
    if (btn) {
      btn.disabled = false;
      if (!state.translation) btn.textContent = '生成中文翻译';
      else btn.textContent = state.translation.stale ? '更新中文翻译' : '重新生成中文翻译';
    }
    updateReaderTranslateButton(state.activeEntry);
  }
}

async function handleReaderTranslateClick() {
  const entry = state.activeEntry;
  if (!entry || !isEnglishArticle(entry)) return;
  if (state.translationGenerating) return;

  // 1) 内存已有译文 → 纯切换，零网络（含 soft-stale）
  if (translationHasDisplayableZh(state.translation) || translationHasContent()) {
    if (state.readerZhMode) {
      await restoreOriginalArticleView(entry);
      return;
    }
    await applyZhArticleView(entry, state.translation);
    return;
  }

  // 2) 内存缓存 / 服务端 SQLite 永久缓存 → GET，仍不调 Gemini
  try {
    state.translationLoading = true;
    updateReaderTranslateButton(entry);
    const cached = rememberedTranslation(entry.id) || await fetchTranslationCache(entry);
    if (state.activeEntry?.id !== entry.id) return;
    if (translationHasDisplayableZh(cached) || translationHasContent(cached)) {
      state.translation = cached;
      if (state.readerZhMode) {
        await restoreOriginalArticleView(entry);
      } else {
        await applyZhArticleView(entry, cached);
      }
      return;
    }
  } catch {
    /* 无缓存则继续首次翻译 */
  } finally {
    state.translationLoading = false;
    updateReaderTranslateButton(state.activeEntry);
  }

  // 3) 真正首次：POST force:false，结果写入 SQLite 永久缓存
  await generateTranslation({ force: false, inplace: true });
}

async function generateRewrite({ force = false } = {}) {
  const entry = state.activeEntry;
  if (!entry) return;
  const btn = $('#reader-rewrite');
  if (state.rewrite && !force) {
    setReaderTab('rewrite');
    return;
  }
  if (state.rewriteGenerating) return;
  state.readerAssetId = '';
  setReaderTab('rewrite');
  state.rewriteGenerating = true;
  btn.disabled = true;
  btn.textContent = rewriteUiCopy(entry).generating;
  try {
    const data = await api(`/api/entry/${entry.id}/rewrite`, {
      method: 'POST',
      aiConfig: rewriteAiConfig(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (state.activeEntry?.id !== entry.id) return;
    if (data.entry) applyServerEntryUpdate(data.entry);
    renderRewrite(data.rewrite);
    if (data.rewrite && data.rewrite.body) {
      updateEntryAssets(entry.id, entryAssetHelpfulPatch('rewrite', data.rewrite), { rerenderList: false });
      renderList();
    }
    setReaderTab('rewrite');
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    toast(data.originalFetched ? copyTextForEntry.fetched : data.cached ? copyTextForEntry.cached : copyTextForEntry.saved);
  } catch (err) {
    if (/API Key|未配置|Authentication|authentication|invalid_request_error|401/i.test(err.message)) {
      openAiConfigModal('rewrite', 'rewrite');
    }
    toast(rewriteUiCopy(entry).failedPrefix + err.message, 5000);
  } finally {
    state.rewriteGenerating = false;
    btn.disabled = false;
    const copyTextForEntry = rewriteUiCopy(state.activeEntry || entry);
    if (!state.rewrite) btn.textContent = copyTextForEntry.action;
    else btn.textContent = state.rewrite.stale ? copyTextForEntry.stale : copyTextForEntry.redo;
  }
}

async function fetchOriginalContent() {
  const entry = state.activeEntry;
  if (!entry) return;
  const openGen = state.openGen;
  const stillCurrent = () => openGen === state.openGen && state.activeEntry?.id === entry.id;
  if (!entry.link || !/^https?:\/\//i.test(entry.link)) {
    toast('这篇文章没有可抓取的原文链接');
    return;
  }
  // 知乎等本地导入源：正文已在库，禁止再匿名 HTTP（会 403 并误报）
  if (typeof isLocalOfflineSourceId === 'function' && isLocalOfflineSourceId(entry.sourceId)) {
    toast('本地导入源已有正文，无需抓取网页');
    updateFetchOriginalButton(entry);
    return;
  }
  state.fetchingOriginal = true;
  updateFetchOriginalButton(entry);
  setReaderTab('original');
  const contentEl = $('#reader-content');
  if (contentEl) contentEl.innerHTML = '<p style="color:var(--text-2)">正在获取原文内容…</p>';
  try {
    const data = await api(`/api/entry/${entry.id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!stillCurrent()) return;
    const updated = { ...entry, ...(data.entry || {}) };
    state.activeEntry = updated;
    const idx = state.entries.findIndex(item => item.id === updated.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], ...updated, content: undefined };
    contentCache.set(updated.id, updated.content || '');
    renderTitle(updated);
    renderOriginalContent(updated, updated.content);
    renderList();
    state.translation = null;
    state.rewrite = null;
    loadTranslation(updated);
    loadRewrite(updated);
    toast('原文已获取并保存');
  } catch (err) {
    if (!stillCurrent()) return;
    const failedEntry = {
      ...entry,
      originalFetchAttemptedAt: Date.now(),
      originalFetchError: err.message,
    };
    state.activeEntry = failedEntry;
    const idx = state.entries.findIndex(item => item.id === failedEntry.id);
    if (idx >= 0) state.entries[idx] = { ...state.entries[idx], originalFetchAttemptedAt: failedEntry.originalFetchAttemptedAt, originalFetchError: failedEntry.originalFetchError };
    renderOriginalContent(failedEntry, contentCache.get(entry.id) || entry.content || '');
    toast('获取原文失败: ' + err.message, 5000);
  } finally {
    if (stillCurrent()) {
      state.fetchingOriginal = false;
      updateFetchOriginalButton(state.activeEntry);
    } else {
      state.fetchingOriginal = false;
    }
  }
}
