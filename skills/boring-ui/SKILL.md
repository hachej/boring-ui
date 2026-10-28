---
name: boring-ui
description: Entry point for building with Boring UI (the @hachej/boring-* npm packages and shadcn registry blocks for apps with an AI agent inside, on the Pi agent harness). Use when a task mentions boring-ui, @hachej/boring-ui-kit, @hachej/boring-agent, @hachej/boring-files, boring-ui-blocks, PiChat, AgentWorkspace, AmbientChat, AppShell, or asks to "add an agent/assistant/chat to my app", "build an app with an agent inside", or "use the Boring kit". Explains the packages, the rules every change must follow, and which boring-ui skill to load next.
---

# Boring UI

Boring UI is a kit for putting an AI agent inside an app. It has two halves:

- **npm packages** for the server and headless browser code.
- **shadcn registry blocks** (React source copied into the app) for the UI.

The agent runs on Pi (`@earendil-works/pi-durable`). The app's server opens Pi's `Harness`; the kit adds agent definitions, tools and HTTP handlers around it.

## Pick the next skill

| The task | Load |
| --- | --- |
| Create an app with an agent, or add an agent to an existing React/Node app | `build-agent-app` |
| Lay out the app (AppShell layouts, navigation, list and detail), place the agent (shell layer, full page, embedded, ambient), customise the chat (labels, conversations, mentions, cards) | `app-layout-and-agent` |
| Install, update, restyle or check UI blocks | `add-blocks` |
| Give the agent tools, file access, approvals, questions, sub-agents or schedules | `agent-capabilities` |

## Packages

Keep all `@hachej/boring-*` packages on the same version. Pi packages are peers pinned to `~1.4.0`.

| Package | Use it for |
| --- | --- |
| `@hachej/boring-ui-kit` | Headless controllers, editors and viewers; the registry items under `r/`; the `boring-ui-blocks` command |
| `@hachej/boring-agent` | `defineAgent` (`/agents`), chat transport (`/chat-transport`), conversations (`/conversations`), `present` (`/artifacts`), file guard (`/file-guard`), approvals (`/approval`), questions (`/ask-user`), schedules (`/schedule`), memory (`/memory/optchat`) |
| `@hachej/boring-files` | The workspace provider (`/workspace`), its journal (`/journal`, `/sqlite`), the browser revision provider (`/revision`) and its handler (`/revision-handler`), Node HTTP glue (`/node-http`) |
| `@hachej/boring-execution` | Virtual Bash and Git (`/virtual`, `/virtual-git`), remote shell and file system adapters |
| `@hachej/boring-feedback` | In-app feedback capture and delivery |
| `@earendil-works/pi-durable`, `pi-ai`, `chord` | Pi itself: `Harness`, `createRegistry`, `defineTool`, storage, `NodeExecutionEnv`, models, `context` |

Main blocks: `pi-chat` (the conversation), `pi-ambient` (a floating bar over an existing site), `pi-workspace` (chat plus an artifact panel), `pi-app` (a whole agent page: sessions, chat, viewers), `app-shell` (one agent above any app, phone drawer and desktop panel). The full list is in [registry/README.md](../../registry/README.md#blocks-what-to-install).

## Rules

Follow these on every change. They come from [INVARIANTS.md](../../INVARIANTS.md) and [AGENTS.md](../../AGENTS.md).

1. **The host owns the Harness.** The app's server opens and closes Pi's `Harness`, its storage, its models and its credentials. Kit packages never open one. Do not wrap Pi in a new engine, registry or scheduler; use Pi's public APIs (`defineTool`, `defineExtension`, `registry.install`, `conversation.configure`).
2. **The host owns policy.** Authentication, who may open which conversation or file, budgets and model keys live in host code (the `authenticate` and `resolve` callbacks of the handlers). Never put a model key in browser code.
3. **One place for files.** Each workspace has exactly one provider instance (`createWorkspaceProvider`). The agent's file tools (through `createFileGuard`), `present`, the viewers and the file tree all use that same instance. No second copy, mirror or sync.
4. **Use blocks, not hand-rolled UI.** Install the registry blocks and customise them through their props (`labels`, `icons`, `headerActions`, `artifactKinds`, `viewers`, `renderTool`, …) and the shadcn theme tokens. Never edit an installed block file; `npx boring-ui-blocks check` fails on edited copies.
5. **Agent-written code never runs in the host process.** An agent may run code only through its conversation's `ExecutionEnv` (a shell or sandbox). Do not `import()` or `eval` workspace content.
6. **Fictional data only** in examples, fixtures, seeds and tests. Never use real people, credentials or customer data.

## Where to read more

- [features/README.md](../../features/README.md): the feature map. What the kit does, with sub-feature IDs, code paths and how to drive each; start here to find where something lives.
- [README.md](../../README.md): pitch, quickstart and package overview.
- [registry/README.md](../../registry/README.md): every block, its props and install command.
- [packages/agent/README.md](../../packages/agent/README.md): agent tools, transport, approvals, schedules.
- [packages/files/README.md](../../packages/files/README.md): the workspace provider and revision protocol.
- [MIGRATING.md](../../MIGRATING.md): the newest version and what changed. Read its top section before upgrading.
- [docs/implementation/FEATURES.md](../../docs/implementation/FEATURES.md): implemented APIs with their tests and limits.

## Verify

- The kit version: `npm view @hachej/boring-ui-kit version`. Use it for every `@hachej/boring-*` package and every registry URL.
- In an app with blocks: `npx boring-ui-blocks check --design src` passes.
- In this repository: `npm run check` passes.
