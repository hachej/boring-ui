#!/usr/bin/env bash
# e2e_ts_server.sh — start the TS server locally and run the comprehensive
# full-journey smoke with evidence output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${PORT:-9876}"
KEEP_SERVER=0
EVIDENCE_OUT=""
PASSTHROUGH_ARGS=()
TS_SERVER_PID=""
WORKSPACE_ROOT_TMP=""
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

usage() {
  cat <<EOF
Usage: ./scripts/e2e_ts_server.sh [--port PORT] [--evidence-out PATH] [--keep-server] [-- ...extra smoke args]

Starts the local TS server with an isolated temporary workspace root, waits for
/health, then runs tests/smoke/smoke_full_journey.py in dev auth mode.

Examples:
  ./scripts/e2e_ts_server.sh
  ./scripts/e2e_ts_server.sh --port 9999
  ./scripts/e2e_ts_server.sh --evidence-out .agent-evidence/local/e2e.json
  ./scripts/e2e_ts_server.sh -- --exec-timeout 60
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --evidence-out)
      EVIDENCE_OUT="$2"
      shift 2
      ;;
    --keep-server)
      KEEP_SERVER=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      PASSTHROUGH_ARGS+=("$@")
      break
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$EVIDENCE_OUT" ]]; then
  EVIDENCE_OUT="$PROJECT_ROOT/.agent-evidence/e2e/e2e-ts-server-$TIMESTAMP.json"
fi

mkdir -p "$(dirname "$EVIDENCE_OUT")"
SERVER_LOG="${EVIDENCE_OUT%.json}.server.log"
WORKSPACE_ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/boring-ui-e2e-workspace.XXXXXX")"

cleanup() {
  if [[ "$KEEP_SERVER" -eq 0 ]] && [[ -n "$TS_SERVER_PID" ]] && kill -0 "$TS_SERVER_PID" 2>/dev/null; then
    echo "[e2e-ts] Stopping TS server (PID $TS_SERVER_PID)..."
    kill "$TS_SERVER_PID" 2>/dev/null || true
    wait "$TS_SERVER_PID" 2>/dev/null || true
  fi
  if [[ "$KEEP_SERVER" -eq 1 ]]; then
    echo "[e2e-ts] Server preserved because --keep-server was set."
  fi
  echo "[e2e-ts] Workspace root used for this run: $WORKSPACE_ROOT_TMP"
  echo "[e2e-ts] Evidence: $EVIDENCE_OUT"
  echo "[e2e-ts] Server log: $SERVER_LOG"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

echo "[e2e-ts] Starting TS server on port $PORT..."
echo "[e2e-ts] Isolated workspace root: $WORKSPACE_ROOT_TMP"

PORT="$PORT" \
HOST="127.0.0.1" \
CONTROL_PLANE_PROVIDER="local" \
LOCAL_PARITY_MODE="http" \
WORKSPACE_BACKEND="bwrap" \
BORING_SETTINGS_KEY="e2e-smoke-settings-key" \
BORING_UI_WORKSPACE_ROOT="$WORKSPACE_ROOT_TMP" \
npm run server:start >"$SERVER_LOG" 2>&1 &
TS_SERVER_PID=$!

echo "[e2e-ts] Waiting for server to become healthy..."
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$TS_SERVER_PID" 2>/dev/null; then
    echo "[e2e-ts] ERROR: TS server exited during startup"
    tail -n 100 "$SERVER_LOG" || true
    exit 1
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "[e2e-ts] ERROR: server did not become healthy within 60 seconds"
  tail -n 100 "$SERVER_LOG" || true
  exit 1
fi

echo "[e2e-ts] Running full journey smoke..."
python3 tests/smoke/smoke_full_journey.py \
  --base-url "http://127.0.0.1:$PORT" \
  --auth-mode dev \
  --evidence-out "$EVIDENCE_OUT" \
  "${PASSTHROUGH_ARGS[@]}"

echo "[e2e-ts] Full journey smoke passed"
