# Plugin outputs and workspace isolation plan

**Status:** draft implementation plan
**Owners:** workspace
**Last updated:** 2026-04-30

## Goal

Make plugins the owners of user-facing workspace capabilities, while
keeping `@boring/workspace` as the host substrate.

The immediate correction is that a left workbench tab should not be a
hardcoded workbench behavior or an implicit `PanelConfig.placement`.
It should be an explicit plugin output. The same rule applies to file
search, file hooks, file open behavior, and file routing: those belong to
the filesystem plugin, with the workspace only providing generic
registries, hosts, event transport, and UI manipulation contracts.

## Current problems

1. **Left tabs are too implicit.** Plugins currently express a workbench
   left tab as a normal panel with `placement: "left-tab"`. That makes
   the host infer semantics from a layout hint instead of consuming an
   intentional plugin output.

2. **The left pane still knows filesystem details.**
   `WorkbenchLeftPane` imports and renders the filesystem file tree
   directly. It also has built-in handling for the Data tab. That means
   `excludeDefaults` and plugin composition cannot fully own the visible
   left-tab set.

3. **Filesystem data lives in `front/`.** `front/data` contains
   filesystem-specific client methods, hooks, event invalidation, and SSE
   subscription logic. Those are not generic workspace frontend
   primitives; they are filesystem plugin runtime.

4. **Artifact routing hardcodes file plugin behavior.** The artifact
   surface still knows about `code-editor`, `markdown-editor`,
   `csv-viewer`, and `empty-file-panel` fallback behavior. File type
   routing should be contributed by whichever plugin handles files.

5. **Workspace still imports agent types.** The workspace shared/plugin
   layer imports `@boring/agent` types and validation. That violates the
   package invariant that the app shell wires agent and workspace
   together.

## Target contract

Introduce a first-class plugin output model. The exact names can be
adjusted during implementation, but the shape should be discriminated and
explicit:

```ts
type PluginOutput =
  | LeftTabOutput
  | CenterPanelOutput
  | CatalogOutput
  | CommandOutput
  | BindingOutput
  | FileHandlerOutput

interface LeftTabOutput {
  type: "left-tab"
  id: string
  title: string
  icon?: ReactNode
  component: ComponentType<LeftTabProps>
}

interface LeftTabProps {
  query: string
  rootDir?: string
  bridge: WorkspaceBridge
}
```

The host may keep existing `panels`, `commands`, `catalogs`, and
`bindings` arrays as temporary compatibility sugar, but plugin bootstrap
should normalize everything into explicit outputs before registering
with the lower-level registries.

## Ownership boundaries

Workspace core owns:

- plugin bootstrap and validation
- command, catalog, panel, and output registries
- `DockviewShell` and generic panel hosting
- generic left-tab host chrome
- command palette shell
- event bus and UI command dispatch contract
- generic data explorer primitives, if they remain domain-neutral

Filesystem plugin owns:

- Files left-tab output
- Files catalog output
- filesystem client and React hooks
- file event stream and cache invalidation binding
- file editor panels and file-pattern handlers
- open-file behavior through the workspace UI command contract

Static data / domain plugins own:

- their own left-tab outputs
- their own catalogs
- their own panel routing rules
- their own data source adapters

The app shell owns:

- the actual chat panel dependency
- agent server composition
- app-specific plugins and runtime dependencies

## Implementation plan

### Phase 1: Add explicit outputs

- Add `PluginOutput` types under `packages/workspace/src/shared/plugins/`.
- Add validation for output IDs, output kinds, and renderable components.
- Update plugin bootstrap to normalize legacy contribution arrays into
  outputs, then fan outputs into existing registries.
- Keep existing public fields for this pass so callers do not break
  while the internals move.

Acceptance:

- Existing plugins still register.
- Tests cover duplicate output IDs and invalid output shapes.

### Phase 2: Make the left pane a generic output host

- Replace `WorkbenchLeftPane` filesystem/Data special cases with a
  generic host for `left-tab` outputs.
- Pass shared `LeftTabProps` into each tab: `query`, `rootDir`, and the
  workspace bridge/UI contract.
- Move the Files tab declaration into `filesystemPlugin` as a
  `left-tab` output.
- Move the Data tab declaration into the static data plugin factory.

Acceptance:

- No direct import from `front/chrome/workbench-left` to
  `plugins/filesystemPlugin`.
- Files tab disappears when the filesystem default plugin is excluded.
- Data tab appears only when a data plugin contributes it.

### Phase 3: Move filesystem hooks into the filesystem plugin

- Move the implementation of filesystem client, hooks, event stream, and
  invalidation into `plugins/filesystemPlugin/data`.
- Leave `front/data` as compatibility re-export wrappers for now. Do not
  delete files in this pass.
- Update filesystem plugin internals to import from its own data module,
  not from `front/data`.
- Keep generic React Query provider behavior in workspace core only if it
  is still domain-neutral after the move.

Acceptance:

- `plugins/filesystemPlugin/**` no longer imports `front/data`.
- Public imports from `front/data` still work through wrappers.
- File tree, file search, write, move, create directory, delete, and
  invalidation tests still pass.

### Phase 4: Move file routing out of artifact surface

- Add a plugin output for file handlers or panel resolvers.
- Let filesystem plugin contribute default handlers for code, markdown,
  CSV/TSV, and empty-file fallback.
- Make artifact surface ask the registry for a handler instead of
  hardcoding plugin panel IDs.

Acceptance:

- Artifact surface has no hardcoded filesystem panel IDs.
- Excluding filesystem defaults removes filesystem routing.
- A host/plugin can override routing by registering a later handler.

### Phase 5: Remove workspace-to-agent imports

- Replace workspace shared usage of `@boring/agent` types with local
  structural contracts or app-shell-provided adapters.
- Move agent-tool validation out of client-facing workspace shared code.
- Keep server-side composition in app-shell/server entry points only.

Acceptance:

- `rg '@boring/agent' packages/workspace/src` returns only allowed
  app-shell/server adapter locations, or zero if the wrapper is moved out.
- Typecheck catches no regressions.

## Test plan

- `pnpm --filter @boring/workspace typecheck`
- Workspace plugin tests for output validation and bootstrap fan-out.
- `WorkspaceProvider` tests for default plugin inclusion/exclusion.
- `WorkbenchLeftPane` tests for generic left-tab hosting.
- Filesystem plugin tests for Files tab, catalog search, and open-file
  command dispatch.
- Artifact surface tests for file handler resolution and host override.
- Browser smoke: command palette Files search opens the selected file in
  the workbench with Enter.

## Non-goals for this pass

- No npm plugin loading changes.
- No plugin dependency graph.
- No route-as-plugin-output support.
- No deletion of compatibility wrapper files until the migration is
  proven and explicitly approved.

