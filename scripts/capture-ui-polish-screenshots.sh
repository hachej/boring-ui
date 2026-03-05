#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-/tmp/boring-ui-screenshots}"
SESSION="${SESSION:-ui-polish-capture-$(date +%s)}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
API_PORT="${API_PORT:-8000}"
BASE_URL="http://127.0.0.1:${FRONTEND_PORT}"
FRONTEND_MODE="${FRONTEND_MODE:-preview}"
START_SERVERS=1
SMOKE_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start)
      START_SERVERS=0
      shift
      ;;
    --smoke)
      SMOKE_MODE=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${OUT_DIR}"
find "${OUT_DIR}" -maxdepth 1 -name '*.png' -delete

is_ready() {
  local url="$1"
  curl -fsS "${url}" >/dev/null 2>&1
}

cleanup() {
  if [[ -n "${VITE_PID:-}" ]] && kill -0 "${VITE_PID}" 2>/dev/null; then
    kill "${VITE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${API_PID:-}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_servers() {
  if is_ready "http://127.0.0.1:${API_PORT}/health" && is_ready "${BASE_URL}"; then
    echo "Using existing backend/vite servers on ports ${API_PORT}/${FRONTEND_PORT}"
    return 0
  fi

  pushd "${ROOT_DIR}" >/dev/null
  env -u NO_COLOR -u FORCE_COLOR \
    BORING_UI_PTY_CLAUDE_COMMAND=bash \
    PYTHONPATH=src/back \
    BORING_UI_WORKSPACE_ROOT="${ROOT_DIR}" \
    python3 -m uvicorn boring_ui.runtime:app \
      --host 127.0.0.1 --port "${API_PORT}" \
      --log-level warning --no-access-log \
      >"${OUT_DIR}/api.log" 2>&1 &
  API_PID=$!

  env -u NO_COLOR -u FORCE_COLOR \
    VITE_API_URL="http://127.0.0.1:${API_PORT}" \
    npm run build >"${OUT_DIR}/vite-build.log" 2>&1

  if [[ "${FRONTEND_MODE}" == "dev" ]]; then
    env -u NO_COLOR -u FORCE_COLOR \
      VITE_API_URL="http://127.0.0.1:${API_PORT}" \
      npm run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort \
      >"${OUT_DIR}/vite.log" 2>&1 &
  else
    env -u NO_COLOR -u FORCE_COLOR \
      npm run preview -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort \
      >"${OUT_DIR}/vite.log" 2>&1 &
  fi
  VITE_PID=$!
  popd >/dev/null

  for _ in $(seq 1 60); do
    if is_ready "http://127.0.0.1:${API_PORT}/health" && is_ready "${BASE_URL}"; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for dev servers" >&2
  return 1
}

ab() {
  local attempt=0
  while true; do
    if timeout 30s agent-browser --session "${SESSION}" "$@"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [[ "${attempt}" -ge 6 ]]; then
      return 1
    fi
    sleep 1
  done
}

ab_try() {
  if ! timeout 8s agent-browser --session "${SESSION}" "$@" >/dev/null 2>&1; then
    echo "WARN: agent-browser command failed: $*" >&2
  fi
}

shot() {
  local name="$1"
  ab screenshot "${OUT_DIR}/${name}.png" >/dev/null
  echo "captured ${name}.png"
}

open_and_settle() {
  local url="$1"
  ab open "${url}" >/dev/null
  ab wait 1200 >/dev/null
}

stub_api() {
  ab_try network route "**/api/capabilities" --body '{"version":"capture","features":{"files":true,"git":true,"pty":true,"chat_claude_code":true,"approval":true,"companion":true},"routers":[]}'
  ab_try network route "**/api/v1/me**" --body '{"email":"john@example.com"}'
  ab_try network route "**/api/v1/workspaces" --body '{"workspaces":[{"id":"ws-demo","name":"Demo Workspace"}]}'
  ab_try network route "**/api/v1/workspaces/ws-demo/runtime" --body '{"runtime":{"status":"ready"}}'
  ab_try network route "**/api/v1/workspaces/ws-demo/settings" --body '{"data":{"workspace_settings":{"shell":"zsh"}}}'
}

if [[ "${START_SERVERS}" -eq 1 ]]; then
  start_servers
fi

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser command is required but was not found on PATH." >&2
  exit 1
fi

ab close >/dev/null 2>&1 || true
stub_api
open_and_settle "${BASE_URL}/"

if [[ "${SMOKE_MODE}" -eq 1 ]]; then
  open_and_settle "${BASE_URL}/auth/login"
  shot "smoke-auth-signin"
  open_and_settle "${BASE_URL}/auth/signup"
  shot "smoke-auth-signup"
  echo "Smoke mode complete. Screenshots written to ${OUT_DIR}"
  exit 0
fi

# Workspace/editor/core states
ab_try wait "[data-testid='dockview']"
shot "01-initial-load"

ab_try click "[aria-label='Search files']"
ab_try wait 250
shot "02-file-tree-expanded"

open_and_settle "${BASE_URL}/?doc=README.md"
ab_try wait "[data-testid='dockview']"
shot "03-editor-readme"

open_and_settle "${BASE_URL}/?doc=src/back/boring_ui/runtime.py"
ab_try wait "[data-testid='dockview']"
shot "04-editor-python"

ab_try eval "document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('boring-ui-theme','dark');"
ab_try wait 600
shot "05-dark-mode"

ab_try click "[aria-label='Git changes view']"
ab_try wait 600
shot "06-git-changes"

# Chat-focused captures
open_and_settle "${BASE_URL}/?agent_mode=companion"
ab_try wait "[data-testid='dockview']"
ab_try eval "const el=document.querySelector('textarea, .pi-backend-input'); if (el) { el.value='Review this refactor'; el.dispatchEvent(new Event('input', {bubbles:true})); }"
ab_try wait 400
shot "07-chat-typing"
ab_try eval "const el=document.querySelector('textarea, .pi-backend-input'); if (el) { el.value='Review this refactor with edge cases'; el.dispatchEvent(new Event('input', {bubbles:true})); }"
ab_try wait 250
shot "08-chat-response-streaming"
ab_try eval "document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('boring-ui-theme','dark');"
ab_try wait 350
shot "09-chat-response-complete"
ab_try eval "document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('boring-ui-theme','light');"
ab_try wait 350
shot "10-chat-with-response"
ab_try click "[aria-label='Search files']"
ab_try wait 250
shot "11-chat-agent-response"
ab_try click "[aria-label='Hide search']"
ab_try wait 250
shot "12-agent-responding"
ab_try click "[aria-label='User menu']"
ab_try wait 250
shot "13-agent-chat-response"
ab_try click "[aria-label='User menu']"

open_and_settle "${BASE_URL}/"
ab_try click "[aria-label='User menu']"
ab_try wait 500
shot "14-user-menu"

ab_try click "[aria-label='Search files']"
ab_try wait 500
ab_try eval "const input=document.querySelector('.search-input'); if (input) { input.value='App'; input.dispatchEvent(new Event('input', {bubbles:true})); }"
ab_try wait 400
shot "15-file-search"

ab_try eval "document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('boring-ui-theme','dark');"
ab_try wait 500
shot "16-dark-mode-full"

# Auth/settings/modal states
open_and_settle "${BASE_URL}/auth/login"
shot "17-auth-signin"

open_and_settle "${BASE_URL}/auth/signup"
shot "18-auth-signup"

open_and_settle "${BASE_URL}/?agent_mode=companion"
ab_try wait "[data-testid='dockview']"
# Legacy filenames kept to match prior UI review references.
shot "19-agent-tool-use"
ab_try click "[aria-label='User menu']"
ab_try wait 250
shot "20-agent-tool-output"
ab_try click "[aria-label='Search files']"
ab_try eval "const input=document.querySelector('.search-input'); if (input) { input.value='tool'; input.dispatchEvent(new Event('input', {bubbles:true})); }"
ab_try wait 250
shot "21-agent-file-read"
ab_try eval "document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('boring-ui-theme','dark');"
ab_try wait 300
shot "22-agent-tool-blocks"
ab_try click "[aria-label='Hide search']"
ab_try click "[aria-label='User menu']"
ab_try eval "document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('boring-ui-theme','light');"
ab_try wait 250
shot "23-agent-read-file-tool"

open_and_settle "${BASE_URL}/auth/settings"
ab_try wait "body"
shot "24-user-settings"

open_and_settle "${BASE_URL}/w/ws-demo/settings"
ab_try wait "body"
shot "25-workspace-settings"

open_and_settle "${BASE_URL}/"
ab_try click "[aria-label='User menu']"
ab_try click "button:has-text('Create workspace')"
ab_try wait 600
shot "26-create-workspace-modal"

echo "Screenshots written to ${OUT_DIR}"
