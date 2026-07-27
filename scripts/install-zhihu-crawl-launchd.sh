#!/bin/zsh
# 安装知乎日更 LaunchAgent：每日 09:00 本机时区跑 crawl-zhihu-auto.sh
# 只写 ~/Library/LaunchAgents/；不把绝对路径回写进仓库 ops/
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ai.zen.reader.zhihu-crawl"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$ROOT/data/logs"
RUN_SCRIPT="$ROOT/scripts/crawl-zhihu-auto.sh"
PYTHON_BIN_DEFAULT="$ROOT/tools/blog_crawler/.venv/bin/python"
NODE_BIN="${NODE_BIN:-}"
HOUR="${ZHIHU_CRAWL_HOUR:-9}"
MINUTE="${ZHIHU_CRAWL_MINUTE:-0}"

# 校验调度时间：整数且合法范围（10# 避免 08/09 被当成八进制）
if ! [[ "$HOUR" =~ ^[0-9]+$ ]]; then
  echo "invalid ZHIHU_CRAWL_HOUR='$HOUR' (expect integer 0-23)" >&2
  exit 1
fi
HOUR=$((10#$HOUR))
if (( HOUR < 0 || HOUR > 23 )); then
  echo "invalid ZHIHU_CRAWL_HOUR='$HOUR' (expect integer 0-23)" >&2
  exit 1
fi
if ! [[ "$MINUTE" =~ ^[0-9]+$ ]]; then
  echo "invalid ZHIHU_CRAWL_MINUTE='$MINUTE' (expect integer 0-59)" >&2
  exit 1
fi
MINUTE=$((10#$MINUTE))
if (( MINUTE < 0 || MINUTE > 59 )); then
  echo "invalid ZHIHU_CRAWL_MINUTE='$MINUTE' (expect integer 0-59)" >&2
  exit 1
fi

if [[ ! -f "$RUN_SCRIPT" ]]; then
  echo "run script not found: $RUN_SCRIPT" >&2
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  if [[ -x /opt/homebrew/bin/node ]]; then NODE_BIN=/opt/homebrew/bin/node
  elif [[ -x /usr/local/bin/node ]]; then NODE_BIN=/usr/local/bin/node
  else NODE_BIN="$(command -v node || true)"
  fi
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node not found" >&2
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-$PYTHON_BIN_DEFAULT}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "python not found or not executable: $PYTHON_BIN" >&2
  echo "  create venv under tools/blog_crawler/.venv or set PYTHON_BIN" >&2
  exit 1
fi

chmod +x "$RUN_SCRIPT"
mkdir -m 700 -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$ROOT/data/blog-crawl"

cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${RUN_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>PYTHON_BIN</key>
    <string>${PYTHON_BIN}</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>ZHIHU_CRAWL_ENABLED</key>
    <string>1</string>
    <key>ZHIHU_EXPORT_PATH</key>
    <string>${ROOT}/data/blog-crawl/zhihu-export.jsonl</string>
    <key>ZHIHU_IMPORT_STAMP</key>
    <string>${ROOT}/data/blog-crawl/zhihu-last-import.json</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/zhihu-crawl.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/zhihu-crawl.stderr.log</string>
</dict>
</plist>
PLIST

# 不把含绝对用户路径的 plist 回写仓库；模板见 ops/*.plist.example
if command -v plutil >/dev/null 2>&1; then
  if ! plutil -lint "$PLIST_DST" >/dev/null; then
    echo "plutil -lint failed: $PLIST_DST" >&2
    exit 1
  fi
fi

UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST_DST"
launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

echo "installed ${LABEL}"
echo "  plist: ${PLIST_DST}"
echo "  schedule: daily ${HOUR}:$(printf '%02d' "$MINUTE") (local timezone)"
echo "  logs: ${LOG_DIR}/zhihu-crawl.{stdout,stderr}.log"
echo "manual run: launchctl kickstart -k gui/${UID_NUM}/${LABEL}"
echo "or: npm run crawl:zhihu:auto"
