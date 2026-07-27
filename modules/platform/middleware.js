const express = require('express');
const compression = require('compression');

function applyCoreMiddleware(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!unsafe) return next();
    if (String(req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
      return res.status(403).json({ error: '拒绝跨站操作' });
    }
    const origin = String(req.get('origin') || '').trim();
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) {
          return res.status(403).json({ error: '拒绝跨站操作' });
        }
      } catch {
        return res.status(403).json({ error: '请求来源无效' });
      }
      return next();
    }
    const referer = String(req.get('referer') || '').trim();
    if (referer) {
      try {
        if (new URL(referer).host !== req.get('host')) {
          return res.status(403).json({ error: '拒绝跨站操作' });
        }
      } catch {
        return res.status(403).json({ error: '请求来源无效' });
      }
      return next();
    }
    const site = String(req.get('sec-fetch-site') || '').toLowerCase();
    if (site === 'same-origin' || site === 'same-site' || site === 'none') {
      return next();
    }
    if (String(req.get('cookie') || '').trim()) {
      return res.status(403).json({ error: '拒绝不明来源操作' });
    }
    // 无 Origin / 无 Cookie：仅对本机 Host 放宽（本机 curl）；公网 Host 拒绝
    const hostHeader = String(req.get('host') || '').trim().toLowerCase();
    let hostOnly = hostHeader;
    if (hostHeader.startsWith('[')) {
      const end = hostHeader.indexOf(']');
      hostOnly = end >= 0 ? hostHeader.slice(1, end) : hostHeader;
    } else {
      hostOnly = hostHeader.split(':')[0];
    }
    if (hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly === '::1') {
      return next();
    }
    return res.status(403).json({ error: '拒绝不明来源操作' });
  });
}

module.exports = { applyCoreMiddleware };
