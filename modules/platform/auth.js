const store = require('../../lib/store');
const { escapeHtml, sendError } = require('../shared/http');

const SESSION_COOKIE = 'qmreader_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      out[key] = '';
    }
  }
  return out;
}

function sessionToken(req) {
  return parseCookies(req.get('cookie'))[SESSION_COOKIE] || '';
}

function cookieIsSecure(req) {
  const configured = String(process.env.AUTH_COOKIE_SECURE || '').trim();
  if (configured === '1') return true;
  if (configured === '0') return false;
  return process.env.NODE_ENV === 'production' || Boolean(req.secure);
}

function setSessionCookie(req, res, session) {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: cookieIsSecure(req),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, session.expiresAt - Date.now()),
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: cookieIsSecure(req),
    sameSite: 'lax',
    path: '/',
  });
}

function safeNextPath(value) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  if (path === '/login' || path.startsWith('/api/auth/')) return '/';
  return path.slice(0, 2048);
}

function attachAuth(req, res, next) {
  const token = sessionToken(req);
  req.sessionToken = token;
  req.user = token ? store.getUserBySessionToken(token) : null;
  next();
}

function wantsHtml(req) {
  return req.method === 'GET'
    && !req.path.startsWith('/api/')
    && String(req.get('accept') || '').includes('text/html');
}

function requireLogin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (wantsHtml(req)) {
    const nextPath = safeNextPath(req.originalUrl || '/');
    return res.redirect(302, `/login?next=${encodeURIComponent(nextPath)}`);
  }
  return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(req.user ? 403 : 401).json({
    error: req.user ? '没有权限执行此操作' : '请先登录',
    code: req.user ? 'FORBIDDEN' : 'AUTH_REQUIRED',
  });
}

function configuredOwner() {
  const username = String(process.env.OWNER_USERNAME || '').trim();
  const password = String(process.env.OWNER_PASSWORD || '');
  const displayName = String(process.env.OWNER_DISPLAY_NAME || username || 'Owner').trim();
  if (!username || !password) {
    throw new Error(
      'Missing OWNER_USERNAME or OWNER_PASSWORD. Configure the fixed owner account before starting QMReader.',
    );
  }
  return store.ensureOwnerUser({ username, password, displayName });
}

function loginPage({ nextPath = '/', error = '', username = '' } = {}) {
  const safeNext = safeNextPath(nextPath);
  const errorHtml = error
    ? `<p class="login-error" role="alert">${escapeHtml(error)}</p>`
    : '<p class="login-error" aria-live="polite"></p>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>登录 · QMReader</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      color-scheme: light dark;
      --paper: #f4f5f1;
      --surface: #fbfcf8;
      --ink: #191b18;
      --muted: #656a63;
      --line: #d7dbd2;
      --accent: #265c43;
      --accent-ink: #f7fbf7;
      --error: #a63d32;
      --focus: rgba(38, 92, 67, 0.22);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--paper);
      color: var(--ink);
      font-family: "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
    }
    main {
      width: min(100%, 380px);
      display: grid;
      gap: 42px;
    }
    header { display: grid; gap: 18px; }
    .brand {
      width: 38px;
      aspect-ratio: 1;
      display: grid;
      place-items: center;
      border-radius: 6px;
      background: var(--ink);
      color: var(--surface);
      font: 800 18px/1 Georgia, "Songti SC", serif;
    }
    h1 {
      margin: 0;
      max-width: 12ch;
      font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif;
      font-size: 31px;
      font-weight: 650;
      line-height: 1.2;
      letter-spacing: 0;
    }
    form { display: grid; gap: 17px; }
    label {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--ink);
      padding: 10px 12px;
      font: inherit;
      font-size: 15px;
      outline: none;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--focus);
    }
    button {
      min-height: 44px;
      margin-top: 4px;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: var(--accent-ink);
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
    }
    button:hover { background: color-mix(in srgb, var(--accent) 88%, var(--ink)); }
    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .login-error {
      min-height: 20px;
      margin: -4px 0 0;
      color: var(--error);
      font-size: 13px;
      line-height: 1.5;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #111310;
        --surface: #191c18;
        --ink: #eff2eb;
        --muted: #a2a89f;
        --line: #353a33;
        --accent: #9dc9ab;
        --accent-ink: #102016;
        --error: #f09a8f;
        --focus: rgba(157, 201, 171, 0.2);
      }
    }
    @media (max-width: 480px) {
      body { place-items: start center; padding: 12vh 20px 28px; }
      main { gap: 34px; }
      h1 { font-size: 27px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand" aria-hidden="true">R</div>
      <h1>回到你的阅读空间</h1>
    </header>
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
      <label>用户名
        <input name="username" value="${escapeHtml(username)}" autocomplete="username" required autofocus />
      </label>
      <label>密码
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      ${errorHtml}
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function setLoginPageHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function login(req, res, { json = false } = {}) {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  const nextPath = safeNextPath((req.body && req.body.next) || '/');
  try {
    const user = store.authenticateOwner(username, password);
    const session = store.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(req, res, session);
    if (json) return res.json({ user, expiresAt: session.expiresAt });
    return res.redirect(303, nextPath);
  } catch (error) {
    if (json) return sendError(res, error, '登录失败');
    setLoginPageHeaders(res);
    return res.status(Number(error.statusCode) || 401).type('html').send(loginPage({
      nextPath,
      error: Number(error.statusCode) >= 500 ? '登录失败，请稍后重试' : error.message,
      username,
    }));
  }
}

function registerAuthRoutes(app, { loginRateLimit = (req, res, next) => next() } = {}) {
  const owner = configuredOwner();

  app.get('/favicon.svg', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/svg+xml').sendFile(require('path').join(__dirname, '..', '..', 'public', 'favicon.svg'));
  });
  app.get('/robots.txt', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/login', (req, res) => {
    if (req.user && req.user.role === 'admin') return res.redirect(302, safeNextPath(req.query.next));
    setLoginPageHeaders(res);
    return res.type('html').send(loginPage({ nextPath: req.query.next, username: owner.username }));
  });
  app.post('/login', loginRateLimit, (req, res) => login(req, res));
  app.post('/api/auth/login', loginRateLimit, (req, res) => login(req, res, { json: true }));
  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) store.deleteSession(req.sessionToken);
    clearSessionCookie(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  app.get('/api/me', requireLogin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: req.user });
  });
  app.get('/api/me/entry-states', requireLogin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ states: store.getUserEntryStates(req.user.id) });
  });
  app.patch('/api/me/entry-states/:id', requireLogin, (req, res) => {
    try {
      const patch = {};
      for (const key of ['read', 'starred', 'viewed']) {
        if (typeof (req.body && req.body[key]) === 'boolean') patch[key] = req.body[key];
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: '没有可更新的状态' });
      return res.json({ state: store.setUserEntryState(req.user.id, req.params.id, patch) });
    } catch (error) {
      return sendError(res, error, '保存文章状态失败');
    }
  });
  app.post('/api/me/entry-states/read', requireLogin, (req, res) => {
    try {
      const entryIds = Array.isArray(req.body && req.body.entryIds) ? req.body.entryIds : [];
      return res.json({ states: store.markEntriesRead(req.user.id, entryIds) });
    } catch (error) {
      return sendError(res, error, '保存已读状态失败');
    }
  });
  app.post('/api/me/entry-states/import', requireLogin, (req, res) => {
    try {
      return res.json({ states: store.mergeUserEntryStates(req.user.id, req.body || {}) });
    } catch (error) {
      return sendError(res, error, '导入本地阅读状态失败');
    }
  });

  return owner;
}

module.exports = {
  SESSION_COOKIE,
  attachAuth,
  configuredOwner,
  registerAuthRoutes,
  requireLogin,
  requireAdmin,
  safeNextPath,
};
