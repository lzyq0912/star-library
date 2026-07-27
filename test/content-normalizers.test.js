const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeArthurChiao,
  normalizeKarpathy,
  normalizeLilianWeng,
  normalizeMaarten,
  normalizeZhihu,
  normalizeBySource,
  stripSubstackAuthorDateByline,
} = require('../public/content-normalizers.js');

test('Maarten / Substack strips author link + date byline from body', () => {
  const input = [
    '<h1>A Visual Guide to Gemma 4 12B</h1>',
    '<h3>A unified model!</h3>',
    '<a href="https://substack.com/@maartengrootendorst" target="_blank">Maarten Grootendorst</a>Jun 03, 2026',
    '<p>A new Gemma 4 model has been released.</p>',
  ].join('');
  const output = normalizeMaarten(input);
  assert.doesNotMatch(output, /Maarten\s+Grootendorst/i);
  assert.doesNotMatch(output, /Jun\s+03,\s+2026/i);
  assert.doesNotMatch(output, /substack\.com\/@maartengrootendorst/i);
  assert.match(output, /A new Gemma 4 model has been released/);
  assert.equal(
    stripSubstackAuthorDateByline('Maarten Grootendorst Jun 10, 2026<p>Hi</p>'),
    '<p>Hi</p>',
  );
  assert.doesNotMatch(
    stripSubstackAuthorDateByline('副标题。Maarten Grootendorst 2026年6月10日 正文开始'),
    /Grootendorst|2026年6月10日/,
  );
  assert.equal(
    normalizeBySource(input, 'maarten').includes('Grootendorst'),
    false,
  );
});

test('ArthurChiao normalization restores lists, headings, inline code, and removes the scraped TOC', () => {
  const input = [
    '[译者序](https://arthurchiao.art#译者序)[1 Reasoning](https://arthurchiao.art#1)[2 Agentic](https://arthurchiao.art#2)',
    '',
    '- 训练理念：为了想得更久； - 训练对象：**模型+环境**（）；`Agent+Harness`',
    '',
    '- 关注的多样性：**环境多样性**。',
    '',
    '`o1`',
    '',
    '证明了 ** “thinking” 可以是一等能力 **。',
    '一种可以**专门训练**的能力，也是一个**基础设施叙事**。',
    '',
    '- reasoning 时代； - agentic 时代。',
    '',
    '## 1.2 DeepSeek-R1：对 `thinking`',
    '',
    '能力的复现和扩展',
  ].join('\n');
  const output = normalizeArthurChiao(input);
  assert.match(output, /^---$/m);
  assert.doesNotMatch(output, /arthurchiao\.art#/);
  assert.match(output, /- 训练理念：为了想得更久；\n- 训练对象：<strong>模型\+环境<\/strong>（`Agent\+Harness`）/);
  assert.match(output, /- 训练对象：<strong>模型\+环境<\/strong>（`Agent\+Harness`）\n- 关注的多样性/);
  assert.match(output, /`o1` 证明了 <strong>“thinking” 可以是一等能力<\/strong>。/);
  assert.match(output, /一种可以 <strong>专门训练<\/strong> 的能力，也是一个 <strong>基础设施叙事<\/strong>。/);
  assert.match(output, /- reasoning 时代；\n- agentic 时代。/);
  assert.match(output, /^## 1\.2 DeepSeek-R1：对 `thinking` 能力的复现和扩展$/m);
});

test('Karpathy normalization removes empty hero bullets and rejoins inline code sentences', () => {
  const input = [
    '# Auto-grading', '', '*', '*', '',
    'TLDR: https://karpathy.ai/hncapsule/', '',
    'Future LLMs**are**watching.', '',
    '- Host all the intermediate results of the',
    '`data`', '',
    "directory. It's the file`data.zip`", '',
    'under the same prefix.', '',
    'Running the analysis meant `31 * 30 =`', '',
    '930 LLM queries.',
  ].join('\n');
  const output = normalizeKarpathy(input);
  assert.doesNotMatch(output, /^\*$/m);
  assert.match(output, /TLDR: https:\/\/karpathy\.ai\/hncapsule\/\n\n---/);
  assert.match(output, /Future LLMs <strong>are<\/strong> watching\./);
  assert.match(output, /- Host all the intermediate results of the `data` directory\. It's the file `data\.zip` under the same prefix\./);
  assert.match(output, /`31 \* 30 =` 930 LLM queries\./);
});

test('Lil Log normalization rejoins captions, inline code, and compressed list stages', () => {
  const input = [
    '# Harness Design Patterns[#](https://lilianweng.github.io#harness-design-patterns)', '',
    '![](/figure.png)', '', '(Image source:', '', '[OpenAI post](https://openai.com/post))', '',
    'Learning how to use `bash`', '', 'commands is useful.', '',
    '*Generator*: produce trajectories.*Reflector*: inspect failures.*Curator*: update context.', '',
    '- First workflow step.', '', '- Second workflow step.', '',
    '- The agent uses commands like', '`grep`', '', 'or`cat`', '',
    'to inspect files. - The proposed harness is persisted.',
  ].join('\n');
  const output = normalizeLilianWeng(input);
  assert.match(output, /^# Harness Design Patterns$/m);
  assert.doesNotMatch(output, /\[#\]/);
  assert.match(output, /!\[]\(\/figure\.png\)\n\n\*Image source: \[OpenAI post\]\(https:\/\/openai\.com\/post\)\*/);
  assert.match(output, /`bash` commands is useful\./);
  assert.match(output, /- \*Generator\*: produce trajectories\.\n- \*Reflector\*: inspect failures\.\n- \*Curator\*: update context\./);
  assert.match(output, /- First workflow step\.\n- Second workflow step\./);
  assert.match(output, /- The agent uses commands like `grep` or `cat` to inspect files\.\n- The proposed harness is persisted\./);
});

test('Zhihu normalization fixes series links, heading bold, math spacing, think tags, and emphasis', () => {
  const input = [
    '## **一、混合注意力**',
    '',
    '使用当前模型  $\\pi_{\\theta_k}$  \u200b\u200b 进行多轮采样。',
    '',
    '其中 **trainer**和**rollout**分别指训练与生成。',
    '',
    '加粗公式 **   $\\theta_{0}$   ** 相关的 kv cache。',
    '',
    '【大模型计算加速系列】[猛猿：FlashAttention V1](https://zhuanlan.zhihu.com/p/1)[猛猿：FlashAttention V2](https://zhuanlan.zhihu.com/p/2)[猛猿：vLLM](https://zhuanlan.zhihu.com/p/3)',
    '',
    '| 模式 | 格式 |',
    '| --- | --- |',
    '| Non-think | </think> summary |',
    '| Think High | <think> ... </think> summary |',
    '',
    '- 第一点。 - 第二点也重要。',
    '',
    '![a](/article-images/zhihu-tianqing/x/a.jpg)',
    '![b](/article-images/zhihu-tianqing/x/b.jpg)',
  ].join('\n');

  const output = normalizeZhihu(input);

  assert.match(output, /^## 一、混合注意力$/m);
  assert.match(output, /使用当前模型 \$\\pi_\{\\theta_k\}\$ 进行多轮采样/);
  assert.doesNotMatch(output, /\u200b/);
  assert.match(output, /其中 <strong>trainer<\/strong> 和 <strong>rollout<\/strong> 分别指训练与生成/);
  assert.match(output, /加粗公式 \$\\theta_\{0\}\$ 相关的 kv cache/);
  assert.match(output, /【大模型计算加速系列】\n\n\[猛猿：FlashAttention V1\]/);
  assert.match(output, /\[猛猿：FlashAttention V1\]\([^\)]+\)\n\[猛猿：FlashAttention V2\]/);
  assert.match(output, /`<\/think>` summary/);
  assert.match(output, /`<think>` \.\.\. `<\/think>` summary/);
  assert.match(output, /- 第一点。\n- 第二点也重要。/);
  assert.match(output, /!\[a\]\([^\)]+\)\n\n!\[b\]\([^\)]+\)/);

  assert.equal(
    normalizeBySource('## **标题**\n\nx', 'zhihu-tianqing'),
    normalizeZhihu('## **标题**\n\nx'),
  );
  assert.equal(normalizeBySource('plain', 'qingkeai'), 'plain');
});
