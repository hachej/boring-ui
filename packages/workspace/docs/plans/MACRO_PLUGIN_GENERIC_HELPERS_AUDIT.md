# Macro Plugin Generic Helpers Audit

Last updated: 2026-05-01

Status: draft audit / extraction plan. No implementation yet.

## Goal

Inspect `apps/boring-macro-v2/src/plugins/macro` in detail and identify which
pieces are truly macro-domain logic versus reusable workspace/plugin mechanics.
The aim is to reduce boilerplate in macro and future apps without moving macro
meaning into `@boring/workspace`.

This plan complements `GENERIC_EXPLORER_PLUGIN_PLAN.md`: macro is a concrete
consumer that should pressure-test generic explorer, surface resolver, open
surface, event, and REST adapter helpers.

## Current Macro Plugin Shape

```txt
apps/boring-macro-v2/src/plugins/macro/
  index.tsx                         # client plugin composition + chat suggestions
  constants.ts                      # macro ids, panel ids, surface kinds
  panels.tsx                        # definePanel wrappers for chart/deck
  surfaceResolver.ts                # macro surface routing rules
  catalogs.ts                       # data catalog output options
  data/
    macroSeriesAdapter.ts           # REST -> ExplorerAdapter
    macroSeriesData.ts              # series fetch/cache for panes
    macroSeriesTypes.ts             # series payload types
    macroSeriesUi.ts                # frequency labels, colors, openSeriesPane
  panels/
    ChartCanvasPane.tsx             # chart UI
    DeckPane.tsx                    # markdown deck UI + embeds
  routes/
    StandaloneDeckRoute.tsx         # app route component
  server/
    index.ts                        # server plugin, prompt, provisioning, routes
    routes/macro.ts                 # Fastify API routes
    services/*                      # ClickHouse/FRED domain services
    tools/macroTools.ts             # agent tools
  sdk/, transforms/, workspace-template/
```

## Ownership Rule

Move generic mechanics only when at least two plugins/apps can use them.
Keep macro semantics in macro.

Macro keeps:

- economic series concepts
- FRED/ClickHouse schema details
- chart/deck panels
- macro surface kinds and panel ids
- macro system prompt content
- macro provisioning templates / Python SDK / builtins
- macro event names and payload meanings

Workspace/generic helpers may own:

- simple plugin composition from child plugins
- generic REST-to-`ExplorerAdapter` plumbing
- generic static rows adapter plumbing
- generic `openSurface` command helper
- generic surface resolver builders
- generic typed event namespace helpers
- generic path display normalization helpers, where safe

Avoid a large enhancer/mixin framework. Prefer normal plugins composing other
normal plugins through one small `composePlugins()` helper.

## Preferred Generic Plugin Composition Model

The simplest general model is: plugins compose plugins.

Instead of a broad enhancer framework such as `withPanels()`,
`withCatalogs()`, `withDataCatalog()`, etc., add one small helper that flattens
child plugin contributions into a parent plugin:

```ts
export function composePlugins(options: {
  id: string;
  label?: string;
  plugins: Plugin[];
  outputs?: PluginOutput[];
  panels?: PanelConfig[];
  catalogs?: CatalogConfig[];
  commands?: CommandConfig[];
  adoptOutputs?: boolean;
}): Plugin;
```

Mental model:

```ts
const macroPlugin = composePlugins({
  id: MACRO_PLUGIN_ID,
  label: "Macro",
  plugins: [macroPanelsPlugin, macroSurfacesPlugin, macroSeriesCatalogPlugin],
});
```

This keeps every feature behind the same plugin interface. Data catalog remains
a plugin; surfaces can be a tiny plugin; app domains can publish smaller plugin
fragments and compose them into one app plugin.

### Composition semantics

Default recommendation: **parent adopts child outputs**.

When `adoptOutputs !== false`, composed outputs should register as owned by the
parent plugin id at bootstrap time. This matches app-domain expectations: the
macro catalog is part of the Macro plugin even if it was created by a reusable
data catalog plugin factory.

When `adoptOutputs === false`, child plugin ids are preserved. This is useful
for independent third-party plugin bundles where inspector/debug output should
show original child ownership.

`composePlugins()` should:

- flatten `outputs`, legacy `panels`, `catalogs`, `commands`, bindings, and
  other contribution arrays from child plugins
- preserve deterministic order: child plugins in array order, then explicit
  parent outputs
- detect duplicate contribution ids early where possible
- not invent a new lifecycle model
- not deeply clone components/functions
- leave server plugin composition as a separate concern unless the same simple
  shape naturally applies there

This general composition helper can replace many ad hoc `appendXOutputs()`
patterns over time while keeping existing helpers as compatibility wrappers.

## File-by-file Audit

### `constants.ts`

Current:

```ts
export const MACRO_PLUGIN_ID = "boring-macro";
export const MACRO_CHART_PANEL_ID = "chart-canvas";
export const MACRO_DECK_PANEL_ID = "deck";
export const MACRO_SERIES_SURFACE_RESOLVER_ID = "boring-macro-series";
export const MACRO_DECK_SURFACE_RESOLVER_ID = "boring-macro-deck-path";
export const MACRO_OPEN_SERIES_SURFACE_KIND = "macro.open-series";
```

Decision: keep in macro.

Potential generic improvement: add optional helper conventions for deriving ids:

```ts
createPluginIds("boring-macro", {
  panels: ["chart-canvas", "deck"],
  surfaces: ["open-series"],
  resolvers: ["series", "deck-path"],
});
```

Do **not** implement unless id drift becomes common. Current constants are clear
and low boilerplate.

### `panels.tsx`

Current boilerplate:

```ts
export const chartCanvasPanel = definePanel({
  id: MACRO_CHART_PANEL_ID,
  title: "Chart",
  component: ChartCanvasPane,
  placement: "center",
  source: "app",
});
```

Decision: mostly keep. `definePanel()` already handles generic panel shape.

Possible helper only if repeated heavily:

```ts
createCenterPanel({ id, title, component, source: "app" });
```

Not worth extracting now. Panel declarations are readable and explicit.

### `index.tsx`

Current responsibilities:

- exports `MacroStandaloneDeckRoute`
- declares `macroChatSuggestions`
- declares shell options
- composes plugin outputs:
  - chart panel
  - deck panel
  - macro surface resolvers
  - data catalog outputs via `appendDataCatalogOutputs()`

Good current pattern:

```ts
return appendDataCatalogOutputs(
  plugin,
  createMacroSeriesDataCatalogOptions(onSeriesSelect),
);
```

Decision: keep macro composition here until `composePlugins()` exists, then
prefer composing smaller plugin fragments:

```ts
const macroPanelsPlugin = definePlugin({
  id: "macro-panels",
  outputs: [
    { type: "panel", panel: chartCanvasPanel },
    { type: "panel", panel: deckPanel },
  ],
});

const macroSurfacesPlugin = definePlugin({
  id: "macro-surfaces",
  outputs: macroSurfaceOutputs,
});

const macroSeriesCatalogPlugin = createDataCatalogPlugin({
  ...createMacroSeriesDataCatalogOptions(onSeriesSelect),
  pluginId: "macro-series-catalog",
});

return composePlugins({
  id: MACRO_PLUGIN_ID,
  label: "Macro",
  plugins: [macroPanelsPlugin, macroSurfacesPlugin, macroSeriesCatalogPlugin],
});
```

This is simpler than adding many specialized enhancer functions. Existing
`appendDataCatalogOutputs()` can remain as compatibility sugar implemented on
top of `composePlugins()` later.

Possible generic improvements:

1. **Chat suggestion type export**

   Macro defines a local `MacroChatSuggestion` that probably mirrors a workspace
   chat suggestion shape. If `WorkspaceProvider` already owns a compatible
   public type, macro should import it. If not, expose one:

   ```ts
   export interface ChatSuggestion {
     label: string;
     hint?: string;
     icon?: ComponentType<{ className?: string }>;
     prompt?: string;
   }
   ```

   This avoids every app re-declaring the same suggestion type.

2. **Shell options type**

   `macroShellOptions` is app-shell config, not plugin-domain behavior. If more
   apps duplicate this object shape, expose a `WorkspaceShellOptions` type from
   workspace/app composition docs. Do not move macro values.

### `catalogs.ts`

Current responsibilities:

- owns macro facets: frequency/source
- creates macro `CreateDataCatalogOutputsOptions`
- wires adapter, labels, groupBy, drag payload, select callback

Decision: keep macro-specific options here, but generic helpers can reduce
boilerplate.

Generic candidates:

1. **Data catalog preset helper**

Current repeated shape:

```ts
{
  id,
  label: "Data",
  adapter,
  facets,
  groupBy,
  onSelect,
  leftTabId,
  leftTabTitle: "Data",
  catalogId,
  catalogLabel,
  includeVisualizationPanel: false,
  emptyState,
  searchPlaceholder,
  getDragPayload,
}
```

Could become:

```ts
createDataCatalogPreset({
  id: "macro-series",
  catalogLabel: "Macro Series",
  adapter: macroAdapter,
  facets: MACRO_FACETS,
  groupBy: "frequency",
  onSelect,
  emptyState: "No series match",
  searchPlaceholder: "Search...",
  dragMimeType: "text/series-id",
  visualization: false,
});
```

Owner: `dataCatalogPlugin`, not macro.

2. **Drag payload helper**

```ts
getDragPayload: createTextDragPayload("text/series-id", (row) => row.id);
```

Owner: future `explorerPlugin` or `DataExplorer/adapters`.

3. **Facet config helper**

`MACRO_FACETS` is domain-specific, but a helper can encode order + formatter:

```ts
facet("frequency", "Frequency", { order, labels: FREQ_LABELS });
```

Only extract if multiple apps repeat this pattern. Low priority.

### `data/macroSeriesAdapter.ts`

Current responsibilities:

- maps macro API rows to `ExplorerRow`
- builds query strings
- fetches `/api/macro/catalog` and `/api/macro/facets`
- maps explorer search args to query params
- maps facets response

Decision: extract generic REST adapter plumbing; keep macro row mapping and URLs
in macro.

Generic helper proposal:

```ts
export function createRestExplorerAdapter<ApiRow, FacetsResponse>(options: {
  searchUrl: string | ((args: ExplorerSearchArgs) => string);
  facetsUrl?: string | ((args: ExplorerFacetsArgs) => string);
  mapRow: (row: ApiRow) => ExplorerRow;
  mapSearchArgs?: (
    args: ExplorerSearchArgs,
  ) => Record<string, string | number | string[] | undefined>;
  mapFacetArgs?: (
    args: ExplorerFacetsArgs,
  ) => Record<string, string | number | string[] | undefined>;
  mapSearchResponse?: (json: unknown) => {
    items: ApiRow[];
    total: number;
    hasMore: boolean;
  };
  mapFacetsResponse?: (json: FacetsResponse) => Facets;
  fetch?: typeof globalThis.fetch;
}): ExplorerAdapter;
```

Macro after extraction:

```ts
export function createMacroSeriesAdapter(): ExplorerAdapter {
  return createRestExplorerAdapter<CatalogItem, FacetsResponse>({
    searchUrl: "/api/macro/catalog",
    facetsUrl: "/api/macro/facets",
    mapRow: toMacroSeriesRow,
    mapSearchArgs: (args) => ({
      q: args.query || undefined,
      offset: args.offset,
      limit: args.limit,
      group: args.group?.value,
      frequency: args.filters.frequency,
      source: args.filters.source,
    }),
    mapFacetArgs: (args) => ({
      frequency: args.filters.frequency,
      source: args.filters.source,
    }),
  });
}
```

Also extract generic query helper:

```ts
toQueryString(params: Record<string, string | number | string[] | undefined>): string
```

Owner: `explorerPlugin/adapters.ts` once created. Temporary owner can be
`front/components/DataExplorer/adapters.ts`.

Risk: don't overfit response shape. Keep mapper hooks explicit.

### `data/macroSeriesUi.ts`

Current responsibilities:

- `FREQ_LABELS`: macro/domain display labels
- `SERIES_COLORS`: chart palette
- `formatSeriesValue`: numeric display helper
- `openSeriesPane`: posts openSurface command for macro series

Decision:

- keep labels/colors in macro
- consider moving `formatSeriesValue` only if many apps need generic numeric
  compact formatting; otherwise keep macro
- extract generic `openSurface` command builders

Generic open helpers:

```ts
export function openSurface(options: {
  kind: string;
  target: string;
  meta?: Record<string, unknown>;
}): void;

export function createOpenSurfaceHandler<Input>(options: {
  kind: string;
  getTarget: (input: Input) => string | undefined;
  getMeta?: (input: Input) => Record<string, unknown> | undefined;
}): (input: Input) => void;

export function createOpenSurfaceRowHandler(options: {
  kind: string;
  catalogId?: string;
  getTarget?: (row: ExplorerRow) => string | undefined;
  getMeta?: (row: ExplorerRow) => Record<string, unknown> | undefined;
}): (row: ExplorerRow) => void;
```

Macro after extraction:

```ts
export const openSeriesPane = createOpenSurfaceHandler<string>({
  kind: MACRO_OPEN_SERIES_SURFACE_KIND,
  getTarget: (seriesId) => seriesId.trim() || undefined,
  getMeta: (_seriesId, opts) => ... // if supporting options, use a two-arg helper
})
```

Because `openSeriesPane(seriesId, opts)` currently takes two args, either keep a
small macro wrapper or make the generic helper support tuple input. Prefer small
wrapper for readability.

### `surfaceResolver.ts`

Current responsibilities:

- generic target trimming / title fallback / panel resolution boilerplate
- generic path normalization / basename
- macro-specific series routing
- macro-specific deck markdown path matching

Decision: best immediate extraction candidate after explorer adapter.

Generic helper 1: target surface resolver

```ts
export function createTargetSurfaceResolver<
  Target extends string = string,
>(options: {
  id: string;
  source?: PanelConfig["source"];
  kind: string;
  component: string;
  score?: number;
  normalizeTarget?: (target: string) => Target | undefined;
  getPanelId?: (target: Target, request: SurfaceOpenRequest) => string;
  getTitle?: (
    target: Target,
    request: SurfaceOpenRequest,
  ) => string | undefined;
  getParams?: (
    target: Target,
    request: SurfaceOpenRequest,
  ) => Record<string, unknown>;
}): SurfaceResolverConfig;
```

Generic helper 2: path surface resolver

```ts
export function createPathSurfaceResolver(options: {
  id: string;
  source?: PanelConfig["source"];
  kind?: string; // default WORKSPACE_OPEN_PATH_SURFACE_KIND
  component: string;
  score?: number;
  matches: (path: string, request: SurfaceOpenRequest) => boolean;
  getPanelId?: (path: string, request: SurfaceOpenRequest) => string;
  getTitle?: (path: string, request: SurfaceOpenRequest) => string;
  getParams?: (
    path: string,
    request: SurfaceOpenRequest,
  ) => Record<string, unknown>;
}): SurfaceResolverConfig;
```

Generic helper 3: safe display path helpers

```ts
normalizeSurfacePath(path: string): string
basename(path: string): string
```

Important: these are **not** security validators. Path validation remains the
adapter/server/filesystem plugin's job.

Macro after extraction:

```ts
export const macroSurfaceOutputs = surfaceResolverOutputs([
  createTargetSurfaceResolver({
    id: MACRO_SERIES_SURFACE_RESOLVER_ID,
    source: "app",
    kind: MACRO_OPEN_SERIES_SURFACE_KIND,
    component: MACRO_CHART_PANEL_ID,
    normalizeTarget: trimNonEmpty,
    getPanelId: (seriesId) => `chart:${seriesId}`,
    getTitle: (seriesId, request) =>
      readStringMeta(request.meta, "title") ?? seriesId,
    getParams: (seriesId) => ({ seriesId }),
  }),
  createPathSurfaceResolver({
    id: MACRO_DECK_SURFACE_RESOLVER_ID,
    source: "app",
    component: MACRO_DECK_PANEL_ID,
    score: 10,
    matches: isDeckMarkdownPath,
    getPanelId: (path) => `file:${path}`,
    getTitle: basename,
    getParams: (path) => ({ path }),
  }),
]);
```

Could also add:

```ts
surfaceResolverOutputs(resolvers): PluginOutput[]
```

Owner: `front/registry/surfaceResolverHelpers.ts` or future
`plugins/explorerPlugin/surface.ts`. Since these helpers are not explorer-only,
prefer `front/registry` or a new `front/surface` module.

### `data/macroSeriesData.ts`

Current responsibilities:

- fetch series payload by id
- in-memory cache
- in-flight de-dup
- reset cache

Decision: possible generic cache helper, but not priority.

Generic helper:

```ts
createResourceCache<Key, Value>({
  load: (key) => Promise<Value>,
  keyToString?: (key) => string,
})
```

Macro after extraction:

```ts
const seriesCache = createResourceCache({
  load: async (seriesId: string) => { ...fetch macro series... },
})
export const fetchMacroSeries = seriesCache.fetch
export const clearMacroSeriesCache = seriesCache.clear
```

Risk: introducing a cache abstraction may hide app-specific invalidation rules.
Leave until another plugin duplicates it.

### `data/macroSeriesTypes.ts`

Decision: keep in macro. Domain payload.

### `panels/ChartCanvasPane.tsx` and `panels/DeckPane.tsx`

Decision: keep in macro. Domain UI.

Potential generic extraction only if repeated:

- empty/loading/error panel state components
- chart color palette? no; macro-specific enough
- markdown deck embed mechanics? likely domain/app-specific until a separate
  deck plugin exists

### `server/index.ts`

Current responsibilities:

- server plugin object
- routes registration
- provisioning declarations
- macro system prompt
- macro tools

Decision: keep macro domain, but generic helpers can reduce boilerplate.

Generic candidates:

1. **Server plugin factory helper**

```ts
createServerPlugin({
  id,
  label,
  routes,
  agentTools,
  provisioning,
  systemPrompt,
});
```

Only useful if many server plugins repeat the exact shape. Low priority.

2. **System prompt builder for surface contracts**

Macro prompt manually documents:

```txt
call exec_ui with kind "openSurface" and params { kind, target, meta }
```

Data catalog server helper already generates similar prompt text. Extract a
shared prompt helper:

```ts
createOpenSurfacePrompt({
  surfaceKind: MACRO_OPEN_SERIES_SURFACE_KIND,
  targetDescription: "series_id",
  metaExample: "{ title }",
});
```

Owner: workspace server UI-control or dataCatalogPlugin server utilities.

3. **Provisioning type**

Macro declares local `MacroProvisioningContribution`. If workspace server plugin
already has a canonical provisioning type, import it. If not, add one. This
prevents local drift in app server plugins.

### `server/tools/macroTools.ts`

Current responsibilities:

- ClickHouse read-only SQL guard
- tool result formatting
- macro search/data/derived tools
- SQL hinting

Decision: mostly keep in macro.

Generic candidates:

1. `textResult()` / `errorResult()` helpers already exist in other workspace
   server code patterns. Export shared helpers from a server utilities module:

```ts
textToolResult(text);
errorToolResult(text);
```

2. read-only SQL guard might be reusable for DB plugins, but ClickHouse hints
   are macro-specific. If extracted, keep generic guard separate:

```ts
assertReadonlySql(sql, { allowed: ["SELECT", "WITH", ...] })
```

Low priority unless another DB plugin appears.

### `server/routes/macro.ts`

Current responsibilities:

- query param parsing/clamping
- auth dev bypass
- macro catalog/facets/series/deck/refresh routes
- filesystem deck route operations

Generic candidates:

1. Query helpers:

```ts
parseCommaSep();
clampInt();
optionalInt();
```

Could move to workspace server route utils if repeated. Low priority.

2. Catalog/facets REST contract:

If `createRestExplorerAdapter` becomes a workspace helper, document the expected
server response shape `{ items, total, hasMore }`. Do not move macro routes.

3. Dev localhost bypass is app/server policy. Do not move unless core/cloud adds
   a canonical dev-auth helper.

## Event Handling Audit

Macro currently uses workspace event bus indirectly:

- `openSeriesPane()` posts `workspace:ui.command` through `postUiCommand()`.
- tests subscribe to `events.on("workspace:ui.command", ...)`.
- filesystem/agent events are owned by workspace/filesystem plugin, not macro.

No macro-specific event namespace exists yet.

Generic improvements:

1. **Avoid raw event-name strings in tests**

Test currently uses:

```ts
const UI_COMMAND_EVENT = "workspace:ui.command";
```

Prefer exporting/importing the canonical event key if available:

```ts
import { workspaceEvents } from "@boring/workspace/events";
```

If not exported, expose it. Raw event strings in app tests drift easily.

2. **Plugin event namespace helper**

When macro adds domain events, use:

```ts
export const macroEvents = createPluginEventNamespace(MACRO_PLUGIN_ID, {
  seriesOpened: "series.opened",
  transformCompleted: "transform.completed",
  deckSaved: "deck.saved",
});
```

This helper should:

- prefix event names with plugin id
- preserve literal types
- avoid collisions
- avoid importing app/domain events into workspace core

3. **Typed plugin event map augmentation**

If workspace supports augmentable event maps, macro can own event payload types:

```ts
declare module "@boring/workspace/events" {
  interface WorkspacePluginEventMap {
    "boring-macro:series.opened": { seriesId: string; title?: string };
  }
}
```

Only implement when macro actually emits domain events.

## Surface Handling Audit

Surface handling is the biggest near-term boilerplate win.

Current macro has two resolver patterns:

1. target resolver: surface kind + string target -> panel
2. path resolver: workspace path surface + path predicate -> panel

These patterns will recur in Feret:

- ingredient id -> ingredient detail panel
- formulation id -> formulation panel
- source file path -> extraction review panel
- project path -> custom markdown/source preview panel

Generic resolver helpers should be introduced before Feret repeats the macro
boilerplate.

Recommended owner:

```txt
packages/workspace/src/front/registry/surfaceResolverHelpers.ts
```

Exports from package root:

```ts
createTargetSurfaceResolver;
createPathSurfaceResolver;
surfaceResolverOutputs;
normalizeSurfacePath;
surfaceBasename;
readStringMeta;
```

Risk: this lives under `front/registry` but helpers may be useful in app plugins.
That is acceptable because app plugins already import `definePanel` from front
registry types via package root. Do not put these in `shared/` if they depend on
React/panel component types. If kept type-only and browser-safe, `shared/types`
may be okay later.

## Data Catalog / Explorer Integration Audit

Macro already correctly composes data catalog outputs:

```ts
appendDataCatalogOutputs(
  plugin,
  createMacroSeriesDataCatalogOptions(onSeriesSelect),
);
```

Better integration opportunities:

1. `composePlugins()` so macro can compose a real `createDataCatalogPlugin()`
   child plugin rather than mutating/appending outputs onto a base plugin.
2. `createDataCatalogPreset()` only if option boilerplate remains noisy after
   plugin composition.
3. `createRestExplorerAdapter()` for `/catalog` + `/facets` endpoints.
4. `createOpenSurfaceRowHandler()` for catalog row activation.
5. Future `explorerPlugin` owns explorer primitives and adapter helpers;
   `dataCatalogPlugin` composes them.

Do not make macro depend directly on a future `explorerPlugin` if
`dataCatalogPlugin` can provide the right data-catalog specialization. Macro
should depend on the highest-level appropriate abstraction:

```txt
macro series catalog -> dataCatalogPlugin plugin/factory
macro custom project/tree explorer -> explorerPlugin plugin/factory
macro chart/deck panels -> macro-owned panels
```

## Proposed Extraction Order

### Step 1 — `composePlugins()`

Why first: it answers the general customization question without a complex
mixin/enhancer framework. Plugins can build on other plugins through the same
interface they already expose.

Add `composePlugins()` in the shared plugin model and migrate macro composition
only if it makes the file simpler. Keep `appendDataCatalogOutputs()` as a
compatibility helper.

Tests:

- composition flattens child outputs in order
- duplicate ids are caught or warned consistently
- adopted ownership defaults to parent plugin id
- `adoptOutputs: false` preserves child plugin ids
- macro plugin output order remains stable

### Step 2 — Surface resolver helpers

Why first: high signal, low risk, clearly reduces macro/Feret boilerplate.

Add helpers and migrate macro `surfaceResolver.ts` to declare only rules.

Tests:

- macro resolver tests unchanged
- helper tests for kind mismatch, blank target, title fallback, path matching

### Step 3 — Open surface helpers

Add `openSurface()`, `createOpenSurfaceHandler()`, and
`createOpenSurfaceRowHandler()`.

Migrate `openSeriesPane()` to use helper internally, keeping public macro API
unchanged.

Tests:

- macro `openSeriesPane` test unchanged
- helper tests for trimming/empty target/meta

### Step 4 — REST explorer adapter helper

Add generic `createRestExplorerAdapter()` and `toQueryString()`.

Migrate `macroSeriesAdapter.ts` to keep only macro `toRow()` and arg mapping.

Tests:

- macro catalog adapter tests if present
- new helper tests for array query params, abort signal forwarding, non-OK
  responses, response mapping

### Step 5 — Data catalog preset helper

Add `createDataCatalogPreset()` only if macro and playground both simplify after
`composePlugins()` exists. Plugin composition may make this unnecessary.

Migrate macro and playground catalog options only if the helper removes real
boilerplate.

Tests:

- existing data catalog plugin tests
- public API test for helper export if exported

### Step 6 — Event namespace helper

Add only when macro or Feret introduces first real domain event. Do not create
unused event abstraction.

## Do Not Extract Yet

- Chart/deck panels
- FRED frequency labels
- series colors
- ClickHouse services
- SQL tool hinting
- macro transform SDK/provisioning contents
- local shell option values
- deck path predicate (`deck/*.md` at root) beyond generic path resolver helper

## Acceptance Criteria

- Macro plugin file count does not grow just to satisfy abstraction.
- Macro `surfaceResolver.ts` becomes declarative: constants + predicates + helper
  calls, no repeated resolver boilerplate.
- Macro catalog adapter keeps macro row mapping but delegates REST/query plumbing.
- Macro tests remain mostly unchanged, proving helpers preserve behavior.
- Feret can reuse the same helpers for ingredient/formulation/source-file
  surfaces without depending on macro.
- Workspace does not learn FRED, ClickHouse, chart, deck, or macro series
  semantics.
