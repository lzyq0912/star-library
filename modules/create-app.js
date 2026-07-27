/**
 * Composition root — personal-mode monolith.
 * Registers platform → SEO → public static → API slices.
 */
const express = require('express');
const { createAppRateLimiters } = require('./shared/rate-limit');
const { applyCoreMiddleware } = require('./platform/middleware');
const { mountPreSessionStatic, mountPublicStatic } = require('./platform/static');
const { attachAuth, registerAuthRoutes, requireLogin } = require('./platform/auth');
const { registerSeoRoutes } = require('./seo/register');
const { registerCatalogRoutes } = require('./slices/catalog');
const { registerAiAssetRoutes } = require('./slices/ai-assets');
const { registerAdminRoutes } = require('./slices/admin');
const { sendError } = require('./shared/http');

function createApp() {
  const app = express();
  const rateLimiters = createAppRateLimiters();

  applyCoreMiddleware(app);
  app.use(attachAuth);
  registerAuthRoutes(app, { loginRateLimit: rateLimiters.loginRateLimit });
  app.use(requireLogin);

  mountPreSessionStatic(app);

  registerSeoRoutes(app, { faviconRateLimit: rateLimiters.faviconRateLimit });
  mountPublicStatic(app);

  // API vertical slices
  registerCatalogRoutes(app, {
    submitLinkRateLimit: rateLimiters.submitLinkRateLimit,
    submitLinkDailyRateLimit: rateLimiters.submitLinkDailyRateLimit,
    originalFetchRateLimit: rateLimiters.originalFetchRateLimit,
  });
  registerAdminRoutes(app, {
    refreshRateLimit: rateLimiters.refreshRateLimit,
  });
  registerAiAssetRoutes(app, {
    translationRateLimit: rateLimiters.translationRateLimit,
  });

  // Express 4 参数错误中间件：未捕获的 next(err) 统一走 sendError
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    sendError(res, err);
  });

  return app;
}

module.exports = { createApp };
