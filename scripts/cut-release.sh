#!/usr/bin/env bash
# Cut a release: bump all publishable package versions, commit, push, and
# create a GitHub release. The Release workflow auto-fires on the
# `release: published` event and publishes to npm.
#
# Usage:
#   ./scripts/cut-release.sh                # patch bump (default, direct main flow)
#   ./scripts/cut-release.sh minor
#   ./scripts/cut-release.sh major
#   ./scripts/cut-release.sh --pr patch     # prepare and push a release PR branch

set -euo pipefail

cd "$(dirname "$0")/.."

mode=direct
bump=patch
for arg in "$@"; do
  case "$arg" in
    --pr) mode=pr ;;
    patch|minor|major) bump="$arg" ;;
    *)
      echo "Usage: $0 [--pr] [patch|minor|major]" >&2
      exit 2
      ;;
  esac
done

# Refuse to bump from a dirty tree — the release commit must contain only
# version markers and required generated release evidence.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

# Direct releases must run from the exact remote main commit. PR releases run
# from an up-to-date release/* branch and defer the GitHub release until merge.
branch=$(git branch --show-current)
git fetch origin main
if [ "$mode" = direct ]; then
  if [ "$branch" != "main" ]; then
    echo "Direct release must run on main; got '$branch'." >&2
    exit 1
  fi
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "Local main does not match origin/main. Pull/rebase first." >&2
    exit 1
  fi
else
  case "$branch" in release/*) ;;
    *)
      echo "PR release must run on a release/* branch; got '$branch'." >&2
      exit 1
      ;;
  esac
  if ! git merge-base --is-ancestor origin/main HEAD; then
    echo "Release branch is not based on current origin/main. Rebase first." >&2
    exit 1
  fi
fi

before=$(node -p "require('./package.json').version")
node scripts/version.mjs "$bump"
after=$(node -p "require('./package.json').version")
node scripts/version.mjs --check
pnpm golden-path:timing
pnpm check:golden-path
pnpm audit:publish-manifests

release_files=(
  package.json
  docs/issues/391/runtime-refactor/golden-path.json
  packages/core/package.json
  packages/plugin-cli/package.json
  packages/workspace/package.json
  packages/agent/package.json
  packages/ui/package.json
  packages/cli/package.json
  packages/boring-sandbox/package.json
  plugins/boring-mcp/package.json
  packages/boring-bash/package.json
  plugins/boring-governance/package.json
  plugins/deck/package.json
  plugins/ask-user/package.json
  plugins/diagram/package.json
  plugins/tasks/package.json
  plugins/boring-automation/package.json
  plugins/live-transcription/package.json
  plugins/data-explorer/package.json
  plugins/data-catalog/package.json
  plugins/generated-pane/package.json
  plugins/data-bridge/package.json
  plugins/bi-dashboard/package.json
)
if [ -f pnpm-lock.yaml ]; then
  release_files+=(pnpm-lock.yaml)
fi

git add "${release_files[@]}"
node scripts/check-release-staging.mjs

status=$(git status --short)
if [ -z "$status" ]; then
  echo "No release changes staged." >&2
  exit 1
fi
while IFS= read -r line; do
  [ -z "$line" ] && continue
  path=${line:3}
  allowed=false
  for release_file in "${release_files[@]}"; do
    if [ "$path" = "$release_file" ]; then
      allowed=true
      break
    fi
  done
  if [ "$allowed" != true ]; then
    echo "Unexpected release tree change: $line" >&2
    echo "$status" >&2
    exit 1
  fi
done <<< "$status"

git commit -m "chore(release): bump packages to $after"

if [ "$mode" = pr ]; then
  git push --set-upstream origin "$branch"
  echo
  echo "✓ Prepared $after (from $before) on $branch."
  echo "  Merge the release PR, then create GitHub release v$after from the merge commit."
  exit 0
fi

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
