# UI bridge ownership refactor — move UI tools out of `@boring/agent`

**Status:** review v2 (incorporates Gemini review feedback)
**Owners:** workspace, agent
**Last updated:** 2026-04-27

## Problem

`@boring/agent` currently owns four things that are conceptually workspace concerns:

1. **`UiBridge` interface + `UiState` / `UiCommand` types** in `src/shared/ui-bridge.ts`. The discriminated union in `UiCommand` (`openFile` / `openPanel` / `closePanel` / `navigateToLine` / `expandToFile` / `showNotification`) describes operations on a workspace, not on an LLM harness.
2. **`createInMemoryBridge()`** in `src/server/ui-bridge/createInMemoryBridge.ts`. The bridge is the message queue between "frontend pushed UI state" and "agent dispatched UI command" — both endpoints of the bridge are workspace concerns.
3. **`uiRoutes` plugin** in `src/server/http/routes/ui.ts`. Serves `/api/v1/ui/*` (PUT state, POST commands, SSE drain). Today this is registered inside `createAgentApp`.
4. **`createGetUiStateTool` / `createExecUiTool`** in `src/server/catalog/standardCatalog.ts`. The `standardCatalog` factory takes a `uiBridge?: UiBridge` parameter and conditionally appends the two tools. `createAgentApp` constructs an in-memory bridge and passes it.

Symptoms:

- Standalone `@boring/agent` (CLI mode, no workspace) ships UI tools and HTTP routes the harness can never fulfill — wasted bundle, misleading capability surface for non-workspace consumers.
- `standardCatalog`'s `uiBridge?` branch is the only place where the catalog has a knob; everything else is fixed. Asymmetric.
- The agent package's "shared" types are mixed: `AgentTool` (truly generic) sits next to `UiCommand` (workspace-specific). Future readers can't tell which is which.
- Adding a workspace-specific tool today (e.g., `query_data_catalog`, `focus_chart`) means either bolting it into agent's `standardCatalog` or threading it through `extraTools` from the app shell. Workspace doesn't currently have a clean place to define server-side tool factories.

## Goal

`@boring/agent` becomes a pure tool harness. It knows nothing about UI bridges, UI state shapes, or workspace-specific commands. It exposes:

- A generic `AgentTool` interface
- `createAgentApp(opts)` — boots Fastify with the LLM loop, chat persistence, file/bash/edit/read/write/find/grep tools, and `/api/v1/agent/*` routes
- An `extraTools?: AgentTool[]` option as the only seam for hosts to add tools
- Returns the `FastifyInstance` so the host can register additional plugins

`@boring/workspace` owns everything UI-bridge-related:

- The `UiBridge` interface, `UiCommand` discriminated union, `UiState` shape (in a new `@boring/workspace/shared` subpath — needed on both client and server, so it lives outside both bundles).
- `createInMemoryBridge()` impl.
- `uiRoutes` Fastify plugin.
- `createGetUiStateTool` / `createExecUiTool` factories.
- A convenience wrapper `createWorkspaceAgentApp(opts)` that builds the bridge, builds tools that close over it, registers `uiRoutes`, and delegates everything else to `createAgentApp`.

App shells get one import:

```ts
import { createWorkspaceAgentApp } from "@boring/workspace/server"

const app = await createWorkspaceAgentApp({
  workspaceRoot: process.cwd(),
  mode: "local",
})
```

Standalone agent users (CLI, non-workspace embedders) keep using `createAgentApp` directly and get zero UI surface — smaller bundle, honest contract.

## Dependency direction (verify no cycle)

After refactor:

```
app shell
  └─→ @boring/workspace/server
        └─→ @boring/agent/server  (createAgentApp, FastifyInstance type)
        └─→ @boring/agent/shared  (AgentTool interface, ToolResult — only the truly generic tool types stay here)
        └─→ @boring/workspace/shared  (UiBridge / UiCommand / UiState)
@boring/workspace/front
        └─→ @boring/workspace/shared (for UiCommand type)
        └─→ @boring/agent/ui-shadcn  (ChatPanel — unchanged)
@boring/agent  (no edges into workspace, never)
```

`@boring/workspace/server` imports from `@boring/agent`. The reverse never happens.

`@boring/boring-macro` (existing) imports `AgentTool` + `ToolResult` from `@boring/agent/shared` — those are pure tool types and stay in agent. No change.

`@boring/agent/front-shadcn/ChatPanel.tsx` currently has a `bridge?: UiBridge` prop that is **unused in the implementation**. The prop is destructured at the top of `ChatPanel` but never threaded into any child. It's dead-code that gives the impression UiBridge is a ChatPanel concern. **Drop the prop entirely** as part of this PR — removes the last surface in agent that references UiBridge.

`@boring/core` does not import `UiBridge` / `UiCommand` / `UiState` from anywhere (verified via repo-wide grep). After refactor, core depends only on `@boring/workspace/front` (existing) and never transitively pulls fastify, since workspace's front bundle is split from its server bundle (see Bundling section).

## Scope

### In scope

- File moves listed below.
- `standardCatalog` API change — drop `uiBridge?` from both the parameter destructure AND the `ToolCatalog` interface definition (per Gemini: "remove from the interface, not just the function").
- `createAgentApp` — drop `uiRoutes` registration, drop the `createInMemoryBridge()` call. Keep `extraTools`.
- `@boring/agent`'s `front-shadcn/ChatPanel` — drop the unused `bridge?: UiBridge` prop and the corresponding type import.
- Workspace package: new `./shared` and `./server` exports, new `tsconfig.server.json` and `tsconfig.front.json`, new `fastify` dependency.
- App shell migration: `apps/workspace-playground/vite.config.ts` switches from `createAgentApp` to `createWorkspaceAgentApp`.
- All affected tests move with their code; one new agent-side regression test asserts UI tools are NOT in the standalone catalog.

### Out of scope

- Adding new tools or new command kinds.
- Changing the wire protocol (SSE format, PUT body shape).
- The deferred Gemini-review items from earlier round: Last-Event-ID seq replay, multi-tab session keying, promise-based `whenReady` to replace double-RAF.
- Touching `@boring/core` or any core integration.

## File moves and edits

### Files moved out of `@boring/agent`

| From | To |
|------|----|
| `packages/agent/src/shared/ui-bridge.ts` | `packages/workspace/src/shared/ui-bridge.ts` |
| `packages/agent/src/server/ui-bridge/createInMemoryBridge.ts` | `packages/workspace/src/server/ui-bridge/createInMemoryBridge.ts` |
| `packages/agent/src/server/ui-bridge/__tests__/createInMemoryBridge.test.ts` | `packages/workspace/src/server/ui-bridge/__tests__/createInMemoryBridge.test.ts` |
| `packages/agent/src/server/http/routes/ui.ts` | `packages/workspace/src/server/http/uiRoutes.ts` |
| The `createGetUiStateTool` + `createExecUiTool` factories from `packages/agent/src/server/catalog/standardCatalog.ts` (lines ~19-90) | new `packages/workspace/src/server/uiTools.ts` |
| `packages/agent/src/server/catalog/tools/__tests__/uiTools.test.ts` | `packages/workspace/src/server/__tests__/uiTools.test.ts` |

### Files edited in `@boring/agent`

- `src/server/catalog/standardCatalog.ts` — drop `uiBridge?` from the destructured `ToolCatalog` deps AND from the `ToolCatalog` interface definition. Drop the `if (uiBridge) {...}` branch. The catalog signature shrinks; no other behavioural change.
- `src/server/createAgentApp.ts` — delete:
  - `import { uiRoutes } from './http/routes/ui'`
  - `import { createInMemoryBridge } from './ui-bridge/createInMemoryBridge'`
  - `const uiBridge = createInMemoryBridge()` line
  - `await app.register(uiRoutes, { bridge: uiBridge })` line
  - The `uiBridge` arg to `standardCatalog({ ...runtimeBundle, uiBridge })` — becomes `standardCatalog(runtimeBundle)`.
- `src/front-shadcn/ChatPanel.tsx` — drop `bridge?: UiBridge` from `ChatPanelProps`, drop the destructure, drop the `import type { UiBridge }` line.
- `src/server/__tests__/createAgentApp.test.ts` — three tests added in commit `01bf41f` (`createAgentApp registers get_ui_state and exec_ui in the catalog`, `PUT /api/v1/ui/state is round-tripped by GET`, `exec_ui-style POST /api/v1/ui/commands enqueues for drain`) **move to workspace** — they now assert against `createWorkspaceAgentApp`. Add **one new test in agent** asserting the standalone agent's catalog does NOT include UI tools AND `/api/v1/ui/state` returns 404 — regression test pinning the new contract.
- `src/index.ts` / `src/server/index.ts` / `src/shared/index.ts` — remove any re-exports of `UiBridge`, `UiCommand`, `UiState`, `createInMemoryBridge`.

### Files added in `@boring/workspace`

- `packages/workspace/src/shared/index.ts` — re-export `UiBridge`, `UiCommand`, `UiState`, `CommandResult` types from the moved `ui-bridge.ts`. **Strict isolation rule (build-enforced — see Bundling section): zero imports from `../server/**` or `../components/**` or `../front/**`.**
- `packages/workspace/src/server/index.ts` — public server-side surface:
  ```ts
  export { createWorkspaceAgentApp } from "./createWorkspaceAgentApp"
  export { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
  export { uiRoutes } from "./http/uiRoutes"
  export { createGetUiStateTool, createExecUiTool, createWorkspaceUiTools } from "./uiTools"
  export type * from "../shared"
  ```
- `packages/workspace/src/server/createWorkspaceAgentApp.ts` — the wrapper:
  ```ts
  import { createAgentApp, type CreateAgentAppOptions } from "@boring/agent/server"
  import type { FastifyInstance } from "fastify"
  import { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
  import { createWorkspaceUiTools } from "./uiTools"
  import { uiRoutes } from "./http/uiRoutes"

  export async function createWorkspaceAgentApp(
    opts: CreateAgentAppOptions = {},
  ): Promise<FastifyInstance> {
    const bridge = createInMemoryBridge()
    const tools = createWorkspaceUiTools(bridge)
    const app = await createAgentApp({
      ...opts,
      extraTools: [...(opts.extraTools ?? []), ...tools],
    })
    await app.register(uiRoutes, { bridge })
    return app
  }
  ```
- `packages/workspace/src/server/uiTools.ts` — the moved tool factories plus a `createWorkspaceUiTools(bridge)` convenience that returns both as an `AgentTool[]`.

### Bundling — explicit plan (per Gemini, "verify during implementation" was insufficient)

Workspace today is a single browser-targeted bundle. After refactor it must produce three separate output trees:

| Bundle | Source | Targets | Allowed runtime |
|--------|--------|---------|-----------------|
| `dist/index.js` (front) | `src/components`, `src/dock`, plugin-owned frontend data such as `src/plugins/filesystemPlugin/data`, etc. | browser | DOM, React, Tailwind. NO node built-ins, NO fastify. |
| `dist/server/index.js` | `src/server` | node | Fastify, node http/streams. NO React, NO DOM. |
| `dist/shared/index.js` | `src/shared` | both | Pure types only, no runtime imports. |

Concrete changes:

1. **`packages/workspace/package.json`**:
   - Add `"fastify"` and `"zod"` (uiRoutes uses zod) as direct `dependencies`. Currently agent ships these and we'd transitively pull through; making them direct removes the implicit assumption that agent's deps are stable.
   - Add `"@boring/agent": "workspace:*"` already exists in deps (verified). No change.
   - `"exports"` map updated:
     ```jsonc
     {
       ".":         { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
       "./globals.css": "./dist/globals.css",
       "./ui-shadcn":   { "import": "./dist/ui-shadcn/index.js", "types": "./dist/ui-shadcn/index.d.ts" },
       "./shared":      { "import": "./dist/shared/index.js", "types": "./dist/shared/index.d.ts" },
       "./server":      { "import": "./dist/server/index.js", "types": "./dist/server/index.d.ts" }
     }
     ```
   - `"files"` array includes `"dist"` already; no change needed.
   - Add `"sideEffects": false` if not present so client bundles tree-shake cleanly.

2. **TypeScript split**: replace single `tsconfig.json` with three:
   - `tsconfig.front.json` — `lib: ["DOM","DOM.Iterable","ES2022"]`, includes `src/components/**`, `src/shared/**`, excludes `src/server/**`.
   - `tsconfig.server.json` — `lib: ["ES2022"]`, includes `src/server/**`, `src/shared/**`. Adds `@types/node` to `types`. Excludes `src/components/**`.
   - `tsconfig.json` — root project-references config that points to both. CI typecheck runs both.
   - **Why**: prevents DOM types leaking into server code (silent `window` access at compile time) and node types leaking into front code (silent `process.env` access). Both are real bugs that strict tsconfig-split catches at typecheck time.

3. **Build pipeline**: workspace currently uses Vite for the bundle. The server output should use a separate config or a separate tsup step. **Open question**: prefer Vite (consistent tooling) or tsup (simpler for pure-Node ESM). Lean: tsup for the server bundle — it's what `@boring/agent` already uses and matches the node-target ergonomics.

4. **Build-time isolation check** (per Gemini, prevents `shared` accidentally importing from `server`):
   - Add a small script `scripts/assert-bundle-isolation.mjs` that:
     - Parses `dist/shared/index.js` AST and asserts no `import` / `require` references `fastify`, `@fastify/*`, `node:*`.
     - Parses `dist/index.js` (front) AST and asserts no `import` references `fastify`, `@fastify/*`, `node:fs`, `node:http`, `@boring/workspace/server`.
   - Wire as a `postbuild` step in `workspace/package.json`. Fails the build (and CI) on a regression. Implementation is ~30 lines using `acorn` or `es-module-lexer` (both are common dev deps).

5. **CI check** that imports `@boring/workspace` (front) in a fresh Node process and asserts `require.cache` (or ESM equivalent — `import.meta.resolve` introspection) doesn't contain `fastify`. Catches the dynamic-import-loophole that AST analysis alone can miss.

### Test coverage additions (per Gemini)

In addition to the test migration table:

- **`extraTools` merge test** in workspace: pass an arbitrary host tool `{ name: 'host_tool', ... }` to `createWorkspaceAgentApp({ extraTools: [hostTool] })`, hit `/api/v1/agent/catalog`, assert the response contains BOTH `host_tool` AND `get_ui_state` AND `exec_ui`. Pins that the wrapper merges rather than overwrites.
- **Bundle isolation test** in workspace's CI: a scripted check (see Bundling §4) plus a runtime test (Bundling §5).
- **Regression test in agent** (per the file-edits list above) — `createAgentApp` standalone must NOT include UI tools and `/api/v1/ui/state` must 404.

## API surface — before / after

### Before

```ts
// agent
import { createAgentApp } from "@boring/agent/server"
import type { UiCommand, UiState, UiBridge } from "@boring/agent/shared"

const app = await createAgentApp({ workspaceRoot, mode: "local" })
// app exposes /api/v1/agent/*, /api/v1/ui/*, includes get_ui_state + exec_ui in catalog
```

### After

```ts
// agent (standalone — no UI surface)
import { createAgentApp } from "@boring/agent/server"

const app = await createAgentApp({ workspaceRoot, mode: "local" })
// app exposes /api/v1/agent/* only, catalog has bash/read/write/edit/etc. — no UI tools
```

```ts
// agent + workspace
import { createWorkspaceAgentApp } from "@boring/workspace/server"
import type { UiCommand, UiState } from "@boring/workspace/shared"

const app = await createWorkspaceAgentApp({ workspaceRoot, mode: "local" })
// app exposes /api/v1/agent/* AND /api/v1/ui/*, catalog includes UI tools
```

App shell migration is mechanical: rename the import + function call.

## Migration plan — ATOMIC single PR (revised per Gemini)

Step-by-step migration is unsafe: in a multi-commit version, the intermediate state would have BOTH `createAgentApp` registering `uiRoutes` internally AND `createWorkspaceAgentApp` registering it again, producing a `FST_ERR_DUP_ROUTE` on boot. **Land everything in one PR.**

Implementation order within the PR (driven by what compiles at each step):

1. Create `packages/workspace/src/shared/` and copy `ui-bridge.ts` types in. Update workspace's `tsconfig.json` → `tsconfig.front.json` + `tsconfig.server.json` + root project references. Add `fastify` + `zod` to workspace `package.json`.
2. Create `packages/workspace/src/server/` with `createInMemoryBridge.ts`, `uiTools.ts`, `http/uiRoutes.ts`, `createWorkspaceAgentApp.ts`, `index.ts`. Update workspace `package.json` `exports` to expose `./shared` and `./server`.
3. In agent: drop `bridge?: UiBridge` prop from ChatPanel, drop UI bridge import. Drop `uiBridge?` from `standardCatalog` interface and impl. In `createAgentApp`, remove the `createInMemoryBridge()` + `app.register(uiRoutes)` lines and the imports that supported them. Delete `src/shared/ui-bridge.ts`, `src/server/ui-bridge/`, `src/server/http/routes/ui.ts`, the UI tool factories, the related tests.
4. In agent's `createAgentApp.test.ts`: replace the three UI bridge tests with the regression test (catalog has no UI tools, `/api/v1/ui/state` is 404).
5. Add the new tests in workspace: round-trip / queue-drain against `createWorkspaceAgentApp`, plus the `extraTools` merge test.
6. Migrate `apps/workspace-playground/vite.config.ts` to use `createWorkspaceAgentApp`.
7. Wire bundle isolation check (`scripts/assert-bundle-isolation.mjs` + postbuild hook + CI runtime check).
8. Documentation pass — update `WORKSPACE_V2_PLAN.md` and `agent/docs/API.md`.

CI must be green at the END of the PR. Intermediate commits within the PR may be red — the agent-only step (3) breaks until the workspace side (1, 2) is in place. That's acceptable for a single PR landing as one merge.

## Risks and unknowns (revised)

1. **Bundle separation** — must produce three bundles cleanly (front, server, shared). Caught via tsconfig split + AST check + runtime test. Closed under the Bundling section above.

2. **Fastify peer/direct dep duplication** — workspace will declare `fastify` directly; agent already declares it. pnpm will hoist a single instance, so route collisions don't happen at the module-identity level. Verified during implementation that `pnpm why fastify` in `apps/workspace-playground` resolves to one instance.

3. **`uiBridge` removal from `ToolCatalog` interface** — this is a breaking type change for any direct consumer of `ToolCatalog`. Inside the monorepo only `standardCatalog` consumes it. External consumers don't exist yet (pre-1.0). Caught via grep during step 3.

4. **In-flight session migration** — none. The bridge is in-memory and ephemeral. Across an agent server restart all state is lost regardless. Refactor doesn't change that.

5. **`@boring/boring-macro`** — imports `AgentTool` + `ToolResult` from `@boring/agent/shared`. Those symbols stay in agent; macro is unaffected.

## Open questions (resolved per Gemini review)

| Q | Resolution |
|---|------------|
| 1. Multi-commit migration vs single PR? | Single PR — multi-commit hits `FST_ERR_DUP_ROUTE` in intermediate state. |
| 2. Split `UiBridge` interface from impl? | Yes — interface in `workspace/shared`, impl in `workspace/server`. Mirrors agent's existing convention. |
| 3. `toolFactories` mechanism on `createAgentApp`? | No — workspace tools close over their bridge in the wrapper. Defer until a real second use case emerges. |
| 4. Core dep on UI types? | Verified clean — core has zero imports of UI bridge surface. |
| 5. `createWorkspaceAgentApp` naming? | Keep — precisely describes "agent app + workspace UI surface". |

## Done definition

- [ ] All file moves complete (table above).
- [ ] `pnpm --filter @boring/agent test` green; agent test suite includes the new "no UI tools, no /api/v1/ui/* route" regression test.
- [ ] `pnpm --filter @boring/workspace test` green; tests for `createWorkspaceAgentApp`, `createInMemoryBridge`, UI tool factories, AND the `extraTools` merge test all live here.
- [ ] `apps/workspace-playground/vite.config.ts` uses `createWorkspaceAgentApp`. End-to-end smoke (PUT /ui/state → get_ui_state via tool → expected payload) passes manually.
- [ ] `pnpm --filter @boring/workspace build` produces `dist/index.js` (front, no fastify), `dist/server/index.js` (server, no React), `dist/shared/index.js` (no runtime deps).
- [ ] `scripts/assert-bundle-isolation.mjs` passes as a postbuild step.
- [ ] CI runtime test confirms importing `@boring/workspace` in node does not pull `fastify` into the module graph.
- [ ] No remaining `import ... from "@boring/agent/shared"` for `UiBridge` / `UiCommand` / `UiState` anywhere in the repo.
- [ ] `@boring/agent`'s `ChatPanel` no longer references `UiBridge`.
- [ ] `WORKSPACE_V2_PLAN.md` and `agent/docs/API.md` reflect the new shape.
- [ ] Single PR (multiple commits within it OK as long as the final tree is green).
