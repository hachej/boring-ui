# Generic Explorer Plugin Plan

Last updated: 2026-05-01

Status: draft plan. No code has moved yet.

## Problem

Workspace currently has a good generic `DataExplorer` primitive under
`@hachej/boring-data-explorer/front`. The data-catalog-specific legacy wrappers
under `src/front/components/data-catalog` have been removed; data catalog behavior
now lives only in the `@hachej/boring-data-catalog` package. Feret v2 shows the next requirement: not
just flat/faceted database rows, but mixed project trees with
filesystem rows, virtual DB rows, section filters, friendly labels, and domain
open routing.

We need a cleaner ownership model:

- `front/` contains only workspace host, chrome, registries, bridge, layout,
  design primitives, and truly generic helpers.
- `plugins/` owns domain panes, domain data, domain catalogs, domain surface
  resolvers, and reusable plugin-level feature families.
- Generic explorer behavior should be reusable by many plugins without making
  filesystem depend on data catalog or data catalog depend on filesystem.

## Decision

Create a dedicated generic explorer plugin/family:

```txt
plugins/data-explorer/src/
  index.tsx
  constants.ts
  types.ts
  Explorer.tsx
  ExplorerPane.tsx
  createExplorerOutputs.ts
  adapters.ts
  useExplorerState.ts
  __tests__/
```

This plugin is not a domain plugin. It is a reusable feature plugin that owns
explorer panes and explorer row contracts. This adds a third plugin category:
workspace-owned feature plugins. They live under `src/plugins/` because they
emit panes/outputs and own a feature contract, but they do not encode an app
domain like files, data catalog, or Feret. Domain plugins compose it:

```txt
data catalog package    -> uses data explorer package for generic explorer rendering
filesystemPlugin     -> may use data explorer package for project/friendly trees later
Feret app plugin     -> uses data explorer package directly for Project Tree and Data/Feret
future domain plugin -> uses data explorer package for symbols/docs/jobs/issues/etc.
```

Do **not** put generic explorer under the `@hachej/boring-data-catalog` package. That would make other
domains depend on a data-catalog name and blur ownership.

## Target Package Shape

```txt
src/front/
  bridge/              # workspace bridge client/dispatcher only
  chrome/              # shell chrome panes: chat host, artifact surface, workbench left
  components/
    ui/                # shadcn-style primitives
    CommandPalette.tsx # generic workspace command/catalog UI
    ErrorChip.tsx
    PanelErrorBoundary.tsx
    WorkspaceLoadingState.tsx
    recent/            # generic recent command/catalog state
  dock/                # dockview shell/chrome
  events/              # cross-cutting event bus
  hooks/               # generic workspace hooks
  layout/              # generic layouts/top bar
  lib/                 # generic utils/validation
  plugin/              # registry consumers/inspector/error boundary
  provider/            # WorkspaceProvider
  registry/            # registries and core registrations
  store/               # layout/workspace UI store only
  testing/
  theme/
  toast/

src/plugins/
  filesystemPlugin/    # files/editors/tree specialization

root plugins/
  data-explorer/       # @hachej/boring-data-explorer
  data-catalog/        # @hachej/boring-data-catalog
```

## Explorer Plugin API Shape

### Row model

The current `ExplorerRow` is useful but too flat for Feret project trees. Keep
flat rows as the base, then add tree/section nodes.

```ts
export type ExplorerBadge = {
  code: string;
  tooltip?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export type ExplorerFilterConfig = {
  key: string;
  label: string;
  order?: string[];
  formatValue?: (value: string) => string;
};

export type DragPayload = { mimeType: string; value: string };

export type ExplorerItemRow<RowKind extends string = string> = {
  kind?: "item";
  /** Domain/type discriminant used by app plugins for routing. */
  rowKind?: RowKind;
  id: string;
  title: string;
  subtitle?: string;
  group?: string;
  leading?: ExplorerBadge;
  trailing?: ExplorerBadge[];
  meta?: string;
  icon?: React.ComponentType<{ className?: string }>;
  payload?: Record<string, unknown>;
};

export type ExplorerSectionNode = {
  kind: "section";
  id: string;
  title: string;
  subtitle?: string;
  filters?: ExplorerFilterConfig[];
  count?: number;
  defaultExpanded?: boolean;
};

export type ExplorerFolderNode = {
  kind: "folder";
  id: string;
  title: string;
  subtitle?: string;
  count?: number;
  defaultExpanded?: boolean;
};

export type ExplorerNode =
  | ExplorerItemRow
  | ExplorerSectionNode
  | ExplorerFolderNode;
```

### Flat adapter

Keep the current adapter semantics for global catalogs and data tabs.

```ts
export type ExplorerSearchArgs = {
  query: string;
  filters: Record<string, string[]>;
  group?: { key: string; value: string };
  limit: number;
  offset: number;
  signal?: AbortSignal;
};

export type ExplorerSearchResult = {
  items: ExplorerItemRow[];
  total: number;
  hasMore: boolean;
};

export type ExplorerFacetValue = { value: string; count: number };
export type ExplorerFacets = Record<string, ExplorerFacetValue[]>;
export type ExplorerFacetsArgs = {
  filters: Record<string, string[]>;
  signal?: AbortSignal;
};

export type ExplorerFlatAdapter = {
  search(args: ExplorerSearchArgs): Promise<ExplorerSearchResult>;
  fetchFacets?(args: ExplorerFacetsArgs): Promise<ExplorerFacets>;
};
```

### Tree adapter

Add tree/provider support for Feret Project Tree and future friendly project
views.

```ts
export type ExplorerTreeArgs = {
  query: string;
  /** Global tree filters, if the host exposes any. */
  filters: Record<string, string[]>;
  /** Filters scoped to the parent/section being loaded. */
  scopedFilters?: Record<string, string[]>;
  parentId?: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
};

export type ExplorerTreeResult = {
  nodes: ExplorerNode[];
  total?: number;
  hasMore?: boolean;
};

export type ExplorerTreeAdapter = {
  roots(args: ExplorerTreeArgs): Promise<ExplorerTreeResult>;
  children(
    parentId: string,
    args: ExplorerTreeArgs,
  ): Promise<ExplorerTreeResult>;
  fetchNodeFacets?(
    nodeId: string,
    args: ExplorerFacetsArgs,
  ): Promise<ExplorerFacets>;
};
```

### Component/pane outputs

```ts
type ExplorerBaseProps = {
  facets?: ExplorerFilterConfig[];
  groupBy?: string;
  onActivate?: (row: ExplorerItemRow) => void;
  getDragPayload?: (row: ExplorerItemRow) => DragPayload | null | undefined;
  emptyState?: React.ReactNode;
  searchPlaceholder?: string;
  query?: string;
  searchable?: boolean;
  className?: string;
};

export type ExplorerProps =
  | (ExplorerBaseProps & {
      mode?: "flat";
      flatAdapter: ExplorerFlatAdapter;
      treeAdapter?: never;
    })
  | (ExplorerBaseProps & {
      mode: "tree";
      treeAdapter: ExplorerTreeAdapter;
      flatAdapter?: never;
    })
  | (ExplorerBaseProps & {
      /** Auto means: use tree when only treeAdapter is provided, else flat. */
      mode: "auto";
      flatAdapter?: ExplorerFlatAdapter;
      treeAdapter?: ExplorerTreeAdapter;
    });

export type CreateExplorerOutputsOptions = ExplorerProps & {
  id: string;
  label: string;
  leftTabId?: string;
  includeLeftTab?: boolean;
  panelId?: string;
  includePanel?: boolean;
  /** Existing workspace core panel config source type. */
  source?: PanelConfig["source"];
};
```

`createExplorerOutputs()` emits generic left-tab/panel outputs only. It does not
emit data-catalog catalogs or data-catalog surface resolvers.

Implementation must validate adapter/mode combinations at runtime too:

- `flat` requires `flatAdapter`.
- `tree` requires `treeAdapter`.
- `auto` chooses `tree` only when `treeAdapter` exists and `flatAdapter` does
  not; otherwise it chooses `flat`.
- missing adapters throw a development-facing invariant error rather than
  rendering an empty explorer. The `auto` union may be tightened to require at
  least one adapter during implementation; runtime validation remains required
  either way.

## Data Catalog After Refactor

the `@hachej/boring-data-catalog` package becomes a specialization that composes explorer outputs:

```txt
@hachej/boring-data-catalog/
  index.tsx             # createDataCatalogPlugin, appendDataCatalogOutputs
  constants.ts
  types.ts
  catalogs.ts           # data catalog catalog config helpers
  surfaceResolver.ts
  openVisualization.ts
  hooks.ts
  server/
```

Responsibilities:

- choose data-catalog defaults: labels, empty state, search placeholder
- register `CatalogConfig`
- default `onSelect` posts `openSurface`
- create row visualization panel/resolver when requested
- provide server agent tool helpers for querying a catalog adapter

Non-responsibilities:

- own generic explorer rendering
- own generic explorer row state machine
- own filesystem/project tree behavior

Legacy `src/front/components/data-catalog` is removed. Consumers should use
`createDataCatalogPlugin()` / `appendDataCatalogOutputs()` or compose
`DataExplorer` directly until it moves to the `@hachej/boring-data-explorer` package.

## Feret v2 Requirements Driving Explorer Plugin

Feret needs two explorer usages.

### Data/Feret tab

Flat/faceted data explorer:

- DB/API-backed ingredient/document/formulation rows
- search input
- category/status/supplier facets
- row badges and cost/status metadata
- open row into domain pane
- drag ingredients into formulation builder later

This maps to `ExplorerFlatAdapter`.

### Feret Project Tree

Mixed tree explorer:

- real markdown/source files
- virtual DB rows: ingredient, formulation, process, scenario
- sections: Brief, Sources, Ingredients, Formulations, Notes, Reports
- section-local filters
- friendly labels hiding technical paths/extensions
- click routing by row type:
  - markdown -> filesystem markdown editor/open file
  - source file -> source preview/extraction review
  - ingredient -> ingredient detail pane
  - formulation -> formulation builder/detail pane

This maps to `ExplorerTreeAdapter` plus row `payload`/`kind` routing controlled
by the Feret app plugin. Section-local filters must stay scoped: the explorer
state tracks active filters per section/folder id and passes them to
`children(parentId, { scopedFilters })` rather than flattening them into global
filters.

## Current Component Ownership Audit

| Current location                              | Decision                                                                                          | Rationale                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@hachej/boring-data-explorer/front`       | Extracted to `plugins/data-explorer/src/front/*`                                                                | Generic feature family, but pane-capable and adapter-owned; multiple plugins depend on it.                                                           |
| `front/components/data-catalog/*`             | Removed                                                                                           | Data-catalog naming is domain-ish; real data catalog behavior is plugin-owned already.                                                               |
| `front/components/CommandPalette.tsx`         | Keep in `front/components`                                                                        | Generic workspace chrome over command/catalog registries, not a domain plugin.                                                                       |
| `front/components/recent/*`                   | Keep in `front/components` for now                                                                | Generic command/catalog recent state used by CommandPalette. Could become `commandPalette` subfolder later.                                          |
| `front/components/ErrorChip.tsx`              | Keep generic                                                                                      | Generic error UI primitive.                                                                                                                          |
| `front/components/PanelErrorBoundary.tsx`     | Keep generic                                                                                      | Generic plugin/panel safety boundary.                                                                                                                |
| `front/components/WorkspaceLoadingState.tsx`  | Keep generic                                                                                      | Generic shell loading UI.                                                                                                                            |
| `front/components/SessionList.tsx`            | Re-evaluate after checking package-root consumers and whether it is only used by `SessionBrowser` | If it is just session chrome, consolidate under `front/chrome/session-list`; if consumers need a standalone primitive, keep a re-exported primitive. |
| `@boring/ui/*`                       | Keep generic                                                                                      | Design primitives only.                                                                                                                              |
| `front/chrome/artifact-surface/*`             | Keep in front chrome                                                                              | Core workspace surface host, not plugin domain.                                                                                                      |
| `front/chrome/chat/*`                         | Keep in front chrome                                                                              | Chat host injection point, not agent/plugin domain.                                                                                                  |
| `front/chrome/empty-pane/*`                   | Keep or move to core chrome                                                                       | Generic shell fallback. Not a domain plugin.                                                                                                         |
| `front/chrome/session-list/*`                 | Keep in front chrome, maybe consolidate `SessionList` here                                        | Session chrome is host-level.                                                                                                                        |
| `front/chrome/workbench-left/*`               | Keep in front chrome                                                                              | Renders plugin left-tabs; host chrome.                                                                                                               |
| `plugins/filesystemPlugin/front/file-tree/*`        | Keep in filesystem plugin for now                                                                 | File-specific tree, path behavior, events, and open-file routing are domain-owned. May reuse explorer tree later.                                    |
| `plugins/filesystemPlugin/front/code-editor/*`      | Keep in filesystem plugin                                                                         | File editor domain and file data hooks.                                                                                                              |
| `plugins/filesystemPlugin/front/markdown-editor/*`  | Keep in filesystem plugin                                                                         | File editor domain and file data hooks.                                                                                                              |
| `plugins/filesystemPlugin/front/empty-file-panel/*` | Keep in filesystem plugin                                                                   | File-specific empty panel.                                                                                                                           |
| `@hachej/boring-data-catalog/front`        | Extracted to `plugins/data-catalog/src/front/*`; imports explorer from `@hachej/boring-data-explorer`                                      | Domain specialization.                                                                                                                               |

## Public API Migration

Avoid breaking current consumers in the first pass.

1. Add `plugins/data-explorer` and re-export explorer APIs from old package
   root names:
   - `DataExplorer` stays exported, but source moves.
   - `ExplorerRow`, `ExplorerAdapter`, `FacetConfig`, etc. stay exported with
     compatibility aliases.
2. Keep any workspace compatibility re-export thin and temporary if internal
   import churn requires it; the canonical API is `@hachej/boring-data-explorer/front`.
3. `DataCatalog` and `DataCatalogPane` root exports are removed now; use data catalog plugin helpers instead.
4. Move app/plugin imports to `plugins/data-explorer` or package-root exports.

## Implementation Beads

### Bead 1 — Explorer plugin skeleton

- Add `plugins/data-explorer/src` with current `DataExplorer` code moved mostly
  intact.
- Export compatibility aliases.
- Update internal imports from `@hachej/boring-data-explorer/front` to
  `plugins/data-explorer`.
- Tests: current DataExplorer tests pass unchanged after path update.

### Bead 2 — Data catalog plugin composition

- Change the `@hachej/boring-data-catalog` package to import explorer APIs from `@hachej/boring-data-explorer`.
- Split data catalog helpers into `catalogs.ts` if useful.
- Keep `front/components/data-catalog` removed; do not add compatibility wrappers back.
- Tests: data catalog package tests and public API tests.

### Bead 3 — Tree adapter design

- Add `ExplorerTreeAdapter`, `ExplorerNode`, section/folder node types.
- Add tree state hook or extend explorer state carefully, including per-section
  filter maps that flow into `ExplorerTreeArgs.scopedFilters`.
- Do not rewrite filesystem tree yet.
- Tests: adapter contract, expansion, per-node loading, abort handling.

### Bead 4 — Feret project tree spike

- In Feret v2/app playground, build a project tree using `ExplorerTreeAdapter`.
- Prove mixed rows and section filters.
- Keep row activation domain-owned by Feret plugin.
- Output is either a shippable Feret integration PR or a plan update with the
  gaps found during the spike.

### Bead 5 — Optional filesystem reuse

- Evaluate whether filesystem tree should remain custom or wrap explorer tree.
- Decision trigger: after the Feret project tree spike, compare required file
  tree behavior (path validation, file events, expand-to-file, selection, editor
  lifecycle) against explorer tree behavior.
- Exit criteria: record either `keep custom filesystem tree` or `migrate
filesystem tree to explorer tree` before the legacy data-catalog removal bead.
- Only migrate if benefits outweigh loss of file-tree-specific behavior.

## Non-goals

- Do not make every visual component a plugin. `@boring/ui`, layout,
  chrome hosts, registries, bridge, and provider stay front-owned.
- Do not force filesystem to depend on data catalog.
- Do not rewrite file tree in the first bead.
- Do not remove public exports without an explicit breaking cleanup bead.
- Do not allow reverse imports from `@hachej/boring-data-explorer` into domain plugins. Add or
  extend invariant lint so allowed direction is domain plugin -> data explorer package,
  never data explorer package -> data catalog package, filesystemPlugin, or app plugins.

## Acceptance Criteria

- `front/` contains only generic host/chrome/primitives after migration.
- Domain-named components do not live under `front/components`.
- Explorer APIs are reusable by data catalog, filesystem, and Feret without
  cross-domain plugin imports.
- Existing public API remains source-compatible until an approved breaking bead.
- Feret Project Tree requirements are representable without forking explorer UI.
