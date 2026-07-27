'use strict';

const dns = require('dns').promises;
const net = require('net');
const { Agent } = require('undici');

function publicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    const err = new Error('原文链接格式不正确');
    err.statusCode = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const err = new Error('只支持 http/https 原文链接');
    err.statusCode = 400;
    throw err;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = host === 'localhost'
    || host.endsWith('.local')
    || isNonPublicIpAddress(host);
  if (blocked) {
    const err = new Error('原文链接不能指向本机或内网地址');
    err.statusCode = 400;
    throw err;
  }
  return url.toString();
}

function isNonPublicIpAddress(value) {
  let address = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice(7);
    if (net.isIP(mapped) === 4) return isNonPublicIpAddress(mapped);
    const hex = mapped.split(':');
    if (hex.length === 2 && hex.every(part => /^[0-9a-f]{1,4}$/i.test(part))) {
      const high = Number.parseInt(hex[0], 16);
      const low = Number.parseInt(hex[1], 16);
      return isNonPublicIpAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }
  const type = net.isIP(address);
  if (!type) return false;
  if (type === 4) {
    const parts = address.split('.').map(Number);
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  return address === '::'
    || address === '::1'
    || /^(?:fc|fd)/i.test(address)
    || /^fe[89ab]/i.test(address)
    || /^ff/i.test(address)
    || /^2001:db8(?::|$)/i.test(address);
}

function requestTimeoutError() {
  const error = new Error('request timed out');
  error.name = 'TimeoutError';
  error.statusCode = 504;
  return error;
}

function remainingDeadlineMs(deadline, now = Date.now) {
  if (!Number.isFinite(deadline)) return 2 ** 31 - 1;
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) throw requestTimeoutError();
  return remaining;
}

async function withDeadline(promise, deadline, now = Date.now) {
  if (!Number.isFinite(deadline)) return promise;
  const remaining = remainingDeadlineMs(deadline, now);
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(requestTimeoutError()), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolvePublicTarget(value, { lookup = dns.lookup, deadline = Infinity, now = Date.now } = {}) {
  const normalized = publicHttpUrl(value);
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await withDeadline(
        Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })),
        deadline,
        now
      );
    } catch (error) {
      if (error && error.name === 'TimeoutError') throw error;
      const err = new Error('原文链接域名无法解析');
      err.statusCode = 422;
      err.cause = error;
      throw err;
    }
  }
  const normalizedAddresses = (Array.isArray(addresses) ? addresses : [addresses])
    .map(item => {
      const address = String(item && item.address || item || '').trim();
      return { address, family: Number(item && item.family) || net.isIP(address) };
    })
    .filter(item => item.address && (item.family === 4 || item.family === 6));
  if (!normalizedAddresses.length || normalizedAddresses.some(item => isNonPublicIpAddress(item.address))) {
    const err = new Error('原文链接不能解析到本机或内网地址');
    err.statusCode = 400;
    throw err;
  }
  return { url: normalized, hostname, addresses: normalizedAddresses };
}

function createPinnedLookup(target) {
  const addresses = (target && target.addresses || []).map(item => ({
    address: item.address,
    family: item.family,
  }));
  return (_hostname, options, callback) => {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    const requestedFamily = Number(opts.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(item => item.family === requestedFamily)
      : addresses;
    if (!candidates.length) {
      const error = new Error('No validated address for requested family');
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }
    if (opts.all) callback(null, candidates.map(item => ({ ...item })));
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

function createPinnedDispatcher(target) {
  return new Agent({
    connect: {
      lookup: createPinnedLookup(target),
    },
  });
}

async function assertPublicHttpUrl(value, options = {}) {
  return (await resolvePublicTarget(value, options)).url;
}

module.exports = {
  isNonPublicIpAddress,
  publicHttpUrl,
  requestTimeoutError,
  remainingDeadlineMs,
  withDeadline,
  resolvePublicTarget,
  createPinnedLookup,
  createPinnedDispatcher,
  assertPublicHttpUrl,
};
