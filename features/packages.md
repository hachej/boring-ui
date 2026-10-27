# Packages

The npm side of the kit: Pi-based agent definitions and handlers, the workspace provider, execution adapters, headless UI controllers, feedback, and the CLI that installs and checks blocks.

## Sub-features

- `pkg-agent-define` `defineAgent`, tools, extensions, delegates. `packages/agent/src/agents.ts`.
- `pkg-agent-transport` chat transport and conversations handlers. `packages/agent/src/chat-transport.ts`, `conversations.ts`.
- `pkg-agent-capabilities` file guard, approvals, `ask_user`, `present`, schedules, sandbox. `packages/agent/src/file-guard.ts`, `approval.ts`, `ask-user.ts`, `artifacts.ts`, `schedule.ts`, `sandbox.ts`.
- `pkg-agent-context` request context and mention resolver. `packages/agent/src/prompt-context.ts`, `mentions.ts`.
- `pkg-files-workspace` one workspace provider, journal, SQLite, revision handler. `packages/files/src/workspace.ts`, `revision-handler.ts`.
- `pkg-execution` virtual bash and git, remote shell and files, AWS interpreter. `packages/execution/src/`.
- `pkg-ui-kit` headless controllers, editors and viewers, registry items under `r/`. `packages/ui/src/`.
- `pkg-chat-react` opt-in view selectors, transcript windows/chunks, drafts, placement, remote and conversations hooks; per-selection adapter ownership preserves concrete APIs. `packages/ui/src/chat-react.ts`, `chat-react-*.ts`.
- `pkg-blocks-cli` `boring-ui-blocks add | update | check | manifest`. `packages/ui/bin/boring-ui-blocks.mjs`.
- `pkg-feedback` in-app feedback capture and delivery. `packages/feedback/src/`.

## How to get to it (user POV)

- A developer or an agent installs `@hachej/boring-*` packages and runs `npx boring-ui-blocks` in the app's web directory.

## Driving it with the repository checks

Preconditions: `npm ci`; run from the repository root.

- **All.** `npm run check` then `npm test` then `npm run verify`.
- **Agent.** `pkg-agent-define`, `pkg-agent-transport`, `pkg-agent-capabilities`, `pkg-agent-context`: `npm test`, files `test/packages/agent-*.test.mjs`.
- **Files.** `pkg-files-workspace`: `npm test`, files `test/packages/files-*.test.mjs`.
- **Execution.** `pkg-execution`: `npm test`, files `test/packages/execution-*.test.mjs`.
- **UI kit.** `pkg-ui-kit`: `npm test`, files `test/packages/ui-*.test.mjs`.
- **Chat hooks.** `pkg-chat-react`: `node --test test/packages/ui-chat-react-hooks.test.mjs` exercises public hooks under StrictMode; `npm run test:pi-chat-consumer` and `npm run test:shared-chat-consumer` repeat packed public hooks and strict declarations.
- **CLI.** `pkg-blocks-cli`: `npm run test:app-registry-consumer` installs the blocks into a clean app and runs `boring-ui-blocks check`.
- **Feedback.** `pkg-feedback`: `npm test`, files `test/packages/feedback-*.test.mjs`.
- **Proof.** The command output and exit code.

## Gotchas

- Keep every `@hachej/boring-*` package on one version; Pi packages are peers at `~1.2.0`.
- The host owns the Harness, policy and credentials; kit packages never open a Harness.
- Change `ARCHITECTURE.json` before a new package or edge.
