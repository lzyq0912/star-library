#!/bin/zsh
# 卸载知乎日更 LaunchAgent（只卸 launchd，不清理 data/blog-crawl 或 data/logs）
set -euo pipefail

LABEL="ai.zen.reader.zhihu-crawl"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
if [[ -f "$PLIST_DST" ]]; then
  rm -f "$PLIST_DST"
  echo "removed ${PLIST_DST}"
else
  echo "plist not found: ${PLIST_DST}"
fi
# 刻意不删 data/blog-crawl、data/logs：导出与 stamp 可能仍被 Reader 使用
echo "uninstalled ${LABEL}"
