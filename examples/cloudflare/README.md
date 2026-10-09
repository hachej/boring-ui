# Cloudflare host recipe: the standard agent on PiHarness in a Durable Object

One Worker, one SQLite-backed Durable Object class (`Assistant`) and static assets. Fictional content only.

This is the **same standard agent** the studio runs (`examples/shared/standard-agent.mjs`), with the capabilities Workers can give it, and the **same scenario files** (`examples/studio/scenarios/*.mjs`): the page lists them in the empty chat and `journey.mjs` executes them through the real UI against the deployed URL. The object has a workspace of files in its own SQLite, with just-bash over the same files; it has no git, canvas editor bundle, subagent tasks or code sandbox here, so those parts are simply not passed to `defineStandardAgent`: the agent is told only about what it has. This page has no file tree, uploads or terminal, so `/api/agent` reports the capabilities without `workspace` and `shell`, and the scenarios that need more (`requires: ['workspace']`, `['canvas']`, ...) are listed disabled with the reason, in the UI and in the journey.

| Need | Where it runs |
|---|---|
| Agent loop, transcripts, recovery | Native Pi Durable, hosted by `PiHarness` (`agents/harness/pi`) in the object; Pi's tables (`pi_*`) are in the object's SQLite |
| Agent definition | `defineStandardAgent` (`examples/shared/standard-agent.mjs`, which wraps `defineAgent` from `@hachej/boring-agent/agents`), installed through the registry (`agent.install(registry)`); its tools take the workspace attached to the env the object gives Pi (`withWorkspace`, `workspace: 'env'`), the same interface as a host with a workspace per person: Pi's `read`, `write` and `edit` behind the file guard, `list_files`, `bash`, `present`, the shared `notes.md`, `ask_user` and the skills (`letter-style`, `plain-language`, `letter-review`); self-evolution (`reload`; the agent's `.agent/` lives in the object's SQLite workspace, its tools run in just-bash over it, and the object runs the same scan when its harness opens; no person's `/reload` on this page); capabilities reported by `/api/agent` as `variant.capabilities` |
| Workspace (files, presented files, the Shared document panel) | the SQLite workspace backend in the same SQLite: `openSqliteFileSystem` (`@hachej/boring-files/sqlite-filesystem`) over `durableObjectSqliteConnection`, one `createWorkspaceProvider` with its journal in the same database (a multi-file save and its receipt commit in one `transactionSync`), and `createVirtualWorkspace({ fs })` for Pi's native environment and just-bash over the same files |
| Chat API | `createChatTransportHandler` from the object's `fetch`; submissions go through `PiHarness` so the object keeps a wake job |
| Browser | `pi-chat`, `ArtifactWorkspace` and the viewers from `registry/`, bundled by `scripts/build-browser.mjs` into `public/` (Workers static assets, plus `scenarios.json`: the scenario descriptions, written at build time from the studio's scenario files), over `createRemoteChat` |
| Model | Workers AI binding, `@cf/moonshotai/kimi-k2.7-code` (Cloudflare's own Pi example uses it for agent work); `@cf/zai-org/glm-4.7-flash` is offered in the picker. No external key. |
| Auth | Bearer token in the Worker secret `ACCESS_TOKEN`, checked in the Worker (constant time) before the object is woken |

## Deploy

Prerequisites: Node 22.19+, a Cloudflare account on a plan with SQLite-backed Durable Objects (the Workers Free plan supports them), Workers AI enabled, and `CLOUDFLARE_API_TOKEN` with Workers Scripts, Durable Objects and Workers AI permissions.

```sh
npm ci --ignore-scripts
npm run cloudflare:build                      # packages + browser app into examples/cloudflare/public
mkdir -p .cache && openssl rand -hex 24 > .cache/cloudflare-recipe-token   # .cache/ is gitignored
npx wrangler deploy --config examples/cloudflare/wrangler.jsonc            # first deploy creates the Worker
npx wrangler secret put ACCESS_TOKEN --config examples/cloudflare/wrangler.jsonc < .cache/cloudflare-recipe-token
```

Open `https://boring-ui-v4-recipe.<your-subdomain>.workers.dev/#token=<contents of the token file>` (the fragment is removed from the address bar and the token kept in `sessionStorage`), or open the page and paste it. The token is never a query parameter.

Journey in a real browser: `CF_URL=<url> CHROMIUM=<binary> node examples/cloudflare/journey.mjs`. It checks the 401s and the token gate, then runs every shared scenario the deployment's capabilities allow (`CF_ONLY=chat-basics,artifacts` or scenario ids to run some), lists the others as disabled with their reason, and finishes with the atomicity proof. The `chat-restart` scenario resets the Durable Object through `/api/debug/restart` and checks that a new in-memory instance serves the same conversation.

Delete: `npx wrangler delete --config examples/cloudflare/wrangler.jsonc` (removes the Worker and its Durable Object data).

## Proofs built in

These two routes are off by default and answer 404 on a deployment. Turn them on only for a proof run: `npx wrangler dev --config examples/cloudflare/wrangler.jsonc --var ENABLE_DEBUG_ROUTES:1` (or `ENABLE_DEBUG_ROUTES=1` in a gitignored `.dev.vars`), and run the journey with `CF_DEBUG_ROUTES=1`. Without `CF_DEBUG_ROUTES=1` the journey asserts they are 404 and skips the two proofs. Never set the variable on a deployed Worker.

- `POST /api/debug/restart` resets the object (`ctx.abort`); `/api/agent` returns an `instance` id that changes on restart while conversations and documents stay.
- `POST /api/debug/atomicity` runs a two-file save in a separate proof workspace whose second history insert fails after both file rows, the receipt and the first history row were written, and reports that everything rolled back.

## Limits and notes

- Beta: `PiHarness` and `agents/models/pi-ai` may change. `agents@0.26.0` peers `@modelcontextprotocol/sdk@1.30.0`; the repo pins 1.31.0, so `package.json` overrides that peer (the recipe does not use MCP).
- One object holds all conversations of the one owner (`getByName('main')`). The watch stream is an open HTTP request: the object stays active while a page is open (duration billing). A dropped stream reconnects.
- The workspace's SQLite connection is synchronous on purpose (see `SqliteConnection` in `@hachej/boring-files/sqlite`); Pi's own async `SqliteDatabase` is used by `PiHarness` for Pi's tables.
- The shell is just-bash over the workspace rows: regular files and directories only (no links; `chmod` changes nothing), no git and no processes. A real shell (Cloudflare Sandbox or Containers behind a Pi `ExecutionEnv`) would be a variant supplying an `ExecutionEnv`, not a change to the agent. Canvas, subagents and code mode are omitted: the tldraw editor and the QuickJS sandbox are not bundled in this Worker.
- Replay: tools are `unsafe` by default, so a tool interrupted by a reset reports an interruption instead of running again.
