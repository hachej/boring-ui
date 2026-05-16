#!/usr/bin/env bash
# a11y-check.sh — run axe-core accessibility checks against a live docs site.
#
# Usage:
#   a11y-check.sh <base-url> [page-paths...]
# Example:
#   a11y-check.sh http://localhost:3000 / /overview/architecture /reference/api
#
# Requires: npm / bun / pnpm. Installs @axe-core/cli on the fly if not present.
# Exits 0 if zero "critical" or "serious" violations.

set -euo pipefail

BASE="${1:-}"
shift || true
PAGES=("$@")
[[ ${#PAGES[@]} -eq 0 ]] && PAGES=("/" "/overview/what-is-this" "/overview/architecture")

if [[ -z "$BASE" ]]; then
  echo "usage: $0 <base-url> [page-paths...]" >&2
  exit 2
fi

# Use @axe-core/cli via bunx / npx — installs on demand
AXE="bunx"
command -v bunx >/dev/null 2>&1 || AXE="npx"

total_critical=0
total_serious=0

for p in "${PAGES[@]}"; do
  url="$BASE$p"
  echo "=== $url ==="
  # --exit 1 if any violations — we want to report all, so don't use that flag;
  # we'll parse output and make our own decision.
  if out=$($AXE -y @axe-core/cli "$url" --tags wcag2a,wcag2aa,wcag21a,wcag21aa 2>&1); then
    echo "$out"
  else
    echo "$out"
  fi
  c=$(echo "$out" | grep -oE '([0-9]+) critical' | head -1 | awk '{print $1}' || echo 0)
  s=$(echo "$out" | grep -oE '([0-9]+) serious' | head -1 | awk '{print $1}' || echo 0)
  total_critical=$((total_critical + ${c:-0}))
  total_serious=$((total_serious + ${s:-0}))
done

echo
echo "=== summary ==="
echo "critical: $total_critical (target 0)"
echo "serious:  $total_serious (target 0)"

if [[ $total_critical -gt 0 || $total_serious -gt 0 ]]; then
  exit 1
fi
