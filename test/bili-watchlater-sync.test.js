'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  httpsPic,
  formatDuration,
  formatWallClock,
  entryFromToviewItem,
  entryFromFavMedia,
  mergeBiliEntries,
  listFingerprint,
  combinedFingerprint,
  aidFromEntry,
  SOURCE_ID,
  PLATFORM,
} = require('../lib/bili-watchlater-sync');
const { parseStoredContent } = require('../lib/likes-sync');

describe('bili-watchlater-sync helpers', () => {
  it('httpsPic upgrades http cover CDN', () => {
    assert.equal(
      httpsPic('http://i0.hdslb.com/bfs/archive/abc.jpg'),
      'https://i0.hdslb.com/bfs/archive/abc.jpg',
    );
    assert.equal(httpsPic('https://i1.hdslb.com/x.png'), 'https://i1.hdslb.com/x.png');
    assert.equal(httpsPic(''), '');
  });

  it('formatDuration', () => {
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3661), '1:01:01');
    assert.equal(formatDuration(0), '0:00');
  });

  it('formatWallClock produces Asia/Shanghai wall clock', () => {
    const s = formatWallClock(1700000000);
    assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('entryFromToviewItem maps cover to image + social payload', () => {
    const entry = entryFromToviewItem({
      aid: 1,
      bvid: 'BV1testxxxx',
      title: '测试视频',
      pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
      desc: '简介一段',
      duration: 125,
      add_at: 1700000000,
      pubdate: 1690000000,
      progress: 10,
      owner: { mid: 42, name: '测试UP', face: 'http://i0.hdslb.com/bfs/face/a.jpg' },
      stat: { view: 12000, like: 300, danmaku: 40, favorite: 5, reply: 2 },
      tname: '科技',
    });
    assert.ok(entry);
    assert.equal(entry.sourceId, SOURCE_ID);
    assert.equal(entry.title, '测试视频');
    assert.equal(entry.link, 'https://www.bilibili.com/video/BV1testxxxx');
    assert.equal(entry.image, 'https://i0.hdslb.com/bfs/archive/cover.jpg');
    assert.equal(entry.author, '测试UP');
    assert.equal(entry.forceContent, true);

    const payload = parseStoredContent(entry.content);
    assert.ok(payload);
    assert.equal(payload.platform, PLATFORM);
    assert.equal(payload.bvid, 'BV1testxxxx');
    assert.equal(payload.cover, entry.image);
    assert.equal(payload.images[0].src, entry.image);
    assert.equal(payload.durationText, '2:05');
    assert.equal(payload.views, 12000);
    assert.deepEqual(payload.biliOrigins, ['watchlater']);
  });

  it('entryFromFavMedia maps folder media + favorite origin', () => {
    const entry = entryFromFavMedia({
      id: 99,
      type: 2,
      title: '收藏视频',
      cover: 'http://i0.hdslb.com/bfs/archive/fav.jpg',
      intro: '收藏简介',
      duration: 90,
      fav_time: 1700000100,
      pubtime: 1690000000,
      bvid: 'BV1favtestx',
      upper: { mid: 7, name: '收藏UP', face: 'http://i0.hdslb.com/bfs/face/b.jpg' },
      cnt_info: { play: 500, danmaku: 3, collect: 9, reply: 1 },
      __mediaId: '326232232',
      __folderTitle: '默认收藏夹',
    });
    assert.ok(entry);
    assert.equal(entry.title, '收藏视频');
    assert.equal(entry.image, 'https://i0.hdslb.com/bfs/archive/fav.jpg');
    const payload = parseStoredContent(entry.content);
    assert.equal(payload.aid, '99');
    assert.deepEqual(payload.biliOrigins, ['favorite']);
    assert.deepEqual(payload.favMediaIds, ['326232232']);
    assert.deepEqual(payload.favFolderTitles, ['默认收藏夹']);
  });

  it('mergeBiliEntries unions same bvid from toview + fav', () => {
    const tv = entryFromToviewItem({
      aid: 1,
      bvid: 'BV1samexxxx',
      title: '同视频',
      pic: 'http://i0.hdslb.com/bfs/archive/a.jpg',
      add_at: 100,
      owner: { name: 'UP' },
      stat: { view: 1, like: 2 },
    });
    const fav = entryFromFavMedia({
      id: 1,
      type: 2,
      title: '同视频收藏',
      cover: 'http://i0.hdslb.com/bfs/archive/b.jpg',
      fav_time: 200,
      bvid: 'BV1samexxxx',
      upper: { name: 'UP' },
      cnt_info: {},
      __mediaId: '111',
      __folderTitle: '默认收藏夹',
    });
    const merged = mergeBiliEntries([tv], [fav]);
    assert.equal(merged.length, 1);
    // 较新 collectAt（收藏 fav_time=200）择优为基条目，标题跟收藏侧
    assert.equal(merged[0].title, '同视频收藏');
    const payload = parseStoredContent(merged[0].content);
    assert.ok(payload.biliOrigins.includes('watchlater'));
    assert.ok(payload.biliOrigins.includes('favorite'));
    assert.deepEqual(payload.favMediaIds, ['111']);
  });

  it('mergeBiliEntries prefers newer collectAt title over older side', () => {
    const tv = entryFromToviewItem({
      aid: 2,
      bvid: 'BV1titlepref',
      title: '稍后再看标题很长完整版',
      pic: 'http://i0.hdslb.com/bfs/archive/a.jpg',
      add_at: 300,
      owner: { name: 'UP' },
      stat: {},
    });
    const fav = entryFromFavMedia({
      id: 2,
      type: 2,
      title: '短',
      cover: 'http://i0.hdslb.com/bfs/archive/b.jpg',
      fav_time: 100,
      bvid: 'BV1titlepref',
      upper: { name: 'UP' },
      cnt_info: {},
      __mediaId: '222',
      __folderTitle: '默认收藏夹',
    });
    const merged = mergeBiliEntries([tv], [fav]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, '稍后再看标题很长完整版');
    const payload = parseStoredContent(merged[0].content);
    assert.ok(payload.biliOrigins.includes('watchlater'));
    assert.ok(payload.biliOrigins.includes('favorite'));
  });

  it('listFingerprint stable for same list order', () => {
    const list = [
      { bvid: 'BV1a', add_at: 1, progress: 0 },
      { bvid: 'BV1b', add_at: 2, progress: 3 },
    ];
    assert.equal(listFingerprint(list), listFingerprint(list.slice()));
    assert.notEqual(
      listFingerprint(list),
      listFingerprint([{ bvid: 'BV1a', add_at: 1, progress: 9 }, list[1]]),
    );
  });

  it('combinedFingerprint changes when fav list changes', () => {
    const tv = [{ bvid: 'BV1a', add_at: 1, progress: 0 }];
    const favA = [{ bvid: 'BV1b', fav_time: 2, __mediaId: '1' }];
    const favB = [{ bvid: 'BV1b', fav_time: 3, __mediaId: '1' }];
    assert.notEqual(combinedFingerprint(tv, favA), combinedFingerprint(tv, favB));
  });

  it('aidFromEntry reads payload aid', () => {
    const entry = entryFromToviewItem({
      aid: 540580868,
      bvid: 'BV1testxxxx',
      title: 'x',
      pic: '',
      owner: { name: 'u' },
      stat: {},
    });
    assert.equal(aidFromEntry(entry), '540580868');
    assert.equal(aidFromEntry({ link: 'https://www.bilibili.com/video/av12345', content: '' }), '12345');
  });
});
