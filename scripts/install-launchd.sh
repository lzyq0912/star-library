#!/bin/zsh
# 安装 / 重装 Zen Reader LaunchAgent：开机自启 + 崩溃自动重启
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ai.zen.reader"
PLIST_SRC="$ROOT/ops/ai.zen.reader.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$ROOT/data/logs"
RUN_SCRIPT="$ROOT/scripts/run-reader.sh"
NODE_BIN="${NODE_BIN:-}"

if [[ -z "$NODE_BIN" ]]; then
  if [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN=/opt/homebrew/bin/node
  elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN=/usr/local/bin/node
  else
    NODE_BIN="$(command -v node || true)"
  fi
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node not found" >&2
  exit 1
fi

chmod +x "$RUN_SCRIPT"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# 生成 plist（写入本机绝对路径）
cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUN_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/reader.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/reader.stderr.log</string>
</dict>
</plist>
PLIST

# 同步一份到 ops 便于仓库查看
cp "$PLIST_DST" "$PLIST_SRC" 2>/dev/null || true

# 释放端口上的临时 node（避免与 launchd 抢 3780）
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -tiTCP:3780 -sTCP:LISTEN 2>/dev/null || true); do
    # 只杀本机 node，避免误伤
    if ps -p "$pid" -o comm= 2>/dev/null | grep -q node; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
fi

# bootout 旧任务（兼容新 launchctl）
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true
sleep 0.5

launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed LaunchAgent: ${LABEL}"
echo "  plist: $PLIST_DST"
echo "  logs:  $LOG_DIR/reader.stdout.log"
echo "  logs:  $LOG_DIR/reader.stderr.log"
echo
launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -40 || true
sleep 1
if lsof -iTCP:3780 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK: listening on 127.0.0.1:3780"
else
  echo "WARN: port 3780 not listening yet; check logs" >&2
  tail -20 "$LOG_DIR/reader.stderr.log" 2>/dev/null || true
fi
