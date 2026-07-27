/**
 * QMReader entrypoint — thin bootstrap over vertical-slice modular monolith.
 * API contracts, ports, data paths, and UX are unchanged from the pre-VSA monolith.
 */
const fetcher = require('./lib/fetcher');
const { PORT, HOST } = require('./modules/shared/config');
const { createApp } = require('./modules/create-app');
const {
  scheduleStartupRefresh,
  scheduleDailyRefresh,
  scheduleFreshnessRefresh,
} = require('./modules/jobs/orchestrator');
const { runStartupLocalIngest } = require('./modules/jobs/local-sync');

const app = createApp();

// 进程级兆底：只记日志，不 exit —— 本机阅读服务优先存活
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

try {
  fetcher.loadDisk();
} catch (error) {
  console.warn('[boot] loadDisk failed:', error && error.message ? error.message : error);
}

// 本地源（X / 小红书 / 知乎）先从 SQLite 同步灌满内存 cache，再 listen，
// 避免首包 GET /api/entries 时 cache 空导致「全部」漏掉这些源。
// 磁盘扫盘 / watch 仍在 listen 后异步跑（runStartupLocalIngest）。
try {
  for (const src of fetcher.getSourcesMeta()) {
    if (!src || !src.localOnly || src.enabled === false) continue;
    const full = fetcher.getSourceById(src.id);
    if (!full) continue;
    const result = fetcher.fetchSource(full);
    if (result && typeof result.then === 'function') {
      // localOnly 路径同步返回；兼容 Promise 时不阻塞
      result.catch((error) => {
        console.warn(`[boot] local hydrate ${src.id}:`, error && error.message ? error.message : error);
      });
    }
  }
} catch (error) {
  console.warn('[boot] localOnly pre-hydrate failed:', error && error.message ? error.message : error);
}

app.listen(PORT, HOST, () => {
  console.log(`QMReader listening on http://${HOST}:${PORT}`);
  // 本地 X / 小红书收藏 + 知识库博主：启动扫盘 + 目录 watch（listen 后再扫，不挡首包）
  setImmediate(() => runStartupLocalIngest(fetcher));
  scheduleStartupRefresh();
  scheduleDailyRefresh();
  scheduleFreshnessRefresh();
});

module.exports = app;
