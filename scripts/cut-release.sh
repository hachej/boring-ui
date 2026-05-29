#!/usr/bin/env bash
# Cut a release: bump all publishable package versions, commit, push, and
# create a GitHub release. The Release workflow auto-fires on the
# `release: published` event and publishes to npm.
#
# Usage:
#   ./scripts/cut-release.sh                # patch bump (default)
#   ./scripts/cut-release.sh minor
#   ./scripts/cut-release.sh major

set -euo pipefail

cd "$(dirname "$0")/.."

bump="${1:-patch}"
case "$bump" in patch|minor|major) ;; *)
  echo "Usage: $0 [patch|minor|major]" >&2
  exit 2
esac

# Refuse to bump from a dirty tree — the release commit must contain only
# the version bumps so the tag points at a known state.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

# Refuse to release from anything other than main, and make sure we're
# in sync with origin so the tag we cut points at the same SHA people see.
branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then
  echo "Release must run on main; got '$branch'." >&2
  exit 1
fi
git fetch origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Local main does not match origin/main. Pull/rebase first." >&2
  exit 1
fi

before=$(node -p "require('./packages/cli/package.json').version")
node scripts/version.mjs "$bump"
after=$(node -p "require('./packages/cli/package.json').version")
node scripts/version.mjs --check
pnpm audit:publish-manifests

git add \
  packages/core/package.json \
  packages/workspace/package.json \
  packages/agent/package.json \
  packages/ui/package.json \
  packages/cli/package.json \
  plugins/deck/package.json \
  plugins/ask-user/package.json \
  plugins/data-explorer/package.json \
  plugins/data-catalog/package.json
git commit -m "chore(release): bump packages to $after"
git push origin main

tag="v$after"
echo "Creating GitHub release $tag (this also creates the git tag)…"
gh release create "$tag" \
  --title "$tag" \
  --target "$(git rev-parse HEAD)" \
  --generate-notes

echo
echo "✓ Released $tag (from $before)."
echo "  Workflow will publish to npm: https://github.com/hachej/boring-ui/actions/workflows/release.yml"
echo "  When the workflow finishes, roll the hub with: ./scripts/upgrade-boring-ui.sh $after"
