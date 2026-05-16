#!/usr/bin/env bash
# check-skills.sh — detect which referenced skills are installed, and whether
# jsm (jeffreys-skills.md CLI) is available + authenticated.
#
# Writes `<workspace>/phase0_skill_inventory.json` and prints a human-readable
# table to stdout.
#
# Usage:
#   check-skills.sh <workspace-dir>
#
# Exits 0 even when skills/jsm are missing — it's a status check, not a gate.

set -euo pipefail

WORKSPACE="${1:-.docs_workspace}"
mkdir -p "$WORKSPACE"
OUT="$WORKSPACE/phase0_skill_inventory.json"

# Skills referenced by this documentation pipeline.
REFERENCED_SKILLS=(
  codebase-archaeology
  codebase-report
  operationalizing-expertise
  ui-polish
  ux-audit
  ubs
  github
  vercel
  idea-wizard
  e2e-testing-for-webapps
  og-share-images
  de-slopify
  ru-multi-repo-workflow
  multi-pass-bug-hunting
  gh-actions
  agent-mail
  beads-workflow
  br
  bv
  ntm
  cass
  readme-writing
  interactive-visualization-creator
  planning-workflow
  cc-hooks
)

# Search paths for installed skills (in order of precedence)
SKILL_SEARCH_PATHS=(
  "${CLAUDE_SKILLS_PATH:-}"
  "$HOME/.claude/skills"
  ".claude/skills"
)

# Detect jsm
if command -v jsm >/dev/null 2>&1; then
  JSM_AVAILABLE=true
  JSM_VERSION="$(jsm --version 2>&1 | head -1 || echo 'unknown')"
else
  JSM_AVAILABLE=false
  JSM_VERSION=""
fi

# Detect authentication
JSM_AUTHED=false
SUBSCRIPTION_TIER="unknown"
if [[ "$JSM_AVAILABLE" == "true" ]]; then
  if jsm_whoami=$(jsm whoami 2>&1) && ! echo "$jsm_whoami" | grep -qi 'not logged in'; then
    JSM_AUTHED=true
    # Best-effort extract tier from whoami --json if available
    if tier=$(jsm whoami --json 2>/dev/null | grep -oE '"status"[^,}]*' | head -1 | sed 's/.*"\([^"]*\)".*/\1/'); then
      [[ -n "$tier" ]] && SUBSCRIPTION_TIER="$tier"
    fi
  fi
fi

# Check each skill
find_skill() {
  local name="$1"
  for base in "${SKILL_SEARCH_PATHS[@]}"; do
    [[ -z "$base" ]] && continue
    if [[ -f "$base/$name/SKILL.md" ]]; then
      echo "$base/$name"
      return 0
    fi
  done
  return 1
}

# Build the JSON body
{
  printf '{\n'
  printf '  "checked_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "jsm_available": %s,\n' "$JSM_AVAILABLE"
  printf '  "jsm_version": "%s",\n' "$JSM_VERSION"
  printf '  "jsm_authenticated": %s,\n' "$JSM_AUTHED"
  printf '  "subscription_tier": "%s",\n' "$SUBSCRIPTION_TIER"
  printf '  "skills": [\n'

  total="${#REFERENCED_SKILLS[@]}"
  for idx in "${!REFERENCED_SKILLS[@]}"; do
    name="${REFERENCED_SKILLS[$idx]}"
    if path=$(find_skill "$name"); then
      status="present"
    else
      status="missing"
      path=""
    fi
    printf '    {"name": "%s", "status": "%s", "path": "%s"}' "$name" "$status" "$path"
    if (( idx < total - 1 )); then
      printf ','
    fi
    printf '\n'
  done

  printf '  ]\n}\n'
} > "$OUT"

# Human-readable summary
printf '\n=== Skill inventory ===\n'
printf '%-40s  %-10s  %s\n' 'skill' 'status' 'location'
printf '%-40s  %-10s  %s\n' '----------------------------------------' '----------' '-------------------------------------------'
for name in "${REFERENCED_SKILLS[@]}"; do
  if path=$(find_skill "$name"); then
    printf '%-40s  \033[32m%-10s\033[0m  %s\n' "$name" 'present' "$path"
  else
    printf '%-40s  \033[33m%-10s\033[0m  %s\n' "$name" 'missing' '(use jsm install or inline fallback)'
  fi
done

printf '\n'
if [[ "$JSM_AVAILABLE" == "true" ]]; then
  printf 'jsm: installed (%s); authenticated=%s; subscription=%s\n' \
    "$JSM_VERSION" "$JSM_AUTHED" "$SUBSCRIPTION_TIER"
else
  printf 'jsm: not installed. See references/SKILL-INSTALLATION.md to install.\n'
fi

printf '\nwrote %s\n' "$OUT"
