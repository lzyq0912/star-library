# 前端垂直切片源（`public/src`）

开发时改这里的切片文件，再构建回运行时产物：

```bash
npm run build:frontend   # 完整构建：src → app.js → app.bundle.min.js + styles.min.css
npm run check:frontend   # 校验产物与源一致（CI 用）

# 分步：
npm run build:app        # order-data / ORDER → concat → public/app.js
npm run build:app:esm    # 同上（管线别名）
npm run build:assets     # esbuild.build IIFE 打包压缩 → app.bundle.min.js / styles.min.css
```

## 构建期 ESM bundler 管线

| 阶段 | 脚本 | 输入 | 输出 | 说明 |
|------|------|------|------|------|
| 1. 切片拼接 | `build-frontend-app.js` | `ORDER.json` / `order-data.js` + `0x-*.js` | `public/app.js` | 经典脚本字符串拼接，共享 `$`/state 等全局作用域；`check:app` 做恒等 diff |
| 2. 资产打包 | `build-frontend-assets.js` | normalizers + lucide + app.js + elegance（`;` 护栏） | `app.bundle.min.js` + `.map` | **`esbuild.build`**（非 `transform`）：`format:'iife'`、`minify`、`sourcemap`、`target:es2020` |
| 2b. CSS | 同上 | `styles.css` | `styles.min.css` | `esbuild.build` minify |

文档入口：`main.js`（**不**被浏览器加载，仅描述管线 / 供 Node 读取 order）。

顺序由 `ORDER.json` 固定（`order-data.js` 为可 require 镜像）；**禁止**打乱 15 号 `events-init`（事件绑定 + `init` 必须最后）。

## 运行时约束

- **运行时仍是单一全局 IIFE/脚本**：`index.html` 只引用 `app.bundle.min.js?v=<hash>`（**不要**改成 `type=module` 多文件）
- 切片源保持隐式全局脚本风格，因跨文件共享 `$` / `state` 等
- JS 打包顺序 = 原 4 个 `<script>` 标签顺序：content-normalizers → lucide-icons → app → elegance
- 产物带内容哈希，服务端对 `.min.css/.min.js` 返回 `immutable` 一年缓存
- 本项目为**桌面专用**：无移动端媒体查询（≤860px 断点已移除），窄桌面窗口由 861–1500px 断点接管

## 设计令牌

`styles.css` 顶部 `:root` 集中管理：间距（`--space-*`）、圆角（`--radius-*`）、语义色（`--semantic-*`）、动效（`--duration-*` / `--ease-*`）、层级（`--z-*`）。新增样式优先引用令牌，不要新增硬编码色值。
