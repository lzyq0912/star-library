#!/usr/bin/env node
/**
 * 青稞同源同链去重：优先保留 md5(qingkeai|绝对link) 稳定 id。
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');

const store = require('../lib/store');
const DB_FILE = path.join(process.env.QMREADER_DATA_DIR, 'qmreader.sqlite');

function normLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    let p = decodeURIComponent(url.pathname || '/').replace(/\/+$/, '') || '/';
    p = p.replace(/\/\s+/g, '/');
    url.pathname = p;
    return url.toString();
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function md5(text) {
  return crypto.createHash('md5').update(String(text)).digest('hex');
}

function main() {
  const db = new DatabaseSync(DB_FILE);
  const all = db.prepare(`
    SELECT id, link, content, summary, image, published, published_ts, deleted_at
    FROM entries
    WHERE source_id = 'qingkeai'
  `).all();

  const groups = new Map();
  for (const row of all) {
    const key = normLink(row.link);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let revived = 0;
  let softDeleted = 0;
  const t = Date.now();

  const undeleteStmt = db.prepare(`
    UPDATE entries
    SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, updated_at = ?
    WHERE id = ?
  `);
  const updateContentStmt = db.prepare(`
    UPDATE entries
    SET content = ?, summary = ?, image = COALESCE(?, image), updated_at = ?
    WHERE id = ?
  `);
  const updatePublishedStmt = db.prepare(`
    UPDATE entries
    SET published = ?, published_ts = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const [link, group] of groups) {
    if (group.length <= 1) continue;

    const stableId = md5(`qingkeai|${link}`);
    const zenId = md5(`zen-import|${link}`);
    const byLen = (a, b) => String(b.content || '').length - String(a.content || '').length;

    let winner = group.find(g => g.id === stableId)
      || group.find(g => g.id === zenId)
      || [...group].sort(byLen)[0];
    if (!winner) continue;

    if (winner.deleted_at) {
      undeleteStmt.run(t, winner.id);
      winner.deleted_at = null;
      revived += 1;
    }

    const longest = [...group].sort(byLen)[0];
    if (longest && longest.id !== winner.id
      && String(longest.content || '').length > String(winner.content || '').length + 40) {
      updateContentStmt.run(
        longest.content || '',
        longest.summary || winner.summary || '',
        longest.image || null,
        t,
        winner.id,
      );
      winner.content = longest.content;
    }

    // 更好发布时间
    let bestIso = winner.published || '';
    let bestScore = -9999;
    for (const row of group) {
      const s = String(row.published || '');
      if (!s || !Date.parse(s)) continue;
      let score = 10;
      if (/T12:00:00/.test(s)) score -= 40;
      const d = new Date(Date.parse(s));
      if (d.getUTCMinutes() || d.getUTCSeconds()) score += 20;
      if (score > bestScore) {
        bestScore = score;
        bestIso = s;
      }
    }
    if (bestIso && bestIso !== winner.published) {
      const ts = Date.parse(bestIso);
      if (Number.isFinite(ts)) {
        updatePublishedStmt.run(new Date(ts).toISOString(), ts, t, winner.id);
      }
    }

    for (const row of group) {
      if (row.id === winner.id) continue;
      if (!row.deleted_at) {
        const result = store.softDeleteEntry(row.id, {
          reason: '同源同链重复：保留稳定绝对 link id',
        });
        if (result && !result.alreadyDeleted) softDeleted += 1;
        row.deleted_at = t;
      }
    }
  }

  db.close();

  const rows = store.listEntriesBySource('qingkeai', 1000);
  const cachePath = path.join(process.env.QMREADER_DATA_DIR, 'cache.json');
  if (fs.existsSync(cachePath)) {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    cache.qingkeai = {
      ...(cache.qingkeai || {}),
      fetchedAt: Date.now(),
      entries: rows.map(e => ({
        id: e.id,
        sourceId: e.sourceId,
        title: e.title,
        link: e.link,
        author: e.author,
        published: e.published,
        publishedTs: e.publishedTs,
        summary: e.summary,
        content: e.content,
        image: e.image,
        audio: e.audio,
      })),
    };
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  }

  const qwen = rows.filter(e => /Qwen-Robot-Suite/i.test(e.link || ''));
  const counts = new Map();
  for (const e of rows) {
    const k = normLink(e.link);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  console.log(JSON.stringify({
    multiGroups: [...groups.values()].filter(g => g.length > 1).length,
    revived,
    softDeleted,
    active: rows.length,
    activeDups: [...counts.values()].filter(n => n > 1).length,
    qwen: qwen.map(e => ({
      id: e.id,
      published: e.published,
      contentLen: (e.content || '').length,
    })),
  }, null, 2));
}

main();
