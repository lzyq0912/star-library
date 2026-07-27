/*
 * 在已登录知乎的浏览器开发者控制台运行一次即可（推荐 www.zhihu.com 任意已登录页）：
 *   - 滚动 5 个作者「文章」页收集链接
 *   - 同页 fetch 专栏正文（不跨子域跳转，避免 Firefox 清空 window.name）
 *   - 按 2023-07-14 截止过滤后下载 zhihu-browser-export.jsonl
 *
 * 登录态始终留在浏览器内；导出结果不包含 Cookie、localStorage 或请求头。
 */
(async () => {
  const PROFILES = [
    { source_id: 'zhihu-tianqing', token: 'tian-qing-71-69', url: 'https://www.zhihu.com/people/tian-qing-71-69/posts' },
    { source_id: 'zhihu-lemonround', token: 'lemonround', url: 'https://www.zhihu.com/people/lemonround/posts' },
    { source_id: 'zhihu-fafa', token: 'fa-fa-1-94', url: 'https://www.zhihu.com/people/fa-fa-1-94/posts' },
    { source_id: 'zhihu-yuanchao', token: 'yuan-chao-yi-83', url: 'https://www.zhihu.com/people/yuan-chao-yi-83/posts' },
    { source_id: 'zhihu-tongsanpang', token: 'tongsanpang', url: 'https://www.zhihu.com/people/tongsanpang/posts' },
  ];
  const CUTOFF = Date.parse('2023-07-14T00:00:00+08:00');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const articleUrl = value => {
    try {
      const parsed = new URL(value, location.href);
      const match = parsed.pathname.match(/^\/p\/(\d+)/);
      return match ? `https://zhuanlan.zhihu.com/p/${match[1]}` : '';
    } catch {
      return '';
    }
  };
  const waitFor = async (test, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const value = test();
        if (value) return value;
      } catch { /* 页面仍在切换 */ }
      await sleep(250);
    }
    throw new Error('等待知乎页面超时');
  };
  const deepFindArticle = (root, articleId) => {
    const queue = [root];
    const visited = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      if (String(value.id || '') === articleId && typeof value.content === 'string' && value.content.length >= 80) {
        return value;
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }
    return null;
  };
  const downloadText = (filename, text, mime) => {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([text], { type: mime }));
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 30000);
  };

  if (!/(^|\.)zhihu\.com$/i.test(location.hostname)) {
    throw new Error('请在 www.zhihu.com 或 zhuanlan.zhihu.com 已登录页面运行');
  }

  // --- 阶段 1：同域 iframe 滚动作者页，收集链接 ---
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:960px;height:720px;opacity:.01;pointer-events:none;z-index:-1';
  document.body.appendChild(frame);
  const popup = frame.contentWindow;
  if (!popup) throw new Error('无法创建知乎采集页面');

  const links = [];
  for (const profile of PROFILES) {
    popup.location.href = profile.url;
    await waitFor(() => popup.location.pathname.includes(`/people/${profile.token}/`) && popup.document.readyState === 'complete');
    await sleep(1200);
    const seen = new Map();
    let stableRounds = 0;
    let previousHeight = 0;
    for (let round = 0; round < 180 && stableRounds < 5; round += 1) {
      for (const anchor of popup.document.querySelectorAll('a[href*="/p/"]')) {
        const url = articleUrl(anchor.href);
        if (!url) continue;
        const card = anchor.closest('.List-item, .ContentItem, article') || anchor.parentElement;
        const title = (anchor.textContent || card?.querySelector('h2,h3')?.textContent || '').trim();
        if (!seen.has(url) || title.length > (seen.get(url).title || '').length) {
          seen.set(url, { url, title });
        }
      }
      const height = popup.document.documentElement.scrollHeight;
      popup.scrollTo(0, height);
      await sleep(1100);
      const nextHeight = popup.document.documentElement.scrollHeight;
      stableRounds = nextHeight <= height && height === previousHeight ? stableRounds + 1 : 0;
      previousHeight = height;
    }
    for (const item of seen.values()) {
      links.push({ ...item, source_id: profile.source_id, source_seed: profile.url });
    }
    console.info(`[Zen Zhihu] ${profile.source_id}: ${seen.size} links`);
  }
  frame.remove();

  const unique = [...new Map(links.map(item => [`${item.source_id}|${item.url}`, item])).values()];
  if (!unique.length) {
    throw new Error('没有发现文章链接；请确认知乎登录态和“文章”页可以正常显示');
  }
  console.info(`[Zen Zhihu] collected ${unique.length} links; fetching bodies on current origin`);

  // --- 阶段 2：同页 fetch 专栏 HTML，不跳转域名 ---
  const posts = [];
  const failures = [];
  for (let index = 0; index < unique.length; index += 1) {
    const item = unique[index];
    try {
      const response = await fetch(item.url, { credentials: 'include', mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const articleId = item.url.match(/\/p\/(\d+)/)?.[1] || '';
      let article = null;
      const initial = doc.querySelector('#js-initialData');
      if (initial?.textContent) {
        try { article = deepFindArticle(JSON.parse(initial.textContent), articleId); } catch { /* DOM 兜底 */ }
      }
      const bodyElement = doc.querySelector('[itemprop="articleBody"], .Post-RichTextContainer, .RichText');
      const content = article?.content || bodyElement?.innerHTML || '';
      const text = (bodyElement?.textContent
        || new DOMParser().parseFromString(content, 'text/html').body.textContent
        || '').replace(/\s+/g, ' ').trim();
      const created = Number(article?.created || article?.created_time || 0);
      const metaDate = doc.querySelector('meta[property="article:published_time"], [itemprop="datePublished"]')?.getAttribute('content') || '';
      const publishedAt = created > 0 ? new Date(created * 1000).toISOString() : metaDate;
      const publishedTs = Date.parse(publishedAt);
      if (!Number.isFinite(publishedTs)) throw new Error('missing published date');
      if (publishedTs < CUTOFF) continue;
      if (text.replace(/\s+/g, '').length < 80) throw new Error('article body too short');
      const title = (article?.title
        || doc.querySelector('meta[property="og:title"]')?.content
        || doc.title
        || item.title
        || item.url).trim();
      posts.push({
        source_id: item.source_id,
        title,
        url: item.url,
        source_host: 'zhuanlan.zhihu.com',
        source_seed: item.source_seed,
        published_at: publishedAt,
        content_md: content,
        content_text: text,
        excerpt: text.slice(0, 500),
        crawled_at: new Date().toISOString(),
      });
    } catch (error) {
      failures.push({ url: item.url, error: String(error?.message || error) });
    }
    if ((index + 1) % 10 === 0 || index + 1 === unique.length) {
      console.info(`[Zen Zhihu] ${index + 1}/${unique.length}, kept=${posts.length}, failed=${failures.length}`);
    }
    await sleep(650);
  }

  const jsonl = posts.map(post => JSON.stringify(post)).join('\n') + (posts.length ? '\n' : '');
  downloadText('zhihu-browser-export.jsonl', jsonl, 'application/x-ndjson;charset=utf-8');
  console.info(`[Zen Zhihu] done: kept=${posts.length}, failed=${failures.length}`, failures.slice(0, 20));
  return { kept: posts.length, failed: failures.length, failures: failures.slice(0, 20) };
})();
