#!/usr/bin/env bash
# Strategy-doc drift lint (owner ruling 2026-08-27, second grill).
# Fails CI when the strategy docs re-acquire known drift markers:
# merged PRs described as pending, removed gates re-stated as live,
# demoted candidate plans missing their banner, or links to moved plans.
set -euo pipefail

PREFIX="[strategy-docs]"
DIRS=(docs/direction docs/plans/multiagent-shell docs/vision docs/roadmap)
failures=0

fail() { echo "$PREFIX FAIL: $1"; failures=$((failures + 1)); }

forbid() {
  local pattern="$1" why="$2"
  local hits
  hits=$(grep -rni --include='*.md' -F "$pattern" "${DIRS[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "$why"
    echo "$hits" | sed "s/^/$PREFIX   /"
  fi
}

# 1. #1409 merged 2026-08-27 — must never be described as pending again.
forbid "still pending merge" "a merged PR is described as pending"

# 2. The pi wait gate was removed (RECONCILIATION §9c) — its live-gate
#    formulations must not reappear.
forbid "Waiting for qualifying pi release" "removed pi wait gate stated as live"
forbid "waits for a qualifying pi release" "removed pi wait gate stated as live"
forbid "2026-09-10 is an owner check-in" "removed pi check-in stated as live"
forbid "2026-09-10 is a check-in" "removed pi check-in stated as live"
forbid "2026-09-10 decision rule" "removed pi decision rule stated as live"

# 3. The old flat estimate for durable-streams was withdrawn.
forbid "P1 is scoped into two one-session children" "withdrawn P1 estimate restated"

# 4. Bead references must exist — this one never did.
forbid "wt-391-forward-hotp" "reference to a nonexistent bead"

# 5. The relay engine plan moved to research/candidates/ 2026-08-27.
forbid "multiagent-shell/job-thread-plan.md" "link to the pre-demotion plan path"
if [[ -f docs/plans/multiagent-shell/job-thread-plan.md ]]; then
  fail "demoted relay plan re-appeared at its old dispatchable path"
fi

# 6. Every candidate doc must carry the non-dispatchable banner.
for f in docs/plans/multiagent-shell/research/candidates/*.md; do
  [[ -e "$f" ]] || continue
  if ! grep -q "HISTORICAL CANDIDATE — NON-DISPATCHABLE" "$f"; then
    fail "candidate doc missing non-dispatchable banner: $f"
  fi
done

if [[ $failures -gt 0 ]]; then
  echo "$PREFIX $failures failure(s)"
  exit 1
fi
echo "$PREFIX OK"
