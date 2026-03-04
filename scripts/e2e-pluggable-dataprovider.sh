#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODE="local"
WITH_LOGS=0
BACKEND="all"
LOG_DIR=""

usage() {
  cat <<USAGE
Usage: bash scripts/e2e-pluggable-dataprovider.sh [options]

Run cross-backend E2E verification scenarios with structured logs.

Options:
  --mode <local|headless>   Execution mode (default: local)
  --headless                Shortcut for --mode headless
  --with-logs               Stream per-backend logs to stdout while running
  --backend <name>          Backend to run: all|smoke|http|poc1|poc2 (default: all)
  --log-dir <path>          Override output directory (default: timestamped path)
  --help                    Show this help

Output schema:
  BACKEND|SCENARIO|STATUS|DETAIL
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --headless)
      MODE="headless"
      shift
      ;;
    --with-logs)
      WITH_LOGS=1
      shift
      ;;
    --backend)
      BACKEND="${2:-}"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "local" && "$MODE" != "headless" ]]; then
  echo "Invalid --mode: $MODE (expected local|headless)" >&2
  exit 2
fi

case "$BACKEND" in
  all|smoke|http|poc1|poc2) ;;
  *)
    echo "Invalid --backend: $BACKEND (expected all|smoke|http|poc1|poc2)" >&2
    exit 2
    ;;
esac

TS="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$LOG_DIR" ]]; then
  LOG_DIR="${REPO_ROOT}/.agent-evidence/e2e-pluggable-dataprovider/logs/${TS}"
fi
mkdir -p "$LOG_DIR"

MATRIX_TSV="${LOG_DIR}/matrix.tsv"
MATRIX_MD="${LOG_DIR}/matrix-summary.md"
: > "$MATRIX_TSV"

declare -a RESULT_ROWS=()
declare -A BACKEND_TOTAL=()
declare -A BACKEND_FAIL=()
FAILURES=0

record_result() {
  local backend="$1"
  local scenario="$2"
  local status="$3"
  local detail="$4"

  RESULT_ROWS+=("${backend}|${scenario}|${status}|${detail}")
  BACKEND_TOTAL["$backend"]=$(( ${BACKEND_TOTAL["$backend"]:-0} + 1 ))
  if [[ "$status" != "PASS" ]]; then
    BACKEND_FAIL["$backend"]=$(( ${BACKEND_FAIL["$backend"]:-0} + 1 ))
    FAILURES=$((FAILURES + 1))
  fi
}

capture_backend() {
  local backend="$1"
  local log_file="${LOG_DIR}/${backend}.log"

  if [[ "$WITH_LOGS" -eq 1 ]]; then
    {
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] backend=${backend} mode=${MODE}"
      run_backend "$backend"
    } > >(tee "$log_file") 2>&1
  else
    {
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] backend=${backend} mode=${MODE}"
      run_backend "$backend"
    } > "$log_file" 2>&1
  fi
}

mark_backend_fail() {
  local backend="$1"
  local reason="$2"
  record_result "$backend" "file_list_visible" "FAIL" "$reason"
  record_result "$backend" "create_file" "FAIL" "$reason"
  record_result "$backend" "edit_save_file" "FAIL" "$reason"
  record_result "$backend" "rename_move_delete_file" "FAIL" "$reason"
  record_result "$backend" "git_status_visible_updates" "FAIL" "$reason"
  record_result "$backend" "agent_mutation_reflected_ui" "FAIL" "$reason"
}

run_http() {
  local backend="http"
  local port=8010
  local base="http://127.0.0.1:${port}"
  local scratch_rel=".agent-evidence/e2e-scratch/http-${TS}"
  local scratch_abs="${REPO_ROOT}/${scratch_rel}"

  mkdir -p "${scratch_abs}/sub"

  python3 "${REPO_ROOT}/scripts/run_backend.py" --host 127.0.0.1 --port "$port" \
    > "${LOG_DIR}/${backend}-server.log" 2>&1 &
  local server_pid=$!
  trap 'kill "$server_pid" >/dev/null 2>&1 || true' RETURN

  local ready=0
  for _ in $(seq 1 40); do
    if curl -fsS "${base}/api/project" > /dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done

  if [[ "$ready" -ne 1 ]]; then
    mark_backend_fail "$backend" "backend startup failed (see ${backend}-server.log)"
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
    trap - RETURN
    return
  fi

  local list_json
  list_json="$(curl -fsS "${base}/api/v1/files/list?path=.")" || list_json=""
  if [[ "$list_json" == *"\"entries\""* ]]; then
    record_result "$backend" "file_list_visible" "PASS" "GET /api/v1/files/list returned entries"
  else
    record_result "$backend" "file_list_visible" "FAIL" "GET /api/v1/files/list missing entries"
  fi

  local create_ok=0
  if curl -fsS -X PUT "${base}/api/v1/files/write?path=${scratch_rel}/scenario.txt" \
    -H 'Content-Type: application/json' \
    -d '{"content":"alpha"}' > /dev/null; then
    create_ok=1
    record_result "$backend" "create_file" "PASS" "PUT /api/v1/files/write created scenario file"
  else
    record_result "$backend" "create_file" "FAIL" "PUT /api/v1/files/write failed"
  fi

  if [[ "$create_ok" -eq 1 ]]; then
    curl -fsS -X PUT "${base}/api/v1/files/write?path=${scratch_rel}/scenario.txt" \
      -H 'Content-Type: application/json' \
      -d '{"content":"beta"}' > /dev/null || true
    local read_json
    read_json="$(curl -fsS "${base}/api/v1/files/read?path=${scratch_rel}/scenario.txt")" || read_json=""
    if [[ "$read_json" == *"beta"* ]]; then
      record_result "$backend" "edit_save_file" "PASS" "PUT+GET round-trip content updated"
    else
      record_result "$backend" "edit_save_file" "FAIL" "Content round-trip mismatch after save"
    fi
  else
    record_result "$backend" "edit_save_file" "FAIL" "Skipped because create_file failed"
  fi

  local rename_move_delete_ok=1
  curl -fsS -X POST "${base}/api/v1/files/rename" \
    -H 'Content-Type: application/json' \
    -d "{\"old_path\":\"${scratch_rel}/scenario.txt\",\"new_path\":\"${scratch_rel}/scenario-renamed.txt\"}" > /dev/null || rename_move_delete_ok=0
  curl -fsS -X POST "${base}/api/v1/files/move" \
    -H 'Content-Type: application/json' \
    -d "{\"src_path\":\"${scratch_rel}/scenario-renamed.txt\",\"dest_dir\":\"${scratch_rel}/sub\"}" > /dev/null || rename_move_delete_ok=0
  curl -fsS -X DELETE "${base}/api/v1/files/delete?path=${scratch_rel}/sub/scenario-renamed.txt" > /dev/null || rename_move_delete_ok=0

  if [[ "$rename_move_delete_ok" -eq 1 ]]; then
    record_result "$backend" "rename_move_delete_file" "PASS" "rename/move/delete endpoints succeeded"
  else
    record_result "$backend" "rename_move_delete_file" "FAIL" "rename/move/delete endpoint failure"
  fi

  local git_json
  git_json="$(curl -fsS "${base}/api/v1/git/status")" || git_json=""
  if [[ "$git_json" == *"\"files\""* && "$git_json" == *"\"is_repo\""* ]]; then
    record_result "$backend" "git_status_visible_updates" "PASS" "GET /api/v1/git/status returned status payload"
  else
    record_result "$backend" "git_status_visible_updates" "FAIL" "GET /api/v1/git/status returned invalid payload"
  fi

  local mutation_file="${scratch_rel}/agent-mutation.txt"
  local mutation_ok=0
  if curl -fsS -X PUT "${base}/api/v1/files/write?path=${mutation_file}" \
    -H 'Content-Type: application/json' \
    -d '{"content":"agent-mutation"}' > /dev/null; then
    local dir_json
    dir_json="$(curl -fsS "${base}/api/v1/files/list?path=${scratch_rel}")" || dir_json=""
    if [[ "$dir_json" == *"agent-mutation.txt"* ]]; then
      mutation_ok=1
    fi
  fi

  if [[ "$mutation_ok" -eq 1 ]]; then
    record_result "$backend" "agent_mutation_reflected_ui" "PASS" "Mutation visible immediately in list payload"
  else
    record_result "$backend" "agent_mutation_reflected_ui" "FAIL" "Mutation not reflected in follow-up list"
  fi

  curl -fsS -X DELETE "${base}/api/v1/files/delete?path=${mutation_file}" > /dev/null 2>&1 || true

  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" 2>/dev/null || true
  trap - RETURN
}

run_poc1() {
  local backend="poc1"
  local dir="/home/ubuntu/projects/boring-macro/poc/browser-sandbox"

  if ! (cd "$dir" && npm run build > "${LOG_DIR}/${backend}-build.log" 2>&1); then
    mark_backend_fail "$backend" "npm run build failed (see ${backend}-build.log)"
    return
  fi

  set +e
  (cd "$dir" && timeout 20s npm run dev -- --host 127.0.0.1 --port 5180 > "${LOG_DIR}/${backend}-dev.log" 2>&1)
  local code=$?
  set -e
  if [[ "$code" -ne 0 && "$code" -ne 124 ]]; then
    mark_backend_fail "$backend" "dev startup failed (see ${backend}-dev.log)"
    return
  fi

  if rg -q "essential:\s*\['filetree'\]" "$dir/src/main.tsx" \
    && rg -q "list:\s*async" "$dir/src/adapters/lightningFsProvider.ts"; then
    record_result "$backend" "file_list_visible" "PASS" "filetree panel + files.list adapter present"
  else
    record_result "$backend" "file_list_visible" "FAIL" "Missing filetree/layout or files.list adapter"
  fi

  if rg -q "write:\s*async" "$dir/src/adapters/lightningFsProvider.ts"; then
    record_result "$backend" "create_file" "PASS" "files.write adapter present"
  else
    record_result "$backend" "create_file" "FAIL" "files.write adapter missing"
  fi

  if rg -q "read:\s*async" "$dir/src/adapters/lightningFsProvider.ts" \
    && rg -q "write:\s*async" "$dir/src/adapters/lightningFsProvider.ts"; then
    record_result "$backend" "edit_save_file" "PASS" "files.read + files.write adapters present"
  else
    record_result "$backend" "edit_save_file" "FAIL" "files.read/write adapter missing"
  fi

  if rg -q "delete:\s*async" "$dir/src/adapters/lightningFsProvider.ts" \
    && rg -q "rename:\s*async" "$dir/src/adapters/lightningFsProvider.ts" \
    && rg -q "move:\s*async" "$dir/src/adapters/lightningFsProvider.ts"; then
    record_result "$backend" "rename_move_delete_file" "PASS" "files.rename/move/delete adapters present"
  else
    record_result "$backend" "rename_move_delete_file" "FAIL" "rename/move/delete adapter coverage incomplete"
  fi

  if rg -q "return 'M'" "$dir/src/adapters/isomorphicGitProvider.ts" \
    && rg -q "return 'U'" "$dir/src/adapters/isomorphicGitProvider.ts" \
    && rg -q "return 'A'" "$dir/src/adapters/isomorphicGitProvider.ts" \
    && rg -q "return 'D'" "$dir/src/adapters/isomorphicGitProvider.ts" \
    && rg -q "return 'C'" "$dir/src/adapters/isomorphicGitProvider.ts" \
    && rg -q "gitStatus:\s*true" "$dir/src/main.tsx"; then
    record_result "$backend" "git_status_visible_updates" "PASS" "canonical git normalization + gitStatus feature enabled"
  else
    record_result "$backend" "git_status_visible_updates" "FAIL" "git status normalization/feature wiring incomplete"
  fi

  if rg -F -q "invalidateQueries({ queryKey: queryKeys.files.all })" "$dir/src/agent/tools/factory.ts" \
    && rg -F -q "invalidateQueries({ queryKey: queryKeys.git.all })" "$dir/src/agent/tools/factory.ts" \
    && rg -q "setPiAgentConfig\(" "$dir/src/main.tsx"; then
    record_result "$backend" "agent_mutation_reflected_ui" "PASS" "tool invalidation + PI tool wiring present"
  else
    record_result "$backend" "agent_mutation_reflected_ui" "FAIL" "tool invalidation/wiring missing"
  fi
}

run_poc2() {
  local backend="poc2"
  local dir="/home/ubuntu/projects/boring-macro/poc2"

  if ! (cd "$dir" && npm run build > "${LOG_DIR}/${backend}-build.log" 2>&1); then
    mark_backend_fail "$backend" "npm run build failed (see ${backend}-build.log)"
    return
  fi

  set +e
  (cd "$dir" && timeout 20s npm run dev -- --host 127.0.0.1 --port 5182 > "${LOG_DIR}/${backend}-dev.log" 2>&1)
  local code=$?
  set -e
  if [[ "$code" -ne 0 && "$code" -ne 124 ]]; then
    mark_backend_fail "$backend" "dev startup failed (see ${backend}-dev.log)"
    return
  fi

  if rg -q "essential:\s*\['filetree'\]" "$dir/src/main.jsx" \
    && rg -q "list:\s*async" "$dir/src/adapters/cheerpxProvider.js"; then
    record_result "$backend" "file_list_visible" "PASS" "filetree panel + files.list adapter present"
  else
    record_result "$backend" "file_list_visible" "FAIL" "Missing filetree/layout or files.list adapter"
  fi

  if rg -q "write:\s*async" "$dir/src/adapters/cheerpxProvider.js"; then
    record_result "$backend" "create_file" "PASS" "files.write adapter present"
  else
    record_result "$backend" "create_file" "FAIL" "files.write adapter missing"
  fi

  if rg -q "read:\s*async" "$dir/src/adapters/cheerpxProvider.js" \
    && rg -q "write:\s*async" "$dir/src/adapters/cheerpxProvider.js"; then
    record_result "$backend" "edit_save_file" "PASS" "files.read + files.write adapters present"
  else
    record_result "$backend" "edit_save_file" "FAIL" "files.read/write adapter missing"
  fi

  if rg -q "delete:\s*async" "$dir/src/adapters/cheerpxProvider.js" \
    && rg -q "rename:\s*async" "$dir/src/adapters/cheerpxProvider.js" \
    && rg -q "move:\s*async" "$dir/src/adapters/cheerpxProvider.js"; then
    record_result "$backend" "rename_move_delete_file" "PASS" "files.rename/move/delete adapters present"
  else
    record_result "$backend" "rename_move_delete_file" "FAIL" "rename/move/delete adapter coverage incomplete"
  fi

  if rg -q "CANONICAL_GIT_CODES" "$dir/src/adapters/cheerpxProvider.js" \
    && rg -q "status:\s*async" "$dir/src/adapters/cheerpxProvider.js" \
    && rg -q "gitStatus:\s*true" "$dir/src/main.jsx"; then
    record_result "$backend" "git_status_visible_updates" "PASS" "canonical git status normalization + feature wiring present"
  else
    record_result "$backend" "git_status_visible_updates" "FAIL" "git status normalization/feature wiring incomplete"
  fi

  if rg -F -q "invalidateQueries({ queryKey: queryKeys.files.all })" "$dir/src/agent/tools/factory.js" \
    && rg -F -q "invalidateQueries({ queryKey: queryKeys.git.all })" "$dir/src/agent/tools/factory.js" \
    && rg -q "setPiAgentConfig\(" "$dir/src/main.jsx"; then
    record_result "$backend" "agent_mutation_reflected_ui" "PASS" "tool invalidation + PI tool wiring present"
  else
    record_result "$backend" "agent_mutation_reflected_ui" "FAIL" "tool invalidation/wiring missing"
  fi
}

run_smoke() {
  local backend="smoke"
  record_result "$backend" "harness_plumbing" "PASS" "dry-run placeholder validated logging + summary plumbing"
}

run_backend() {
  local backend="$1"
  case "$backend" in
    smoke) run_smoke ;;
    http) run_http ;;
    poc1) run_poc1 ;;
    poc2) run_poc2 ;;
    *)
      echo "Unsupported backend dispatcher target: $backend" >&2
      return 2
      ;;
  esac
}

if [[ "$BACKEND" == "all" ]]; then
  for backend in http poc1 poc2; do
    capture_backend "$backend"
  done
else
  capture_backend "$BACKEND"
fi

{
  echo "BACKEND|SCENARIO|STATUS|DETAIL"
  for row in "${RESULT_ROWS[@]}"; do
    echo "$row"
  done
} | tee "$MATRIX_TSV"

{
  echo "# E2E Pluggable DataProvider Matrix"
  echo
  echo "- timestamp: ${TS}"
  echo "- mode: ${MODE}"
  echo "- backend: ${BACKEND}"
  echo "- logs: ${LOG_DIR}"
  echo
  echo "## Schema"
  echo
  echo '`BACKEND|SCENARIO|STATUS|DETAIL`'
  echo
  echo "## Results"
  echo
  echo '| Backend | Scenario | Status | Detail |'
  echo '| --- | --- | --- | --- |'
  for row in "${RESULT_ROWS[@]}"; do
    IFS='|' read -r b s st d <<< "$row"
    echo "| ${b} | ${s} | ${st} | ${d} |"
  done
  echo
  echo "## Backend Summary"
  echo
  echo '| Backend | Passed | Failed | Total |'
  echo '| --- | ---: | ---: | ---: |'
  for backend in smoke http poc1 poc2; do
    if [[ -z "${BACKEND_TOTAL[$backend]:-}" ]]; then
      continue
    fi
    total=${BACKEND_TOTAL[$backend]:-0}
    failed=${BACKEND_FAIL[$backend]:-0}
    passed=$((total - failed))
    echo "| ${backend} | ${passed} | ${failed} | ${total} |"
  done
} > "$MATRIX_MD"

echo ""
echo "matrix_summary=${MATRIX_MD}"
echo "matrix_tsv=${MATRIX_TSV}"
echo "logs_dir=${LOG_DIR}"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "result=FAIL failures=${FAILURES}" >&2
  exit 1
fi

echo "result=PASS failures=0"
