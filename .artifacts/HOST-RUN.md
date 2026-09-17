# Host run — demo-v4 hub

Date: 2026-09-17

Host: `apps/workspace-playground` (`http://127.0.0.1:5210`, UI on the available Vite port)
Hub: `http://127.0.0.1:9877`
Workspace: `default`
Model: `openai-codex/gpt-5.6-sol`

Secrets were sourced from the hub's gitignored `.dev.vars`; no secret value is recorded here.

## a. Guestbook from the kit — PASS

The hub kit was copied into the playground workspace at `apps/guestbook`. The real Agent chat was asked to customize, build, and publish it. Transcript: `chat-step-a2.json`.

Agent summary:

> Published Guestbook v1 successfully. Persistent entries backed by env.db; responsive entry form and newest-first list; count_entries tool registered; migration included.

Three authenticated app requests returned entries with IDs 1, 2, and 3. Exact responses: `curl-step-a.txt`.

## b. Native count tool — PASS

Prompt: `Use the guestbook's count tool.`

Native call recorded in `chat-step-b.json`:

```text
app_guestbook_count_entries -> {"count":3}
```

The call's result can only come from `POST /w/default/guestbook/tools/count_entries`; the host tool is a one-request remote adapter. The hub's `celld.log` does not emit access lines (and the API explicitly says app console capture is unavailable), so there is no separate hub access-log line to quote. The native tool-call transcript and returned hub JSON are the execution evidence.

## c. Migration and pin tool — PASS

Prompt: add a `pinned` migration and `pin_entry`, then publish. Transcript/result: `chat-step-c-result.json`.

`curl-step-c.txt` proves current version 2, the manifest contains both tools, and all three rows survived activation. Next turn (`chat-step-c-pin.json`) called:

```text
app_guestbook_pin_entry {"entry_id":1} -> {"pinned":true,"entry":{"id":1,"pinned":1}}
```

## d. Undo — PASS

Prompt: `Undo the guestbook publish.` Transcript: `chat-step-d.json`.

`curl-step-d.txt` proves version 1 is current, its manifest contains only `count_entries`, and all three rows remain.

## e. Profile — PASS

The real chat created and published `profile/instructions.md`, `profile/index.js`, `profile/tools.json`, and `profile/data/migrations/0001_create_notes.sql`. Transcript: `chat-step-e.json`.

Next unrelated turn (`chat-step-e-unrelated.json`) returned:

```text
2 + 2 = 4. 🎯
```

Then `chat-step-e-remember.json` records native `profile_remember`, returning persisted note ID 1.

## f. Filesystem is dev, publish is truth — PASS

The Agent edited draft `apps/guestbook/tools.json` without publishing (`chat-step-f-edit.json`). `fake-before.txt` is empty and the next chat explicitly reported the tool unavailable (`chat-step-f-check.json`).

After publish (`chat-step-f-publish.json`), the next turn mounted and invoked `app_guestbook_fake_tool` (`chat-step-f-use.json`). Its intentionally nonexistent route returned hub 404, which proves the newly published manifest tool was mounted while the unpublished draft was not.

## g. Restart persistence — PASS

Stopped and restarted both hub and workspace playground without clearing state. `curl-step-g.txt` proves the published profile and guestbook rows remained. The original session then called `profile_remember` and stored note ID 2, followed by:

```text
Hello! 🎯
```

Transcript: `chat-step-g.json`.

## Astra evidence rerun — PASS

After the fixes, both processes were stopped and restarted without clearing durable state. `restart-receipts.txt` records the old host process IDs, the new hub PID, and the two host startup/ready timestamps. The real Agent session remained usable after the second host restart.

For the rollback inventory proof, version 5 added one temporary published manifest tool. `fix-inventory-v5b.json` captures the four tools advertised before rollback, including:

```text
app_6775657374626f6f6b_61737472615f74656d70
```

`fix-rollback-v4.json` captures the native `rollback_app` call. On the next turn, `fix-inventory-v4.json` captures only the three version-4 tools; the temporary tool is absent. This is the actual before/after inventory, not an assistant inference from draft files.

The first rerun exposed duplicate legacy JSON-store keys that prevented a newly published tool from refreshing. Commit `b7a9c57` normalizes those keys, keeps the newest record, and adds a regression test. The successful inventory above was captured after rebuilding and restarting with that fix.

## Screenshot

Playwright opened the `app-runner` surface through the UI bridge and captured the actual Apps panel in `.artifacts/apps-panel.png`. The image shows guestbook current at v4, versions v1–v5, rollback/activate controls, SHA metadata, iframe area, and recent logs.

## Verification summaries

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 46 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm --dir packages/workspace exec vitest run src/server/__tests__/bootstrapServer.test.ts --no-file-parallelism`: **PASS**, 40 tests.
- Hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS** after the final fixes, including credential non-disclosure and failed-migration HTTP status/storage checks.
- `pnpm typecheck:changed`: **BLOCKED before typecheck by the existing `plugins/generated-pane` TS2883 declaration-build errors**.
- `pnpm test:changed`: **BLOCKED before tests by the same existing `plugins/generated-pane` TS2883 declaration-build errors**.
- `git diff --check` in both repositories: **PASS**.

## Round 2 fixes

- **B1 redirect credential boundary:** focused fixture test starts a 302 server and a separate collector; the serving client returns the 302 without contacting the collector. PASS.
- **B3 profile isolation:** route and tool-provider regressions cover the decoded `..%2fprofile-<victim>` traversal, a victim profile disguised as `kind: "app"`, and execution under a different acting user. After rebuilding/restarting the live host, the traversal probe returned `403 {"error":"forbidden","message":"serving path escapes the authorized app"}`. The standalone local host exposes only its fixed local principal, so a second real authenticated browser user was unavailable; the two-user identity boundary was exercised in the server regression rather than overstated as a live auth run.
- **B4 version-bound execution:** hub e2e published v1, activated v2, rejected a v1-pinned call with HTTP 409 `version_mismatch`, then successfully dispatched a v2-pinned call. The host race regression verifies the stale call is retryable and refreshes the stored current version. PASS.
- **B5 rebuild publication:** the Git regression publishes an old hashed asset, removes it, adds a replacement, republishes, and reads the reported commit; the old asset is absent and the new payload matches. PASS. This exact filesystem/Git boundary is local to the host and was exercised against real Git rather than a mock.

Verification summary:

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 51 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- Hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 38 checks, including the activate-between-advertise-and-call race.
- `git diff --check` in both repositories: **PASS**.

## Owner rulings (2026-09-17)

1. App HTML is served from a distinct origin. The authenticated API remains on `:9877`; development app serving is a credential-stripping listener on `:9878`. The host mints three-minute HMAC-signed current/preview URLs and no longer exposes `/open/*` or `/preview/*` HTML proxies. The hub derives `x-app-user` only from the signed claims. Production uses `*.apps.<domain>`, one origin per app, with a wildcard certificate and Caddy in front while the API stays on a separate host.
2. Published, versioned capabilities executed in isolated cells may change model-visible composition. The trusted in-process tier remains frozen. Every mounted published tool is version-bound and carries/logs kind, address, version, and SHA; missing provenance prevents mounting. The Apps panel exposes the provenance. The ruling is ratified in `docs/plans/long-term/ratified/AMENDMENT-2026-09-17-untrusted-composition.md` and follows boring-hub `docs/PLATFORM.md` for the runner boundary.

## Mandatory abstraction review

**OWNER-RATIFIED.** The isolated published-tool seam is now the narrow exemption documented by the 2026-09-17 amendment. Trusted in-process composition and capability admission are unchanged. The implementation enforces immutable provenance, per-version dispatch, platform namespacing, workspace/profile ownership at discovery and execution, and cell-only execution. App HTML also moved off the host origin behind signed short-lived URLs. Remaining general hardening notes from earlier reviews are not grounds to reopen the settled composition ruling.

## Round 3 owner-ruling implementation

- Hub app-runner E2E: **OVERALL: PASS**, 38 checks. This reran publish, current native tool, migration/version activation, failed activation, rollback, profile publication/tool execution, persistence, usage, and logs against the restarted API/app-origin pair.
- Signed-origin probes: **PASS**. Headerless browser navigation returned 200; app code saw user A from the token while attempted user-B/workspace/header overrides were absent; an expired correctly signed token returned 403; and a direct app page's cross-origin fetch of the host Apps API failed with browser `TypeError`.
- Version preview: **PASS**, signed v1 preview returned 200 `text/html` rather than falling through to current.
- Host-origin HTML routes: regression proves both old `/open/*` and `/preview/*` routes return 404.
- Live host restarted with the rebuilt plugin; the Apps panel loaded signed `:9878` URLs and displayed immutable tool provenance. Screenshot retaken at `.artifacts/apps-panel.png`.
- Existing durable guestbook/profile state and the earlier a–g artifacts remained intact across the hub and host restart. The hub E2E repeated the same publish/tool/migrate/rollback/profile/publish-truth/persistence capabilities with a fresh app; no claim is made that the earlier model transcripts were regenerated.

Final summary lines:

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 47 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- Hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 38 checks.
- Signed-origin Astra probes: **PASS**, headerless 200; identity derived from token; expired 403; host API unreadable cross-origin.
- Signed version preview probe: **PASS**, 200.
