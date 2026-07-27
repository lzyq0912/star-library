const crypto = require('crypto');
const { loadEnv } = require('./env');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

function configurationError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.expose = true;
  error.code = 'APP_ENCRYPTION_KEY_REQUIRED';
  return error;
}

function encryptionKey() {
  loadEnv();
  const raw = String(process.env.APP_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw configurationError('服务器未配置 APP_ENCRYPTION_KEY，暂时不能保存 AI API Key');
  }

  let key = null;
  const value = raw.startsWith('base64:') ? raw.slice(7) : raw;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try { key = Buffer.from(value, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== KEY_BYTES) {
    throw configurationError('APP_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制密钥');
  }
  return key;
}

function additionalData(id, kind, version = 1) {
  return Buffer.from(`qmreader:${version}:${String(kind || '')}:${String(id || '')}`, 'utf8');
}

function encryptSecret(value, { id, kind = 'generic', version = 1 } = {}) {
  const plaintext = String(value || '');
  if (!plaintext) throw new Error('secret value is required');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(additionalData(id, kind, version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    version,
  };
}

function decryptSecret(payload, { id, kind = 'generic' } = {}) {
  if (!payload || !payload.ciphertext || !payload.iv || !payload.authTag) return '';
  const version = Number(payload.version) || 1;
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAAD(additionalData(id, kind, version));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (cause) {
    const error = new Error('无法解密已保存的凭证，请检查 APP_ENCRYPTION_KEY 是否与保存时一致');
    error.statusCode = 503;
    error.expose = true;
    error.code = 'SECRET_DECRYPT_FAILED';
    error.cause = cause;
    throw error;
  }
}

function secretHint(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return `${clean.slice(0, 2)}...${clean.slice(-2)}`;
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

module.exports = {
  decryptSecret,
  encryptSecret,
  encryptionKey,
  secretHint,
};
