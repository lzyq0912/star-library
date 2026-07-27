const fetcher = require('../../lib/fetcher');
const store = require('../../lib/store');
const deepseek = require('../../lib/deepseek');
const { requestAiConfig } = require('../../lib/request-ai-config');
const { prepareEntryForAiAsset } = require('../../lib/background-jobs');
const { sendError } = require('../shared/http');
const { encryptionKey } = require('../../lib/secrets');

/** 翻译输出预算下限 */
const TRANSLATION_CLIENT_MAX_TOKENS_FLOOR = 8000;

/** 客户端带了 key 用客户端；否则优先 DeepSeek 服务端 key */
function resolveTranslationAiConfig(req) {
  const client = requestAiConfig(req);
  if (client && String(client.apiKey || '').trim()) {
    return {
      ...client,
      temperature: client.temperature || 0.1,
      maxTokens: Math.max(Number(client.maxTokens) || 0, TRANSLATION_CLIENT_MAX_TOKENS_FLOOR),
    };
  }
  const saved = store.getAiProfileConfigForPurpose('translation');
  if (saved && String(saved.apiKey || '').trim()) {
    return {
      ...saved,
      temperature: saved.temperature || 0.1,
      maxTokens: Math.max(Number(saved.maxTokens) || 0, TRANSLATION_CLIENT_MAX_TOKENS_FLOOR),
    };
  }
  const server = deepseek.getServerTranslationConfig();
  return {
    apiKey: server.apiKey,
    provider: server.provider,
    providerName: server.providerTitle,
    providerType: server.providerType,
    baseUrl: server.baseUrl,
    model: server.model,
    temperature: 0.1,
    maxTokens: Math.max(Number(server.maxTokens) || 0, TRANSLATION_CLIENT_MAX_TOKENS_FLOOR),
  };
}

function normalizeProfilePayload(body = {}) {
  const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(baseUrl); } catch {
    const error = new Error('Base URL 格式不正确');
    error.statusCode = 400;
    throw error;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    const error = new Error('Base URL 必须是无账号信息的 HTTPS 地址');
    error.statusCode = 400;
    throw error;
  }
  return {
    id: body.id,
    name: body.name,
    provider: body.provider,
    providerName: body.providerName,
    providerType: body.providerType,
    providerCategory: body.providerCategory,
    apiKeyUrl: body.apiKeyUrl,
    baseUrl,
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    apiKey: body.apiKey,
    isDefault: body.isDefault,
  };
}

function secretStorageReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function publicAiProfile(profile) {
  if (!profile) return null;
  const { credentialId, apiKey, ...safe } = profile;
  return safe;
}

function aiProfilesResponse() {
  return {
    profiles: store.listAiProfiles().map(publicAiProfile),
    settings: store.getAiSettings(),
    secretStorageReady: secretStorageReady(),
  };
}

const TRANSLATION_ROUTE_TIMEOUT_MS = Math.max(
  60_000,
  parseInt(process.env.TRANSLATION_ROUTE_TIMEOUT_MS || '240000', 10) || 240_000,
);

function withTimeout(promise, ms, label = '操作') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label}超时（>${Math.round(ms / 1000)}s）。请检查 API Key、Base URL，或换较短文章重试`);
      err.statusCode = 504;
      err.retryable = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function translationResponse(entry, viewer = null, assetId = '') {
  const exactAssetId = String(assetId || '').trim();
  const translation = exactAssetId
    ? store.getAiAssetContribution(exactAssetId, 'translation')
    : store.getTranslation(entry.id);
  if (translation && exactAssetId && translation.entryId !== entry.id) return null;
  if (!translation) return null;
  let full = entry;
  try {
    const stored = store.getEntry(entry.id);
    if (stored) {
      const storedLen = String(stored.content || '').length;
      const entryLen = String(entry.content || '').length;
      if (storedLen > entryLen || !entryLen) {
        full = { ...entry, ...stored, content: stored.content || entry.content || '' };
      }
    }
  } catch { /* keep entry */ }
  if (!String(full.content || '').trim()) {
    try {
      const fromFetcher = typeof fetcher !== 'undefined' && fetcher.getEntryById
        ? fetcher.getEntryById(entry.id)
        : null;
      if (fromFetcher && String(fromFetcher.content || '').trim()) {
        full = { ...full, ...fromFetcher, content: fromFetcher.content };
      }
    } catch { /* ignore */ }
  }
  const contentHash = deepseek.translationInputHash(full);
  const hashMismatch = Boolean(translation.contentHash && translation.contentHash !== contentHash);
  const canHash = Boolean(String(full.content || full.summary || '').trim());
  return {
    ...translation,
    stale: Boolean(canHash && hashMismatch),
  };
}

function registerAiAssetRoutes(app, { translationRateLimit = (req, res, next) => next() } = {}) {
  app.get('/api/ai/profiles', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(aiProfilesResponse());
  });

  app.post('/api/ai/profiles', (req, res) => {
    try {
      if (store.listAiProfiles().length >= 30) return res.status(409).json({ error: 'AI 配置最多保存 30 个' });
      const profile = store.saveAiProfile(normalizeProfilePayload(req.body || {}));
      store.saveAiSettings({ activeProfileId: profile.id });
      return res.status(201).json({ profile: publicAiProfile(profile), settings: store.getAiSettings() });
    } catch (error) {
      return sendError(res, error, '保存 AI 配置失败');
    }
  });

  app.put('/api/ai/profiles/:id', (req, res) => {
    try {
      if (!store.getAiProfile(req.params.id)) return res.status(404).json({ error: 'AI 配置不存在' });
      const profile = store.saveAiProfile(normalizeProfilePayload({ ...(req.body || {}), id: req.params.id }));
      return res.json({ profile: publicAiProfile(profile), settings: store.getAiSettings() });
    } catch (error) {
      return sendError(res, error, '保存 AI 配置失败');
    }
  });

  app.delete('/api/ai/profiles/:id', (req, res) => {
    try {
      if (!store.deleteAiProfile(req.params.id)) return res.status(404).json({ error: 'AI 配置不存在' });
      return res.json(aiProfilesResponse());
    } catch (error) {
      return sendError(res, error, '删除 AI 配置失败');
    }
  });

  app.put('/api/ai/settings', (req, res) => {
    try {
      return res.json({ settings: store.saveAiSettings(req.body || {}) });
    } catch (error) {
      return sendError(res, error, '保存 AI 用途配置失败');
    }
  });

  app.post('/api/ai/profiles/import', (req, res) => {
    try {
      if (store.listAiProfiles().length) return res.json(aiProfilesResponse());
      const profiles = Array.isArray(req.body && req.body.profiles) ? req.body.profiles.slice(0, 30) : [];
      const importedIds = new Set();
      for (const raw of profiles) {
        if (!raw || !String(raw.apiKey || '').trim()) continue;
        const saved = store.saveAiProfile(normalizeProfilePayload(raw));
        importedIds.add(saved.id);
      }
      if (importedIds.size) store.saveAiSettings(req.body && req.body.settings || {});
      return res.json(aiProfilesResponse());
    } catch (error) {
      return sendError(res, error, '导入浏览器 AI 配置失败');
    }
  });

  app.post('/api/ai/models', async (req, res) => {
    try {
      const result = await deepseek.listModels(requestAiConfig(req));
      res.json(result);
    } catch (e) {
      sendError(res, e, 'models request failed');
    }
  });

  app.post('/api/ai/test', async (req, res) => {
    try {
      const result = await deepseek.testConnection(requestAiConfig(req));
      res.json(result);
    } catch (e) {
      sendError(res, e, 'AI connection test failed');
    }
  });

  app.get('/api/entry/:id/translation', (req, res) => {
    const entry = fetcher.getEntryById(req.params.id, req.user);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    res.json({ translation: translationResponse(entry, req.user, req.query.assetId) });
  });

  app.post('/api/entry/:id/translation', translationRateLimit, async (req, res) => {
    const entry = fetcher.getEntryById(req.params.id, req.user);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    try {
      const prepared = await withTimeout(
        prepareEntryForAiAsset(entry, 'Translation', { productHuntOfficialSite: false }),
        45_000,
        '译前抓取原文',
      );
      const ai = resolveTranslationAiConfig(req);
      if (!String(ai.apiKey || '').trim()) {
        const err = new Error('未配置 API Key：请在侧栏「AI 设置」填写 DeepSeek 的 Key、Base URL（https://api.deepseek.com/v1）和模型（deepseek-v4-flash）后保存');
        err.statusCode = 503;
        throw err;
      }
      console.log(
        `translation start ${entry.id} provider=${ai.provider || '?'} model=${ai.model || '?'} base=${String(ai.baseUrl || '').slice(0, 48)}`,
      );
      // X/小红书收藏：剥掉 qm-social JSON 头再判英文，避免元数据拉丁字符误判
      const sample = `${prepared.entry.title || ''}\n${prepared.entry.summary || ''}\n${deepseek.stripSocialMetaComment(String(prepared.entry.content || '')).slice(0, 4000)}`;
      if (!deepseek.isLikelyEnglish(sample) && !(req.body && req.body.force)) {
        const err = new Error('当前文章不像英文，未启动翻译');
        err.statusCode = 422;
        throw err;
      }
      const omitQuotes = Array.isArray(req.body && req.body.omitQuotes)
        ? req.body.omitQuotes
        : [];
      const result = await withTimeout(
        deepseek.translateEntry(prepared.entry, {
          ...ai,
          author: req.user.displayName,
          userId: req.user.id,
          force: Boolean(req.body && req.body.force),
          omitQuotes,
        }),
        TRANSLATION_ROUTE_TIMEOUT_MS,
        '翻译',
      );
      res.json({
        ...result,
        translation: translationResponse(prepared.entry, req.user) || result.translation,
        originalFetched: prepared.fetched,
        originalFetchError: prepared.error || null,
        entry: prepared.fetched ? prepared.entry : undefined,
      });
    } catch (e) {
      console.warn(`translation failed for ${entry.id}:`, e.message || e);
      sendError(res, e, 'translation failed');
    }
  });
}

module.exports = {
  registerAiAssetRoutes,
  translationResponse,
};
