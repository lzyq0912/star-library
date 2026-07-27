/**
 * Shared runtime state for fetcher modules.
 * 门面与 sources-* / cache-io 共用；禁止业务逻辑堆这里。
 *
 * Agent 约定：
 * - 读写条目加速层：runtime.cache
 * - 源启用覆盖：runtime.state
 * - 写盘队列：runtime.pendingCacheSourceIds / pendingCacheEntryPatches
 * - 纯常量：require('./constants')
 * - 勿 require('../fetcher')（环）
 */
'use strict';

const path = require('path');
const {
  CONCURRENCY,
  CACHE_LOCK_STALE_MS,
  USER_SUBMITTED_SOURCE_ID,
} = require('./constants');

const DATA_DIR = process.env.QMREADER_DATA_DIR
  ? path.resolve(process.env.QMREADER_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

const runtime = {
  DATA_DIR,
  CACHE_FILE: path.join(DATA_DIR, 'cache.json'),
  STATE_FILE: path.join(DATA_DIR, 'state.json'),
  CACHE_LOCK_DIR: null, // set below
  CACHE_LOCK_OWNER_FILE: null,
  CACHE_LOCK_STALE_MS,
  CACHE_LOCK_WAIT_ARRAY: new Int32Array(new SharedArrayBuffer(4)),
  activeCacheLockToken: '',
  /** @type {Record<string, any>} */
  cache: {},
  /** @type {Record<string, any>} */
  state: {},
  pendingCacheSourceIds: new Set(),
  pendingCacheEntryPatches: new Map(),
  saveTimer: null,
  CONCURRENCY,
  USER_SUBMITTED_SOURCE_ID,
  /** hnrss 全局限速（可变） */
  lastHnrssRequestAt: 0,
  hnrssRequestQueue: Promise.resolve(),
};

runtime.CACHE_LOCK_DIR = `${runtime.CACHE_FILE}.lock`;
runtime.CACHE_LOCK_OWNER_FILE = path.join(runtime.CACHE_LOCK_DIR, 'owner');

module.exports = runtime;
