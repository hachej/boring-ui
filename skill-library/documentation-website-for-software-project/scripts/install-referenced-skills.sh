#!/usr/bin/env bash
# install-referenced-skills.sh — install every missing skill via jsm.
#
# Reads phase0_skill_inventory.json (from check-skills.sh) and runs
# `jsm install <name>` for each entry whose status is "missing".
#
# Does NOT block the run on failures — logs to phase0_missing_skills.md.
#
# Usage:
#   install-referenced-skills.sh <workspace-dir>

set -euo pipefail

WORKSPACE="${1:-.docs_workspace}"
INV="$WORKSPACE/phase0_skill_inventory.json"
LOG="$WORKSPACE/phase0_missing_skills.md"

if [[ ! -f "$INV" ]]; then
  echo "error: $INV not found — run check-skills.sh first" >&2
  exit 2
fi

if ! command -v jsm >/dev/null 2>&1; then
  echo "jsm not installed; cannot auto-install skills."
  echo "See references/SKILL-INSTALLATION.md. All phases will use inline fallbacks."
  exit 0
fi

# Require login (reading whoami output; "Not logged in" signals unauthenticated)
if ! jsm_whoami=$(jsm whoami 2>&1) || echo "$jsm_whoami" | grep -qi 'not logged in'; then
  cat <<EOF
jsm is installed but not authenticated. Run:

  jsm login

(Or for headless environments, see references/SKILL-INSTALLATION.md § Authenticate.)

Continuing with inline fallbacks for all skills.
EOF
  exit 0
fi

# Extract missing skill names via grep (avoiding jq dependency)
missing=$(grep -oE '"name": "[^"]+", "status": "missing"' "$INV" | sed -E 's/.*"name": "([^"]+)".*/\1/' || true)

if [[ -z "$missing" ]]; then
  echo "All referenced skills are already installed. Nothing to do."
  exit 0
fi

: > "$LOG"
{
  echo "# Missing helper skills (logged at $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  echo
  echo "Attempting \`jsm install\` for each:"
  echo
} >> "$LOG"

installed=0
failed=0
for skill in $missing; do
  echo -n "installing $skill ... "
  if out=$(jsm install "$skill" 2>&1); then
    echo "ok"
    installed=$((installed+1))
    echo "- \`$skill\` — **installed via jsm**" >> "$LOG"
  else
    # Common cases: subscription required, network error, skill not found
    if echo "$out" | grep -qi 'subscription'; then
      reason='subscription required (user needs paid jeffreys-skills.md account)'
    elif echo "$out" | grep -qi 'not found'; then
      reason='skill not available in jsm catalog'
    else
      reason="$(echo "$out" | head -2 | tr '\n' ' ')"
    fi
    echo "skip ($reason)"
    failed=$((failed+1))
    cat >> "$LOG" <<EOF
- \`$skill\` — **not installed**: $reason
  - fallback: use inline prompts from references/
EOF
  fi
done

{
  echo
  echo "## Summary"
  echo
  echo "- installed: $installed"
  echo "- skipped:   $failed"
  echo
  if (( failed > 0 )); then
    echo "For skipped skills, the pipeline will use inline fallbacks. Every referenced"
    echo "skill has an inline fallback in this repo; the run will proceed normally."
    echo
    echo "To unlock premium skills, subscribe at https://jeffreys-skills.md (\$20/mo),"
    echo "then re-run this script."
  fi
} >> "$LOG"

echo
echo "logged to $LOG"
echo "installed=$installed  skipped=$failed"
