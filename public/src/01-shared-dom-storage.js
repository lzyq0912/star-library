/* QMReader front-end */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// localStorage throws SecurityError inside sandboxed iframes — fall back to in-memory
const storage = (() => {
  try {
    const t = window.localStorage;
    t.getItem('__probe__');
    return t;
  } catch {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();

function readJson(key, fallback) {
  try { return JSON.parse(storage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
}

function readStoredNumber(key) {
  const n = parseInt(storage.getItem(key) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- 共享性能工具 ---------- */

/** 尾随防抖：高频输入（搜索框、窗口 resize）合并为最后一次调用 */
function debounce(fn, wait = 200) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
  }
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}

/** rAF 节流：滚动/拖拽等每帧至多执行一次，自动合并同一帧内的重复触发 */
function rafThrottle(fn) {
  let raf = 0;
  let pendingArgs = null;
  function throttled(...args) {
    pendingArgs = args;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn.apply(this, pendingArgs);
      pendingArgs = null;
    });
  }
  throttled.cancel = () => { cancelAnimationFrame(raf); raf = 0; pendingArgs = null; };
  return throttled;
}
