# Boring UI

**Put an AI agent inside your app.**

Chat, files, document viewers, approvals and background work for React and Node apps, built on the [Pi](https://www.npmjs.com/package/@earendil-works/pi-durable) agent harness. You keep authentication, data, permissions and model keys.

[![npm](https://img.shields.io/npm/v/@hachej/boring-ui-kit?label=%40hachej%2Fboring-ui-kit)](https://www.npmjs.com/package/@hachej/boring-ui-kit)
[![CI](https://github.com/hachej/boring-ui/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/hachej/boring-ui/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```tsx
// Browser: a whole agent app (sessions, chat, artifact viewers) from one registry block.
import { AgentWorkspace, useConversations, useRemoteChat } from '@/components/pi-app/agent-workspace';

const conversations = useConversations({ endpoint: '/api/conversations', fetch, activeId, onSelect });
const chat = useRemoteChat({ conversationId: activeId, endpoint: id => `/api/chat?conversation=${id}`, fetch, identity });
<AgentWorkspace conversationId={activeId} conversations={conversations} revisionProvider={revisionProvider}
  controller={chat.status === 'ready' ? chat.controller : undefined} />;
```

```js
// Server: your process opens the Pi Harness and the workspace; the kit adds an agent definition and HTTP handlers.
const agent = defineAgent({ id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' },
  tools: [createPresentTool({ workspace: { files, root, access } })] });
agent.install(registry);
const harness = await Harness.open(storage, { registry, models, env: () => env }, context);
const chatHandler = createChatTransportHandler({ authenticate });  // your auth decides who opens which conversation
```

## Try it in 30 seconds

Node.js 22.19 or later. The scripted model needs no API key.

```sh
git clone https://github.com/hachej/boring-ui && cd boring-ui
npm ci && npm run build
STUDIO_MODEL=scripted npm run workspace-app
```

Open the printed URL and click **Draft a plan**. The agent writes a fictional picnic plan and opens it in the side panel. Drop `STUDIO_MODEL=scripted` and set `OPENAI_API_KEY` to use a real model.

## Why Boring UI

- **The agent lives in your app.** A side panel, a floating bar, a bottom drawer on phones, or the whole page. You pick the placement.
- **You own the server.** Your process opens the Pi Harness. The kit never holds your keys, your users or your policy.
- **One place for files.** The agent's `read`/`write`/`edit`, the viewers and the file tree all go through one workspace provider, with revisions and conflict checks.
- **Copy the UI, keep it updatable.** Blocks install through the shadcn CLI into your code, use your shadcn theme, and update with one command.
- **Durable by default.** Conversations, questions, approvals and schedules survive a restart, because Pi stores them.

## Install

```sh
npm i @hachej/boring-ui-kit @hachej/boring-agent @hachej/boring-files \
  @earendil-works/pi-durable@~1.2.0 @earendil-works/pi-ai@~1.2.0 @earendil-works/chord@~1.2.0
```

Then add UI blocks to a React app that has shadcn's `components.json` (Base UI, `base-nova` style). Use the version you installed:

```sh
npx boring-ui-blocks add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@0.4.8/r/pi-app.json
```

Add `.../r/theme.json` first if your app has no shadcn tokens yet. The full walk-through is the [build-agent-app skill](skills/build-agent-app/SKILL.md).

## Features

### Chat that knows your app

`PiChat` is the conversation: queue, steer, stop, attachments, `@` file mentions, voice messages, question and approval cards. `AmbientChat` floats the same chat over an existing site. `AppShell` puts one agent above any app, as a drawer on phones and a panel on wide screens.

```tsx
import { AmbientChat } from '@/components/pi-ambient/ambient';

<AmbientChat controller={controller} actions={actions} labels={{ title: 'Console assistant' }} />
```

See the [block list](registry/README.md#blocks-what-to-install).

### Artifacts the agent can show

The agent writes a file and calls `present`. The page opens it in a viewer: Markdown (editable), HTML, PDF, images, code, mock-ups, diagrams, typed records and boards.

```js
import { createPresentTool } from '@hachej/boring-agent/artifacts';

defineAgent({ id: 'writer', model, tools: [createPresentTool({ workspace: { files, root, access } })] });
```

See [Whole agent app](registry/README.md#whole-agent-app-pi-app-agentworkspace) and [Artifacts](packages/agent/README.md#artifacts).

### A workspace with history

`createWorkspaceProvider` puts revisions, conditional writes and a change feed over a Pi `FileSystem` (disk, virtual or SQLite). `createFileGuard` routes Pi's own file tools through it, so an agent edit never overwrites a save the person just made.

```js
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createFileGuard } from '@hachej/boring-agent/file-guard';

const files = createWorkspaceProvider({ identity, fs: env, journal: createWorkspaceJournal(db) });
const guard = createFileGuard({ workspace: { files, root, access } });
```

The browser reaches it through one route, `createRevisionHandler`: reads, saves, the file list, `@` search and uploads (a conditional create with a receipt, binary-safe, up to `maxFileBytes`) all use the same resolve and access. See [`@hachej/boring-files`](packages/files/README.md) and [One file tool set](packages/agent/README.md#one-file-tool-set-the-guard).

### Approvals, questions and schedules

Gate any tool behind an Approve/Deny card, let the agent ask the person a question, hand work to a sub-agent, or schedule a follow-up. Each one is a native Pi tool or extension.

```js
import { createApprovalExtension } from '@hachej/boring-agent/approval';

const approvals = createApprovalExtension({ tools: { write: true, edit: true } });
defineAgent({ id: 'writer', model, extensions: [fileTools, approvals] });  // Approve/Deny before every write or edit
```

See [Approval gate](packages/agent/README.md#approval-gate), [Asking the person](packages/agent/README.md#asking-the-person) and [Sub-agents and schedules](packages/agent/README.md#sub-agents-and-schedules).

### Shell, Git and sandboxes

A virtual Bash and Git workspace in memory or SQLite, or a remote shell and file system you already run. The agent's tools see one view of the files either way.

See [`@hachej/boring-execution`](packages/execution/README.md).

### Feedback from your users

People point at what they see, dictate a note and send it. Works with or without an agent.

See [`@hachej/boring-feedback`](packages/feedback/README.md).

## Packages

| Package | What it gives you |
| --- | --- |
| [`@hachej/boring-ui-kit`](packages/ui/README.md) | Headless controllers, editors and viewers, the shadcn registry (`r/`) and the `boring-ui-blocks` command |
| [`@hachej/boring-agent`](packages/agent/README.md) | Pi agent pieces: `defineAgent`, chat transport, conversations, present, approvals, questions, schedules, memory |
| [`@hachej/boring-files`](packages/files/README.md) | The workspace provider: revisions, conditional writes, history, remote access |
| [`@hachej/boring-execution`](packages/execution/README.md) | Virtual Bash and Git, remote shell and file system adapters |
| [`@hachej/boring-feedback`](packages/feedback/README.md) | In-app feedback capture and delivery |

Two more packages stay private to this repository: [`boring-browser`](packages/browser/README.md) (the agent in a browser worker) and [`boring-testing`](packages/testing/README.md) (a scripted keyless model and a headless browser driver).

## Examples

Every example uses fictional data. Run it with `npm run <name>` after `npm run build`; `npm run <name>:journey` drives it in a real browser.

| Example | What it shows |
| --- | --- |
| [`workspace-app`](examples/workspace-app/server.mjs) | The smallest whole agent app: sessions, chat, artifact panel, about 120 lines of server |
| [`ambient`](examples/ambient/README.md) | An agent floating over an existing settings console |
| [`app-shell`](examples/app-shell/README.md) | A phone-first app with one agent in a bottom drawer |
| [`dock-app`](examples/dock-app/README.md) | Chat and files in resizable docks beside a host page |
| [`shared-chat`](examples/shared-chat/README.md) | A team conversation with several people and agents |
| [`bot`](examples/bot/README.md) | One lifelong conversation with memory and a self it can edit |
| [`browser-agent`](examples/browser-agent/README.md) | A coding agent that runs entirely in one browser tab |
| [`hosts`](examples/hosts/README.md) | The same agent on Cloudflare Durable Objects and AWS |
| [`workspace-demo`](demos/workspace/README.md) | A fictional accounts-payable week with approvals |

The [studio](lab/README.md) is a playground over every block (`npm run studio`).

## Use with your coding agent

This repository ships [Agent Skills](skills/) that teach Claude Code, Codex and other coding agents to build with the kit:

```sh
npx skills add hachej/boring-ui
```

| Skill | Use it to |
| --- | --- |
| [`boring-ui`](skills/boring-ui/SKILL.md) | Learn the kit, its rules, and which skill to use next |
| [`build-agent-app`](skills/build-agent-app/SKILL.md) | Scaffold an app with an agent inside, or add one to an existing app |
| [`add-blocks`](skills/add-blocks/SKILL.md) | Find, install, update and theme registry blocks |
| [`agent-capabilities`](skills/agent-capabilities/SKILL.md) | Give the in-app agent tools, files, approvals, questions, sub-agents and schedules |

## Documentation

| Topic | Start here |
| --- | --- |
| UI blocks and their props | [Registry guide](registry/README.md) |
| Upgrading | [Migration guide](MIGRATING.md) |
| What is implemented, with tests | [Feature map](docs/implementation/FEATURES.md) |
| How the kit works with Pi | [Pi integration](docs/architecture/PI-COMPLEMENT.md) and [invariants](INVARIANTS.md) |
| Files, Git and execution | [Workspace architecture](docs/architecture/FILES-GIT-EXEC.md) |
| An agent beside an existing website | [Website integration](docs/architecture/WEBSITE-INTEGRATION.md) |
| Agents that change their own tools | [Self-evolution](docs/architecture/SELF-EVOLUTION.md) |
| Product scope | [Requirements](docs/architecture/PRODUCT-REQUIREMENTS.md) and [roadmap](docs/architecture/ROADMAP.md) |
| Releasing | [npm release guide](docs/implementation/NPM-RELEASE.md) |

Apps built by the Boring Factory start from its app template and ship through the [Factory](https://github.com/hachej/boring-factory/blob/main/docs/PROVISIONING.md); this repository provides the packages and blocks they consume.

## Contributing

Read [AGENTS.md](AGENTS.md) and [INVARIANTS.md](INVARIANTS.md) first. Use fictional data only.

```sh
npm ci
npm run check        # docs links, package boundaries, registry blocks, design rules
npm run typecheck
npm test
npm run verify       # all of the above plus invariants and design tests
npm run check:pack   # audits the real package tarballs
```

`verify` lists deferred proofs; they are backlog, not release blockers. Browser journeys and isolated consumer checks run separately in CI. Keep raw local evidence in `.cache/evidence/`. A package change adds its note to [MIGRATING.md](MIGRATING.md) under Unreleased. Merging a PR does not publish packages; see the [release guide](docs/implementation/NPM-RELEASE.md).

Release qualification is tracked in the [implementation checkpoint](docs/implementation/PARTIAL.md) and [VERIFY.json](VERIFY.json). Passing one test does not qualify every provider or deployment.

## License

[MIT](LICENSE). Optional dependencies keep their own licenses. Qualify tldraw licensing and assets for your deployment; see the [canvas guide](docs/architecture/CANVAS.md).
