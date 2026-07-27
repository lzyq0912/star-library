const { HTML_ESCAPES } = require('./config');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

function safeJsonForHtml(value) {
  const escapes = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => escapes[char]);
}

function sendError(res, error, fallback = 'request failed') {
  const status = Number(error && error.statusCode) || 500;
  if (status >= 500 && !(error && error.expose)) {
    // 5xx：完整 error 只打日志，响应体不泄内部 message（路径/栈）
    console.error('[sendError]', status, error);
    res.status(status).json({ error: fallback || 'request failed' });
    return;
  }
  const message = (error && error.message) || fallback;
  res.status(status).json({ error: message });
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function splitSseText(text) {
  const clean = String(text || '');
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += 44) chunks.push(clean.slice(i, i + 44));
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function plainText(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryPlainText(entry) {
  const official = entry && entry.officialSiteContext;
  return plainText([
    entry && (entry.content || entry.summary),
    official && official.title,
    official && official.summary,
    official && official.content,
  ].filter(Boolean).join('\n\n'));
}

function requestAuthor() {
  return '我';
}

function notifyTarget() {}

module.exports = {
  escapeHtml,
  safeJsonForHtml,
  sendError,
  writeSse,
  splitSseText,
  sleep,
  plainText,
  entryPlainText,
  requestAuthor,
  notifyTarget,
};
