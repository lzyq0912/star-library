/**
 * 已废弃 · 本仓库仅个人本机形态，无登录 / 无账号系统 / 无鉴权中间件。
 *
 * create-app 不挂载 /api/auth/*、/api/me 等登录路由。
 * 软删、AI、刷新、投稿等一律视为本机所有者操作。
 *
 * 下列 noop 仅保留 require 兼容；业务侧请勿再依赖「登录态」。
 */
function noopAuth(req, res, next) {
  next();
}

module.exports = {
  requireLogin: noopAuth,
  requireAdmin: noopAuth,
  PERSONAL_NO_AUTH: true,
};
