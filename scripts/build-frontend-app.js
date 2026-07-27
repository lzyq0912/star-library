#!/usr/bin/env node
/**
 * Concat public/src/*.js → public/app.js in order-data / ORDER.json sequence.
 * Runtime remains a single global script (UX/API identical).
 *
 * Usage:
 *   node scripts/build-frontend-app.js          # write public/app.js
 *   node scripts/build-frontend-app.js --check  # exit 1 if out of date
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'public', 'src');
const outFile = path.join(root, 'public', 'app.js');
const order = require(path.join(srcDir, 'order-data.js'));

function build() {
  if (!Array.isArray(order) || order.length === 0) {
    throw new Error('order-data.js must export a non-empty slice list');
  }
  const parts = order.map((name) => {
    const file = path.join(srcDir, name);
    if (!fs.existsSync(file)) throw new Error(`missing slice: ${name}`);
    return fs.readFileSync(file, 'utf8');
  });
  return parts.join('');
}

const check = process.argv.includes('--check');
const built = build();
if (check) {
  const current = fs.readFileSync(outFile, 'utf8');
  if (current !== built) {
    console.error('public/app.js is out of date vs public/src — run: npm run build:app');
    process.exit(1);
  }
  console.log('public/app.js matches public/src (', built.length, 'bytes)');
  process.exit(0);
}

fs.writeFileSync(outFile, built);
console.log('wrote public/app.js from', order.length, 'slices,', built.length, 'bytes');
