/* Zen 界面增强：阅读器进入动效（无缩放）。
   独立于 app.js：监听文章标题子树变化（每次 openEntry 都会重设标题），
   据此重播 .reader-enter 动画。Zen 下禁用回流动画，避免开文「放大感」。 */
(() => {
  const reader = document.getElementById('reader');
  const title = document.getElementById('reader-title');
  if (!reader || !title) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  let lastTitle = null;
  const isZen = () => document.body?.classList?.contains('zen-personal');
  const replay = () => {
    if (reduceMotion.matches) return;
    // Zen：列宽固定后仍不要强制 reflow + enter 动画（会像轻微缩放）
    if (isZen()) {
      reader.classList.remove('reader-enter');
      lastTitle = title.textContent;
      return;
    }
    if (reader.classList.contains('hidden')) return;
    // 标题未实际变化（如「获取原文」完成后的重绘）则跳过
    const current = title.textContent;
    if (current === lastTitle) return;
    lastTitle = current;
    // j/k 键盘导航已有整体位移动画，跳过避免叠加
    if (/reader-nav-(enter|exit)-/.test(reader.className)) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      reader.classList.remove('reader-enter');
      void reader.offsetWidth; // 强制回流，重启 CSS 动画
      reader.classList.add('reader-enter');
    });
  };
  new MutationObserver(replay).observe(title, {
    childList: true,
    characterData: true,
    subtree: true,
  });
})();
