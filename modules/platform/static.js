const express = require('express');
const path = require('path');
const fs = require('fs');
const likesSync = require('../../lib/likes-sync');
const xhsKbSync = require('../../lib/xhs-kb-sync');
const {
  PUBLIC_DIR,
  KATEX_DIST_PATH,
  DOMPURIFY_PATH,
  DOMPURIFY_VERSION,
} = require('../shared/config');

function setStaticMediaHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800');
}

function mountLikesMedia(app, mountPath, rootDir, label) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    console.warn(`[likes-media] skip ${label}: missing ${rootDir}`);
    return;
  }
  app.use(mountPath, express.static(rootDir, {
    maxAge: '7d',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=604800');
    },
  }));
  console.log(`[likes-media] ${label} → ${mountPath} ⇐ ${rootDir}`);
}

/** 热路径媒体静态挂载（个人模式无 session；尽早 serve 避免进后续中间件） */
function mountPreSessionStatic(app) {
  app.use('/article-images', express.static(path.join(PUBLIC_DIR, 'article-images'), {
    maxAge: '7d',
    setHeaders: setStaticMediaHeaders,
  }));
  app.use('/source-icons', express.static(path.join(PUBLIC_DIR, 'source-icons'), {
    maxAge: '7d',
    setHeaders: setStaticMediaHeaders,
  }));
  app.use('/vendor/katex', express.static(KATEX_DIST_PATH, {
    immutable: true,
    maxAge: '365d',
    setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
  }));
  mountLikesMedia(app, '/likes-media/xhs', likesSync.XHS_ROOT, 'xhs');
  mountLikesMedia(app, '/likes-media/x', likesSync.X_ROOT, 'x');
  mountLikesMedia(app, xhsKbSync.MEDIA_MOUNT, xhsKbSync.KB_ROOT, 'xhs-kb');

  app.get('/purify.min.js', (req, res) => {
    const versioned = String(req.query.v || '') === DOMPURIFY_VERSION;
    res.setHeader('Cache-Control', versioned
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/javascript').sendFile(DOMPURIFY_PATH);
  });
  app.get('/favicon.svg', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/svg+xml').sendFile(path.join(PUBLIC_DIR, 'favicon.svg'));
  });
  app.get('/favicon.ico', (req, res) => {
    res.redirect(302, '/favicon.svg');
  });
}

/** Session 后：SPA 静态资源 */
function mountPublicStatic(app) {
  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (file.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.min\.(?:css|js)$/.test(file)) {
        // Minified bundles are referenced from index.html with a content-hash
        // ?v= query. The hash changes whenever content changes, so each URL is
        // immutable by construction and can be cached long-term.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (/\.(?:css|js)$/.test(file)) {
        // app.js/styles.css are stable filenames that change in place. Marking a
        // query-string version immutable made reused v=N URLs stale for a year.
        // Always revalidate these small runtime assets; ETag still avoids bytes
        // when their content is unchanged.
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?)$/.test(file)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));
}

module.exports = { mountPreSessionStatic, mountPublicStatic, PUBLIC_DIR };
