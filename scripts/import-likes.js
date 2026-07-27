#!/usr/bin/env node
/**
 * 导入本地小红书 / X 收藏 Markdown
 *
 *   node scripts/import-likes.js
 *   node scripts/import-likes.js --limit=50
 *   XHS_LIKES_DIR=... X_LIKES_DIR=... node scripts/import-likes.js
 */
'use strict';

const path = require('path');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');

const { syncAll, XHS_ROOT, X_ROOT } = require('../lib/likes-sync');

const args = process.argv.slice(2);
const limit = Number((args.find(a => a.startsWith('--limit=')) || '').slice('--limit='.length)) || 0;

console.log('[import-likes] XHS:', XHS_ROOT);
console.log('[import-likes] X  :', X_ROOT);

// 手动导入默认 force，绕过内存指纹 skip
const results = syncAll({ limit, force: true });
for (const r of results) {
  if (r.missing) {
    console.warn(`[import-likes] missing root for ${r.sourceId}: ${r.root}`);
    continue;
  }
  console.log(`[import-likes] ${r.sourceId}: files=${r.files} imported=${r.imported} failed=${r.failed}${r.skipped ? ' (skipped)' : ''}`);
}

const total = results.reduce((n, r) => n + (r.imported || 0), 0);
console.log(`[import-likes] done, total upserted ${total}`);
