#!/bin/zsh
# 卸载 Zen Reader LaunchAgent
set -euo pipefail

LABEL="ai.zen.reader"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "Uninstalled ${LABEL}"
