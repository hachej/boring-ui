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
- After installing the global CLI, restart already-running global `boring-ui` servers; long-lived Node processes keep the old package code in memory. If the server is a systemd user service (`boring-ui-workspaces.service`), restart it with `systemctl --user restart` — do not `kill`+`nohup` a systemd-managed process (it races the auto-restart). After restarting, wait until the workspace route serves HTTP 200 again before declaring the step done.
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

## 8. Restart running global boring-ui servers

A running `node /home/ubuntu/.npm-global/bin/boring-ui ...` process keeps the old CLI code in memory after `npm install -g`. Restart any global workspace servers that should pick up the new release.

**Restarting drops live workspace sessions for ~30s while the runtime re-provisions** — anyone on a `…/workspace/<id>` URL during that window sees "Workspace setup failed / NetworkError". That is expected and transient; this step is not done until the workspace route is serving again (see the readiness wait below). Restart at a quiet moment when you can.

### 8a. Prefer systemd if the hub is a managed service

The standard hub on port `5213` is usually the systemd **user** service `boring-ui-workspaces.service`. If it is, **restart through systemd** — never `kill` + `nohup` it by hand. systemd has `Restart=` on this unit, so a manual kill makes systemd respawn the old process while your `nohup` also spawns one, and the two race for the port (`EADDRINUSE`), leaving an orphan you don't control.

```bash
if systemctl --user list-units --type=service --all 2>/dev/null | grep -q 'boring-ui-workspaces.service'; then
  systemctl --user restart boring-ui-workspaces.service
  systemctl --user --no-pager -p ActiveState,SubState,MainPID,NRestarts show boring-ui-workspaces.service
  managed=systemd
fi
```

A high `NRestarts` (hundreds/thousands) or a previous `Result=oom-kill` / `status=9/KILL` in `journalctl --user -u boring-ui-workspaces.service` means the hub is in a chronic crash/OOM loop — flag it in your report; it is a pre-existing problem, not your release.

### 8b. Manual restart only if NOT systemd-managed

```bash
if [ "${managed:-}" != systemd ]; then
  pid=$(ss -ltnp 'sport = :5213' 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -1)
  if [ -n "$pid" ]; then
    ps -p "$pid" -o pid,lstart,cmd
    cwd=$(readlink "/proc/$pid/cwd")
    kill -TERM "$pid"
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
  else
    cwd=/home/ubuntu/projects/boring-ui-v2
  fi
  log=/tmp/boring-ui-global-5213.log
  cd "$cwd"
  nohup boring-ui workspaces --port 5213 --host 0.0.0.0 > "$log" 2>&1 &
  new_pid=$!
  for i in $(seq 1 40); do
    ss -ltnp 'sport = :5213' 2>/dev/null | grep -q "pid=$new_pid" && break
    kill -0 "$new_pid" 2>/dev/null || { tail -80 "$log"; exit 1; }
    sleep 0.5
  done
  ps -p "$new_pid" -o pid,lstart,cmd
fi
```

### 8c. Wait until the workspace route is actually ready

The port listening is not enough — the per-workspace runtime re-provisions on first access, and reporting success before that completes is what leaves users with "NetworkError". Wait for each configured workspace to serve, and confirm the hub logged it `ready`:

```bash
# Each workspace id from the hub config; adjust the grep if the path differs.
for slug in $(grep -oE 'workspace/[A-Za-z0-9_-]+' /home/ubuntu/.boring-ui/workspaces.yaml 2>/dev/null | sort -u); do
  url="http://localhost:5213/$slug"
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$url" 2>/dev/null || echo 000)
    [ "$code" = 200 ] && { echo "$slug ready (HTTP 200)"; break; }
    sleep 2
  done
done
journalctl --user -u boring-ui-workspaces.service --no-pager -n 15 | grep -iE 'ready|error|provision' || true
ss -ltnp 'sport = :5213'
```

If other global `boring-ui` processes are running, inspect and restart them intentionally rather than killing unrelated dev servers:

```bash
ps -eo pid,lstart,cmd | grep '/.npm-global/bin/boring-ui' | grep -v grep || true
```

## 9. Final response checklist

Report:

- release version and tag
- release commit SHA
- GitHub Release URL
- release workflow status/run URL
- npm version observed
- global CLI package version installed
- restarted global server PID(s), port(s), and log path(s); how it was restarted (systemd vs manual)
- confirmation each workspace route serves HTTP 200 after the restart
- any hub instability observed (high `NRestarts`, OOM kills) — flagged as pre-existing
- gates run
