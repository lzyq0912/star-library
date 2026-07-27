/**
 * Pure constants shared by fetcher modules.
 * 无 I/O、无可变状态；可安全 require，不依赖 runtime / 门面。
 *
 * Agent 约定：
 * - 源 id / HN 限流与条数上限：看这里
 * - 超时与 body 上限：http-public.js（TIMEOUT_MS 等）
 * - 可变 cache/state：runtime.js
 */
'use strict';

/** 用户投稿源 */
const USER_SUBMITTED_SOURCE_ID = 'user-submitted';
/** GitHub 项目源（与 lib/github-repo.js 一致） */
const GITHUB_PROJECTS_SOURCE_ID = 'github-projects';
const HUGGINGFACE_SOURCE_ID = 'huggingface';
const PRODUCTHUNT_SOURCE_ID = 'producthunt';
const HACKERNEWS_SOURCE_ID = 'hackernews';

/** HN 讨论抓取：每轮最多 enrich 的条数 */
const HACKERNEWS_DISCUSSION_FETCH_LIMIT = 4;
/** HN 作者 lookup 并发/条数上限 */
const HACKERNEWS_AUTHOR_LOOKUP_LIMIT = 2;
/** HN 线程评论 API 拉取条数 */
const HACKERNEWS_THREAD_COMMENT_FETCH_COUNT = 30;
/** 写入条目的讨论评论上限 */
const HACKERNEWS_DISCUSSION_COMMENT_LIMIT = 8;
/** 作者回复展示上限 */
const HACKERNEWS_AUTHOR_REPLY_LIMIT = 5;
/** HN Firebase API 评论 fetch 上限 */
const HACKERNEWS_API_COMMENT_FETCH_LIMIT = 10;

/** hnrss.org 请求最小间隔（ms） */
const HNRSS_REQUEST_GAP_MS = 1500;

/** 源 refresh 默认并发 */
const CONCURRENCY = 8;

/** cache 文件锁过期（ms） */
const CACHE_LOCK_STALE_MS = 15000;

/** RSS/Atom 拉取头 */
const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 QMReader/1.0',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
};

module.exports = {
  USER_SUBMITTED_SOURCE_ID,
  GITHUB_PROJECTS_SOURCE_ID,
  HUGGINGFACE_SOURCE_ID,
  PRODUCTHUNT_SOURCE_ID,
  HACKERNEWS_SOURCE_ID,
  HACKERNEWS_DISCUSSION_FETCH_LIMIT,
  HACKERNEWS_AUTHOR_LOOKUP_LIMIT,
  HACKERNEWS_THREAD_COMMENT_FETCH_COUNT,
  HACKERNEWS_DISCUSSION_COMMENT_LIMIT,
  HACKERNEWS_AUTHOR_REPLY_LIMIT,
  HACKERNEWS_API_COMMENT_FETCH_LIMIT,
  HNRSS_REQUEST_GAP_MS,
  CONCURRENCY,
  CACHE_LOCK_STALE_MS,
  RSS_HEADERS,
};
