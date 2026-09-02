# Native Boring Factory playground

A dedicated local dogfood app that composes the Factory directly from this checkout. It does **not** consume or vendor `@hachej/boring-factory` artifacts.

## Native composition

- `boring-orchestrator`: canonical `.agents/personas/orchestrator` profile plus canonical `plan`, `feedback`, `owner-gate`, and `handoff` skill sources; receives `pi-mono-loop` and `boring-automation`.
- `boring-worker`: canonical `.agents/personas/worker` profile plus canonical `exec`, `fresh-eyes`, `owner-gate`, and `handoff` skill sources; receives only the trusted `sandbox` plugin.
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

It boots the native app, obtains one host-issued Orchestrator session and two host-issued Worker sessions, executes `/loop list`, then visibly streams intake → plan gate → two real `br ready`/claim operations → two independent sandbox leases → real edits/tests/git commits → deterministic host validation → integration test → release. The full receipt is written to `apps/factory-playground/workspace/factory-runs/latest.json`. It never merges.

## Sandbox modes

`local-simulation` is the default. It executes the real `sandbox` and `sandbox_bash` tool implementations against independently copied disposable roots. The watch script invokes those tools through a deterministic harness using the host-issued session identities; it does not claim a model chose the calls. It proves host grants, ownership, routing, pull-based `br` claims, pin/drain, cleanup, and integrated feature evidence; it does **not** claim security confinement or independent agent review.

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
