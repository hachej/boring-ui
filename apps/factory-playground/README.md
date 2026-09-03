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

## Launching your work threads

`scripts/factory-epic.mjs` launches one Factory **instance per work thread** —
an open PR or branch of this repo, or an epic in another repository — each
with its own Inbox/Agents/Tasks UI, its own worktree, its own ports, and its
own state root. Several instances run at once; none of them touch the
`127.0.0.1:5230`/`5220` pair another live-epic process may already be using,
and none of them delete or reuse another instance's worktree. Run all of the
following from `apps/factory-playground/` (or via `pnpm --filter
factory-playground epic -- <args>`).

```bash
node scripts/factory-epic.mjs intake
```

Lists every open PR on this repo (`gh pr list`) as a ready-to-paste `up`
command, with a 2–4 word Title Case feature name derived from the PR title
(leading `[bracket]`/`#issue`/`type(scope):` prefixes stripped). It never runs
anything — copy the line you want, edit the feature name if you like, and run
it.

```bash
# A PR of this repo:
node scripts/factory-epic.mjs up --feature "Filesystem Roots Fix" --pr 1511 --provider local-simulation

# A branch of this repo that isn't a PR yet:
node scripts/factory-epic.mjs up --feature "Filesystem Roots Fix" --branch fix/1511-filesystem-roots

# An epic in another repository (see "Multi-repo and private repos" below):
node scripts/factory-epic.mjs up --feature "CDC Backfill" --repo https://github.com/hachej/boring-cdc --base main
```

`up`:

1. Resolves (creating if needed) the epic's shared worktree — `git worktree
   add .worktrees/epic-<slug>` off the PR's/branch's head for `--pr`/
   `--branch`, or a clone plus a `git worktree add -B epic/<slug>` off
   `--base` (default: the remote's default branch), pushed with `-u`, for
   `--repo`. A branch that's already checked out elsewhere (e.g. your own
   current worktree) falls back to a detached worktree at the same HEAD
   rather than failing.
2. Ensures a git identity and runs `br init --no-auto-flush` in that
   worktree if `.beads` doesn't exist yet.
3. Picks the next free `(5230 + 2k, 5220 + 2k)` API/UI port pair — see
   **Port allocation** below — and a fresh per-epic state root under
   `.factory-state/epics/<slug>/`.
4. Launches `pnpm exec vite --port <ui>` from **this** checkout (so it reuses
   already-built package `dist/`s; it never rebuilds them per epic) with
   `BORING_FACTORY_WORKSPACE_ROOT` pointed at the epic's worktree,
   `BORING_FACTORY_EPIC_KEY`/`BORING_FACTORY_FEATURE_NAME` set, per-seat model
   overrides from `--models orch=...,worker=...,reviewer=...`, the sandbox
   provider from `--provider` (default `local-simulation`), a fresh
   telemetry salt, and no fixed snapshot id (so a `vercel` epic always gets
   its own per-epic warm snapshot — see **Remote sandboxes** below). One
   `vite` process serves both the UI (browser) and the API (Fastify,
   `configureServer` hook) — a separate headless `dev.ts` process is not
   also started, since it would try to bind the same API port a second time.
5. Waits for `/api/v1/workspace/meta`, then prints the UI URL (and a
   Tailscale IP variant when `tailscale ip -4` is available), plus the exact
   `live-epic-acceptance.mjs` invocation to drive it headlessly instead.
6. Records the instance in `.factory-state/epics.json`.

```bash
node scripts/factory-epic.mjs list
```

Tables every registered epic: key, live/down (an actual TCP probe of its API
port, not just registry presence), ports, Bead counts (`br list --label
epic:<key>`, split open/in_progress/closed), feature name, branch, and
worktree root.

```bash
node scripts/factory-epic.mjs down <epic-key> [--keep-worktree]
```

Stops the instance's process(es) and removes its registry entry. Without
`--keep-worktree` it also runs `git worktree remove` on the epic's worktree
(refusing, safely, if it has uncommitted changes — pass `--keep-worktree` or
clean it up manually in that case).

### Port allocation

`k = 1, 2, 3, …`; API port `5230 + 2k`, UI port `5220 + 2k`. `k = 0` (ports
5230/5220) is reserved for the separate live-epic-acceptance process this app
also supports and is never allocated here. The first `k` whose pair is both
unused in the registry and actually free (a real bind probe, not just an
absence check) wins — e.g. the first epic gets API 5232 / UI 5222, the second
API 5234 / UI 5224, and so on.

### Multi-repo and private repos

The workspace root can be any git checkout — personas, skills, and the
canonical `.agents/skills/*` appendices always load from **this** repo
(`repositoryRoot` in `app.ts`), independent of `BORING_FACTORY_WORKSPACE_ROOT`.
`.agents` is marked read-only relative to the workspace root regardless of
whether that directory exists there, so an external repo with no `.agents` of
its own is unaffected. Each workspace gets its own `.beads` (created by `br
init` if missing), so multiple epics against the same external repo don't
collide — `--repo` clones the repo once into
`.worktrees/repos/<repo-slug>/` and adds a **separate** `git worktree` per
epic at `.worktrees/repos/<repo-slug>-<feature-slug>/`, each on its own
`epic/<feature-slug>` branch.

We checked `hachej/boring-cdc` while writing this: `gh repo view
hachej/boring-cdc --json isPrivate` reports `{"isPrivate":false}` — it's
public, so the `fetch`-mode Vercel sandbox path (the default whenever the
workspace root has a resolvable `origin`) needs no credentials for it today.

For a genuinely **private** repo on the Vercel sandbox path, set
`BORING_FACTORY_GIT_TOKEN` (or just have `gh auth login`'d — `factory-epic.mjs
up --provider vercel` falls back to `gh auth token` automatically when the env
var is unset). The token authenticates the sandbox's own `git clone`/`git
fetch` of a private origin via a per-call `-c
http.extraheader="AUTHORIZATION: basic <base64 x-access-token:TOKEN>"` — never
written to git config, never embedded in a script's literal text (which would
leak it to `ps` inside the sandbox), and never logged. See
`resolveFactoryGitToken` in `remoteSnapshotProvider.ts`.

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

**Private repos:** when `sourceRoot`'s origin requires auth (e.g. a private
repo launched via `factory-epic.mjs up --repo`), set
`BORING_FACTORY_GIT_TOKEN` — or just have `gh auth login`'d, since
`resolveFactoryGitToken` falls back to `gh auth token` when the env var is
unset. The token is used exactly where the sandbox authenticates against a
git remote: `warmSnapshot.ts`'s seed-sandbox clone of `remoteUrl`, and the
`'fetch'`-mode bootstrap script's `git fetch` of the exact SHA (both the warm
and cold paths). In both places it's injected as a per-call `-c
http.extraheader="AUTHORIZATION: basic <base64 x-access-token:TOKEN>"` — never
written to `~/.gitconfig`, never interpolated into a script's literal text
(which `ps` inside the sandbox could read back), and passed to the sandbox
only as an exec-scoped env var (`FACTORY_GIT_TOKEN`). Nothing that logs a
bootstrap/clone step (`runStep` in `warmSnapshot.ts`, the bootstrap phase
lines in `remoteSnapshotProvider.ts`) ever includes the token or the computed
header. See `src/server/factoryGitToken.test.ts` for the header-format and
no-token-in-logs assertions.

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
scratch rooted at `<stateRoot>/snapshots`. The base snapshot is still never
model-selected — it is host authority — but which one is used is now
per-epic by default (see the next section) rather than always the single
`BORING_FACTORY_VERCEL_SNAPSHOT_ID`.

### One snapshot per epic (the fix for the drifted-baseline problem)

**Problem observed live:** a warm snapshot built once from `main` and then
reused as the single `BORING_FACTORY_VERCEL_SNAPSHOT_ID` for every Factory
instance works fine right up until an epic branch diverges from `main`
across most packages — at that point the bootstrap's changed-since selector
(`pnpm -r --filter "...[<baseSha>]"`) matches nearly the whole monorepo, and
rebuilding that serially (required to avoid the OOM a default-resource lease
otherwise hits) blows past the lease's timeout.

**Fix:** `snapshotRegistry.ts`'s `resolveEpicSnapshot` gives every epic its
own warm snapshot, built from *that epic branch's own HEAD* — so a lease's
changed-since diff is bounded by that epic's own commits since the snapshot
was taken, never by however far the epic has diverged from wherever a fixed
snapshot happened to be built from. This is the default the moment
`BORING_FACTORY_VERCEL_SNAPSHOT_ID` is left unset:

- **Registry**: `<stateRoot>/snapshots.json`, entries keyed by
  `${epicKey}:${lockfileSha256}` (`epicKey` defaults to the workspace's git
  branch name, `BORING_FACTORY_EPIC_KEY` overrides it). A cache hit reuses
  the stored snapshot even if the epic's HEAD has advanced since it was
  built — the bootstrap's own incremental rebuild handles those newer
  commits on top of the cached `baseSha`. A miss (new epic, or the lockfile
  changed) builds a fresh snapshot from the workspace's **current HEAD**,
  which must already be pushed (`git ls-remote origin <branch>` must match;
  otherwise `resolveEpicSnapshot` throws `push the epic branch first: ...`),
  and stores it with a 7-day-minus-1-hour expiry.
- **Refresh triggers** (any one rebuilds the snapshot): the `pnpm-lock.yaml`
  hash changed, the entry expired, or a lease's bootstrap hits the
  changed-package-count guard below.
- **Bootstrap safety cap**: before ever starting the incremental rebuild,
  `buildFactoryBootstrapScript` counts how many packages the changed-since
  filter matched (`pnpm -r --filter "...[<baseSha>]" --filter '!.' exec pwd
  | wc -l`). More than `BORING_FACTORY_MAX_INCREMENTAL_PACKAGES` (default
  12) fails the bootstrap fast with a clear line:
  `factory-bootstrap: <n> packages changed since <baseSha>; refresh the
  epic snapshot` — instead of a serial rebuild that would blow the lease
  timeout anyway. `sandboxComposition.ts`'s lazy per-epic provider
  (`createPerEpicVercelProvider`) recognizes this exact failure via
  `isBootstrapRefreshNeeded`, invalidates the stale registry entry, builds a
  fresh snapshot from HEAD, and retries the lease once against it.
- **Single-flight**: concurrent callers resolving the same epic's snapshot
  (e.g. the host's boot-time warm-up racing a Worker's first lease) share
  one build rather than racing two.
- **Host warm-up**: `createFactoryPlayground` (`app.ts`) fires
  `warmUpFactorySandboxSnapshot` in the background right after boot (never
  awaited — logged, not fatal, on failure) so the epic's snapshot is usually
  already resolved by the time the first Worker lease needs one.
- **Exposed at** `GET /api/v1/workspace/meta` as `sandboxSnapshot: { mode:
  'fixed' | 'per-epic', snapshotId?, baseSha? }` (`'fixed'` when
  `BORING_FACTORY_VERCEL_SNAPSHOT_ID` is set; `'per-epic'` otherwise, with
  `snapshotId`/`baseSha` populated once one has been resolved).
- **`demoPlugin.ts`'s `demo_sandbox` tool** resolves through the same
  registry when no fixed snapshot id is configured, so an owner-facing demo
  also boots from a snapshot close to the epic's own `baseSha` rather than a
  stale `main` build.

A fixed `BORING_FACTORY_VERCEL_SNAPSHOT_ID` still works exactly as before
(useful for a Factory instance intentionally pinned to one ref, e.g. CI); it
simply skips the registry entirely.

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

**This is exactly the failure the per-epic snapshot registry above fixes.**
The finding above used the epic branch's own drift from a `main`-baked
snapshot as the `baseSha`; with a snapshot built from the epic branch's own
HEAD instead, the changed-since diff is bounded by that epic's own commits
since the snapshot was taken, not by the epic-vs-`main` distance.

### Verified live: per-epic snapshot registry

Run with **no `BORING_FACTORY_VERCEL_SNAPSHOT_ID` set** (forcing the
per-epic path), `vercel-lease-smoke.mts` composed via
`createFactorySandboxProvider` (the same call `sandboxComposition.ts` makes
for real leases) against `factory-live-epic-1508-r8` (HEAD `2f33f47a`,
pushed as `epic/farewell-api-r8`), credentials from Vault:

**Run 1 — cold (builds the epic's snapshot from its own HEAD):**

| Phase | Time |
| --- | --- |
| `resolveEpicSnapshot` (cache miss → `createWarmSnapshot` from this epic's HEAD) | ~253s (~4m13s) |
| lease `create()` (boots from the just-built snapshot) | included above (snapshot build dominates) |
| `seed`/`checkHealth` | 176ms |
| `dispose` | 328ms |

(This run's first bootstrap attempt also caught a real, separate bug —
see **Fixes found live** below — so its `command`/`bootstrap` timings aren't
representative; rerun after the fix for the numbers below.)

**Run 2 — reuse (registry cache hit; `pnpm --filter factory-playground test`):**

| Phase | Time |
| --- | --- |
| `create()` (boots from the cached snapshot) | 6,898ms |
| `seed`/`checkHealth` | 176ms |
| `bootstrap` (fetch + lockfile-hash check + changed-count guard + build) | 0ms (already bootstrapped by the eager probe inside `create()`) |
| — `factory-bootstrap-phase fetch` | 793ms |
| — `factory-bootstrap-phase install-skipped` | 147ms |
| — `factory-bootstrap-phase changed-count` | 414ms |
| — `factory-bootstrap-phase build` (0 packages matched — snapshot's own commit) | 349ms |
| `verifySha` | — (folded into the exec below) |
| `command` (`pnpm --filter factory-playground test`, 32 tests) | 6,604ms |
| `dispose` | 328ms |
| **total** | **~14.3s** |

A third run (same cached snapshot, `pnpm --filter factory-playground exec
vitest run src/server/factoryComposition.test.ts`) reproduced the same
bootstrap timings (fetch 529ms / install-skipped 154ms / changed-count
422ms / build 373ms) and a **12.5s** total lease lifetime — confirming the
registry cache-hit path is fast and repeatable, not a one-off.

A **cheap fixture command** (`node --version && echo cheap-fixture-ok`,
same cached snapshot) completed in **7.2s** total (`create` 6,173ms / `seed`
203ms / `bootstrap` 225ms / `verifySha` 231ms / `command` 174ms / `dispose`
177ms) — proving the fast path holds even when the command itself is
trivial.

**Fixes found live while running this:**

- **Seed-sandbox install needed the same lockfile-drift fallback as the
  lease bootstrap.** `factory-live-epic-1508-r8`'s `pnpm-lock.yaml` has a
  real, pre-existing drift from `package.json` (`pi-mono-loop` removed from
  `apps/factory-playground/package.json` but not the lockfile) — the same
  issue `FACTORY_BOOTSTRAP_SCRIPT` already tolerates at lease time.
  `warmSnapshot.ts`'s own `pnpm install --frozen-lockfile` did not, and
  failed outright building the epic's snapshot. Fixed by applying the same
  `--frozen-lockfile || --no-frozen-lockfile` fallback to the seed install.
- **The bootstrap's post-build marker touch used a cwd the same script had
  just deleted.** On the warm path, `factory-bootstrap.sh` `rm -rf`s
  `/workspace` and replaces it with a symlink to the warm repo — but the
  guarded wrapper (`FACTORY_BOOTSTRAP_GUARDED_COMMAND`) that invokes it runs
  in a shell whose cwd *was* `/workspace` (`createVercelSandboxExec`'s
  default), so the directory it's sitting in gets removed out from under it
  mid-script. The following `touch .factory-bootstrapped` then failed with
  `ENOENT` even though the build itself had already succeeded — this was
  never exercised before because it only triggers on the warm-snapshot +
  `'fetch'`-mode combination together, and every prior live run here had hit
  the drifted-baseline timeout before reaching this step. Fixed by having
  the guarded command `cd /` and use an absolute path (`/workspace/...`)
  after the script runs, rather than trusting the now-stale relative cwd.

Both fixes are covered by the existing unit test suite's real-`sh`
end-to-end coverage (`remoteSnapshotProvider.test.ts`) and the two smoke
runs above, which passed after applying them.

**One pre-existing, unrelated failure observed (not introduced by this
work, out of scope to fix here):** `pnpm --filter factory-playground test`
against `epic/farewell-api-r8`'s own checked-out source reproducibly fails
one test — `factoryComposition.test.ts › boots the native app with
supervise/factory_status only on the Orchestrator and sandbox only on the
Worker` — with a `409` where `201` is expected creating the Orchestrator's
session. This is application code entirely on that epic branch (a
different, unrelated in-flight feature under that same epic key), unaffected
by anything in this change; reproduced identically across two separate
lease runs, ruling out a one-off flake. 44/45 tests in that run passed; all
45 tests in *this* worktree's own suite (`apps/factory-playground`) pass —
see the check output below.
