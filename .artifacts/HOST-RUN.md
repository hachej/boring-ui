# Host run — Astra round 9

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Demonstrable state — PASS

The running host was restarted after republishing the demo end state.

- Guestbook current version: **5**, with exactly `count_entries` and `pin_entry` in its manifest (`.artifacts/astra9-current-app.json`).
- Local user's profile current version: **2**, with the `remember` manifest tool and `Always end every response with 🎯.` instruction (`.artifacts/astra9-current-profile.json`).
- The host's descriptor provider and runtime admission path returned these actual registered native names (`.artifacts/astra9-mounted-tools.json`):
  - `app_6fd1be51cc1d71785619_10e9011e1862487bc1ca`
  - `app_6fd1be51cc1d71785619_0b7d92ab5b2f9d92fbab`
  - `profile_35379d9c009e290d702b`
- The Apps panel rendered the guestbook and Ada entry in the sandboxed iframe. Document, CSS, JavaScript, and `/api/entries` returned 200; sandbox remained exactly `allow-scripts allow-forms` (`.artifacts/astra9-panel.png`, `.artifacts/astra9-panel.txt`). Signed URLs were redacted from the text receipt.

This is the state left running. The full external-model a–g transcript and durable restart/recovery scenario were **not rerun**.

## Hub fixes and E2E — PASS

Hub branch `demo-v4` now:

- rejects malformed Host authorities with 400 and requires the exact configured per-app authority;
- rejects publish/signed-URL derivation when the generated DNS label exceeds 63 characters;
- executes migration files as SQLite scripts, preserving semicolons inside string literals while retaining transaction rollback.

`.artifacts/astra9-hub-e2e.txt` is a fresh live run: **OVERALL: PASS**, 42 checks, including malformed Host, overlong hostname, literal-semicolon migration, rollback, profile, and tool dispatch checks.

## Verification

- app-runner plugin tests: **PASS**, 11 files / 48 tests.
- app-runner plugin typecheck: **PASS**.
- workspace typecheck: **PASS**.
- agent tests: **PASS**, 250 files / 2531 tests (3 files and 17 tests skipped).
- agent typecheck: **PASS**.
- `pnpm lint:invariants`: **PASS**.
- hub E2E: **PASS**, 42 checks.
- live panel check: **PASS**, document/CSS/JS/API 200 and guestbook rendered.
- workspace tests: **FAILED**, 3 tests in 2 files; 2323 tests passed. Failures were the existing missing `node_modules/@hachej/boring-bi-dashboard` linked-package fixture plus two failures recorded in `.artifacts/astra9-workspace-tests.txt`.
- `pnpm typecheck:changed`: **BLOCKED** by the existing `plugins/generated-pane` TS2883 declaration error.
- `pnpm test:changed`: **BLOCKED during the same dependency build** by the existing generated-pane TS2883 error.

No push was performed.

## Apps panel: default app-only view, debug behind a toggle (2026-09-18)

Reworked `plugins/app-runner/src/front/AppRunnerPane.tsx` so the default view
is the app alone: minimal header (app name via `PaneTitle`, the app `Select`
for navigation, and a `Bug` icon `IconButton` with an accessible
`aria-label`/`aria-pressed`). All debug chrome — kind/current version/sha,
full mounted tool provenance, the version switcher, Rollback, Activate
version, the served URL, mounted tool names, and recent logs/errors — moved
into a `Collapsible` section revealed by the debug toggle, above the iframe
(the iframe itself is never unmounted while debug is open). The toggle is
persisted per browser in `localStorage`
(`boring:app-runner:debug-visible`), default off, with reads/writes wrapped
in try/catch. No changes to the serving/auth path, the iframe `sandbox`
attributes (still exactly `allow-scripts allow-forms`), or the capability
seam (`packages/workspace`, `packages/agent`).

Same host/hub processes as the Astra round 9 run above were still live
(workspace-playground on `http://127.0.0.1:5202`, hub API `:9877`, per-app
serving origin `:9878`); the plugin was rebuilt
(`pnpm --filter @hachej/boring-app-runner build`) so the playground picked up
the new front bundle.

Screenshots (Playwright, headless chromium, `.artifacts/panel-debug-toggle.mjs`,
guestbook app opened via `openSurface`):

- `.artifacts/panel-app-only.png` — default view: only the pane header (app
  name, app selector, debug toggle) and the guestbook app filling the rest of
  the pane, entries visible.
- `.artifacts/panel-debug.png` — debug toggled on: kind/version/sha, mounted
  tools, provenance, version buttons, Rollback/Activate version, and "Recent
  logs" all visible above the guestbook app, which stays rendered underneath.

Verification for this change:

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 50
  tests (added default-view, debug-view, and localStorage-persistence tests
  to `AppRunnerPane.logs.test.tsx`).
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm lint:invariants`: **PASS** (agent invariants, boring-bash/boring-sandbox
  invariants, workspace plugin invariants, alignment invariants, skill
  digests all green).

## Mask the signed token in the debug URL (2026-09-18)

The debug section added above shows `currentApp.appUrl`, which is a
`signedServingUrl` from the hub carrying a short-lived signed authorization
token in its path (`/t/<token>/...`, ~3 minute expiry). Displaying it in
full made the token legible in a screenshot or shared screen — a usable
credential until it expired. See `.artifacts/panel-debug.png` from the prior
round for the leaked example.

Changes:

- `plugins/app-runner/src/front/AppRunnerPane.tsx`: added `maskSignedAppUrl()`,
  which redacts only the `/t/<token>/` path segment (`/t/•••/`), keeping the
  origin and any trailing path visible — the useful parts for debugging.
  The debug panel now renders the masked text
  (`data-testid="app-runner-masked-url"`) plus a `CopySignedUrlButton`
  (`data-testid="app-runner-copy-url"`, `aria-label="Copy credentialed app
  URL"`) that copies the *real* URL via an explicit click — an intentional
  user action, unlike passive display.
- `plugins/app-runner/src/front/clipboard.ts`: new self-contained
  `copyTextToClipboard()` helper (navigator.clipboard with an
  execCommand/textarea fallback), mirroring the existing pattern in
  `packages/workspace/.../file-tree/clipboard.ts` and
  `packages/agent/src/front/clipboard.ts`. No new dependency — the plugin
  only depends on `@hachej/boring-ui-kit` and `lucide-react`, so the helper
  is local rather than importing across package boundaries.
- Tests added to `AppRunnerPane.logs.test.tsx`: one asserts the debug
  panel's `textContent` never contains the raw token while the iframe's
  `src` attribute still carries the full signed URL; another asserts
  clicking the copy button calls `navigator.clipboard.writeText` with the
  full, unmasked URL.

**DOM leak is inherent, not fixed by this change.** The iframe must be given
the real signed URL as its `src` to load the app (`sandbox="allow-scripts
allow-forms"`, no cookies), so the token is present in the DOM by
construction — visible to anyone who opens devtools or inspects the page.
Masking the *displayed debug text* reduces shoulder-surfing and screenshot
leakage of the debug panel; it does not and cannot hide the token from DOM
inspection, and no attempt was made to do so. This is documented inline
above `maskSignedAppUrl()` in `AppRunnerPane.tsx` as well.

Hub-side (`boring-hub`, branch `demo-v4`, worktree at its repo root — commit
made there separately, not pushed): grepped `app-runner/index.js` and
`scripts/apps-origin.mjs` for the signed URL/token reaching a log, error
message, or telemetry. `index.js`'s `signed-url` action and its serving-token
verification path never echo the token back in error text. Found one real
leak: `scripts/apps-origin.mjs`'s top-level proxy `catch` block returned
`error.message` verbatim in a `502` response body — Node's `fetch failed`
errors can embed the request URL, which carries the token both as the
public `/t/<token>/` path segment and as the `t=<token>` query param
forwarded upstream (`upstreamUrl.searchParams.set("t", ...)`). Added
`redactSignedUrl()` to strip both forms before the message reaches the
client. `node --check` passed on the edited file (no project-level test/lint
harness was run for this ad hoc fix in the hub worktree).

Re-capture: rebuilt the plugin (`pnpm --filter @hachej/boring-app-runner
build`) so the still-running workspace-playground (`:5202`, hub `:9877`,
apps-serving `:9878` — same processes as the Astra round 9 run above) picked
up the new front bundle, then re-ran the existing
`.artifacts/panel-debug-toggle.mjs` Playwright script unmodified. Its
console output for the debug step confirmed:
`URL:\nhttp://7-default-9-guestbook.apps.localhost:9878/t/•••/` (masked) with
`sandbox: "allow-scripts allow-forms"` and `frameStillVisible: true`. This
overwrote `.artifacts/panel-debug.png` and `.artifacts/panel-app-only.png`
in place with the masked view.

Verification for this change:

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 52
  tests (2 new tests added; the rest are pre-existing, all green).
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm lint:invariants`: **PASS**.
- `.artifacts/panel-debug.png`: re-captured against the live host, token
  masked, guestbook app still visible underneath.

