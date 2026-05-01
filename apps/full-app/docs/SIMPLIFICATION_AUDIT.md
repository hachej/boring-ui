# Full App Simplification Plan

Goal: make `apps/full-app` and `apps/workspace-playground` thin
instantiations of reusable packages. Domain behavior belongs in the owning
package or plugin. Standalone workspace app wiring belongs in
`@boring/workspace/app`; core-backed app wiring belongs in `@boring/core/app`.

## Current State

`@boring/workspace` now owns the standalone workspace composition layer:

- `@boring/workspace/app/front` exports `WorkspaceAgentFront`.
- `@boring/workspace/app/server` exports `createWorkspaceAgentServer` and
  `createWorkspaceAgentServerBindings`.
- `@boring/workspace/server` exposes low-level bridge primitives only.
- workspace front/shared code has no value import from `@boring/agent`.
- file-backed panels and path routing are owned by the default filesystem
  plugin, including `code-editor`, `markdown-editor`, `csv-viewer`, `empty`,
  and the `workspace.open.path` resolver.

`apps/workspace-playground` is in the desired standalone shape:

- front code uses `WorkspaceAgentFront` from `@boring/workspace/app/front`
- server/dev/eval code uses `createWorkspaceAgentServer` from
  `@boring/workspace/app/server`
- no `CoreFront`, core auth, DB, membership, or custom bridge registry
- playground-specific data behavior lives under
  `src/plugins/playgroundDataCatalog`

`apps/boring-macro-v2` is in the desired pluginized standalone shape:

- front code only supplies `ChatPanel` to `MacroWorkspaceApp`
- server code uses `createWorkspaceAgentServer` and registers macro routes
- macro panels, catalogs, data, routes, tools, provisioning templates, Python
  SDK source, and transforms live under `src/plugins/macro`
- the only macro workspace template is plugin-owned:
  `src/plugins/macro/workspace-template`

`apps/full-app` is partially simplified:

- the duplicate local `csv-viewer` registration is removed
- frontend and backend still need the future `@boring/core/app/front` and
  `@boring/core/app/server` composition layer
- SPA serving, Better Auth proxying, core boot, workspace membership, and
  per-workspace bridge maps still need to move out of full-app server code

`@boring/core/app` does not exist yet. The core-backed composition work remains
the next phase.

## Target Ownership

### `@boring/core/server`

Owns auth, DB, config, workspace membership, workspace access helpers, and the
core Fastify app factory.

Move here:

- `registerSpaFrontend`
- `registerBetterAuthProxy`
- `createPostgresCoreApp`
- `createWorkspaceAccessResolver`

Rules:

- no imports from `@boring/agent`
- no workspace UI bridge orchestration
- custom stores/auth keep using lower-level `createCoreApp`

### `@boring/core/front`

Owns `CoreFront`, core auth pages, user/workspace settings pages, and core
frontend providers.

Rules:

- no imports from `@boring/agent`
- no workspace layout internals beyond documented public APIs

### `@boring/core/app`

Owns reusable app-level composition for core-backed apps. Split this subpath
into front and server entrypoints:

- `@boring/core/app/front`
- `@boring/core/app/server`

The server entrypoint is the only core subpath that may intentionally import
`@boring/agent/server` and `@boring/workspace/server`. It should build on the
workspace-agent server bindings instead of reimplementing them.

Export it as a separate package subpath. Do not re-export it from
`@boring/core/server` or the core root.

Target front API:

```tsx
<CoreWorkspaceAgentFront
  authPages={authPages}
  chatPanel={ChatPanel}
  useSessions={useSessions}
  renderTopBar={(props) => <AppTopBar {...props} />}
/>
```

`CoreWorkspaceAgentFront` gets workspace identity from core route state. It
does not accept a `workspaceId` prop. It also does not import agent frontend
code; the app supplies the concrete `ChatPanel` and `useSessions` hook.

Target server API:

```ts
const app = await createCoreWorkspaceAgentServer({
  config,
  workspaceRoot,
  appRoot,
  sandboxHandleStore, // optional override
  plugins,
})
```

Server composition adds:

- core boot/config/auth/DB
- workspace membership checks
- per-user/per-workspace root resolution
- default `WorkspaceRuntimeSandboxHandleStore` from `@boring/core/server`, with
  optional override
- core-owned SPA/auth serving helpers

### `@boring/workspace`

Owns workspace layout runtime, layout preferences, plugin registries, default
workspace plugins, filesystem UI/data behavior, bridge commands, and workspace
frontend composition.

Keep or add:

- filesystem plugin panels such as `code-editor`, `markdown-editor`,
  `csv-viewer`, and `empty-file-panel`
- `registerWorkspaceUiBridge` in `@boring/workspace/server`
- `createWorkspaceUiTools`, `uiRoutes`, and `createInMemoryBridge`

`registerWorkspaceUiBridge` should own bridge lifecycle and expose enough hooks
for both standalone and core-backed servers:

- standalone mode can use one in-memory bridge for the app
- core-backed mode can resolve a bridge by authenticated workspace id
- callers can create UI tools for the same bridge used by `uiRoutes`
- callers can dispose bridges by workspace id and run idle cleanup

### `@boring/workspace/app`

Owns standalone workspace composition for users who want workspace without
core. Split this subpath into front and server entrypoints:

- `@boring/workspace/app/front`
- `@boring/workspace/app/server`

Target front API:

```tsx
<WorkspaceAgentFront
  chatPanel={ChatPanel}
  useSessions={useSessions}
  workspaceId={workspaceId}
/>
```

`WorkspaceAgentFrontProps.workspaceId` is required in standalone mode.
`useSessions` remains injectable so workspace front code does not import
`@boring/agent/front`.

Target server API:

```ts
const app = await createWorkspaceAgentServer({
  workspaceRoot,
  templatePath,
  mode,
  plugins,
})
```

Rules:

- `front` and `shared` code do not value-import `@boring/agent`
- `@boring/workspace/app/front` exports React/browser composition only
- `@boring/workspace/app/server` exports Node/Fastify composition only
- `ChatCenteredShell` stays in the workspace root API but receives an injected
  chat panel component instead of importing `@boring/agent/front`
- `WorkspaceAgentFront` composes workspace UI with an injected chat panel
- `createWorkspaceAgentServer` remains the standalone workspace-agent server
  composition helper for users who want workspace without core
- expose `createWorkspaceAgentServerBindings` so standalone and core-backed
  composition can share server plugin tools, system prompt append text,
  workspace skill paths, and provisioning behavior

`createWorkspaceAgentServerBindings` must not assume one UI bridge per Fastify
app. UI bridge routing/tools are supplied by `registerWorkspaceUiBridge` so
standalone and core-backed composition can choose one-app or per-workspace
bridge lifecycles.

File naming should mirror public API names:

- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`
- `packages/workspace/src/app/front/index.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/workspace/src/app/server/index.ts`
- `packages/core/src/app/front/CoreWorkspaceAgentFront.tsx`
- `packages/core/src/app/front/index.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/core/src/app/server/index.ts`

Do not keep compatibility wrappers for deprecated workspace/core app names.
If a temporary alias is needed during a local intermediate patch, remove it
before final verification.

### Apps

`apps/full-app` should only own:

- app branding and top-bar choices
- app-specific route declarations and extra route guards
- deployment/runtime entrypoint
- demo/showcase seed behavior
- truly app-specific production/dev serving decisions

Standard auth/workspace route guards belong in `@boring/core/app/front`.

`apps/workspace-playground` should only own:

- fixture seeding
- Vite dev proxy setup
- playground-only plugins and fixtures
- showcase/debug query handling

## Target App Shapes

### Full App Front

```tsx
import { ChatPanel } from "@boring/agent"
import { useSessions } from "@boring/agent/front"
import { CoreWorkspaceAgentFront } from "@boring/core/app/front"

createRoot(root).render(
  <CoreWorkspaceAgentFront
    authPages={authPages}
    chatPanel={ChatPanel}
    useSessions={useSessions}
    renderTopBar={(props) => <AppTopBar {...props} />}
  />,
)
```

### Full App Server

```ts
const app = await createCoreWorkspaceAgentServer({
  config,
  workspaceRoot,
  appRoot,
  sandboxHandleStore, // optional override
  plugins,
})

await app.listen({ host: config.host, port: config.port })
```

`sandboxHandleStore` is optional. If omitted, `createCoreWorkspaceAgentServer`
creates the default workspace-runtime sandbox handle store from the core
workspace store.

### Workspace Playground Front

```tsx
import { ChatPanel } from "@boring/agent"
import { useSessions } from "@boring/agent/front"
import { WorkspaceAgentFront } from "@boring/workspace/app/front"

createRoot(root).render(
  <WorkspaceAgentFront
    chatPanel={ChatPanel}
    useSessions={useSessions}
    workspaceId="playground"
    plugins={[playgroundDataCatalogPlugin]}
    chatParams={{ debug }}
    onActiveSessionIdChange={seedShowcaseIfNeeded}
  />,
)
```

### Workspace Playground Server

```ts
import { createWorkspaceAgentServer } from "@boring/workspace/app/server"

const app = await createWorkspaceAgentServer({
  workspaceRoot,
  templatePath,
  mode: "local",
  plugins: [createPlaygroundDataServerPlugin({ workspaceRoot })],
})
```

The playground remains standalone. It should not adopt `CoreFront`, core auth,
DB, or membership.

## Implementation Order

1. Done: remove the workspace-front value import from `@boring/agent/front`:
   `ChatCenteredShell` should accept an injected chat panel component and keep
   only local structural prop types.
2. Done: add workspace app package surface:
   `packages/workspace/package.json#exports`, `tsup.config.ts`, DTS entries,
   front/server tsconfigs, test aliases, and Vite aliases must all know about
   `@boring/workspace/app/front` and `@boring/workspace/app/server`.
3. Done: add `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`, require
   `workspaceId: string`, and export it from `@boring/workspace/app/front`.
4. Done: move the composed standalone server factory to
   `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`; export it
   from `@boring/workspace/app/server`.
5. Done: keep lower-level bridge primitives in `@boring/workspace/server`;
   composed app creation is exported only from `@boring/workspace/app/server`.
6. Done: add `registerWorkspaceUiBridge` in `@boring/workspace/server`, backed by
   `createInMemoryBridge`, `uiRoutes`, and `createWorkspaceUiTools`.
7. Done: add bridge lifecycle controls before full-app server migration: dispose by
   workspace id, idle cleanup, and bounded pending-command queues.
8. Done: extract `createWorkspaceAgentServerBindings` in
   `@boring/workspace/app/server`. It should build server plugin tools, system
   prompt append text, workspace skill paths, and provisioning behavior without
   creating a standalone Fastify app or assuming one UI bridge per app.
9. Done: rebuild `createWorkspaceAgentServer` on top of
   `createWorkspaceAgentServerBindings`, `registerWorkspaceUiBridge`, and
   `createAgentApp`.
10. Done: update first-party consumers of the workspace app names and subpaths:
   workspace tests, `apps/workspace-playground`, `apps/boring-macro-v2`, and any
   root workspace re-exports.
11. Done: update workspace-playground front code to use `WorkspaceAgentFront` from
    `@boring/workspace/app/front`.
12. Done: update workspace-playground server/Vite config to use
    `createWorkspaceAgentServer` from `@boring/workspace/app/server`.
13. Done: confirm `csv-viewer` and related file-backed panels are owned/exported by
    the filesystem plugin in `@boring/workspace`; if any still only exist in
    full-app, move them before removing the full-app copies.
14. Audit and update core app package surface:
    `packages/core/package.json#exports`, `tsup.config.ts`, tsconfig paths, and
    dependency/external settings must all know about `@boring/core/app/front`
    and `@boring/core/app/server`. If `@boring/core/app/server` imports
    `@boring/agent/server`, keep that dependency documented and confined by
    import-boundary scans.
15. Move SPA serving and Better Auth proxy helpers to `@boring/core/server`.
16. Add `createPostgresCoreApp` in `@boring/core/server`.
17. Add `createWorkspaceAccessResolver` in `@boring/core/server`.
18. Ensure `WorkspaceRuntimeSandboxHandleStore` remains exported from
    `@boring/core/server`; add a small default factory only if
    `createCoreWorkspaceAgentServer` needs one to avoid duplicating store setup.
19. Add `@boring/core/app/front` with `CoreWorkspaceAgentFront`, which composes
    `CoreFront`, core route/auth state, and `WorkspaceAgentFront`.
20. Update full-app front code directly to `CoreWorkspaceAgentFront`. Do not
    leave an interim `WorkspaceAgentFront` migration in full-app.
21. Add `@boring/core/app/server` with `createCoreWorkspaceAgentServer`, reusing
    `createWorkspaceAgentServerBindings`, `registerWorkspaceUiBridge`, and
    layering core auth/membership/root resolution on top.
22. Update full-app server to `createCoreWorkspaceAgentServer`.
23. Remove any temporary compatibility aliases and old workspace app
    names before final verification.
24. Replace direct package-source imports in playground apps with exported
    package subpaths where possible.
25. Update stale package docs and metadata:
    `packages/workspace/package.json`, `packages/workspace/docs/INTERFACES.md`,
    `packages/workspace/docs/plans/README.md`, and old plan files that still
    describe workspace as frontend-only.

## Done Criteria

- `apps/full-app/src/server/main.ts` no longer imports `registerAgentRoutes`,
  `createInMemoryBridge`, `createWorkspaceUiTools`, or `uiRoutes` directly.
- `apps/full-app/src/server/main.ts` no longer defines auth proxy, SPA
  fallback, workspace id validation, workspace root resolution, or bridge maps.
- `apps/full-app/src/front/main.tsx` no longer registers `csv-viewer` or
  assembles `WorkspaceProvider` plus `WorkspaceChatShell` manually.
- `apps/full-app/src/front/main.tsx` uses `CoreWorkspaceAgentFront`, not an
  interim `WorkspaceAgentFront`.
- `apps/workspace-playground` stays free of core auth, DB, membership, and
  custom bridge wiring.
- `apps/workspace-playground/src/front/App.tsx` uses `WorkspaceAgentFront` from
  `@boring/workspace/app/front`.
- `apps/workspace-playground/vite.config.ts` uses `createWorkspaceAgentServer`
  from `@boring/workspace/app/server`.
- Playground Vite config and server bootstrap do not import from
  `@boring/workspace/app/front`.
- `@boring/workspace` exports `./app/front` and `./app/server`; no old
  `./app` compatibility export is kept.
- `packages/workspace/tsup.config.ts`, DTS entries, tsconfigs, test aliases,
  and local Vite aliases all match the new `app/front` and `app/server`
  subpaths.
- No first-party code imports `@boring/workspace/app`,
  `@boring/workspace/server` for composed app creation, or
  old package-source composed server factory paths.
- `@boring/core` exports `./app/front` and `./app/server`; package exports,
  tsup entries, tsconfig paths, and dependency/external settings match those
  subpaths.
- `WorkspaceAgentFrontProps.workspaceId` is required. `CoreWorkspaceAgentFront`
  resolves workspace identity from core route state instead of accepting a
  `workspaceId` prop.
- Full-app supplies `ChatPanel` and `useSessions` to `CoreWorkspaceAgentFront`;
  `@boring/core/app/front` does not import `@boring/agent` or
  `@boring/agent/front`.
- `@boring/core/server`, `@boring/core/front`, and the core root have no
  `@boring/agent` imports.
- `@boring/core/app/server` is the only core subpath allowed to import
  `@boring/agent/server`; it does not import `@boring/agent/front` or the
  `@boring/agent` root.
- Core-backed server composition uses a per-workspace bridge lifecycle. It does
  not share a singleton standalone bridge across authenticated workspaces.
- `@boring/workspace/front` and `@boring/workspace/shared` have no
  `@boring/agent` value imports.
- `@boring/workspace/app/front` has no server-only imports.
- `@boring/workspace/app/server` has no React/browser imports.
- `@boring/core/app/front` has no server-only imports.
- `@boring/core/app/server` has no React/browser imports.
- Front/server plugin entries remain split by runtime, with browser-safe
  shared constants/types.
- Relevant typecheck, lint, and package tests pass.
