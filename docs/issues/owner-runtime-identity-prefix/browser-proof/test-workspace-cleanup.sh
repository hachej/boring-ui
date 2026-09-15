#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
harness="docs/issues/owner-runtime-identity-prefix/browser-proof/run-with-workspace.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/owner-pane-proof-cleanup-test.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT

assert_cleaned() {
  local path_file=$1 pid_file=$2
  local workspace child
  workspace="$(cat "$path_file")"
  child="$(cat "$pid_file")"
  [[ "$workspace" == */owner-pane-proof-run.* ]]
  [[ ! -e "$workspace" ]]
  ! kill -0 "$child" 2>/dev/null
}

normal_path="$test_root/normal-path"
normal_pid="$test_root/normal-pid"
"$harness" bash -c 'printf %s "$BORING_OWNER_PANE_PROOF_WORKSPACE_ROOT" > "$1"; sleep 300 & printf %s $! > "$2"' _ "$normal_path" "$normal_pid"
assert_cleaned "$normal_path" "$normal_pid"

failure_path="$test_root/failure-path"
failure_pid="$test_root/failure-pid"
if "$harness" bash -c 'printf %s "$BORING_OWNER_PANE_PROOF_WORKSPACE_ROOT" > "$1"; sleep 0.05 & printf %s $! > "$2"; wait; exit 23' _ "$failure_path" "$failure_pid"; then
  echo "failure command unexpectedly succeeded" >&2
  exit 1
else
  [[ $? -eq 23 ]]
fi
assert_cleaned "$failure_path" "$failure_pid"

term_path="$test_root/term-path"
term_pid="$test_root/term-pid"
"$harness" bash -c 'printf %s "$BORING_OWNER_PANE_PROOF_WORKSPACE_ROOT" > "$1"; sleep 300 & printf %s $! > "$2"; wait' _ "$term_path" "$term_pid" &
harness_pid=$!
for _ in {1..100}; do [[ -s "$term_pid" ]] && break; sleep 0.02; done
[[ -s "$term_pid" ]]
kill -TERM "$harness_pid"
if wait "$harness_pid"; then
  echo "terminated harness unexpectedly succeeded" >&2
  exit 1
else
  [[ $? -eq 143 ]]
fi
assert_cleaned "$term_path" "$term_pid"

echo "workspace cleanup harness passed normal, failure, and SIGTERM cases"
