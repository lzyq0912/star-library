#!/usr/bin/env node
/**
 * 导入本地知识库小红书博主（小红书原生 social 格式）
 *
 *   node scripts/import-xhs-kb.js
 *   XHS_KB_DIR=... node scripts/import-xhs-kb.js
 */
'use strict';

const path = require('path');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');

const { syncAll, KB_ROOT } = require('../lib/xhs-kb-sync');

console.log('[import-xhs-kb] root:', KB_ROOT);

const results = syncAll();
for (const r of results) {
  if (r.missing) {
    console.warn(`[import-xhs-kb] missing ${r.sourceId}: ${r.root}`);
    continue;
  }
  console.log(`[import-xhs-kb] ${r.sourceId}: imported=${r.imported} failed=${r.failed}${r.files != null ? ` files=${r.files}` : ''}`);
}

const total = results.reduce((n, r) => n + (r.imported || 0), 0);
console.log(`[import-xhs-kb] done, total upserted ${total}`);
