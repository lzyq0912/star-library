const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-translation-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const deepseek = require('../lib/deepseek');
const store = require('../lib/store');

after(() => {
  store.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function providerConfig(overrides = {}) {
  return {
    provider: 'openai-compatible',
    providerType: 'openai_compatible',
    providerTitle: 'Test provider',
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
    temperature: 0.1,
    maxTokens: 5000,
    ...overrides,
  };
}

function openAiResponse(content, finishReason = 'stop', headers = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content } }],
  }), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

test('structured translation extracts and chunks every paragraph without the old 28-block cap', () => {
  const html = Array.from({ length: 35 }, (_, index) => `<p>Paragraph ${index} contains enough English text to translate completely.</p>`).join('');
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const chunks = deepseek.__test.chunkTranslationBlocks(blocks);
  assert.equal(blocks.length, 35);
  assert.deepEqual(chunks.flat().map(block => block.i), Array.from({ length: 35 }, (_, index) => index));
});

test('short headings remain part of translation coverage', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks('<h2>Results</h2><p>A normal paragraph with enough text.</p>', '');
  assert.deepEqual(blocks.map(block => block.source), ['Results', 'A normal paragraph with enough text.']);
});

test('lecture action toolbars (Watch/PDF/Slides/Source) are kept as media blocks', () => {
  const html = `
    <div class="course-entry" id="lecture-2">
      <div>
        <h3>Lecture 2: IFT, Reward Models, &amp; Rejection Sampling</h3>
        <p class="meta">Chapters 4, 5, 9 · Start of the core optimization methods section</p>
      </div>
      <div class="talk-actions">
        <a href="https://www.youtube.com/watch?v=4gIwiSPmQkU" class="btn btn-watch">Watch</a>
        <a href="https://rlhfbook.com/lec2/slides.pdf" class="btn">PDF</a>
        <a href="https://rlhfbook.com/lec2/" class="btn">Slides</a>
        <a href="https://github.com/natolambert/rlhf-book" class="btn btn-source">Source</a>
      </div>
    </div>
    <h3>Lecture 3: RL Motivation</h3>
    <p class="meta">Chapter 6</p>
    <div class="talk-actions">
      <a href="https://www.youtube.com/watch?v=abc">Watch</a>
      <a href="https://example.com/a.pdf">PDF</a>
    </div>
  `;
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const media = blocks.filter(b => b.kind === 'media');
  const texts = blocks.filter(b => b.kind === 'text').map(b => b.source);
  assert.ok(texts.some(t => /Lecture 2/i.test(t)));
  assert.ok(texts.some(t => /Chapters 4, 5, 9/i.test(t)));
  assert.ok(media.length >= 2, `expected toolbar media blocks, got ${media.length}`);
  assert.ok(media.every(b => /<a\s/i.test(b.sourceHtml)));
  assert.ok(media.some(b => /youtube\.com\/watch\?v=4gIwiSPmQkU/i.test(b.sourceHtml)));
  assert.ok(media.some(b => /slides\.pdf/i.test(b.sourceHtml)));
  // 文档序：讲次标题后紧跟工具条
  const i2 = blocks.findIndex(b => /Lecture 2/i.test(b.source));
  const toolbarAfter = blocks.slice(i2, i2 + 4).find(b => b.kind === 'media' && /4gIwiSPmQkU/i.test(b.sourceHtml));
  assert.ok(toolbarAfter, 'toolbar should sit near Lecture 2 heading in block order');
});

test('a single oversized structure block is auto-split for translation', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks(`<p>${'Long sentence. '.repeat(1200)}</p>`, '');
  assert.ok(blocks.filter(b => b.kind === 'text').length > 1, 'should split huge paragraph');
  const chunks = deepseek.__test.chunkTranslationBlocks(blocks);
  assert.ok(chunks.flat().length > 1);
  const maxChars = deepseek.__test.TRANSLATION_SINGLE_BLOCK_MAX_CHARS;
  assert.ok(chunks.flat().every(b => deepseek.__test.translationBlockCost(b) <= maxChars * 1.15));
});

test('oversized table blocks from README-like HTML are auto-split under dual-output budget', () => {
  const rows = Array.from({ length: 80 }, (_, i) => (
    `<tr><td>Row ${i} name with enough English words to matter</td><td>${'detail text about feature '.repeat(8)}</td></tr>`
  )).join('');
  const html = `<section class="repo-readme"><h2>README</h2><table>${rows}</table><p>Footer paragraph with enough text.</p></section>`;
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const textBlocks = blocks.filter(b => b.kind === 'text');
  assert.ok(textBlocks.length > 3, `expected many text chunks after split, got ${textBlocks.length}`);
  assert.ok(textBlocks.every(b => deepseek.__test.translationBlockCost(b) <= deepseek.__test.TRANSLATION_SINGLE_BLOCK_MAX_CHARS * 1.15));
  // dual target+targetHtml 估算须压进 completion 安全顶，否则 custom 会 length→漏译
  assert.ok(textBlocks.every(b => {
    const est = Math.ceil(String(b.source || '').length * 4.5 + String(b.sourceHtml || '').length * 1.2) + 900;
    return est <= 9000;
  }), 'each block dual-output estimate should fit ~8k max_tokens');
  assert.doesNotThrow(() => deepseek.__test.chunkTranslationBlocks(blocks));
});

test('preformatted blocks keep newlines and closing tags intact', () => {
  const html = '<pre><code>const one = 1;\nconst two = 2;</code></pre><p>A normal paragraph with enough text.</p>';
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const code = blocks.find(block => block.kind === 'code');
  assert.ok(code);
  assert.match(code.sourceHtml, /\n/);
  assert.match(code.sourceHtml, /<\/pre>$/);
});

test('figure captions are translated as text while captionless figures remain media', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks([
    '<figure><img src="https://example.com/diagram.png"><figcaption>System architecture</figcaption></figure>',
    '<figure><img src="https://example.com/photo.png"></figure>',
    '<p>A normal paragraph.</p>',
  ].join(''), '');
  const captioned = blocks.find(block => block.source.includes('System architecture'));
  const captionless = blocks.find(block => block.sourceHtml.includes('photo.png'));
  assert.equal(captioned.kind, 'text');
  assert.equal(captioned.tag, 'figure');
  assert.equal(captionless.kind, 'media');
});

test('translation input hash changes when summary or body changes', () => {
  const base = { id: 'entry', title: 'A title', summary: 'Summary V1', content: '<p>Body V1 with enough text.</p>' };
  assert.notEqual(deepseek.translationInputHash(base), deepseek.translationInputHash({ ...base, summary: 'Summary V2' }));
  assert.notEqual(deepseek.translationInputHash(base), deepseek.translationInputHash({ ...base, content: '<p>Body V2 with enough text.</p>' }));
});

test('saving content without a translated title cannot bless an old title with a new hash', () => {
  const entryId = 'title-hash-regression';
  const oldTitle = 'Old English Headline';
  const newTitle = 'Completely New English Headline';
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: oldTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  store.saveTitleTranslations([{
    entryId,
    titleZh: '旧标题译文',
    titleHash: store.hashText(oldTitle),
  }]);
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: newTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  store.saveTranslation(entryId, {
    titleZh: '',
    summaryZh: '摘要',
    content: [{ i: 0, source: 'Original English body.', target: '完整中文正文。' }],
    contentHash: 'structured-v2-hash',
    titleHash: store.hashText(newTitle),
  });
  assert.deepEqual(store.getTitleTranslations([entryId]), {});
  assert.equal(store.getTranslation(entryId).titleZh, '');
});

test('stale or missing title hashes are hidden across entry, asset, profile, and notification reads', () => {
  const entryId = 'stale-title-read-paths';
  const oldTitle = 'Original Headline Before Refresh';
  const newTitle = 'Current Headline After Refresh';
  const staleTitleZh = '过期的中文标题';
  const user = store.createUser({
    email: 'title-gate@example.com',
    password: 'test-password-123',
    displayName: '标题测试者',
  });
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: oldTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);
  const saved = store.saveTranslation(entryId, {
    userId: user.id,
    titleZh: staleTitleZh,
    summaryZh: '摘要',
    content: [{ i: 0, source: 'Original English body.', target: '完整中文正文。' }],
    contentHash: 'structured-v2-hash',
    titleHash: store.hashText(oldTitle),
    createdBy: user.displayName,
  });
  store.createNotification({
    userId: user.id,
    type: 'title-gate-test',
    entryId,
    message: `有人反馈了你提交的链接：${staleTitleZh}`,
  });
  store.upsertEntries([{
    id: entryId,
    sourceId: 'test',
    title: newTitle,
    summary: 'Summary',
    content: '<p>Original English body.</p>',
  }]);

  // 详情/资产路径：hash 不对齐则隐藏 titleZh
  assert.equal(store.getEntry(entryId).titleZh, null);
  assert.equal(store.getEntryByIdPrefix('stale-title').titleZh, null);
  // 列表路径：有汉字的 title_zh 即使 hash 过期仍下发（避免略改英文标题后整卡回英文）
  assert.deepEqual(store.getTitleTranslations([entryId]), { [entryId]: staleTitleZh });
  assert.equal(store.getTranslation(entryId).titleZh, '');
  assert.equal(store.getAiAssetContribution(saved.id, 'translation').titleZh, '');
  assert.equal(store.getEntryAiAssetPreviews(entryId, 'translation')[0].title, '');
  assert.equal(store.getEntryAssetSummaries([entryId])[entryId].previews.translation.title, '');
  assert.equal(store.getUserTranslations(user.id)[0].titleZh, '');
  assert.equal(store.getUserTranslations(user.id)[0].entry.titleZh, null);
  const notification = store.getUserNotifications(user.id)[0];
  assert.equal(notification.entryTitle, newTitle);
  assert.doesNotMatch(notification.message, new RegExp(staleTitleZh));
  assert.match(notification.message, new RegExp(newTitle));

  store.saveTitleTranslations([{ entryId, titleZh: '无哈希标题', titleHash: '' }]);
  assert.equal(store.getEntry(entryId).titleZh, null);
  // 列表仍可展示含汉字的 title_zh
  assert.deepEqual(store.getTitleTranslations([entryId]), { [entryId]: '无哈希标题' });
});

test('stale translation is not reused as rewrite source', () => {
  const original = store.getTranslation;
  store.getTranslation = () => ({
    contentHash: 'old-hash',
    titleZh: '旧标题',
    content: [{ target: 'OLD TRANSLATION' }],
  });
  try {
    const source = deepseek.__test.rewriteSourceText({
      id: 'entry',
      sourceId: 'example',
      title: 'Current title',
      summary: 'Current summary',
      content: '<p>CURRENT V2 FACT with enough source text for the rewrite.</p>',
    });
    assert.notEqual(source.kind, '已有中文翻译');
    assert.match(source.text, /CURRENT V2 FACT/);
    assert.doesNotMatch(source.text, /OLD TRANSLATION/);
  } finally {
    store.getTranslation = original;
  }
});

test('finish_reason length rejects truncated model output', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '{"blocks":[]}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      deepseek.__test.postChatCompletion(providerConfig(), { messages: [{ role: 'user', content: 'test' }] }),
      /token 上限/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('translationChunkMaxTokens floors at 8k even when chat profile maxTokens is 2000', () => {
  const { translationChunkMaxTokens, TRANSLATION_MIN_OUTPUT_TOKENS } = deepseek.__test;
  const chunk = [
    { i: 0, source: 'A short English sentence about CUDA kernels.', sourceHtml: '<p>A short English sentence about CUDA kernels.</p>' },
  ];
  const n = translationChunkMaxTokens({ maxTokens: 2000 }, chunk);
  assert.ok(n >= TRANSLATION_MIN_OUTPUT_TOKENS, `expected >= ${TRANSLATION_MIN_OUTPUT_TOKENS}, got ${n}`);
  // dual 字段 + HTML：大块估算应显著高于旧 2.6× 公式
  const fat = [{
    i: 0,
    source: 'Word '.repeat(400),
    sourceHtml: `<p>${'Word '.repeat(400)}<a href="https://example.com/x">link</a></p>`,
  }];
  const fatTokens = translationChunkMaxTokens({ maxTokens: 2000 }, fat);
  assert.ok(fatTokens >= TRANSLATION_MIN_OUTPUT_TOKENS);
  assert.ok(fatTokens <= deepseek.__test.TRANSLATION_CHUNK_MAX_TOKENS);
});

test('custom provider uses smaller translation chunks than deepseek', () => {
  const { translationChunkOptsForConfig } = deepseek.__test;
  const custom = translationChunkOptsForConfig({ provider: 'custom' });
  const ds = translationChunkOptsForConfig({ provider: 'deepseek' });
  assert.ok(custom.maxChars < ds.maxChars);
  assert.ok(custom.maxBlocks <= ds.maxBlocks);
});

test('single-block finish_reason=length retries with higher budget then plain target', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  const block = {
    i: 0,
    kind: 'text',
    tag: 'p',
    source: 'CUDA makes it easier to write parallel programs on the GPU with kernels.',
    sourceHtml: '<p>CUDA makes it easier to write parallel programs on the GPU with kernels.</p>',
  };
  global.fetch = async (_url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    // 前两次模拟触顶；第三次纯文本成功
    if (calls < 3) {
      return openAiResponse('{"blocks":[]}', 'length');
    }
    assert.ok(body.max_tokens >= 3500);
    return openAiResponse(JSON.stringify({
      blocks: [{ i: 0, target: 'CUDA 让在 GPU 上用内核编写并行程序变得更容易。' }],
    }));
  };
  try {
    const result = await deepseek.__test.translateBlockChunk(
      providerConfig({ maxTokens: 2000, provider: 'custom', providerTitle: 'custom' }),
      { title: 'CUDA', summary: 'intro' },
      [block],
    );
    assert.equal(result.pairs.length, 1);
    assert.match(result.pairs[0].target, /CUDA|并行/);
    assert.equal(result.pending.length, 0);
    assert.ok(calls >= 3, `expected retries, got ${calls} calls`);
  } finally {
    global.fetch = originalFetch;
  }
});

test('origin-only OpenAI-compatible base URL appends /v1/chat/completions', () => {
  assert.equal(
    deepseek.__test.completionUrl({
      providerType: 'openai_compatible',
      baseUrl: 'https://llm-gateway.speediance.com',
    }),
    'https://llm-gateway.speediance.com/v1/chat/completions'
  );
  assert.equal(
    deepseek.__test.completionUrl({
      providerType: 'openai_compatible',
      baseUrl: 'https://api.deepseek.com/v1',
    }),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    deepseek.__test.modelsUrl({
      providerType: 'openai_compatible',
      baseUrl: 'https://llm-gateway.speediance.com',
    }),
    'https://llm-gateway.speediance.com/v1/models'
  );
});

test('server-owned DeepSeek credentials ignore caller base URLs and force the official endpoint', () => {
  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  };
  process.env.DEEPSEEK_API_KEY = 'server-owned-test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
  try {
    const config = deepseek.getConfig({
      provider: 'deepseek',
      baseUrl: 'https://attacker.example/v1',
      model: 'deepseek-v4-flash',
    });
    assert.equal(config.baseUrl, 'https://api.deepseek.com/v1');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.usesServerDeepSeekKey, true);
  } finally {
    if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previous.model;
  }
});

test('server-owned DeepSeek credentials reject Pro and legacy model overrides', () => {
  const previous = {
    key: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  };
  process.env.DEEPSEEK_API_KEY = 'server-owned-test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
  try {
    for (const model of ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']) {
      assert.throws(
        () => deepseek.getConfig({ provider: 'deepseek', model }),
        /只允许使用 deepseek-v4-flash/
      );
    }
  } finally {
    if (previous.key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previous.model;
  }
});

test('BYOK custom providers keep their caller-owned routing', () => {
  // 使用可公网解析的 example.com（gateway.example 会在 DNS 校验阶段 422）
  const config = deepseek.getConfig({
    apiKey: 'caller-owned-test-key',
    provider: 'openai-compatible',
    providerName: 'Caller gateway',
    baseUrl: 'https://example.com/v1',
    model: 'caller-model',
  });
  assert.equal(config.baseUrl, 'https://example.com/v1');
  assert.equal(config.model, 'caller-model');
  assert.equal(config.usesServerDeepSeekKey, false);
});

test('BYOK DeepSeek is also restricted to the official endpoint and V4 Flash', () => {
  assert.throws(
    () => deepseek.getConfig({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
    }),
    /只允许使用 deepseek-v4-flash/
  );
  assert.throws(
    () => deepseek.getConfig({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://example.com/v1',
      model: 'deepseek-v4-flash',
    }),
    /只能请求 https:\/\/api\.deepseek\.com/
  );
});

test('DeepSeek model discovery exposes V4 Flash only', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro' },
      { id: 'deepseek-chat' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await deepseek.listModels({
      apiKey: 'caller-owned-test-key',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
    });
    assert.deepEqual(result.models, ['deepseek-v4-flash']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('5xx HTML responses are retried once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('<html><body>temporary upstream failure</body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html', 'retry-after': '0' },
      });
    }
    return openAiResponse('complete');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('response body read failures are retried once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'retry-after': '0' }),
        text: async () => { throw new TypeError('socket closed while reading'); },
      };
    }
    return openAiResponse('complete');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('DeepSeek insufficient_system_resource discards partial output and retries once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? openAiResponse('partial result', 'insufficient_system_resource', { 'retry-after': '0' })
      : openAiResponse('complete result');
  };
  try {
    assert.equal(await deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), 'complete result');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Anthropic pause_turn discards partial output and retries once', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    const body = calls === 1
      ? { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'partial result' }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'complete result' }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
    });
  };
  try {
    const config = providerConfig({ providerType: 'anthropic_compatible' });
    assert.equal(await deepseek.__test.postChatCompletion(config, { messages: [] }), 'complete result');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('filtered, tool-call and refused responses fail explicitly', async (t) => {
  const originalFetch = global.fetch;
  try {
    await t.test('content_filter', async () => {
      global.fetch = async () => openAiResponse('partial', 'content_filter');
      await assert.rejects(deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), /内容过滤器/);
    });
    await t.test('tool_calls', async () => {
      global.fetch = async () => openAiResponse('partial', 'tool_calls');
      await assert.rejects(deepseek.__test.postChatCompletion(providerConfig(), { messages: [] }), /工具调用/);
    });
    await t.test('refusal', async () => {
      global.fetch = async () => new Response(JSON.stringify({
        stop_reason: 'refusal',
        content: [{ type: 'text', text: 'refused' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      const config = providerConfig({ providerType: 'anthropic_compatible' });
      await assert.rejects(deepseek.__test.postChatCompletion(config, { messages: [] }), /拒绝/);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('interrupted rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'interrupted-rewrite',
    sourceId: 'test',
    title: 'Interrupted Rewrite Test',
    summary: 'A sufficiently detailed summary for rewrite testing.',
    content: '<p>A sufficiently detailed English paragraph for rewrite testing.</p>',
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('partial rewrite', 'content_filter');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /内容过滤器/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('normal stop refusal rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'refused-stop-rewrite',
    sourceId: 'test',
    title: 'Normal Stop Refusal Test',
    summary: 'A detailed source summary that should produce a real Chinese article.',
    content: `<p>${'Substantive source material with concrete product facts and limitations. '.repeat(20)}</p>`,
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('抱歉，无法处理这篇文章。', 'stop');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /模型返回了拒答.*未保存不完整结果/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('pathologically short normal stop rewrite output is never persisted', async () => {
  const originalFetch = global.fetch;
  const entry = {
    id: 'short-stop-rewrite',
    sourceId: 'test',
    title: 'Normal Stop Short Rewrite Test',
    summary: 'A detailed source summary that should produce a real Chinese article.',
    content: `<p>${'Substantive source material with concrete product facts, usage scenarios, tradeoffs, and limitations. '.repeat(80)}</p>`,
  };
  store.upsertEntries([entry]);
  global.fetch = async () => openAiResponse('这是一个产品介绍。', 'stop');
  try {
    await assert.rejects(deepseek.rewriteEntry(entry, providerConfig()), /中文正文过短.*未保存不完整结果/);
    assert.equal(store.getRewrite(entry.id), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rewrite quality uses source length and paragraph coverage without rejecting substantive Chinese output', () => {
  const longSource = 'Detailed English source material with facts, scenarios, tradeoffs, and limitations. '.repeat(50);
  const oneParagraph = '这是一段包含真实事实、使用场景、优点、限制和明确判断的中文正文。'.repeat(20);
  const complete = [
    '这个产品解决的是团队反复整理资料的问题。它把输入内容转换成结构化结果，并保留关键来源。'.repeat(4),
    '实际使用时，最适合需要持续处理大量信息的研究和内容团队。用户仍要核对事实与链接。'.repeat(4),
    '它的价值在于减少机械整理，但不能替代人工判断。建议先用一组真实材料验证准确率和边界。'.repeat(4),
  ].join('\n\n');
  const shortResult = deepseek.__test.rewriteQuality(longSource, '只有一句。');
  const oneParagraphResult = deepseek.__test.rewriteQuality(longSource, oneParagraph);
  const completeResult = deepseek.__test.rewriteQuality(longSource, complete);
  const aiRefusalResult = deepseek.__test.rewriteQuality(longSource, '> 作为 AI，我无法处理这项改写。');
  assert.equal(shortResult.ok, false);
  assert.match(shortResult.reason, /中文正文过短/);
  assert.equal(oneParagraphResult.ok, false);
  assert.match(oneParagraphResult.reason, /正文段落不足/);
  assert.equal(aiRefusalResult.ok, false);
  assert.match(aiRefusalResult.reason, /模型返回了拒答/);
  assert.equal(completeResult.ok, true);
});

test('validated Product Hunt official context uses the ph-official-v2 rewrite hash namespace', () => {
  const base = {
    id: 'producthunt-hash-v2',
    sourceId: 'producthunt',
    title: 'Useful Product',
    link: 'https://www.producthunt.com/posts/useful-product',
    summary: 'A short Product Hunt teaser.',
    content: '<p>A short Product Hunt RSS teaser.</p>',
  };
  const officialSiteContext = {
    url: 'https://useful.example.com/',
    title: 'Useful Product official site',
    summary: 'Official product details with concrete positioning and audience information. '.repeat(3),
    content: '<p>Official documentation describing workflows, limitations, integrations, and intended users in enough detail.</p>',
    fetchedVia: 'direct',
  };
  const rssOnlyHash = deepseek.rewriteContentHash(base);
  const officialHash = deepseek.rewriteContentHash({ ...base, officialSiteContext });
  const legacyOfficialHash = officialHash.slice('ph-official-v2:'.length);
  const productHuntPageHash = deepseek.rewriteContentHash({
    ...base,
    officialSiteContext: { ...officialSiteContext, url: 'https://www.producthunt.com/posts/useful-product' },
  });
  const thinOfficialHash = deepseek.rewriteContentHash({
    ...base,
    officialSiteContext: { ...officialSiteContext, summary: 'Too short', content: '<p>Thin.</p>' },
  });
  assert.doesNotMatch(rssOnlyHash, /^ph-official-v2:/);
  assert.match(officialHash, /^ph-official-v2:[a-f0-9]+$/);
  assert.notEqual(officialHash, rssOnlyHash);
  assert.doesNotMatch(legacyOfficialHash, /^ph-official-v2:/);
  assert.notEqual(officialHash, legacyOfficialHash);
  assert.equal(productHuntPageHash, rssOnlyHash);
  assert.equal(thinOfficialHash, rssOnlyHash);
});

test('missing translated blocks are returned as pending for single-block retry', async () => {
  const originalFetch = global.fetch;
  const responseBody = JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ blocks: [{ i: 0, target: '第一段' }] }) } }],
  });
  global.fetch = async () => new Response(responseBody, { status: 200, headers: { 'content-type': 'application/json' } });
  const chunk = [
    { i: 0, tag: 'p', kind: 'text', source: 'First English paragraph.', sourceHtml: '<p>First English paragraph.</p>' },
    { i: 1, tag: 'p', kind: 'text', source: 'Second English paragraph.', sourceHtml: '<p>Second English paragraph.</p>' },
  ];
  try {
    const result = await deepseek.__test.translateBlockChunk(providerConfig(), { title: 'Title', summary: '' }, chunk);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].i, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].i, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('table/list blocks never demote to bare paragraphs when oversized', () => {
  // 无链接的大纯文本表：仍按行拆，且保持 table（非 catalog）
  const rows = Array.from({ length: 40 }, (_, i) => (
    `<tr><td>Row ${i} title phrase</td><td>${'detail words enough '.repeat(20)}</td></tr>`
  )).join('');
  const blocks = deepseek.__test.htmlToTranslationBlocks(`<table>${rows}</table>`, '');
  const textBlocks = blocks.filter(b => b.kind === 'text');
  assert.ok(textBlocks.length > 1);
  assert.ok(textBlocks.every(b => b.tag === 'table'), 'table splits must stay table');
  assert.ok(textBlocks.every(b => /<table[\s>]/i.test(b.sourceHtml || '')));
  assert.ok(textBlocks.every(b => !deepseek.__test.isCatalogDataTableBlock(b)));
});

test('course schedule tables are not catalog (must translate lecture titles)', () => {
  const rows = Array.from({ length: 20 }, (_, i) => (
    `<tr><td>${i}</td><td>Mon March ${i}</td><td>Overview, tokenization lecture ${i}</td>`
    + `<td><a href="https://example.com/l${i}.pdf">lecture_${i}.pdf</a></td>`
    + `<td>Assignment due</td></tr>`
  )).join('');
  const html = `<table><thead><tr><th>#</th><th>Date</th><th>Description</th>`
    + `<th>Course Materials</th><th>Deadlines</th></tr></thead><tbody>${rows}</tbody></table>`;
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const tables = blocks.filter(b => b.tag === 'table');
  assert.ok(tables.length >= 1);
  assert.ok(tables.every(t => deepseek.__test.isCourseScheduleTableBlock(t)), 'every piece is schedule');
  assert.ok(tables.every(t => !deepseek.__test.isCatalogDataTableBlock(t)), 'schedule must not passthrough');
  // 课表按 1–2 行拆，片数应更多
  assert.ok(tables.length >= 8, `expected many small schedule pieces, got ${tables.length}`);
  // 可拆片，但合并后应恢复完整行数
  const merged = deepseek.__test.mergeAdjacentTranslatedTables(tables.map((t, i) => ({
    ...t,
    i,
    target: t.source,
    targetHtml: t.sourceHtml,
  })));
  assert.equal(merged.length, 1);
  assert.ok((merged[0].targetHtml.match(/<tr\b/gi) || []).length >= 20);
});

test('schedule residual english detection and polish', () => {
  assert.equal(
    deepseek.__test.scheduleTextHasResidualEnglish(
      '日期 主题 主题 1：运行大模型 演示：概述',
    ),
    false,
  );
  assert.equal(
    deepseek.__test.scheduleTextHasResidualEnglish(
      'Date Topic / Deadlines Tue 27 Jan Topic 3: Agent Tool Use Presentation : Tools Class is online',
    ),
    true,
  );
  assert.equal(
    deepseek.__test.scheduleTextHasResidualEnglish(
      '日期 描述 Thu Sep 25 Models, Prompting and RAG LLM power and limitations Prompting techniques Slides Homework 1',
    ),
    true,
  );
  // 工具条 + URL 不应误报
  assert.equal(
    deepseek.__test.scheduleTextHasResidualEnglish(
      '<div class="translation-link-toolbar"><a href="https://example.edu/x">打开大纲</a></div>日期 主题 1：概述',
    ),
    false,
  );
  const polished = deepseek.__test.polishScheduleTranslationText(
    'Date Topic / Deadlines Presentation : Tools Paper : Toolformer home page sign up',
  );
  assert.match(polished, /日期/);
  assert.match(polished, /演示：/);
  assert.match(polished, /论文：/);
  assert.match(polished, /主页/);
  assert.match(polished, /注册/);
});

test('omitQuotes drops deleted blocks from translation input', () => {
  const blocks = deepseek.__test.htmlToTranslationBlocks(
    '<p>Delete me completely please now.</p><p>Keep this systems paragraph for sure.</p><p>Also remove this trailer text.</p>',
    '',
  );
  const omitted = deepseek.__test.applyOmitQuotesToBlocks(blocks, [
    'Delete me completely please now.',
    'Also remove this trailer text.',
  ]);
  assert.deepEqual(omitted.map(b => b.source), ['Keep this systems paragraph for sure.']);
  assert.equal(omitted[0].i, 0);
});

test('catalog data tables are detected for passthrough (AgentsMeetRL style)', () => {
  const html = `<table><thead><tr><th>Github Repo</th><th>RL Algorithm</th><th>Tool usage</th></tr></thead>
    <tbody>
      <tr><td><a href="https://github.com/a/Tool-RL-Box">Tool-RL-Box</a></td><td>GRPO</td><td>Yes</td></tr>
      <tr><td><a href="https://github.com/a/SPADER">SPADER</a></td><td>GRPO+SPA</td><td>Search</td></tr>
      <tr><td><a href="https://github.com/a/APPO">APPO</a></td><td>APPO</td><td>Search+code</td></tr>
      <tr><td><a href="https://github.com/a/X">X</a></td><td>PPO</td><td>Yes</td></tr>
    </tbody></table>`;
  const blocks = deepseek.__test.htmlToTranslationBlocks(html, '');
  const table = blocks.find(b => b.tag === 'table');
  assert.ok(table);
  assert.equal(deepseek.__test.isCatalogDataTableBlock(table), true);
  // 模型若回 p 墙，验收必须回退到源 table
  const translated = new Map();
  deepseek.__test.acceptTranslatedBlock(table, {
    i: table.i,
    target: 'Github仓库 RL算法 工具使用 Tool-RL-Box GRPO 是 SPADER GRPO 搜索',
    targetHtml: '<p>Github仓库 RL算法 工具使用 Tool-RL-Box GRPO 是 SPADER GRPO 搜索</p>',
  }, translated);
  const pair = translated.get(table.i);
  assert.match(pair.targetHtml, /<table[\s>]/i);
  assert.doesNotMatch(pair.targetHtml, /^<p[\s>]/i);
  assert.match(pair.targetHtml, /Tool-RL-Box/);
});

test('acceptTranslatedBlock rebuilds list/table HTML instead of empty targetHtml', () => {
  const translated = new Map();
  const ulBlock = {
    i: 0,
    tag: 'ul',
    kind: 'text',
    source: 'Base Framework: general RL. Search & RAG: retrieval agents.',
    sourceHtml: '<ul><li><strong>Base Framework</strong>: general RL</li><li><strong>Search &amp; RAG</strong>: retrieval</li></ul>',
  };
  assert.equal(deepseek.__test.acceptTranslatedBlock(ulBlock, {
    i: 0,
    target: '基础框架：通用强化学习。检索增强：检索智能体。',
    targetHtml: '', // 模型漏 HTML
  }, translated), true);
  const ul = translated.get(0);
  assert.match(ul.targetHtml, /<ul[\s>]/i);
  assert.match(ul.targetHtml, /<li[\s>]/i);

  translated.clear();
  const tableBlock = {
    i: 1,
    tag: 'table',
    kind: 'text',
    source: 'Github Repo Date AgentJet 2026.6',
    sourceHtml: '<table><tr><th>Github Repo</th><th>Date</th></tr><tr><td><a href="https://github.com/a/b">AgentJet</a></td><td>2026.6</td></tr></table>',
  };
  // 模型回了残缺 table（多 tbody、少链接）——宽松验收应仍保留 table
  assert.equal(deepseek.__test.acceptTranslatedBlock(tableBlock, {
    i: 1,
    target: 'Github 仓库 日期 AgentJet 2026.6',
    targetHtml: '<table><tbody><tr><th>Github 仓库</th><th>日期</th></tr><tr><td>AgentJet</td><td>2026.6</td></tr></tbody></table>',
  }, translated), true);
  assert.match(translated.get(1).targetHtml, /<table[\s>]/i);
  assert.doesNotMatch(translated.get(1).targetHtml, /^<p>/i);
});

test('model HTML must preserve source links and images', () => {
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources(
      '<p><a href="https://example.com">Example</a><img src="https://example.com/a.png"></p>',
      '<p><a href="https://example.com">示例</a><img src="https://example.com/a.png"></p>'
    ),
    true
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources(
      '<p><a href="https://example.com">Example</a></p>',
      '<p>示例</p>'
    ),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesResources('<p>No resources</p>', '<p><img src="https://evil.example/a.png"></p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure('<ul><li>One</li></ul>', '<p>一</p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure('<h2><strong>Results</strong><br></h2>', '<p>结果</p>'),
    false
  );
  assert.equal(
    deepseek.__test.translationHtmlPreservesStructure(
      '<figure><img src="https://example.com/a.png"><figcaption>Caption</figcaption></figure>',
      '<figure><img src="https://example.com/a.png"><figcaption>说明</figcaption></figure>'
    ),
    true
  );
  assert.equal(deepseek.__test.translationHtmlMatchesTarget('完整中文译文', '<p>完整中文译文</p>'), true);
  assert.equal(deepseek.__test.translationHtmlMatchesTarget('完整中文译文', '<p>partial</p>'), false);
});

test('translation HTML strips untrusted presentation attributes but preserves required resources', () => {
  const clean = deepseek.__test.sanitizeTranslationHtml([
    '<p id="overlay" class="takeover" style="position:fixed" onclick="bad()">',
    '<a href="https://example.com" title="Example" target="_blank">示例</a>',
    '<img src="https://example.com/a.png" alt="图" srcset="https://evil.example/a.png 2x">',
    '</p>',
  ].join(''));
  assert.doesNotMatch(clean, /\b(?:id|class|style|onclick|target|srcset)=/i);
  assert.match(clean, /href="https:\/\/example\.com"/);
  assert.match(clean, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(clean, /alt="图"/);
});

test('sanitizeTranslationHtml strips javascript: and data: href/src', () => {
  const clean = deepseek.__test.sanitizeTranslationHtml([
    '<p><a href="javascript:alert(1)">坏链</a>',
    '<a href="JAVASCRIPT:void(0)">坏链2</a>',
    '<a href="https://example.com/safe">安全</a>',
    '<img src="data:text/html,x" alt="bad">',
    '<img src="https://example.com/a.png" alt="ok">',
    '</p>',
  ].join(''));
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /href=["']data:/i);
  assert.doesNotMatch(clean, /src=["']data:/i);
  assert.match(clean, /href="https:\/\/example\.com\/safe"/);
  assert.match(clean, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(clean, />坏链</);
});

test('translation text coverage rejects pathological one-line omissions', () => {
  const source = 'This paragraph contains a substantial amount of factual English source material. '.repeat(12);
  assert.equal(deepseek.__test.translationTextHasCoverage(source, '已译'), false);
  assert.equal(deepseek.__test.translationTextHasCoverage(source, '这是一段保留了原文主要事实与完整含义的中文翻译。'.repeat(8)), true);
});

test('pathologically short block translations stay pending after the targeted retry', async () => {
  const originalFetch = global.fetch;
  const source = 'This paragraph contains a substantial amount of factual English source material. '.repeat(12);
  global.fetch = async () => openAiResponse(JSON.stringify({
    blocks: [{ i: 0, target: '已译', targetHtml: '<p>已译</p>' }],
  }));
  try {
    const result = await deepseek.__test.translateBlockChunk(providerConfig(), { title: 'Title', summary: '' }, [{
      i: 0,
      tag: 'p',
      kind: 'text',
      source,
      sourceHtml: `<p>${source}</p>`,
    }]);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].i, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('mixed English and Chinese titles are translated, identifiers are not retried forever', () => {
  assert.equal(deepseek.needsTitleTranslation('OpenAI launches GPT-5：新模型'), true);
  assert.equal(deepseek.needsTitleTranslation('Self-Hosting'), true);
  assert.equal(deepseek.needsTitleTranslation('Introducing-GPT-5'), true);
  assert.equal(deepseek.needsTitleTranslation('firecrawl/firecrawl'), false);
  assert.equal(deepseek.needsTitleTranslation('GPT-5'), false);
});

test('soft-deleted entries stay deleted across forceContent upsert (no revive)', () => {
  const id = store.hashText('soft-delete-stickiness-test').slice(0, 32);
  store.upsertEntries([{
    id,
    sourceId: 'qingkeai',
    title: 'LAWAM soft-delete stickiness',
    link: 'https://example.com/archives/LAWAM-stickiness',
    content: '<p>initial body</p>',
    summary: 'initial',
    publishedTs: Date.now(),
  }]);
  assert.ok(store.getEntry(id));
  const deleted = store.softDeleteEntry(id, { userId: 'test', reason: 'unit test soft delete' });
  assert.equal(deleted.alreadyDeleted, false);
  assert.equal(store.isEntryDeleted(id), true);
  assert.equal(store.getEntry(id), null);

  // 模拟 RSS 原文补全 / likes 扫盘：forceContent 曾会清空 deleted_at
  store.upsertEntries([{
    id,
    sourceId: 'qingkeai',
    title: 'LAWAM soft-delete stickiness',
    link: 'https://example.com/archives/LAWAM-stickiness',
    content: '<p>revived full body should not reappear</p>',
    summary: 'revived',
    forceContent: true,
    publishedTs: Date.now(),
  }]);
  assert.equal(store.isEntryDeleted(id), true);
  assert.equal(store.getEntry(id), null);
});
test('qm-social (X likes) entries translate the markdown body, never the JSON metadata header', () => {
  const payload = JSON.stringify({
    v: 1,
    platform: 'x',
    kind: 'article',
    author: 'DAN KOE',
    title: 'How to focus',
    body: '# How to focus\n\n- Inline copy of body inside metadata.',
  });
  const content = `<!--qm-social-v1\n${payload}\n-->\n\n# How to focus\n\n- First point with enough English text to translate properly.\n\nSecond paragraph with plenty of additional English words to translate.`;
  const stripped = deepseek.stripSocialMetaComment(content);
  assert.ok(stripped.startsWith('# How to focus'));
  const blocks = deepseek.__test.htmlToTranslationBlocks(content, '');
  assert.ok(blocks.length >= 3);
  assert.equal(blocks[0].source, 'How to focus');
  assert.ok(blocks.every(block => !/qm-social|"platform"|DAN KOE/.test(block.source || '')));
});

test('stripSocialMetaComment falls back to payload body when no external markdown follows', () => {
  const payload = JSON.stringify({ v: 1, platform: 'x', body: 'Only body inside JSON metadata.' });
  const content = `<!--qm-social-v1\n${payload}\n-->`;
  assert.equal(deepseek.stripSocialMetaComment(content), 'Only body inside JSON metadata.');
  // 非 qm-social 内容原样返回
  assert.equal(deepseek.stripSocialMetaComment('<p>plain html</p>'), '<p>plain html</p>');
});
