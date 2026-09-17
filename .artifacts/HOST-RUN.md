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

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 10 files / 31 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm --dir packages/workspace exec vitest run src/server/__tests__/bootstrapServer.test.ts --no-file-parallelism`: **PASS**, 40 tests.
- Hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, including credential non-disclosure and failed-migration HTTP status/storage checks.
- `pnpm typecheck:changed`: **BLOCKED before typecheck by the existing `plugins/generated-pane` TS2883 declaration-build errors**.
- `pnpm test:changed`: **BLOCKED before tests by the same existing `plugins/generated-pane` TS2883 declaration-build errors**.
- `git diff --check` in both repositories: **PASS**.

## Owner ruling needed

- Dynamic published tools change model-visible composition between turns.
- The ratified architecture freezes composition and requires capability admission.
- The current app-runner seam therefore conflicts with that frozen ruling.
- Blocker 10 is explicitly outside this fix and has not been redesigned here.
- An owner ruling plus ratified-plan update, or an admitted static broker design, is required.

## Mandatory abstraction review

**BLOCKED** at `433ee0dda..e08d2690f` by the independent reviewer. Although dependency direction remains valid, the new per-turn dynamic native-tool and profile-prompt seam conflicts with the ratified architecture's frozen model-visible composition and capability-admission rules. Additional blockers: dynamic tool collision/ownership is not enforced, the public plugin lifecycle docs are stale, and real-harness boundary/collision/grant/session-identity tests are missing. This cannot receive an abstraction PASS without an explicit owner ruling plus ratified-plan update, or redesign around an admitted static broker/activation generation.
