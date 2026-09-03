# Native Boring Factory playground

A dedicated local dogfood app that composes the Factory directly from this checkout. It does **not** consume or vendor `@hachej/boring-factory` artifacts.

## Native composition

- `boring-orchestrator`: canonical `.agents/personas/orchestrator` profile plus canonical `plan`, `feedback`, `owner-gate`, `handoff`, and `show-me` skill sources; receives `factory-supervision`, `factory-demo`, `boring-automation`, and `factory-delegate`.
- `boring-worker`: canonical `.agents/personas/worker` profile plus canonical `exec`, `fresh-eyes`, and `handoff` skill sources (`owner-gate` is dropped: this seat never raises an owner gate — see `factory-precedence` below); receives the trusted `sandbox` plugin and `factory-delegate`.
- `boring-reviewer`: canonical `.agents/personas/reviewer` profile plus the canonical `fresh-eyes` skill source; a fresh-context adversarial reviewer of exactly one SHA, with no plugins of its own — it is only ever reached as a `fresh_review` delegation target, never addressed directly by a user.
- `factory-supervision` is a host-governed durable-nudge plugin, granted only to the Orchestrator. Its `supervise` tool (`op: 'start' | 'stop' | 'status'`) persists an entry (session id, interval, prompt) to `<state root>/supervision.json` and arms an interval timer; the host re-arms every persisted entry from disk on boot (`rearm()`, called from `app.ts` right after `createWorkspaceAgentServer` resolves), so a nudge survives a process restart — the old `pi-mono-loop` `/loop` command's in-memory-only timers did not. Each tick reads the Orchestrator's own session state first: if it isn't `idle` the tick is recorded as `skipped-busy` and nothing is queued; only an idle session gets prompted with `Supervision tick <n> (<ISO time>): <prompt>` (`requireIdle: true`). Default prompt: run `factory_status` and check durable end-state facts against the epic's acceptance criteria, then report facts only — never implement.
- `factory-delegate` is a host-governed in-process delegation tool, granted per seat from a static table: the Orchestrator's `dispatch_worker` starts a fresh Worker session, and the Worker's `fresh_review` starts a fresh Reviewer session; any other seat gets no delegation tool. Each call creates a brand-new child session (never resumes one), prompts it once, polls the host session-state API until it goes idle, and returns only the child's final assistant text plus `provenance: { sessionId, agentTypeId, model, briefDigest, startedAt, finishedAt }` — the child's tool calls and intermediate messages are never exposed to the caller. The child session's title records the parent session id for traceability. Calling a delegate tool before the host has finished booting returns an `isError` result (`HOST_NOT_BOUND`) instead of throwing. The same plugin also grants the Orchestrator a read-only `factory_status` tool: it reads the shared worktree's git branch/head/remote-head/dirty paths, every Bead labelled `epic:<key>` (status, assignee, labels, comment activity), and whether each Bead's assignee is a live Worker session (`none` / `unknown` / `exists-idle` / `exists-busy`) — the durable end-state the Orchestrator's `epic-binding` Recovery rule uses to release a stale claim (`in_progress` with an `unknown`/`exists-idle` assignee, no handoff comment, no new commit) and never a claim that is `exists-busy`.
- each seat may receive its own strict host-selected default model through `BORING_FACTORY_ORCHESTRATOR_MODEL`, `BORING_FACTORY_WORKER_MODEL`, and `BORING_FACTORY_REVIEWER_MODEL`; users may still select another admitted model for a session/turn;
- both seats receive a host-authored `epic-binding` instruction appendix that scopes them to exactly one epic (label `epic:<key>`); the key defaults to the epic branch name of the workspace root and can be overridden with `BORING_FACTORY_EPIC_KEY`;
- the Worker and Orchestrator also receive a `factory-precedence` appendix reconciling the canonical `exec`/`owner-gate` skill blocks (written for per-Bead PRs and blocking `ask_user` gates) with this Factory's actual topology: the epic branch is the only branch and the epic PR belongs to the Orchestrator/owner; Workers never open PRs or run `ask_user` gates and hand off through a Bead comment instead; the Orchestrator's plan-block `/skill:exec` handoff is replaced by `dispatch_worker`, and it raises exactly two Inbox gates itself — see [Owner handoff (Inbox gates)](#owner-handoff-inbox-gates) below;
- `factory-demo` is a host-governed plugin, granted only to the Orchestrator, backing Gate 2 with a real running demo — see [Owner handoff (Inbox gates)](#owner-handoff-inbox-gates);
- all seats receive the workspace-scoped ask-user capability;
- Tasks reads GitHub plus the checkout's Beads graph;
- the standard Agents, sessions, Inbox, Tasks, and Automations surfaces provide the watch plane.

The app is deliberately no-auth and local. It is an integration playground, not a production deployment.

## Run and watch

```bash
pnpm --filter factory-playground dev
```

Open <http://localhost:5220>. Start on **Boring Orchestrator**, ask it to arm supervision (it calls the host `supervise` tool) or use the seeded feature suggestion. Watch addressed Worker sessions in Agents, claims in Tasks, owner gates in Inbox, and dispatch runs in Automations.

A deterministic tracer-bullet simulation is available without model or cloud credentials. It requires the real `br` CLI on `PATH`; the simulation test skips rather than substituting a fake graph when `br` is unavailable:

```bash
pnpm --filter factory-playground simulate
```

It boots the native app, obtains one host-issued Orchestrator session and two host-issued Worker sessions, executes `/loop list`, then visibly streams intake → plan gate → two real `br ready`/claim operations → edits and commits in one shared epic worktree → exact-SHA snapshots in dedicated test sandboxes → deterministic host validation → final exact-SHA sandbox integration test → release. The full receipt is written to `apps/factory-playground/workspace/factory-runs/latest.json`. It never merges.

## Sandbox modes

`local-simulation` is the default. The shared epic worktree is the editing authority. After each commit, the provider snapshots that exact SHA into a disposable root where the real `sandbox_bash` tool runs tests; sandbox changes are never copied back. The watch script invokes tools through a deterministic harness using host-issued session identities, so it proves host grants, ownership, routing, pull-based `br` claims, exact-SHA test isolation, cleanup, and integrated feature evidence. It does **not** claim security confinement, model-selected calls, or independent agent review.

To use the real Vercel disposable provider, set the variables documented in `.env.example`, including a host-selected immutable snapshot ID. The model cannot select provider, snapshot, credentials, TTL, quota, roots, or cleanup policy.

Current limitation: the app isolates supervision, automation, and sandbox capabilities, but the standard local primary-workspace shell/file tools still exist on both seats. The Orchestrator's no-implementation rule is therefore behavioral in this playground, matching the current canonical persona; per-seat denial of primary mutation needs a separate host-authority slice before production use.

The Vercel provider's separate credential-gated package smoke remains:

```bash
RUN_VERCEL_SANDBOX_LEASE_SMOKE=1 \
  pnpm --filter @hachej/boring-sandbox-plugin smoke:vercel
```

## Owner handoff (Inbox gates)

The Orchestrator raises exactly two Inbox Human Intentions with `ask_user` per epic and never proceeds past either one without an owner decision — see `.agents/skills/owner-gate/SKILL.md` for the transport rules and `docs/procedures/owner-review-card.md` for the review-card shape both gates fill in.

The `show-me` skill (`.agents/skills/show-me/SKILL.md`) is attached to the Orchestrator seat and is mandatory, not optional, at both gates (owner ruling): Gate 1's `ask_user` call carries a `show-me-plan` artifact pointing at `docs/issues/<issue>/show-me-plan.md` (structure/behavior/diff views of the epic), and Gate 2's PR body carries a `## Show me` section (diff-shaped views plus a sequence diagram of the shipped flow, derived from the actual commits) mirrored to `docs/issues/<issue>/show-me-<short sha>.md` and passed as a `show-me-pr` artifact. `apps/factory-playground/scripts/live-epic-acceptance.mjs` asserts both.

- **Gate 1 — plan approval.** Raised right after the Orchestrator materializes the epic's Bead graph, before it arms supervision or dispatches a Worker. Title `[br-<epic bead id or first bead id>] Plan approval: <epic title>`; context carries the goal, the Bead list (id, title, dependency order), the proof commands, and risk/rollback. Same `decision` radio (`approve`/`changes`/`defer`/`reject`) plus an optional notes textarea as Gate 2. On anything but `approve`, the Orchestrator revises or stops — it never arms supervision or dispatches. The only way to skip it is when the owner's own request text literally says "Gate 1 pre-approved".
- **Gate 2 — merge approval.** Raised once `factory_status` shows every epic Bead handed off (SHA + sandbox proof + `fresh_review` approve on each, local HEAD = remote HEAD, nothing left ready/unassigned). Before raising it, the Orchestrator: (a) opens the epic PR itself with `gh pr create` (or edits the existing one for that branch) — the body is the Owner Review card from `docs/procedures/owner-review-card.md`, filled in, followed by a `## Handover` section (SHA, branch, Worker/reviewer sessions, sandbox receipts); (b) starts a live demo of the exact SHA with `demo_sandbox` (op `start`) and waits for it to report `ready: true`; then (c) raises `ask_user` with the PR URL, head SHA, the demo URL and its lifetime, please-test steps, and the handover lines in `context`. On `approve` the Orchestrator never merges — it comments on the PR that the owner approved at that SHA and reports. On `changes` it opens follow-up Beads labelled `epic:<key>` and dispatches a Worker; it never merges either way.

`demo_sandbox` (plugin `factory-demo`, tool granted only to the Orchestrator) is what backs Gate 2's live demo. It requires the Vercel Factory sandbox provider (`BORING_FACTORY_SANDBOX_PROVIDER=vercel` and `BORING_FACTORY_VERCEL_SNAPSHOT_ID`) and returns an `isError` result otherwise. `op: 'start'` takes `command` (a shell command that serves the demo, run detached), `port` (1024–65535), an optional `sha` (defaults to the workspace's current `HEAD`), an optional `ttlMinutes` (default and hard cap both `BORING_FACTORY_DEMO_MAX_MINUTES`, itself defaulting to 40 — Vercel's hobby-plan sandbox lifetime cap is 45 minutes), an optional `install` command run before `command`, and an optional `readyPath` (default `/`) polled after `command` starts until it answers with a sub-500 status or 120s elapse. It creates a fresh Vercel sandbox from the configured snapshot, seeds it with the same exact-SHA-fetch bootstrap files `remoteSnapshotProvider.ts` uses (`.factory-sha`, `.factory-branch`, `.factory-remote`, `factory-bootstrap.sh`), runs the bootstrap, then `install` if given, then `command` detached, and returns `{ id, url, sha, port, expiresAt, ready }`. `op: 'stop'` (`id`) tears one down; `op: 'status'`/`'list'` (alias) report every live demo, each flagged `expired` once past `expiresAt`. State persists to `<state root>/demos.json`; on boot the host sweeps (stops + forgets) any entry already past its `expiresAt` and leaves the rest armed — the sandbox's own `timeout` is the actual enforcement, this is just bookkeeping cleanup.

`apps/factory-playground/scripts/live-epic-acceptance.mjs` answers both gates itself, exactly as an owner would: it polls the Orchestrator's pending question over the same WorkspaceBridge `ask-user.v1.pending`/`ask-user.v1.answer` ops the browser front uses (`POST /api/v1/workspace-bridge/call`, headers `x-csrf-token: browser` + `x-boring-session-id: <sessionId>`), prints the title/context, and answers `{ decision: 'approve', notes: '...' }`. At Gate 2 it additionally verifies the PR body (`## Owner Review` + `## Handover`) via `gh pr view` and fetches the demo URL to confirm it actually serves the feature, before answering and asserting the PR stays `OPEN` (never merged).

## Checks

```bash
pnpm --filter factory-playground typecheck
pnpm --filter factory-playground test
pnpm --filter factory-playground build
pnpm lint:invariants
```

## Live epic acceptance run

The real, model-driven run (credentials on the API process; `br` on `PATH`). It uses a throwaway epic worktree as the shared workspace so Worker commits and pushes land on a test branch:

```bash
git worktree add .worktrees/factory-live-epic -b test/factory-live-epic feat/<your-branch>
BORING_FACTORY_WORKSPACE_ROOT=$PWD/.worktrees/factory-live-epic \
BORING_FACTORY_EPIC_KEY=live-farewell \
BORING_FACTORY_ORCHESTRATOR_MODEL=openai-codex:gpt-5.6-sol \
BORING_FACTORY_WORKER_MODEL=openai-codex:gpt-5.4 \
BORING_FACTORY_REVIEWER_MODEL=openai-codex:gpt-5.4 \
  pnpm exec tsx apps/factory-playground/src/server/dev.ts &
EPIC_WT=$PWD/.worktrees/factory-live-epic EPIC_KEY=live-farewell \
  node apps/factory-playground/scripts/live-epic-acceptance.mjs
```

Expected end state, all read back from Bead and git end-states only: one Bead labelled `epic:<key>` created by the Orchestrator; the Worker (started through `dispatch_worker`) claimed it with its own session id, committed only the intended files on the epic branch, verified `git rev-parse HEAD` inside its exact-SHA sandbox, ran the tests there, obtained a `fresh_review` verdict bound to that SHA, pushed the epic branch, and recorded the full handoff as a Bead comment; the Orchestrator read those facts back with `factory_status` and stopped; nothing merged, nothing closed. The receipt lands in `workspace/factory-runs/live-<key>.json` of the epic worktree. Recorded run: `docs/issues/1508/live-run-2026-09-03.md`.

## Remote sandboxes (Vercel)

The `local-simulation` provider (`localDisposableProvider.ts`) proves exact-SHA
lease isolation with a shared local git clone: the shared epic worktree stays
the editing authority on this machine, and every lease is a `git clone
--shared` + `checkout <HEAD>` of it. That still runs the actual test/build
load on this machine. The Vercel provider (`remoteSnapshotProvider.ts`,
wrapping `@hachej/boring-sandbox`'s `createVercelSandboxProvider`) does the
same exact-SHA isolation but on Vercel Sandbox compute, so this machine is
never blocked by Worker test/build load.

### How it works

`createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source })`
wraps any disposable sandbox provider. It supports two source modes for
getting the exact-SHA tree into the sandbox:

- **`'archive'`** — full tree upload. `git archive <sha> | tar -x` exports
  the tracked tree (no `.git`, no untracked files, so no `node_modules`; the
  sandbox installs its own if a test needs them) into a fresh directory
  under `scratchRoot`, which is then packaged/seeded into the sandbox by the
  inner provider. Works for any repo, including ones with no remote, but
  seeding the whole tree can take minutes — see **Verified live** below.
- **`'fetch'`** — the sandbox fetches its own tree. Only four tiny files are
  exported: `.factory-sha`, `.factory-branch`, `.factory-remote` (the
  `origin` URL, rewritten to plain `https://` with any embedded credentials
  stripped), and `factory-bootstrap.sh`. The sandbox pair's first `exec()`
  call transparently runs that script first — `git init` if needed, `git
  fetch --depth 1 origin <sha>` (falling back to a full fetch), `git
  checkout --detach FETCH_HEAD`, then verifies `git rev-parse HEAD` matches
  — before running the caller's actual command. A `.factory-bootstrapped`
  marker makes this idempotent (skipped on any exec after the first
  succeeds). **Only works when `<sha>` has already been pushed and is
  reachable on `origin`** — if not, the exec that would have triggered
  bootstrap instead returns a non-zero exit with the output of the failed
  `git fetch`/checkout plus a clear line:
  `factory-bootstrap failed: push the epic branch so <sha> is reachable on origin`,
  and the caller's command never runs.

Default: `'fetch'` when `sourceRoot` has a resolvable `origin` remote (this
repo is public, so no credentials are ever needed to fetch it), else
`'archive'`. Override with `BORING_FACTORY_REMOTE_SOURCE` (see **Env vars**).

Regardless of mode:

1. Reads `git rev-parse HEAD` of `sourceRoot` (the shared epic worktree) for
   the exact SHA.
2. Calls `inner.create({ ...context, templatePath: exportPath })` with
   whichever export was built.
3. Keeps the export directory alive until the returned pair is `dispose`d,
   not just until `create()` resolves — see **Verified live** below for why.

`sandboxComposition.ts` wires this in automatically: when
`BORING_FACTORY_SANDBOX_PROVIDER=vercel`, `createFactorySandboxPlugin` wraps
`createVercelSandboxProvider(...)` with `createExactShaTemplateProvider`,
scratch rooted at `<stateRoot>/snapshots`. The immutable base snapshot
(`BORING_FACTORY_VERCEL_SNAPSHOT_ID`) is still required and is never model
selected — it is host authority, same as today.

### One-time setup: the base snapshot (warm by default)

A remote lease that only fetches the exact SHA is fast (seconds), but a real
monorepo `pnpm install` + package builds take minutes — running those on
every lease defeats the point of a disposable sandbox. `snapshot:vercel`
therefore bakes a **warm** base snapshot by default: it clones
`hachej/boring-ui` at `origin/main` (or `--ref <sha>`) into
`FACTORY_WARM_REPO_ROOT` (`/vercel/sandbox/repo`, exported by
`remoteSnapshotProvider.ts`), pins `pnpm` via corepack to the version in the
cloned repo's `package.json` `packageManager` field, runs `pnpm install
--frozen-lockfile`, builds every package/plugin (`pnpm run build:packages`),
and records `.factory-snapshot.json` (`{ baseSha, lockfileSha256,
pnpmVersion, builtAt, buildCommand, repoRoot }`) at the repo root before
snapshotting:

```bash
VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
  pnpm --filter factory-playground snapshot:vercel [--ref <sha-or-ref>]
```

Every lease's bootstrap (`FACTORY_BOOTSTRAP_SCRIPT` in
`remoteSnapshotProvider.ts`, shared by `createExactShaTemplateProvider` and
`demoPlugin`'s `demo_sandbox` tool) detects the warm marker and does the
minimum: `git fetch`/`checkout --detach` the exact SHA, `pnpm install
--frozen-lockfile --offline` **only if** `pnpm-lock.yaml`'s hash moved since
the snapshot was baked, then rebuild **only the packages that changed since
the snapshot's `baseSha`** via pnpm's changed-since filter (`pnpm -r
--filter "...[<baseSha>]" build`) — nothing changed means pnpm skips the
build entirely. `/workspace` (where `createVercelSandboxExec` always runs
later commands) is then symlinked to the warm repo, so a real command like
`pnpm --filter factory-playground test` runs immediately, no different from
running it in a fully-set-up local checkout.

Pass `--bare` to fall back to the original, much cheaper snapshot: it only
proves `node`, `npm`, `git`, and (best-effort) `pnpm` via corepack, and does
not touch source code. A lease from a bare snapshot always pays the full
install+build cost via the cold bootstrap path (no `.factory-snapshot.json`
marker, so `FACTORY_BOOTSTRAP_SCRIPT` takes the original fetch-only branch).

```bash
VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
  pnpm --filter factory-playground snapshot:vercel --bare
```

Either way, this prints `BORING_FACTORY_VERCEL_SNAPSHOT_ID=snap_...` on
success — put that value in `.env` (or wherever
`BORING_FACTORY_VERCEL_SNAPSHOT_ID` is sourced from for the running app).
Base snapshots are created with a 7-day expiration.

**Refresh rule:** recreate the warm snapshot whenever `pnpm-lock.yaml`
changes materially, or at least weekly, so the incremental rebuild filter
(`...[<baseSha>]`) never has to walk a multi-week diff. Re-running
`pnpm --filter factory-playground snapshot:vercel` and updating
`BORING_FACTORY_VERCEL_SNAPSHOT_ID` is the entire refresh procedure.

### Env vars

All documented in `.env.example`:

```bash
BORING_FACTORY_SANDBOX_PROVIDER=vercel
BORING_FACTORY_VERCEL_SNAPSHOT_ID=snap_...        # from snapshot:vercel above
BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS=900000     # default 15 min
BORING_SANDBOX_TELEMETRY_SALT=...
VERCEL_TOKEN=...    # or VERCEL_ACCESS_TOKEN / VERCEL_OIDC_TOKEN
VERCEL_TEAM_ID=...
VERCEL_PROJECT_ID=...

# Optional override of the exact-SHA source mode (see How it works above).
# Default is auto-detected from sourceRoot's origin remote.
# BORING_FACTORY_REMOTE_SOURCE=fetch      # seconds; needs <sha> pushed to origin
# BORING_FACTORY_REMOTE_SOURCE=archive    # minutes; full tree upload, any repo
```

### Verified live: timing and limits

Run against the real `factory-live-epic-1508-r4` worktree (a full monorepo
checkout: 3,926 tracked files, ~84 MB as a `git archive` tarball) with
credentials from Vault (`secret/agent/vercel`):

- **Snapshot creation** (`snapshot:vercel`, one-time): under a minute
  end-to-end (node/npm/git verification + corepack/pnpm enablement +
  `sandbox.snapshot()`).
- **Lease create → healthy → exec → dispose**, one full lease against
  `factory-live-epic-1508-r4`:
  - `create()`: ~12s (sandbox boot from the immutable snapshot).
  - **Template packaging fell back to per-file `writeFiles`**: at this
    repo's size (3,926 files), the tarball-upload fast path
    (`@vercel/blob`) failed because no `BLOB_READ_WRITE_TOKEN` is
    provisioned in this environment, so every lease seeded file-by-file
    instead. That fallback took **~847s (~14 minutes)** for this repo size —
    this is the dominant cost of a Vercel lease today, not sandbox boot or
    `git archive`/`tar` (both single-digit seconds).
  - `exec()` (the `.factory-sha` + fixture `npm test` check below): under
    1s once the sandbox was seeded.
  - `dispose()`: ~0.5s.
  - `.factory-sha` inside the sandbox matched `git rev-parse HEAD` of the
    epic worktree exactly; `apps/factory-playground/src/fixtures/demo-repo`
    was present, and its `npm test` (`node --test`) passed 2/2.
- Reproduce with `scripts/vercel-lease-smoke.mts`
  (`RUN_VERCEL_FACTORY_SMOKE=1`, credential-gated; `FACTORY_SMOKE_SOURCE=fetch`
  or `archive` to force a mode, `FACTORY_SMOKE_EPIC_WORKTREE` to point at a
  different worktree); it prints exit code, the last 20 lines of sandbox
  output, and per-phase timings (including a dedicated `bootstrap` phase in
  fetch mode, measured with a trivial `exec('true')` probe before the real
  command).

### Verified live: fetch mode (the fix for the 14-minute problem)

This repo is public (`github.com/hachej/boring-ui`), so `'fetch'` mode needs
no credentials to reach it. Run against `factory-live-epic-1508-r5` (HEAD
`8ac95293`, pushed to `origin` as `test/1508-live-epic-r5`) with the same
snapshot and Vault credentials as above, `FACTORY_SMOKE_SOURCE=fetch`:

- `create()`: **764ms**.
- `checkHealth()`/template-seed: **2.76s** — only 4 tiny marker files this
  time (vs. 3,926 for archive mode on the r4 worktree), so no minutes-long
  `writeFiles` fallback.
- **`bootstrap` (first exec, `git fetch --depth 1 origin <sha>` +
  checkout + verify): 3.55s.**
- `exec()` (the real `.factory-sha` + fixture `npm test` check): **879ms**.
- `dispose()`: **174ms**.
- Total lease lifetime: **~8s**, vs. ~14 minutes for `'archive'` mode at
  monorepo scale — this is the fix for the residual limit measured above.
- `.factory-sha` inside the sandbox matched `git rev-parse HEAD` of the r5
  worktree (`8ac95293322c2712214699d41ada1f7fa49710ad`) exactly; the fixture
  `npm test` (`node --test`) passed 2/2.

**Residual limits, as measured:**

- **`'fetch'` mode requires the exact SHA to already be pushed to `origin`.**
  A Worker's uncommitted or unpushed commits are invisible to it — this is
  by design (the sandbox does its own `git fetch`, it never receives the
  local tree), but it does mean `'fetch'` only isolates pushed work; use
  `'archive'` (or push first) for anything still local-only.
- **No Vercel Blob token in this environment** means `'archive'` mode
  against a repo this size pays the ~14-minute `writeFiles` seeding cost
  instead of a single tarball upload. Provisioning `BLOB_READ_WRITE_TOKEN`
  (or passing `packageTemplateOpts.blobToken`) would fix `'archive'` mode
  directly; it was out of scope here (host credential, not something this
  app owns). `'fetch'` mode sidesteps this entirely for public/pushed repos,
  which is why it is now the default when an origin remote is present.
- **The export directory must outlive `create()`**, not just settle when it
  resolves: `createVercelSandboxProvider`'s disposable lifecycle defers
  template packaging/seeding to a background readiness promise that is only
  awaited by the pair's first `checkHealth()` (or exec) call, which can run
  well after `create()` returns. `createExactShaTemplateProvider` accounts
  for this — the export is removed on `dispose()`, not immediately after
  `create()` — but any other direct caller of `templatePath`-based creation
  must call `checkHealth()` (or otherwise force readiness) before assuming
  the sandbox reflects the exported tree.
- **No preview URL surface today.** This wiring only proves exec/test
  isolation on exact-SHA source; it does not expose an HTTP preview of
  anything running inside the sandbox.
- **`git` availability inside a lease depends on the base snapshot's
  bootstrap**, not on anything per-lease: `snapshot:vercel` verifies/installs
  it once at snapshot-creation time. A base snapshot built without a
  reachable package manager (no `dnf`/`apt-get`, no `sudo`) would produce
  sandboxes with no `git`, and every lease from it would inherit that gap
  until the snapshot is rebuilt.

### Verified live: warm snapshot

Built by `snapshot:vercel` (default mode, no `--bare`) against
`origin/main` at `186f2b16`, credentials from Vault (`secret/agent/vercel`):

| Step | Time |
| --- | --- |
| verify node/npm/git, enable corepack | ~1s |
| clone `hachej/boring-ui` (`--filter=blob:none`) into `/vercel/sandbox/repo` | ~4s |
| checkout `origin/main`, read `packageManager`, activate `pnpm@10.33.2` | ~1.5s |
| `pnpm install --frozen-lockfile` | 14.7s |
| `pnpm -r --filter './packages/*' --filter './plugins/*' --workspace-concurrency=2 build` | 216.6s |
| write `.factory-snapshot.json`, `sandbox.snapshot()` | ~4s |
| **total** | **244.5s (~4m5s)** |

Snapshot id: `snap_ULgPKh5v6ww20gkBUxJBKUHCzp7F` (this run; regenerate per the
refresh rule above — ids are not stable across runs).

**Vercel limits hit while building this:**

- `resources: { vcpus: 8 }` was rejected outright with a `400` on this
  Vercel plan/team; `4` (8192 MB) is accepted and is what the script uses.
- Even at the default 1 vCPU / 2048 MB, `packages/agent`'s tsup DTS worker
  reliably hit `ERR_WORKER_OUT_OF_MEMORY` — this is real machine-memory
  pressure, not just a V8 heap flag (raising `NODE_OPTIONS
  --max-old-space-size` alone did not fix it at 1 vCPU; it only helped once
  paired with `resources: { vcpus: 4 }`).

**Lease-side finding (`vercel-lease-smoke.mts`, default command, against
`factory-live-epic-1508-r8`, HEAD `2f33f47a`, pushed as
`epic/farewell-api-r8`):** the fetch/lockfile/build mechanism itself is
verified correct — `factory-bootstrap-phase fetch` completed in ~0.6-1.3s
against this warm snapshot, `pnpm-lock.yaml` had genuinely drifted between
`baseSha` and this branch's HEAD (a real, pre-existing lockfile/package.json
mismatch on that branch — `pi-mono-loop` removed from
`apps/factory-playground/package.json` but not from the lockfile), which the
bootstrap now handles via a `--frozen-lockfile` → `--no-frozen-lockfile`
fallback chain (see `remoteSnapshotProvider.ts`). But the *full* `pnpm
--filter factory-playground test` run against this specific branch could
not be completed within the lease's 10-minute sandbox timeout: this
particular diff's pnpm changed-since filter matched most of
`packages/*`/`plugins/*` (a shared-lockfile change makes pnpm's `...[ref]`
selector conservative — it cannot cheaply prove packages it can't otherwise
scope are unaffected), and rebuilding that many packages serially
(`--workspace-concurrency=1`, required to avoid the same OOM the seed
sandbox hit, since disposable leases have no `resources.vcpus` bump by
default) exceeded 10 minutes; Vercel closed the sandbox stream
mid-bootstrap (`Sandbox stream was closed and is not accepting commands`).
Added a `BORING_AGENT_VERCEL_SANDBOX_VCPUS` env var
(`createVercelSandboxProvider`) so a caller can request more resources for a
lease that needs to rebuild — `vercel-lease-smoke.mts` sets it to `4` by
default — but did not extend this run's own lease timeout far enough to
finish a multi-package serial rebuild live in this session. The cheap-path
smoke (`FACTORY_SMOKE_COMMAND` against the fixture demo-repo, which needs no
package rebuild) was not completed live in this session either, for the same
time-budget reason — the unconditional bootstrap step runs before any
command, cheap or not.

**Practical takeaway:** the warm-snapshot mechanism (fetch, lockfile-hash
skip, incremental filter, `/workspace` symlink swap) is verified correct at
the unit level (real `sh`/`git`, real bootstrap script — see
`remoteSnapshotProvider.test.ts`) and the live fetch/install-decision phase
against a real pushed epic branch. The specific "handful of packages, not
all" claim depends on how stale the warm snapshot's `baseSha` is relative to
the lease's SHA and on the lockfile diff between them; recreating the
snapshot on the refresh cadence above (weekly, or whenever
`pnpm-lock.yaml` changes) keeps that diff small for a typical epic branch.
A branch whose lockfile has drifted from a week-plus-old `baseSha` is a
worse-than-typical case and can still trigger a large rebuild — raising the
lease's own timeout (`timeoutMs` on `createVercelSandboxProvider`) and/or
requesting more `resources.vcpus` for that lease are the two knobs available
today; a more scoped changed-since filter is a possible follow-up.
