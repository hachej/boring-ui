#!/usr/bin/env bash
set -euo pipefail

PREFIX="[invariants]"
ROOT_INPUT="${1:-packages/agent}"
ROOT_DIR="$(cd "$ROOT_INPUT" 2>/dev/null && pwd || true)"

if [[ -z "$ROOT_DIR" || ! -d "$ROOT_DIR" ]]; then
  echo "$PREFIX ERR invalid target root: $ROOT_INPUT"
  exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "$PREFIX ERR ripgrep (rg) is required"
  exit 2
fi

failures=0

print_matches() {
  local invariant_name="$1"
  local fix_hint="$2"
  local output="$3"

  [[ -z "$output" ]] && return 0

  failures=1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local short="${line#$ROOT_DIR/}"
    echo "$PREFIX ERR $short"
  done <<< "$output"
  echo "  Invariant: $invariant_name"
  echo "  Fix: $fix_hint"
}

run_check() {
  local invariant_name="$1"
  local pattern="$2"
  local fix_hint="$3"
  shift 3

  local paths=()
  local rel
  for rel in "$@"; do
    if [[ -e "$ROOT_DIR/$rel" ]]; then
      paths+=("$ROOT_DIR/$rel")
    fi
  done

  [[ "${#paths[@]}" -eq 0 ]] && return 0

  local output
  output="$(rg -n --no-heading --color never -e "$pattern" "${paths[@]}" || true)"
  print_matches "$invariant_name" "$fix_hint" "$output"
}

run_check_with_glob() {
  local invariant_name="$1"
  local pattern="$2"
  local fix_hint="$3"
  local glob="$4"
  shift 4

  local paths=()
  local rel
  for rel in "$@"; do
    if [[ -e "$ROOT_DIR/$rel" ]]; then
      paths+=("$ROOT_DIR/$rel")
    fi
  done

  [[ "${#paths[@]}" -eq 0 ]] && return 0

  local output
  output="$(rg -n --no-heading --color never -e "$pattern" "${paths[@]}" -g "$glob" || true)"
  print_matches "$invariant_name" "$fix_hint" "$output"
}

run_check_with_glob \
  "No node:* imports in src/shared/**" \
  "from\\s+['\"]node:" \
  "Keep Node imports in src/server/** adapters only." \
  "!**/__tests__/**" \
  "src/shared"

run_check_with_glob \
  "No Buffer references in src/shared/**" \
  "\\bBuffer\\b" \
  "Use Uint8Array in shared contracts." \
  "!**/__tests__/**" \
  "src/shared"

run_check \
  "No node:fs/node:child_process imports in routes/catalog" \
  "from\\s+['\"]node:(fs|child_process)" \
  "Move Node API usage into adapter implementations." \
  "src/server/http/routes" \
  "src/server/catalog"

run_check \
  "No frontend/server bleed from @boring/agent/server into src/front/**" \
  "from\\s+['\"]@boring/agent/server['\"]" \
  "Frontend must stay platform-agnostic." \
  "src/front"

run_check \
  "No console.* calls in src/server/**" \
  "console\\.(log|debug|info|warn|error)\\(" \
  "Use the standard logger abstraction." \
  "src/server"

if [[ -d "$ROOT_DIR/src/server" ]]; then
  process_env_output="$(rg -n --no-heading --color never -e "process\\.env\\." "$ROOT_DIR/src/server" -g '!**/config/**' || true)"
  print_matches \
    "No process.env reads outside src/server/config/**" \
    "Centralize env reads in src/server/config/**." \
    "$process_env_output"
fi

if [[ -d "$ROOT_DIR/src/front/primitives" ]]; then
  hardcoded_colors_output="$(rg -n --no-heading --color never -e "\\b(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\\b" "$ROOT_DIR/src/front/primitives" || true)"
  print_matches \
    "No hard-coded Tailwind colors in src/front/primitives/**" \
    "Use CSS variable bridge classes, e.g. bg-[var(--boring-chat-bg)]." \
    "$hardcoded_colors_output"
fi

if [[ -d "$ROOT_DIR/src" ]]; then
  stable_error_codes_output="$(rg -n --no-heading --color never -e "code\\s*:\\s*['\"][A-Za-z0-9_-]+['\"]" "$ROOT_DIR/src" -g '!**/error-codes.ts' || true)"
  print_matches \
    "Use stable error-code enum imports (no raw string codes)" \
    "Import canonical constants from shared error-codes." \
    "$stable_error_codes_output"
fi

if [[ "$failures" -ne 0 ]]; then
  echo "$PREFIX FAIL one or more invariants were violated"
  exit 1
fi

echo "$PREFIX OK all invariants passed for ${ROOT_DIR}"
