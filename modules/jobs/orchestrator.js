/**
 * Background jobs vertical slice: fetch/AI worker orchestration + schedules.
 */
const { fork } = require('child_process');
const fetcher = require('../../lib/fetcher');
const {
  ROOT,
  MINUTE_MS,
  DAILY_REFRESH_HOUR_SHANGHAI,
  STARTUP_REFRESH_DELAY_MS,
  SOURCE_INTERACTION_REFRESH_COOLDOWN_MS,
  FRESHNESS_SWEEP_INTERVAL_MS,
  FRESHNESS_STARTUP_DELAY_MS,
  FRESHNESS_SWEEP_BATCH_SIZE,
  FRESHNESS_SWEEP_MAX_COST,
  NEWS_REFRESH_INTERVAL_MS,
  ARTICLE_REFRESH_INTERVAL_MS,
  PODCAST_REFRESH_INTERVAL_MS,
  AUTO_REWRITE_SOURCE_IDS,
  REFRESH_WORKER_PATH,
} = require('../shared/config');
const { syncLocalDiskSource } = require('./local-sync');

let refreshing = false;
let refreshProgress = { done: 0, total: 0 };
let refreshWorker = null;
let refreshJob = null;
let refreshLast = null;
let aiWorker = null;
let aiJob = null;
let aiLast = null;
const aiQueuedSourceIds = new Set();
let autoRewriteRunning = false;
let autoRewriteLast = null;
const sourceInteractionRefreshAt = new Map();

function normalizeBackgroundJob(job = {}) {
  const kind = String(job.kind || 'refresh').trim();
  const sourceId = String(job.sourceId || '').trim();
  const reason = String(job.reason || '').trim();
  const sourceIds = Array.isArray(job.sourceIds)
    ? job.sourceIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  return {
    kind,
    sourceId,
    sourceIds,
    reason,
    fetchOnly: Boolean(job.fetchOnly),
    requestedAt: Date.now(),
  };
}

function defaultAutoRewriteSourceIds() {
  if (AUTO_REWRITE_SOURCE_IDS.size) return Array.from(AUTO_REWRITE_SOURCE_IDS);
  return fetcher.getSourcesMeta()
    .filter(source => source && source.enabled)
    .map(source => source.id)
    .filter(Boolean);
}

function defaultRefreshSourceIds() {
  return fetcher.getSourcesMeta()
    .filter(source => {
      const src = fetcher.getSourceById(source.id);
      return source && source.enabled && src && !src.manual;
    })
    .map(source => source.id)
    .filter(Boolean);
}

function backgroundJobState() {
  return {
    running: Boolean(refreshWorker || aiWorker),
    job: refreshJob || aiJob,
    last: refreshLast,
    fetch: {
      running: Boolean(refreshWorker),
      job: refreshJob,
      last: refreshLast,
      progress: refreshProgress,
    },
    ai: {
      running: Boolean(aiWorker),
      job: aiJob,
      last: aiLast,
      queuedSourceIds: Array.from(aiQueuedSourceIds),
    },
  };
}

function reloadFetcherAfterWorker() {
  try {
    fetcher.loadDisk({ upsert: false });
  } catch (error) {
    console.warn('Reload refreshed cache skipped:', error.message || error);
  }
}

function autoRewriteSourceIdsFromRefresh(refresh, job = {}) {
  if (!refresh || typeof refresh !== 'object') return [];
  if (!Number(refresh.changedEntryCount || 0)) return [];
  if (Array.isArray(refresh.changedSourceIds) && refresh.changedSourceIds.length) return refresh.changedSourceIds;
  if (refresh.sourceId) return [refresh.sourceId];
  if (Array.isArray(refresh.sourceIds) && refresh.sourceIds.length) return refresh.sourceIds;
  if (job && job.sourceId) return [job.sourceId];
  if (job && Array.isArray(job.sourceIds) && job.sourceIds.length) return job.sourceIds;
  return [];
}

function queueAutoRewriteForRefresh(refresh, job = {}) {
  const sourceIds = autoRewriteSourceIdsFromRefresh(refresh, job);
  if (!sourceIds.length) return { started: false, skipped: 'no changed sources' };
  return startAutoRewriteJob({
    kind: 'auto-rewrite',
    sourceIds,
    reason: `after-${job.reason || 'refresh'}`,
  });
}

function finishFetchJob({ result = null, error = null, code = 0, signal = '' } = {}) {
  const finishedAt = Date.now();
  const finalLast = {
    ...(result || {}),
    job: refreshJob,
    finishedAt,
    error: error ? String(error.message || error).slice(0, 300) : (code ? `worker exited with code ${code}${signal ? ` (${signal})` : ''}` : ''),
  };
  if (refreshLast && refreshLast.fetchedAt && !finalLast.error) {
    refreshLast = {
      ...refreshLast,
      ...finalLast,
      refresh: finalLast.refresh || refreshLast.refresh,
      postProcessingQueued: refreshLast.postProcessingQueued,
    };
  } else {
    refreshLast = finalLast;
  }
  if (refreshing && refreshProgress.total && refreshProgress.done < refreshProgress.total && !refreshLast.error) {
    refreshProgress.done = refreshProgress.total;
  }
  if (refreshing) refreshing = false;
  refreshWorker = null;
  refreshJob = null;
  reloadFetcherAfterWorker();
}

function finishAiJob({ result = null, error = null, code = 0, signal = '' } = {}) {
  const finishedAt = Date.now();
  aiLast = {
    ...(result || {}),
    job: aiJob,
    finishedAt,
    error: error ? String(error.message || error).slice(0, 300) : (code ? `AI worker exited with code ${code}${signal ? ` (${signal})` : ''}` : ''),
  };
  autoRewriteRunning = false;
  autoRewriteLast = {
    ...(result && result.autoRewrite || autoRewriteLast || {}),
    translated: result && result.translated || 0,
    sourceIds: aiJob && aiJob.sourceIds || [],
    startedAt: autoRewriteLast && autoRewriteLast.startedAt || aiJob && aiJob.startedAt || finishedAt,
    finishedAt,
    running: false,
    error: aiLast.error || '',
  };
  aiWorker = null;
  aiJob = null;
  reloadFetcherAfterWorker();
  if (aiQueuedSourceIds.size) {
    const queued = Array.from(aiQueuedSourceIds);
    aiQueuedSourceIds.clear();
    setTimeout(() => startAutoRewriteJob({
      kind: 'auto-rewrite',
      sourceIds: queued,
      reason: 'queued',
    }), 0);
  }
}

function startFetchJob(job = {}) {
  if (refreshWorker) {
    return {
      started: false,
      running: true,
      job: refreshJob,
      progress: refreshProgress,
      autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    };
  }

  const normalized = { ...normalizeBackgroundJob(job), kind: 'refresh', fetchOnly: true };
  const startedAt = Date.now();
  refreshJob = { ...normalized, startedAt };
  refreshLast = null;
  refreshing = true;
  refreshProgress = normalized.sourceId
    ? { done: 0, total: 1, sourceId: normalized.sourceId }
    : { done: 0, total: normalized.sourceIds.length || 0, sourceId: '' };

  const worker = fork(REFRESH_WORKER_PATH, [], {
    cwd: ROOT,
    env: { ...process.env, QMREADER_WORKER_KIND: 'fetch' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  refreshWorker = worker;
  let workerResult = null;
  let workerError = null;

  worker.stdout.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.log(`[refresh-worker] ${line}`);
    }
  });
  worker.stderr.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.warn(`[refresh-worker] ${line}`);
    }
  });
  worker.on('message', message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'progress') {
      refreshProgress = {
        done: Number(message.done) || 0,
        total: Number(message.total) || 0,
        sourceId: message.sourceId || '',
      };
      return;
    }
    if (message.type === 'fetchDone') {
      if (refreshing) {
        if (refreshProgress.total && refreshProgress.done < refreshProgress.total) {
          refreshProgress.done = refreshProgress.total;
        }
        refreshing = false;
      }
      reloadFetcherAfterWorker();
      refreshLast = {
        kind: 'refresh',
        sourceId: refreshJob && refreshJob.sourceId || '',
        refresh: message.refresh || null,
        job: refreshJob,
        fetchedAt: message.finishedAt || Date.now(),
        postProcessing: false,
        postProcessingQueued: false,
        error: '',
      };
      const queued = queueAutoRewriteForRefresh(message.refresh, refreshJob);
      refreshLast.postProcessingQueued = Boolean(queued.started || queued.running);
      return;
    }
    if (message.type === 'done') {
      workerResult = message.result || {};
      return;
    }
    if (message.type === 'error') {
      workerError = message.error || { message: 'worker failed' };
    }
  });
  worker.on('error', error => {
    workerError = error;
  });
  worker.on('exit', (code, signal) => {
    const failed = workerError || code;
    if (failed) console.warn('Refresh worker exited with error:', workerError && workerError.message ? workerError.message : code);
    finishFetchJob({ result: workerResult, error: workerError, code, signal });
  });
  worker.send({ type: 'run', job: normalized });

  return {
    started: true,
    running: true,
    job: refreshJob,
    progress: refreshProgress,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
  };
}

function startAutoRewriteJob(job = {}) {
  const normalized = { ...normalizeBackgroundJob(job), kind: 'auto-rewrite' };
  const sourceIds = normalized.sourceIds.length ? normalized.sourceIds : defaultAutoRewriteSourceIds();
  const uniqueSourceIds = [...new Set(sourceIds)];
  if (!uniqueSourceIds.length) return { started: false, skipped: 'no sources configured' };
  if (aiWorker) {
    for (const id of uniqueSourceIds) aiQueuedSourceIds.add(id);
    return {
      started: false,
      running: true,
      queuedSourceIds: Array.from(aiQueuedSourceIds),
      job: aiJob,
      autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    };
  }

  const startedAt = Date.now();
  aiJob = { ...normalized, sourceIds: uniqueSourceIds, startedAt };
  aiLast = null;
  autoRewriteRunning = true;
  autoRewriteLast = { sourceIds: uniqueSourceIds, startedAt, finishedAt: 0, running: true };

  const worker = fork(REFRESH_WORKER_PATH, [], {
    cwd: ROOT,
    env: { ...process.env, QMREADER_WORKER_KIND: 'ai' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  aiWorker = worker;
  let workerResult = null;
  let workerError = null;

  worker.stdout.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.log(`[ai-worker] ${line}`);
    }
  });
  worker.stderr.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.warn(`[ai-worker] ${line}`);
    }
  });
  worker.on('message', message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'autoRewriteStart') {
      autoRewriteRunning = true;
      autoRewriteLast = {
        sourceIds: message.sourceIds || uniqueSourceIds,
        startedAt: message.startedAt || startedAt,
        finishedAt: 0,
        running: true,
      };
      return;
    }
    if (message.type === 'autoRewriteDone') {
      autoRewriteRunning = false;
      autoRewriteLast = {
        ...(message.autoRewrite || {}),
        sourceIds: (autoRewriteLast && autoRewriteLast.sourceIds) || uniqueSourceIds,
        startedAt: (autoRewriteLast && autoRewriteLast.startedAt) || startedAt,
        finishedAt: message.finishedAt || Date.now(),
        running: false,
      };
      return;
    }
    if (message.type === 'done') {
      workerResult = message.result || {};
      return;
    }
    if (message.type === 'error') {
      workerError = message.error || { message: 'AI worker failed' };
    }
  });
  worker.on('error', error => {
    workerError = error;
  });
  worker.on('exit', (code, signal) => {
    const failed = workerError || code;
    if (failed) console.warn('AI worker exited with error:', workerError && workerError.message ? workerError.message : code);
    finishAiJob({ result: workerResult, error: workerError, code, signal });
  });
  worker.send({ type: 'run', job: { ...normalized, sourceIds: uniqueSourceIds } });

  return {
    started: true,
    running: true,
    job: aiJob,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
  };
}

function startBackgroundJob(job = {}) {
  const normalized = normalizeBackgroundJob(job);
  if (normalized.kind === 'auto-rewrite') return startAutoRewriteJob(normalized);
  return startFetchJob(normalized);
}

function doRefreshAll() {
  return startBackgroundJob({
    kind: 'refresh',
    sourceIds: defaultRefreshSourceIds(),
    reason: 'full-refresh',
  });
}

function triggerSourceInteractionRefresh(sourceId, reason = 'interaction') {
  const id = String(sourceId || '').trim();
  if (!id) return { started: false, skipped: 'missing sourceId' };
  const src = fetcher.getSourceById(id);
  if (!src) return { started: false, skipped: 'source not found' };
  if (src.manual) return { started: false, skipped: 'manual source' };
  // 本地收藏 / B站稍后再看：切源时轻量同步（指纹未变则 skip）
  if (src.localOnly) {
    try {
      const maybe = syncLocalDiskSource(fetcher, id, { force: false });
      // bili-watchlater 返回 Promise；likes/xhs/zhihu 同步返回
      if (maybe && typeof maybe.then === 'function') {
        // 异步：先回 ok，后台灌 cache（与 refresh 后台任务类似）
        void maybe
          .then((local) => {
            if (local && !local.skipped) {
              console.log(`[bili-watchlater] interaction sync imported=${local.imported} count=${local.entryCount}`);
            }
          })
          .catch((error) => {
            console.warn(`[bili-watchlater] interaction sync failed:`, error.message || error);
          });
        return {
          started: true,
          running: true,
          finished: false,
          local: true,
          async: true,
          reason,
        };
      }
      const local = maybe;
      if (local) {
        return {
          started: true,
          running: false,
          finished: true,
          local: true,
          skipped: local.skipped ? 'unchanged' : undefined,
          imported: local.imported,
          entryCount: local.entryCount,
          reason,
        };
      }
    } catch (error) {
      console.warn(`[likes-sync] interaction sync ${id}:`, error.message || error);
      return { started: false, skipped: 'local sync failed', error: error.message || String(error) };
    }
    return { started: false, skipped: 'localOnly' };
  }
  if (!fetcher.isEnabled(src)) return { started: false, skipped: 'source disabled' };
  if (refreshWorker) {
    return { started: false, running: true, skipped: 'refresh already running', job: refreshJob };
  }
  const cooldown = Number.isFinite(SOURCE_INTERACTION_REFRESH_COOLDOWN_MS)
    ? Math.max(0, SOURCE_INTERACTION_REFRESH_COOLDOWN_MS)
    : 15 * 60 * 1000;
  const now = Date.now();
  const last = sourceInteractionRefreshAt.get(id) || 0;
  if (cooldown && now - last < cooldown) {
    return { started: false, skipped: 'cooldown', nextAllowedAt: last + cooldown };
  }
  const result = startBackgroundJob({
    kind: 'refresh',
    sourceId: src.id,
    sourceIds: [src.id],
    reason,
  });
  if (result.started) sourceInteractionRefreshAt.set(id, now);
  return result;
}

function sourceRefreshInterval(source) {
  if (!source || source.manual) return 0;
  if (Number.isFinite(source.refreshIntervalMs) && source.refreshIntervalMs > 0) {
    return Math.max(60 * 1000, source.refreshIntervalMs);
  }
  if (source.category === 'news') return Math.max(5 * MINUTE_MS, NEWS_REFRESH_INTERVAL_MS || 0);
  if (source.category === 'podcast') return Math.max(30 * MINUTE_MS, PODCAST_REFRESH_INTERVAL_MS || 0);
  return Math.max(15 * MINUTE_MS, ARTICLE_REFRESH_INTERVAL_MS || 0);
}

function sourceRefreshPriority(source) {
  if (source && Number.isFinite(source.refreshPriority) && source.refreshPriority > 0) return source.refreshPriority;
  if (source && source.category === 'news') return 2;
  if (source && source.category === 'podcast') return 0.8;
  return 1.2;
}

function sourceRefreshCost(source) {
  if (source && Number.isFinite(source.refreshCost) && source.refreshCost > 0) return source.refreshCost;
  if (source && source.id === 'hackernews') return 3;
  return 1;
}

function freshnessCandidates() {
  const now = Date.now();
  return fetcher.getSourcesMeta()
    .map(meta => {
      const source = fetcher.getSourceById(meta.id);
      const interval = sourceRefreshInterval(source);
      const fetchedAt = Number(meta.fetchedAt) || 0;
      const age = fetchedAt ? now - fetchedAt : Infinity;
      const nextRetryAt = Number(meta.nextRetryAt) || 0;
      const overdueRatio = interval ? age / interval : 0;
      const priority = sourceRefreshPriority(source);
      const cost = sourceRefreshCost(source);
      const starvationBoost = overdueRatio >= 2 ? Math.min(4, overdueRatio - 1) : 0;
      const score = (overdueRatio * priority) + starvationBoost - (cost * 0.15);
      return { meta, source, interval, age, overdueRatio, priority, cost, score, nextRetryAt };
    })
    .filter(item => (
      item.source
      && item.interval
      && item.meta.enabled
      && !item.source.manual
      && (!item.nextRetryAt || item.nextRetryAt <= now)
      && item.age >= item.interval
    ))
    .sort((a, b) => (
      b.score - a.score
      || b.overdueRatio - a.overdueRatio
      || b.age - a.age
    ));
}

function triggerFreshnessRefresh() {
  if (refreshWorker) return { started: false, running: true, skipped: 'refresh already running', job: refreshJob };
  const candidates = freshnessCandidates();
  const batchSize = Number.isFinite(FRESHNESS_SWEEP_BATCH_SIZE) && FRESHNESS_SWEEP_BATCH_SIZE > 0 ? FRESHNESS_SWEEP_BATCH_SIZE : 1;
  const maxCost = Number.isFinite(FRESHNESS_SWEEP_MAX_COST) && FRESHNESS_SWEEP_MAX_COST > 0 ? FRESHNESS_SWEEP_MAX_COST : Infinity;
  const selected = [];
  let cost = 0;
  for (const item of candidates) {
    if (selected.length >= batchSize) break;
    if (selected.length && cost + item.cost > maxCost) continue;
    selected.push(item);
    cost += item.cost;
  }
  if (!selected.length) return { started: false, skipped: 'no stale sources' };
  return startBackgroundJob({
    kind: 'refresh',
    sourceIds: selected.map(item => item.source.id),
    reason: 'freshness-sweep',
  });
}

function nextShanghaiRefreshDelay() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const addDay = hour >= DAILY_REFRESH_HOUR_SHANGHAI ? 1 : 0;
  const targetUtc = Date.UTC(year, month - 1, day + addDay, DAILY_REFRESH_HOUR_SHANGHAI - 8, 0, 0);
  return Math.max(targetUtc - now.getTime(), 60 * 1000);
}

function scheduleDailyRefresh() {
  const delay = nextShanghaiRefreshDelay();
  setTimeout(() => {
    doRefreshAll();
    scheduleDailyRefresh();
  }, delay);
}

function scheduleStartupRefresh() {
  if (Number.isFinite(STARTUP_REFRESH_DELAY_MS) && STARTUP_REFRESH_DELAY_MS < 0) {
    console.log('Startup refresh disabled');
    return;
  }
  const delay = Number.isFinite(STARTUP_REFRESH_DELAY_MS) ? Math.max(0, STARTUP_REFRESH_DELAY_MS) : 30000;
  setTimeout(() => {
    doRefreshAll();
  }, delay);
}

function scheduleFreshnessRefresh() {
  if (!Number.isFinite(FRESHNESS_SWEEP_INTERVAL_MS) || FRESHNESS_SWEEP_INTERVAL_MS < 0) {
    console.log('Freshness sweep disabled');
    return;
  }
  const interval = Math.max(60 * 1000, FRESHNESS_SWEEP_INTERVAL_MS);
  const delay = Number.isFinite(FRESHNESS_STARTUP_DELAY_MS) ? Math.max(0, FRESHNESS_STARTUP_DELAY_MS) : 2 * MINUTE_MS;
  setTimeout(() => {
    triggerFreshnessRefresh();
    setInterval(triggerFreshnessRefresh, interval);
  }, delay);
}

function getRefreshSnapshot() {
  return {
    refreshing,
    progress: refreshProgress,
    autoRewrite: { running: autoRewriteRunning, last: autoRewriteLast },
    backgroundJob: backgroundJobState(),
  };
}

module.exports = {
  normalizeBackgroundJob,
  backgroundJobState,
  startBackgroundJob,
  startFetchJob,
  startAutoRewriteJob,
  doRefreshAll,
  triggerSourceInteractionRefresh,
  triggerFreshnessRefresh,
  scheduleDailyRefresh,
  scheduleStartupRefresh,
  scheduleFreshnessRefresh,
  defaultAutoRewriteSourceIds,
  defaultRefreshSourceIds,
  getRefreshSnapshot,
  get refreshing() { return refreshing; },
  get refreshProgress() { return refreshProgress; },
  get autoRewriteRunning() { return autoRewriteRunning; },
  get autoRewriteLast() { return autoRewriteLast; },
};
