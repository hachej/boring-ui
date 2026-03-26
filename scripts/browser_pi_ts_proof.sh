#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
VITE_BIN="$PROJECT_ROOT/node_modules/.bin/vite"

API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
KEEP_SERVERS=0
ARTIFACT_DIR=""
TS_SERVER_PID=""
VITE_PID=""
WORKSPACE_ROOT_TMP=""
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<EOF
Usage: ./scripts/browser_pi_ts_proof.sh [--artifact-dir DIR] [--api-port PORT] [--frontend-port PORT] [--keep-servers]

Starts the TS backend in local browser-PI mode, starts the Vite dev frontend
with a browser-scoped Anthropic key, then runs the real-browser Playwright
proof for bd-jzeeb against those reused servers.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --api-port)
      API_PORT="$2"
      shift 2
      ;;
    --frontend-port)
      FRONTEND_PORT="$2"
      shift 2
      ;;
    --keep-servers)
      KEEP_SERVERS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ARTIFACT_DIR" ]]; then
  ARTIFACT_DIR="$PROJECT_ROOT/.agent-evidence/beads/bd-jzeeb/live/$TIMESTAMP"
fi

mkdir -p "$ARTIFACT_DIR"
SERVER_LOG="$ARTIFACT_DIR/ts-server.log"
VITE_LOG="$ARTIFACT_DIR/vite.log"
RUN_LOG="$ARTIFACT_DIR/playwright-run.log"
PW_ARTIFACT_DIR="$ARTIFACT_DIR/playwright"
WORKSPACE_ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/boring-ui-browser-pi-proof.XXXXXX")"

cleanup() {
  if [[ "$KEEP_SERVERS" -eq 0 ]]; then
    if [[ -n "$VITE_PID" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
      kill "$VITE_PID" 2>/dev/null || true
      wait "$VITE_PID" 2>/dev/null || true
    fi
    if [[ -n "$TS_SERVER_PID" ]] && kill -0 "$TS_SERVER_PID" 2>/dev/null; then
      kill "$TS_SERVER_PID" 2>/dev/null || true
      wait "$TS_SERVER_PID" 2>/dev/null || true
    fi
  fi
  echo "[browser-pi-proof] workspace_root=$WORKSPACE_ROOT_TMP"
  echo "[browser-pi-proof] artifact_dir=$ARTIFACT_DIR"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

if [[ -z "${VITE_PI_ANTHROPIC_API_KEY:-}" ]]; then
  export VITE_PI_ANTHROPIC_API_KEY
  VITE_PI_ANTHROPIC_API_KEY="$(vault kv get -field=api_key secret/agent/anthropic)"
fi

PORT="$API_PORT" \
HOST="127.0.0.1" \
CONTROL_PLANE_PROVIDER="local" \
WORKSPACE_BACKEND="bwrap" \
AGENT_RUNTIME="pi" \
AGENT_PLACEMENT="browser" \
BUI_AGENTS_MODE="frontend" \
BORING_SETTINGS_KEY="browser-pi-proof-settings-key" \
BORING_UI_WORKSPACE_ROOT="$WORKSPACE_ROOT_TMP" \
CORS_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}" \
"$NODE_BIN" --import tsx src/server/index.ts >"$SERVER_LOG" 2>&1 &
TS_SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$TS_SERVER_PID" 2>/dev/null; then
    echo "[browser-pi-proof] TS server exited during startup" >&2
    tail -n 100 "$SERVER_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

VITE_API_URL="http://127.0.0.1:${API_PORT}" \
VITE_CONTROL_PLANE_ONBOARDING="1" \
VITE_PI_ANTHROPIC_API_KEY="$VITE_PI_ANTHROPIC_API_KEY" \
"$VITE_BIN" --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort >"$VITE_LOG" 2>&1 &
VITE_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "[browser-pi-proof] Vite dev server exited during startup" >&2
    tail -n 100 "$VITE_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

PW_REAL_BROWSER_PI=1 \
PW_E2E_REUSE_SERVER=1 \
PW_E2E_PORT="${FRONTEND_PORT}" \
PW_E2E_API_PORT="${API_PORT}" \
PW_E2E_WORKERS=1 \
PW_E2E_ARTIFACT_DIR="$PW_ARTIFACT_DIR" \
PW_E2E_RUN_LOG="$RUN_LOG" \
bash scripts/run-playwright-e2e.sh src/front/__tests__/e2e/browser-pi-proof.spec.ts --project=chromium
