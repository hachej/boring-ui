# [Factory Plugin] Extract the Factory host runtime into plugins/boring-factory

Owner request (2026-09-04). Everything under `apps/factory-playground/src/server` except `dev.ts` and the composition call is the Factory host runtime: seat composition with epic binding (`factoryFleet.ts`), the host tools `dispatch_worker` / `fresh_review` / `factory_status` (`delegatePlugin.ts`), durable `supervise` (`supervisionPlugin.ts`), `demo_sandbox` (`demoPlugin.ts`), exact-SHA leases and per-epic snapshots (`sandboxComposition.ts`, `snapshotRegistry.ts`, `warmSnapshot.ts`, `remoteSnapshotProvider.ts`, `localDisposableProvider.ts`). None of it is playground-specific. Ruling: it moves into the first-party plugin `plugins/boring-factory` (which today only packages personas and skills), so that `packages/*` stays canonical boring-ui, `plugins/boring-factory` is the Factory, and `apps/factory-playground` is only its dogfood composition. The CLI hub and the full app must be able to compose the same plugin per epic workspace; this is the precondition for `[Shared Inbox]`.

## Slices, in dependency order

1. **[Factory Plugin] Move sandbox and snapshot authority** — `localDisposableProvider`, `remoteSnapshotProvider`, `warmSnapshot`, `snapshotRegistry`, `sandboxComposition` move to `plugins/boring-factory/src/server/sandbox/` with their tests; the playground imports them from the plugin's server entry. No behaviour change; the sweep scripts stay in the app.
2. **[Factory Plugin] Move seats and host tools** — `factoryFleet` (seat specs, epic-binding and precedence appendices, feature-name derivation), `delegatePlugin`, `supervisionPlugin`, `demoPlugin` move to `plugins/boring-factory/src/server/host/`; export one `createFactoryHost({ repositoryRoot, workspaceRoot, epicKey, featureName, stateRoot, env, provider })` returning `{ agents, plugins, bind(app), rearm(), close() }`. The playground's `app.ts` becomes that single call plus the meta route. Depends on 1.
3. **[Factory Plugin] Epic closure, right-sized** — land `close_epic` from PR #1518 inside the plugin at the smallest correct size: reuse `factory_status` for PR/git state, the snapshot registry's invalidate, the demo registry's stop and the supervision plugin's in-process stop; target roughly 150 lines plus tests that pin behaviour, not branches; no receipt type per outcome, one receipt. Then close PR #1518 as superseded. Depends on 2.
4. **[Factory Plugin] Hub composition proof** — the CLI hub (or full app) composes `createFactoryHost` for one registered workspace and runs the single-Bead acceptance script against it. Depends on 2.

## Rules for Workers on this epic

Pure moves first (git detects renames), behaviour changes in separate commits. Every moved module keeps its tests. The plugin README documents the host entry and its authority boundaries. Plan artifacts go under `.handoff/` (gitignored) except `show-me-plan.md`.

## Proof

`pnpm --filter @hachej/boring-factory build && test`, `pnpm --filter factory-playground typecheck && test`, `pnpm lint:invariants`, and the single-Bead live acceptance run against the playground composed from the plugin.

## Out of scope

Shared Inbox (next epic), merging, Vercel quota.
