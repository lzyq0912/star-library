## [2026-07-26]

- 产品：**彻底去掉登录意图**（个人本机唯一形态，永不需要账号）
  - UI：删除 `account-strip` / `auth-modal` / `change-password-modal` /「登录后发布点评」
  - 前端：`isAdmin`/`requireAuth` 恒 true；`openAuth`/`submitAuth`/`logout`/改密 全 no-op；去掉引导登录文案
  - 后端：`auth.js` 标明废弃 + `PERSONAL_NO_AUTH`；无 `/api/auth/*` 路由；`.env` 去掉 `ZEN_PERSONAL`/`ADMIN_*`
  - 文档：README / Spec 写明无账号系统；测试删除公网 login HTTP 合约
  - `npm test` 133 pass；`build:frontend` + `check:app` 通过


- 清理：`public/src` 登录/账号意图（个人本机永不登录；不改 app.js / 不 commit）
  - `02-shared-constants.js`：`isZenPersonalMode()` 注释「个人唯一模式，无登录」
  - `08-entry-list.js`：`isAdmin`/`requireAuth` 恒 true；auth/改密/logout 全 no-op；`canMutate` 直 true；去掉 `/api/auth/*` `/api/me/password` 实现
  - `15-events-init.js`：删除 `#auth-*` / `#change-password-*` / `#comment-login` / `#account-menu-*` 绑定；annotation login 为 no-op
  - `09/10/11/12/13/14`：去掉 requireAuth 门与「登录后…」文案/引导；AI/评论/划线/刷新/agent 可直接操作；`loadMe` 仍 me=null 早退
  - `06-api-catalog.js`：点赞 title 改为中性「点赞」
- 清理：个人前端登录文案残留扫描（不 rebuild app.js）
  - `12-reader-social-open.js`：去掉「登录后…」toast/placeholder（标记有用 / 点评草稿 / 对话）
  - `14-manage-layout.js`：admin/AI 文案中性化（注册用户→用户；登录会话/权限→会话/使用权限；配置模型）
  - 复核：`06/08/09/11` 与 `index.html` 已无用户可见「登录/注册/修改密码/登录后」；`package.json` auth scripts 未动；`styles.css` auth-modal 未动
  - 遗留：`public/app.js` 仍含旧文案（任务禁止 rebuild）；`lib/store` 用户/会话 API 与 schema 保留
- 清理：后端登录意图与文档叙述（个人本机唯一形态）
  - `modules/platform/auth.js` → noop + `PERSONAL_NO_AUTH`；注明无登录路由
  - `create-app` 确认未挂 `/api/auth/*`、`/api/me`；软删/AI/刷新无鉴权分支
  - `.env.example` 删除 `ZEN_PERSONAL` / `ADMIN_*` / `COOKIE_SECURE`；写明仅个人模式、`HOST=127.0.0.1`
  - `README.md` / `README.zen.md` 去掉注册登录改密多用户 admin 说明
  - `Spec.md` 鉴权章改为「个人模式无登录」；勾掉 S1–S3/S6 登录门禁意图
  - 保留 store `users`/`sessions` 表结构（DB 兼容）；modules 无「请登录」用户提示
- 测试：清理 `test/admin-submissions.test.js` 登录/多用户鉴权假意图——删除 `/api/auth/login`、`/api/me`、admin cookie、`ZEN_PERSONAL:0` HTTP 公网合约测与 `login()` helper；保留 store 层软删/配额/投稿隔离/moderation 单测（owner 叙事；authenticateUser 注释为遗留 schema）
- 移除：`public/index.html` 全部登录意图 UI（个人自用）——`.account-strip`、`#auth-modal`、`#change-password-modal`、`#comment-login`；保留 AI 设置/刷新/侧栏 footer/submit-link-modal
- **落地**：OCR 审查 Critical/High/Medium 项 8 路修复子代理 + 主代理收尾全部修完（`npm test` 133 pass / 1 skip；Python crawler 9/9；`build:frontend` 已 rebuild）
- 修复（P0 数据损坏）：`lib/zen-recent-sync.js`
  - `contentHasSyllabusBody`：空占位「暂未识别到课程表」不算有 body
  - `entryFromPin`：无实质 body 时默认 `forceContent:false`；骨架/失败路径保留库内实质 content
  - `syncAll` / `refreshLocalCourseCatalog` / `addLocalCourse` / `repairLocalSyllabusContent` 对齐
- 修复（P0 XSS/竞态）：`public/src` + rebuild `app.js`/`app.bundle.min.js`
  - 社交正文 `sanitizeAsync`；弱 sanitize scheme 白名单
  - `applyZhArticleView`/`fetchOriginalContent` `openGen` 守卫；`mergeSourceEntries` 串行
  - DASHBOARD `contributions`；资产条显示；资料页默认 original
- 修复（P0 SSRF/路径）：`images-localize` 只走 `fetchPublicBuffer`；entryId 净化 + IMAGE_ROOT 断言；`absoluteUrl` 仅 http(s)
- 修复（适配器）：`limu-bilibili` / `uva-agentic` / `cs149-fall25` 匹配收紧
- 修复（运维脚本）：translate 默认不 force；bili 空 API 拒 prune；修图同步译文 hash；zhihu repair SSRF；preserved-blog dry-run/`--apply-deletes`
- 修复（Python 爬虫）：browser finally close；source id 净化；私网拒；知乎 HTML 图本地化；gather 容错；拒 SVG 落盘
- 修复（安全默认）：`HOST=127.0.0.1`；gitignore `data/blog-crawl|logs` + 生成 plist；crawl `umask`+mkdir 锁（macOS 无 flock）；install 不回写绝对路径 plist；translation/refresh 限流；CSRF 非本机 Host 拒无 Origin；deepseek 请求前再 assert base；README HOST 表对齐
- 测试：localize 路径/远程改写；zen forceContent；sanitize javascript:；admin HTTP 合约 skip；github/bili 补强


## [2026-07-25]

- 修复：**译文标题下堆图/重复插图**——`mergeMissingOriginalImages` 用字面 URL 比对，原文本地化路径与译文 CDN URL 不一致时会把全文配图整批插到 `</h1>` 后；改为身份键（本地路径/文件哈希/S3 UUID）匹配，且译文已有 ≥35% 配图时不再文首兜底堆图；同步该文译文 figure 的远程 href→本地 src
- 修复：**Substack figure 丢图**（空 `<a href=cdn>` 无 `<img>`）
  - 根因：`removeArticleChrome` 会清掉 image-link 空锚点；本地化只认 `<img src>`，且默认每篇最多 20 张
  - 抓取链路：`promoteEmptyImageAnchors` 补空图片锚点；chrome 清理时保留 image href 空壳；本地化前置补图 + 改写 href
  - 默认 `MAX_LOCALIZE_IMAGES_PER_ENTRY` 20→40（可 env 覆盖至 80）
  - 存量：`scripts/repair-entry-images.js` 支持空锚点补图 / 本地化 / 同步译文 `sourceHtml|targetHtml`
  - 实测：全库「空图片锚点」仅 1 篇（Controlling Reasoning Effort，Figure 1–20）；已补全 33 图并本地化，译文 33 figure 同步
  - 测试：`normalizeFeedContent promotes empty Substack image anchors to img`
- 架构：fetcher **再拆并接线**（Agent 友好，`npm test` 127/127）
  - 门面 `lib/fetcher.js` **4498→1623**；`module.exports`/`__test` 契约不变
  - 新增并接线：`constants` · `runtime` · `sources-hackernews` · `entries-normalize` · `sources-fetch` · `sources-catalog`
  - 既有纯工具：`net-safety` · `text-codec` · `html-content` · `http-public` · `images-localize`
  - `sources-fetch` 用 `cacheRef()` 动态读 `runtime.cache`（防 loadDisk 整表替换写错对象）
  - 门面仍留：cache-io / 投稿删源 / PH 官站 / `fetchEntryOriginal` / 工厂装配
  - 详见 `lib/fetcher/README.md` Agent 地图
- 架构（S17/S14/S12b 并行落地，行为/API 不变）：
  - **fetcher 大拆首轮**：纯工具进 `lib/fetcher/`（net/html/http/images）；门面 re-export + `__test` 契约不变；子模块禁止 require 门面
  - **双真相收敛**：SQLite 权威；`cachePayloadForDisk` 剥 localOnly entries / RSS content；localOnly 不进写盘队列；loadDisk 丢弃磁盘 localOnly entries
  - **ESM bundler**：`order-data.js` + `esbuild.build` IIFE minify；运行时仍单 `app.bundle.min.js`；`build:app:esm` 别名
- 维护收敛（Deep Research 全量落地，不增功能）：
  - **S1/S2** 鉴权门禁不靠客户端 IP——`allowEntrySoftDelete` / `allowLocalAi` 删除 `req.ip` 放行；仅 admin/登录、`ZEN_PERSONAL=1`、服务端 HOST 环回（防 trust proxy 伪造 XFF）
  - **S3** 改密吊销 sessions——`updateUserPassword` 后 `DELETE sessions`；`/api/me/password` 清 cookie 强制重登
  - **S4** BYOK Base URL DNS 公网校验——内联私网 IP 判定；域名解析后拒绝内网；Node 26 无 `lookupSync` 时 spawn 短命子进程回退
  - **S5** CSRF Origin 缺失收紧——Referer / Sec-Fetch-Site / 带 Cookie 拒不明来源
  - **S6** `refresh-hint` 需登录或本机/个人模式
  - **S8** cache 写路径无锁竞争时跳过全量读盘
  - **S10** `upsertEntries` IN 分块预取（400），去掉按条 SELECT
  - **S13/S15/S18** 删空孤儿 DB、VSA extract 一次性脚本、根垃圾、pyc、cache.bak；ops 历史笔记 → `ops/archive/`
  - **S19/S21/S23** CONTRIBUTING 对齐 `check:frontend`+`npm test`；README 配置表补全；`engines.node: ">=22"`
  - **S20** 5xx 不泄内部 message；`unhandledRejection`/`uncaughtException` 只 log；create-app 错误中间件
  - 测试：集成测补同源 Origin；spawn 覆盖 `ZEN_PERSONAL=0`；DNS 测改用可解析 host；列表 title_zh 汉字路径断言对齐产品
- 修复：**正文删除重开又回来**——本地删除持久化+重匹配增强（NFKC/去零宽/紧凑空白/前后文/长句截断）；内存镜像防 storage 写失败；删后以规范 quote 落盘；重开 apply 失败时硬挖文本，避免「删了切卡又回来」
- 修复：**不管怎么样默认简中**——开文与正文**并行**拉译文；有缓存只贴简中、绝不先渲英文；`stale` 完全不挡展示；服务端无全文时不误标 stale；三保险强制 applyZh
- 修复：**有译文一律默认简中**——不再因 `stale` 跳过贴中文（hash 误判会把课表打回英文）；开文 await 贴简中 + 双保险；服务端算 stale 强制用全文 content
- 修复：**开文默认简中、切卡回来仍中文**——有译文时 await 贴简中（内存优先）；不再 fire-and-forget 被原文渲染盖掉；「原文」仅本次临时
- 修复：**无课号课程列表不重复显示课名**（如「RLHF 书籍课程」「智能体人工智能」只显示一行；有课号仍「CS336 + 中文课名」）
- 变更：**阅读区目录默认折叠**（课程大纲也不再自动展开）
- 优化：**「近期」列表卡**——去掉右上角学校/学期 pill；点选不加 active 变样；摘要只留课名不堆学校；开文默认贴简中译文
- 修复：**CME295/CME296 课表需左右滑动**——syllabus 表改 `width:100%` + `table-layout:fixed`，视频缩略图限高，一屏可看完
- 修复：**「近期」课表仍大段英文**（Agentic AI / CS329T 等）——课表按 1–2 行细拆；残英二次补译；结构词/日期离线润色（Topic/Presentation/Date→中文）；11-785 策展卡全中文；18 门强制重译
- 移除：**「近期」继续阅读条 + 学校 chip 筛选**——产品不需要；列表只保留课程卡
- 修复：**syllabus 抽取 table 丢外壳**——根节点为 table 时用 outerHTML；孤儿 thead/tbody 包回 table；误译 class 名修复
- 修复：**本地已 crawl 的博客不再「原文获取中」**——宝玉/Arthur/Lil'Log 等长文或含 `/article-images/` 时，开文与译前**不**再自动抓网页；服务端有全文直接标 `originalFetched`；导入脚本统一写 `originalFetchedAt`；存量 SQLite+cache 补标约 3168 篇
- 数据：**「近期」18 门课全部强制译为简体中文**——`npm run translate:zen-recent`（优先 DeepSeek；本机无 `DEEPSEEK_API_KEY` 时回退 Gemini）；课表 Description 中文；壳 CTA「打开大纲」；补齐 `summaryZh`
- 优化：**「近期」课程库产品体验**（侧栏·列表·正文一体）
  - 列表：课表卡信息架构（「课程」kicker、课号主标题、课名升权、学校 pill、校色左边条）；顶栏「近期 · 课程大纲 · N」；搜索「课号、课名、学校…」；scope 仅「目录」；空态产品化
  - 正文：`reader--syllabus` 加宽/宽表/链降噪/sticky 快捷；TOC 含 h1 且默认展开；不拆 brief 课号标题
  - 译文：默认简中时**保留** syllabus 壳（打开大纲/徽章/chips），只替换 body
  - 工程：静态课程库不走 likes 轮询；关文清 syllabus class；侧栏 tooltip/图标 currentColor
- 变更：**译过默认中文**——有永久译文时开文正文必贴简中（「原文」仅本次临时）；列表卡标题/摘要强制 `titleZh`/`summaryZh`；列表 API 放宽中文标题下发并从译文块抠摘要兜底
- 修复：**课程表课名未译**（CS336 等）——日程表不再当 catalog 整表透传英文；拆片译 Description/课名（每片带 thead），译完服务端合并成一张完整表；prompt 强制译讲次主题
- 修复：**本机删除后又出现在译文里**——译前把 `omitQuotes`（正文右键删除片段）交给服务端：整块跳过、不送模型；展示时按 `source` 再滤一遍旧缓存；有删除时不走全文译文缓存短路
- 修复：**CS336 等译后课表不完整**——拆片后合并；前端合并旧缓存连续 table 碎片；宽表横向可滚
- 修复：**正文右键删除/高亮无反应**（「近期」大纲尤甚）——大纲页 `<a>` 极密：有选区时点在链接上不再被忽略；匹配文本含链接内字；优先用选区 Range 即时包裹；二次 apply 不再 `remove` 掉已删节点导致 quote 丢失；失败时 toast 提示
- 修复：**译文丢掉 Watch/PDF/Slides/Source**——RLHF Book 等讲次资源钮在独立 `.talk-actions` 里，旧切块只收 h/p/ul；现将链接工具条作 media 透传，旧缓存渲染时也会从原文补回
- 变更：**「近期」课程库深度适配 + 不进全部**——各课单独 adapter（课号/校名/学期/大纲 URL/抽取选择器；CMU 11-785 SPA 策展卡）；`excludeFromAll` 不出现在「全部/分类/热门」；源内隐藏刷新；`npm run refresh:courses` 本地重刷
- 变更：**「近期」改为本地主库**——默认**不再**跟 Zen 侧栏同步/轮询；启动只 hydrate SQLite；删 Zen「近期」文件夹不会清空本源。可选 `ZEN_RECENT_ENABLED=1` 恢复跟读；剪枝改 opt-in（`ZEN_RECENT_PRUNE=1`）
- 增强：**近期课程号命名 + 抓 Syllabus**——标题优先规范为 `CS224R` / `CS336` / `11-785` 等；课程页并发抓取 syllabus/schedule 正文写入 `syllabus-body`；`ZEN_RECENT_FETCH_BODY` 可关
- 新增：**「近期」源**（`zen-recent`，`contentKind: syllabus`）——课程/大纲入口卡；可选一次性从 Zen `zen-sessions.jsonlz4` 导入
- 设计：**课程/大纲入口卡**（非连载博客）——列表显示「课程大纲 · host」；阅读区 `syllabus-brief`（类型徽章 +「打开页面」）；按 URL 分类 syllabus/course/github/paper/video/doc
- 手动：`npm run import:zen-recent`（可选导入，默认不剪枝）


## [2026-07-19]

- 变更：**X 收藏**列表/详情时间改为用户 **like 时间**（`liked_at`），不再显示帖子 `created_at`；旧条目不迁，下次扫盘入库的新收藏生效
- 验证：`app.js?v=199`；`resolveDisplayRaw` / `socialDisplayTime` 与小红书统一走收藏时间
- 修复：**left-collapsed 关文锁栏 P0**——藏双栏仅 `.reading.left-collapsed`；非 reading 始终 flex 双栏；关文/刷新不再无入口
- 加固：`setEntryPaneWidth` Zen 全路径 no-op；窄栏 footer !important；右栏 hide 特异度 ≥ 公版 `not(.agent-collapsed)`；社交外框双 ID
- 验证：7 路子代理深挖 + 复验；`app.js?v=198` `styles.css?v=189`
- 修复：**侧栏真正可收起**——`sidebar-collapsed`/`left-collapsed` 特异度抬至 ≥ `reading.agent-collapsed:not(.reader-immersive)`；窄栏 chrome 显式 `display:none !important`；展开 chrome 仅 `:not(.sidebar-collapsed)`
- 修复：**开文/点博客不缩放**——开文前后同一套固定 track（232+320）；统一 Zen `.reader` width/padding；禁 `reader-enter` 回流动画；resize 不写 `--entry-width`
- 验证：`app.js?v=197` `styles.css?v=188` `elegance.js?v=3`；子代理审查 A–E 全通过
- 修复：**侧栏可收起**——去掉 Zen 下 `setLeftCollapsed`/`setSidebarCollapsed` 强制常开；CSS 尊重 `left-collapsed`/`sidebar-collapsed`（不再 `display:flex !important` 钉死）
- 修复：**开文/切博客不再缩放抖动**——`--entry-width` 改为固定 `320px`（废除 minmax）；开文清除内联列宽；动效去掉 scale
- 验证：`app.js?v=196` `styles.css?v=187`
- 架构：**完整 VSA**——后端 `modules/{shared,platform,jobs,seo/*,slices/*}` + 前端 `public/src` 15 切片有序源码；运行时仍单文件 `app.js`（`npm run build:app` / `check:app`）
- 架构：SEO 再拆 `urls` / `favicon` / `meta` / `feeds` / `html` / `routes` + `register` barrel（无环依赖）
- 修复：`GET /api/entries?source=user-submitted`——Zen 源表无该项时从 DB 旁路列投稿（不进全量目录、不进侧栏）
- 优化：`prepareEntryForAiAsset` 统一至 `lib/background-jobs`（`productHuntOfficialSite`）
- 运维：Dockerfile `COPY modules`；`package.json` 增加 `build:app` / `check:app`；`app.js?v=195`
- 验证：`npm test` **74/74**；`npm run check:app` 恒等
- 修复：**「全部」被 X/小红书收藏整段顶死**——去掉 `pathOrderPublishedTs`（锚点 − 序号×1s 伪时间），`publishedTs` 改写真实 `liked_at`/`collected_at`；跨源按时间轴混排，旧帖不再整仓置顶
- 修复：**最新 X 点赞未入库**——盘 327 vs 库曾停在 ~312；强制重扫 327/327；指纹改为 `count:maxMtime:sum`；DB 条数明显少于盘面时强制 resync；watch 卡死 >90s 释放锁；读 md 失败打 warn
- 修复：**点进「X 收藏」卡片无左上角图标/源名**——单源与「全部」一致，始终显示 favicon + 源名（废除 hideSourceLine）
- 优化：本地源 `fetchSource` list limit 500→5000，与源 limit/hydrate 对齐
- 验证：x-likes span ≈31 天；「全部」约第 35 条起出现博客；最新 `agstw_…令牌…` / `有人读过这个吗` 在列表顶；服务已重启


## [2026-07-16]

- 修复：**Typora X/小红书收藏 → Reader 全链路**——`localOnly` 刷新不再只读 DB，改为扫盘 upsert 再灌 cache
- 新增：`likes-sync` **20s 周期扫盘**（指纹 `count:mtime` 未变则 skip）兜底 `fs.watch` 漏事件
- 新增：切「X 收藏」/「小红书收藏」时 `refresh-hint` 同步扫盘 + `mergeSourceEntries`；停留该源每 20s 看 entryCount
- 修复：点源刷新按钮对本地收藏即时返回（`finished:true`），前端直接 merge，不走远程 worker
- 验证：盘面 307 md = DB/API 307；最新 `agw7a_如何扩展您的-llm-模型…` 已在列表顶


## [2026-07-15]

- 修复：左侧博客源列表不显示——init 在深链开文前强制 `renderSidebar`；去掉 reading 态 `height:auto` 导致 scroll 区塌缩；文件末尾再压公版 ≤980 藏栏规则
- 修复：开文时博客/文章列表不再收窄——Zen 阅读态与未阅读共用 `--entry-width: minmax(280px, 340px)`；去掉 ≤1500px reading 专用 320 上限；开文跳过 entry 宽 clamp
- 优化：**真虚拟列表**——视口 ± overscan 仅驻留 ≤48 张卡 + top/bottom spacer；滚动 rAF 换窗；去掉无限 load-more DOM 膨胀
- 优化：**远程 refresh 按源增量 merge**——`mergeSourceEntries` 只拉 `?source=`，完成后不再全站 catalog reload
- 优化：**KaTeX / DOMPurify 按需动态加载**——index 去掉同步 script/css；开文 `sanitizeAsync`；公式文 idle 拉 KaTeX；空闲预取 purify
- 优化：**静态图/媒体绕过 session middleware**——`/article-images`、`/source-icons`、`/vendor/katex`、`/likes-media/*`、`/kb-media`、`purify.min.js`、`favicon` 在 session 前挂载，避免每张图 `getUserBySessionToken`；HTML/API 仍走鉴权
- 优化：**内存 cache hydrate 去掉 content**——`listEntriesBySource` 显式列集不选正文；`getEntryById` cache 无 content 时按需 `store.getEntry` 并回写；limit cap 1000→5000
- 优化：**目录 API 真瘦身**——`toListCatalogEntry` 只出列表字段；空 assets 不返回；stats 稀疏；summary≤160；实测 JSON ~6.4MB→~2.4MB（gzip ~0.8MB）
- 优化：**开文不再整表重绘**——`patchEntryCardState` 只改 active/read；stats 回写单卡 patch；`mergeEntryStats`/`updateEntryAssets` 默认不 `renderList`
- 优化：`entryById` / `entriesByCategory` / 热门 top80 预计算；分类筛选 O(1)
- 优化：小红书/X 评论 Markdown **并行**渲染；`openGen` 取消过期正文；KaTeX 仅疑似公式且 idle
- 优化：列表 CSS 去掉 hover translateY 与模糊阴影；`contain:content` + 统一 content-visibility；星标改字符不嵌 SVG
- 优化：浏览 `POST /view` 不再触发源 interaction refresh；`/api/entries` `Cache-Control: private, max-age=15`
- 优化：**连点切源不卡**——`requestAnimationFrame` 合并 paint；侧栏只改 active（不整树重建）；按源预分组 O(1) filter；计数/未读/热门索引缓存
- 优化：列表首屏 36 条 + 单次 `innerHTML` 拼接 + 事件委托；无资产时跳过徽章/预览；摘要截断 160 字；`content-visibility:auto`
- 优化：列表 API lean assets（仅计数、稀疏返回）+ 非零 stats；全量 JSON ~5.3MB→~2.3MB；`getEntries` ~40ms→~18ms
- 优化：未在阅读时切源跳过 `renderAgent`；soft refresh 5 分钟冷却且不打断连点
- 优化：浏览器 favicon 字母 Q → R（Reader）
- 优化：**切换源即时本地 filter**——保留 `allEntries` 全量目录，切博客/分类/搜索零网络等待；去掉 190ms 单击延迟
- 优化：切源不再强绑 `loadContributors`；本地源跳过 refresh-hint
- 优化：侧栏篇数/未读基于全量目录或 `entryCount`，切源后其它源不再显示 0
- 优化：后端 `localOnly` 源跳过 interaction refresh；列表路径去掉 isEntryDeleted N+1；local 刷新不写巨型 cache.json
- 优化：`/api/entries` 列表再剥离 contentHash/软删/原文抓取内部字段，缩小 payload
- 优化：源树文件夹去掉箭头，左侧与普通源对齐；点击文件夹名仍可展开/收起
- 优化：侧栏源列表改为父子树——「小红书博主」「知乎」可折叠，点击展开显示各子源；展开状态本机记忆
- 新增：知识库小红书博主源（`xhs-wanyouyinli` / `xhs-luoye` / `xhs-shutiao`），`npm run import:xhs-kb`
- 新增：`lib/xhs-kb-sync.js` 将万有引力 / 落叶 / 薯条转为小红书 `qm-social-v1` 格式入库，原生 UI 渲染
- 新增：图片静态挂载 `/kb-media/*` 直出 `~/本机/知识库/小红书`，服务启动自动扫盘
- 修复：`forceContent` 重入库时清除 `deleted_at`，避免本地源软删后无法恢复


## [2026-07-14]

- 修复：X **嵌入转发帖（引用）**有中文译文时去掉「原文」英文块，与主帖一致


## [2026-07-14]

- 优化：X 正文标题字号略增大（26px → 30px）
- 修复：X 原生阅读正文上方补 `h1.x-title`，与小红书一致（社交模式隐藏外层 reader-head 后标题不再丢失）


## [2026-07-14]

- 修复：**X 长文推文**标题被 t.co 链接/文件名污染（如 Demis Hassabis 文章变成 `https t co …`）；优先 `###` 标题并拒绝弱标题
- 修复：**X 热门评论**解析支持 `([@user](url))` Markdown 链接格式（此前 175 条评论丢失）
- 优化：去掉文首 t.co 占位链；评论有中文时剥离 `> 原文` 英文块


## [2026-07-14]

- 修复：**X 收藏**列表/详情时间显示帖子 `created_at`（发布时间），不再误用 `liked_at` 收藏时间
- 修复：**X / 小红书**排序改为 `liked_at DESC → created_at DESC`（同一次 like 时发布时间越新越前），不再按文件名路径序


## [2026-07-14]

- 修复：青稞等源补抓原文后图片仍挂远程 URL（OSS/CDN 大图超时、防盗链），阅读器里像「图全坏了」
- 新增：`localizeEntryImages` 在抓取原文时把正文/封面图落到 `/article-images/{source}/…`；去掉 `file://` 无效图
- 优化：本地镜像图 `no-referrer`，外链图保留默认 referrer，减少知乎图床失败


## [2026-07-14]

- 修复：RSS 只有摘要 / Halo `telemetry.gif` 跟踪像素时正文几乎空白（如青稞 Qwen-Robot Suite）
- 修复：原文抓取优先 `article#post-content` 等正文容器，避免 `main` 面包屑污染；HTML 压平后前端直渲，不再被 Markdown 当成缩进代码块
- 新增：刷新时自动补抓 thin 条目全文；打开详情页自动补抓；失败可重试（不再永久隐藏「获取原文」）
- 优化：入库/展示剥离 1×1 跟踪像素，封面图不再误用 telemetry


## [2026-07-14]

- 修复：青稞同链再分裂（旧相对 guid + 新绝对 link），如 Qwen-Robot Suite 出现两条；`dedupeSourceEntriesByLink` 入库后自动合并，已清 15 组重复


## [2026-07-14]

- 修复：青稞文章误把**直播开播时间** `liveStartTime`（如 7/14 20:00）当成发布时间；Kinema4D Talk 等已回写 RSS 真实 `pubDate`
- 修复：同链 zen-import / RSS 重复条目去重（保留长正文）；爬虫忽略 liveStartTime/hotPostTime；feed 相对 guid 归一化


## [2026-07-14]

- 修复：详情时间用 Markdown **收藏字段**（`liked_at` / `collected_at`），格式 `2026-07-13 17:34:23`（去掉 `+0800`）；绝不用帖子 `created_at`
- 修复：无收藏字段时才回退文件创建时间；列表 `published` 同步为收藏时间


## [2026-07-14]

- 修复：小红书 / X **排序**严格按 Typora 路径序；**展示时间**用 Markdown 文件创建时间（birthtime），去掉月末估算（曾因 UTC 进位出现 2026/8/1）
- 修复：列表/详情对 likes 源读 `published`（创建时间），不用排序用的 `publishedTs`


## [2026-07-14]

- 修复：小红书 / X 列表时间按**收藏时间**（`liked_at` / `collected_at`），不再用帖子发布时间；去掉会落到未来的「月末伪时间戳」，避免一堆「刚刚」
- 优化：无真实收藏时间时按目录年月 + Typora 月内序估算，并钳制为过去时间


## [2026-07-14]

- 新增：本地小红书 / X 收藏源（`xhs-likes`、`x-likes`），默认置顶在文章组最上方并带品牌图标
- 新增：`lib/likes-sync.js` + `npm run import:likes`，扫盘 Typora 目录入库；服务启动同步 + 目录 watch 增量
- 新增：小红书原生笔记 UI（图集左右切换 / 圆点 / 评论）；X 推文卡（头像、媒体网格、引用、回复）
- 优化：去掉 Typora 排序前缀展示；图片挂载 `/likes-media/*` 直出本机目录，避免重复拷贝


## [2026-07-14]

- 修复：列表顺序改为与 Typora 一致（相对路径字典序 = 收藏时间从上到下）
- 优化：小红书改为上下堆叠全文布局；正文/评论走完整 GFM 渲染（列表、引用、代码）
- 优化：X 长文加宽阅读栏，修复 `&gt;` 等实体，引用与回复格式可读
- 优化：评论多行引用解析；跳过「有用」归档夹以免打乱收藏流


## [2026-07-14]

- 优化：小红书配图改为正文下纵向铺开，去掉左右轮播与大黑边


## [2026-07-14]

- 优化：X 配图改为纵向铺开（与小红书一致），去掉宫格裁切


## [2026-07-14]

- 修复：小红书笔记顶部多余空行；隐藏外层重复来源/时间栏；收紧作者-标题-正文间距


## [2026-07-14]

- 优化：X 有中文译文时隐藏文末「原文」英文段，仅保留译文（仍可打开原网址）


## [2026-07-14]

- 修复：小红书「原笔记」、X「原帖」点击直接打开原网址，不再弹出正文链接菜单


## [2026-07-14]

- 修复：小红书标题被全局 h1 大 margin 顶开；社交模式隐藏外层 reader-head
- 优化：X 卡片宽度与小红书对齐（满宽约 820px）


## [2026-07-14]

- 优化：小红书标题加大（26px）与正文拉开层级；配图水平居中


## [2026-07-14]

- 修复：小红书/X 整框在阅读栏水平居中，消除右侧大片空白


## [2026-07-14]

- 优化：社交阅读框加宽至约 1040px（居中）


## [2026-07-14]

- 修复：小红书源图标改为官网 favicon 真图标（替换自制 SVG）


## [2026-07-14]

- 新增：macOS LaunchAgent `ai.zen.reader`（`install-launchd.sh`）开机自启 + KeepAlive 自动重启


## [2026-07-27]
- 清理：shared-release 仅保留代码——删除 `public/article-images/*`（约 1.6G 本地化配图）、`data/qmreader.sqlite*`（抓取库）、`data/blog-crawl/*` / `data/logs/*`；目录留 `.gitkeep`
