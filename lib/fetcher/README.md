# lib/fetcher/

`lib/fetcher.js` 的拆分落点。**公共门面仍是 `lib/fetcher.js`**：`require('../lib/fetcher')` / `module.exports` / `__test` 契约不变。

## Agent 地图（改哪打开哪）

```
lib/fetcher/
  constants.js            # 纯常量（源 id、HN 限制、并发、RSS_HEADERS…）
  runtime.js              # 可变 cache/state/写盘队列/锁 token/路径/hnrss 槽位
  net-safety.js           # SSRF / 公网 URL·IP / pinned DNS
  text-codec.js           # charset / decodeResponseBuffer
  html-content.js         # HTML 抽取清洗、封面、srcset
  http-public.js          # 公网 HTTP：TIMEOUT_MS、fetchText、body 限流
  images-localize.js      # 条目图本地化
  sources-hackernews.js   # createHackerNews(deps)：HN id/stats/rank/hydrate/API
  entries-normalize.js    # createEntriesNormalize(deps)：item→entry、瘦条目、去重
  sources-fetch.js        # createSourceFetch(deps)：fetchSource/refreshAll/feed 解析
  sources-catalog.js      # createCatalog(deps)：getEntries/getSourcesMeta/列表 lean
  # 仍在门面 lib/fetcher.js（下一步可再拆）
  #   cache-io：loadDisk/saveDisk/merge/lock
  #   submit/delete/producthunt/official/fetchEntryOriginal
```

| 模块 | 职责 | 状态依赖 |
|------|------|----------|
| `constants.js` | 源 id、HN 条数/限流、`CONCURRENCY`、`RSS_HEADERS`、锁 stale | 无 |
| `runtime.js` | `cache` / `state` / 写盘队列 / 锁 token / `DATA_DIR` 路径 / hnrss 槽位时间 | **唯一可变共享** |
| `net-safety.js` | 公网 URL/IP 校验、DNS 解析、pinned lookup/dispatcher、deadline | 无 |
| `text-codec.js` | 响应头 charset、编码规范化、`decodeResponseBuffer` | 无 |
| `html-content.js` | HTML 抽取/清洗、封面图、srcset、站点特判正文 | 无 |
| `http-public.js` | 公网 HTTP：`fetchPublicBuffer` / `fetchText` / body 限流 / raster MIME | 无（hnrss 槽位经 deps 注入） |
| `images-localize.js` | `localizeEntryImages` / download·rewrite·路径 | 无 cache（可写 IMAGE_ROOT） |
| `sources-hackernews.js` | HN 讨论/作者/评论/hydrate/rank | 无（deps 注入） |
| `entries-normalize.js` | `normalizeItem` / `decorateEntry` / thin hydrate / 去重 | 无 cache（可选 store） |
| `sources-fetch.js` | `fetchSource` / `refreshAll` / wpjson·sitemap | **写 `runtime.cache`** |
| `sources-catalog.js` | 列表/侧栏 meta/详情补正文/译文包装 | **读 `runtime.cache`** |

## 门面接线（已完成）

`lib/fetcher.js` 作为薄门面：

1. `require('./fetcher/runtime')` + `constants`；全文读写 `runtime.cache` / `runtime.state` / `pending*` / `saveTimer` / 锁路径。
2. 本地保留：`fetchText` 包装、`waitForHnrssRequestSlot`、`parseRssUrl`、`fetchJson`、`expandCandidates`、`isEnabled`/`setEnabled`、cache-io、投稿/删源、Product Hunt 官站、`fetchEntryOriginal`。
3. 工厂初始化顺序：
   - `createHackerNews({ …, fetchText, fetchJson, parseRssUrl, mapLimit })`
   - `createEntriesNormalize({ …, isHackerNews*, hydrate 边界 })`
   - `hydrateSourceEntries`（门面编排 HN / Paul Graham / thin）
   - `createSourceFetch({ SOURCES, store, runtime, hydrateSourceEntries, … })`
   - `createCatalog({ SOURCES, store, runtime, decorateEntry, … })`
4. `module.exports` / `__test` 名字不变，绑定到工厂或门面实现。

**注意**：`sources-fetch` 内必须经 `runtime.cache` 动态取引用（`cacheRef()`），禁止在工厂创建时 `const cache = runtime.cache` 闭包固定，否则 `loadDisk` 整表 `runtime.cache = …` 后写错对象。

## 约定

1. **禁止**本目录模块 `require('../fetcher')`（防环）。需要 cache/state 时 `require('./runtime')` 或经 `deps.runtime`。
2. **纯常量**进 `constants.js`；**可变共享**只进 `runtime.js`；禁止在 runtime 堆业务函数。
3. 超时与 body 上限权威在 `http-public.js`（`TIMEOUT_MS` / `MAX_*_RESPONSE_BYTES`），勿在 constants 重复拷贝。
4. 双真相：条目权威 SQLite；`runtime.cache` 为加速层；`cache.json` 可丢。
5. 后续可再拆门面内 cache-io / Product Hunt / 投稿 到独立文件；行为与导出契约不变。
