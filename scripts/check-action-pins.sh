#!/usr/bin/env bash
set -euo pipefail

# Invariant: every third-party GitHub Action referenced in a workflow must be
# pinned to a full 40-char commit SHA (not a moving tag like @v6 or @main).
# Rationale: a tag can be re-pointed at malicious code by a compromised
# maintainer, turning CI into a secret-exfiltration surface. A SHA cannot.
# See the supply-chain incident write-up that motivated this guard.

PREFIX="[action-pins]"
WORKFLOW_DIR="${1:-.github/workflows}"

if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "$PREFIX ERR workflow dir not found: $WORKFLOW_DIR"
  exit 2
fi

failures=0
sha_re='^[0-9a-f]{40}$'

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"
  rest="${line#*:}"
  lineno="${rest%%:*}"

  # Extract the `uses:` value: strip everything up to and including "uses:",
  # then drop any trailing inline comment and surrounding whitespace/quotes.
  ref_line="${rest#*uses:}"
  ref_line="${ref_line%%#*}"
  ref_line="$(printf '%s' "$ref_line" | tr -d '[:space:]' | tr -d '"'\''')"

  # Local (./...) and Docker (docker://...) actions are not tag-pinnable; skip.
  [[ "$ref_line" == ./* || "$ref_line" == docker://* ]] && continue
  # No version ref at all (bare local path) — skip.
  [[ "$ref_line" != *@* ]] && continue

  pin="${ref_line##*@}"
  if [[ ! "$pin" =~ $sha_re ]]; then
    failures=1
    echo "$PREFIX ERR $file:$lineno uses unpinned ref '$ref_line'"
  fi
done < <(grep -rEn '^\s*-?\s*uses:' "$WORKFLOW_DIR")

if [[ "$failures" -ne 0 ]]; then
  echo "$PREFIX FAIL one or more actions are not pinned to a commit SHA"
  echo "  Fix: replace '@vX'/'@branch' with the full commit SHA, e.g."
  echo "       uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2"
  echo "  Resolve a tag's SHA with: gh api repos/<owner>/<repo>/commits/<tag> --jq .sha"
  exit 1
fi

echo "$PREFIX OK all workflow actions are pinned to commit SHAs"
