const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-ai-request-'));
process.env.QMREADER_DATA_DIR = testDataDir;
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const store = require('../lib/store');
const { requestAiConfig } = require('../lib/request-ai-config');

after(() => {
  store.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function request(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    get(name) {
      return normalized[name.toLowerCase()] || '';
    },
  };
}

test('requests without a profile ignore legacy client-owned AI headers', () => {
  const config = requestAiConfig(request({
    'x-ai-key': 'caller-owned-test-key',
    'x-ai-provider': 'attacker-provider',
    'x-ai-base-url': 'https://attacker.example/v1',
    'x-ai-model': 'attacker-model',
    'x-ai-temperature': '2',
    'x-ai-max-tokens': '32768',
  }));

  assert.deepEqual(config, {
    profileId: '',
    apiKey: '',
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    baseUrl: '',
    model: 'deepseek-v4-flash',
    temperature: '',
    maxTokens: '',
  });
});

test('profile ID resolves the encrypted server-side configuration', () => {
  const saved = store.saveAiProfile({
    id: 'ai-profile-request-test',
    name: 'Request test',
    provider: 'custom',
    providerName: 'Gateway',
    baseUrl: 'https://gateway.example/v1',
    model: 'reader-model',
    apiKey: 'server-encrypted-key',
    temperature: 0.4,
    maxTokens: 1200,
  });

  const config = requestAiConfig(request({ 'x-ai-profile-id': saved.id }));
  assert.equal(config.apiKey, 'server-encrypted-key');
  assert.equal(config.provider, 'custom');
  assert.equal(config.baseUrl, 'https://gateway.example/v1');
  assert.equal(config.model, 'reader-model');
  assert.equal(config.maxTokens, 1200);
});

test('unknown profile ID is rejected', () => {
  assert.throws(
    () => requestAiConfig(request({ 'x-ai-profile-id': 'ai-profile-missing' })),
    error => error.statusCode === 404 && /不存在/.test(error.message),
  );
});
