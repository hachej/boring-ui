# Plugin outputs and workspace isolation plan

**Status:** implemented migration plan
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

## Problems Addressed

1. **Left tabs are too implicit.** Plugins currently express a workbench
   left tab as a normal panel with `placement: "left-tab"`. That makes
   the host infer semantics from a layout hint instead of consuming an
   intentional plugin output.

2. **The left pane knew filesystem details.**
   `WorkbenchLeftPane` imported and rendered the filesystem file tree
   directly. It also had built-in handling for the Data tab. That meant
   `excludeDefaults` and plugin composition could not fully own the visible
   left-tab set.

3. **Filesystem data lived in `front/`.** `front/data` contained
   filesystem-specific client methods, hooks, event invalidation, and SSE
   subscription logic. Those are not generic workspace frontend
   primitives; they are filesystem plugin runtime.

4. **Event domains were not plugin-owned.** The event bus is generic
   workspace substrate, but event names such as `file:changed`
   make filesystem behavior look like workspace core behavior. Plugin
   events must be keyed by their owning plugin id, for example
   `filesystem:file.changed`.

5. **Artifact routing hardcoded file plugin behavior.** The artifact
   surface knew about `code-editor`, `markdown-editor`,
   `csv-viewer`, and `empty-file-panel` fallback behavior. File type
   routing should be contributed by whichever plugin handles files.

6. **Workspace imported agent types.** The workspace shared/plugin
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
  | SurfaceResolverOutput;

interface LeftTabOutput {
  type: "left-tab";
  id: string;
  title: string;
  icon?: ReactNode;
  component: ComponentType<LeftTabProps>;
}

interface LeftTabProps {
  query: string;
  rootDir?: string;
  bridge: WorkspaceBridge;
}
```

The host may keep existing `panels`, `commands`, `catalogs`, and
`bindings` arrays as temporary compatibility sugar, but plugin bootstrap
should normalize everything into explicit outputs before registering
with the lower-level registries.

## Ownership boundaries

Workspace core owns:

- plugin bootstrap and validation
- command, catalog, panel, output, and surface-resolver registries
- `DockviewShell` and generic panel hosting
- generic left-tab host chrome
- command palette shell
- event bus transport and workspace-owned event contracts
- generic data explorer primitives, if they remain domain-neutral
  - superseded for explorer panes by `GENERIC_EXPLORER_PLUGIN_PLAN.md`: generic explorer becomes a workspace-owned feature plugin once it owns pane/output contracts
- the generic resolver dispatch loop: given an open request, ask registered
  resolvers in precedence order and open the returned panel config

Filesystem plugin owns:

- Files left-tab output
- Files catalog output
- filesystem client and React hooks
- file event namespace and constants (`filesystem:file.*`)
- file event stream and cache invalidation binding
- file editor panels and fallback panels
- the filesystem surface resolver: path/file requests, extension or glob
  matching, mapping paths to `code-editor` / `markdown-editor` / `csv-viewer`
  / fallback panels, and open-file behavior through the workspace UI command
  contract

Static data / domain plugins own:

- their own left-tab outputs
- their own catalogs
- their own surface resolvers for their resource types, e.g. series,
  datasets, SQL results, images, notebooks, dashboards, or app-specific
  artifacts
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
- Move the Data tab declaration into data catalog plugin outputs.

Acceptance:

- No direct import from `front/chrome/workbench-left` to
  `plugins/filesystemPlugin`.
- Files tab disappears when the filesystem default plugin is excluded.
- Data tab appears only when a data plugin contributes it.

### Phase 3: Move filesystem hooks into the filesystem plugin

- Move the implementation of filesystem client, hooks, event stream, and
  invalidation into `plugins/filesystemPlugin/front/data`.
- Delete `front/data`; do **not** keep compatibility re-export wrappers.
  Filesystem data APIs are plugin-owned and must be imported from the
  filesystem plugin package surface.
- Update filesystem plugin internals and all first-party consumers to import
  from `plugins/filesystemPlugin/front/data`, not from `front/data`.
- Keep generic React Query provider behavior in workspace core only if it
  is still domain-neutral after the move; otherwise let the filesystem plugin
  own its provider/binding.

Acceptance:

- No tracked files remain under `packages/workspace/src/front/data/`.
- No first-party code imports `front/data`.
- Filesystem data APIs remain available through the filesystem plugin public
  surface, not through `front/data` compatibility wrappers.
- File tree, file search, write, move, create directory, delete, and
  invalidation tests still pass.

### Phase 4: Make plugin events composable and plugin-keyed

- Split the event map into workspace-core events plus an augmentable
  plugin event map.
- Key workspace-owned events with the workspace id:
  `workspace:ui.command`, `workspace:editor.save.start`, and
  `workspace:editor.save.end`.
- Let the filesystem plugin contribute typed event constants and payloads:
  `filesystem:file.changed`, `filesystem:file.created`,
  `filesystem:file.moved`, and `filesystem:file.deleted`.
- Replace bare event strings in emitters/subscribers with the owning
  contract constants.

Acceptance:

- No production code emits or subscribes to bare `file:*` or `ui:command`
  names.
- The generic event bus remains in `front/events`.
- Filesystem event names are defined by the filesystem plugin.
- Existing file invalidation, open-file, dock rename/delete, and UI command
  tests still pass after migrating event names.

### Phase 5: Move artifact routing out of artifact surface

Do **not** add a filesystem-specific `FileHandlerOutput` to the shared plugin
model. That would make the shared plugin contract know about paths, files,
globs, and extensions. Instead, add a generic `SurfaceResolverOutput`:
shared workspace knows only that a plugin can resolve an open request into an
`OpenPanelConfig`; each plugin owns the request kinds and mapping rules for
its domain.

Example shape:

```ts
interface SurfaceOpenRequest {
  kind: string;
  target: string;
  meta?: Record<string, unknown>;
}

interface SurfacePanelResolution {
  component: string;
  id?: string;
  title?: string;
  params?: Record<string, unknown>;
  score?: number;
}

interface SurfaceResolverOutput {
  type: "surface-resolver";
  resolver: {
    id: string;
    resolve(request: SurfaceOpenRequest): SurfacePanelResolution | undefined;
  };
}
```

Mapping ownership:

- Workspace core owns the resolver registry and dispatch loop only:
  collect resolver results and pick the best score.
- Filesystem plugin owns `workspace.open.path` requests and maps file paths to
  its panels (`code-editor`, `markdown-editor`, `csv-viewer`, fallback, etc.).
- Data catalog plugin owns `data-catalog.open-row` requests and maps rows to
  its visualization panel. Catalog search remains a separate catalog output.
- Data/domain plugins own their own resource requests, for example
  `{ type: "series", id: "GDP" } -> chart panel` or
  `{ type: "sql-result", id: "q1" } -> table panel`.
- The app shell owns plugin order. Later plugins should be able to override
  earlier/default resolvers, so an app plugin can replace filesystem's CSV
  mapping or add domain-specific routing without changing workspace core.

Make artifact surface ask the surface resolver registry for an open-panel
config instead of hardcoding filesystem panel IDs or file extensions.

Acceptance:

- Artifact surface has no hardcoded filesystem panel IDs, extension maps, or
  fallback panel IDs.
- Shared plugin types do not mention file/path/glob-specific handler fields.
- Filesystem plugin contributes the resolver for file/path requests.
- Excluding filesystem defaults removes filesystem file routing.
- A host/plugin can override routing by registering a later resolver.

### Phase 6: Remove workspace-to-agent imports

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
- Artifact surface tests for surface resolver resolution and host override.
- Browser smoke: command palette Files search opens the selected file in
  the workbench with Enter.

## Non-goals for this pass

- No npm plugin loading changes.
- No plugin dependency graph.
- No route-as-plugin-output support.
- No deletion of compatibility wrapper files until the migration is
  proven and explicitly approved.
