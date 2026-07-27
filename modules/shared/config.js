/**
 * Shared process config / constants (vertical-slice modular monolith).
 * Behavior-compatible with pre-VSA server.js env parsing.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const DAILY_REFRESH_HOUR_SHANGHAI = 8;
const STARTUP_REFRESH_DELAY_MS = parseInt(process.env.STARTUP_REFRESH_DELAY_MS || '30000', 10);
const SOURCE_INTERACTION_REFRESH_COOLDOWN_MS = parseInt(process.env.SOURCE_INTERACTION_REFRESH_COOLDOWN_MS || `${5 * MINUTE_MS}`, 10);
const FRESHNESS_SWEEP_INTERVAL_MS = parseInt(process.env.FRESHNESS_SWEEP_INTERVAL_MS || `${5 * MINUTE_MS}`, 10);
const FRESHNESS_STARTUP_DELAY_MS = parseInt(process.env.FRESHNESS_STARTUP_DELAY_MS || `${2 * MINUTE_MS}`, 10);
const FRESHNESS_SWEEP_BATCH_SIZE = parseInt(process.env.FRESHNESS_SWEEP_BATCH_SIZE || '3', 10);
const FRESHNESS_SWEEP_MAX_COST = parseInt(process.env.FRESHNESS_SWEEP_MAX_COST || '6', 10);
const NEWS_REFRESH_INTERVAL_MS = parseInt(process.env.NEWS_REFRESH_INTERVAL_MS || `${30 * MINUTE_MS}`, 10);
const ARTICLE_REFRESH_INTERVAL_MS = parseInt(process.env.ARTICLE_REFRESH_INTERVAL_MS || `${2 * HOUR_MS}`, 10);
const PODCAST_REFRESH_INTERVAL_MS = parseInt(process.env.PODCAST_REFRESH_INTERVAL_MS || `${6 * HOUR_MS}`, 10);
const TITLE_TRANSLATION_LIMIT = parseInt(process.env.TITLE_TRANSLATION_LIMIT || '80', 10);
const AUTO_REWRITE_SOURCE_IDS = new Set(String(process.env.AUTO_REWRITE_SOURCE_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean));
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
const DOMPURIFY_PATH = require.resolve('dompurify/dist/purify.min.js');
const DOMPURIFY_VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(require.resolve('dompurify')), '..', 'package.json'),
  'utf8',
)).version;
const KATEX_DIST_PATH = path.join(path.dirname(require.resolve('katex/package.json')), 'dist');
const REFRESH_WORKER_PATH = path.join(ROOT, 'scripts', 'refresh-worker.js');
const DEFAULT_TITLE = 'QMReader · RSS 阅读器';
const DEFAULT_DESCRIPTION = '围绕 RSS 文章沉淀中文翻译、乔木风格重写、人工点评和文章对话的公开阅读站。';
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const UMAMI_WEBSITE_ID = String(process.env.UMAMI_WEBSITE_ID || '').trim();
const UMAMI_SRC = String(process.env.UMAMI_SRC || 'https://umami.qiaomu.ai/script.js').trim();
const ARTICLE_SHORT_ID_LENGTH = 12;
const ASSET_DIRECTORY_META = {
  translation: {
    label: '中文翻译',
    description: 'QMReader 已沉淀中文双语对照翻译的公开 RSS 文章目录。',
  },
  rewrite: {
    label: '乔木风格重写',
    description: 'QMReader 已沉淀乔木风格中文重写的公开 RSS 文章目录。',
  },
  chat: {
    label: '文章对话',
    description: 'QMReader 已沉淀公开 AI 文章对话的 RSS 文章目录。',
  },
};
const FAVICON_MAX_BYTES = 256 * 1024;
const FAVICON_CACHE_MAX_ENTRIES = 512;
const FAVICON_TOTAL_TIMEOUT_MS = 6000;
const FAVICON_MAX_INFLIGHT = 64;
const RATE_LIMIT_MAX_BUCKETS = 2048;

module.exports = {
  ROOT,
  MINUTE_MS,
  HOUR_MS,
  PORT,
  HOST,
  DAILY_REFRESH_HOUR_SHANGHAI,
  STARTUP_REFRESH_DELAY_MS,
  SOURCE_INTERACTION_REFRESH_COOLDOWN_MS,
  FRESHNESS_SWEEP_INTERVAL_MS,
  FRESHNESS_STARTUP_DELAY_MS,
  FRESHNESS_SWEEP_BATCH_SIZE,
  FRESHNESS_SWEEP_MAX_COST,
  NEWS_REFRESH_INTERVAL_MS,
  ARTICLE_REFRESH_INTERVAL_MS,
  PODCAST_REFRESH_INTERVAL_MS,
  TITLE_TRANSLATION_LIMIT,
  AUTO_REWRITE_SOURCE_IDS,
  PUBLIC_DIR,
  INDEX_PATH,
  DOMPURIFY_PATH,
  DOMPURIFY_VERSION,
  KATEX_DIST_PATH,
  REFRESH_WORKER_PATH,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  HTML_ESCAPES,
  UMAMI_WEBSITE_ID,
  UMAMI_SRC,
  ARTICLE_SHORT_ID_LENGTH,
  ASSET_DIRECTORY_META,
  FAVICON_MAX_BYTES,
  FAVICON_CACHE_MAX_ENTRIES,
  FAVICON_TOTAL_TIMEOUT_MS,
  FAVICON_MAX_INFLIGHT,
  RATE_LIMIT_MAX_BUCKETS,
};
