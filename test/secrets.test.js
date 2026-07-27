const test = require('node:test');
const assert = require('node:assert/strict');

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');

const {
  decryptSecret,
  encryptSecret,
  encryptionKey,
  secretHint,
} = require('../lib/secrets');

test('AES-GCM secret roundtrip is bound to credential identity', () => {
  const encrypted = encryptSecret('sk-private-value', { id: 'credential-one', kind: 'ai-api-key' });
  assert.notEqual(encrypted.ciphertext, 'sk-private-value');
  assert.equal(
    decryptSecret(encrypted, { id: 'credential-one', kind: 'ai-api-key' }),
    'sk-private-value',
  );
  assert.throws(
    () => decryptSecret(encrypted, { id: 'credential-two', kind: 'ai-api-key' }),
    error => error.code === 'SECRET_DECRYPT_FAILED' && error.statusCode === 503,
  );
});

test('changing the application encryption key cannot decrypt existing values', () => {
  const firstKey = Buffer.alloc(32, 13).toString('base64');
  const secondKey = Buffer.alloc(32, 17).toString('base64');
  process.env.APP_ENCRYPTION_KEY = firstKey;
  const encrypted = encryptSecret('saved-before-key-change', { id: 'credential-key-change', kind: 'ai-api-key' });
  process.env.APP_ENCRYPTION_KEY = secondKey;
  assert.throws(
    () => decryptSecret(encrypted, { id: 'credential-key-change', kind: 'ai-api-key' }),
    error => error.code === 'SECRET_DECRYPT_FAILED',
  );
  process.env.APP_ENCRYPTION_KEY = firstKey;
  assert.equal(
    decryptSecret(encrypted, { id: 'credential-key-change', kind: 'ai-api-key' }),
    'saved-before-key-change',
  );
});

test('encryption key validation and secret hints expose no plaintext', () => {
  const valid = Buffer.alloc(32, 19).toString('base64');
  process.env.APP_ENCRYPTION_KEY = valid;
  assert.equal(encryptionKey().length, 32);
  assert.equal(secretHint('sk-1234567890-secret'), 'sk-1...cret');

  process.env.APP_ENCRYPTION_KEY = 'too-short';
  assert.throws(
    () => encryptionKey(),
    error => error.code === 'APP_ENCRYPTION_KEY_REQUIRED' && error.statusCode === 503,
  );
  process.env.APP_ENCRYPTION_KEY = valid;
});
