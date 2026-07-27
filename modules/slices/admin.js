const fetcher = require('../../lib/fetcher');
const { sendError } = require('../shared/http');
const { TITLE_TRANSLATION_LIMIT } = require('../shared/config');
const {
  startBackgroundJob,
  doRefreshAll,
} = require('../jobs/orchestrator');
const { syncLocalDiskSource } = require('../jobs/local-sync');
const { translateMissingTitles } = require('../../lib/background-jobs');

function registerAdminRoutes(app, { refreshRateLimit = (req, res, next) => next() } = {}) {

  app.post('/api/translate-titles', async (req, res) => {
    try {
      const translated = await translateMissingTitles(parseInt((req.body && req.body.limit) || TITLE_TRANSLATION_LIMIT, 10));
      res.json({ translated });
    } catch (e) {
      sendError(res, e, 'title translation failed');
    }
  });

  app.post('/api/refresh', refreshRateLimit, async (req, res) => {
    const { sourceId } = req.body || {};
    if (sourceId) {
      const src = fetcher.getSourceById(sourceId);
      if (!src) return res.status(404).json({ error: 'source not found' });
      // 本地 Typora/知识库：必须扫盘，不能只走 worker 读 DB
      if (src.localOnly) {
        try {
          const maybe = syncLocalDiskSource(fetcher, src.id, { force: true });
          if (maybe && typeof maybe.then === 'function') {
            return maybe
              .then((local) => res.json({
                started: true,
                running: false,
                finished: true,
                local: true,
                async: true,
                imported: local.imported,
                entryCount: local.entryCount,
                progress: { done: 1, total: 1, sourceId: src.id },
                job: { kind: 'local-sync', sourceId: src.id, finishedAt: Date.now() },
              }))
              .catch((error) => sendError(res, error, 'local sync failed'));
          }
          const local = maybe;
          if (local) {
            return res.json({
              started: true,
              running: false,
              finished: true,
              local: true,
              imported: local.imported,
              entryCount: local.entryCount,
              progress: { done: 1, total: 1, sourceId: src.id },
              job: { kind: 'local-sync', sourceId: src.id, finishedAt: Date.now() },
            });
          }
        } catch (error) {
          return sendError(res, error, 'local likes sync failed');
        }
      }
      const result = startBackgroundJob({
        kind: 'refresh',
        sourceId: src.id,
        sourceIds: [src.id],
      });
      return res.json({ started: result.started, running: result.running, job: result.job, progress: result.progress, autoRewrite: result.autoRewrite });
    }
    const result = doRefreshAll();
    res.json({ started: result.started, running: result.running, job: result.job, progress: result.progress, autoRewrite: result.autoRewrite });
  });

  app.post('/api/sources/:id/toggle', async (req, res) => {
    const src = fetcher.getSourceById(req.params.id);
    if (!src) return res.status(404).json({ error: 'source not found' });
    const enabled = !fetcher.isEnabled(src);
    fetcher.setEnabled(src.id, enabled);
    fetcher.flushDisk();
    if (enabled) startBackgroundJob({
      kind: 'refresh',
      sourceId: src.id,
      sourceIds: [src.id],
    });
    res.json({ id: src.id, enabled });
  });

  app.post('/api/subscriptions', async (req, res) => {
    try {
      const body = req.body || {};
      const url = String(body.url || '').trim();
      if (!url) return res.status(400).json({ error: '请填写网站或 RSS 地址' });
      const source = await fetcher.createCustomSource({
        url,
        name: body.name,
        category: body.category,
        refreshIntervalMs: body.refreshIntervalMs,
      });
      const refresh = startBackgroundJob({
        kind: 'refresh',
        sourceId: source.id,
        sourceIds: [source.id],
        reason: 'subscription-created',
      });
      const meta = fetcher.getSourcesMeta().find(item => item.id === source.id) || source;
      return res.status(201).json({ source: meta, refresh });
    } catch (error) {
      return sendError(res, error, '添加订阅失败');
    }
  });
}

module.exports = { registerAdminRoutes };
