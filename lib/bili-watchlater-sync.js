/**
 * B站「b站收藏」源（id 仍为 bili-watchlater，兼容存量）。
 * 合并同步：稍后再看（toview）+ 用户创建的收藏夹资源。
 * Cookie 来自本机 Zen cookies.sqlite（SESSDATA）。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const store = require('./store');
const { encodeContent } = require('./likes-sync');

const SOURCE_ID = 'bili-watchlater';
const PLATFORM = 'bili';
const TOVIEW_URL = 'https://api.bilibili.com/x/v2/history/toview';
const TOVIEW_DEL_URL = 'https://api.bilibili.com/x/v2/history/toview/del';
const FAV_FOLDERS_URL = 'https://api.bilibili.com/x/v3/fav/folder/created/list-all';
const FAV_RESOURCE_LIST_URL = 'https://api.bilibili.com/x/v3/fav/resource/list';
const FAV_BATCH_DEL_URL = 'https://api.bilibili.com/x/v3/fav/resource/batch-del';
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
/** 用户在本机主动取消：软删粘性，同步不会因再入列以外的原因复活 */
const USER_CANCEL_REASON = 'user-cancel-watchlater';
/** 离开远端列表（稍后再看/收藏夹均无）时的自动软删 reason；再入列可恢复 */
const LEFT_REASON = 'left-watchlater';

// 无默认 profile：需通过环境变量 BILI_ZEN_PROFILE（Zen/Firefox profile 目录）或 BILI_COOKIE 配置
const DEFAULT_ZEN_PROFILE = '';

const POLL_MS = Number(process.env.BILI_POLL_MS || 5 * 60 * 1000);
const SYNC_ENABLED = process.env.BILI_SYNC_ENABLED !== '0';
const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid', 'buvid3'];
const FAV_PAGE_SIZE = 20;
const FAV_MAX_PAGES_PER_FOLDER = 50;

let lastSyncMeta = {
  at: 0,
  imported: 0,
  count: 0,
  toviewCount: 0,
  favCount: 0,
  error: null,
  fingerprint: '',
};
let pollTimer = null;
let syncLock = false;

function md5(text) {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function zenProfilePath() {
  return process.env.BILI_ZEN_PROFILE
    || process.env.ZHIHU_ZEN_PROFILE
    || DEFAULT_ZEN_PROFILE;
}

function httpsPic(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return s.replace(/^http:\/\//i, 'https://');
}

function formatDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatWallClock(tsSec) {
  const t = Number(tsSec) * 1000;
  if (!Number.isFinite(t) || t <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const pick = type => parts.find(p => p.type === type)?.value || '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

/**
 * 从 Zen Firefox 系 cookies.sqlite 读取 bilibili Cookie。
 * 必须先拷贝再读，避免与运行中浏览器抢 WAL。
 */
function loadZenBiliCookies(profileDir = zenProfilePath()) {
  const raw = String(profileDir || '').trim();
  if (!raw) {
    // 未配置时报错引导：path.resolve('') 会落到 cwd，不能直接走下面的存在性检查
    throw new Error('未配置 Zen profile：请设置 BILI_ZEN_PROFILE（Zen/Firefox profile 目录），或直接提供 BILI_COOKIE');
  }
  const profile = path.resolve(raw);
  if (!fs.existsSync(profile)) {
    throw new Error(`Zen profile not found: ${profile}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-bili-cookies-'));
  try {
    for (const name of ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm']) {
      const src = path.join(profile, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, name));
    }
    const dbPath = path.join(tmp, 'cookies.sqlite');
    if (!fs.existsSync(dbPath)) {
      throw new Error('cookies.sqlite missing in Zen profile');
    }
    const db = new DatabaseSync(`file:${dbPath}?mode=ro`, { open: true });
    let rows;
    try {
      rows = db.prepare(`
        SELECT name, value, host, expiry
        FROM moz_cookies
        WHERE host LIKE '%bilibili%'
      `).all();
    } finally {
      db.close();
    }
    const now = Math.floor(Date.now() / 1000);
    /** @type {Map<string, { value: string, host: string, score: number }>} */
    const best = new Map();
    for (const row of rows || []) {
      const name = String(row.name || '');
      const value = row.value == null ? '' : String(row.value);
      if (!name || !value) continue;
      let exp = Number(row.expiry) || 0;
      if (exp > 10_000_000_000) exp = Math.floor(exp / 1000);
      if (exp && exp < now) continue;
      const host = String(row.host || '');
      // 优先 .bilibili.com
      const score = host.endsWith('.bilibili.com') || host === 'bilibili.com' || host === '.bilibili.com'
        ? 2
        : host.includes('bilibili.com')
          ? 1
          : 0;
      const prev = best.get(name);
      if (!prev || score >= prev.score) best.set(name, { value, host, score });
    }
    if (!best.has('SESSDATA')) {
      throw new Error('Zen Cookie 中未找到 SESSDATA，请先在 Zen 登录 bilibili.com');
    }
    const cookieHeader = COOKIE_NAMES
      .filter(n => best.has(n))
      .map(n => `${n}=${best.get(n).value}`)
      .join('; ');
    return {
      cookieHeader,
      sessdata: best.get('SESSDATA').value,
      biliJct: best.has('bili_jct') ? best.get('bili_jct').value : '',
      mid: best.has('DedeUserID') ? best.get('DedeUserID').value : '',
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function cookieFromEnvOrZen() {
  const raw = String(process.env.BILI_COOKIE || '').trim();
  if (raw) {
    const midMatch = raw.match(/(?:^|;\s*)DedeUserID=([^;]+)/i);
    const jctMatch = raw.match(/(?:^|;\s*)bili_jct=([^;]+)/i);
    return {
      cookieHeader: raw,
      sessdata: '',
      biliJct: jctMatch ? jctMatch[1] : '',
      mid: midMatch ? midMatch[1] : '',
      source: 'env',
    };
  }
  const fromZen = loadZenBiliCookies();
  return { ...fromZen, source: 'zen' };
}

function csrfFromAuth(creds) {
  return String(creds && creds.biliJct || '').trim()
    || String(creds && creds.cookieHeader || '').match(/(?:^|;\s*)bili_jct=([^;]+)/i)?.[1]
    || '';
}

async function biliGetJson(url, cookieHeader, referer = 'https://www.bilibili.com/') {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      Referer: referer,
      Origin: 'https://www.bilibili.com',
      Cookie: cookieHeader,
      Accept: 'application/json, text/plain, */*',
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error(`B站 API 非 JSON (HTTP ${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return { httpStatus: res.status, data };
}

async function biliPostForm(url, cookieHeader, fields = {}, referer = 'https://www.bilibili.com/') {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '') continue;
    body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: referer,
      Origin: 'https://www.bilibili.com',
      Cookie: cookieHeader,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error(`B站 API 非 JSON (HTTP ${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return { httpStatus: res.status, data };
}

function throwIfBiliAuthError(data, label) {
  const code = Number(data && data.code);
  if (code === -101) {
    const err = new Error('B站未登录：SESSDATA 失效，请在 Zen 重新登录 bilibili.com');
    err.code = -101;
    err.statusCode = 401;
    throw err;
  }
  if (code !== 0) {
    const err = new Error(`${label}失败 code=${code} ${data && data.message ? data.message : ''}`);
    err.code = code;
    throw err;
  }
}

async function fetchToviewList(cookieHeader) {
  const { data } = await biliGetJson(TOVIEW_URL, cookieHeader, 'https://www.bilibili.com/watchlater/');
  throwIfBiliAuthError(data, 'B站稍后再看');
  const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
  const count = Number(data && data.data && data.data.count) || list.length;
  return { list, count };
}

async function resolveMid(auth) {
  const fromCookie = String(auth && auth.mid || '').trim();
  if (/^\d+$/.test(fromCookie)) return fromCookie;
  const { data } = await biliGetJson(NAV_URL, auth.cookieHeader);
  throwIfBiliAuthError(data, 'B站 nav');
  const mid = data && data.data && data.data.mid != null ? String(data.data.mid) : '';
  if (!/^\d+$/.test(mid)) {
    const err = new Error('无法解析 B站 mid');
    err.statusCode = 401;
    throw err;
  }
  return mid;
}

/**
 * 用户创建的收藏夹列表（含默认收藏夹）。
 * @returns {Promise<Array<{ id: string, title: string, mediaCount: number }>>}
 */
async function fetchFavFolders(cookieHeader, mid) {
  const url = `${FAV_FOLDERS_URL}?up_mid=${encodeURIComponent(mid)}`;
  const { data } = await biliGetJson(url, cookieHeader, 'https://www.bilibili.com/');
  throwIfBiliAuthError(data, 'B站收藏夹列表');
  const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
  return list.map((f) => ({
    id: f && f.id != null ? String(f.id) : '',
    title: String(f && f.title || '').trim() || '收藏夹',
    mediaCount: Number(f && f.media_count) || 0,
  })).filter(f => /^\d+$/.test(f.id));
}

/**
 * 分页拉取单个收藏夹内资源（仅 type=2 视频）。
 */
async function fetchFavFolderMedias(cookieHeader, mediaId) {
  const all = [];
  for (let pn = 1; pn <= FAV_MAX_PAGES_PER_FOLDER; pn += 1) {
    const qs = new URLSearchParams({
      media_id: String(mediaId),
      pn: String(pn),
      ps: String(FAV_PAGE_SIZE),
      order: 'mtime',
      type: '0',
      tid: '0',
      platform: 'web',
    });
    const url = `${FAV_RESOURCE_LIST_URL}?${qs.toString()}`;
    const { data } = await biliGetJson(url, cookieHeader, 'https://www.bilibili.com/');
    throwIfBiliAuthError(data, 'B站收藏夹内容');
    const medias = data && data.data && Array.isArray(data.data.medias) ? data.data.medias : [];
    for (const m of medias) {
      if (!m || typeof m !== 'object') continue;
      // type 2 = 视频；其它（专栏等）暂不进阅读器
      if (Number(m.type) !== 2) continue;
      all.push({ ...m, __mediaId: String(mediaId) });
    }
    const hasMore = Boolean(data && data.data && data.data.has_more);
    if (!hasMore || medias.length === 0) break;
  }
  return all;
}

/**
 * 全部收藏夹内视频（附 folder id）。
 */
async function fetchAllFavMedias(cookieHeader, mid) {
  const folders = await fetchFavFolders(cookieHeader, mid);
  const medias = [];
  for (const folder of folders) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await fetchFavFolderMedias(cookieHeader, folder.id);
    for (const row of rows) {
      medias.push({
        ...row,
        __folderTitle: folder.title,
      });
    }
  }
  return { folders, medias };
}

/**
 * 调 B站删除稍后再看（单条 aid）。
 * @param {string|number} aid
 * @param {{ cookieHeader?: string, biliJct?: string }} [auth]
 */
async function deleteToviewByAid(aid, auth = null) {
  const a = String(aid || '').trim();
  if (!/^\d+$/.test(a)) {
    const err = new Error('无效 aid');
    err.statusCode = 400;
    throw err;
  }
  const creds = auth && auth.cookieHeader
    ? auth
    : cookieFromEnvOrZen();
  const csrf = csrfFromAuth(creds);
  if (!csrf) {
    const err = new Error('缺少 bili_jct（CSRF）：请在 Zen 打开 bilibili.com 后重试');
    err.statusCode = 401;
    throw err;
  }
  const { data } = await biliPostForm(TOVIEW_DEL_URL, creds.cookieHeader, {
    aid: a,
    csrf,
  }, 'https://www.bilibili.com/watchlater/');
  const code = Number(data && data.code);
  if (code === -101) {
    const err = new Error('B站未登录：SESSDATA 失效，请在 Zen 重新登录 bilibili.com');
    err.code = -101;
    err.statusCode = 401;
    throw err;
  }
  // 0 成功；部分环境已不在列表会返 -400 等，调用方决定是否仍本地软删
  return { code, message: data && data.message ? String(data.message) : '', data };
}

/**
 * 从指定收藏夹移除视频（aid:type=2）。
 */
async function unfavFromMediaId(aid, mediaId, auth = null) {
  const a = String(aid || '').trim();
  const mid = String(mediaId || '').trim();
  if (!/^\d+$/.test(a) || !/^\d+$/.test(mid)) {
    const err = new Error('无效 aid 或 media_id');
    err.statusCode = 400;
    throw err;
  }
  const creds = auth && auth.cookieHeader
    ? auth
    : cookieFromEnvOrZen();
  const csrf = csrfFromAuth(creds);
  if (!csrf) {
    const err = new Error('缺少 bili_jct（CSRF）：请在 Zen 打开 bilibili.com 后重试');
    err.statusCode = 401;
    throw err;
  }
  const { data } = await biliPostForm(FAV_BATCH_DEL_URL, creds.cookieHeader, {
    resources: `${a}:2`,
    media_id: mid,
    csrf,
  }, 'https://www.bilibili.com/');
  const code = Number(data && data.code);
  if (code === -101) {
    const err = new Error('B站未登录：SESSDATA 失效，请在 Zen 重新登录 bilibili.com');
    err.code = -101;
    err.statusCode = 401;
    throw err;
  }
  return { code, message: data && data.message ? String(data.message) : '', data };
}

function aidFromEntry(entry) {
  if (!entry) return '';
  let payload = null;
  try {
    payload = require('./likes-sync').parseStoredContent(entry.content);
  } catch { /* ignore */ }
  const fromPayload = payload && payload.aid != null ? String(payload.aid).trim() : '';
  if (/^\d+$/.test(fromPayload)) return fromPayload;
  // 兜底：link 里的 av 号
  const m = String(entry.link || '').match(/[?&/]av(\d+)/i);
  return m ? m[1] : '';
}

function payloadFromEntry(entry) {
  if (!entry) return null;
  try {
    return require('./likes-sync').parseStoredContent(entry.content);
  } catch {
    return null;
  }
}

/**
 * 本机取消 b站收藏：远端 del（稍后再看 / 收藏夹）+ 本地软删（粘性，不复活）。
 * 与「已读」无关。
 * @param {string} entryId
 * @param {{ userId?: string, fetcher?: object }} [opts]
 */
async function cancelWatchlaterEntry(entryId, { userId = '', fetcher = null } = {}) {
  const id = String(entryId || '').trim();
  if (!id) {
    const err = new Error('entryId is required');
    err.statusCode = 400;
    throw err;
  }
  let entry = null;
  try {
    entry = typeof store.getEntry === 'function' ? store.getEntry(id) : null;
  } catch { /* ignore */ }
  if (!entry && fetcher && typeof fetcher.getEntryById === 'function') {
    entry = fetcher.getEntryById(id);
  }
  if (!entry) {
    const err = new Error('条目不存在或已删除');
    err.statusCode = 404;
    throw err;
  }
  if (entry.sourceId !== SOURCE_ID) {
    const err = new Error('仅支持 b站收藏条目');
    err.statusCode = 400;
    throw err;
  }
  const aid = aidFromEntry(entry);
  if (!aid) {
    const err = new Error('条目缺少 aid，无法向 B站取消');
    err.statusCode = 400;
    throw err;
  }

  const payload = payloadFromEntry(entry) || {};
  const origins = Array.isArray(payload.biliOrigins)
    ? payload.biliOrigins.map(String)
    : [];
  const favMediaIds = Array.isArray(payload.favMediaIds)
    ? payload.favMediaIds.map(x => String(x)).filter(x => /^\d+$/.test(x))
    : [];
  const hasWatchlater = !origins.length || origins.includes('watchlater');
  const hasFavorite = origins.includes('favorite') || favMediaIds.length > 0;

  const auth = cookieFromEnvOrZen();
  const remote = {
    toview: null,
    unfav: [],
  };

  try {
    if (hasWatchlater) {
      remote.toview = await deleteToviewByAid(aid, auth);
      if (remote.toview.code !== 0) {
        console.warn(`[bili-watchlater] toview/del aid=${aid} code=${remote.toview.code} ${remote.toview.message}`);
      }
    }
    if (hasFavorite) {
      let mediaIds = [...new Set(favMediaIds)];
      if (!mediaIds.length) {
        // 旧条目无 mediaId：扫全部收藏夹尝试移除
        const mid = await resolveMid(auth);
        const folders = await fetchFavFolders(auth.cookieHeader, mid);
        mediaIds = folders.map(f => f.id);
      }
      for (const mediaId of mediaIds) {
        // eslint-disable-next-line no-await-in-loop
        const r = await unfavFromMediaId(aid, mediaId, auth);
        remote.unfav.push({ mediaId, code: r.code, message: r.message });
        if (r.code !== 0) {
          console.warn(`[bili-watchlater] fav/batch-del aid=${aid} media=${mediaId} code=${r.code} ${r.message}`);
        }
      }
    }
  } catch (error) {
    // 远端失败：不本地删，避免「本机没了但 B站还在」下次回魂
    throw error;
  }

  store.softDeleteEntry(id, {
    userId: String(userId || '').trim() || null,
    reason: USER_CANCEL_REASON,
  });
  // 下次同步重新拉指纹（避免 skip 后前端 merge 仍见旧 cache）
  lastSyncMeta = { ...lastSyncMeta, fingerprint: '', at: Date.now() };

  // 必须立刻剔内存 cache：removeCachedEntry 曾未 export → 幽灵条目经 ensureLocalOnlyCache 回魂
  if (fetcher && typeof fetcher.removeCachedEntry === 'function') {
    try { fetcher.removeCachedEntry(id); } catch { /* ignore */ }
  }
  // 再按 DB 全量重灌该源 cache，保证 /api/entries 与侧栏计数一致
  if (fetcher && typeof fetcher.fetchSource === 'function' && typeof fetcher.getSourceById === 'function') {
    try {
      const src = fetcher.getSourceById(SOURCE_ID);
      if (src) fetcher.fetchSource(src);
    } catch { /* ignore */ }
  }

  return {
    ok: true,
    entryId: id,
    aid,
    remoteCode: remote.toview ? remote.toview.code : (remote.unfav[0] && remote.unfav[0].code),
    remoteMessage: remote.toview
      ? (remote.toview.message || '')
      : (remote.unfav[0] && remote.unfav[0].message) || '',
    remote,
    reason: USER_CANCEL_REASON,
  };
}

function stableKeyFromIds(bvid, aid) {
  const bv = String(bvid || '').trim();
  const a = String(aid || '').trim();
  if (bv) return bv;
  if (a) return `av${a}`;
  return '';
}

/**
 * 统一构建入库条目。
 * @param {object} fields
 */
function buildBiliEntry(fields) {
  const bvid = String(fields.bvid || '').trim();
  const aid = fields.aid != null ? String(fields.aid).trim() : '';
  const stableKey = stableKeyFromIds(bvid, aid);
  if (!stableKey) return null;

  const id = md5(`${SOURCE_ID}|${stableKey}`);
  const title = String(fields.title || '').trim() || stableKey;
  const pic = httpsPic(fields.pic);
  const author = String(fields.author || '').trim() || 'UP主';
  const face = httpsPic(fields.face);
  const mid = fields.authorId != null ? String(fields.authorId) : '';
  const link = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : `https://www.bilibili.com/video/av${aid}`;
  const collectAt = Number(fields.collectAt) || 0;
  const pubdate = Number(fields.pubdate) || 0;
  const duration = Number(fields.duration) || 0;
  const progress = Number(fields.progress) || 0;
  const views = Number(fields.views) || 0;
  const likes = Number(fields.likes) || 0;
  const danmaku = Number(fields.danmaku) || 0;
  const collected = Number(fields.collected) || 0;
  const commentsCount = Number(fields.commentsCount) || 0;
  const desc = String(fields.desc || '').trim();
  const tname = String(fields.tname || '').trim();
  const displayAt = formatWallClock(collectAt) || formatWallClock(pubdate);
  const publishedTs = (collectAt || pubdate) * 1000 || Date.now();
  const summary = desc.slice(0, 280) || `${author} · ${formatDuration(duration)}`;
  const origins = Array.isArray(fields.origins) ? [...new Set(fields.origins.map(String))] : [];
  const favMediaIds = Array.isArray(fields.favMediaIds)
    ? [...new Set(fields.favMediaIds.map(x => String(x)).filter(x => /^\d+$/.test(x)))]
    : [];
  const favFolderTitles = Array.isArray(fields.favFolderTitles)
    ? [...new Set(fields.favFolderTitles.map(x => String(x || '').trim()).filter(Boolean))]
    : [];

  const payload = {
    v: 1,
    platform: PLATFORM,
    noteId: stableKey,
    bvid,
    aid,
    author,
    username: mid ? `uid${mid}` : '',
    authorId: mid,
    authorFace: face,
    url: link,
    type: '视频',
    likes,
    views,
    danmaku,
    collected,
    commentsCount,
    tags: tname ? [tname] : [],
    createdAt: formatWallClock(pubdate),
    likedAt: displayAt,
    collectedAt: displayAt,
    favoritedAt: displayAt,
    displayAt,
    title,
    body: desc,
    images: pic ? [{ src: pic, alt: title }] : [],
    cover: pic,
    duration,
    durationText: formatDuration(duration),
    progress,
    quote: null,
    comments: [],
    biliOrigins: origins,
    favMediaIds,
    favFolderTitles,
  };

  return {
    id,
    sourceId: SOURCE_ID,
    title,
    link,
    author,
    published: new Date(publishedTs).toISOString(),
    publishedTs,
    summary,
    content: encodeContent(payload),
    forceContent: true,
    image: pic || null,
    audio: null,
    __stableKey: stableKey,
    __collectAt: collectAt,
  };
}

function entryFromToviewItem(item, extra = {}) {
  if (!item || typeof item !== 'object') return null;
  const bvid = String(item.bvid || '').trim();
  const aid = item.aid != null ? String(item.aid) : '';
  const owner = item.owner && typeof item.owner === 'object' ? item.owner : {};
  const stat = item.stat && typeof item.stat === 'object' ? item.stat : {};
  return buildBiliEntry({
    bvid,
    aid,
    title: item.title,
    pic: item.pic,
    author: owner.name,
    face: owner.face,
    authorId: owner.mid,
    collectAt: Number(item.add_at) || 0,
    pubdate: Number(item.pubdate) || Number(item.ctime) || 0,
    duration: Number(item.duration) || 0,
    progress: Number(item.progress) || 0,
    views: Number(stat.view) || 0,
    likes: Number(stat.like) || 0,
    danmaku: Number(stat.danmaku) || 0,
    collected: Number(stat.favorite) || 0,
    commentsCount: Number(stat.reply) || 0,
    desc: item.desc,
    tname: item.tname,
    origins: ['watchlater', ...(extra.origins || [])],
    favMediaIds: extra.favMediaIds || [],
    favFolderTitles: extra.favFolderTitles || [],
  });
}

function entryFromFavMedia(item, extra = {}) {
  if (!item || typeof item !== 'object') return null;
  const bvid = String(item.bvid || item.bv_id || '').trim();
  const aid = item.id != null ? String(item.id) : '';
  const upper = item.upper && typeof item.upper === 'object' ? item.upper : {};
  const cnt = item.cnt_info && typeof item.cnt_info === 'object' ? item.cnt_info : {};
  const mediaId = item.__mediaId != null
    ? String(item.__mediaId)
    : (extra.mediaId != null ? String(extra.mediaId) : '');
  const folderTitle = item.__folderTitle || extra.folderTitle || '';
  return buildBiliEntry({
    bvid,
    aid,
    title: item.title,
    pic: item.cover,
    author: upper.name,
    face: upper.face,
    authorId: upper.mid,
    collectAt: Number(item.fav_time) || 0,
    pubdate: Number(item.pubtime) || Number(item.ctime) || 0,
    duration: Number(item.duration) || 0,
    progress: 0,
    views: Number(cnt.play) || 0,
    likes: 0,
    danmaku: Number(cnt.danmaku) || 0,
    collected: Number(cnt.collect) || 0,
    commentsCount: Number(cnt.reply) || 0,
    desc: item.intro,
    tname: '',
    origins: ['favorite', ...(extra.origins || [])],
    favMediaIds: mediaId ? [mediaId] : [],
    favFolderTitles: folderTitle ? [folderTitle] : [],
  });
}

/**
 * 合并稍后再看与收藏：同 bvid/aid 只保留一条，origins/favMediaIds 并集。
 */
function mergeBiliEntries(toviewEntries, favEntries) {
  /** @type {Map<string, ReturnType<typeof buildBiliEntry>>} */
  const map = new Map();

  const absorb = (entry) => {
    if (!entry || !entry.__stableKey) return;
    const key = entry.__stableKey;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, entry);
      return;
    }
    let prevPayload = null;
    let nextPayload = null;
    try {
      prevPayload = require('./likes-sync').parseStoredContent(prev.content);
      nextPayload = require('./likes-sync').parseStoredContent(entry.content);
    } catch { /* ignore */ }
    const origins = [...new Set([
      ...((prevPayload && prevPayload.biliOrigins) || []),
      ...((nextPayload && nextPayload.biliOrigins) || []),
    ].map(String))];
    const favMediaIds = [...new Set([
      ...((prevPayload && prevPayload.favMediaIds) || []),
      ...((nextPayload && nextPayload.favMediaIds) || []),
    ].map(String).filter(x => /^\d+$/.test(x)))];
    const favFolderTitles = [...new Set([
      ...((prevPayload && prevPayload.favFolderTitles) || []),
      ...((nextPayload && nextPayload.favFolderTitles) || []),
    ].map(x => String(x || '').trim()).filter(Boolean))];

    // 保留较新的收藏/加入时间
    const preferNext = Number(entry.__collectAt || 0) >= Number(prev.__collectAt || 0);
    const base = preferNext ? entry : prev;
    const other = preferNext ? prev : entry;
    let basePayload = null;
    try {
      basePayload = require('./likes-sync').parseStoredContent(base.content) || {};
    } catch {
      basePayload = {};
    }
    basePayload.biliOrigins = origins;
    basePayload.favMediaIds = favMediaIds;
    basePayload.favFolderTitles = favFolderTitles;
    // 稍后再看常有更完整 progress / likes
    if (!basePayload.progress && other) {
      try {
        const op = require('./likes-sync').parseStoredContent(other.content);
        if (op && op.progress) basePayload.progress = op.progress;
        if (op && op.likes && !basePayload.likes) basePayload.likes = op.likes;
      } catch { /* ignore */ }
    }
    map.set(key, {
      ...base,
      content: encodeContent(basePayload),
    });
  };

  for (const e of toviewEntries || []) absorb(e);
  for (const e of favEntries || []) absorb(e);

  return [...map.values()].map((e) => {
    const { __stableKey, __collectAt, ...rest } = e;
    return rest;
  });
}

function listFingerprint(list) {
  const parts = (list || []).map((item) => {
    const bvid = item && item.bvid ? item.bvid : `av${item && item.aid}`;
    return `${bvid}:${item && item.add_at || 0}:${item && item.progress || 0}`;
  });
  return md5(parts.join('|'));
}

function combinedFingerprint(toviewList, favMedias) {
  const tv = (toviewList || []).map((item) => {
    const bvid = item && item.bvid ? item.bvid : `av${item && item.aid}`;
    return `w:${bvid}:${item && item.add_at || 0}:${item && item.progress || 0}`;
  });
  const fav = (favMedias || []).map((item) => {
    const bvid = item && (item.bvid || item.bv_id) ? (item.bvid || item.bv_id) : `av${item && item.id}`;
    return `f:${bvid}:${item && item.fav_time || 0}:${item && item.__mediaId || ''}`;
  });
  return md5([...tv, ...fav].join('|'));
}

/**
 * 同步稍后再看 + 收藏夹。
 * @param {{ force?: boolean, prune?: boolean, fetcher?: object }} opts
 *   force  绕过指纹 skip（默认 false）
 *   prune  软删「既不在稍后再看也不在收藏夹」的本地条目（默认 true）。
 *          API 结果为空且本地仍有条目时一律拒绝 prune，防止 cookie/接口异常整库抹掉。
 */
async function syncAll({ force = false, prune = true, fetcher = null } = {}) {
  if (!SYNC_ENABLED) {
    return {
      sourceId: SOURCE_ID,
      skipped: true,
      disabled: true,
      imported: 0,
      count: 0,
    };
  }

  if (fetcher && typeof fetcher.getSourceById === 'function') {
    const src = fetcher.getSourceById(SOURCE_ID);
    if (!src || src.enabled === false) {
      return {
        sourceId: SOURCE_ID,
        skipped: true,
        disabled: true,
        imported: 0,
        count: 0,
      };
    }
  }

  if (syncLock) {
    return {
      sourceId: SOURCE_ID,
      skipped: true,
      running: true,
      imported: 0,
      count: lastSyncMeta.count || 0,
    };
  }

  syncLock = true;
  try {
    const auth = cookieFromEnvOrZen();
    const mid = await resolveMid(auth);
    const [{ list: toviewList, count: toviewCount }, favBundle] = await Promise.all([
      fetchToviewList(auth.cookieHeader),
      fetchAllFavMedias(auth.cookieHeader, mid),
    ]);
    const favMedias = favBundle.medias || [];
    const fp = combinedFingerprint(toviewList, favMedias);
    if (!force && lastSyncMeta.fingerprint === fp && lastSyncMeta.at > 0) {
      lastSyncMeta = { ...lastSyncMeta, at: Date.now(), error: null };
      return {
        sourceId: SOURCE_ID,
        skipped: true,
        imported: 0,
        count: lastSyncMeta.count || 0,
        toviewCount,
        favCount: favMedias.length,
        fingerprint: fp,
      };
    }

    const toviewEntries = [];
    for (const item of toviewList) {
      const e = entryFromToviewItem(item);
      if (e) toviewEntries.push(e);
    }
    const favEntries = [];
    for (const item of favMedias) {
      const e = entryFromFavMedia(item);
      if (e) favEntries.push(e);
    }
    const entries = mergeBiliEntries(toviewEntries, favEntries);

    // 再入列：仅恢复「离开列表」的自动软删；用户手动删除保持粘性
    for (const e of entries) {
      const meta = typeof store.getEntryDeleteMeta === 'function'
        ? store.getEntryDeleteMeta(e.id)
        : null;
      if (!meta) continue;
      if (String(meta.deletedReason || '') !== LEFT_REASON) continue;
      try {
        store.clearEntrySoftDelete(e.id);
      } catch { /* ignore */ }
    }

    const batchSize = 80;
    for (let i = 0; i < entries.length; i += batchSize) {
      store.upsertEntries(entries.slice(i, i + batchSize));
    }

    // 既不在稍后再看也不在任何收藏夹：软删
    let pruned = 0;
    let pruneSkipped = '';
    if (prune) {
      const keep = new Set(entries.map(e => e.id));
      try {
        const existing = store.listEntriesBySource(SOURCE_ID, 5000) || [];
        const localCount = existing.filter((row) => row && row.id).length;
        const apiEmpty = (toviewList || []).length === 0 && (favMedias || []).length === 0;
        // API 空结果 + 本地仍有条目：拒绝 prune（cookie 失效 / 限流常表现为空列表）
        if (apiEmpty && localCount > 0) {
          pruneSkipped = 'api-empty-local-present';
          console.warn(
            `[bili-watchlater] refuse prune: API empty but local has ${localCount} entries`,
          );
        } else {
          for (const row of existing) {
            if (!row || !row.id || keep.has(row.id)) continue;
            const result = store.softDeleteEntry(row.id, { reason: LEFT_REASON });
            if (result && !result.alreadyDeleted) pruned += 1;
          }
        }
      } catch (error) {
        console.warn('[bili-watchlater] prune failed:', error.message || error);
      }
    } else {
      pruneSkipped = 'disabled';
    }

    lastSyncMeta = {
      at: Date.now(),
      imported: entries.length,
      count: entries.length,
      toviewCount,
      favCount: favMedias.length,
      error: null,
      fingerprint: fp,
    };

    return {
      sourceId: SOURCE_ID,
      imported: entries.length,
      count: entries.length,
      toviewCount,
      favCount: favMedias.length,
      folders: (favBundle.folders || []).length,
      fingerprint: fp,
      skipped: false,
      cookieSource: auth.source,
      pruned,
      pruneSkipped: pruneSkipped || undefined,
    };
  } catch (error) {
    lastSyncMeta = {
      ...lastSyncMeta,
      at: Date.now(),
      error: error.message || String(error),
    };
    throw error;
  } finally {
    syncLock = false;
  }
}

function refreshLocalSources(fetcher) {
  if (!fetcher || typeof fetcher.fetchSource !== 'function') return;
  const src = typeof fetcher.getSourceById === 'function'
    ? fetcher.getSourceById(SOURCE_ID)
    : null;
  if (!src) return;
  try {
    void fetcher.fetchSource(src);
  } catch (error) {
    console.warn(`[bili-watchlater] refresh ${SOURCE_ID}:`, error.message || error);
  }
}

function getLastSyncMeta() {
  return { ...lastSyncMeta };
}

function startPoll({ fetcher = null } = {}) {
  if (!SYNC_ENABLED) {
    console.log('[bili-watchlater] poll disabled (BILI_SYNC_ENABLED=0)');
    return () => {};
  }
  if (!Number.isFinite(POLL_MS) || POLL_MS <= 0) {
    console.log('[bili-watchlater] poll disabled (BILI_POLL_MS<=0)');
    return () => {};
  }
  if (pollTimer) clearInterval(pollTimer);
  const interval = Math.max(60_000, POLL_MS);
  const run = async (reason) => {
    try {
      const r = await syncAll({ force: false, fetcher });
      if (r && !r.skipped) {
        refreshLocalSources(fetcher);
        console.log(
          `[bili-watchlater] ${reason}: imported=${r.imported} count=${r.count}`
          + ` toview=${r.toviewCount || 0} fav=${r.favCount || 0}`,
        );
      }
    } catch (error) {
      console.warn(`[bili-watchlater] ${reason} failed:`, error.message || error);
    }
  };
  pollTimer = setInterval(() => { void run('poll'); }, interval);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  console.log(`[bili-watchlater] poll every ${interval}ms`);
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
}

module.exports = {
  SOURCE_ID,
  PLATFORM,
  TOVIEW_URL,
  TOVIEW_DEL_URL,
  FAV_FOLDERS_URL,
  FAV_RESOURCE_LIST_URL,
  FAV_BATCH_DEL_URL,
  USER_CANCEL_REASON,
  LEFT_REASON,
  zenProfilePath,
  loadZenBiliCookies,
  cookieFromEnvOrZen,
  httpsPic,
  formatDuration,
  formatWallClock,
  entryFromToviewItem,
  entryFromFavMedia,
  mergeBiliEntries,
  listFingerprint,
  combinedFingerprint,
  fetchToviewList,
  fetchFavFolders,
  fetchFavFolderMedias,
  fetchAllFavMedias,
  deleteToviewByAid,
  unfavFromMediaId,
  aidFromEntry,
  cancelWatchlaterEntry,
  syncAll,
  refreshLocalSources,
  getLastSyncMeta,
  startPoll,
  __test: {
    md5,
    buildBiliEntry,
    stableKeyFromIds,
  },
};
