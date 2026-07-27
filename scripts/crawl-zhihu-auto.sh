#!/bin/zsh
# 知乎日更编排：export → import → needs-images repair → 写 stamp 供 Reader 重读 DB
# 供 launchd / 手动：npm run crawl:zhihu:auto
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${ZHIHU_CRAWL_ENABLED:-1}" == "0" ]]; then
  echo "[zhihu-auto] disabled (ZHIHU_CRAWL_ENABLED=0)"
  exit 0
fi

# 单实例：mkdir 原子锁（macOS 无 flock；已有实例在跑则静默退出）
mkdir -m 700 -p "$ROOT/data/blog-crawl"
LOCK_DIR="$ROOT/data/blog-crawl/.zhihu-auto.lock.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[zhihu-auto] another instance running, skip"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM HUP

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
CURL_BIN="/usr/bin/curl"
if [[ ! -x "$CURL_BIN" ]]; then
  CURL_BIN="$(command -v curl || true)"
fi
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  if [[ -x /opt/homebrew/bin/node ]]; then NODE_BIN=/opt/homebrew/bin/node
  elif [[ -x /usr/local/bin/node ]]; then NODE_BIN=/usr/local/bin/node
  else NODE_BIN="$(command -v node || true)"
  fi
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[zhihu-auto] node not found" >&2
  exit 1
fi
# 优先项目 venv（含 playwright）；可用 PYTHON_BIN 覆盖
if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$ROOT/tools/blog_crawler/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT/tools/blog_crawler/.venv/bin/python"
  elif [[ -x /opt/miniconda3/bin/python3 ]]; then
    PYTHON_BIN=/opt/miniconda3/bin/python3
  else
    PYTHON_BIN="$(command -v python3 || true)"
  fi
fi
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
  echo "[zhihu-auto] python not found" >&2
  exit 1
fi
echo "[zhihu-auto] python=$PYTHON_BIN"

ZHIHU_ZEN_PROFILE="${ZHIHU_ZEN_PROFILE:-}"
if [[ -z "$ZHIHU_ZEN_PROFILE" ]]; then
  echo "[zhihu-auto] 请在 .env 或环境变量中设置 ZHIHU_ZEN_PROFILE（Zen/Firefox profile 目录路径）"
  exit 0
fi
ZHIHU_EXPORT_PATH="${ZHIHU_EXPORT_PATH:-$ROOT/data/blog-crawl/zhihu-export.jsonl}"
ZHIHU_IMPORT_STAMP="${ZHIHU_IMPORT_STAMP:-$ROOT/data/blog-crawl/zhihu-last-import.json}"
ZHIHU_REPAIR="${ZHIHU_REPAIR:-1}"
ZHIHU_REPAIR_CONCURRENCY="${ZHIHU_REPAIR_CONCURRENCY:-4}"

SOURCES=(
  zhihu-tianqing
  zhihu-lemonround
  zhihu-fafa
  zhihu-yuanchao
  zhihu-tongsanpang
  zhihu-haotian
)

mkdir -m 700 -p "$(dirname "$ZHIHU_EXPORT_PATH")" "$(dirname "$ZHIHU_IMPORT_STAMP")" "$ROOT/data/logs"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[zhihu-auto] start $started_at"
# 日志只打 basename，避免完整 profile 路径进 launchd 日志
echo "[zhihu-auto] profile=$(basename "$ZHIHU_ZEN_PROFILE")"
echo "[zhihu-auto] export=$ZHIHU_EXPORT_PATH"

write_stamp() {
  # zsh 中 status 为只读（exit code），勿用 status 作变量名
  local job_status="$1"
  local message="${2:-}"
  local finished
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ZHIHU_STAMP_STATUS="$job_status" \
  ZHIHU_STAMP_STARTED="$started_at" \
  ZHIHU_STAMP_FINISHED="$finished" \
  ZHIHU_STAMP_EXPORT="$ZHIHU_EXPORT_PATH" \
  ZHIHU_STAMP_MESSAGE="$message" \
  ZHIHU_STAMP_PATH="$ZHIHU_IMPORT_STAMP" \
  "$NODE_BIN" -e '
    const fs = require("fs");
    const path = process.env.ZHIHU_STAMP_PATH;
    const payload = {
      status: process.env.ZHIHU_STAMP_STATUS || "ok",
      startedAt: process.env.ZHIHU_STAMP_STARTED || "",
      finishedAt: process.env.ZHIHU_STAMP_FINISHED || "",
      exportPath: process.env.ZHIHU_STAMP_EXPORT || "",
      message: process.env.ZHIHU_STAMP_MESSAGE || "",
      ts: Date.now(),
    };
    fs.mkdirSync(require("path").dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
  '
}

on_error() {
  local code=$?
  echo "[zhihu-auto] failed exit=$code" >&2
  write_stamp "error" "exit $code" || true
  exit "$code"
}
trap on_error ERR

# 1) Export（Cookie 失效会非 0；--allow-empty 使 0 篇仍可继续）
"$PYTHON_BIN" "$ROOT/tools/blog_crawler/zhihu_playwright_export.py" \
  --zen-profile "$ZHIHU_ZEN_PROFILE" \
  --output "$ZHIHU_EXPORT_PATH" \
  --allow-empty

if [[ ! -f "$ZHIHU_EXPORT_PATH" ]]; then
  echo "[zhihu-auto] export file missing: $ZHIHU_EXPORT_PATH" >&2
  exit 1
fi

# 2) 增量 import → SQLite
source_args=()
for sid in "${SOURCES[@]}"; do
  source_args+=(--source="$sid")
done
"$PYTHON_BIN" "$ROOT/tools/blog_crawler/crawl_and_import.py" \
  --zhihu-export="$ZHIHU_EXPORT_PATH" \
  "${source_args[@]}" \
  --no-icons \
  --import-qm

# 3) 仅修仍有远程图 / 未转 MD 的条目
if [[ "$ZHIHU_REPAIR" != "0" ]]; then
  echo "[zhihu-auto] repair --needs-images concurrency=$ZHIHU_REPAIR_CONCURRENCY"
  "$NODE_BIN" "$ROOT/scripts/repair-zhihu-local.js" \
    --needs-images \
    --concurrency="$ZHIHU_REPAIR_CONCURRENCY"
else
  echo "[zhihu-auto] repair skipped (ZHIHU_REPAIR=0)"
fi

# 4) Stamp：运行中的 Reader 轮询后 fetchSource 重读 DB
write_stamp "ok" "crawl complete"
echo "[zhihu-auto] done stamp=$ZHIHU_IMPORT_STAMP"

# 5) 立刻通知本机 Reader 重读各知乎源（不依赖 5 分钟 poll）
QMREADER_URL="${QMREADER_URL:-http://127.0.0.1:3780}"
for sid in "${SOURCES[@]}"; do
  if [[ -n "$CURL_BIN" ]] && "$CURL_BIN" -sf -X POST "${QMREADER_URL}/api/sources/${sid}/refresh-hint" \
    -H 'Content-Type: application/json' \
    -d '{"reason":"zhihu-auto-import"}' >/dev/null 2>&1; then
    echo "[zhihu-auto] refresh-hint ok $sid"
  else
    echo "[zhihu-auto] refresh-hint skip $sid (reader 未开或稍后 poll 即可)"
  fi
done

trap - ERR
exit 0
