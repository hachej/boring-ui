# Native Boring Factory playground

A dedicated local dogfood app that composes the Factory directly from this checkout. It does **not** consume or vendor `@hachej/boring-factory` artifacts.

## Native composition

- `boring-orchestrator`: canonical `.agents/personas/orchestrator` profile plus canonical `plan`, `feedback`, `owner-gate`, and `handoff` skill sources; receives `pi-mono-loop` and `boring-automation`.
- `boring-worker`: canonical `.agents/personas/worker` profile plus canonical `exec`, `fresh-eyes`, `owner-gate`, and `handoff` skill sources; receives only the trusted `sandbox` plugin.
- each seat may receive its own strict host-selected default model through `BORING_FACTORY_ORCHESTRATOR_MODEL` and `BORING_FACTORY_WORKER_MODEL`; users may still select another admitted model for a session/turn;
- both seats receive a host-authored `epic-binding` instruction appendix that scopes them to exactly one epic (label `epic:<key>`); the key defaults to the epic branch name of the workspace root and can be overridden with `BORING_FACTORY_EPIC_KEY`;
- all seats receive the workspace-scoped ask-user capability;
- Tasks reads GitHub plus the checkout's Beads graph;
- the standard Agents, sessions, Inbox, Tasks, and Automations surfaces provide the watch plane.

The app is deliberately no-auth and local. It is an integration playground, not a production deployment.

## Run and watch

```bash
pnpm --filter factory-playground dev
```

Open <http://localhost:5220>. Start on **Boring Orchestrator** and enter `/loop` or use the seeded feature suggestion. Watch addressed Worker sessions in Agents, claims in Tasks, owner gates in Inbox, and dispatch runs in Automations.

A deterministic tracer-bullet simulation is available without model or cloud credentials. It requires the real `br` CLI on `PATH`; the simulation test skips rather than substituting a fake graph when `br` is unavailable:

```bash
pnpm --filter factory-playground simulate
```

It boots the native app, obtains one host-issued Orchestrator session and two host-issued Worker sessions, executes `/loop list`, then visibly streams intake → plan gate → two real `br ready`/claim operations → edits and commits in one shared epic worktree → exact-SHA snapshots in dedicated test sandboxes → deterministic host validation → final exact-SHA sandbox integration test → release. The full receipt is written to `apps/factory-playground/workspace/factory-runs/latest.json`. It never merges.

## Sandbox modes

`local-simulation` is the default. The shared epic worktree is the editing authority. After each commit, the provider snapshots that exact SHA into a disposable root where the real `sandbox_bash` tool runs tests; sandbox changes are never copied back. The watch script invokes tools through a deterministic harness using host-issued session identities, so it proves host grants, ownership, routing, pull-based `br` claims, exact-SHA test isolation, cleanup, and integrated feature evidence. It does **not** claim security confinement, model-selected calls, or independent agent review.

To use the real Vercel disposable provider, set the variables documented in `.env.example`, including a host-selected immutable snapshot ID. The model cannot select provider, snapshot, credentials, TTL, quota, roots, or cleanup policy.

Current limitation: the app isolates `/loop`, automation, and sandbox capabilities, but the standard local primary-workspace shell/file tools still exist on both seats. The Orchestrator's no-implementation rule is therefore behavioral in this playground, matching the current canonical persona; per-seat denial of primary mutation needs a separate host-authority slice before production use.

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
