const { RATE_LIMIT_MAX_BUCKETS } = require('./config');

function createRateLimiter({ windowMs, max, message, key: keyForRequest = null }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = String(
      typeof keyForRequest === 'function'
        ? keyForRequest(req)
        : (req.ip || req.socket.remoteAddress || 'unknown')
    );
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      if (!bucket && buckets.size >= RATE_LIMIT_MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value);
      }
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= max) return next();
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: message || '请求过于频繁，请稍后再试' });
  };
}

function createAppRateLimiters() {
  return {
    submitLinkRateLimit: createRateLimiter({
      windowMs: 60 * 60 * 1000,
      max: 6,
      message: '每小时最多收录 6 个链接，请稍后再试',
      key: () => 'owner',
    }),
    submitLinkDailyRateLimit: createRateLimiter({
      windowMs: 24 * 60 * 60 * 1000,
      max: 20,
      message: '每天最多收录 20 个链接，请明天再试',
      key: () => 'owner',
    }),
    originalFetchRateLimit: createRateLimiter({
      windowMs: 10 * 60 * 1000,
      max: 20,
      message: '原文抓取过于频繁，请稍后再试',
    }),
    faviconRateLimit: createRateLimiter({
      windowMs: 10 * 60 * 1000,
      max: 240,
      message: '图标请求过于频繁，请稍后再试',
    }),
    translationRateLimit: createRateLimiter({
      windowMs: 10 * 60 * 1000,
      max: 30,
      message: '翻译请求过于频繁，请稍后再试',
    }),
    refreshRateLimit: createRateLimiter({
      windowMs: 10 * 60 * 1000,
      max: 10,
      message: '刷新请求过于频繁，请稍后再试',
    }),
  };
}

module.exports = { createRateLimiter, createAppRateLimiters };
