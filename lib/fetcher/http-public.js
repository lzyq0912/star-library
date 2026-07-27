'use strict';

/**
 * 公网 HTTP 拉取层：undici + pinned dispatcher，无 cache/state。
 * hnrss 限速槽位经 dependencies.waitForHnrssRequestSlot 注入（默认 no-op）。
 */

const { fetch: undiciFetch } = require('undici');
const {
  publicHttpUrl,
  requestTimeoutError,
  remainingDeadlineMs,
  withDeadline,
  resolvePublicTarget,
  createPinnedDispatcher,
} = require('./net-safety');
const { decodeResponseBuffer } = require('./text-codec');

const TIMEOUT_MS = 20000;
const MAX_TEXT_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_RESPONSE_BYTES = 3 * 1024 * 1024;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isHnrssUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase() === 'hnrss.org';
  } catch {
    return false;
  }
}

async function cancelResponseBody(response) {
  try { await response?.body?.cancel(); } catch { /* connection is already closed */ }
}

async function readResponseBuffer(response, maxBytes = MAX_TEXT_RESPONSE_BYTES) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    const error = new Error(`Response too large (${contentLength} bytes)`);
    error.statusCode = 413;
    throw error;
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      const error = new Error(`Response too large (>${maxBytes} bytes)`);
      error.statusCode = 413;
      throw error;
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let readerCancelled = false;
  const cancelReader = async () => {
    if (readerCancelled) return;
    readerCancelled = true;
    await reader.cancel().catch(() => {});
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelReader();
        const error = new Error(`Response too large (>${maxBytes} bytes)`);
        error.statusCode = 413;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await cancelReader();
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function closeDispatcher(dispatcher, error = null) {
  if (!dispatcher) return;
  try {
    if (error && typeof dispatcher.destroy === 'function') dispatcher.destroy(error);
    else if (typeof dispatcher.close === 'function') await dispatcher.close();
  } catch { /* the request already tore down the dispatcher */ }
}

async function fetchPublicBuffer(startUrl, options = {}, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const resolveTarget = dependencies.resolvePublicTarget || resolvePublicTarget;
  const createDispatcher = dependencies.createDispatcher || createPinnedDispatcher;
  const fetchImpl = dependencies.fetch || undiciFetch;
  const deadline = Number.isFinite(options.deadline)
    ? options.deadline
    : now() + (Number.isFinite(options.timeout) ? options.timeout : TIMEOUT_MS);
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_TEXT_RESPONSE_BYTES;
  const maxRedirects = Number.isFinite(options.maxRedirects) ? Math.max(0, options.maxRedirects) : 6;
  let current = publicHttpUrl(startUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    remainingDeadlineMs(deadline, now);
    const target = await resolveTarget(current, { deadline, now });
    const dispatcher = createDispatcher(target);
    let response;
    try {
      response = await fetchImpl(target.url, {
        headers: options.headers || BROWSER_HEADERS,
        signal: AbortSignal.timeout(remainingDeadlineMs(deadline, now)),
        redirect: 'manual',
        dispatcher,
      });
    } catch (error) {
      await closeDispatcher(dispatcher, error);
      throw error;
    }

    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      await closeDispatcher(dispatcher);
      if (redirectCount >= maxRedirects) throw new Error('too many redirects');
      current = publicHttpUrl(new URL(location, target.url).toString());
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      await closeDispatcher(dispatcher);
      return { url: target.url, status: response.status, headers: response.headers, buffer: Buffer.alloc(0) };
    }

    try {
      const buffer = await readResponseBuffer(response, maxBytes);
      return { url: target.url, status: response.status, headers: response.headers, buffer };
    } finally {
      await closeDispatcher(dispatcher);
    }
  }
  throw new Error('too many redirects');
}

function safeRasterMimeType(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1 && buffer.readUInt16LE(4) > 0) return 'image/x-icon';
  return '';
}

function rasterExtFromBuffer(buffer, contentType = '', url = '') {
  const mime = safeRasterMimeType(buffer);
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png')) return 'png';
  if (type.includes('image/jpeg')) return 'jpg';
  if (type.includes('image/webp')) return 'webp';
  if (type.includes('image/gif')) return 'gif';
  const fromUrl = /\.(png|jpe?g|gif|webp)(?:$|\?)/i.exec(String(url || ''));
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  return '';
}

function retryDelayMs(response, attempt, now = Date.now()) {
  const raw = String(response && response.headers && response.headers.get('retry-after') || '').trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return 300 * (2 ** attempt) + Math.floor(Math.random() * 150);
}

async function sleepWithinDeadline(delay, deadline, { now = Date.now, sleepFn = sleep } = {}) {
  if (delay <= 0) return;
  const remaining = remainingDeadlineMs(deadline, now);
  if (delay >= remaining) throw requestTimeoutError();
  await withDeadline(Promise.resolve().then(() => sleepFn(delay)), deadline, now);
  remainingDeadlineMs(deadline, now);
}

/**
 * 文本拉取 + 重试。hnrss 限速默认 no-op；门面注入 waitForHnrssRequestSlot。
 */
async function fetchText(url, timeout = TIMEOUT_MS, maxBytes = MAX_TEXT_RESPONSE_BYTES, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const request = dependencies.request || fetchPublicBuffer;
  const waitForSlot = dependencies.waitForHnrssRequestSlot || (async () => {});
  const sleepFn = dependencies.sleep || sleep;
  const headers = dependencies.headers || BROWSER_HEADERS;
  const checkHnrss = dependencies.isHnrssUrl || isHnrssUrl;
  const deadline = now() + timeout;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response = null;
    try {
      remainingDeadlineMs(deadline, now);
      if (checkHnrss(url)) {
        await withDeadline(Promise.resolve().then(() => waitForSlot()), deadline, now);
        remainingDeadlineMs(deadline, now);
      }
      response = await request(url, {
        deadline,
        headers,
        maxBytes,
        maxRedirects: 6,
      });
      if (response.status >= 200 && response.status < 300) return decodeResponseBuffer(response.buffer, response.headers);
      const error = new Error(`Status code ${response.status}`);
      error.statusCode = response.status;
      error.response = response;
      throw error;
    } catch (error) {
      lastError = error;
      const status = Number(error && error.statusCode) || 0;
      const retryable = status === 408 || status === 429 || status >= 500
        || (!status && (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError));
      if (!retryable || attempt >= 1) throw error;
      await sleepWithinDeadline(retryDelayMs(error.response, attempt, now()), deadline, { now, sleepFn });
    }
  }
  throw lastError || new Error('request failed');
}

module.exports = {
  TIMEOUT_MS,
  MAX_TEXT_RESPONSE_BYTES,
  MAX_HTML_RESPONSE_BYTES,
  BROWSER_HEADERS,
  sleep,
  isHnrssUrl,
  cancelResponseBody,
  readResponseBuffer,
  closeDispatcher,
  fetchPublicBuffer,
  safeRasterMimeType,
  rasterExtFromBuffer,
  retryDelayMs,
  sleepWithinDeadline,
  fetchText,
};
