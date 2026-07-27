#!/usr/bin/env node
/**
 * 手动同步 b站收藏（稍后再看 + 收藏夹）：
 *   node scripts/import-bili-watchlater.js
 *   node scripts/import-bili-watchlater.js --force        # 默认；绕过指纹
 *   node scripts/import-bili-watchlater.js --no-force
 *   node scripts/import-bili-watchlater.js --no-prune     # 不软删「已离开列表」条目
 *   BILI_COOKIE='SESSDATA=...' node scripts/import-bili-watchlater.js
 *
 * 安全：API 返回空列表且本地仍有条目时，lib 会拒绝 prune（防 cookie/接口异常整库抹掉）。
 */
'use strict';

const bili = require('../lib/bili-watchlater-sync');

function parseArgs(argv) {
  // 手动全量同步默认 force；prune 默认开（可由 --no-prune 关闭）
  let force = true;
  let prune = true;
  for (const a of argv) {
    if (a === '--force') force = true;
    else if (a === '--no-force') force = false;
    else if (a === '--no-prune') prune = false;
  }
  return { force, prune };
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[import-bili-watchlater] profile:', bili.zenProfilePath());
  console.log('[import-bili-watchlater] force:', opts.force, 'prune:', opts.prune);
  try {
    const r = await bili.syncAll({ force: opts.force, prune: opts.prune });
    console.log(
      `[import-bili-watchlater] imported=${r.imported} count=${r.count} skipped=${Boolean(r.skipped)}`
      + ` cookie=${r.cookieSource || '?'}`
      + (r.pruned != null ? ` pruned=${r.pruned}` : '')
      + (r.pruneSkipped ? ` pruneSkipped=${r.pruneSkipped}` : ''),
    );
    if (r.error) console.warn('[import-bili-watchlater] error:', r.error);
  } catch (error) {
    console.error('[import-bili-watchlater] failed:', error.message || error);
    process.exitCode = 1;
  }
})();
