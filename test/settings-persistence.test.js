const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-settings-'));
process.env.QMREADER_DATA_DIR = testDataDir;
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');

const store = require('../lib/store');
const { originalFetchPublicError } = require('../modules/slices/catalog');

after(() => {
  store.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('custom subscriptions persist their feed metadata and enabled state', () => {
  const saved = store.saveCustomSource({
    id: 'custom-settings-feed',
    name: 'Reader engineering',
    feedUrl: 'https://example.com/feed.xml',
    siteUrl: 'https://example.com/',
    category: 'article',
    description: 'A test feed',
    refreshIntervalMs: 900000,
    enabled: true,
  });
  assert.equal(saved.feedUrl, 'https://example.com/feed.xml');
  assert.equal(store.listCustomSources().length, 1);

  assert.equal(store.setCustomSourceEnabled(saved.id, false).enabled, false);
  assert.equal(store.getCustomSource(saved.id).enabled, false);
  assert.equal(store.deleteCustomSource(saved.id), true);
  assert.equal(store.getCustomSource(saved.id), null);
});

test('AI profiles return only a mask while metadata updates preserve the encrypted key', () => {
  const created = store.saveAiProfile({
    id: 'ai-settings-primary',
    name: 'Primary model',
    provider: 'deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-settings-persistence-secret',
    isDefault: true,
  });
  assert.equal(created.hasApiKey, true);
  assert.match(created.apiKeyMasked, /^sk-s/);
  assert.equal(Object.hasOwn(created, 'apiKey'), false);
  assert.equal(store.getAiProfileConfig(created.id).apiKey, 'sk-settings-persistence-secret');

  const updated = store.saveAiProfile({
    ...created,
    name: 'Primary model updated',
    model: 'deepseek-reasoner',
    apiKey: '',
  });
  assert.equal(updated.name, 'Primary model updated');
  assert.equal(updated.hasApiKey, true);
  assert.equal(store.getAiProfileConfig(created.id).apiKey, 'sk-settings-persistence-secret');
});

test('AI purpose bindings persist and fall back after profile deletion', () => {
  const secondary = store.saveAiProfile({
    id: 'ai-settings-secondary',
    name: 'Secondary model',
    provider: 'custom',
    providerName: 'Secondary',
    baseUrl: 'https://models.example.com/v1',
    model: 'secondary-chat',
    apiKey: 'secondary-secret',
  });
  const primary = store.getAiProfile('ai-settings-primary');
  const settings = store.saveAiSettings({
    activeProfileId: primary.id,
    translationProfileId: primary.id,
    rewriteProfileId: secondary.id,
    agentProfileId: secondary.id,
  });
  assert.equal(settings.rewriteProfileId, secondary.id);
  assert.equal(store.getAiProfileConfigForPurpose('agent').apiKey, 'secondary-secret');

  assert.equal(store.deleteAiProfile(secondary.id), true);
  const fallback = store.getAiSettings();
  assert.equal(fallback.rewriteProfileId, primary.id);
  assert.equal(fallback.agentProfileId, primary.id);
});

test('original fetch failures map to useful messages without leaking internals', () => {
  const timeout = originalFetchPublicError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  assert.equal(timeout.statusCode, 504);
  assert.match(timeout.message, /30 秒/);
  assert.equal(timeout.expose, true);

  const forbidden = new Error('Status code 403');
  forbidden.statusCode = 403;
  assert.match(originalFetchPublicError(forbidden).message, /拒绝匿名访问/);

  const extraction = new Error('没有从原文页面提取到可用正文');
  extraction.statusCode = 422;
  assert.match(originalFetchPublicError(extraction).message, /没有识别到可用正文/);

  const internal = originalFetchPublicError(new Error('/private/server/path ECONNRESET'));
  assert.equal(internal.message.includes('/private/server/path'), false);
  assert.match(internal.message, /连接原网站失败/);
});
