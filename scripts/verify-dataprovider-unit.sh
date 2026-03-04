#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-$ROOT_DIR/.agent-evidence/beads/bd-2ru8.16}"
LOG_DIR="$EVIDENCE_ROOT/logs/$TS"
mkdir -p "$LOG_DIR"

TEST_TARGETS=(
  "src/front/providers/data/queries.test.jsx"
  "src/front/__tests__/components/FileTree.data-provider.integration.test.jsx"
  "src/front/__tests__/components/GitChangesView.integration.test.jsx"
  "src/front/__tests__/integration/EditorPanel.integration.test.jsx"
  "src/front/__tests__/components/ClaudeStreamChat.data-provider.integration.test.jsx"
)

PASS_COUNT=0
FAIL_COUNT=0

declare -a FAIL_STEPS=()

echo "[verify-dataprovider-unit] root=$ROOT_DIR"
echo "[verify-dataprovider-unit] timestamp=$TS"
echo "[verify-dataprovider-unit] logs=$LOG_DIR"

run_step() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/$name.log"

  echo
  echo "=== STEP: $name ==="
  echo "LOG: $log_file"

  if "$@" >"$log_file" 2>&1; then
    echo "RESULT: PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "RESULT: FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_STEPS+=("$name:$log_file")
  fi
}

run_step "unit-full-test-run" env PATH="/usr/bin:/usr/local/bin:$PATH" npm run test:run
run_step "unit-phase6b-targeted" env PATH="/usr/bin:/usr/local/bin:$PATH" npm run test:run -- "${TEST_TARGETS[@]}"

SUMMARY_FILE="$LOG_DIR/summary.txt"
{
  echo "verify-dataprovider-unit summary"
  echo "timestamp=$TS"
  echo "log_dir=$LOG_DIR"
  echo "pass_steps=$PASS_COUNT"
  echo "fail_steps=$FAIL_COUNT"
  if [[ $FAIL_COUNT -gt 0 ]]; then
    echo "failed_steps="
    for entry in "${FAIL_STEPS[@]}"; do
      echo "  - $entry"
    done
  fi
} > "$SUMMARY_FILE"

cat "$SUMMARY_FILE"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo
  echo "[verify-dataprovider-unit] FAIL: inspect failed step logs above."
  exit 1
fi

echo

echo "[verify-dataprovider-unit] PASS"
