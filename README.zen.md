# Zen 阅读（基于 QMReader）

**本质是本地 RSS/博客阅读工作台**，不是爬虫控制台，也不是乔木博客 CMS。

## 打开网站

浏览器打开：**http://127.0.0.1:3780**

### launchd 常驻（推荐）

开机自启 + 崩溃自动重启：

```bash
cd <你的项目目录>
./scripts/install-launchd.sh
```

- 标签：`ai.zen.reader`
- 日志：`data/logs/reader.stdout.log` / `reader.stderr.log`
- 卸载：`./scripts/uninstall-launchd.sh`
- 手动重启：`launchctl kickstart -k gui/$(id -u)/ai.zen.reader`

临时前台跑（会与 launchd 抢端口，先卸载或 bootout）：

```bash
npm start
```

- 自用界面：左上角 **Reader**；**默认打开原文**；本机个人阅读器，无账号系统
- 左侧源列表 + 文章列表常驻（阅读时不会被收没）
- **个人精选**：点进侧栏「个人精选」后，列表顶栏 `+` 粘贴任意网页链接，抓取后收入同名源
- 博客项支持右键打开/复制网址、双击改名、直接拖拽排序；名称和顺序保存在本机浏览器
- 原文以本地原始 Markdown 入库并使用完整 GFM 解析器渲染
- 启动默认**不**自动全量刷新（`STARTUP_REFRESH_DELAY_MS=-1`）
- 源图标在 `public/source-icons/`；导入脚本会从 markdown frontmatter 恢复发布日期，并提取封面图
- 修存量图片：`node scripts/repair-entry-images.js`（可选 `--fetch-og --limit 20` 抓 og:image）

## 目录关系

| 路径 | 作用 |
|------|------|
| `reader/` | 阅读 UI + RSS 刷新 + SQLite |
| `_preserved_blog_data/` | 已抓存量博客 jsonl/md + 精简爬虫备份（可选，放在项目上级目录） |
| `reader/tools/blog_crawler/` | 保留的博客爬取逻辑（可再入库） |

## 导入存量文章

```bash
cd qmreader
node scripts/import-preserved-blog.js
# 或指定文件
node scripts/import-preserved-blog.js ../_preserved_blog_data/jsonl/xxx.jsonl
```

## 小红书 / X 本地收藏

目录（外部爬虫维护，更新后自动入库）：

- `~/Documents/Typora/XHS_Likes`
- `~/Documents/Typora/X_Likes`

```bash
# 手动全量同步
npm run import:likes

# 可选环境变量
# XHS_LIKES_DIR=... X_LIKES_DIR=... LIKES_WATCH=0
```

- 源：`x-likes`（X 收藏）、`xhs-likes`（小红书收藏），置顶在文章组最上方
- 标题去掉 Typora 排序前缀（如 `0pl-` 目录、`ale1t_` 文件前缀）
- 图片通过 `/likes-media/xhs|x/...` 直出原目录，不复制
- 小红书：网页风格图集左右切换；X：推文卡 + 媒体网格
- 服务启动时扫盘 + `fs.watch` 增量（`LIKES_WATCH=0` 可关）

## 知识库小红书博主

目录默认：`~/本机/知识库/小红书`（可用 `XHS_KB_DIR` 覆盖）

| 源 id | 内容 |
|-------|------|
| `xhs-wanyouyinli` | 万有引力AI 主页归档 |
| `xhs-luoye` | 落叶带走秋风（合集按篇切开） |
| `xhs-shutiao` | 整点薯条 |

```bash
npm run import:xhs-kb
```

- 入库格式与小红书收藏一致（`<!--qm-social-v1-->` + `platform: xhs`），走同一原生 UI
- 图片挂载 `/kb-media/...` 直出知识库，不复制
- 服务启动时自动扫盘；`yrc-bot` 等 iCloud 未落地内容会跳过

## b站收藏（localOnly）

侧栏源 **b站收藏**（id 仍为 `bili-watchlater`）：从本机 **Zen 已登录 Cookie** 合并同步 **稍后再看 + 用户收藏夹**；封面为视频封面。

前提：Zen 已登录 bilibili.com（profile 含 `SESSDATA`）。

```bash
# 手动全量同步
npm run import:bili-watchlater
```

| 项 | 说明 |
|----|------|
| 源 | `bili-watchlater`（显示名 b站收藏），`localOnly`，`contentKind: social-bili` |
| 数据 | `toview` + `fav/folder/created/list-all` + 各夹 `fav/resource/list`；同 BV 去重合并 |
| Cookie | 默认读 Zen profile（与知乎相同）；`BILI_ZEN_PROFILE` / `BILI_COOKIE` 可覆盖 |
| 取消 | 阅读区/右键「取消收藏」→ `toview/del` 和/或 `fav/resource/batch-del` + 本地软删 |
| 轮询 | 启动同步 + 默认每 5 分钟；`BILI_POLL_MS` / `BILI_SYNC_ENABLED=0` |
| 封面 | API `pic`/`cover` → `entry.image`（hdslb CDN，列表 `referrerpolicy=no-referrer`） |

## 知乎专栏（localOnly + 日更）

知乎源 **不走 RSS**：用本机 **Zen 浏览器 Cookie** 调官方 API 导出 → 增量入库 SQLite。运行中 Reader 只读本地库。

前提：Zen 已登录知乎（profile 含 `z_c0`）；已装 `playwright` + Chromium。

```bash
# 手动一条龙（export → import → 新文修图 → 写 stamp）
npm run crawl:zhihu:auto

# 安装每日 09:00（本机时区）LaunchAgent
npm run install:zhihu-crawl
# 立刻试跑
launchctl kickstart -k gui/$(id -u)/ai.zen.reader.zhihu-crawl
# 卸载
npm run uninstall:zhihu-crawl
```

| 项 | 说明 |
|----|------|
| 源 | `zhihu-tianqing` 等 5 个作者，`localOnly` |
| 日志 | `data/logs/zhihu-crawl.{stdout,stderr}.log` |
| stamp | `data/blog-crawl/zhihu-last-import.json`；Reader 默认每 5 分钟轮询后重读 DB |
| 关自动 | 环境变量 `ZHIHU_CRAWL_ENABLED=0` 或卸载 launchd |
| Cookie | `ZHIHU_ZEN_PROFILE` 覆盖 Zen profile 路径 |

## 再爬博客并入库

```bash
pip install httpx beautifulsoup4 trafilatura pyyaml
cd <你的项目目录>

# 日常增量：发现 RSS、sitemap 和列表页，只抓本地没有的新 URL，随后入库
npm run crawl:blogs

# 需要重抓已有正文时使用
npm run crawl:blogs:refresh
```

增量数据保存在项目上级目录的 `../_preserved_blog_data/incremental/`：

- `articles.jsonl`：按 URL 去重的累计正文
- `crawl-state.json` / `last-run.json`：每个来源的增量状态和失败记录
- `markdown/<source-id>/`：新增或变化正文的 Markdown 副本
- `non-blog-sources.json`：课程站、GitHub、YouTube、飞书等非博客收藏

站点头像下载到 `public/source-icons/`，路径清单写入 `data/blog-crawl/source-icons.json`，服务重启后自动用于左侧来源列表。

## 维护相关环境变量

公网 README 配置表已覆盖常用项；本机运维常用：

| 变量族 | 用途 |
|--------|------|
| `GEMINI_*` | 英文正文一键译简中（与 DeepSeek 并列） |
| `ZHIHU_*` | 知乎 localOnly 导出 / stamp / 轮询重读 |
| `BILI_*` | b站收藏 Cookie、轮询、开关 |
| `HOST` | 默认 `127.0.0.1`；本仓库仅个人模式、无登录 |

完整默认值见根目录 `.env.example` 与 [README.md](README.md)「配置」表。运行时 DB：`data/qmreader.sqlite`。

## 信息源

自用源在 `lib/sources.js`（Lil'Log、宝玉、Karpathy 等）。  
`zen-imported` 为离线导入专用源。

## 不要用的东西

- 已删除：`qiaomu-blog/`（博客 CMS）、`MediaCrawler-main/`（完整爬虫套件）
- 运维向爬虫 WebUI 不再作为「打开网站」入口
