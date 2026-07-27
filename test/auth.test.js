const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-auth-test-'));
process.env.QMREADER_DATA_DIR = tempDir;
process.env.OWNER_USERNAME = 'reader-owner';
process.env.OWNER_PASSWORD = 'correct-horse-battery-staple';
process.env.OWNER_DISPLAY_NAME = 'Reader Owner';
process.env.AUTH_COOKIE_SECURE = '0';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString('base64');
process.env.NODE_ENV = 'test';
process.env.STARTUP_REFRESH_DELAY_MS = '-1';

const store = require('../lib/store');
const { createApp } = require('../modules/create-app');

let server;
let baseUrl;
let ownerCookie;
let secondDeviceCookie;

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.method && !['GET', 'HEAD'].includes(options.method)) headers.Origin = baseUrl;
  return fetch(`${baseUrl}${pathname}`, {
    redirect: 'manual',
    ...options,
    headers,
  });
}

async function login(password = process.env.OWNER_PASSWORD) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.OWNER_USERNAME, password }),
  });
  return response;
}

before(async () => {
  store.upsertEntries([{
    id: 'auth-state-entry',
    sourceId: 'test',
    title: 'Persistent state',
    link: 'https://example.com/persistent-state',
    published: new Date().toISOString(),
    publishedTs: Date.now(),
    summary: '',
    content: '<p>body</p>',
  }]);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  store.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('all reader content is private while login and favicon remain reachable', async () => {
  const apiResponse = await request('/api/sources');
  assert.equal(apiResponse.status, 401);
  assert.equal((await apiResponse.json()).code, 'AUTH_REQUIRED');

  const pageResponse = await request('/', { headers: { Accept: 'text/html' } });
  assert.equal(pageResponse.status, 302);
  assert.match(pageResponse.headers.get('location'), /^\/login\?next=/);

  const loginResponse = await request('/login');
  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await loginResponse.text(), /回到你的阅读空间/);

  const faviconResponse = await request('/favicon.svg');
  assert.equal(faviconResponse.status, 200);
});

test('owner login creates an HttpOnly session and rejects an invalid password', async () => {
  const rejected = await login('not-the-owner-password');
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error, '用户名或密码不正确');

  const accepted = await login();
  assert.equal(accepted.status, 200);
  const setCookie = accepted.headers.get('set-cookie') || '';
  assert.match(setCookie, /qmreader_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  ownerCookie = cookieFrom(accepted);

  const me = await request('/api/me', { cookie: ownerCookie });
  assert.equal(me.status, 200);
  const payload = await me.json();
  assert.equal(payload.user.username, 'reader-owner');
  assert.equal(payload.user.role, 'admin');
});

test('favorites, read state, and history persist for a second device', async () => {
  const stateWrite = await request('/api/me/entry-states/auth-state-entry', {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred: true, read: true }),
  });
  assert.equal(stateWrite.status, 200);

  const viewWrite = await request('/api/entry/auth-state-entry/view', {
    method: 'POST',
    cookie: ownerCookie,
  });
  assert.equal(viewWrite.status, 200);

  const secondLogin = await login();
  assert.equal(secondLogin.status, 200);
  secondDeviceCookie = cookieFrom(secondLogin);

  const statesResponse = await request('/api/me/entry-states', { cookie: secondDeviceCookie });
  assert.equal(statesResponse.status, 200);
  const { states } = await statesResponse.json();
  assert.deepEqual(states.starred, ['auth-state-entry']);
  assert.deepEqual(states.read, ['auth-state-entry']);
  assert.equal(states.history[0].entryId, 'auth-state-entry');
  assert.ok(states.history[0].viewedAt > 0);
});

test('AI profiles are encrypted server-side and visible from a second device without plaintext keys', async () => {
  const createdResponse = await request('/api/ai/profiles', {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'ai-auth-route-profile',
      name: 'Cross-device model',
      provider: 'custom',
      providerName: 'Gateway',
      providerType: 'openai_compatible',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'reader-chat',
      apiKey: 'sk-route-secret-value',
      isDefault: true,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const createdText = await createdResponse.text();
  assert.doesNotMatch(createdText, /sk-route-secret-value/);
  assert.doesNotMatch(createdText, /credentialId/);
  const created = JSON.parse(createdText);
  assert.equal(created.profile.hasApiKey, true);
  assert.match(created.profile.apiKeyMasked, /\.\.\./);

  const updateResponse = await request(`/api/ai/profiles/${created.profile.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...created.profile,
      name: 'Cross-device model updated',
      apiKey: '',
    }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal(store.getAiProfileConfig(created.profile.id).apiKey, 'sk-route-secret-value');

  const secondDeviceResponse = await request('/api/ai/profiles', { cookie: secondDeviceCookie });
  assert.equal(secondDeviceResponse.status, 200);
  const secondDeviceText = await secondDeviceResponse.text();
  assert.doesNotMatch(secondDeviceText, /sk-route-secret-value|credentialId/);
  const secondDevice = JSON.parse(secondDeviceText);
  assert.equal(secondDevice.profiles[0].name, 'Cross-device model updated');
  assert.equal(secondDevice.secretStorageReady, true);
});

test('logout revokes only the current device session', async () => {
  const logoutResponse = await request('/api/auth/logout', {
    method: 'POST',
    cookie: ownerCookie,
  });
  assert.equal(logoutResponse.status, 200);

  const revoked = await request('/api/me', { cookie: ownerCookie });
  assert.equal(revoked.status, 401);

  const secondDevice = await request('/api/me', { cookie: secondDeviceCookie });
  assert.equal(secondDevice.status, 200);
});
