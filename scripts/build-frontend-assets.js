#!/usr/bin/env node
/**
 * Build-time ESM bundler pipeline → single runtime IIFE/script bundle.
 *
 *   JS:  content-normalizers.js + lucide-icons.js + app.js + elegance.js
 *        （按原 <script> 顺序拼接，';' 分隔防 ASI 粘连）
 *        → esbuild.build({ format:'iife', minify, sourcemap })
 *        → public/app.bundle.min.js (+ .map)
 *   CSS: styles.css → esbuild.build minify → public/styles.min.css
 *
 * 产物带内容哈希，自动回写 index.html 的 ?v= 引用。
 * index.html 仍只加载 min bundle（非 type=module 多文件）。
 * app.js 仍由 build-frontend-app.js 从 public/src 切片生成。
 *
 * Usage:
 *   node scripts/build-frontend-assets.js          # 构建并回写 index.html
 *   node scripts/build-frontend-assets.js --check  # 校验产物与 index.html 引用是否最新
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const indexFile = path.join(publicDir, 'index.html');

/** 与 index.html 历史 <script> 标签同序；顺序即语义（共享经典脚本作用域） */
const JS_BUNDLE_ORDER = [
  'content-normalizers.js',
  'lucide-icons.js',
  'app.js',
  'elegance.js',
];
const JS_OUT = 'app.bundle.min.js';
const CSS_IN = 'styles.css';
const CSS_OUT = 'styles.min.css';

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

function pickOutput(files, ext) {
  const hit = files.find((f) => f.path.endsWith(ext));
  if (!hit) throw new Error(`esbuild missing output with extension ${ext}`);
  return hit;
}

async function buildJs() {
  const parts = JS_BUNDLE_ORDER.map((name) => {
    const file = path.join(publicDir, name);
    if (!fs.existsSync(file)) throw new Error(`missing bundle input: ${name}`);
    return fs.readFileSync(file, 'utf8');
  });
  // 经典脚本拼接：分号护栏避免跨文件 ASI 粘连（如 elegance.js 以 `(() =>` 开头）
  const source = parts.map((p, i) => `/* ${JS_BUNDLE_ORDER[i]} */\n${p.trimEnd()}`).join('\n;\n');

  const result = await esbuild.build({
    stdin: {
      contents: source,
      resolveDir: publicDir,
      loader: 'js',
      sourcefile: 'app.bundle.js',
    },
    bundle: true,
    write: false,
    outfile: path.join(publicDir, JS_OUT),
    minify: true,
    sourcemap: true,
    target: ['es2020'],
    format: 'iife',
    platform: 'browser',
    legalComments: 'none',
  });

  const jsFile = pickOutput(result.outputFiles, JS_OUT);
  const mapFile = pickOutput(result.outputFiles, `${JS_OUT}.map`);
  return {
    js: Buffer.from(jsFile.contents),
    map: Buffer.from(mapFile.contents),
    raw: Buffer.byteLength(source),
  };
}

async function buildCss() {
  const source = fs.readFileSync(path.join(publicDir, CSS_IN), 'utf8');
  const result = await esbuild.build({
    stdin: {
      contents: source,
      resolveDir: publicDir,
      loader: 'css',
      sourcefile: CSS_IN,
    },
    write: false,
    outfile: path.join(publicDir, CSS_OUT),
    minify: true,
    legalComments: 'none',
  });
  const cssFile = pickOutput(result.outputFiles, CSS_OUT);
  return { css: Buffer.from(cssFile.contents), raw: Buffer.byteLength(source) };
}

/** 回写 index.html 中的版本引用；返回 stamped html */
function stampIndex(html, refs) {
  let next = html;
  for (const { file, hash: h } of refs) {
    const re = new RegExp(`(/${file.replace('.', '\\.')})\\?v=[^"']*`, 'g');
    next = next.replace(re, `$1?v=${h}`);
  }
  return next;
}

const gzipSize = (buf) => require('zlib').gzipSync(Buffer.from(buf)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

(async () => {
  const check = process.argv.includes('--check');
  const [jsOut, cssOut] = await Promise.all([buildJs(), buildCss()]);

  const jsBuf = jsOut.js;
  const cssBuf = cssOut.css;
  const refs = [
    { file: JS_OUT, hash: hash(jsBuf) },
    { file: CSS_OUT, hash: hash(cssBuf) },
  ];

  if (check) {
    const html = fs.readFileSync(indexFile, 'utf8');
    const fresh = stampIndex(html, refs);
    const jsCurrent = fs.existsSync(path.join(publicDir, JS_OUT))
      && fs.readFileSync(path.join(publicDir, JS_OUT)).equals(jsBuf);
    const cssCurrent = fs.existsSync(path.join(publicDir, CSS_OUT))
      && fs.readFileSync(path.join(publicDir, CSS_OUT)).equals(cssBuf);
    if (!jsCurrent || !cssCurrent || fresh !== html) {
      console.error('minified assets are out of date — run: npm run build:assets');
      process.exit(1);
    }
    console.log('minified assets up to date');
    process.exit(0);
  }

  fs.writeFileSync(path.join(publicDir, JS_OUT), jsBuf);
  fs.writeFileSync(path.join(publicDir, `${JS_OUT}.map`), jsOut.map);
  fs.writeFileSync(path.join(publicDir, CSS_OUT), cssBuf);

  const html = fs.readFileSync(indexFile, 'utf8');
  const stamped = stampIndex(html, refs);
  if (stamped !== html) fs.writeFileSync(indexFile, stamped);

  console.log(`wrote public/${JS_OUT}  ${kb(jsOut.raw)} → ${kb(jsBuf.length)} (gzip ${kb(gzipSize(jsBuf))})`);
  console.log(`wrote public/${CSS_OUT} ${kb(cssOut.raw)} → ${kb(cssBuf.length)} (gzip ${kb(gzipSize(cssBuf))})`);
  console.log(`index.html stamped: ${refs.map((r) => `${r.file}?v=${r.hash}`).join(', ')}`);
})().catch((err) => { console.error(err); process.exit(1); });
