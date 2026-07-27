#!/usr/bin/env node
/**
 * 修复存量 entries 配图：
 * 1) 错误 markdown 图片痕迹 `!<a href>` / `![alt](url)` → <img>
 * 2) 空图片锚点 <a href="cdn…png"></a>（Substack figure 丢 img）→ 补 <img>
 * 3) 远程图本地化到 /article-images/…
 * 4) 同步修补 entry_translations / AI 贡献里的 sourceHtml/targetHtml
 * 5) 从 content 回填 image 封面；可选 --fetch-og
 *
 * 用法：
 *   node scripts/repair-entry-images.js
 *   node scripts/repair-entry-images.js --entry 8bcbcfc2a7cd1fe31be0e37e734a528f
 *   node scripts/repair-entry-images.js --source sebastianraschka
 *   node scripts/repair-entry-images.js --empty-only
 *   node scripts/repair-entry-images.js --localize --limit 30
 *   node scripts/repair-entry-images.js --fetch-og --limit 20
 */
'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

process.env.QMREADER_DATA_DIR = process.env.QMREADER_DATA_DIR
  || path.join(__dirname, '..', 'data');
// 长图文一次尽量下全
if (!process.env.MAX_LOCALIZE_IMAGES_PER_ENTRY) {
  process.env.MAX_LOCALIZE_IMAGES_PER_ENTRY = '60';
}

const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const {
  repairEmptyImageAnchorsHtml,
  isLikelyContentImageUrl,
} = require('../lib/fetcher/html-content');
const {
  localizeEntryImages,
  findExistingLocalImage,
  rewriteContentImageUrls,
  collectContentImageUrls,
} = require('../lib/fetcher/images-localize');

/** img src 属性值：转义 & 与 "，避免属性截断 / XSS */
function escapeAttrUrl(src) {
  return String(src || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

const args = process.argv.slice(2);
const fetchOg = args.includes('--fetch-og');
const doLocalize = args.includes('--localize') || !args.includes('--no-localize');
const emptyOnly = args.includes('--empty-only');
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 50) : 0;
const entryIdx = args.indexOf('--entry');
const entryFilter = entryIdx >= 0 ? String(args[entryIdx + 1] || '').trim() : '';
const sourceIdx = args.indexOf('--source');
const sourceFilter = sourceIdx >= 0 ? String(args[sourceIdx + 1] || '').trim() : '';

const dbPath = path.join(process.env.QMREADER_DATA_DIR, 'qmreader.sqlite');

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function firstImageFromHtml(html) {
  const raw = String(html || '');
  const img = raw.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (img) {
    const src = img[1].trim();
    if (src.startsWith('/article-images/') || isHttpUrl(src)) return src;
  }
  const md = raw.match(/!\[[^\]]*\]\(([^)\s]+)\)/i);
  if (md) {
    const src = md[1].trim();
    if (src.startsWith('/article-images/') || isHttpUrl(src)) return src;
  }
  const broken = raw.match(/!<a\s+href=["'](https?:\/\/[^"']+)["']/i);
  if (broken && isHttpUrl(broken[1])) return broken[1].trim();
  const emptyA = raw.match(/<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/a>/i);
  if (emptyA && isLikelyContentImageUrl(emptyA[1])) return emptyA[1].trim();
  return null;
}

function countEmptyImageAnchors(html) {
  const raw = String(html || '');
  let n = 0;
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*<\/a>/gi;
  let m;
  while ((m = re.exec(raw))) {
    if (isLikelyContentImageUrl(m[1])) n += 1;
  }
  return n;
}

function countRemoteImgs(html) {
  return (String(html || '').match(/<img\b[^>]*\bsrc=["']https?:\/\//gi) || []).length;
}

/** 把错误 markdown 图片痕迹修成 <img> */
function repairMarkdownImageArtifacts(html) {
  let out = String(html || '');
  let changed = false;

  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/article-images\/[^)\s]+)\)/g, (_, alt, src) => {
    changed = true;
    const safeAlt = String(alt || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<img src="${escapeAttrUrl(src)}" alt="${safeAlt}">`;
  });

  out = out.replace(/!<a\s+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, src, label) => {
    changed = true;
    const alt = String(label || '').replace(/<[^>]+>/g, '').trim().slice(0, 120);
    const safeAlt = alt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<img src="${escapeAttrUrl(src)}" alt="${safeAlt}">`;
  });

  return { content: out, changed };
}

function repairHtmlImages(html, pageUrl = '') {
  const md = repairMarkdownImageArtifacts(html);
  let content = md.content;
  let changed = md.changed;
  const beforeEmpty = countEmptyImageAnchors(content);
  const promoted = repairEmptyImageAnchorsHtml(content, pageUrl);
  if (promoted !== content) {
    content = promoted;
    changed = true;
  }
  const afterEmpty = countEmptyImageAnchors(content);
  return {
    content,
    changed,
    emptyBefore: beforeEmpty,
    emptyAfter: afterEmpty,
    promoted: Math.max(0, beforeEmpty - afterEmpty),
  };
}

function repairTranslationBlocks(blocks, pageUrl, urlMap, sourceId = '', entryId = '') {
  if (!Array.isArray(blocks) || !blocks.length) return { blocks, changed: false, promoted: 0 };
  let changed = false;
  let promoted = 0;
  const next = blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    const out = { ...block };
    for (const key of ['sourceHtml', 'targetHtml']) {
      const raw = out[key];
      if (typeof raw !== 'string' || !raw) continue;
      const repaired = repairHtmlImages(raw, pageUrl);
      let html = repaired.content;
      if (repaired.changed) {
        changed = true;
        promoted += repaired.promoted;
      }
      let map = urlMap instanceof Map ? urlMap : new Map();
      if (sourceId && entryId) {
        map = expandUrlMapFromDisk(sourceId, entryId, html, map);
      }
      if (map.size) {
        const rewritten = rewriteContentImageUrls(html, map);
        if (rewritten !== html) {
          html = rewritten;
          changed = true;
        }
      }
      out[key] = html;
    }
    return out;
  });
  return { blocks: next, changed, promoted };
}

async function tryFetchOgImage(entryLike) {
  const link = entryLike && entryLike.link;
  if (!isHttpUrl(link)) return null;
  try {
    const fetcher = require('../lib/fetcher');
    if (typeof fetcher.fetchEntryOriginal !== 'function') return null;
    const fake = {
      id: entryLike.id,
      link,
      title: entryLike.title || '',
      content: entryLike.content || '',
      summary: entryLike.summary || '',
      image: null,
      sourceId: entryLike.source_id || entryLike.sourceId || '',
    };
    const result = await fetcher.fetchEntryOriginal(fake).catch(() => null);
    if (result && result.image && isHttpUrl(result.image)) return result.image;
    if (result && result.content) {
      const fromContent = firstImageFromHtml(result.content);
      if (fromContent) return fromContent;
    }
  } catch (err) {
    console.warn('  og fetch failed:', link, err.message || err);
  }
  return null;
}

function listEntries() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let sql = `
    SELECT id, link, content, image, summary, source_id, title
    FROM entries
    WHERE (deleted_at IS NULL OR deleted_at = 0)
      AND content IS NOT NULL
      AND length(content) > 80
  `;
  const params = [];
  if (entryFilter) {
    sql += ' AND (id = ? OR id LIKE ?)';
    params.push(entryFilter, `${entryFilter}%`);
  }
  if (sourceFilter) {
    sql += ' AND source_id = ?';
    params.push(sourceFilter);
  }
  sql += ' ORDER BY published_ts DESC';
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

function loadTranslation(entryId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare(`
    SELECT entry_id, user_id, title_zh, summary_zh, content_json, model, provider,
           created_by, content_hash, title_hash
    FROM entry_translations
    WHERE entry_id = ?
  `).get(entryId);
  db.close();
  if (!row || !row.content_json) return null;
  let content;
  try {
    content = JSON.parse(row.content_json);
  } catch {
    return null;
  }
  if (!Array.isArray(content)) return null;
  return {
    userId: row.user_id,
    titleZh: row.title_zh || '',
    summaryZh: row.summary_zh || '',
    content,
    model: row.model || '',
    provider: row.provider || 'deepseek',
    createdBy: row.created_by || 'system',
    contentHash: row.content_hash || '',
    titleHash: row.title_hash || '',
  };
}

function loadAiTranslationContributions(entryId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(`
    SELECT id, content_json, user_id, author, title, summary, model, provider, content_hash, title_hash
    FROM entry_ai_asset_contributions
    WHERE entry_id = ? AND asset_type = 'translation'
      AND content_json IS NOT NULL AND content_json <> '' AND content_json <> '[]'
  `).all(entryId);
  db.close();
  return rows.map((row) => {
    let content;
    try {
      content = JSON.parse(row.content_json);
    } catch {
      return null;
    }
    if (!Array.isArray(content)) return null;
    return { ...row, content };
  }).filter(Boolean);
}

function patchAiContributionContent(id, content) {
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    UPDATE entry_ai_asset_contributions
    SET content_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(content), Date.now(), id);
  db.close();
}

function needsWork(row) {
  const content = row.content || '';
  const empty = countEmptyImageAnchors(content);
  if (empty > 0) return true;
  if (/!<a\s+href=/i.test(content)) return true;
  if (/!\[[^\]]*\]\(https?:\/\//i.test(content)) return true;
  if (emptyOnly) return false;
  if (doLocalize && countRemoteImgs(content) > 0) return true;
  if (doLocalize && isHttpUrl(row.image) && !String(row.image).includes('/article-images/')) return true;
  return false;
}

async function main() {
  const rows = listEntries().filter(needsWork);
  const work = limit ? rows.slice(0, limit) : rows;
  console.log(
    `Candidates=${rows.length} working=${work.length} localize=${doLocalize} emptyOnly=${emptyOnly} dryRun=${dryRun}`,
  );

  let contentFixed = 0;
  let promotedTotal = 0;
  let localizedEntries = 0;
  let downloadedTotal = 0;
  let translationFixed = 0;
  let translationHashSynced = 0;
  let imageFilled = 0;
  let ogFilled = 0;
  let scanned = 0;
  let wouldFix = 0;

  for (const row of work) {
    scanned += 1;
    const pageUrl = row.link || '';
    let content = row.content || '';
    let image = row.image || null;
    let dirty = false;
    let urlMap = new Map();

    const repaired = repairHtmlImages(content, pageUrl);
    if (repaired.changed) {
      content = repaired.content;
      dirty = true;
      contentFixed += 1;
      promotedTotal += repaired.promoted;
    }

    if (doLocalize) {
      const beforeRemote = countRemoteImgs(content) + (isHttpUrl(image) ? 1 : 0);
      if (beforeRemote > 0 || repaired.promoted > 0) {
        process.stdout.write(
          `  [${scanned}/${work.length}] localize ${row.source_id} ${(row.title || row.id).slice(0, 48)} ... `,
        );
        if (dryRun) {
          dirty = true; // dry-run 计 wouldFix
          console.log(`dry-run remote≈${beforeRemote} emptyPromoted=${repaired.promoted}`);
        } else {
          try {
            const localized = await localizeEntryImages({
              sourceId: row.source_id,
              entryId: row.id,
              content,
              image,
              pageUrl,
            });
            if (localized.content !== content || localized.image !== image) {
              content = localized.content;
              image = localized.image;
              dirty = true;
              localizedEntries += 1;
              downloadedTotal += Number(localized.downloaded || 0);
            }
            urlMap = localized.urlMap instanceof Map ? localized.urlMap : new Map();
            // 译文里可能还有 content 未覆盖到的 remote（transform 参数不同）：按磁盘已有文件补 map
            urlMap = expandUrlMapFromDisk(row.source_id, row.id, content, urlMap);
            console.log(
              `ok dl=${localized.downloaded || 0} reuse=${localized.reused || 0} fail=${localized.failed || 0} map=${urlMap.size}`,
            );
          } catch (err) {
            console.log('FAIL', err.message || err);
          }
        }
      }
    }

    if (!image || (isHttpUrl(image) && !String(image).includes('/article-images/'))) {
      const fromContent = firstImageFromHtml(content);
      if (fromContent && fromContent !== image) {
        // 优先本地封面
        if (!image || fromContent.startsWith('/article-images/')) {
          image = fromContent;
          dirty = true;
          imageFilled += 1;
        }
      }
    }

    if (fetchOg && !image) {
      process.stdout.write(`  og [${scanned}] ${row.link || row.id} ... `);
      if (dryRun) {
        dirty = true;
        console.log('dry-run');
      } else {
        const og = await tryFetchOgImage(row);
        if (og) {
          image = og;
          dirty = true;
          ogFilled += 1;
          console.log('ok');
        } else {
          console.log('skip');
        }
      }
    }

    if (dryRun && dirty) wouldFix += 1;

    // 译文：先补空锚点，再按同一 entry 本地化远程图（复用磁盘）
    // 修图后把译文 content_hash 同步为当前 entry 的 translationInputHash，避免被当成过期重译
    if (!dryRun) {
      const tr = loadTranslation(row.id);
      if (tr) {
        let trMap = urlMap;
        if (doLocalize) {
          trMap = await localizeHtmlFragments(row.source_id, row.id, pageUrl, tr.content, urlMap);
        }
        const trFix = repairTranslationBlocks(tr.content, pageUrl, trMap, row.source_id, row.id);
        const entryLike = {
          title: row.title || '',
          summary: row.summary || '',
          content,
        };
        const nextHash = deepseek.translationInputHash(entryLike);
        const hashNeedsSync = dirty && tr.contentHash !== nextHash;
        if (trFix.changed || hashNeedsSync) {
          store.saveTranslation(row.id, {
            ...tr,
            content: trFix.blocks,
            contentHash: nextHash,
            titleHash: tr.titleHash || store.hashText(row.title || ''),
          });
          if (trFix.changed) translationFixed += 1;
          if (hashNeedsSync) translationHashSynced += 1;
          promotedTotal += trFix.promoted;
        }
      }
      for (const contrib of loadAiTranslationContributions(row.id)) {
        let cMap = urlMap;
        if (doLocalize) {
          cMap = await localizeHtmlFragments(row.source_id, row.id, pageUrl, contrib.content, urlMap);
        }
        const fix = repairTranslationBlocks(contrib.content, pageUrl, cMap, row.source_id, row.id);
        if (fix.changed) {
          patchAiContributionContent(contrib.id, fix.blocks);
          promotedTotal += fix.promoted;
        }
      }
    }

    if (!dirty || dryRun) continue;

    store.updateEntryContent(row.id, {
      content,
      summary: row.summary || '',
      image,
      originalFetched: Boolean(row.content),
    });
  }

  console.log('[ok]', {
    scanned,
    contentFixed,
    promotedTotal,
    localizedEntries,
    downloadedTotal,
    translationFixed,
    translationHashSynced,
    imageFilled,
    ogFilled,
    ...(dryRun ? { wouldFix } : {}),
  });
  console.log('data dir:', process.env.QMREADER_DATA_DIR);
}

/** 把正文/译文里仍出现的远程图 URL 尽量映射到已下载本地路径 */
function expandUrlMapFromDisk(sourceId, entryId, html, urlMap) {
  const map = urlMap instanceof Map ? new Map(urlMap) : new Map();
  const remotes = collectContentImageUrls(html || '')
    .filter((u) => isHttpUrl(u));
  // 也扫一遍旧式空锚点
  const hrefRe = /<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = hrefRe.exec(String(html || '')))) {
    if (isLikelyContentImageUrl(m[1]) && !remotes.includes(m[1])) remotes.push(m[1]);
  }
  for (const remote of remotes) {
    if (map.has(remote)) continue;
    const hit = findExistingLocalImage(sourceId, entryId, remote);
    if (hit) map.set(remote, hit);
  }
  return map;
}

/** 对译文块里的 HTML 远程图做一次本地化，合并进 urlMap */
async function localizeHtmlFragments(sourceId, entryId, pageUrl, blocks, baseMap) {
  const map = baseMap instanceof Map ? new Map(baseMap) : new Map();
  if (!Array.isArray(blocks) || !blocks.length) return map;
  const joined = blocks.map((b) => {
    if (!b || typeof b !== 'object') return '';
    return `${b.sourceHtml || ''}\n${b.targetHtml || ''}`;
  }).join('\n');
  const repaired = repairEmptyImageAnchorsHtml(joined, pageUrl);
  const remotes = collectContentImageUrls(repaired).filter((u) => isHttpUrl(u) && !String(u).includes('/article-images/'));
  if (!remotes.length) return map;
  try {
    const localized = await localizeEntryImages({
      sourceId,
      entryId,
      content: repaired,
      image: null,
      pageUrl,
    });
    if (localized.urlMap instanceof Map) {
      for (const [k, v] of localized.urlMap) map.set(k, v);
    }
  } catch (err) {
    console.warn('  translation localize failed:', entryId, err.message || err);
  }
  return map;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
