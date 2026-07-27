/**
 * Frontend build entry (documentation / tooling).
 *
 * Runtime is NOT this file: the browser only loads public/app.bundle.min.js
 * (single classic IIFE script). Slices stay classic-script style so they share
 * one scope ($ / state / helpers) after ORDER concat.
 *
 * Pipeline (build-time ESM bundler via esbuild):
 *   1. build:app    — order-data / ORDER.json → concat → public/app.js
 *   2. build:assets — JS_BUNDLE_ORDER concat → esbuild.build (format:iife, minify)
 *                     → public/app.bundle.min.js (+ .map)
 *                     CSS: styles.css → esbuild.build minify → styles.min.css
 *
 * Do not load this file from index.html (no type=module multi-entry).
 */
'use strict';

const order = require('./order-data.js');

module.exports = { order };
module.exports.order = order;
module.exports.default = { order };
