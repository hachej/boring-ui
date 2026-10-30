# Packages

The npm side of the kit: Pi-based agent definitions and handlers, the workspace provider, execution adapters, headless UI controllers, feedback, and the CLI that installs and checks blocks.

## Sub-features

- `pkg-agent-action-context` optional lazy host context preparation on full-model fallback only; action extraction and automatic replies bypass it. `packages/agent/src/actions.ts`.
- `pkg-agent-actions` optional decision, structured extraction, native tool and result-derived reply, with native unavailable-model outcomes and deferred fallback polling/cancellation. `packages/agent/src/actions.ts`.

- `pkg-agent-define` `defineAgent`, tools, extensions, delegates. `packages/agent/src/agents.ts`.
- `pkg-agent-skills-unlisted` `skillInFolder` is public; `loadUnlisted(conversationId, name)` answers `load_skill` for a skill kept out of the listing. `packages/agent/src/skills.ts`.
- `pkg-agent-transport` chat transport and conversations handlers. `packages/agent/src/chat-transport.ts`, `conversations.ts`.
- `pkg-agent-capabilities` file guard, approvals, `ask_user`, `present`, schedules, sandbox. `packages/agent/src/file-guard.ts`, `approval.ts`, `ask-user.ts`, `artifacts.ts`, `schedule.ts`, `sandbox.ts`.
- `pkg-agent-context` request context and mention resolver. `packages/agent/src/prompt-context.ts`, `mentions.ts`.
- `pkg-agent-questions-delivery` optional native questions, validation and durable application-result delivery. `packages/agent/src/questions.ts`, `validation.ts`, `delivery.ts`.
- `pkg-agent-room-metering` shared-room entries, native usage metering and per-request context; host policy remains external. `packages/agent/src/room/`, `metering.ts`.
- `pkg-agent-runs` one-call runs: the result protocol (schema, validator, repair budget), the run ends and their delivery once, the outbox of starts, and the runner over a person's SQLite store. `packages/agent/src/run-result.ts`, `runs.ts`, `run-ledger.ts`, `run-outbox.ts`. Drive: `test/packages/agent-runs.test.mjs`.
- `pkg-files-workspace` one workspace provider, journal, SQLite, revision handler. `packages/files/src/workspace.ts`, `revision-handler.ts`.
- `pkg-execution` virtual bash and git, remote shell and files, AWS interpreter. `packages/execution/src/`.
- `pkg-ui-kit` headless controllers, editors and viewers, registry items under `r/`. `packages/ui/src/`.
- `pkg-ui-markdown-labels` Markdown editor English/French text and per-key `labels` overrides, including accessible names, proposal diff, preserved blocks and recovery controls; source textarea placeholders. `packages/ui/src/markdown-editor-labels.ts`, `markdown-editor.tsx`.
- `pkg-ui-voice-capture` public PCM capture progress, actual input level and pause/resume; paused frames never enter the WAV. `packages/ui/src/voice-capture.ts`.
- `pkg-ui-experiences` fixed and generated experience composition with typed cells and conditional keep/pin. `packages/ui/src/experience*`.
- `pkg-ui-remote-chat` authorized remote chat projections and client controller. `packages/ui/src/remote-chat.ts`, `packages/agent/src/projection.ts`.
- `pkg-browser-worker` opt-in browser worker transport, SQLite, model setup and unchanged native code mode. `packages/browser/src/`; package is private to this repository.
- `pkg-testing-tools` keyless scripted model and headless browser/network helpers. `packages/testing/src/`; test tooling only.
- `pkg-chat-react` opt-in view selectors, transcript windows/chunks, drafts, placement, remote and conversations hooks; per-selection adapter ownership preserves concrete APIs. `packages/ui/src/chat-react.ts`, `chat-react-*.ts`.
- `pkg-blocks-cli` `boring-ui-blocks add | update | check | manifest`. `packages/ui/bin/boring-ui-blocks.mjs`.
- `pkg-feedback` in-app feedback capture and delivery. `packages/feedback/src/`.

## How to get to it (user POV)

- A developer or an agent installs `@hachej/boring-*` packages and runs `npx boring-ui-blocks` in the app's web directory.

## Driving it with the repository checks

Preconditions: `npm ci`; run from the repository root.

- **All.** `npm run check` then `npm test` then `npm run verify`.
- **Lazy action context.** `pkg-agent-action-context`: `node --test test/packages/agent-actions.test.mjs` exercises skipped preparation, awaited fallback, and fail-closed preparation through the native harness.
- **Unlisted skills.** `pkg-agent-skills-unlisted`: `node --test test/packages/agent-skills-unlisted.test.mjs`.
- **Actions.** `pkg-agent-actions`: `node --test test/packages/agent-actions.test.mjs`; `npm run test:definitions-consumer -- --actions` repeats public behavior and strict types from packed output.
- **Agent.** `pkg-agent-define`, `pkg-agent-transport`, `pkg-agent-capabilities`, `pkg-agent-context`, `pkg-agent-questions-delivery`, `pkg-agent-room-metering`, `pkg-agent-runs`: `npm test`, files `test/packages/agent-*.test.mjs`; background task composition is driven by `npm run workspace-demo:journey` and the native question/delivery tests.
- **Files.** `pkg-files-workspace`: `npm test`, files `test/packages/files-*.test.mjs`.
- **Execution.** `pkg-execution`: `npm test`, files `test/packages/execution-*.test.mjs`.
- **UI kit.** `pkg-ui-kit`, `pkg-ui-experiences`, `pkg-ui-remote-chat`: `npm test`, files `test/packages/ui-*.test.mjs`; drive the experience flow with `npm run morning:journey` and remote chat with `npm run workspace-app:journey`.
- **Markdown localization.** `pkg-ui-markdown-labels`: mount `MarkdownEditor` with `locale="fr"`, edit/save and review a proposal; set `labels={{ saved: 'Conservé', sourceName: title => title }}` and switch to source to check the exact name and placeholder. Drive `node --test test/packages/ui-markdown-editor.test.mjs test/packages/ui-markdown-proposals.test.mjs`.
- **Voice capture.** `pkg-ui-voice-capture`: `node --test test/packages/feedback-voice.test.mjs` checks exact PCM samples, progress, pause/resume and honest fallback; `node examples/app-shell/journey-talk-about.mjs` drives the shared browser recording row.
- **Browser worker.** `pkg-browser-worker`: `npm run browser-agent:journey` (fictional model only; no live credentials).
- **Test utilities.** `pkg-testing-tools`: `npm run test:testing-consumer` for its installed public consumer.
- **Chat hooks.** `pkg-chat-react`: `node --test test/packages/ui-chat-react-hooks.test.mjs` exercises public hooks under StrictMode; `npm run test:pi-chat-consumer` and `npm run test:shared-chat-consumer` repeat packed public hooks and strict declarations.
- **CLI.** `pkg-blocks-cli`: `npm run test:app-registry-consumer` installs the blocks into a clean app and runs `boring-ui-blocks check`.
- **Feedback.** `pkg-feedback`: `npm test`, files `test/packages/feedback-*.test.mjs`.
- **Proof.** The command output and exit code.

## Gotchas

- Keep every `@hachej/boring-*` package on one version; Pi packages are peers at `~1.4.0`.
- The host owns the Harness, policy and credentials; kit packages never open a Harness.
- Change `ARCHITECTURE.json` before a new package or edge.

The opt-in kit `chat-react` entry also owns `useChatSession` (state/files/send/restore/queue/upload/paste/model-effort); the root stays free of files/Pi/agent imports. Drive `node --test test/packages/ui-chat-session.test.mjs` and `npm run test:pi-chat-consumer`; see [chat-session](chat.md).
