const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-notes-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

test('entry thinking note save / read / update / clear roundtrip', () => {
  const id = store.hashText('thinking-note-entry').slice(0, 32);
  store.upsertEntries([{
    id,
    sourceId: 'xhs-likes',
    title: 'note target',
    link: 'https://example.com/note-target',
    content: '<p>body</p>',
    summary: 'summary',
    publishedTs: Date.now(),
  }]);

  assert.equal(store.getEntryNote(id), null);

  const saved = store.saveEntryNote(id, '# 想法\n\n- 第一条思考');
  assert.equal(saved.entryId, id);
  assert.match(saved.body, /第一条思考/);

  const read = store.getEntryNote(id);
  assert.equal(read.body, '# 想法\n\n- 第一条思考');

  const updated = store.saveEntryNote(id, '第二版内容');
  assert.equal(updated.body, '第二版内容');
  assert.ok(updated.updatedAt >= saved.updatedAt);
  assert.equal(updated.createdAt, saved.createdAt);

  // 空正文 = 删除
  assert.equal(store.saveEntryNote(id, '   '), null);
  assert.equal(store.getEntryNote(id), null);
});

test('entry note is scoped per entry', () => {
  const a = store.hashText('note-entry-a').slice(0, 32);
  const b = store.hashText('note-entry-b').slice(0, 32);
  store.upsertEntries([
    { id: a, sourceId: 'zhihu-tianqing', title: 'A', link: 'https://example.com/a', content: 'a', summary: 'a', publishedTs: Date.now() },
    { id: b, sourceId: 'lilianweng', title: 'B', link: 'https://example.com/b', content: 'b', summary: 'b', publishedTs: Date.now() },
  ]);
  store.saveEntryNote(a, '只属于 A 的笔记');
  assert.equal(store.getEntryNote(b), null);
  assert.match(store.getEntryNote(a).body, /只属于 A/);
});
