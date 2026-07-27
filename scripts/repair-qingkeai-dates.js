#!/usr/bin/env node
/**
 * 修复青稞（qingkeai）文章时间与重复项：
 * - 博客爬虫把直播 liveStartTime（如 7/14 20:00）当成发布时间
 * - zen-import 与 RSS 同链不同 id 造成重复
 *
 * 策略：用 RSS pubDate 回写同链条目；同链保留正文更长的一条，软删其余。
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');

const Parser = require('rss-parser');
const store = require('../lib/store');

const SOURCE_ID = 'qingkeai';
const FEEDS = [
  'https://qingkeai.online/rss.xml',
  'https://qingkeai.online/atom.xml',
  'https://qingkeai.online/feed',
];

function normalizeLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    // 去尾斜杠，统一 path 解码
    let p = decodeURIComponent(url.pathname || '/').replace(/\/+$/, '') || '/';
    // 空格 path（历史脏链）
    p = p.replace(/\/\s+/g, '/');
    url.pathname = p;
    return url.toString();
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function publishedScore(iso) {
  const s = String(iso || '').trim();
  if (!s) return -1000;
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t <= 0) return -1000;
  let score = 50;
  // 纯正午 UTC 多为「仅日期 / 直播开播时间」伪时间
  if (/T12:00:00(?:\.000)?Z$/i.test(s)) score -= 45;
  // 明显占位
  if (/^202[0-6]-01-01T12:00:00/i.test(s)) score -= 80;
  // 有分秒更像真实 pubDate
  const d = new Date(t);
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0) score += 25;
  if (d.getUTCHours() !== 0 && d.getUTCHours() !== 12) score += 10;
  return score;
}

function contentLen(entry) {
  return String((entry && (entry.content || entry.summary)) || '').replace(/<[^>]+>/g, ' ').length;
}

async function loadRssDates() {
  const parser = new Parser({ timeout: 20000 });
  const byLink = new Map();
  for (const feedUrl of FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items || []) {
        const link = normalizeLink(item.link || item.guid || '');
        if (!link) continue;
        const iso = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : '');
        if (!iso || !Number.isFinite(Date.parse(iso))) continue;
        const prev = byLink.get(link);
        if (!prev || publishedScore(iso) > publishedScore(prev)) byLink.set(link, iso);
      }
      if (byLink.size) break;
    } catch (error) {
      console.warn(`[repair-qingkeai] feed fail ${feedUrl}:`, error.message || error);
    }
  }
  return byLink;
}

function listQingkeaiEntries() {
  // listEntriesBySource limit 1000 — 源可能更多，直接扫库
  const Database = null;
  try {
    return store.listEntriesBySource(SOURCE_ID, 1000) || [];
  } catch {
    return [];
  }
}

function main() {
  return loadRssDates().then((rssDates) => {
    console.log(`[repair-qingkeai] RSS dates loaded: ${rssDates.size}`);
    const entries = listQingkeaiEntries();
    console.log(`[repair-qingkeai] local entries: ${entries.length}`);

    const groups = new Map();
    for (const entry of entries) {
      const key = normalizeLink(entry.link);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }

    let dateFixed = 0;
    let softDeleted = 0;
    const keepers = [];

    for (const [link, group] of groups) {
      const rssIso = rssDates.get(link) || '';
      // 候选发布时间：RSS > 组内高分
      let bestIso = rssIso;
      let bestScore = publishedScore(rssIso);
      for (const e of group) {
        const sc = publishedScore(e.published);
        if (sc > bestScore) {
          bestScore = sc;
          bestIso = e.published;
        }
      }
      const bestTs = bestIso ? Date.parse(bestIso) : 0;

      // 保留正文最长；同分保留已有 published 更好的
      group.sort((a, b) => {
        const lenDelta = contentLen(b) - contentLen(a);
        if (lenDelta) return lenDelta;
        return publishedScore(b.published) - publishedScore(a.published);
      });
      const keeper = group[0];
      const drop = group.slice(1);

      if (bestTs > 0 && (keeper.published !== bestIso || Number(keeper.publishedTs) !== bestTs)) {
        store.upsertEntries([{
          ...keeper,
          published: new Date(bestTs).toISOString(),
          publishedTs: bestTs,
          forceContent: true,
        }]);
        dateFixed += 1;
        keepers.push({ id: keeper.id, link, published: new Date(bestTs).toISOString(), fixed: true });
      } else {
        keepers.push({ id: keeper.id, link, published: keeper.published, fixed: false });
      }

      for (const d of drop) {
        const result = store.softDeleteEntry(d.id, {
          reason: 'qingkeai 同链重复：保留更完整正文并统一为 RSS/可靠发布时间',
        });
        if (result && !result.alreadyDeleted) softDeleted += 1;
      }
    }

    // 单独：有 RSS 日期但未在 group 修到的（单条错误正午）
    let singleFixed = 0;
    for (const entry of entries) {
      const link = normalizeLink(entry.link);
      const rssIso = rssDates.get(link);
      if (!rssIso) continue;
      const rssTs = Date.parse(rssIso);
      if (!Number.isFinite(rssTs)) continue;
      if (entry.published === rssIso || Number(entry.publishedTs) === rssTs) continue;
      // 仅当本地明显更差（正午伪时间 / 占位）时覆盖
      if (publishedScore(entry.published) >= publishedScore(rssIso)) continue;
      // 若已被 soft delete 跳过
      if (store.isEntryDeleted && store.isEntryDeleted(entry.id)) continue;
      store.upsertEntries([{
        ...entry,
        published: new Date(rssTs).toISOString(),
        publishedTs: rssTs,
        forceContent: true,
      }]);
      singleFixed += 1;
    }

    console.log(JSON.stringify({
      rssDates: rssDates.size,
      groups: groups.size,
      dateFixed,
      singleFixed,
      softDeleted,
      sample: keepers.filter(k => k.fixed).slice(0, 8),
      kinema: keepers.find(k => /Kinema4D-talk/i.test(k.link)),
    }, null, 2));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
