---
name: devops-cut-boring-ui-release
description: Cut a boring-ui-v2 npm release from main and update the local/global boring-ui CLI install. Use when Julien says cut a release, new release, publish boring-ui, update global boring-ui CLI, or install latest boring-ui CLI.
space: ops
context: any
output_format: terminal
---

# Cut boring-ui-v2 Release + Update Global CLI

Use this skill for one job: release the current `main` of `boring-ui-v2` to npm via GitHub Releases, then install that exact CLI version globally on this machine.

## Non-negotiables

- Work from `main` only.
- Do not overwrite or stash user/agent dirty work. If the current worktree is dirty or not on `main`, create a clean temporary worktree.
- Do not use destructive commands (`git reset --hard`, `git clean -fd`, force push).
- Do not run `boring-ui --version` as a version check: this CLI may start a server. Use package-manager metadata instead.
- Do not install `@latest` until npm confirms the new version is visible.
- If any release workflow fails, stop and report the failed run URL.

## 1. Prepare a clean main worktree

From anywhere inside the repo:

```bash
git fetch origin main --tags
```

If the active worktree is clean and already on `main`:

```bash
git switch main
git merge --ff-only origin/main
```

If the active worktree is dirty or on another branch, use a temporary worktree instead:

```bash
release_dir=$(mktemp -d /tmp/boring-ui-v2-release.XXXXXX)
rmdir "$release_dir"
git update-ref refs/heads/main origin/main
git worktree add "$release_dir" main
cd "$release_dir"
```

Confirm release preconditions:

```bash
git status --short --branch
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

## 2. Check the current and next package versions

```bash
before=$(node -p "require('./packages/cli/package.json').version")
echo "current CLI package version: $before"
```

Use `patch` unless Julien explicitly asks for `minor` or `major`.

## 3. Run release gates

For normal releases, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If this is an urgent hotfix and Julien accepts a narrower gate, run at minimum:

```bash
pnpm --filter @hachej/boring-workspace run typecheck
pnpm audit:publish-manifests
```

Record exactly which gates ran.

## 4. Cut the release

```bash
./scripts/cut-release.sh patch
```

For non-patch releases:

```bash
./scripts/cut-release.sh minor
./scripts/cut-release.sh major
```

The script bumps all publishable package versions, commits `chore(release): bump packages to <version>`, pushes `main`, and creates a GitHub Release. The GitHub release triggers `.github/workflows/release.yml`, which publishes to npm.

Capture the new version:

```bash
after=$(node -p "require('./packages/cli/package.json').version")
echo "released CLI package version: $after"
```

## 5. Wait for npm publish workflow

Find the run triggered by the release tag and wait for it:

```bash
tag="v$after"
gh run list --workflow release.yml --branch main --limit 5
run_id=$(gh run list --workflow release.yml --json databaseId,headBranch,displayTitle,createdAt --jq '.[] | select(.displayTitle | contains("'"$tag"'")) | .databaseId' | head -1)
test -n "$run_id"
gh run watch "$run_id" --exit-status
```

If the run is not found by title, open the Actions page and identify the newest release workflow:

```bash
gh run list --workflow release.yml --limit 10
```

Stop if the workflow fails.

## 6. Wait until npm sees the exact CLI version

```bash
for i in $(seq 1 30); do
  npm_version=$(npm view @hachej/boring-ui-cli version 2>/dev/null || true)
  if [ "$npm_version" = "$after" ]; then
    echo "npm has @hachej/boring-ui-cli@$after"
    break
  fi
  echo "waiting for npm: saw '$npm_version', want '$after'"
  sleep 10
done
test "$(npm view @hachej/boring-ui-cli version)" = "$after"
```

## 7. Update the global boring-ui CLI install

This machine currently uses npm global installs for `boring-ui`. Prefer npm unless inspection shows pnpm owns the global package.

Check current install:

```bash
command -v boring-ui || true
npm list -g --depth=0 @hachej/boring-ui-cli || true
pnpm list -g --depth=0 2>/dev/null | grep '@hachej/boring-ui-cli' || true
```

Install the exact released version:

```bash
npm install -g @hachej/boring-ui-cli@"$after"
```

Verify with package metadata, not by starting the CLI:

```bash
npm list -g --depth=0 @hachej/boring-ui-cli
node -p "require(require('child_process').execSync('npm root -g').toString().trim() + '/@hachej/boring-ui-cli/package.json').version"
command -v boring-ui
```

## 8. Final response checklist

Report:

- release version and tag
- release commit SHA
- GitHub Release URL
- release workflow status/run URL
- npm version observed
- global CLI package version installed
- gates run
