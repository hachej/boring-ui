# C1 — Wrapper Shell + Login Gate TODO

### C1-001 — Create the Wrapper Soft Fork + Upstream Discipline — S

- **Goal:** A Boring wrapper repo exists as a patch-overlay soft fork of `tmustier/pi-for-excel` with fork discipline documented.
- **Files to touch/create:**
  - new wrapper repo (name decided in this bead; record it in this pack's `INDEX.md` and `PR-PLAN.md` when chosen)
  - `docs/upstream-divergences.md` (in the wrapper repo)
  - `README.md` fork-discipline section (in the wrapper repo)
- **Steps:**
  1. Fork/clone `tmustier/pi-for-excel`; keep `upstream` as a tracked remote.
  2. Document the merge cadence: merge upstream at the start of every C-lane PR.
  3. Create `docs/upstream-divergences.md` and record the rule: every sustained non-wrapper divergence is listed here.
  4. Document the drift-tracking rule: PR descriptions track upstream line drift for `src/taskpane/init.ts`, `src/compat/model-selector-patch.ts`, and `src/prompt/system-prompt.ts`.
- **VERIFICATION:**
  - `git remote -v` — shows the tracked upstream remote.
  - `git merge upstream/main` on a fresh branch — merges without broad conflict.
- **Acceptance criteria:**
  - Repo name decided and recorded.
  - Upstream remote tracked; merge cadence and divergence log documented.
- **Estimated size:** S.

### C1-002 — Wrapper Config Shell `src/wrapper/**` — M

- **Goal:** Replace demo-specific defaults with a product wrapper config shell; no behavior change beyond reading existing demo constants from config.
- **Files to touch/create:**
  - `src/wrapper/boring/extension-defaults.ts` (generalized from `src/extensions/boring-demo-default.ts:15-128`)
  - `src/wrapper/config.ts` (hub endpoints, display name, connection ids)
  - `src/taskpane/init.ts` (import/wiring seam only)
- **Steps:**
  1. Move/rename `src/extensions/boring-demo-default.ts` into `src/wrapper/boring/extension-defaults.ts`.
  2. Keep extension id `builtin.boring`; load `hubBaseUrl`, display name, and connection ids from wrapper config instead of baked constants.
  3. Keep `trust: "builtin"` and HOST runtime; grant only `tools.register`, `connections.readwrite`, `connections.secrets.read`, `http.fetch` (`src/extensions/permissions.ts:16-36`, `src/extensions/permissions.ts:146-166`).
  4. Keep pi-for-excel source edits as import/wiring seams only; all product config stays in `src/wrapper/**`.
- **VERIFICATION:**
  - `npm run check` — exits 0.
  - `npm test` (or the repo's default test script) — extension-defaults tests pass.
- **Acceptance criteria:**
  - `builtin.boring` loads before the first runtime and its tools are available on first prompt (demo behavior preserved).
  - No product constant remains outside `src/wrapper/**` except the wiring seams.
- **Estimated size:** M.

### C1-003 — Login Gate Module `src/wrapper/boring-auth.ts` — M

- **Goal:** Block the agent UI until the user authenticates with the Boring hub.
- **Files to touch/create:**
  - `src/wrapper/boring-auth.ts`
  - `src/taskpane/init.ts` (gate call after `initAppStorage()` at `src/taskpane/init.ts:225-229`; move `ConnectionManager` construction earlier from `src/taskpane/init.ts:793-811` if the gate needs it)
  - `src/wrapper/__tests__/boring-auth.test.ts`
- **Steps:**
  1. Store non-secret session metadata in `SettingsStore` under `boring.auth.v1` (user id/email/display, workspace id, token expiry, hub base URL).
  2. Store the bearer token only in the Boring connection secrets via `ConnectionManager.setSecrets()` (`src/connections/manager.ts:543-578`).
  3. Call `await ensureBoringAuthenticated(...)` after `initAppStorage()` and before provider restore/model setup; do not call `createRuntime()` until auth succeeds (`src/taskpane/init.ts:1931-1935`).
  4. Render the gate before `PiSidebar` mounts using existing overlay/dialog primitives (`src/ui/overlay-dialog.ts`).
  5. Offer login, workspace selection when the hub returns multiple workspaces, retry, and logout/reset.
  6. Consume the A1 login response contract `{baseUrl, workspaceId, token, expiresAt, user}`; do not invent a second token format.
- **VERIFICATION:**
  - `npm test -- boring-auth` — startup-with-valid-token, missing-token, and expired-token cases pass.
  - `npm run check` — exits 0.
- **Acceptance criteria:**
  - No agent runtime, model credential restore, or provider prompt runs before Boring login succeeds.
  - Gate metadata lives in `boring.auth.v1`; the token never lands in `SettingsStore`.
- **Estimated size:** M.

### C1-004 — Token Wiring + Delete the Baked Demo Bearer Token — M

- **Goal:** Login provisions the connector connection secrets; the baked demo token path is gone.
- **Files to touch/create:**
  - `src/wrapper/boring-auth.ts`
  - `src/wrapper/boring/extension-defaults.ts` (delete the baked token path formerly at `src/extensions/boring-demo-default.ts:20-23`)
  - `src/wrapper/__tests__/token-wiring.test.ts`
- **Steps:**
  1. On login, write `{baseUrl, token, workspaceId}` into the `builtin.boring` connection secrets once the extension has registered the connection (`boring-connector.live.mjs:424-451`).
  2. On startup, if metadata expiry is past or the hub rejects the token, clear secrets and show the gate.
  3. On connector 401/403 (connection marked error, `boring-connector.live.mjs:198-206`), surface re-auth instead of telling the user to paste a token.
  4. Delete the baked demo bearer token path; grep source and `dist/` to prove no token or demo workspace id remains.
- **VERIFICATION:**
  - `npm test -- token-wiring` — valid/expired/rejected token and 401/403 recovery cases pass.
  - `npm run build && ! grep -r "<demo-token-prefix>" dist/` — no baked token in built assets.
- **Acceptance criteria:**
  - Login writes per-user, per-workspace connection secrets.
  - No baked token remains in source or dist.
  - Expired/revoked/wrong-workspace token produces a re-auth gate.
- **Estimated size:** M.

### C1-005 — Logout + Revocation — S

- **Goal:** Logout clears token material and blocks the agent until re-login.
- **Files to touch/create:**
  - `src/wrapper/boring-auth.ts`
  - `src/wrapper/__tests__/logout.test.ts`
- **Steps:**
  1. Revoke the token server-side where A1 token CRUD is available to the browser session.
  2. Clear `boring.auth.v1`, the Boring connection secrets (`ConnectionManager.clearSecrets()`, `src/connections/manager.ts:580-603`), and any Boring gateway custom-provider key.
  3. Stop creating new runtimes until login succeeds again.
- **VERIFICATION:**
  - `npm test -- logout` — logout clears metadata + secrets and blocks runtime creation.
- **Acceptance criteria:**
  - Logout clears all token material; the agent is blocked until re-login.
- **Estimated size:** S.
