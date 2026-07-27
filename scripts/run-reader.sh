#!/bin/zsh
# Zen Reader 启动入口（供 launchd 调用）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3780}"

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  if [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN=/opt/homebrew/bin/node
  elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN=/usr/local/bin/node
  else
    NODE_BIN="$(command -v node)"
  fi
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node not found" >&2
  exit 1
fi

exec "$NODE_BIN" "$ROOT/server.js"
