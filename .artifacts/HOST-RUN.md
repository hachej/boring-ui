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

## Screenshot

Playwright was available. Screenshot: `apps-panel.png`. It captures the live host after restart with published native tool calls, profile behavior, and the app-runner surface command in the transcript.

## Verification summaries

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 4 files / 10 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm --dir packages/workspace exec vitest run src/server/__tests__/bootstrapServer.test.ts --no-file-parallelism`: **PASS**, 40 tests.
- Workspace full test attempt: **2323 passed, 11 skipped, 2 unrelated failures** (missing pnpm-linked `@hachej/boring-bi-dashboard`; an async chat-loading timing test). See console run; neither failure touches this change.
- Playground `dev` full dependency build: **BLOCKED by pre-existing `@hachej/boring-core` Fastify declaration incompatibilities**. Required affected packages were built individually and `dev:app` completed; the live run above used that real server.
- `pnpm typecheck`: **BLOCKED by unrelated existing `plugins/generated-pane` TS2883 portable declaration errors**; full output saved in `typecheck.log`.

## Mandatory abstraction review

**BLOCKED** at `433ee0dda..e08d2690f` by the independent reviewer. Although dependency direction remains valid, the new per-turn dynamic native-tool and profile-prompt seam conflicts with the ratified architecture's frozen model-visible composition and capability-admission rules. Additional blockers: dynamic tool collision/ownership is not enforced, the public plugin lifecycle docs are stale, and real-harness boundary/collision/grant/session-identity tests are missing. This cannot receive an abstraction PASS without an explicit owner ruling plus ratified-plan update, or redesign around an admitted static broker/activation generation.
