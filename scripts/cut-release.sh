#!/usr/bin/env bash
# Cut a release: bump all publishable package versions, commit, push, wait for
# exact-SHA release gates, and create a GitHub release. Use --resume after a
# post-push gate failure to reuse the existing untagged bump commit.
#
# Usage:
#   ./scripts/cut-release.sh                # patch bump (default)
#   ./scripts/cut-release.sh minor
#   ./scripts/cut-release.sh major
#   ./scripts/cut-release.sh --resume

set -euo pipefail

cd "$(dirname "$0")/.."

resume=false
bump="${1:-patch}"
case "$bump" in
  patch|minor|major)
    if [ "$#" -ne 0 ] && [ "$#" -ne 1 ]; then
      echo "Usage: $0 [patch|minor|major|--resume]" >&2
      exit 2
    fi
    ;;
  --resume)
    if [ "$#" -ne 1 ]; then
      echo "Usage: $0 [patch|minor|major|--resume]" >&2
      exit 2
    fi
    resume=true
    ;;
  *)
    echo "Usage: $0 [patch|minor|major|--resume]" >&2
    exit 2
    ;;
esac

# Refuse any dirty or untracked state. A release commit and a resumed release
# must both be fully reproducible from synchronized main.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

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
  plugins/data-explorer/package.json
  plugins/data-catalog/package.json
  plugins/generated-pane/package.json
  plugins/data-bridge/package.json
  plugins/bi-dashboard/package.json
)
if [ -f pnpm-lock.yaml ]; then
  release_files+=(pnpm-lock.yaml)
fi

read_remote_tag_sha() {
  local tag_name=$1
  local output status peeled
  set +e
  output=$(git ls-remote --exit-code --tags origin \
    "refs/tags/$tag_name" "refs/tags/$tag_name^{}" 2>/dev/null)
  status=$?
  set -e
  if [ "$status" -eq 2 ]; then
    echo ""
    return
  fi
  if [ "$status" -ne 0 ]; then
    echo "Could not read release tag $tag_name from origin." >&2
    exit 1
  fi
  peeled=$(awk '$2 ~ /\^\{\}$/ { print $1; exit }' <<< "$output")
  if [ -n "$peeled" ]; then
    echo "$peeled"
  else
    awk 'NR == 1 { print $1 }' <<< "$output"
  fi
}

github_release_exists() {
  local tag_name=$1
  local output status
  set +e
  output=$(gh api --silent "repos/$repository/releases/tags/$tag_name" 2>&1)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "true"
  elif [[ "$output" == *"(HTTP 404)"* ]]; then
    echo "false"
  else
    echo "Could not verify GitHub release state for $tag_name: $output" >&2
    exit 1
  fi
}

if [ "$resume" = true ]; then
  after=$(node -p "require('./package.json').version")
  before=$(git show HEAD^:package.json | node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => console.log(JSON.parse(s).version))")
  node scripts/version.mjs --check
  node scripts/validate-release-resume.mjs "${release_files[@]}"
  release_sha=$(git rev-parse HEAD)
  tag="v$after"
else
  before=$(node -p "require('./package.json').version")
  node scripts/version.mjs "$bump"
  after=$(node -p "require('./package.json').version")
  node scripts/version.mjs --check
  pnpm golden-path:timing
  pnpm check:golden-path
  pnpm audit:publish-manifests

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
  git push origin main
  release_sha=$(git rev-parse HEAD)
  tag="v$after"
fi

repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
local_tag_sha=""
if git show-ref --verify --quiet "refs/tags/$tag"; then
  local_tag_sha=$(git rev-parse "refs/tags/$tag^{}")
fi
remote_tag_sha=$(read_remote_tag_sha "$tag")
release_exists=$(github_release_exists "$tag")
tag_state=$(node scripts/validate-release-resume.mjs --tag-state \
  "$release_sha" "${local_tag_sha:--}" "${remote_tag_sha:--}" "$release_exists")
if [ "$resume" = true ]; then
  echo "Resuming release $tag from existing bump commit $release_sha ($tag_state tag state)."
elif [ "$tag_state" != "untagged" ]; then
  echo "New release unexpectedly found an existing tag state for $tag." >&2
  exit 1
fi

if ! GH_REPOSITORY="$repository" node scripts/require-release-candidate-check.mjs \
  "$release_sha" \
  "Release Candidate Built-Dist" \
  "Main Green Summary"; then
  echo "Required release gates did not pass for pushed release commit $release_sha." >&2
  echo "No GitHub release or tag was created. After the checks are fixed/green, run:" >&2
  echo "  ./scripts/cut-release.sh --resume" >&2
  exit 1
fi

# Revalidate after the potentially long polling window, then close the remaining
# race by atomically asserting main's exact SHA while pushing the annotated tag.
git fetch origin main
if [ "$(git rev-parse HEAD)" != "$release_sha" ] || [ "$(git rev-parse origin/main)" != "$release_sha" ]; then
  echo "origin/main moved while release gates were running; refusing to release $release_sha." >&2
  exit 1
fi
if [ "$tag_state" = "untagged" ]; then
  if ! node scripts/atomic-release-tag.mjs "$release_sha" "$tag"; then
    echo "No GitHub release was created. Resolve main/tag state, then run:" >&2
    echo "  ./scripts/cut-release.sh --resume" >&2
    exit 1
  fi
else
  echo "Verified annotated tag $tag was already pushed; skipping tag creation."
fi

# Whether this is the first attempt or a post-tag resume, require both tag refs
# to resolve to the release commit and require that no GitHub release exists.
local_tag_sha=$(git rev-parse "refs/tags/$tag^{}")
remote_tag_sha=$(read_remote_tag_sha "$tag")
release_exists=$(github_release_exists "$tag")
node scripts/validate-release-resume.mjs --tag-state \
  "$release_sha" "$local_tag_sha" "$remote_tag_sha" "$release_exists" >/dev/null

echo "Creating GitHub release $tag from pre-existing verified tag…"
gh release create "$tag" \
  --verify-tag \
  --title "$tag" \
  --generate-notes

echo
echo "✓ Released $tag (from $before)."
echo "  Workflow will publish to npm: https://github.com/hachej/boring-ui/actions/workflows/release.yml"
echo "  When the workflow finishes, roll the hub with: ./scripts/upgrade-boring-ui.sh $after"
