# C1 — Wrapper Shell + Login Gate Plan

## Today / Delta

Today, the demo build of `pi-for-excel` proves the minimum path but is not a product: the demo entry is hardcoded to one hub/workspace/token (`src/extensions/boring-demo-default.ts:15-23`), `initTaskpane()` restores model credentials and may show the provider login overlay with no Boring auth (`src/taskpane/init.ts:325-362`), runtime creation happens with no gate (`src/taskpane/init.ts:926-1048`, `src/taskpane/init.ts:1931-1935`), and the demo seeds a fixed Boring connection after extension initialization (`src/taskpane/init.ts:861-878`).

Delta: stand up the Boring wrapper soft fork (issue #551 phases 2–3). All product code lives in `src/wrapper/**`; a login gate blocks the agent UI and runtime creation until the user authenticates with the Boring hub; the authenticated identity selects the workspace and provisions the connector connection secrets; the baked demo bearer token path is deleted.

## Scope Fence

Reuse #526/#528 A1 workspace-scoped tokens — do **not** redesign boring-ui external auth and do not invent a second bearer-token format. The browser-session login endpoint that lists workspaces and issues a workspace token is an A1 (amended) deliverable in `hachej/boring-ui`; C1 consumes its response contract `{baseUrl, workspaceId, token, expiresAt, user}`.

## Deliverables

- The wrapper soft fork repo (name decided in C1-001) with `tmustier/pi-for-excel` as a tracked upstream remote, upstream-merge cadence documented, and `docs/upstream-divergences.md` created.
- `src/wrapper/**` config shell: branding-free product config for `hubBaseUrl`, display name, and connection ids; `src/extensions/boring-demo-default.ts` generalized into `src/wrapper/boring/extension-defaults.ts` keeping extension id `builtin.boring`.
- `src/wrapper/boring-auth.ts` login gate: non-secret session metadata in `SettingsStore` under `boring.auth.v1`; bearer token only in the Boring connection secrets via `ConnectionManager.setSecrets()`; gate injected after `initAppStorage()` and before provider restore/model setup; no `createRuntime()` until auth succeeds.
- Token wiring: login writes `{baseUrl, token, workspaceId}` into `builtin.boring` connection secrets; expired/revoked/wrong-workspace tokens produce a re-auth gate; connector 401/403 surfaces re-auth instead of a chat request for secrets.
- The baked demo bearer token path (`src/extensions/boring-demo-default.ts:20-23`) is deleted.
- Logout: revoke server-side where A1 token CRUD allows, clear `boring.auth.v1` + connection secrets + any Boring gateway key, block new runtimes until re-login.

## Smallest Robust Change

Inject the gate immediately after storage init: call `await ensureBoringAuthenticated({ settings, connectionManager })` after `initAppStorage()` (`src/taskpane/init.ts:225-229`) and before provider restore. If the gate needs `ConnectionManager`, move its construction earlier from `src/taskpane/init.ts:793-811` without creating runtimes. Render the gate into `#app`/`#error-root` before `PiSidebar` mounts, using the existing overlay/dialog primitives (`src/ui/overlay-dialog.ts`). Offer login, workspace selection when the hub returns multiple workspaces, retry, and logout/reset.

## Exit Criteria

- No agent runtime, model credential restore, provider prompt, or Boring tool call can run before Boring login succeeds.
- Login writes per-user, per-workspace connection secrets; no baked token remains in source or dist.
- Logout clears token material and blocks the agent until re-login.
- Expired/revoked/wrong-workspace token produces a re-auth gate, not a chat request for secrets.
- Tests cover startup with valid token, missing token, expired token, logout, and connector 401/403 recovery.
