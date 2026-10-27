---
name: build-agent-app
description: Build a React + Node app with an AI agent inside using Boring UI, or add one to an existing app. Use when asked to "create an agent app", "add an AI assistant/chat/copilot to my app", "scaffold a Boring UI app", "wire AgentWorkspace/PiChat to a server", "set up the Pi Harness with the kit", or to connect the pi-app, pi-chat or pi-ambient blocks to defineAgent, createChatTransportHandler, createConversationsHandler and createRevisionHandler. Gives the verified smallest setup (one Node server, one page) and how to extend it.
---

# Build an agent app

The smallest whole agent app is one Node server (about 90 lines) and one React page (about 50 lines). The repository's reference is [examples/workspace-app](../../examples/workspace-app/server.mjs). This skill gives the same composition with nothing repository-internal.

Shape of the result:

- **Server** (`server.mjs`): opens Pi's `Harness`, one workspace provider and one agent, and serves three routes: `/api/conversations`, `/api/chat`, `/api/resources`.
- **Page** (`src/App.tsx`): the `pi-app` block's `AgentWorkspace` (sessions, chat, artifact viewers) over those routes.

## 1. Get the version

```sh
npm view @hachej/boring-ui-kit version
```

Use that version (written `<v>` below) for every `@hachej/boring-*` package and every registry URL. Pi packages stay on `~1.2.0`.

## 2. Create the app (skip for an existing app)

A new app uses the pinned shadcn CLI with Base UI and the `nova` preset (blocks support the Base UI `base-nova` style only):

```sh
npx shadcn@4.21.5 init -t vite -b base -p nova -n app -y --no-monorepo
cd app
```

An existing app needs React 19, Tailwind v4 and a `components.json` with a Base UI style. Without one, run `npx shadcn@4.21.5 init` in it first.

## 3. Install the packages

```sh
npm i @hachej/boring-ui-kit@<v> @hachej/boring-agent@<v> @hachej/boring-files@<v> \
  @earendil-works/pi-durable@~1.2.0 @earendil-works/pi-ai@~1.2.0 @earendil-works/chord@~1.2.0
```

## 4. Add the UI block

Blocks use the app's own shadcn components (its `ui` alias) and tokens, so install the components once first ([what the app needs](../../registry/README.md#what-the-app-needs-first)). Then pick the block from the table in [registry/README.md](../../registry/README.md#blocks-what-to-install). For a whole agent page:

```sh
npx boring-ui-blocks add alert attachment avatar badge bubble button card checkbox collapsible dialog drawer dropdown-menu empty input input-group item label message message-scroller native-select popover progress scroll-area separator sidebar spinner switch table textarea toggle toggle-group tooltip trace
npx boring-ui-blocks add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<v>/r/pi-app.json https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<v>/r/pi-app-kinds.json
```

Add `.../r/theme.json` once if the app has no shadcn tokens. This copies `pi-app`, `pi-app-kinds` (the default artifact kinds and their viewers), `pi-chat` and `pi-workspace` into `src/components/`, and writes `SHADCN-GENERATED.json`. Never edit those files; see the [add-blocks skill](../add-blocks/SKILL.md).

Other placements use the same server:

| Placement | Block | Component |
| --- | --- | --- |
| Whole page: sessions, chat, viewers | `pi-app` | `AgentWorkspace` |
| Floating bar over an existing site | `pi-ambient` | `AmbientChat` |
| One agent above any app (phone drawer, desktop panel) | `app-shell` | `AppShell` |
| Only the conversation, your own layout | `pi-chat` | `PiChat` |

## 5. Write the server

Copy [references/server.md](references/server.md) to `server.mjs`. In order, it:

1. Creates models: `createModels()` from `@earendil-works/pi-ai/models`, then `models.setProvider(openaiProvider())` (reads `OPENAI_API_KEY`).
2. Opens one workspace: `NodeExecutionEnv` over a directory, `openNodeConnection` + `createWorkspaceJournal`, then **one** `createWorkspaceProvider({ identity, fs: env, journal })`.
3. Defines the agent: `defineAgent({ id, model, instructions, tools: [createPresentTool({ workspace })], extensions: [fileTools, createFileGuard({ workspace })] })`. `fileTools` is Pi's own `createReadTool`, `createWriteTool` and `createEditTool` in one `defineExtension`; the guard routes them through the provider.
4. Opens the Harness: `agent.install(registry)`, `Harness.open(storage, { registry, models, env: () => env }, context)`, `createConversations({ harness, context })`, `harness.resume()`.
5. Serves the routes, each behind `authenticate`/`resolve`:
   - `createConversationsHandler({ conversations, authenticate })`: `authenticate` returns `{ owner, start }`.
   - `createChatTransportHandler({ authenticate })`: `authenticate` returns `{ conversation, context, abortSubmission }`.
   - `createRevisionHandler({ resolve })`: `resolve` returns `{ provider: files, access }`.
6. Bridges Node HTTP with `webRequest` and `sendWebResponse` from `@hachej/boring-files/node-http`, and closes everything on `SIGINT`/`SIGTERM`.

Replace the development bearer check (`allowed`) with your own authentication before anything leaves your machine.

## 6. Write the page

Copy [references/page.md](references/page.md) to `src/App.tsx`. It:

- connects the revision provider: `connectRevisionProvider({ endpoint, fetch })` from `@hachej/boring-files/revision`;
- lists sessions: `useConversations({ endpoint, fetch, activeId, onSelect })`;
- opens the chat: `useRemoteChat({ conversationId, endpoint: id => ..., fetch, identity })`;
- renders `<AgentWorkspace artifactKinds={defaultKinds()} conversationId conversations revisionProvider controller chat />` inside `TooltipProvider` (`defaultKinds` from `pi-app-kinds`, built once outside render).

Pass `controller={chat.status === 'ready' ? chat.controller : undefined}` and `chat.actions` (question and approval answers) only when ready. The `identity` (`runtimeId`, `scopeId`, `principalId`, `initiatorId`) must match the `access` the server resolves.

## 7. Connect them in development

Add a proxy to `vite.config.ts` so the page reaches the server on the same origin:

```ts
server: {
  // Development only: forward the API and add the server's dev bearer token.
  proxy: { '/api': { target: 'http://127.0.0.1:8787', headers: { authorization: `Bearer ${process.env.APP_TOKEN ?? 'dev-token'}` } } },
},
```

Run both:

```sh
OPENAI_API_KEY=... node server.mjs
npm run dev
```

Open the page and click **Draft a plan**. The agent writes a Markdown file and `present` opens it in the panel.

## Extend it

- More tools, approvals, questions, sub-agents, schedules: the [agent-capabilities skill](../agent-capabilities/SKILL.md).
- Words, icons, header and panel actions, custom artifact types: props only, listed in [Updating installed blocks](../../registry/README.md#updating-installed-blocks).
- A Library without a revision provider, file history and large files: [Whole agent app](../../registry/README.md#whole-agent-app-pi-app-agentworkspace).
- WebSocket transport, durable hosts (Cloudflare, AWS): [packages/agent/README.md](../../packages/agent/README.md) and [examples/hosts](../../examples/hosts/README.md).

## Rules

- The server opens and closes the Harness. Never put a model key or the dev token in browser code for production.
- One workspace provider per workspace. `present`, the file guard and the revision route all get the same `files`.
- Agent-written files are data. Never `import()` them into the server.
- Fictional data only in seeds, prompts and tests.

## Verify

1. `node server.mjs` prints `API on http://127.0.0.1:8787`.
2. `APP_TOKEN=dev-token; curl -H "authorization: Bearer $APP_TOKEN" http://127.0.0.1:8787/api/conversations` returns `{"conversations":[...]}`; without the header it returns 401.
3. `npx tsc -p tsconfig.app.json --noEmit` reports nothing in `src/App.tsx`, and `npx vite build` succeeds.
4. The page shows the sessions pane, the chat with **Draft a plan** and the Library.
5. `npx boring-ui-blocks check --design src` prints `ok`.
6. With a real key, one turn writes a file and opens it in the panel.
