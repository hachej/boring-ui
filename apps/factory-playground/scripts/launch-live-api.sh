#!/usr/bin/env bash
# Launch the Factory playground API (127.0.0.1:5230) against EPIC_WT with per-seat models; creds from env or vault.
set -euo pipefail
APP=$(cd "$(dirname "$0")/../../.." && pwd)
EPIC_WT=${EPIC_WT:?EPIC_WT is required}
LOG=$APP/apps/factory-playground/.factory-state/live.log
PID=$(ss -ltnp | awk '/127.0.0.1:5230/ {match($0,/pid=([0-9]+)/,a); print a[1]}' || true)
[ -n "${PID:-}" ] && kill "$PID" && sleep 1
cd $APP
export OPENAI_API_KEY="${OPENAI_API_KEY:-$(vault kv get -field=api_key secret/openai)}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(vault kv get -field=api_key secret/agent/anthropic)}"
export BORING_FACTORY_WORKSPACE_ROOT=$EPIC_WT
export BORING_FACTORY_EPIC_KEY=${EPIC_KEY:-live-farewell}
export BORING_FACTORY_FEATURE_NAME=${FEATURE_NAME:-}
export BORING_FACTORY_ORCHESTRATOR_MODEL=${ORCH_MODEL:-openai-codex:gpt-5.6-sol}
export BORING_FACTORY_WORKER_MODEL=${WORKER_MODEL:-openai-codex:gpt-5.4}
export BORING_FACTORY_REVIEWER_MODEL=${REVIEWER_MODEL:-openai-codex:gpt-5.4}
export BORING_AGENT_DEFAULT_MODEL=openai-codex:gpt-5.6-sol
export BORING_AGENT_SESSION_ROOT=$APP/apps/factory-playground/.factory-state/sessions
mkdir -p "$(dirname $LOG)"
setsid pnpm exec tsx apps/factory-playground/src/server/dev.ts > $LOG 2>&1 < /dev/null &
for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:5230/api/v1/workspace/meta 2>/dev/null; then echo; echo "up (log: $LOG)"; exit 0; fi
  sleep 1
done
echo "failed to start"; tail -40 $LOG; exit 1
