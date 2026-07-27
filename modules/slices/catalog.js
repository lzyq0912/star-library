const fetcher = require('../../lib/fetcher');
const store = require('../../lib/store');
const { sendError } = require('../shared/http');
const {
  getRefreshSnapshot,
  triggerSourceInteractionRefresh,
} = require('../jobs/orchestrator');
const { entryByIdOrPrefix } = require('../seo/register');
const { originalFetchPublicError } = require('../../lib/original-fetch-error');

function registerCatalogRoutes(app, { submitLinkRateLimit, submitLinkDailyRateLimit, originalFetchRateLimit }) {

  app.get('/api/sources', (req, res) => {
    const snap = getRefreshSnapshot();
    res.json({
      sources: fetcher.getSourcesMeta(),
      refreshing: snap.refreshing,
      progress: snap.progress,
      autoRewrite: snap.autoRewrite,
      backgroundJob: snap.backgroundJob,
    });
  });

  app.post('/api/sources/:id/refresh-hint', (req, res) => {
    try {
      const reason = String((req.body && req.body.reason) || 'source-interaction').trim() || 'source-interaction';
      const refresh = triggerSourceInteractionRefresh(req.params.id, reason);
      res.json({ ok: true, refresh });
    } catch (e) {
      sendError(res, e, 'source refresh hint failed');
    }
  });

  app.get('/api/entries', (req, res) => {
    const { source, category, q, limit } = req.query;
    const entries = fetcher.getEntries({
      sourceId: source || undefined,
      category: category || undefined,
      q: q || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      viewer: req.user,
    }).map((entry) => {
      if (!entry) return entry;
      if (entry.content == null
        && entry.contentHash == null
        && entry.deletedAt == null
        && entry.originalFetchedAt == null) {
        return entry;
      }
      const {
        content,
        contentHash,
        originalFetchedAt,
        originalFetchAttemptedAt,
        originalFetchError,
        deletedAt,
        deletedBy,
        deletedReason,
        ...rest
      } = entry;
      return rest;
    });
    // 目录可短缓存
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ entries });
  });

  app.get('/api/entry/:id', (req, res) => {
    const entry = entryByIdOrPrefix(req.params.id, req.user);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    res.json({ entry });
  });

  app.delete('/api/entry/:id', (req, res) => {
    try {
      const result = fetcher.deleteEntry(req.params.id, {
        reason: req.body && req.body.reason,
      });
      if (!result) return res.status(404).json({ error: 'entry not found' });
      res.json({ ok: true, entryId: result.id, deletedAt: result.deletedAt || null, alreadyDeleted: Boolean(result.alreadyDeleted) });
    } catch (e) {
      sendError(res, e, 'delete entry failed');
    }
  });

  /**
   * b站收藏：本机取消（远端 toview/del 和/或 收藏夹 batch-del + 本地软删）。
   * 与「已读」无关；仅 bili-watchlater 条目。
   */
  app.post('/api/bili-watchlater/remove', (req, res) => {
    try {
      const bili = require('../../lib/bili-watchlater-sync');
      const entryId = String((req.body && req.body.entryId) || req.query.entryId || '').trim();
      Promise.resolve(bili.cancelWatchlaterEntry(entryId, {
        fetcher,
      }))
        .then((result) => {
          res.json(result);
        })
        .catch((e) => {
          sendError(res, e, 'cancel bili collection failed');
        });
    } catch (e) {
      sendError(res, e, 'cancel bili collection failed');
    }
  });

  /** 删除源：停同步 + 硬清该源全部内容 */
  app.delete('/api/sources/:id', (req, res) => {
    try {
      const result = fetcher.deleteSource(req.params.id, {
        reason: (req.body && req.body.reason) || 'front-end source delete',
        hard: req.body && req.body.hard === false ? false : true,
      });
      if (!result) return res.status(404).json({ error: 'source not found' });
      res.json({
        ok: true,
        id: result.id,
        name: result.name,
        enabled: false,
        deletedCount: result.deletedCount,
        totalBefore: result.totalBefore,
        mode: result.mode,
      });
    } catch (e) {
      sendError(res, e, 'delete source failed');
    }
  });

  app.post('/api/entry/:id/view', (req, res) => {
    const entry = fetcher.getEntryById(req.params.id, req.user);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    try {
      store.recordEntryView(entry.id);
      const state = store.setUserEntryState(req.user.id, entry.id, { viewed: true });
      res.json({ stats: store.getEntryStats([entry.id], req.user)[entry.id], state });
    } catch (e) {
      sendError(res, e, 'record entry view failed');
    }
  });

  /** 思考笔记：读取（无笔记返回 null） */
  app.get('/api/entry/:id/note', (req, res) => {
    const entry = fetcher.getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    try {
      res.json({ note: store.getEntryNote(entry.id) });
    } catch (e) {
      sendError(res, e, 'load note failed');
    }
  });

  /** 思考笔记：保存（空正文即删除；beforeunload 的 sendBeacon 也走这里） */
  app.post('/api/entry/:id/note', (req, res) => {
    const entry = fetcher.getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    try {
      const body = String((req.body && req.body.body) || '').slice(0, 200000);
      res.json({ note: store.saveEntryNote(entry.id, body) });
    } catch (e) {
      sendError(res, e, 'save note failed');
    }
  });

  app.post('/api/submit-link', submitLinkRateLimit, submitLinkDailyRateLimit, async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    const note = String((req.body && req.body.note) || '').trim();
    if (!url) return res.status(400).json({ error: '请填写要提交的链接' });
    try {
      const submitter = req.user;
      const entry = await fetcher.submitLink(url, submitter, { note });
      res.json({ pending: false, entry, sourceId: 'user-submitted' });
    } catch (e) {
      sendError(res, e, 'submit link failed');
    }
  });

  /** GitHub 项目书签（非文章）：API 拉 meta/README，收入 github-projects 源 */
  app.post('/api/submit-github-repo', submitLinkRateLimit, submitLinkDailyRateLimit, async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    const note = String((req.body && req.body.note) || '').trim();
    if (!url) return res.status(400).json({ error: '请填写 GitHub 仓库链接' });
    try {
      const submitter = req.user;
      const entry = await fetcher.submitGitHubRepo(url, submitter, { note });
      res.json({ pending: false, entry, sourceId: 'github-projects' });
    } catch (e) {
      sendError(res, e, 'submit github repo failed');
    }
  });

  app.post('/api/entry/:id/content', originalFetchRateLimit, async (req, res) => {
    const entry = fetcher.getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    try {
      const updated = await fetcher.fetchEntryOriginal(entry);
      res.json({ entry: updated });
    } catch (e) {
      sendError(res, originalFetchPublicError(e), 'fetch original content failed');
    }
  });
}

module.exports = { originalFetchPublicError, registerCatalogRoutes };
