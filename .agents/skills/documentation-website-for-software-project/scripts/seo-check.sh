#!/usr/bin/env bash
# seo-check.sh — quick SEO + metadata sanity-check for a built Nextra site.
#
# Usage:
#   seo-check.sh <base-url>
# Example:
#   seo-check.sh https://mydocs.com
#
# Verifies: sitemap reachable, robots.txt present, OG image resolves,
# a sample page has title/description/og tags, canonical URL present.

set -euo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi

pass=0
fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    printf '✓ %s\n' "$name"
    pass=$((pass+1))
  else
    printf '✗ %s\n' "$name"
    fail=$((fail+1))
  fi
}

echo "=== SEO check for $BASE ==="

check "homepage returns 200" \
  bash -c "curl -fsS -o /dev/null '$BASE/'"

check "sitemap.xml present" \
  bash -c "curl -fsS -o /dev/null '$BASE/sitemap.xml'"

check "robots.txt present" \
  bash -c "curl -fsS -o /dev/null '$BASE/robots.txt'"

check "robots.txt references sitemap" \
  bash -c "curl -fsS '$BASE/robots.txt' | grep -qi 'sitemap'"

# Grab home HTML once for metadata checks
HOME_HTML=$(curl -fsS "$BASE/" || echo "")

check "home has <title>" \
  bash -c "echo '$HOME_HTML' | grep -q '<title>'"

check "home has meta description" \
  bash -c "echo '$HOME_HTML' | grep -q 'name=\"description\"'"

check "home has og:title" \
  bash -c "echo '$HOME_HTML' | grep -q 'og:title'"

check "home has og:image" \
  bash -c "echo '$HOME_HTML' | grep -qE 'og:image'"

check "home has canonical" \
  bash -c "echo '$HOME_HTML' | grep -q 'rel=\"canonical\"'"

# If an og image URL is found, verify it resolves
og_url=$(echo "$HOME_HTML" | grep -oE 'property="og:image" content="[^"]+' | head -1 | sed 's/.*content="//') || true
if [[ -n "$og_url" ]]; then
  # Handle relative URLs
  if [[ "$og_url" != http* ]]; then
    og_url="$BASE$og_url"
  fi
  check "og:image resolves and is non-empty" \
    bash -c "size=\$(curl -fsS -o /dev/null -w '%{size_download}' '$og_url'); [[ \$size -gt 100 ]]"
else
  echo "⚠ no og:image found; skipping size check"
fi

# llms.txt is optional but recommended
if curl -fsS -o /dev/null "$BASE/llms.txt"; then
  echo "✓ llms.txt present (optional)"
  pass=$((pass+1))
else
  echo "ℹ llms.txt not present (optional; consider adding for LLM crawlers)"
fi

echo
echo "=== summary: $pass pass / $fail fail ==="
exit $fail
