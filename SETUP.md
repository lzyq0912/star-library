# QMReader 分享版 · 快速上手

这是 QMReader（自托管 AI 阅读工作台）的脱敏分享版：保留全部功能与 12 个公共博客源的文章数据（约 2400 篇，含部分中文翻译资产），移除了原作者的所有个人数据、账户信息与密钥。**你只需按下文配置自己的凭据，即可使用全部功能。**

## 1. 环境要求

- Node.js ≥ 22（`node --version` 确认）
- 可选：Python 3.10+（仅知乎爬虫需要）

## 2. 三步启动

```bash
cd shared-release        # 即本目录
npm install               # 安装依赖
cp .env.example .env      # 生成配置（可先不改）
npm start                 # 默认 http://127.0.0.1:8080
```

打开浏览器访问 `http://127.0.0.1:8080`，即可看到可直接阅读的公共博客文章（Lil'Log、Karpathy、宝玉、ArthurChiao、青稞社区等 12 个源）。

## 3. 功能与配置对照表

| 功能 | 开箱可用 | 需要配置 |
|---|---|---|
| 公共博客源阅读 / RSS 自动刷新 | ✅ | — |
| 个人精选（粘贴任意链接收录） | ✅ | — |
| GitHub 项目卡片 | ✅ | `GITHUB_TOKEN`（可选，提额度） |
| 文章翻译 / 改写 / AI 伴读 | ❌ | `DEEPSEEK_API_KEY` 或 `GEMINI_API_KEY` |
| B站稍后再看 + 收藏夹同步 | ❌ | `BILI_COOKIE` 或 `BILI_ZEN_PROFILE` |
| 知乎博主专栏爬取 | ❌ | `ZHIHU_ZEN_PROFILE` + Python 环境 |
| X 收藏流 | ❌ | `X_LIKES_DIR`（本地 Markdown 目录） |
| 小红书收藏流 | ❌ | `XHS_LIKES_DIR`（本地 Markdown 目录） |
| 小红书博主知识库 | ❌ | `XHS_KB_DIR`（本地知识库目录） |

各项的详细填写方法见 `.env.example` 内注释。

## 4. 各平台凭据配置说明

### AI（翻译 / 改写 / 伴读）
- DeepSeek：在 [platform.deepseek.com](https://platform.deepseek.com) 创建 API Key，填入 `DEEPSEEK_API_KEY`。
- Gemini：在 [Google AI Studio](https://aistudio.google.com) 创建 Key，填入 `GEMINI_API_KEY`。
- 两者都配时优先 DeepSeek；也可在前端设置里填自己的 Key（仅存浏览器本地）。

### B站 Cookie
方式 A（任何浏览器都可用）：登录 bilibili.com → 开发者工具 Network → 复制请求头 Cookie 中的关键字段：

```
BILI_COOKIE=SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx
```

方式 B（Zen/Firefox 用户）：把 `BILI_ZEN_PROFILE` 指向浏览器 profile 目录，程序自动离线读取已登录 Cookie（只读拷贝，不碰浏览器运行状态）。

### 知乎
知乎爬虫从 Zen/Firefox profile 离线读取登录 Cookie（导出文件不含 Cookie）：

```bash
# .env 中设置
ZHIHU_ZEN_PROFILE=/Users/<你>/Library/Application Support/zen/Profiles/<目录>

# 首次准备 Python 环境
cd tools/blog_crawler && python3 -m venv .venv && .venv/bin/pip install playwright requests

# 修改关注名单：编辑 tools/blog_crawler/zhihu_playwright_export.py 的 PROFILES
# （同时在 lib/sources.js 增删对应的 zhihu-* 源定义）

# 手动全量抓取 + 导入
npm run crawl:zhihu:all
# 或每日自动（macOS launchd）
npm run install:zhihu-crawl
```

### X / 小红书收藏
这两个源不直接调用平台接口，而是**监听本地 Markdown 目录**（由你自己的导出工具产出，带 `<!--qm-social-v1` 元数据头的格式见 `lib/likes-sync.js` 注释）。设置 `X_LIKES_DIR` / `XHS_LIKES_DIR` 后新文件自动入库，图片随文件夹一起被服务。

## 5. 常用命令

```bash
npm start                    # 启动服务
npm test                     # 运行测试（120 项）
npm run build:frontend       # 前端重新打包（改了 public/src 后执行）
npm run import:likes         # 手动全量导入 X/小红书收藏
npm run import:xhs-kb        # 手动导入小红书博主知识库
npm run import:bili-watchlater  # 手动同步 B站
npm run crawl:zhihu:all      # 知乎全量抓取 + 导入
```

## 6. 部署（可选）

- macOS 常驻：参考 `ops/ai.zen.reader.plist.example`（launchd），替换其中占位路径后 `scripts/install-launchd.sh`。
- Linux：参考 `ops/qmreader.service`（systemd）与 `scripts/install-systemd-service.sh`。
- Docker：仓库自带 `Dockerfile` 与 `docker-compose.yml`。
- ⚠️ 服务本身无登录鉴权，默认只绑 `127.0.0.1`；如需公网访问请置于带认证的反向代理之后。

## 7. 本分享版相对原版的差异

- 已移除：原作者的 `.env` 密钥、浏览器 profile 标识、所有个人收藏内容（X / 小红书 / B站 / 知乎文章 / 个人精选）、笔记 / 划线 / AI 对话记录、本地账号、日志。
- 已删除：「近期」课程库源（`zen-recent`）及其全部代码与数据（深度绑定原作者的本机浏览器工作流，通用性低）。
- 保留：12 个公共博客源的文章与图片、已生成的部分中文翻译、全部功能代码与同步框架。
- 数据库仅含公共博客内容；`data/state.json`、`data/cache.json` 会在首次运行时自动重建。
