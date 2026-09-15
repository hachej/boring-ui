#!/usr/bin/env bash
set -uo pipefail

workspace_root="$(mktemp -d "${TMPDIR:-/tmp}/owner-pane-proof-run.XXXXXX")"
export BORING_OWNER_PANE_PROOF_WORKSPACE_ROOT="$workspace_root"
printf 'owner pane proof workspaceRoot=%s\n' "$workspace_root"
child_pid=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  # Address the process group even when its leader has already exited: pnpm may
  # leave descendants alive after Playwright returns or kills a webServer shell.
  if [[ -n "$child_pid" ]] && kill -0 -- "-$child_pid" 2>/dev/null; then
    kill -TERM -- "-$child_pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 -- "-$child_pid" 2>/dev/null || break
      sleep 0.02
    done
    kill -KILL -- "-$child_pid" 2>/dev/null || true
  fi
  [[ -z "$child_pid" ]] || wait "$child_pid" 2>/dev/null || true
  rm -rf -- "$workspace_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

setsid "$@" &
child_pid=$!
wait "$child_pid"
status=$?
exit "$status"
