const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeContent,
  extractXArticleTitle,
  parseStoredContent,
} = require('../lib/likes-sync');

test('X Article detection only promotes a leading article heading', () => {
  assert.equal(extractXArticleTitle('### A real X Article\n\nArticle body'), 'A real X Article');
  assert.equal(
    extractXArticleTitle('[打开原推](https://x.com/user/status/1)\n\n[https://t.co/a](https://t.co/a)\n\n### Linked article'),
    'Linked article',
  );
  assert.equal(extractXArticleTitle('A normal post\n\nwith multiple paragraphs'), '');
  assert.equal(extractXArticleTitle('## Media\n\n![image](x.png)'), '');
});

test('social payload parser ignores comment-like text inside JSON', () => {
  const payload = {
    v: 1,
    platform: 'x',
    kind: 'post',
    title: 'normal post',
    body: 'A reply can literally contain --> without ending the payload.',
    images: [],
  };
  assert.deepEqual(parseStoredContent(encodeContent(payload)), payload);
});
