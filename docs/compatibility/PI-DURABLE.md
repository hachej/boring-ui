# Which kit release needs which pi-durable

The kit's packages are written against one pi-durable line at a time. Pi packages are peers: the app installs them, the kit does not bring them.

| Kit release | pi-durable, pi-ai, chord | Also needs |
|---|---|---|
| 0.4.x, up to 0.4.85 | 1.4 (`~1.4.0`) | `typebox` 1.3.27 for `@hachej/boring-agent/run-result` and `/actions` |
| 0.5.0 up to 0.5.24 | 1.5.2 (`~1.5.2`) | `@earendil-works/pi-schema` `~1.5.2` for `@hachej/boring-agent` (and, optionally, `@hachej/boring-feedback`) |
| the release after 0.5.24 | 1.6.0 (`~1.6.0`) | `@earendil-works/pi-schema` `~1.6.0` for `@hachej/boring-agent` (and, optionally, `@hachej/boring-feedback`) |

## Rules

- **One release for every kit package.** `@hachej/boring-agent`, `-ui-kit`, `-files`, `-execution`, `-feedback`, `-browser` and `-testing` move together. A new agent package must ship with the ui-kit of the same release: the chat wire (`CHAT_TRANSPORT.version`, unchanged by the 1.5 move) is state, a view and then operation batches, and the client replays them with chord's `delta`, which must come from the same line as the host that sent them.
- **A pi-durable minor is a reviewed change** to `ARCHITECTURE.json` (`upstreamExportsVersion`, the exports the kit imports) first, then the manifests.
- **A store written by 1.4.0 opens on 1.6.0** with the same messages (`test/packages/agent-store-1.4.test.mjs`, fixture `test/fixtures/store-1.4.0.json`, fictional, dumped from a database 1.4.0 wrote). Going back is not supported: a store written by 1.5 is not meant to be opened by 1.4.

## What an app changes to take 0.5.0

Expected: the versions (the kit's packages `^0.5.0`; pi-durable, pi-ai and chord `~1.6.0`; add `@earendil-works/pi-schema` `~1.6.0` where `@hachej/boring-agent` is used; drop `typebox` if only the kit needed it). Code of its own written against what 1.5 removed changes too; `MIGRATING.md` ("Migrating to 0.5.0") lists each shape: `Type` from pi-ai, `Context` and `JsonValue` from chord's subpaths, one-argument watch listeners and tagged watch ends, `observeCommits`, tagged file-watch changes, windowed `ConversationView.entries`.

## Native in 1.6.0: what the kit no longer builds

Pi 1.6.0 parks a tool call or a task (`{ sleep: { until?, signals? } }`, `defineSignal`, `tx.signal`) and wakes it when a deadline comes or a value is delivered. The kit used to hold such waits in a running invocation that watched a conversation document and set its own timer. That machinery is deleted (`packages/agent/src/durable-wait.ts` and `wait-until.ts`):

| Wait | Before | Now |
|---|---|---|
| `ask_user`, `requireApproval`, browser tasks, `present` with `ack` | the call watched its document inside `execute` | `execute` returns a park on `CallSettled`; the answer functions settle the document and deliver the signal in the same commit; `cancel` marks the document cancelled |
| `present` deadline | a timer next to the watch | the park's `until` |
| Schedules | a phase with its own timer and a document watch | a native `sleeping` state with `until` and a cancel signal |
| Native questions (`createQuestions`) | a phase watching the question document and racing an expiry timer | a native `sleeping` state with `until` its expiry and a settle signal |

What stays, and why: the per-call conversation documents (`boring.ask-user.question`, `boring.browser-task`, `boring.view-open`, `boring.questions.record`, `boring.schedules`) hold the question, its options and the person's answer, which a signal value is not meant to carry past the wake and which stores written before 1.6.0 already hold. `call-binding.ts` keeps the answer id (`[assistantEntryId, callId]`): Pi has no such binding. A store written by the previous code with these waits pending opens and settles (`test/packages/agent-pending-waits-legacy.test.mjs`, fixture `test/fixtures/store-pending-waits.json`): the first run of the reopened call or task reads the same document and parks it.

## Known breaks outside the kit

- chord 1.5.2 declared the optional peer `react@19.3.0` exactly, which made npm refuse react 19.3.1 (ERESOLVE). chord 1.6.0 widens it to `^19.3.0`: no override is needed any more, and the kit's root and consumer scripts no longer set one. An app on chord 1.5.x keeps its `"overrides": { "@earendil-works/chord": { "react": "$react" } }`.
- chord 1.5.2's (not re-checked on 1.6.0) own declarations (`dist/contracts/evolve.d.ts`, reached through pi-durable's types) do not compile under `exactOptionalPropertyTypes` with `skipLibCheck: false`. An app with both options set hits the errors with pi-durable 1.5.2 alone. The kit's isolated consumer scripts (`scripts/test-*-consumer.mjs`) therefore set `skipLibCheck: true`: they still check the consumer's own code, the kit's exports and which declaration files load, but no longer every `.d.ts`. Restore `skipLibCheck: false` once chord fixes its declarations.
- The Cloudflare `agents` package needs 0.33.0 for pi 1.5 (0.32.0 imports `Type` and `watchEvents`).
