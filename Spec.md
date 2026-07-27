# Spec · 垂直切片式模块化单体（完整版）

> 更新：2026-07-26  
> 状态：**完整落地**  
> 目标：后端 + 前端源码均按垂直切片组织；**运行时 UX / HTTP 契约 / 数据路径 100% 不变**；性能路径不回退并补齐投稿目录读路径。

## 鉴权（固定单用户）

| 项 | 约定 |
|----|------|
| 形态 | **固定单 owner**；无注册 / 找回密码 / 多用户 |
| 中间件 | `modules/platform/auth.js` 初始化 owner、解析 HttpOnly Session Cookie，并默认保护所有内容路由 |
| 路由 | 仅公开 `/login`、登录提交、隐私版 `robots.txt` 和 favicon；主应用、API、RSS、SEO 深链及媒体均需登录 |
| 绑定 | 裸 Node 默认 `HOST=127.0.0.1`；Docker 容器内监听 `0.0.0.0`，宿主机只映射 `127.0.0.1:3088` 给 HTTPS 反代 |
| DB | `users` / `sessions` 保存 owner 与会话；`user_entry_states` 保存收藏、已读和历史 |
| 密码 | `OWNER_PASSWORD` 至少 12 位，仅以 scrypt 哈希入库；环境变量变化时吊销旧 Session |

## 约束（硬性）

| 项 | 要求 |
|----|------|
| UX / 功能 | 多设备个人阅读（Zen 阅读、虚拟列表、服务端收藏、侧栏树） |
| 入口 | `server.js`（`npm start` / Docker / launchd / systemd） |
| 前端运行时 | 仍为 **单一** `public/app.bundle.min.js`（IIFE/全局脚本，非 type=module） |
| 前端源码 | `public/src/01…15-*.js` 有序切片；`ORDER.json` / `order-data.js`；`npm run build:app` 拼装 |
| 构建管线 | `build:app` concat → `app.js`；`build:assets` **esbuild.build** IIFE minify → `app.bundle.min.js` |
| 端口 / 数据 | 3780 本地 · 3088 生产 · 8080 默认；`data/` 布局不变 |
| 测试 | `npm test` 全绿；启动日志 `QMReader listening` |

## 架构

```
server.js                         # 薄入口
modules/
  create-app.js                   # 组合根
  shared/   config · http · rate-limit
  platform/ middleware · auth(noop) · static
  jobs/     orchestrator · local-sync
  seo/      urls · favicon · meta · feeds · html · routes · register(barrel)
  slices/   catalog · ai-assets · admin（无 auth / me 切片）
lib/                              # 共享内核
public/
  src/                            # 前端垂直切片源（15 文件 + ORDER.json + order-data.js + main.js）
  app.js                          # 中间产物（concat，check:app 恒等）
  app.bundle.min.js               # 运行时单一 IIFE（esbuild.build）
  styles.css · styles.min.css · index.html · …
scripts/
  build-frontend-app.js           # order-data → cat src → app.js · --check
  build-frontend-assets.js        # esbuild.build IIFE/CSS minify · --check
  build-vsa-split-seo.js          # SEO 再拆分工具（可重复）
```

### 依赖规则

1. **后端切片 → 内核**：`modules/slices/*` → `lib/*` + `shared` / `platform` / `jobs` / `seo` 导出。
2. **SEO 无环**：`urls/favicon` → `meta` → `feeds` → `html` → `routes` → `register` barrel。
3. **内核不依赖切片**。
4. **前端**：开发改 `public/src/*`，发布前 `npm run build:frontend`；CI 用 `npm run check:frontend`（含 app 恒等 + assets 哈希）。
5. **单一 AI 准备**：`lib/background-jobs.prepareEntryForAiAsset`（含 `productHuntOfficialSite`）。

### 请求路径（固定 owner）

```
安全头/CSRF → Session 解析 → 登录路由 → 全局登录门禁 → 媒体/SEO/static/API 切片
```

## 前端切片顺序（ORDER.json）

| # | 文件 | 职责 |
|---|------|------|
| 01–05 | shared-* | DOM/storage、常量、图标/profile、state、路由工具 |
| 06 | api-catalog | `api`、源/目录、me |
| 07 | sidebar | 源树 |
| 08 | entry-list | 虚拟列表 / 资产目录 UI |
| 09–12 | reader-* | 正文 / AI 资产 / 划线 / 社交开文 |
| 13 | navigation-refresh | paint / select / refresh |
| 14 | manage-layout | 管理/布局 |
| 15 | events-init | 事件绑定 + `init()`（必须最后） |

恒等验收：`npm run check:app`（源拼接与 `app.js`）；资产验收：`npm run check:assets`（esbuild IIFE 产物 + index `?v=`）。

## 性能与正确性补强

| 点 | 说明 |
|----|------|
| 热路径媒体优先挂载 | 保持 |
| lean catalog / 虚拟列表 | 前端逻辑未改语义 |
| AI prepare 去重 | HTTP + worker 共用 |
| 个人精选 | `user-submitted` 名「个人精选」已进 SOURCES（`manual`）；点进源后列表顶栏 `+` 本机直收 |

## Todo

- [x] 后端 VSA（modules/*）
- [x] SEO 再拆分（urls/favicon/meta/feeds/html/routes）
- [x] 前端 `public/src` 15 切片 + build/check
- [x] `prepareEntryForAiAsset` 统一
- [x] user-submitted 目录旁路
- [x] Dockerfile 含 modules
- [x] `npm test` 74/74
- [x] Zen 双栏可收起（sidebar-collapsed / left-collapsed 特异度 ≥ 默认栅格）
- [x] 开文/切博客不缩放（固定列宽 + 统一 .reader + 禁 enter 回流动画）
- [x] 知乎日更：launchd + crawl-zhihu-auto + stamp 轮询重读 DB
- [x] b站收藏：Zen Cookie + toview + 收藏夹 API + 视频封面 + social-bili UI
- [ ] （可选）styles.css 按 admin/agent 分包
- [ ] （可选）前端 ESM 真 import（需 bundler，本轮不做）

## 维护收敛 Todo（2026-07-25 · 不增功能）

> Deep Research：安全 → 性能 → 缩略/文档。公网 trust proxy 下环回 IP 特权优先堵。

### 安全（P0）
- [x] S1/S2 固定 owner 登录门禁：页面、API、RSS 和媒体默认拒绝匿名访问
- [x] S3 `OWNER_PASSWORD` 改动后吊销旧 sessions
- [x] S4 AI Base URL DNS 公网校验（对齐 fetcher SSRF；Node 26 无 lookupSync 时 spawn 回退）
- [x] S5 CSRF：Origin 缺失时收紧（Referer / Sec-Fetch-Site / Cookie）；无 Origin 且无 Cookie 时仅 localhost/127.0.0.1/::1 放宽
- [x] S6 `refresh-hint` 位于全局 owner 门禁之后
- [x] S24 `HOST` 默认 `127.0.0.1`（`.env.example` 对齐）
- [x] S25 translation/refresh 限流（30/10 · 10/10）
- [x] S26 crawl shell 硬化：`umask 077` / flock 单实例 / mkdir 700 / profile basename / 不回写绝对路径 plist；gitignore blog-crawl/logs/plist
- [x] S27 固定单用户鉴权：无注册与多用户入口，恢复 owner Session 和服务端阅读状态

### 性能（P1）
- [x] S8 cache.json 写路径：无锁竞争时跳过全量读盘
- [x] S10 `upsertEntries` IN 预取，去掉按条 SELECT
- [ ] S11 列表资产聚合（已部分优化，本轮不做进一步）
- [ ] S7 DatabaseSync 异步化（大改，本轮不做，仅记）

### 缩略与文档（P1）
- [x] S13 删空孤儿 `data/reader.db` `data/qm-reader.db`
- [x] S15 删 VSA extract 一次性脚本
- [x] S18 根垃圾 / ops 历史笔记归档 / 自有 pyc / cache.bak
- [x] S19 CONTRIBUTING 对齐 check:frontend + npm test
- [x] S20 sendError 500 不泄内部 message + 进程错误兜底
- [x] S21 README 配置表对齐 .env.example
- [x] S23 package.json `engines.node`
- [x] S12/S16 文档：CONTRIBUTING 规范只改 `public/src` + `build:frontend`
- [x] S14 双真相架构收敛（SQLite 权威 · cache 加速层）
- [x] S17 fetcher 大拆（门面 `lib/fetcher.js` + `lib/fetcher/{net-safety,text-codec,html-content,http-public,images-localize,constants,runtime}`；**已接线** `sources-hackernews` / `entries-normalize` / `sources-fetch` / `sources-catalog` 工厂；cache-io·投稿·PH 官站·`fetchEntryOriginal` 仍在门面，可继续拆 `cache-io`）
- [x] S12b 前端 ESM bundler（`order-data.js` + `esbuild.build` IIFE；运行时仍单 `app.bundle.min.js`）

## 运行时数据权威（S14 · 双真相收敛）

> 不增产品功能；对外行为尽量不变。目标：缩 `cache.json`、消除 localOnly 巨型写盘、明确谁说了算。

| 数据 | 权威 | 加速层 |
|------|------|--------|
| 条目正文 / 列表 | **SQLite**（`store`） | 内存 `cache`；`cache.json` 仅 RSS 源元数据 + 条目轻量镜像（**可删可重建**） |
| 源启用 / 删源状态 | **state.json** + 内存 `state` | — |
| localOnly 源（X / 小红书 / 知乎 / b站…） | **仅 SQLite** | 内存 cache 按需 `hydrate` / `ensureLocalOnlyCache`；**禁止**整源 `markCacheSourceChanged` 写巨型 json |

### 写盘策略（`lib/fetcher.js`）

1. **`cachePayloadForDisk(cacheObj)`**（写 `CACHE_FILE` 前必经）
   - `localOnly`：`entries: []` + `entryCount` + `diskSkipped: 'localOnly-sqlite'`，仅保留 status/fetchedAt/feedUrl 等元数据
   - RSS / manual：保留 `title` / `summary` / `link` / `image` 等列表字段，**剥掉每条 `content`**（详情走 `getEntry`/DB；冷启动列表不依赖正文）
2. **`markCacheSourceChanged`**：源为 `localOnly` 时直接 return，不进 `pendingCacheSourceIds`
3. **`loadDisk`**：读入 `cache.json` 后**丢弃** localOnly 的 `entries`，强制走 DB hydrate；upsert 回写也跳过 localOnly
4. **`writeDiskNow`**：`payload = cachePayloadForDisk(merged)` 再 `writeJsonAtomic`；内存仍保留完整 entries（锁等待读盘 merge 时，未变更源不被磁盘轻量镜像覆盖）

## Zen 布局约定（2026-07-19）

| 状态 | 行为 |
|------|------|
| 默认 | 源 232px + 列表 320px 固定像素；右 AI 永收 |
| `sidebar-collapsed` | 源 → 64px（≤980 → 56px），文案隐藏、图标居中 |
| `left-collapsed` | **仅 `.reading` 时** 源+列表+resizer 隐藏；关文后双栏必回显（class 可残留 storage） |
| 开文 `.reading` | **不改** grid 列宽；`.reader` 宽/padding 与未开文一致；无 scale 动画 |
| `setEntryPaneWidth` | Zen 全路径 no-op（含 list-resizer） |

硬刷新：`styles.css?v=189` · `app.js?v=198` · `elegance.js?v=3`

## 知乎自动更新（2026-07-23）

> 状态：**已落地**  
> 调度：独立 launchd（**非** Reader 进程内 Playwright）

```text
ai.zen.reader.zhihu-crawl  每日 09:00 本地时区
  → scripts/crawl-zhihu-auto.sh
      export (Zen cookie + API, --allow-empty)
      crawl_and_import --import-qm
      repair --needs-images
      写 data/blog-crawl/zhihu-last-import.json
  → Reader: ZHIHU_RELOAD_POLL_MS 轮询 stamp → fetchSource(localOnly) 重读 SQLite
```

| 命令 | 作用 |
|------|------|
| `npm run crawl:zhihu:auto` | 手动编排 |
| `npm run install:zhihu-crawl` | 安装 LaunchAgent |
| `npm run uninstall:zhihu-crawl` | 卸载 |

约束：需本机 Zen 登录知乎；Docker/无 Cookie 环境不可用此任务。

## b站收藏（2026-07-24）

> 状态：**已落地**  
> 目标：侧栏独立源 **b站收藏**（id=`bili-watchlater`）合并同步「稍后再看 + 收藏夹」；列表封面 = 视频封面。

| 项 | 值 |
|----|-----|
| 源 | `bili-watchlater` · 显示名 **b站收藏** · `localOnly` · `contentKind: 'social-bili'` · `displayPin: 5` · limit 2000 |
| Cookie | 本机 Zen `cookies.sqlite` → `SESSDATA`（同知乎路径）；`BILI_COOKIE` 可覆盖；`BILI_ZEN_PROFILE` / `ZHIHU_ZEN_PROFILE` |
| API | 稍后再看 `GET /x/v2/history/toview`；收藏夹 `GET /x/v3/fav/folder/created/list-all` + 分页 `GET /x/v3/fav/resource/list`（仅 type=2 视频） |
| 入库 | `lib/bili-watchlater-sync.js` → `qm-social-v1` + `platform: bili`；同 BV 去重，payload `biliOrigins` / `favMediaIds` |
| 剪枝 | 两边都离开 → softDelete reason=`left-watchlater`；再入列仅恢复该 reason；用户 **取消收藏**（`user-cancel-watchlater`）粘性 |
| 本机取消 | `POST /api/bili-watchlater/remove` → 按 origins：`toview/del` 和/或 `fav/resource/batch-del` + 软删 + removeCachedEntry + fetchSource；前端静默 `card.remove()` |
| 调度 | 启动全量 + `BILI_POLL_MS`（默认 5min）轮询；切源 refresh-hint 异步同步 |
| UI | 显示名 b站收藏；按钮「取消收藏」；`renderBiliNativeHtml` 16:9 封面 |
| 手动 | `npm run import:bili-watchlater`；关：`BILI_SYNC_ENABLED=0` |

约束：需本机 Zen 已登录 bilibili.com；Docker/无 Cookie 环境不可用。

## GitHub 项目收藏（2026-07-24）

> 状态：**已落地**  
> 目标：侧栏独立源收藏 GitHub **仓库**（非文章），与「个人精选」并列。

| 项 | 值 |
|----|-----|
| 源 | `github-projects` · `manual` · `contentKind: 'repo'` · `displayPin: 2` |
| 入口 | 点进「GitHub 项目」源 → 列表顶栏 `+` → modal mode=repo → `POST /api/submit-github-repo` |
| 抓取 | `lib/github-repo.js`：GitHub REST API（meta + 清洗后 README），**禁止** `extractReadableContent`；剥 shields 徽章、折叠「technical details」宽表；长表**静默**留前 4 行 / 最多 24 表（无「已省略」占位）；总长默认 80KB |
| 翻译 | README 大表 dual 输出易 length→漏译：单块上限≈2200 + dual 估算拆碎；**目录/元数据表透传不进模型**（防「Github仓库 RL算法…」墙）；JSON 坏片/漏块不整篇死；模型回 p 墙则强制回源 table |
| 入库 | `entries`（`repo-brief` HTML）；**不**进 `user_submissions` |
| 护栏 | `shouldAutoFetchOriginal` / `fetchEntryOriginal` 短路（禁止当文章补抓）；**可读可译** README/简介 |
| 鉴权 | 固定 owner Session；写操作与内容读取均需登录 |

manual 分流：`contentKind==='repo'` → `listEntriesBySource`；个人精选仍 `getSubmittedEntries`。

## 本地 crawl 全文 · 禁止误触发「原文获取中」（2026-07-25）

> 状态：**已落地**  
> 问题：宝玉 / Arthur / Lil'Log 等已 crawl 入库（长 Markdown 或 `/article-images/`），开文仍因「无图」启发式自动 `POST /content`。

| 层 | 行为 |
|----|------|
| 前端 `shouldAutoFetchOriginalOnOpen` | 仅薄内容补抓；`hasUsableOriginalContent`（≥700 字或本地镜像图）→ **不** auto-fetch |
| 译前补抓 | 改走同一判断，不再「无 `originalFetchedAt` 就抓」 |
| 服务端 `shouldAutoFetchOriginal` / `fetchEntryOriginal` | `entryHasLocalPreservedBody` 短路；有全文只标 `originalFetched` 不联网 |
| 导入 `import-preserved-blog` | 长文 / 本地图 / 知乎 → 写 `originalFetchedAt` |
| 存量 | SQLite + `cache.json` 已补标约 3k 篇长文/本地图 |

本地图目录（节选）：`baoyu` · `arthurchiao` · `lilianweng` · `qingkeai` · `karpathy` · `zhihu-*` 等。

## 正文抽取 / 媒体（2026-07-24）

> 状态：**已落地**  
> 目标：个人精选与抓原文「爬干净」——少垃圾、少丢图/数据可视化。

| 能力 | 实现（`lib/fetcher.js` → `cleanExtractedRoot`） |
|------|-----------------------------------------------|
| 真图 | `picture`/`source`/`noscript` 提升；lazy/`srcset`(最大 w)；`aria-hidden` 内图解包 |
| CSS 图 | `throughput-ladder` / `roofline-breakdown` → `<figure><table>` |
| 边注 | `.sidenote-wrapper` → `<em>(note)</em>`；脚注区/脚注锚剥离 |
| 封面 | 正文图优先；无正文图时用 CMS 级 og（`isLikelyArticleOgImage`）；generic og 仍拒 |
| 本地化 | `localizeEntryImages` → `/article-images/{source}/{entry16}/…` |

路径：`submitLink` / `hydrateThinFeedEntry` / `fetchEntryOriginal` 共用 `extractReadableContent`。

## 验证

```bash
npm run check:app
node --check server.js modules/**/*.js modules/**/**/*.js
npm test
# 硬刷新 styles?v=189 app?v=198 elegance?v=3
```

---

## [2026-07-22] 文章收藏（个人星标）

> 状态：**已落地**  
> 目标：在源文章之上再收藏一层；左侧可进收藏夹；列表右键收藏/删除；正文顶栏 🌟 切换。

### 设计

1. **左侧「收藏」**：沿用 `data-view=starred`；计数 `#count-starred`。
2. **收藏语义**：`toggleEntryStarred` 对任意源条目打星（本机 localStorage / 库内 starred）。
3. **右键**：`#entry-context-menu` → 收藏/取消收藏、删除（右键删除**不弹确认**，直接软删）。
4. **顶栏 🌟**：`#reader-star.reader-star-btn` 在标题行；社交模式 head 精简后仍露星标。
5. **删除**：个人模式本机始终可软删；前端 `deleteEntryById({ confirm })`——顶栏删除仍确认，右键 `confirm: false`。
6. **软删粘性**：`upsertEntries` **跳过**已软删 id；`forceContent`（原文补全 / likes / 知识库）**不得**清空 `deleted_at`。RSS 刷新与扫盘不得复活用户删除。

### Todo

- [x] `toggleEntryStarred` / `deleteEntryById` 抽公共
- [x] 入口 HTML：标题行星标 + entry context menu
- [x] 列表 contextmenu 委托 + 菜单动作
- [x] 社交 head 不全藏，保留星标
- [x] `DELETE /api/entry/:id` 本机放宽
- [x] `npm run build:frontend` + changelog
- [x] 软删粘性（防 forceContent 复活）

---

## [2026-07-22] 小红书正文滚动帧率

> 状态：**已落地**  
> 目标：多图/长评笔记滚读更稳，少掉帧。

### 瓶颈

- 本地原图常见 1440×2400、个别 5MB+，全分辨率解码 + 全局 `box-shadow` 绘制
- 图无 width/height，懒加载时布局跳动
- 整卡 `overflow:hidden` + 大阴影，视口外图/评论仍参与布局

### 方案

1. **CSS**：图项/评论 `content-visibility: auto` + `contain`；去社交图阴影；图 `max-height: min(85vh,960px)`；阅读栏 `overscroll-behavior: contain`
2. **JS**：前 2 张即载，其余 `data-src` + `IntersectionObserver`（root=`#reader-pane`，预取 ~1.2 屏）限并发 2；加载后写 intrinsic 尺寸，idle 时 `createImageBitmap` 长边降到 1440 并换 blob
3. **回收**：关文 / 重渲染 `disposeSocialGalleryPerf` 断 IO + revoke blob

### Todo

- [x] 图廊懒载 + 降采样
- [x] 评论/图项 content-visibility
- [x] 滚动热路径 hideArticleLinkMenu 短路
- [x] `npm run build:frontend` + changelog

---

## [2026-07-22] 源右键删除（停同步 + 清内容）

> 状态：**已落地**  
> 目标：侧栏源右键「删除源」→ 不再同步该站 + 永久清除该源全部文章与关联数据。

### 设计

1. **API** `DELETE /api/sources/:id`：个人模式本机始终可删源。
2. **停同步**：`setEnabled(false)` 写入 `data/state.json`（立刻 flush；禁止空 `{}` 覆盖已有禁用记录）；RSS/新鲜度/刷新不再纳入；likes/xhs-kb 扫盘与 watch 跳过 disabled 源。
3. **清内容**：默认 `hardDeleteEntriesBySource`（`DELETE FROM entries WHERE source_id=?`，FK CASCADE 清翻译/点评/划线/对话等）；清 `cache[id]`；尽力 `rm public/article-images/{sourceId}/`。
4. **源定义**：仍在 `lib/sources.js`（非 DB 表）；侧栏只渲染 `enabled`；管理页可再启用（内容需重抓/重扫盘）。
5. **UI**：`#source-context-menu` 增加危险项「删除源」；确认对话框（不可撤销）；成功后本地剔目录并关文。

### Todo

- [x] `store.hardDeleteEntriesBySource` / `softDeleteEntriesBySource`
- [x] `fetcher.deleteSource` + catalog 路由
- [x] likes-sync / xhs-kb / local-sync 尊重 enabled
- [x] 源右键菜单 + `deleteSourceById`
- [x] Spec / changelog / `build:frontend`

---

## [2026-07-23] 英文文章一键译简中

> 状态：**已实现（含永久缓存 + 默认简中，不管怎么样）**  
> 需求：英文文章右上角「翻译」→ 整篇变简体中文、格式照旧；**有译文则开文永远默认简中**（切卡再回、stale 均不回英文）；「原文」仅本次临时。  
> 方案：  
> - 服务端 `GEMINI_API_KEY` / DeepSeek；结果写入 SQLite `entry_translations`（永久，contentHash 命中不调模型）  
> - 开文：正文与 `GET /translation` **并行**；有 content 块则只 `applyZh`，绝不先渲英文；`stale` 仅提示可更新、不挡展示  
> - 按钮：无缓存「翻译」；有缓存只「原文⇄中文」；点击先内存/`GET`，无缓存才 `POST force:false`  
> - Key 只放服务端 `.env`  


---

## [2026-07-22] 源拖拽排序可用

> 状态：**已修（含树组）**  
> 问题：旧实现每帧 DOM 插拔 + `elementFromPoint`，拖不动/不丝滑；树分组「小红书博主 / 知乎」与子源未 arm 拖拽。  
> 方案：window 级非 passive pointer + `touch-action:none`；阈值 5px；浮动 ghost + 占位条 + rAF。  
> 范围：  
> - **top**：普通源 + 整棵 `.feed-tree`（抓分组标题）在 `#feed-groups` 排序  
> - **tree**：分组内子源在 `.feed-tree-children` 排序 → `persistTreeChildOrder`  
> 松手写 `qm_source_order` 并 `applySourcePreferences`：**有本地 order 时完全尊重拖拽**（个人精选 / GitHub 项目可换位）；无 order 时 displayPin 仅作默认置顶。

---

## [2026-07-22] 硬刷新深链 Not found

> 状态：**已修**  
> 现象：`Cmd+Shift+R` 开文章 URL 见纯文本 `Not found`；关掉再开首页/点进文章又正常。  
> 根因：  
> 1. `server.js` 先 `listen` 再 `loadDisk`，启动窗口内 SEO 路由查不到条目。  
> 2. `/articles/*` 未命中时 `text/plain Not found`，不吐 SPA，前端无法自愈。  
> 3. 深链 `entryId` 为 12 位 shortId，客户端只做全等匹配。  
> 修复：listen 前 loadDisk；未命中回 SPA 壳 404；`findEntryInCatalog` 前缀匹配 + API/目录重试；启动扫盘后再补 `openEntryFromUrl`。
