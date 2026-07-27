
/* ---------- Entry list ---------- */
function hasEntryAssets(entry) {
  return ASSET_FILTER_TYPES.some(type => assetCountForType(entry, type) > 0);
}

function assetCountForType(entry, type) {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation' || type === 'rewrite') {
    const count = Number(assets[`${type}Count`]) || 0;
    if (count) return count;
    const items = assets.items && Array.isArray(assets.items[type]) ? assets.items[type] : [];
    if (items.length) return items.length;
    return assets[type] ? 1 : 0;
  }
  if (type === 'comments') return Number(assets.comments) || 0;
  if (type === 'annotations') return Number(assets.annotations) || 0;
  if (type === 'chat') return Number(assets.chatMessages) || 0;
  return 0;
}

function entryHasAssetType(entry, type) {
  if (ASSET_FILTER_TYPES.includes(type)) return assetCountForType(entry, type) > 0;
  return hasEntryAssets(entry);
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isCompactViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
}

function sourceNameForEntry(entry) {
  return sourceById(entry && entry.sourceId)?.name || (entry && entry.sourceId) || '';
}

function assetSearchText(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const items = assets.items || {};
  const parts = [];
  for (const type of ASSET_FILTER_TYPES) {
    const preview = previews[type];
    if (!entryHasAssetType(entry, type)) continue;
    if (preview) {
      const display = assetPreviewDisplay(preview);
      parts.push(
        ASSET_TYPE_LABELS[type],
        ASSET_FOCUS_LABELS[type],
        display.label,
        display.text,
        preview.author,
        preview.title,
        preview.model,
        preview.role,
      );
    }
    for (const item of items[type] || []) {
      const display = assetPreviewDisplay(item);
      parts.push(display.label, display.text, item.author, item.title, item.model, item.role);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function entrySearchText(entry, { includeAssets = false } = {}) {
  let host = '';
  try {
    if (entry && entry.link) host = new URL(entry.link).hostname.replace(/^www\./, '');
  } catch { /* ignore */ }
  return [
    entry.title,
    entry.titleZh,
    entry.summary,
    entry.summaryZh,
    entry.author,
    host,
    sourceNameForEntry(entry),
    includeAssets ? assetSearchText(entry) : '',
  ].filter(Boolean).join(' ');
}

/** 是否为课程/大纲条目 */
function isSyllabusEntry(entry) {
  if (!entry) return false;
  if (entry.sourceId === 'zen-recent') return true;
  const src = sourceById(entry.sourceId);
  return Boolean(src && src.contentKind === 'syllabus');
}

/** 当前是否筛选「近期」课程库 */
function isSyllabusSourceFilter() {
  const id = state.filterSource;
  if (!id) return false;
  if (id === 'zen-recent') return true;
  const src = sourceById(id);
  return Boolean(src && src.contentKind === 'syllabus');
}

/** 解析 summary 约定：课名 · 学校 · 学期 … */
function parseSyllabusSummary(entry) {
  const raw = String(entry?.summaryZh || entry?.summary || '').replace(/\s+/g, ' ').trim();
  const bits = raw.split('·').map(s => s.trim()).filter(Boolean);
  const courseName = bits[0] || String(entry?.author || '').replace(/\s+/g, ' ').trim();
  const meta = bits.slice(1);
  const schoolRe = /^(Stanford|UC Berkeley|Berkeley|CMU|UCSD|MIT|UVA|Harvard|Princeton|NTU|UC\s*Berkeley|斯坦福|斯坦福大学|伯克利|加州大学伯克利分校|卡内基梅隆|卡内基梅隆大学|加州大学圣迭戈分校|麻省理工|弗吉尼亚|弗吉尼亚大学)$/i;
  const termRe = /^(Spring|Fall|Winter|Summer|Autumn)\s+20\d{2}$|^\d{4}\s+Lectures?$|^20\d{2}$|^(春季|秋季|冬季|夏季)\s*20\d{2}|^20\d{2}\s*年\s*(春|秋|冬|夏)/i;
  let school = '';
  let term = '';
  for (const bit of meta) {
    if (!school && schoolRe.test(bit)) school = bit.replace(/^Berkeley$/i, 'UC Berkeley');
    else if (!term && termRe.test(bit)) term = bit;
  }
  if (!school && meta[0] && !/\.(edu|io|com|org|me|net)/i.test(meta[0]) && !/^https?:/i.test(meta[0])) {
    school = meta[0];
  }
  if (!term) {
    const t = meta.find(b => /20\d{2}|Spring|Fall|Winter|Summer|Autumn|春|秋|冬|夏/i.test(b) && b !== school);
    if (t) term = t;
  }
  return { courseName, school, term, meta, bits, raw };
}

function syllabusEntryKindLabel(entry) {
  const title = String(entry?.titleZh || entry?.title || '');
  const summary = String(entry?.summaryZh || entry?.summary || '');
  const link = String(entry?.link || '');
  const haystack = `${title} ${summary} ${link}`;
  if (/paper|论文|huggingface\.co\/papers/i.test(haystack)) return '论文库';
  if (/bilibili|b23\.tv|视频课|课程合集/i.test(haystack)) return '视频课';
  if (isSyllabusCourseCode(entry?.title)) return '课程大纲';
  if (/course|课程|lecture|课堂/i.test(haystack)) return '课程';
  return '学习站点';
}

/** 是否为课号标题（CS336 / CME295 / 11-785），有课号才双行：课号 + 课名 */
function isSyllabusCourseCode(title) {
  const t = String(title || '').trim();
  if (!t || t.length > 20 || /[\u4e00-\u9fff]/.test(t)) return false;
  return /^[A-Z]{2,}\s*\d+[A-Z]?$/i.test(t) || /^\d{2}-\d{3}(?:\/\d{2}-\d{3})?$/.test(t);
}

/** 列表卡摘要：有课号时给中文课名；无课号且标题已是课名则空（不显示两遍） */
function syllabusCardSummary(entry, syl = null) {
  const parsed = syl || parseSyllabusSummary(entry);
  let name = String(parsed.courseName || '').replace(/\s+/g, ' ').trim();
  const title = String(entry?.title || '').trim();
  const titleZh = String(entry?.titleZh || '').trim();
  // summary 第一段若其实是学校/学期/域名，改用 titleZh
  const looksLikeMeta = !name
    || /大学|学院|Stanford|Berkeley|CMU|MIT|UVA|UCSD|20\d{2}|春季|秋季|冬季|夏季/i.test(name)
    || /\.(edu|io|com|org|me|net)$/i.test(name)
    || name === title
    || name === titleZh;
  if (looksLikeMeta) {
    if (titleZh && titleZh !== title && /[\u4e00-\u9fff]/.test(titleZh)) name = titleZh;
    else if (parsed.bits && parsed.bits.length > 1) {
      const alt = parsed.bits.find((b) => b
        && b !== parsed.school
        && b !== parsed.term
        && !/大学|学院|Stanford|Berkeley|20\d{2}|春季|秋季/i.test(b)
        && !/\.(edu|io|com|org|me|net)/i.test(b));
      if (alt) name = alt;
    } else {
      name = '';
    }
  }
  // 无课号：列表主标题会是中文课名 → 摘要不要再写一遍
  if (!isSyllabusCourseCode(title)) {
    const displayTitle = titleZh || title;
    if (!name || name === displayTitle || name === title || name === titleZh) return '';
    return name;
  }
  // 有课号：摘要给中文课名（与课号不同才显示）
  if (!name || name === title) name = titleZh && titleZh !== title ? titleZh : '';
  if (name === title) return '';
  return name || '';
}

function formatSyllabusReaderMeta(entry) {
  const syl = parseSyllabusSummary(entry);
  // 阅读区 meta：课名优先；不堆叠重复学校
  const name = syllabusCardSummary(entry, syl) || syl.courseName;
  if (name) return name;
  return String(entry?.summaryZh || entry?.summary || entry?.author || '课程入口')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryMatchesSearch(entry, { includeAssets = false } = {}) {
  const needle = normalizeSearchText(state.q);
  if (!needle) return true;
  return normalizeSearchText(entrySearchText(entry, { includeAssets })).includes(needle);
}

function contributorSearchText(contributor) {
  return [
    contributor.displayName,
    `${contributor.assetCount || 0} 条`,
    `${contributor.helpfulCount || 0} 有用`,
    `${contributor.helpfulAssets || 0} 受认可`,
    `${contributor.translationCount || 0} 中译`,
    `${contributor.rewriteCount || 0} 重写`,
    `${contributor.annotationCount || 0} 划线`,
    `${contributor.commentCount || 0} 点评`,
    `${contributor.chatCount || 0} 对话`,
  ].filter(Boolean).join(' ');
}

function visibleContributors() {
  const needle = normalizeSearchText(state.q);
  return (state.contributors || [])
    .filter(contributor => !needle || normalizeSearchText(contributorSearchText(contributor)).includes(needle));
}

function applySyllabusCourseOrder(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const saved = readJson(COURSE_ORDER_KEY, '[]');
  const ids = Array.isArray(saved) ? saved.filter(Boolean) : [];
  if (!ids.length) return list;
  const rank = new Map(ids.map((id, index) => [String(id), index]));
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aid = String(a.entry?.id || '');
      const bid = String(b.entry?.id || '');
      const ar = rank.has(aid) ? rank.get(aid) : Number.MAX_SAFE_INTEGER;
      const br = rank.has(bid) ? rank.get(bid) : Number.MAX_SAFE_INTEGER;
      return (ar - br) || (a.index - b.index);
    })
    .map(item => item.entry);
}

function persistSyllabusCourseOrder(ids) {
  const order = [...new Set((ids || []).map(String).filter(Boolean))];
  storage.setItem(COURSE_ORDER_KEY, JSON.stringify(order));
}

function visibleEntries() {
  let list = state.entries;
  if (state.view === 'hot') {
    // 课程库无互动热度：退回目录序
    if (isSyllabusSourceFilter()) {
      // keep pin order (publishedTs)
    } else if (!state.q && !state.filterSource && !state.filterCategory
      && state.hotEntriesCached && state.hotEntriesCached.length) {
      list = state.hotEntriesCached;
    } else {
      const scored = list.map(e => ({
        e,
        score: entryQualityScore(e),
        ts: Number(e.publishedTs) || 0,
      }));
      scored.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
      list = scored.slice(0, 80).map(item => item.e);
    }
  }
  // 未读：仅手动标已读后才过滤；开文不自动已读
  if (state.view === 'unread') list = list.filter(e => !state.read.has(e.id));
  if (state.view === 'starred') list = list.filter(e => state.starred.has(e.id));
  if (state.view === 'history') {
    list = list
      .filter(e => state.history.has(e.id))
      .slice()
      .sort((a, b) => (Number(state.history.get(b.id)) || 0) - (Number(state.history.get(a.id)) || 0));
  }
  if (state.view === 'assets') {
    list = list
      .filter(hasEntryAssets)
      .filter(entry => !state.assetFilter || entryHasAssetType(entry, state.assetFilter))
      .filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      .slice()
      .sort(compareAssetEntries);
  }
  if (isSyllabusSourceFilter()) list = applySyllabusCourseOrder(list);
  return list;
}

function sourceById(id) {
  if (!id) return null;
  if (state.sourceMap && state.sourceMap.size) {
    return state.sourceMap.get(id) || null;
  }
  return state.sources.find(s => s.id === id) || null;
}

function entryAssetItems(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const items = [];
  if (assets.translation) items.push({ type: 'translation', label: '中文翻译', count: 0, title: '查看中文翻译' });
  if (assets.rewrite) items.push({ type: 'rewrite', label: '中文改写', count: 0, title: '查看中文改写' });
  if (assets.annotations) items.push({ type: 'annotations', label: '划线点评', count: Number(assets.annotations) || 0, title: '查看划线点评' });
  if (assets.comments) items.push({ type: 'comments', label: '人工点评', count: Number(assets.comments) || 0, title: '查看人工点评' });
  if (assets.chatMessages) items.push({ type: 'chat', label: '文章对话', count: Number(assets.chatMessages) || 0, title: '查看文章对话' });
  return items;
}

const ASSET_ICON_NAMES = {
  translation: 'languages',
  rewrite: 'sparkles',
  annotations: 'highlighter',
  comments: 'message-square-text',
  chat: 'bot',
};

function assetBadgeContent(item) {
  const icon = ASSET_ICON_NAMES[item.type] || 'boxes';
  const count = Number(item.count || 0);
  return `${lucideIcon(icon, { className: 'app-icon asset-badge-icon' })}${count ? `<span class="asset-badge-count">${formatCompactCount(count)}</span>` : ''}`;
}

function assetBadgesHtml(entry, { interactive = false, copyable = false } = {}) {
  return entryAssetItems(entry).map(item => {
    const cls = `asset-badge asset-${item.type}${interactive ? ' asset-jump' : ''}`;
    const accessibleLabel = item.count ? `${item.label} ${formatCompactCount(item.count)}` : item.label;
    const content = assetBadgeContent(item);
    if (!interactive) return `<span class="${cls}" title="${escapeHtml(accessibleLabel)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</span>`;
    const badge = `<button type="button" class="${cls}" data-asset="${item.type}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(accessibleLabel)}">${content}</button>`;
    if (!copyable) return badge;
    const label = ASSET_FOCUS_LABELS[item.type] || accessibleLabel;
    return `<span class="asset-badge-group">${badge}<button type="button" class="asset-badge-copy" data-asset-copy="${item.type}" title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button></span>`;
  }).join('');
}

const ASSET_TYPE_LABELS = {
  translation: '中译',
  rewrite: '重写',
  annotations: '划线',
  comments: '点评',
  chat: '对话',
};

const ASSET_DIRECTORY_LABELS = {
  translation: '中文翻译',
  rewrite: '中文改写',
  annotations: '划线点评',
  comments: '人工点评',
  chat: '文章对话',
};

function assetDirectoryLabel(type) {
  return ASSET_DIRECTORY_LABELS[type] || ASSET_TYPE_LABELS[type] || '公开';
}

const ASSET_FILTERS = {
  translation: { label: '中译', count: entry => assetCountForType(entry, 'translation'), title: '查看有中文翻译的文章' },
  rewrite: { label: '重写', count: entry => assetCountForType(entry, 'rewrite'), title: '查看有中文改写的文章' },
  annotations: { label: '划线', count: entry => assetCountForType(entry, 'annotations'), title: '查看有划线点评的文章' },
  comments: { label: '点评', count: entry => assetCountForType(entry, 'comments'), title: '查看有人工点评的文章' },
  chat: { label: '对话', count: entry => assetCountForType(entry, 'chat'), title: '查看有文章对话的文章' },
};

const ASSET_SORTS = {
  latest: { label: '最新', title: '按最近沉淀时间排序' },
  helpful: { label: '有用', title: '优先显示被读者标记有用的 AI 资产、点评和对话' },
};

const CONTRIBUTOR_SORTS = {
  latest: { label: '最新', title: '按最近沉淀公开资产的时间排序' },
  helpful: { label: '有用', title: '优先显示获得读者有用反馈的贡献主页' },
  assets: { label: '资产', title: '优先显示公开资产数量更多的贡献主页' },
};

function normalizeContributorSort(sort = '') {
  return CONTRIBUTOR_SORTS[sort] ? sort : 'latest';
}

function normalizeAssetSort(sort = '') {
  return sort === 'helpful' ? 'helpful' : 'latest';
}

function normalizeContributorAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeUserAssetSort(sort = '') {
  return normalizeAssetSort(sort);
}

function normalizeDashboardTab(tab = '') {
  return DASHBOARD_TABS.includes(tab) ? tab : 'profile';
}

function assetTypeCount(entries, type) {
  const def = ASSET_FILTERS[type];
  if (!def) return 0;
  return entries.reduce((sum, entry) => sum + def.count(entry), 0);
}

function assetTotalCount(entries) {
  return Object.keys(ASSET_FILTERS).reduce((sum, type) => sum + assetTypeCount(entries, type), 0);
}

function assetLatestAtForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (!type) return Number(assets.latestAt || 0);
  const itemAt = Number((assets.items && assets.items[type] && assets.items[type][0] && assets.items[type][0].at) || 0);
  const previewAt = Number((assets.previews && assets.previews[type] && assets.previews[type].at) || 0);
  return Math.max(itemAt, previewAt);
}

function assetHelpfulScoreForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return Number(assets.translationHelpfulCount) || 0;
  if (type === 'rewrite') return Number(assets.rewriteHelpfulCount) || 0;
  if (type === 'annotations') return Number(assets.annotationHelpfulCount) || 0;
  if (type === 'comments') return Number(assets.commentHelpfulCount ?? assets.helpfulCount) || 0;
  if (type === 'chat') return Number(assets.chatHelpfulCount) || 0;
  return Number(assets.helpfulCount) || 0;
}

function assetHelpfulItemCount(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  if (type === 'translation') return helpfulAiAssetItemCount(assets, 'translation');
  if (type === 'rewrite') return helpfulAiAssetItemCount(assets, 'rewrite');
  if (type === 'annotations') return Number(assets.helpfulAnnotations) || 0;
  if (type === 'comments') return Number(assets.helpfulComments) || 0;
  if (type === 'chat') return Number(assets.helpfulChats) || 0;
  return helpfulAiAssetItemCount(assets, 'translation')
    + helpfulAiAssetItemCount(assets, 'rewrite')
    + (Number(assets.helpfulAnnotations) || 0)
    + (Number(assets.helpfulComments) || 0)
    + (Number(assets.helpfulChats) || 0);
}

function compareAssetEntries(a, b) {
  const latestDelta = assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter);
  if (state.assetSort === 'helpful') {
    const helpfulDelta = assetHelpfulScoreForType(b, state.assetFilter) - assetHelpfulScoreForType(a, state.assetFilter);
    if (helpfulDelta) return helpfulDelta;
    const helpfulCommentDelta = assetHelpfulItemCount(b, state.assetFilter) - assetHelpfulItemCount(a, state.assetFilter);
    if (helpfulCommentDelta) return helpfulCommentDelta;
  }
  return latestDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
}

function assetDashboardStats() {
  const entries = state.entries.filter(hasEntryAssets);
  const latest = entries
    .slice()
    .sort((a, b) => Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0))[0] || null;
  const counts = Object.fromEntries(Object.keys(ASSET_FILTERS).map(type => [type, assetTypeCount(entries, type)]));
  const helpfulTotal = entries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry), 0);
  const helpfulEntries = entries.reduce((sum, entry) => sum + (assetHelpfulScoreForType(entry) > 0 ? 1 : 0), 0);
  return {
    entries,
    latest,
    counts,
    helpfulEntries,
    helpfulTotal,
    totalAssets: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function renderAssetDashboard() {
  const dashboard = $('#asset-dashboard');
  if (!dashboard) return;
  dashboard.classList.add('hidden');
}

function assetActivityLabel(entry) {
  if (state.view !== 'assets') return '';
  const assets = entry && entry.assets ? entry.assets : {};
  if (state.assetSort === 'helpful' && assetHelpfulScoreForType(entry, state.assetFilter) > 0) {
    const helpful = assetHelpfulScoreForType(entry, state.assetFilter);
    const latest = assetLatestAtForType(entry, state.assetFilter);
    return `有用 ${helpful} 次${latest ? ` · 最近沉淀 ${formatAssetTime(latest)}` : ''}`;
  }
  if (state.assetFilter) {
    const filteredAt = assetLatestAtForType(entry, state.assetFilter);
    if (!filteredAt) return '';
    const filteredLabel = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
    return `${filteredLabel} · 最近沉淀 ${formatAssetTime(filteredAt)}`;
  }
  if (!assets.latestAt) return '';
  const types = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const labels = types.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean);
  const prefix = labels.length ? labels.join(' / ') : '资产';
  return `${prefix} · 最近沉淀 ${formatAssetTime(assets.latestAt)}`;
}

function entryHistoryLabel(entry) {
  if (state.view !== 'history' || !entry || !state.history.has(entry.id)) return '';
  return `最近阅读 ${formatAssetTime(state.history.get(entry.id))}`;
}

function hotEntryLabel(entry) {
  if (state.view !== 'hot') return '';
  const q = qScoreParts(entry);
  const stats = entryStats(entry);
  const parts = [
    `QScore ${q.score.toFixed(1)}`,
    stats.likeCount ? `赞 ${formatCompactCount(stats.likeCount)}` : '',
    stats.dislikeCount ? `负反馈 ${formatCompactCount(stats.dislikeCount)}` : '',
    stats.favoriteCount ? `收藏 ${formatCompactCount(stats.favoriteCount)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function assetPreviewForEntry(entry) {
  if (state.view !== 'assets') return null;
  if (
    state.assetSort === 'helpful'
    && !state.assetFilter
    && entry?.assets?.topHelpfulAsset
  ) {
    return entry.assets.topHelpfulAsset;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'translation'
    && entry?.assets?.topHelpfulTranslation
  ) {
    return entry.assets.topHelpfulTranslation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'rewrite'
    && entry?.assets?.topHelpfulRewrite
  ) {
    return entry.assets.topHelpfulRewrite;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'annotations'
    && entry?.assets?.topHelpfulAnnotation
  ) {
    return entry.assets.topHelpfulAnnotation;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'comments'
    && entry?.assets?.topHelpfulComment
  ) {
    return entry.assets.topHelpfulComment;
  }
  if (
    state.assetSort === 'helpful'
    && state.assetFilter === 'chat'
    && entry?.assets?.topHelpfulChat
  ) {
    return entry.assets.topHelpfulChat;
  }
  return assetPreviewForType(entry, state.assetFilter);
}

function assetPreviewForType(entry, type = '') {
  const assets = entry && entry.assets ? entry.assets : {};
  const previews = assets.previews || {};
  const preview = type && previews[type] ? previews[type] : assets.preview;
  if (!preview || !preview.type || !preview.text) return null;
  return preview;
}

function assetPreviewDisplay(preview) {
  const type = ASSET_FILTER_TYPES.includes(preview && preview.type) ? preview.type : 'comments';
  const baseLabel = ASSET_TYPE_LABELS[type] || '资产';
  if (type === 'comments') {
    const display = commentDisplayParts(preview.text);
    return {
      type,
      label: display.label ? `${baseLabel} · ${display.label}` : baseLabel,
      text: display.body || preview.text,
      commentType: display.type,
    };
  }
  if (type === 'chat') {
    const roleLabel = preview.role === 'user' ? '提问' : preview.role === 'assistant' ? '回答' : '';
    return {
      type,
      label: roleLabel ? `${baseLabel} · ${roleLabel}` : baseLabel,
      text: preview.text,
      commentType: '',
    };
  }
  return {
    type,
    label: baseLabel,
    text: preview.text,
    commentType: '',
  };
}

function assetPreviewHtml(preview) {
  const display = assetPreviewDisplay(preview);
  const { type, label } = display;
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean).join(' · ');
  const itemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const copyItemId = preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  return `
    <div class="entry-asset-preview-row">
      <button type="button" class="entry-asset-preview asset-preview-${type}" data-asset="${escapeHtml(type)}"${itemId} title="查看${escapeHtml(label)}资产">
        <span class="entry-asset-preview-type">${escapeHtml(label)}</span>
        <span class="entry-asset-preview-text">${escapeHtml(display.text)}</span>
        ${meta ? `<span class="entry-asset-preview-meta">${escapeHtml(meta)}</span>` : ''}
      </button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy-content="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}内容" aria-label="复制${escapeHtml(label)}内容">${lucideIcon('file-text')}</button>
      <button type="button" class="entry-asset-preview-copy" data-asset-preview-copy="${escapeHtml(type)}"${copyItemId} title="复制${escapeHtml(label)}链接" aria-label="复制${escapeHtml(label)}链接">${lucideIcon('copy')}</button>
    </div>`;
}

function assetItemListHtml(entry) {
  if (state.view !== 'assets' || !ASSET_FILTER_TYPES.includes(state.assetFilter)) return '';
  const assets = entry && entry.assets ? entry.assets : {};
  let items = (assets.items && assets.items[state.assetFilter]) || [];
  if (state.assetSort === 'helpful') {
    const top = state.assetFilter === 'chat'
      ? assets.topHelpfulChat
      : state.assetFilter === 'translation'
        ? assets.topHelpfulTranslation
        : state.assetFilter === 'rewrite'
          ? assets.topHelpfulRewrite
          : state.assetFilter === 'annotations'
            ? assets.topHelpfulAnnotation
            : assets.topHelpfulComment;
    const byId = new Map();
    for (const item of [top, ...items]) {
      const key = item && item.id ? item.id : `${item && item.at}:${item && item.text}`;
      if (item && key && !byId.has(key)) byId.set(key, item);
    }
    items = [...byId.values()]
      .sort((a, b) => (Number(b.helpfulCount || 0) - Number(a.helpfulCount || 0)) || (Number(b.at || 0) - Number(a.at || 0)))
      .slice(0, 3);
  }
  if (!items.length) return '';
  const total = assetCountForType(entry, state.assetFilter);
  const label = ASSET_TYPE_LABELS[state.assetFilter] || '资产';
  const more = total > items.length && ['annotations', 'comments', 'chat'].includes(state.assetFilter)
    ? `<button type="button" class="entry-asset-more" data-asset="${escapeHtml(state.assetFilter)}">查看全部 ${total} 条${escapeHtml(label)}</button>`
    : total > items.length
      ? `<span class="entry-asset-more">还有 ${total - items.length} 条${escapeHtml(label)}</span>`
    : '';
  return `<div class="entry-asset-items">
    ${items.map(item => assetPreviewHtml(item)).join('')}
    ${more}
  </div>`;
}

function entryPrimaryAssetType(entry) {
  const assets = entry && entry.assets ? entry.assets : {};
  const latestTypes = Array.isArray(assets.latestTypes) ? assets.latestTypes : [];
  const latest = latestTypes.find(type => ASSET_FILTER_TYPES.includes(type) && entryHasAssetType(entry, type));
  if (latest) return latest;
  return ASSET_FILTER_TYPES.find(type => entryHasAssetType(entry, type)) || '';
}

function latestAssetActivity(limit = 4) {
  return state.entries
    .filter(entry => hasEntryAssets(entry) && Number(entry.assets?.latestAt || 0) > 0)
    .slice()
    .sort((a, b) => {
      const assetDelta = Number(b.assets?.latestAt || 0) - Number(a.assets?.latestAt || 0);
      return assetDelta || (b.publishedTs || 0) - (a.publishedTs || 0);
    })
    .slice(0, limit)
    .map(entry => {
      const type = entryPrimaryAssetType(entry);
      const latestTypes = Array.isArray(entry.assets?.latestTypes) ? entry.assets.latestTypes : [];
      const labels = latestTypes.map(item => ASSET_TYPE_LABELS[item]).filter(Boolean);
      const preview = assetPreviewForType(entry, type);
      const previewMeta = preview
        ? [preview.author, preview.model].filter(Boolean).join(' · ')
        : '';
      return {
        entry,
        type,
        labels: labels.length ? labels.join(' / ') : (ASSET_TYPE_LABELS[type] || '资产'),
        preview,
        previewMeta,
      };
    });
}

function isHomeScope() {
  return state.view === 'all' && !state.filterSource && !state.filterCategory && !state.q;
}

function homeAssetActivityItems(limit = 24) {
  return latestAssetActivity(limit).filter(item => item.type);
}

function renderEntryPaneTabs() {
  const tabs = $('#entry-pane-tabs');
  if (!tabs) return;
  const show = isHomeScope() && state.entries.length > 0;
  tabs.classList.toggle('hidden', !show);
  if (!show) return;
  const assetCount = homeAssetActivityItems(1000).length;
  const entryCount = state.entries.length;
  $('#home-entry-count').textContent = entryCount;
  $('#home-asset-count').textContent = assetCount;
  $$('#entry-pane-tabs [data-home-tab]').forEach(btn => {
    const active = btn.dataset.homeTab === state.homeTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function currentListScope() {
  if (state.view === 'hot') return 'hot';
  if (state.view === 'unread') return 'unread';
  return 'latest';
}

function renderListScopeBar() {
  const bar = $('#list-scope-bar');
  if (!bar) return;
  const hidden = state.view === 'contributors';
  bar.classList.toggle('hidden', hidden);
  if (hidden) return;
  const syllabus = isSyllabusSourceFilter();
  bar.classList.toggle('list-scope-bar--syllabus', syllabus);
  // 课程库是目录，不是收件箱：隐藏未读/热门，强制回到目录序
  if (syllabus && (state.view === 'unread' || state.view === 'hot')) {
    state.view = 'all';
  }
  const active = currentListScope();
  $$('#list-scope-bar [data-list-scope]').forEach(btn => {
    const scope = btn.dataset.listScope;
    if (scope === 'latest') btn.textContent = syllabus ? '目录' : '最新';
    if (scope === 'unread' || scope === 'hot') {
      btn.classList.toggle('hidden', syllabus);
      btn.hidden = syllabus;
    }
    const isActive = scope === active || (syllabus && scope === 'latest' && active === 'latest');
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function selectListScope(scope = 'latest') {
  const next = ['latest', 'hot', 'unread'].includes(scope) ? scope : 'latest';
  const nextView = next === 'latest' ? 'all' : next;
  // 同模式连点：只校正高亮，不重绘
  if (state.view === nextView) {
    renderListScopeBar();
    return;
  }
  state.view = nextView;
  state.assetFilter = null;
  state.assetSort = 'latest';
  state.contributorSort = 'latest';
  // 未读/最新/热门仅本地筛选：不 loadEntries、不关阅读区、不整侧栏重建（消闪烁）
  state.listWindowStart = 0;
  state.listWindowEnd = 0;
  const listEl = $('#entry-list');
  if (listEl) listEl.scrollTop = 0;
  updateListTitle();
  renderList();
  // 同步侧栏「全部/未读」高亮；侧栏已建好时 O(1) class 切换
  if (typeof updateSidebarSelection === 'function') updateSidebarSelection();
}

function assetActivityItemHtml({ entry, type, labels, preview, previewMeta }, { large = false } = {}) {
  const src = sourceById(entry.sourceId);
  const itemId = preview && preview.id ? ` data-asset-item-id="${escapeHtml(preview.id)}"` : '';
  const previewDisplay = preview ? assetPreviewDisplay(preview) : null;
  const previewText = previewDisplay && previewDisplay.text ? previewDisplay.text : '';
  const labelText = previewDisplay && previewDisplay.commentType && labels === ASSET_TYPE_LABELS.comments
    ? previewDisplay.label
    : labels;
  const helpfulMeta = preview && Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [src && src.name, previewMeta, helpfulMeta, formatAssetTime(entry.assets.latestAt)].filter(Boolean).join(' · ');
  return `<button type="button" class="asset-activity-item${large ? ' asset-activity-item-large' : ''} asset-activity-${type}" data-asset-entry="${escapeHtml(entry.id)}" data-asset-focus="${escapeHtml(type)}"${itemId}>
    <span class="asset-activity-type">${escapeHtml(labelText)}</span>
    <strong>${escapeHtml(entry.titleZh || entry.title || '无标题')}</strong>
    ${previewText ? `<span class="asset-activity-preview">${escapeHtml(previewText)}</span>` : ''}
    <span class="asset-activity-meta">${escapeHtml(meta)}</span>
  </button>`;
}

function renderHomeAssetActivityList(el) {
  const items = homeAssetActivityItems(30);
  el.classList.add('home-asset-activity-list');
  if (!items.length) {
    el.innerHTML = '<div class="list-empty">还没有公开资产动态<br/>翻译、重写、点评或对话后会出现在这里</div>';
    return;
  }
  const { totalAssets, entries, helpfulTotal } = assetDashboardStats();
  el.innerHTML = `
    <div class="home-asset-hero">
      <div>
        <span>公开资产动态</span>
        <strong>${totalAssets} 条资产 · ${entries.length} 篇文章</strong>
        <em>${helpfulTotal ? `读者标记有用 ${helpfulTotal} 次` : '按最新沉淀排序'}</em>
      </div>
      <button type="button" class="ghost-btn" data-asset-open-all>全部资产</button>
    </div>
    <div class="home-asset-activity-grid">
      ${items.map(item => assetActivityItemHtml(item, { large: true })).join('')}
    </div>`;
}

async function openAssetActivityButton(btn) {
  if (!btn) return;
  const entry = state.entries.find(item => item.id === btn.dataset.assetEntry);
  if (!entry) return;
  const focus = btn.dataset.assetFocus;
  const itemId = btn.dataset.assetItemId || '';
  await openEntry(entry, {
    focus,
    aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
    commentId: focus === 'comments' ? itemId : '',
    chatMessageId: focus === 'chat' ? itemId : '',
  });
}

function renderAssetActivityStrip() {
  const el = $('#asset-activity-strip');
  if (!el) return;
  el.classList.remove('asset-filter-strip', 'qscore-strip');
  if (state.view === 'hot') {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  if (state.view === 'assets') {
    const { entries, latest, counts, totalAssets } = assetDashboardStats();
    const total = entries.length;
    const allActiveEntries = state.assetFilter
      ? entries.filter(entry => entryHasAssetType(entry, state.assetFilter))
      : entries;
    const scopedEntries = state.q
      ? allActiveEntries.filter(entry => entryMatchesSearch(entry, { includeAssets: true }))
      : allActiveEntries;
    const activeAssetCount = state.assetFilter ? assetTypeCount(scopedEntries, state.assetFilter) : assetTotalCount(scopedEntries);
    const activeEntryCount = scopedEntries.length;
    const activeLabel = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    el.classList.toggle('hidden', !total && !state.assetFilter);
    if (!total && !state.assetFilter) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const activeLatest = scopedEntries
      .slice()
      .sort((a, b) => assetLatestAtForType(b, state.assetFilter) - assetLatestAtForType(a, state.assetFilter))[0] || null;
    const activeLatestAt = activeLatest ? assetLatestAtForType(activeLatest, state.assetFilter) : 0;
    const latestTypes = !state.assetFilter && latest && Array.isArray(latest.assets?.latestTypes)
      ? latest.assets.latestTypes.map(type => ASSET_TYPE_LABELS[type]).filter(Boolean)
      : [];
    const latestLabel = state.assetFilter
      ? (ASSET_TYPE_LABELS[state.assetFilter] || '资产')
      : (latestTypes.length ? latestTypes.join(' / ') : '资产');
    const latestText = activeLatestAt
      ? `${latestLabel} · ${formatAssetTime(activeLatestAt)}`
      : '暂无沉淀';
    const activeHelpfulCount = scopedEntries.reduce((sum, entry) => sum + assetHelpfulScoreForType(entry, state.assetFilter), 0);
    const sortText = state.assetSort === 'helpful'
      ? (activeHelpfulCount ? `有用 ${activeHelpfulCount} 次` : '暂无有用标记')
      : '按最新沉淀';
    const scopeText = `${activeAssetCount} 条 · ${activeEntryCount} 篇文章`;
    const statusText = state.q
      ? `匹配 ${scopeText} · ${sortText} · ${latestText}`
      : `${scopeText} · ${sortText} · ${latestText}`;
    const feedHref = `${state.assetFilter ? `/assets/${state.assetFilter}.xml` : '/assets.xml'}${state.assetSort === 'helpful' ? '?sort=helpful' : ''}`;
    const sortButtons = Object.entries(ASSET_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.assetSort === sort ? ' active' : ''}" data-asset-sort="${escapeHtml(sort)}" aria-pressed="${state.assetSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    const chips = [
      `<button type="button" class="asset-filter-chip${!state.assetFilter ? ' active' : ''}" data-asset-strip-filter="" title="查看全部公开资产">
        <span>全部</span><strong>${totalAssets}</strong>
      </button>`,
      ...Object.entries(ASSET_FILTERS).map(([type, def]) => {
        const count = counts[type] || 0;
        return `<button type="button" class="asset-filter-chip asset-filter-${type}${state.assetFilter === type ? ' active' : ''}" data-asset-strip-filter="${escapeHtml(type)}" ${count ? '' : 'disabled'} title="${escapeHtml(count ? def.title : '暂无这类资产')}">
          <span>${escapeHtml(def.label)}</span><strong>${count}</strong>
        </button>`;
      }),
    ];
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>${escapeHtml(activeLabel)}</span>
        <strong>${activeAssetCount} 条</strong>
        <em>${escapeHtml(statusText)}</em>
        <button type="button" class="asset-copy-link" data-asset-copy-list title="复制当前资产页链接" aria-label="复制当前资产页链接">${lucideIcon('copy')}</button>
        <a class="asset-feed-link" href="${escapeHtml(feedHref)}" target="_blank" rel="noopener" title="订阅公开资产 RSS">RSS</a>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="公开资产排序">${sortButtons}</div>
      </div>
      <div class="asset-filter-list" aria-label="资产类型筛选">
        ${chips.join('')}
      </div>`;
    return;
  }
  if (state.view === 'contributors') {
    const total = (state.contributors || []).length;
    const list = visibleContributors();
    const contributorCount = list.length;
    const assetCount = list.reduce((sum, contributor) => sum + (Number(contributor.assetCount) || 0), 0);
    const helpfulCount = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) || 0), 0);
    const helpfulContributors = list.reduce((sum, contributor) => sum + (Number(contributor.helpfulCount) > 0 ? 1 : 0), 0);
    const latestAt = list.reduce((latest, contributor) => Math.max(latest, Number(contributor.latestAt) || 0), 0);
    el.classList.toggle('hidden', !total && !state.q);
    if (!total && !state.q) {
      el.innerHTML = '';
      return;
    }
    el.classList.add('asset-filter-strip');
    const latestText = latestAt ? `最近 ${formatAssetTime(latestAt)}` : '暂无沉淀';
    const sortText = state.contributorSort === 'helpful'
      ? (helpfulCount ? `有用 ${helpfulCount} 次` : '暂无有用标记')
      : state.contributorSort === 'assets'
      ? '按资产数'
      : '按最新沉淀';
    const statusText = state.q
      ? `匹配 ${contributorCount} 人 · ${assetCount} 条资产 · ${sortText} · ${latestText}`
      : `${contributorCount} 人 · ${assetCount} 条资产 · ${helpfulContributors} 人获认可 · ${sortText} · ${latestText}`;
    const sortButtons = Object.entries(CONTRIBUTOR_SORTS).map(([sort, def]) => `
      <button type="button" class="asset-sort-btn${state.contributorSort === sort ? ' active' : ''}" data-contributor-sort="${escapeHtml(sort)}" aria-pressed="${state.contributorSort === sort ? 'true' : 'false'}" title="${escapeHtml(def.title)}">${escapeHtml(def.label)}</button>
    `).join('');
    el.innerHTML = `
      <div class="asset-filter-head">
        <span>贡献榜</span>
        <strong>${contributorCount} 人</strong>
        <em>${escapeHtml(statusText)}</em>
      </div>
      <div class="asset-sort-row">
        <span>排序</span>
        <div class="asset-sort-toggle" role="group" aria-label="贡献榜排序">${sortButtons}</div>
      </div>`;
    return;
  }
  el.classList.add('hidden');
  el.innerHTML = '';
}

function mergeAssets(entry, patch = {}) {
  return {
    translation: false,
    rewrite: false,
    comments: 0,
    annotations: 0,
    chatMessages: 0,
    latestAt: 0,
    latestTypes: [],
    preview: null,
    previews: {},
    items: {},
    translationCount: 0,
    rewriteCount: 0,
    helpfulCount: 0,
    commentHelpfulCount: 0,
    annotationHelpfulCount: 0,
    chatHelpfulCount: 0,
    translationHelpfulCount: 0,
    rewriteHelpfulCount: 0,
    helpfulComments: 0,
    helpfulAnnotations: 0,
    helpfulChats: 0,
    helpfulAssets: 0,
    topHelpfulComment: null,
    topHelpfulAnnotation: null,
    topHelpfulChat: null,
    topHelpfulTranslation: null,
    topHelpfulRewrite: null,
    topHelpfulAsset: null,
    ...(entry && entry.assets ? entry.assets : {}),
    ...patch,
  };
}

function renderReaderAssets(entry = state.activeEntry) {
  const el = $('#reader-assets');
  if (!el) return;
  const html = assetBadgesHtml(entry, { interactive: true });
  el.innerHTML = html;
  // 有 asset badges 时显示，无则隐藏
  el.classList.toggle('hidden', !String(html || '').trim());
}

function setReaderAssetsExpanded(expanded) {
  state.readerAssetsExpanded = Boolean(expanded);
  renderReaderAssetSummary();
}

function updateReaderAssetsToggle(count = 0) {
  const btn = $('#reader-assets-toggle');
  if (!btn) return;
  btn.classList.toggle('hidden', !count);
  btn.disabled = !count;
  btn.setAttribute('aria-expanded', state.readerAssetsExpanded ? 'true' : 'false');
  btn.textContent = state.readerAssetsExpanded ? '收起资产' : `资产导航 ${count}`;
}

function assetMetaLine(parts) {
  return parts.filter(Boolean).join(' · ') || '正在加载详情';
}

function assetSummaryText(value, max = 150) {
  const text = String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function readerAssetPreview(entry, type, fallback = '') {
  const direct = assetSummaryText(type === 'comments' ? commentDisplayParts(fallback).body : fallback);
  if (direct) return direct;
  const preview = assetPreviewForType(entry, type);
  return assetSummaryText(preview ? assetPreviewDisplay(preview).text : '');
}

function readerAssetPreviewMeta(entry, type, leading = []) {
  const preview = assetPreviewForType(entry, type);
  if (!preview) return '';
  const helpfulMeta = Number(preview.helpfulCount || 0) > 0
    ? `有用 ${Number(preview.helpfulCount || 0)}`
    : '';
  const meta = [preview.author, preview.model, helpfulMeta, formatAssetTime(preview.at)].filter(Boolean);
  return meta.length ? assetMetaLine([...leading, ...meta]) : '';
}

function assetHelpfulMeta(asset) {
  const count = Number(asset && asset.helpfulCount) || 0;
  return count > 0 ? `有用 ${count}` : '';
}

function readerAssetSummaryLabel(entry, type, fallback) {
  const preview = assetPreviewForType(entry, type);
  const display = preview ? assetPreviewDisplay(preview) : null;
  return display && display.commentType ? display.label : fallback;
}

function latestAssetItem(items, pickLast = false) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return pickLast ? list[list.length - 1] : list[0];
}

function renderReaderAssetSummary(entry = state.activeEntry) {
  const el = $('#reader-asset-summary');
  if (!el) return;
  if (!entry) {
    el.classList.add('hidden');
    el.innerHTML = '';
    updateReaderAssetsToggle(0);
    return;
  }
  const assets = mergeAssets(entry);
  const rows = [];
  const translation = state.translation && state.translation.entryId === entry.id ? state.translation : null;
  const rewrite = state.rewrite && state.rewrite.entryId === entry.id ? state.rewrite : null;
  const annotations = (state.annotations || []).filter(annotation => annotation.entryId === entry.id);
  const comments = (state.comments || []).filter(comment => comment.entryId === entry.id);
  const messages = (state.agentMessages || []).filter(message => !message.entryId || message.entryId === entry.id);

  if (assets.translation) {
    const total = assetCountForType(entry, 'translation');
    const firstTranslatedParagraph = translation && Array.isArray(translation.content)
      ? translation.content.map(translationPairText).find(Boolean)
      : '';
    rows.push({
      type: 'translation',
      label: '中文翻译',
      value: translation ? assetMetaLine([total > 1 ? `${total} 条` : '', translation.createdBy, translation.model, assetHelpfulMeta(translation), formatAssetTime(translation.updatedAt)]) : (readerAssetPreviewMeta(entry, 'translation', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'translation', firstTranslatedParagraph),
    });
  }
  if (assets.rewrite) {
    const total = assetCountForType(entry, 'rewrite');
    const copy = rewriteUiCopy(entry);
    rows.push({
      type: 'rewrite',
      label: copy.asset,
      value: rewrite ? assetMetaLine([total > 1 ? `${total} 条` : '', rewrite.createdBy, rewrite.model, assetHelpfulMeta(rewrite), formatAssetTime(rewrite.updatedAt)]) : (readerAssetPreviewMeta(entry, 'rewrite', [total > 1 ? `${total} 条` : '']) || '正在加载详情'),
      preview: readerAssetPreview(entry, 'rewrite', rewrite && rewrite.body),
    });
  }
  if (assets.comments) {
    const latest = [...comments].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'comments',
      label: readerAssetSummaryLabel(entry, 'comments', '人工点评'),
      value: latest ? assetMetaLine([`${assets.comments} 条`, latest.author, helpfulMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'comments', [`${assets.comments} 条`]) || `${assets.comments} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'comments', latest && latest.body),
    });
  }
  if (assets.annotations) {
    const latest = [...annotations].sort((a, b) =>
      Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
    )[0] || null;
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    const replyMeta = latest && Number(latest.replyCount || 0) > 0 ? `回复 ${Number(latest.replyCount || 0)}` : '';
    rows.push({
      type: 'annotations',
      label: readerAssetSummaryLabel(entry, 'annotations', '划线点评'),
      value: latest ? assetMetaLine([`${assets.annotations} 条`, latest.author, ANNOTATION_SURFACE_LABELS[latest.surface], helpfulMeta, replyMeta, formatAssetTime(latest.updatedAt || latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'annotations', [`${assets.annotations} 条`]) || `${assets.annotations} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'annotations', latest && `${latest.quote} ${latest.body}`),
    });
  }
  if (assets.chatMessages) {
    const latest = latestAssetItem(messages, true);
    const helpfulMeta = latest && Number(latest.helpfulCount || 0) > 0 ? `有用 ${Number(latest.helpfulCount || 0)}` : '';
    rows.push({
      type: 'chat',
      label: '文章对话',
      value: latest ? assetMetaLine([`${assets.chatMessages} 条`, latest.author, helpfulMeta, formatAssetTime(latest.createdAt)]) : (readerAssetPreviewMeta(entry, 'chat', [`${assets.chatMessages} 条`]) || `${assets.chatMessages} 条 · 正在加载详情`),
      preview: readerAssetPreview(entry, 'chat', latest && latest.content),
    });
  }

  updateReaderAssetsToggle(rows.length);
  el.innerHTML = rows.map(row => `
    <div class="asset-summary-row asset-summary-${row.type}">
      <button type="button" class="asset-summary-item" data-asset-summary="${row.type}">
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(row.value)}</strong>
        ${row.preview ? `<em class="asset-summary-preview">${escapeHtml(row.preview)}</em>` : ''}
      </button>
      <button type="button" class="asset-summary-copy" data-asset-copy="${row.type}" title="复制${escapeHtml(row.label)}链接" aria-label="复制${escapeHtml(row.label)}链接">${lucideIcon('copy')}</button>
    </div>`).join('');
  el.classList.toggle('hidden', !rows.length || !state.readerAssetsExpanded);
  renderArticleInfoPanel();
}

function renderArticleInfoPanel(entry = state.activeEntry) {
  const titleEl = $('#article-info-title');
  const body = $('#article-info-body');
  const workbenchTitle = $('#context-workbench-title');
  if (!entry) {
    if (workbenchTitle) workbenchTitle.textContent = '讨论、伴读和文章信号';
    if (!titleEl || !body) return;
    titleEl.textContent = '未选择文章';
    body.innerHTML = '<div class="article-info-empty">选择一篇文章后，这里会显示来源、链接、资产和反馈信号。</div>';
    return;
  }
  const src = sourceById(entry.sourceId);
  const stats = entryStats(entry);
  const assets = mergeAssets(entry);
  const assetItems = entryAssetItems(entry);
  const qScore = qScoreParts(entry);
  const canonicalUrl = readerUrlFor(entry, state.readerTab, readerShareFocus(), state.readerAssetId).href;
  if (workbenchTitle) workbenchTitle.textContent = plainSnippet(entry.titleZh || entry.title || '当前文章', 28);
  if (!titleEl || !body) return;
  titleEl.textContent = entry.titleZh || entry.title || '无标题';
  const originalState = hasUsableOriginalContent(entry)
    ? '已保存完整原文'
    : entry.originalFetchAttemptedAt
      ? `获取失败 · ${entry.originalFetchError || '可重试'}`
      : '可尝试获取原文';
  const assetRows = assetItems.length
    ? assetItems.map(item => `
      <button type="button" class="article-info-asset asset-${item.type}" data-info-asset="${escapeHtml(item.type)}">
        <span>${escapeHtml(item.type === 'rewrite' ? rewriteUiCopy(entry).asset : (ASSET_FOCUS_LABELS[item.type] || item.label))}</span>
        <strong>${escapeHtml(String(assetCountForType(entry, item.type) || 1))}</strong>
      </button>`).join('')
    : '<span class="article-info-muted">暂无公开资产</span>';
  body.innerHTML = `
    <div class="article-info-group">
      <span class="article-info-label">来源</span>
      <div class="article-info-source">${src ? sourceFaviconHtml(src, 16) : ''}<strong>${escapeHtml(src ? src.name : entry.sourceId || '未知来源')}</strong></div>
      <div class="article-info-meta">${escapeHtml([entry.author, entry.published ? new Date(entry.published).toLocaleString('zh-CN') : ''].filter(Boolean).join(' · ') || '无时间信息')}</div>
    </div>
    <div class="article-info-grid">
      <div><span>访问</span><strong>${escapeHtml(formatCompactCount(stats.viewCount) || '0')}</strong></div>
      <div><span>收藏</span><strong>${escapeHtml(formatCompactCount(stats.favoriteCount) || '0')}</strong></div>
      <div><span>赞</span><strong>${escapeHtml(formatCompactCount(stats.likeCount) || '0')}</strong></div>
    </div>
    <div class="article-info-group article-qscore">
      <span class="article-info-label">QScore</span>
      <div class="article-qscore-head">
        <strong>${escapeHtml(qScore.score.toFixed(1))}</strong>
        <span>质量信号 ${escapeHtml(qScore.positive.toFixed(1))} · 降权 ${escapeHtml(qScore.negative.toFixed(1))} · 时间衰减 ÷${escapeHtml(qScore.decay.toFixed(2))}</span>
      </div>
      <div class="article-qscore-parts">${qScore.parts.map(part => `<span>${escapeHtml(part)}</span>`).join('')}</div>
    </div>
    <div class="article-info-group">
      <span class="article-info-label">原文状态</span>
      <strong>${escapeHtml(originalState)}</strong>
      ${assets.latestAt ? `<div class="article-info-meta">最近资产：${escapeHtml(formatAssetTime(assets.latestAt))}</div>` : ''}
    </div>
    <div class="article-info-group">
      <span class="article-info-label">公开资产</span>
      <div class="article-info-assets">${assetRows}</div>
    </div>
    <div class="article-info-actions">
      <a class="ghost-btn" href="${escapeHtml(entry.link || '#')}" target="_blank" rel="noopener">${iconButtonLabel('external-link', '打开原文')}</a>
      <button type="button" class="ghost-btn" data-info-copy="${escapeHtml(canonicalUrl)}">${iconButtonLabel('copy', '复制链接')}</button>
    </div>`;
}

function scrollReaderTarget(selector, { behavior = 'smooth', offset = 12 } = {}) {
  const target = $(selector);
  if (!target) return;
  const pane = $('#reader-pane');
  if (pane && pane.contains(target)) {
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = pane.scrollTop + targetRect.top - paneRect.top - offset;
    pane.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  target.scrollIntoView({ behavior, block: 'start' });
}

function performArticleAssetJump(type, { syncUrl = true, replaceUrl = false } = {}) {
  if (!state.activeEntry) return;
  if (type === 'translation') {
    state.readerFocus = 'translation';
    handleReaderTab('translation', { preserveFocus: true, replaceUrl });
    scrollReaderTarget('#reader-translation');
    return;
  }
  if (type === 'rewrite') {
    state.readerFocus = 'rewrite';
    setReaderTab('rewrite', { syncUrl, replaceUrl });
    scrollReaderTarget('#reader-rewrite-panel');
    return;
  }
  if (type === 'comments') {
    state.readerFocus = 'comments';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    scrollReaderTarget('#reader-comments');
    return;
  }
  if (type === 'annotations') {
    state.readerFocus = 'annotations';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    const first = visibleAnnotationsForReader()[0];
    if (first) {
      jumpToAnnotation(first.id);
      return;
    }
    scrollReaderTarget('#reader-annotations');
    return;
  }
  if (type === 'chat') {
    state.readerFocus = 'chat';
    if (syncUrl) syncReaderUrl({ replace: replaceUrl });
    setContextPanel('agent', { expand: true });
    if (highlightAgentMessageFromRoute()) return;
    const messages = $('#agent-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    scrollReaderTarget('#agent-pane');
  }
}

function settlePendingAssetJump(type, { clear = true } = {}) {
  if (state.pendingAssetJump !== type) return;
  const entryId = state.activeEntry && state.activeEntry.id;
  [0, 180, 520].forEach((delay, index, delays) => {
    setTimeout(() => {
      if (!state.activeEntry || state.activeEntry.id !== entryId || state.pendingAssetJump !== type) return;
      performArticleAssetJump(type, { syncUrl: false });
      if (clear && index === delays.length - 1) state.pendingAssetJump = null;
    }, delay);
  });
}

function jumpToArticleAsset(type) {
  if (type === 'translation' || type === 'rewrite') state.readerAssetId = '';
  state.pendingAssetJump = type;
  performArticleAssetJump(type);
}

function copyArticleAssetLink(type) {
  const url = readerAssetUrl(type);
  if (!url) {
    toast('没有可复制的资产链接');
    return;
  }
  const label = ASSET_FOCUS_LABELS[type] || '资产';
  copyText(url, `${label}链接已复制`);
}

function updateEntryAssets(entryId, patch = {}, { rerenderList = false } = {}) {
  if (!entryId) return;
  const base = entryByIdFromList(entryId) || state.activeEntry;
  if (!base && !state.activeEntry) return;
  const assets = mergeAssets(base || state.activeEntry, patch);
  patchCatalogEntry(entryId, { assets });
  if (state.activeEntry?.id === entryId) {
    state.activeEntry = { ...state.activeEntry, assets };
    renderReaderAssets(state.activeEntry);
    renderReaderAssetSummary(state.activeEntry);
  }
  if (rerenderList) renderList();
  else if (!patchEntryCardState(entryId, {
    active: state.activeEntry?.id === entryId,
    read: state.read.has(entryId),
  })) {
    /* card not in viewport batch — skip full list for assets-only patch */
  }
}

function applyServerEntryUpdate(entry) {
  if (!entry || !entry.id) return null;
  const current = state.activeEntry && state.activeEntry.id === entry.id ? state.activeEntry : (entryByIdFromList(entry.id) || {});
  const updated = { ...current, ...entry };
  // 目录只保留瘦字段，全文进 contentCache
  const listPatch = {
    title: updated.title,
    titleZh: updated.titleZh,
    summary: updated.summary && String(updated.summary).slice(0, 160),
    summaryZh: updated.summaryZh && String(updated.summaryZh).slice(0, 160),
    image: updated.image,
    published: updated.published,
    publishedTs: updated.publishedTs,
    author: updated.author,
    link: updated.link,
    assets: updated.assets,
    stats: updated.stats,
  };
  patchCatalogEntry(entry.id, listPatch);
  if (updated.content) contentCache.set(updated.id, updated.content);
  if (state.activeEntry?.id === entry.id) {
    // 保留已有中文标题/摘要，避免服务端 entry 无 titleZh 时冲掉列表中文
    state.activeEntry = {
      ...updated,
      titleZh: updated.titleZh || current.titleZh || '',
      summaryZh: updated.summaryZh || current.summaryZh || '',
    };
    // 简中视图中：只更新数据，勿 renderOriginal 把正文打回英文
    if (state.readerZhMode && state.translation && translationHasContent(state.translation)) {
      updateFetchOriginalButton(state.activeEntry);
      if (typeof patchEntryCardZhFields === 'function') patchEntryCardZhFields(entry.id);
    } else {
      renderTitle(state.activeEntry);
      renderOriginalContent(state.activeEntry, state.activeEntry.content || contentCache.get(updated.id) || '');
      updateFetchOriginalButton(state.activeEntry);
    }
  }
  // 不整表重绘；若当前可见卡需更新标题可 patch active
  patchEntryCardState(entry.id, {
    active: state.activeEntry?.id === entry.id,
    read: state.read.has(entry.id),
  });
  return updated;
}

/** 本机主人，恒为 true */
function isAdmin() {
  return true;
}

function isBiliWatchlaterEntry(entry) {
  if (!entry) return false;
  if (entry.sourceId === 'bili-watchlater') return true;
  const src = typeof sourceById === 'function' ? sourceById(entry.sourceId) : null;
  return Boolean(src && src.contentKind === 'social-bili');
}

function renderAdminEntryControls() {
  const btn = $('#reader-delete');
  const cancelBtn = $('#reader-cancel-watchlater');
  const canMutate = Boolean(state.activeEntry && state.activeEntry.id);
  const isBili = canMutate && isBiliWatchlaterEntry(state.activeEntry);
  if (btn) {
    // b站收藏优先用「取消收藏」；普通删除仍可用右键
    btn.classList.toggle('hidden', !canMutate || isBili);
    btn.disabled = !canMutate;
    if (canMutate) btn.title = '删除这篇文章';
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !isBili);
    cancelBtn.disabled = !isBili;
  }
}

/** 列表卡不再显示星标；保留函数避免旧调用报错 */
function patchEntryCardStar() {
  return false;
}

let entryContextId = '';

function hideEntryContextMenu() {
  const menu = $('#entry-context-menu');
  if (menu) menu.classList.add('hidden');
  entryContextId = '';
}

function showEntryContextMenu(event, entry) {
  const menu = $('#entry-context-menu');
  if (!menu || !entry) return;
  event.preventDefault();
  event.stopPropagation();
  hideSourceContextMenu();
  if (typeof hideArticleLinkMenu === 'function') hideArticleLinkMenu();
  entryContextId = entry.id;
  const starred = state.starred.has(entry.id);
  const starLabel = menu.querySelector('[data-entry-star-label]');
  if (starLabel) starLabel.textContent = starred ? '取消收藏' : '收藏';
  const readLabel = menu.querySelector('[data-entry-read-label]');
  if (readLabel) readLabel.textContent = state.read.has(entry.id) ? '未读' : '已读';
  const canMutate = true;
  const delBtn = menu.querySelector('[data-entry-action="delete"]');
  if (delBtn) delBtn.classList.toggle('hidden', !canMutate);
  const cancelWl = menu.querySelector('[data-entry-action="cancel-watchlater"]');
  if (cancelWl) cancelWl.classList.toggle('hidden', !(canMutate && isBiliWatchlaterEntry(entry)));
  menu.classList.remove('hidden');
  const width = 158;
  const height = 148;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
  menu.querySelector('button:not(.hidden)')?.focus();
}

function renderAuthState() {
  // 个人模式：无登录 UI，只保留侧栏 footer / AI 设置 / 删文控件
  $('#auth-open')?.classList.add('hidden');
  $('#account-info')?.classList.add('hidden');
  $('#account-settings-open')?.classList.add('hidden');
  const footer = $('.sidebar-footer');
  if (footer) footer.classList.remove('hidden');
  renderAdminEntryControls();
  renderSidebarAiSettings();
  updateAgentControls();
}

function setAccountMenuOpen() { /* no-op：无账号菜单 */ }

function toggleAccountMenu() { /* no-op */ }

function renderSidebarAiSettings() {
  const config = currentAiConfig();
  const profile = currentAiProfile();
  const ready = hasUsableAiConfig(config);
  const aiBtn = $('#ai-settings-btn');
  if (aiBtn) {
    aiBtn.classList.toggle('needs-key', !ready);
    aiBtn.title = ready
      ? `AI 设置 · ${profile.name || 'DeepSeek'} · ${config.model}`
      : '填写 API Key / Base URL / 模型名（翻译必填）';
    const label = aiBtn.querySelector('.button-label');
    if (label) label.textContent = ready ? 'AI 设置' : '填 Key';
  }
}

function setAuthMode() { /* no-op：无登录 */ }
function setAuthFormEnabled() { /* no-op */ }
function setChangePasswordFormEnabled() { /* no-op */ }
function openAuth() { /* no-op：个人模式永不登录 */ }
function closeAuth() { /* no-op */ }
function openChangePasswordModal() { /* no-op */ }
function closeChangePasswordModal() { /* no-op */ }

/** 个人本机：无需登录 */
function requireAuth() {
  return true;
}

function submitModalMode() {
  return String($('#submit-link-modal')?.dataset?.mode || 'article') === 'repo' ? 'repo' : 'article';
}

function configureSubmitModal(mode = 'article') {
  const isRepo = mode === 'repo';
  const modal = $('#submit-link-modal');
  if (modal) modal.dataset.mode = isRepo ? 'repo' : 'article';
  if ($('#submit-link-title')) $('#submit-link-title').textContent = isRepo ? 'GitHub 项目' : '个人精选';
  if ($('#submit-link-desc')) {
    $('#submit-link-desc').textContent = isRepo
      ? '粘贴 GitHub 仓库链接，收录为项目卡片（元数据 + README，不是文章）。'
      : '粘贴任意文章链接，抓取后收入「个人精选」，稍后慢慢读。';
  }
  if ($('#submit-link-url')) {
    $('#submit-link-url').placeholder = isRepo
      ? 'https://github.com/owner/repo'
      : 'https://example.com/article';
  }
  if ($('#submit-link-note')) {
    $('#submit-link-note').placeholder = isRepo
      ? '为什么收藏这个项目，或一句话备忘'
      : '为什么值得读，或一句话备忘';
  }
  if ($('#submit-link-submit')) {
    $('#submit-link-submit').textContent = isRepo ? '加入项目' : '加入个人精选';
  }
}

function openSubmitLinkModal(prefill = {}) {
  const next = {
    url: String(prefill.url || '').trim(),
    note: String(prefill.note || '').trim(),
    mode: prefill.mode === 'repo' ? 'repo' : 'article',
  };
  configureSubmitModal(next.mode);
  $('#submit-link-url').value = next.url || '';
  $('#submit-link-note').value = next.note || '';
  $('#submit-link-submit').disabled = false;
  $('#submit-link-modal').classList.remove('hidden');
  setTimeout(() => (next.url ? $('#submit-link-note') : $('#submit-link-url')).focus(), 30);
  return true;
}

function openSubmitGitHubModal(prefill = {}) {
  return openSubmitLinkModal({ ...prefill, mode: 'repo' });
}

function closeSubmitLinkModal() {
  $('#submit-link-modal').classList.add('hidden');
  configureSubmitModal('article');
}

async function focusSourceAndOpen(sourceId, entry) {
  state.filterSource = sourceId || null;
  state.filterCategory = null;
  state.assetFilter = null;
  if (!['all', 'unread', 'hot'].includes(state.view)) state.view = 'all';
  state.readerFocus = null;
  state.readerAssetId = '';
  await Promise.all([
    loadSources().catch(() => null),
    loadEntries().catch(() => null),
  ]);
  if (state.allEntries.length) {
    applyLocalEntryFilter({ fastBatch: false });
  }
  updateListTitle();
  renderSidebar();
  renderList();
  if (entry && entry.id) {
    const full = entryByIdFromList(entry.id) || entry;
    try { await openEntry(full); } catch { /* 列表已就绪即可 */ }
  }
}

async function focusClipSourceAndOpen(entry) {
  return focusSourceAndOpen('user-submitted', entry);
}

async function submitReaderLink() {
  const mode = submitModalMode();
  const url = $('#submit-link-url').value.trim();
  const note = $('#submit-link-note').value.trim();
  if (!url) {
    toast(mode === 'repo' ? '请填写 GitHub 仓库链接' : '请填写链接');
    return;
  }
  const btn = $('#submit-link-submit');
  const idleLabel = mode === 'repo' ? '加入项目' : '加入个人精选';
  btn.disabled = true;
  btn.textContent = '收录中…';
  try {
    const endpoint = mode === 'repo' ? '/api/submit-github-repo' : '/api/submit-link';
    const data = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, note }),
    });
    closeSubmitLinkModal();
    if (data.pending) {
      toast('已进入审核队列，通过后才会抓取和公开');
      return;
    }
    if (mode === 'repo') {
      toast('已加入 GitHub 项目');
      await focusSourceAndOpen(data.sourceId || 'github-projects', data.entry || null);
    } else {
      toast('已加入个人精选');
      await focusClipSourceAndOpen(data.entry || null);
    }
  } catch (err) {
    toast((mode === 'repo' ? '加入项目失败: ' : '加入个人精选失败: ') + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = idleLabel;
  }
}

async function submitAuth() { /* no-op：无登录 API */ }
async function submitChangePassword() { /* no-op */ }
async function logout() { /* no-op */ }

function renderContributorDirectory() {
  const list = visibleContributors();
  const el = $('#entry-list');
  el.innerHTML = '';
  renderAssetActivityStrip();
  if (!list.length) {
    const text = state.q
      ? `没有匹配“${escapeHtml(state.q)}”的贡献主页<br/>换个关键词试试`
      : '还没有公开贡献榜<br/>先发布点评或文章对话';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((contributor, index) => {
    const card = document.createElement('div');
    card.className = 'contributor-card';
    card.dataset.contributorId = contributor.id;
    const assetCount = Number(contributor.assetCount || 0);
    const helpfulCount = Number(contributor.helpfulCount || 0);
    const helpfulAssets = Number(contributor.helpfulAssets || 0);
    const followerCount = Number(contributor.followerCount || 0);
    const metaParts = [];
    if (contributor.bio) metaParts.push(contributor.bio);
    metaParts.push(`最近 ${formatAssetTime(contributor.latestAt)}`);
    card.innerHTML = `
      <div class="contributor-rank">#${index + 1}</div>
      ${avatarHtml(contributor, 'contributor-avatar')}
      <div class="contributor-main">
        <div class="contributor-name">${escapeHtml(contributor.displayName || '读者')}</div>
        <div class="contributor-meta">${escapeHtml(metaParts.join(' · '))}</div>
        <div class="contributor-stats">
          <span><strong>${assetCount}</strong> 资产</span>
          <span><strong>${Number(contributor.translationCount || 0)}</strong> 中译</span>
          <span><strong>${Number(contributor.rewriteCount || 0)}</strong> 改写</span>
          <span><strong>${Number(contributor.commentCount || 0)}</strong> 点评</span>
          <span><strong>${Number(contributor.chatCount || 0)}</strong> 对话</span>
          ${helpfulCount > 0 ? `<span class="contributor-stat-helpful"><strong>${helpfulCount}</strong> 有用</span>` : ''}
          ${followerCount > 0 ? `<span><strong>${followerCount}</strong> 关注者</span>` : ''}
        </div>
      </div>
      <div class="contributor-actions">
        <button type="button" class="contributor-open">查看贡献</button>
        <a class="contributor-rss-button" data-contributor-rss="${escapeHtml(contributor.id)}" href="${escapeHtml(contributorFeedUrlFor(contributor.id).href)}" target="_blank" rel="noopener" title="订阅贡献 RSS" aria-label="订阅贡献 RSS">RSS</a>
      </div>
    `;
    card.onclick = (event) => {
      if (event.target.closest('[data-contributor-rss]')) return;
      openContributor(contributor.id);
    };
    frag.appendChild(card);
  });
  el.appendChild(frag);
}

function entryByIdFromList(id) {
  const clean = String(id || '');
  if (!clean) return null;
  if (state.entryById && state.entryById.size) {
    const hit = state.entryById.get(clean);
    if (hit) return hit;
  }
  return state.entries.find(e => e && e.id === clean)
    || state.allEntries.find(e => e && e.id === clean)
    || null;
}

function estimateListCardHeight(entry) {
  return entry && entry.image ? LIST_CARD_MEDIA_ESTIMATE_PX : LIST_CARD_ESTIMATE_PX;
}

/** 根据 scrollTop/视口计算虚拟窗口 */
function computeListVirtualWindow(list, scrollTop, viewportH) {
  const n = list.length;
  if (!n) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  // 用均匀估计快速定位，避免 O(n) 累加；有图/无图混排可接受轻微偏差
  const avg = LIST_CARD_ESTIMATE_PX;
  let start = Math.max(0, Math.floor(scrollTop / avg) - LIST_OVERSCAN);
  const need = Math.ceil((viewportH || 600) / avg) + LIST_OVERSCAN * 2;
  let end = Math.min(n, start + Math.min(Math.max(need, ENTRY_RENDER_FAST_BATCH), LIST_WINDOW_MAX));
  if (end - start > LIST_WINDOW_MAX) end = start + LIST_WINDOW_MAX;
  if (end >= n) {
    end = n;
    start = Math.max(0, end - LIST_WINDOW_MAX);
  }
  const topPad = start * avg;
  const bottomPad = Math.max(0, (n - end) * avg);
  return { start, end, topPad, bottomPad };
}

function ensureListVirtualScroll() {
  if (state.listVirtualBound) return;
  const el = $('#entry-list');
  if (!el) return;
  state.listVirtualBound = true;
  el.addEventListener('scroll', () => {
    if (!state.listVirtualEnabled) return;
    if (state.listScrollRaf) return;
    state.listScrollRaf = requestAnimationFrame(() => {
      state.listScrollRaf = 0;
      // 仅重画窗口，不碰侧栏/标题
      renderListWindowOnly();
    });
  }, { passive: true });
}

function entryCardHtml(e, {
  zen = false,
  assetsView = false,
} = {}) {
  const src = sourceById(e.sourceId);
  // Zen：列表卡不显示「文A」翻译徽章等资产标（翻译只在阅读区按钮）
  const hasAssets = !zen && entryHasListAssets(e);
  const assetsHtml = hasAssets ? assetBadgesHtml(e, { interactive: true }) : '';
  const entryActivity = zen
    ? ''
    : (assetsView || hasAssets
      ? (assetActivityLabel(e) || entryHistoryLabel(e) || hotEntryLabel(e))
      : (entryHistoryLabel(e) || (state.view === 'hot' ? hotEntryLabel(e) : '')));
  const statsLine = zen ? '' : entryStatsLabel(e);
  const metaRow = [
    statsLine ? `<span class="entry-stats">${escapeHtml(statsLine)}</span>` : '',
    assetsHtml ? `<span class="asset-badges entry-asset-badges">${assetsHtml}</span>` : '',
  ].filter(Boolean).join('');
  const assetPreview = !zen && assetsView ? assetPreviewForEntry(e) : null;
  const assetItems = !zen && assetsView ? assetItemListHtml(e) : '';
  const isSyllabus = isSyllabusEntry(e);
  const syl = isSyllabus ? parseSyllabusSummary(e) : null;
  // 课程库：不显示右上角学校/学期 pill，也不显示「刚刚」
  const publishedLabel = isSyllabus ? '' : timeAgo(entryDisplayTimeTs(e));
  const sourceName = src ? src.name : e.sourceId;
  // 译过：列表卡强制中文标题/摘要；有课号 → 课号+课名；无课号 → 只显示中文课名一遍
  let title = String(e.titleZh || '').trim() || e.title || '';
  let summary = isSyllabus
    ? syllabusCardSummary(e, syl)
    : listSummaryText(e);
  if (isSyllabus) {
    const codeLike = String(e.title || '').trim();
    const zh = String(e.titleZh || '').trim();
    if (isSyllabusCourseCode(codeLike)) {
      title = codeLike;
      if (!summary || summary === codeLike) {
        summary = (zh && zh !== codeLike) ? zh : '';
      }
    } else if (zh) {
      title = zh;
      // 无课号：摘要与标题相同则去掉
      if (summary === title || summary === zh || summary === codeLike) summary = '';
    }
    if (summary && summary.replace(/\s+/g, '') === title.replace(/\s+/g, '')) summary = '';
  }
  const thumb = listCardThumbUrl(e);
  const cls = 'entry-card'
    + (state.read.has(e.id) ? ' read' : '')
    + (state.activeEntry?.id === e.id ? ' active' : '')
    + (isSyllabus ? ' entry-card--syllabus' : '');
  const mediaCls = thumb ? ' entry-card--media' : '';
  // B站等横版视频封面：16:9 + contain，避免 72² cover 裁掉半张
  const isVideoCover = Boolean(
    thumb
    && (
      e.sourceId === 'bili-watchlater'
      || (src && src.contentKind === 'social-bili')
    ),
  );
  const kickerLeft = `<div class="entry-source-line">${src ? sourceFaviconHtml(src, 13) : ''}<span class="src">${escapeHtml(sourceName)}</span></div>`;
  const ariaLabel = isSyllabus
    ? [title, summary, syl?.school, syl?.term].filter(Boolean).join(' · ') || '打开课程'
    : (title || '打开文章');
  if (isSyllabus) {
    const code = isSyllabusCourseCode(e.title) ? String(e.title).trim() : '';
    const mainTitle = summary || title;
    const kind = syllabusEntryKindLabel(e);
    const facts = [syl?.school, syl?.term, kind].filter(Boolean);
    return `<div class="${cls}" data-id="${escapeHtml(e.id)}" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
      <span class="entry-course-drag-handle" title="拖拽调整课程顺序" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="entry-main entry-main--syllabus">
        ${code ? `<div class="entry-course-code">${escapeHtml(code)}</div>` : ''}
        <div class="entry-title">${escapeHtml(mainTitle)}</div>
        ${code && title !== code && title !== mainTitle ? `<div class="entry-course-alias">${escapeHtml(title)}</div>` : ''}
        ${facts.length ? `<div class="entry-course-meta">${facts.map((fact, index) => (
          `<span${index === facts.length - 1 ? ' class="entry-course-kind"' : ''}>${escapeHtml(fact)}</span>`
        )).join('')}</div>` : ''}
      </div>
    </div>`;
  }
  return `<div class="${cls}${mediaCls}" data-id="${escapeHtml(e.id)}" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
      <div class="entry-main">
        <div class="entry-kicker">
          ${kickerLeft}
          ${publishedLabel
            ? `<time class="entry-time" datetime="${escapeHtml(e.published || '')}">${escapeHtml(publishedLabel)}</time>`
            : (isSyllabus ? '' : `<time class="entry-time" datetime="${escapeHtml(e.published || '')}"></time>`)}
        </div>
        <div class="entry-title">${escapeHtml(title)}</div>
        ${summary ? `<div class="entry-summary${isSyllabus ? ' entry-summary--course' : ''}">${escapeHtml(summary)}</div>` : ''}
        ${metaRow ? `<div class="entry-meta-row">${metaRow}</div>` : ''}
        ${assetItems || (assetPreview ? assetPreviewHtml(assetPreview) : '')}
        ${entryActivity ? `<div class="entry-asset-activity">${escapeHtml(entryActivity)}</div>` : ''}
      </div>
      ${thumb ? `<div class="entry-media${isVideoCover ? ' entry-media--video' : ''}"><img class="entry-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.entry-media')?.remove()" /></div>` : ''}
    </div>`;
}

/**
 * 仅根据当前 scroll 更新虚拟窗口（滚动热路径）。
 * 按 data-id 复用已渲染卡片 DOM：窗口滑动时 <img> 节点只移动不重建，
 * 已解码位图得以保留 → 消除 X/小红书收藏列表滚动时缩略图整片闪烁。
 * innerHTML 全量重建只保留在 renderList()（切源/数据变更等离散场景）。
 */
function renderListWindowOnly() {
  if (state.view === 'contributors') return;
  if (isHomeScope() && state.homeTab === 'assets') return;
  const list = visibleEntries();
  const el = $('#entry-list');
  if (!el || !list.length) return;
  const win = computeListVirtualWindow(list, el.scrollTop, el.clientHeight);
  if (win.start === state.listWindowStart && win.end === state.listWindowEnd) return;
  state.listWindowStart = win.start;
  state.listWindowEnd = win.end;
  const zen = isZenPersonalMode();
  const assetsView = state.view === 'assets';
  const slice = list.slice(win.start, win.end);
  // 现存卡片索引（spacer 无 data-id 自然跳过）
  const existing = new Map();
  for (const node of el.children) {
    const id = node.dataset && node.dataset.id;
    if (id) existing.set(id, node);
  }
  const spacer = (h) => {
    const div = document.createElement('div');
    div.className = 'list-virtual-spacer';
    div.style.height = `${h}px`;
    div.setAttribute('aria-hidden', 'true');
    return div;
  };
  const frag = document.createDocumentFragment();
  if (win.topPad > 0) frag.appendChild(spacer(win.topPad));
  const tpl = document.createElement('template');
  for (const e of slice) {
    const cur = existing.get(e.id);
    if (cur) {
      // 复用：内容静态，read/active 态由 patchEntryCardState/renderList 维护
      existing.delete(e.id);
      frag.appendChild(cur);
    } else {
      tpl.innerHTML = entryCardHtml(e, { zen, assetsView });
      const node = tpl.content.firstElementChild;
      if (node) frag.appendChild(node);
    }
  }
  if (win.bottomPad > 0) frag.appendChild(spacer(win.bottomPad));
  el.replaceChildren(frag);
}

let suppressCourseClickUntil = 0;
const COURSE_DRAG_THRESHOLD = 5;
const courseDrag = {
  pointerId: null,
  armed: false,
  active: false,
  card: null,
  wrap: null,
  placeholder: null,
  ghost: null,
  startX: 0,
  startY: 0,
  grabY: 0,
  fixedLeft: 0,
};

function courseDragCleanup() {
  courseDrag.ghost?.remove();
  courseDrag.placeholder?.remove();
  courseDrag.card?.classList.remove('is-course-dragging');
  courseDrag.wrap?.classList.remove('is-course-drag-scroll-lock');
  document.body.classList.remove('is-course-reordering');
  courseDrag.pointerId = null;
  courseDrag.armed = false;
  courseDrag.active = false;
  courseDrag.card = null;
  courseDrag.wrap = null;
  courseDrag.placeholder = null;
  courseDrag.ghost = null;
}

function moveCoursePlaceholder(clientY) {
  const { wrap, card, placeholder } = courseDrag;
  if (!wrap || !card || !placeholder) return;
  const candidates = [...wrap.children].filter(el => (
    el !== card
    && el !== placeholder
    && el.matches?.('.entry-card--syllabus[data-id]')
  ));
  const before = candidates.find(el => {
    const rect = el.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (before) wrap.insertBefore(placeholder, before);
  else wrap.appendChild(placeholder);
}

function courseDragAutoScroll(clientY) {
  const wrap = courseDrag.wrap;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const edge = 52;
  if (clientY < rect.top + edge) wrap.scrollTop -= 18;
  else if (clientY > rect.bottom - edge) wrap.scrollTop += 18;
}

function startCourseDrag(event) {
  const { card, wrap } = courseDrag;
  if (!card || !wrap || courseDrag.active) return;
  courseDrag.active = true;
  const rect = card.getBoundingClientRect();
  courseDrag.grabY = Math.min(rect.height - 4, Math.max(4, event.clientY - rect.top));
  courseDrag.fixedLeft = rect.left;

  const placeholder = document.createElement('div');
  placeholder.className = 'course-drag-placeholder';
  placeholder.style.height = `${Math.max(56, rect.height)}px`;
  card.insertAdjacentElement('beforebegin', placeholder);
  courseDrag.placeholder = placeholder;

  const ghost = card.cloneNode(true);
  ghost.classList.add('course-drag-ghost');
  ghost.classList.remove('active', 'read', 'is-course-dragging');
  ghost.removeAttribute('tabindex');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  courseDrag.ghost = ghost;

  card.classList.add('is-course-dragging');
  wrap.classList.add('is-course-drag-scroll-lock');
  document.body.classList.add('is-course-reordering');
  try { card.setPointerCapture(event.pointerId); } catch { /* optional */ }
  moveCoursePlaceholder(event.clientY);
}

function onCourseDragMove(event) {
  if (!courseDrag.armed && !courseDrag.active) return;
  if (courseDrag.pointerId !== event.pointerId) return;
  if (!courseDrag.active) {
    const dx = event.clientX - courseDrag.startX;
    const dy = event.clientY - courseDrag.startY;
    if (dx * dx + dy * dy < COURSE_DRAG_THRESHOLD * COURSE_DRAG_THRESHOLD) return;
    startCourseDrag(event);
  }
  if (!courseDrag.active) return;
  if (courseDrag.ghost) {
    courseDrag.ghost.style.left = `${courseDrag.fixedLeft}px`;
    courseDrag.ghost.style.top = `${event.clientY - courseDrag.grabY}px`;
  }
  courseDragAutoScroll(event.clientY);
  moveCoursePlaceholder(event.clientY);
  event.preventDefault();
}

function onCourseDragEnd(event) {
  if (!courseDrag.armed && !courseDrag.active) return;
  if (event?.pointerId != null && courseDrag.pointerId !== event.pointerId) return;
  const { active, card, wrap, placeholder, pointerId } = courseDrag;
  if (active && card && wrap && placeholder?.parentNode) {
    placeholder.insertAdjacentElement('beforebegin', card);
    const order = [...wrap.querySelectorAll(':scope > .entry-card--syllabus[data-id]')]
      .map(el => el.dataset.id)
      .filter(Boolean);
    try { card.releasePointerCapture(pointerId); } catch { /* optional */ }
    persistSyllabusCourseOrder(order);
    suppressCourseClickUntil = Date.now() + 420;
    courseDragCleanup();
    renderList();
    return;
  }
  courseDragCleanup();
}

function bindCourseDragToList(el) {
  if (!el || el.dataset.courseDragBound === '1') return;
  el.dataset.courseDragBound = '1';
  el.addEventListener('pointerdown', (event) => {
    if (!isSyllabusSourceFilter() || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('a, button, input, textarea, select')) return;
    const card = event.target.closest('.entry-card--syllabus[data-id]');
    if (!card || !el.contains(card)) return;
    if (courseDrag.armed || courseDrag.active) courseDragCleanup();
    courseDrag.pointerId = event.pointerId;
    courseDrag.armed = true;
    courseDrag.active = false;
    courseDrag.card = card;
    courseDrag.wrap = el;
    courseDrag.startX = event.clientX;
    courseDrag.startY = event.clientY;
  });
  window.addEventListener('pointermove', onCourseDragMove, { passive: false });
  window.addEventListener('pointerup', onCourseDragEnd);
  window.addEventListener('pointercancel', onCourseDragEnd);
  window.addEventListener('dragstart', (event) => {
    if (courseDrag.armed || courseDrag.active) event.preventDefault();
  }, true);
}

function ensureEntryListDelegation() {
  if (state.listDelegated) return;
  const el = $('#entry-list');
  if (!el) return;
  state.listDelegated = true;
  ensureListVirtualScroll();
  el.addEventListener('click', (event) => {
    if (Date.now() < suppressCourseClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const more = event.target.closest('.list-load-more');
    if (more && el.contains(more)) {
      // 兼容旧按钮：扩展窗口 cap（虚拟列表下通常不出现）
      event.preventDefault();
      const scrollTop = el.scrollTop;
      const list = visibleEntries();
      state.entryRenderLimit = Math.min(
        (state.entryRenderLimit || ENTRY_RENDER_BATCH_SIZE) + ENTRY_RENDER_BATCH_SIZE,
        Math.max(list.length, ENTRY_RENDER_BATCH_SIZE)
      );
      renderList();
      requestAnimationFrame(() => { el.scrollTop = scrollTop; });
      return;
    }
    const card = event.target.closest('.entry-card');
    if (!card || !el.contains(card)) return;
    const e = entryByIdFromList(card.dataset.id);
    if (!e) return;
    const previewCopyContent = event.target.closest('[data-asset-preview-copy-content]');
    if (previewCopyContent) {
      event.preventDefault();
      event.stopPropagation();
      const type = previewCopyContent.dataset.assetPreviewCopyContent;
      const item = entryAssetPreviewForCopy(e, type, previewCopyContent.dataset.assetItemId || '');
      copyAssetContent(type, item);
      return;
    }
    const previewCopy = event.target.closest('[data-asset-preview-copy]');
    if (previewCopy) {
      event.preventDefault();
      event.stopPropagation();
      const url = assetItemUrl(previewCopy.dataset.assetPreviewCopy, e, previewCopy.dataset.assetItemId || '');
      const label = ASSET_FOCUS_LABELS[previewCopy.dataset.assetPreviewCopy] || '资产';
      copyText(url, `${label}链接已复制`);
      return;
    }
    const copy = event.target.closest('[data-asset-copy]');
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      const url = readerAssetUrl(copy.dataset.assetCopy, e);
      const label = ASSET_FOCUS_LABELS[copy.dataset.assetCopy] || '资产';
      copyText(url, `${label}链接已复制`);
      return;
    }
    const asset = event.target.closest('[data-asset]');
    if (asset) {
      event.preventDefault();
      event.stopPropagation();
      const itemId = asset.dataset.assetItemId || '';
      const focus = asset.dataset.asset;
      openEntry(e, {
        focus,
        aiAssetId: focus === 'translation' || focus === 'rewrite' ? itemId : '',
        commentId: focus === 'comments' ? itemId : '',
        annotationId: focus === 'annotations' ? itemId : '',
        chatMessageId: focus === 'chat' ? itemId : '',
      });
      return;
    }
    openEntry(e);
  });
  el.addEventListener('keydown', (event) => {
    const card = event.target.closest('.entry-card');
    if (!card || event.target !== card || !el.contains(card)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const e = entryByIdFromList(card.dataset.id);
    if (e) openEntry(e);
  });
  el.addEventListener('contextmenu', (event) => {
    const card = event.target.closest('.entry-card');
    if (!card || !el.contains(card)) return;
    const e = entryByIdFromList(card.dataset.id);
    if (!e) return;
    showEntryContextMenu(event, e);
  });
  bindCourseDragToList(el);
}

function listSummaryText(entry) {
  // 译过必用中文摘要；无 summaryZh 才回退英文
  const zh = String(entry && entry.summaryZh || '').replace(/\s+/g, ' ').trim();
  let raw = (zh && /[\u3400-\u9fff]/.test(zh) ? zh : String(entry && entry.summary || '')).replace(/\s+/g, ' ').trim();
  // 本机正文删除后：列表概要跟剩余正文开头走（不改入库 summary）
  if (typeof listSummaryAfterLocalDeletions === 'function') {
    const next = listSummaryAfterLocalDeletions(entry, raw);
    if (next != null) raw = next;
  }
  // Substack / Maarten 列表概述里的作者+日期（含译后「2026年6月10日」）
  if (typeof window !== 'undefined' && window.QMContentNormalizers?.stripSubstackAuthorDateByline) {
    raw = window.QMContentNormalizers.stripSubstackAuthorDateByline(raw).replace(/\s+/g, ' ').trim();
  } else {
    raw = raw
      .replace(/\bMaarten\s+Grootendorst\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/gi, '')
      .replace(/\bMaarten\s+Grootendorst\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const title = String(entry && (entry.titleZh || entry.title) || '').replace(/\s+/g, ' ').trim();
  if (title && raw.toLowerCase().startsWith(title.toLowerCase())) {
    raw = raw.slice(title.length).replace(/^[\s\-–—:：|]+/, '').trim();
  }
  // 英文标题前缀 / 日期噪音
  const enTitle = String(entry && entry.title || '').replace(/\s+/g, ' ').trim();
  if (enTitle && raw.toLowerCase().startsWith(enTitle.toLowerCase())) {
    raw = raw.slice(enTitle.length).replace(/^[\s\-–—:：|]+/, '').trim();
  }
  raw = raw.replace(/^\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}\s+/, '').trim();
  raw = raw.replace(/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*/, '').trim();
  if (!raw) return '';
  if (raw.length <= LIST_SUMMARY_MAX) return raw;
  return `${raw.slice(0, LIST_SUMMARY_MAX)}…`;
}

/** 列表缩略图：跳过全站默认 og / 本地化后的占位图（无正文图不应显示缩略图） */
function listCardThumbUrl(entry) {
  let url = String(entry && entry.image || '').trim();
  if (!url) return '';
  // 误存 https://host/article-images/...（远程 404）→ 本站路径
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith('/article-images/')) url = u.pathname;
  } catch { /* keep */ }
  const m = url.match(/https?:\/\/[^/]+(\/article-images\/[^?#]+)/i);
  if (m) url = m[1];
  // bearblog 等：/static/og-image.png 或本地化哈希 da47ec…（站点默认图）
  if (/\/static\/og-image|og-image\.(png|jpe?g|webp|gif)|da47ec081fc39a48c0bd|default[-_]?og|site[-_]?logo|placeholder/i.test(url)) {
    return '';
  }
  return url;
}

function entryHasListAssets(entry) {
  const a = entry && entry.assets;
  if (!a) return false;
  return Boolean(a.translation || a.rewrite || a.comments || a.annotations || a.chatMessages
    || a.translationCount || a.rewriteCount);
}

function renderList() {
  ensureEntryListDelegation();
  ensureListVirtualScroll();
  $('#app').classList.toggle('view-assets', state.view === 'assets');
  $('#app').classList.toggle('view-contributors', state.view === 'contributors');
  $('#app').classList.toggle('home-assets', isHomeScope() && state.homeTab === 'assets');
  renderListScopeBar();
  renderEntryPaneTabs();
  $('#mark-read-btn').classList.toggle('hidden', state.view === 'contributors' || (isHomeScope() && state.homeTab === 'assets'));
  if (state.view === 'contributors') {
    state.listVirtualEnabled = false;
    renderContributorDirectory();
    return;
  }
  const list = visibleEntries();
  const el = $('#entry-list');
  el.classList.remove('home-asset-activity-list');
  // 普通切源不刷资产条；仅 assets / home-assets 需要
  if (state.view === 'assets' || (isHomeScope() && state.homeTab === 'assets')) {
    renderAssetActivityStrip();
  }
  if (isHomeScope() && state.homeTab === 'assets') {
    state.listVirtualEnabled = false;
    renderHomeAssetActivityList(el);
    return;
  }
  if (!list.length) {
    state.listVirtualEnabled = false;
    const assetScope = state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产';
    const filterSrc = state.filterSource ? sourceById(state.filterSource) : null;
    const submitAction = typeof sourceSubmitAction === 'function' ? sourceSubmitAction(filterSrc) : null;
    const text = state.view === 'assets' && state.q
      ? `没有匹配“${escapeHtml(state.q)}”的${assetScope}<br/>换个关键词试试`
      : state.view === 'assets' && state.assetFilter
      ? `还没有${assetScope}<br/>换个类型或先沉淀一篇文章`
      : state.view === 'assets'
      ? '还没有沉淀资产<br/>先翻译、重写、点评或对话一篇文章'
      : state.view === 'history'
      ? '还没有浏览记录<br/>打开几篇文章后会出现在这里'
      : state.view === 'hot'
      ? '还没有足够反馈<br/>提交链接、点赞或收藏后会逐步形成热门列表'
      : state.view === 'unread'
      ? '没有未读文章<br/>切换到「最新」可看全部'
      : submitAction && submitAction.mode === 'repo'
      ? '还没有 GitHub 项目<br/>点右上角 + 粘贴仓库链接加入'
      : isSyllabusSourceFilter()
      ? '课程库还是空的<br/>本地大纲库：可在终端运行 refresh:courses 导入'
      : submitAction
      ? '还没有个人精选<br/>点右上角 + 粘贴链接加入'
      : '这里空空如也<br/>试试刷新或切换视图';
    el.innerHTML = `<div class="list-empty">${text}</div>`;
    return;
  }
  // 课程目录数量有限，完整驻留 DOM 才能在拖拽时得到准确的全量顺序。
  if (isSyllabusSourceFilter()) {
    state.listVirtualEnabled = false;
    const zen = isZenPersonalMode();
    const assetsView = state.view === 'assets';
    el.innerHTML = list.map(e => entryCardHtml(e, { zen, assetsView })).join('');
    return;
  }
  // 真虚拟列表：仅驻留视口 ± overscan，上限 LIST_WINDOW_MAX 张卡
  // 一次写入 innerHTML（不先清空），避免未读/最新切换时空一帧闪白
  state.listVirtualEnabled = true;
  const zen = isZenPersonalMode();
  const assetsView = state.view === 'assets';
  // 切源时若未显式保留滚动，从顶部开窗
  const scrollTop = el.scrollTop || 0;
  const win = computeListVirtualWindow(list, scrollTop, el.clientHeight || 640);
  state.listWindowStart = win.start;
  state.listWindowEnd = win.end;
  let html = '';
  if (win.topPad > 0) html += `<div class="list-virtual-spacer" style="height:${win.topPad}px" aria-hidden="true"></div>`;
  for (const e of list.slice(win.start, win.end)) {
    html += entryCardHtml(e, { zen, assetsView });
  }
  if (win.bottomPad > 0) html += `<div class="list-virtual-spacer" style="height:${win.bottomPad}px" aria-hidden="true"></div>`;
  el.innerHTML = html;
}

function updateListTitle() {
  let title = '全部';
  let syllabusCount = 0;
  if (state.filterSource) {
    const src = sourceById(state.filterSource);
    const name = src?.name || state.filterSource;
    const n = sourceEntryCount(state.filterSource) || (state.entries || []).length;
    if (src && (src.id === 'zen-recent' || src.contentKind === 'syllabus')) {
      title = '近期';
      syllabusCount = n;
    } else {
      title = n ? `${name} · ${n}` : name;
    }
  } else if (state.filterCategory) title = CATEGORY_LABELS[state.filterCategory];
  else if (state.view === 'hot') title = '热门';
  else if (state.view === 'unread') title = '未读';
  else if (state.view === 'starred') title = '收藏';
  else if (state.view === 'history') title = '浏览记录';
  else if (state.view === 'assets') {
    const prefix = state.assetSort === 'helpful' ? '有用 · ' : '';
    title = `${prefix}${state.assetFilter ? `${assetDirectoryLabel(state.assetFilter)}资产` : '公开资产'}`;
  }
  else if (state.view === 'contributors') title = '贡献榜';
  if (state.q) title += ` · “${state.q}”`;
  const titleEl = $('#list-title');
  titleEl.classList.toggle('pane-title--syllabus', Boolean(syllabusCount || isSyllabusSourceFilter()));
  if (isSyllabusSourceFilter()) {
    titleEl.innerHTML = `<span>${escapeHtml(title)}</span>${syllabusCount ? `<span class="pane-title-count">${syllabusCount}</span>` : ''}`;
  } else {
    titleEl.textContent = title;
  }
  updateSearchPlaceholder();
  renderSourceRefreshButton();
  renderSourceSubmitButton();
  renderListScopeBar();
}

function updateSearchPlaceholder() {
  const search = $('#search');
  if (!search) return;
  search.placeholder = state.view === 'contributors'
    ? '搜索贡献榜…'
    : state.view === 'assets'
      ? '搜索资产…'
      : isSyllabusSourceFilter()
        ? '搜索课号、课名、学校…'
        : '搜索文章…';
  if (search.value !== state.q) search.value = state.q;
}

/** 仅进入「个人精选 / GitHub 项目」源后，列表顶栏显示加入入口 */
function renderSourceSubmitButton() {
  const btn = $('#source-submit-btn');
  if (!btn) return;
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  const action = typeof sourceSubmitAction === 'function' ? sourceSubmitAction(source) : null;
  btn.classList.toggle('hidden', !action);
  if (!action) {
    delete btn.dataset.mode;
    return;
  }
  btn.dataset.mode = action.mode;
  btn.title = action.title;
  btn.setAttribute('aria-label', action.title);
  setElementIcon(btn, 'plus', { className: 'app-icon' });
}

function renderSourceRefreshButton() {
  const btn = $('#source-refresh-btn');
  if (!btn) return;
  const source = state.filterSource ? sourceById(state.filterSource) : null;
  // 手动投稿源用顶栏「+」加入；课程库基本不更新，不显示刷新
  const submitOnly = Boolean(typeof sourceSubmitAction === 'function' && sourceSubmitAction(source));
  const staticCatalog = Boolean(
    source
    && (
      source.excludeFromAll
      || source.id === 'zen-recent'
      || source.contentKind === 'syllabus'
    ),
  );
  const sourceRefreshing = Boolean(
    source
      && state.refreshing
      && (!state.refreshProgress.sourceId || state.refreshProgress.sourceId === source.id)
  );
  btn.classList.toggle('hidden', !source || submitOnly || staticCatalog);
  btn.classList.toggle('refreshing', sourceRefreshing);
  btn.disabled = sourceRefreshing;
  setElementIcon(btn, sourceRefreshing ? 'loader-circle' : 'refresh-cw', {
    className: sourceRefreshing ? 'app-icon app-icon-spin' : 'app-icon',
  });
  if (source && !submitOnly) {
    btn.title = `${sourceRefreshing ? '正在检查' : '检查'} ${source.name} 更新`;
    btn.setAttribute('aria-label', btn.title);
  }
}

function setSourceRefreshStatus(message = '', kind = '', { timeout = 0 } = {}) {
  const el = $('#source-refresh-status');
  if (!el) return;
  clearTimeout(state.sourceRefreshStatusTimer);
  state.sourceRefreshStatusTimer = null;
  el.textContent = message;
  el.className = `source-refresh-status${message ? '' : ' hidden'}${kind ? ` ${kind}` : ''}`;
  if (message && timeout) {
    state.sourceRefreshStatusTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'source-refresh-status hidden';
      state.sourceRefreshStatusTimer = null;
    }, timeout);
  }
}

async function sourceEntriesSnapshot(sourceId) {
  if (!sourceId) return [];
  const params = new URLSearchParams({ source: sourceId });
  const data = await api('/api/entries?' + params.toString());
  return Array.isArray(data.entries) ? data.entries : [];
}

function newEntryCount(beforeEntries = [], afterEntries = []) {
  const beforeIds = new Set(beforeEntries.map(entry => entry && entry.id).filter(Boolean));
  return afterEntries.filter(entry => entry && entry.id && !beforeIds.has(entry.id)).length;
}
