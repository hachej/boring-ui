# Native Boring Factory playground

A dedicated local dogfood app that composes the Factory directly from this checkout. It does **not** consume or vendor `@hachej/boring-factory` artifacts.

## Native composition

- `boring-orchestrator`: canonical `.agents/personas/orchestrator` profile plus canonical `plan`, `feedback`, `owner-gate`, and `handoff` skill sources; receives `factory-supervision`, `boring-automation`, and `factory-delegate`.
- `boring-worker`: canonical `.agents/personas/worker` profile plus canonical `exec`, `fresh-eyes`, and `handoff` skill sources (`owner-gate` is dropped: this seat never raises an owner gate — see `factory-precedence` below); receives the trusted `sandbox` plugin and `factory-delegate`.
- `boring-reviewer`: canonical `.agents/personas/reviewer` profile plus the canonical `fresh-eyes` skill source; a fresh-context adversarial reviewer of exactly one SHA, with no plugins of its own — it is only ever reached as a `fresh_review` delegation target, never addressed directly by a user.
- `factory-supervision` is a host-governed durable-nudge plugin, granted only to the Orchestrator. Its `supervise` tool (`op: 'start' | 'stop' | 'status'`) persists an entry (session id, interval, prompt) to `<state root>/supervision.json` and arms an interval timer; the host re-arms every persisted entry from disk on boot (`rearm()`, called from `app.ts` right after `createWorkspaceAgentServer` resolves), so a nudge survives a process restart — the old `pi-mono-loop` `/loop` command's in-memory-only timers did not. Each tick reads the Orchestrator's own session state first: if it isn't `idle` the tick is recorded as `skipped-busy` and nothing is queued; only an idle session gets prompted with `Supervision tick <n> (<ISO time>): <prompt>` (`requireIdle: true`). Default prompt: run `factory_status` and check durable end-state facts against the epic's acceptance criteria, then report facts only — never implement.
- `factory-delegate` is a host-governed in-process delegation tool, granted per seat from a static table: the Orchestrator's `dispatch_worker` starts a fresh Worker session, and the Worker's `fresh_review` starts a fresh Reviewer session; any other seat gets no delegation tool. Each call creates a brand-new child session (never resumes one), prompts it once, polls the host session-state API until it goes idle, and returns only the child's final assistant text plus `provenance: { sessionId, agentTypeId, model, briefDigest, startedAt, finishedAt }` — the child's tool calls and intermediate messages are never exposed to the caller. The child session's title records the parent session id for traceability. Calling a delegate tool before the host has finished booting returns an `isError` result (`HOST_NOT_BOUND`) instead of throwing. The same plugin also grants the Orchestrator a read-only `factory_status` tool: it reads the shared worktree's git branch/head/remote-head/dirty paths, every Bead labelled `epic:<key>` (status, assignee, labels, comment activity), and whether each Bead's assignee is a live Worker session (`none` / `unknown` / `exists-idle` / `exists-busy`) — the durable end-state the Orchestrator's `epic-binding` Recovery rule uses to release a stale claim (`in_progress` with an `unknown`/`exists-idle` assignee, no handoff comment, no new commit) and never a claim that is `exists-busy`.
- each seat may receive its own strict host-selected default model through `BORING_FACTORY_ORCHESTRATOR_MODEL`, `BORING_FACTORY_WORKER_MODEL`, and `BORING_FACTORY_REVIEWER_MODEL`; users may still select another admitted model for a session/turn;
- both seats receive a host-authored `epic-binding` instruction appendix that scopes them to exactly one epic (label `epic:<key>`); the key defaults to the epic branch name of the workspace root and can be overridden with `BORING_FACTORY_EPIC_KEY`;
- the Worker and Orchestrator also receive a `factory-precedence` appendix reconciling the canonical `exec`/`owner-gate` skill blocks (written for per-Bead PRs and blocking `ask_user` gates) with this Factory's actual topology: the epic branch is the only branch and the epic PR belongs to the Orchestrator/owner; Workers never open PRs or run `ask_user` gates and hand off through a Bead comment instead; the Orchestrator's plan-block `/skill:exec` handoff is replaced by `dispatch_worker`, and Gate 2 (merge) is never the Orchestrator's to raise;
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
