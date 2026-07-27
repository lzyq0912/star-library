/**
 * Slice load order — requireable mirror of ORDER.json.
 * build-frontend-app.js and tooling import this; keep ORDER.json as the edit source.
 */
'use strict';

const order = require('./ORDER.json');

module.exports = order;
module.exports.default = order;
module.exports.order = order;
