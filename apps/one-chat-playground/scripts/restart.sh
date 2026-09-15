#!/usr/bin/env bash
# Restart the playground cleanly. The Vite children survive a plain kill and keep
# the ports, so free the ports first, then start dev:app in the background.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONT_PORT="${ONE_CHAT_PORT:-5320}"; APP_PORT="${SAMPLE_APP_PORT:-5321}"
for port in "$FRONT_PORT" "$APP_PORT"; do
  for pid in $(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' | grep -o 'pid=[0-9]*' | cut -d= -f2); do kill "$pid" 2>/dev/null || true; done
done
pkill -f "tsx src/server/index[.]ts" 2>/dev/null || true
sleep 2
LOG="${ONE_CHAT_LOG:-/var/tmp/one-chat/logs/dev.log}"; mkdir -p "$(dirname "$LOG")"
nohup pnpm -C "$APP_DIR" dev:app > "$LOG" 2>&1 &
for _ in $(seq 1 40); do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$FRONT_PORT/" && curl -s -m 2 -o /dev/null "http://127.0.0.1:$APP_PORT/"; then echo "up: front $FRONT_PORT, app $APP_PORT (log $LOG)"; exit 0; fi
  sleep 2
done
echo "did not come up; see $LOG" >&2; exit 1
