function originalFetchPublicError(error) {
  if (error && error.code === 'ORIGINAL_FETCH_FAILED' && error.expose) return error;

  const raw = String(error && error.message || error || '');
  const status = Number(error && error.statusCode) || 0;
  let message = '原文获取失败，请稍后重试';
  let statusCode = status >= 400 && status < 500 ? status : 502;

  if (/Timeout|timed out|aborted|operation was aborted|request timeout/i.test(raw)) {
    message = '原网站在 30 秒内没有响应，请稍后重试';
    statusCode = 504;
  } else if (status === 401 || status === 403) {
    message = `原网站拒绝匿名访问（HTTP ${status}），请直接打开原文`;
    statusCode = 422;
  } else if (status === 404) {
    message = '原文页面不存在或已经下线（HTTP 404）';
    statusCode = 422;
  } else if (status === 429) {
    message = '原网站请求过于频繁，请稍后重试（HTTP 429）';
    statusCode = 429;
  } else if (status >= 500) {
    message = `原网站暂时不可用（HTTP ${status}），请稍后重试`;
    statusCode = 502;
  } else if (/ENOTFOUND|EAI_AGAIN|无法解析|DNS/i.test(raw)) {
    message = '服务器无法解析原网站域名，请稍后重试';
    statusCode = 502;
  } else if (/ECONN|socket|network|fetch failed/i.test(raw)) {
    message = '服务器连接原网站失败，请稍后重试';
    statusCode = 502;
  } else if (/没有从原文页面提取到可用正文/i.test(raw)) {
    message = '网页可以访问，但没有识别到可用正文；请直接打开原文';
    statusCode = 422;
  } else if (/内网地址|不允许访问|public HTTP/i.test(raw)) {
    message = '该原文地址不允许由服务器抓取';
    statusCode = 422;
  }

  const safe = new Error(message);
  safe.statusCode = statusCode;
  safe.expose = true;
  safe.code = 'ORIGINAL_FETCH_FAILED';
  return safe;
}

module.exports = { originalFetchPublicError };
