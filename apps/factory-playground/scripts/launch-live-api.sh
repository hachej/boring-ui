#!/usr/bin/env bash
# Launch the single Factory Hub API (127.0.0.1:${API_PORT:-5230}) for the canonical repository.
set -euo pipefail
APP=$(cd "$(dirname "$0")/../../.." && pwd)
API_PORT=${API_PORT:-5230}
STATE_ROOT=${BORING_FACTORY_STATE_ROOT:-$APP/apps/factory-playground/.factory-state}
LOG=$STATE_ROOT/live.log
if curl -fsS "http://127.0.0.1:$API_PORT/api/v1/workspace/meta" 2>/dev/null | grep -q '"workspaceId":"factory-hub"'; then
  echo "Factory Hub already up (log: $LOG)"
  exit 0
fi
PID=$(ss -ltnp | awk -v port=":$API_PORT" '$4 ~ "127.0.0.1"port"$" {match($0,/pid=([0-9]+)/,a); print a[1]}' || true)
[ -n "${PID:-}" ] && kill "$PID" && sleep 1
cd "$APP"
export OPENAI_API_KEY="${OPENAI_API_KEY:-$(vault kv get -field=api_key secret/openai)}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(vault kv get -field=api_key secret/agent/anthropic)}"
export BORING_FACTORY_WORKSPACE_ROOT="$APP"
export BORING_FACTORY_STATE_ROOT="$STATE_ROOT"
export BORING_FACTORY_ORCHESTRATOR_MODEL=${ORCH_MODEL:-openai-codex:gpt-5.6-sol}
export BORING_FACTORY_WORKER_MODEL=${WORKER_MODEL:-openai-codex:gpt-5.4}
export BORING_FACTORY_REVIEWER_MODEL=${REVIEWER_MODEL:-openai-codex:gpt-5.4}
export BORING_AGENT_DEFAULT_MODEL=openai-codex:gpt-5.6-sol
export BORING_AGENT_SESSION_ROOT="$STATE_ROOT/sessions"
export AGENT_API_PORT="$API_PORT"
mkdir -p "$(dirname "$LOG")"
setsid pnpm exec tsx apps/factory-playground/src/server/dev.ts > "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/v1/workspace/meta" 2>/dev/null; then echo; echo "Factory Hub up (log: $LOG)"; exit 0; fi
  sleep 1
done
echo "failed to start"; tail -40 "$LOG"; exit 1
