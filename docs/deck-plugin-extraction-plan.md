# Deck Plugin Extraction Plan

Status: draft plan  
Target worktree: `/home/ubuntu/projects/boring-ui-v2-deck-plugin-plan`  
Target package: `plugins/deck` / `@hachej/boring-deck`  
Primary consumer: `boring-macro` deck generation and presentation UI

## 1. Goal

Extract the generic markdown deck generation/presentation surface currently living inside `boring-macro` into a reusable Boring UI plugin package under `boring-ui-v2/plugins/deck`.

The extracted plugin must be reusable by future apps, while still allowing `boring-macro` to inject domain-specific slide widgets such as economic time-series charts.

## 2. Non-goals

- Do not move macro data/catalog/query logic into `@hachej/boring-deck`.
- Do not hardcode FRED, ClickHouse, `TimeSeries`, or `TimeSeriesGrid` into the generic deck plugin.
- Do not require manifest/defaultPluginPackages loading for the first migration; direct static composition remains acceptable.
- Do not make every internal component overrideable immediately. Provide stable extension points only.

## 3. Current source in boring-macro

The source feature to extract currently spans:

- `src/plugins/macro/front/panels/DeckPane.tsx`
  - markdown slide parsing
  - frontmatter title parsing
  - slide splitting by `---`
  - edit / preview / present modes
  - presenter navigation
  - markdown rendering styles
  - macro-specific `TimeSeries` and `TimeSeriesGrid` widget rendering
- `src/plugins/macro/front/routes/StandaloneDeckRoute.tsx`
- `src/plugins/macro/front/surfaceResolver.ts`
  - resolver for `workspace.open.path` targeting `deck/*.md`
- `src/plugins/macro/server/routes/macro.ts`
  - `GET /api/macro/deck`
  - `PUT /api/macro/deck`
  - `GET /api/macro/deck/list`
- `src/plugins/macro/server/index.ts`
  - deck authoring prompt rules
- `src/plugins/macro/server/config.ts`
  - `BM_DECK_ROOT` / `deckRoot`
- `src/plugins/macro/server/workspace-template/deck/intro.md`

## 4. Desired package shape

Create:

```txt
plugins/deck/
  package.json
  README.md
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  src/
    front/
      index.tsx
      DeckPane.tsx
      StandaloneDeckRoute.tsx
      parser.ts
      storage.ts
      widgets.tsx
      components.tsx
      __tests__/
    server/
      index.ts
      fileStorage.ts
      routes.ts
      prompt.ts
      __tests__/
    shared/
      constants.ts
      types.ts
      index.ts
    test-setup.ts
```

Package metadata:

```json
{
  "name": "@hachej/boring-deck",
  "version": "0.1.13",
  "type": "module",
  "private": true,
  "boring": {
    "label": "Deck",
    "front": "dist/front/index.js",
    "server": "dist/server/index.js"
  },
  "pi": {
    "systemPrompt": "Use deck markdown files for concise, slide-based presentations."
  },
  "exports": {
    ".": { "types": "./dist/front/index.d.ts", "import": "./dist/front/index.js" },
    "./front": { "types": "./dist/front/index.d.ts", "import": "./dist/front/index.js" },
    "./server": { "types": "./dist/server/index.d.ts", "import": "./dist/server/index.js" },
    "./shared": { "types": "./dist/shared/index.d.ts", "import": "./dist/shared/index.js" },
    "./package.json": "./package.json"
  }
}
```

Like `@hachej/boring-data-catalog`, this should primarily be a plugin builder. Direct default exports may exist for simple file-backed decks, but the important API is configurable.

## 5. Frontend API

### 5.1 Plugin builder

```ts
export interface CreateDeckPluginOptions {
  id?: string
  label?: string
  panelId?: string
  commandId?: string
  pathPrefix?: string
  defaultPath?: string
  source?: string
  storage?: DeckStorageClient
  storageBasePath?: string
  widgets?: DeckWidgetDefinition[]
  components?: DeckComponentSlots
  markdownComponents?: MarkdownComponentOverrides
  remarkPlugins?: unknown[]
  theme?: DeckThemeOptions
  includePanel?: boolean
  includeCommand?: boolean
  includeSurfaceResolver?: boolean
  surfaceResolverId?: string
}

export function createDeckPlugin(options?: CreateDeckPluginOptions): BoringFrontFactoryWithId
```

Default behavior:

- `id`: `deck`
- `label`: `Deck`
- `panelId`: `${id}.panel` or `deck`
- `pathPrefix`: `deck/`
- default storage: HTTP storage under `/api/deck`
- panel command: open default deck path
- surface resolver: open `workspace.open.path` for markdown files under `pathPrefix`

### 5.2 Storage client injection

```ts
export interface DeckStorageClient {
  read(path: string, signal?: AbortSignal): Promise<string>
  write(path: string, content: string, signal?: AbortSignal): Promise<void>
  list?(signal?: AbortSignal): Promise<string[]>
}

export function createHttpDeckStorage(options: {
  basePath?: string
  headers?: Record<string, string>
}): DeckStorageClient
```

This keeps the deck UI independent of macro's `/api/macro/deck` route.

### 5.3 Widget injection

Generic deck supports custom component injection through a named widget registry.

Markdown syntax:

```md
{{WidgetName key="value" another="value"}}
```

Types:

```ts
export interface DeckWidgetDefinition<TAttrs = Record<string, string>> {
  name: string
  parse?: (attrs: Record<string, string>) => TAttrs
  render: ComponentType<DeckWidgetRenderProps<TAttrs>>
}

export interface DeckWidgetRenderProps<TAttrs> {
  attrs: TAttrs
  rawAttrs: Record<string, string>
  compact?: boolean
  openSurface?: (request: SurfaceOpenRequest) => void
}
```

Rules:

- Unknown widgets render a visible non-fatal placeholder.
- Widget parsing failures render a visible placeholder with error details in dev/test.
- Widget renderers must not block deck parsing.
- Widget definitions are matched by exact `name`.

Macro will supply:

- `TimeSeries`
- `TimeSeriesGrid`

Potential future consumers can supply:

- `Kpi`
- `DataTable`
- `ImageGrid`
- `Citation`
- `Mermaid`
- `VegaLite`

### 5.4 Component slot injection

Stable slots:

```ts
export interface DeckComponentSlots {
  EmptyState?: ComponentType<DeckEmptyStateProps>
  LoadingState?: ComponentType<DeckLoadingStateProps>
  ErrorState?: ComponentType<DeckErrorStateProps>
  ToolbarExtra?: ComponentType<DeckToolbarExtraProps>
  SlideFrame?: ComponentType<DeckSlideFrameProps>
  PresenterChrome?: ComponentType<DeckPresenterChromeProps>
}
```

Do not expose every internal component. Start with these slots because they cover app-level branding and workflow needs without freezing internals.

### 5.5 Theme injection

```ts
export interface DeckThemeOptions {
  className?: string
  slideClassName?: string
  accentColor?: string
  compact?: boolean
}
```

The current macro orange accent should become a theme option instead of hardcoded `.deck-root` CSS.

## 6. Server API

### 6.1 Plugin builder

```ts
export interface CreateDeckServerPluginOptions {
  id?: string
  label?: string
  routeBase?: string
  storage: DeckServerStorage
  systemPrompt?: string
  preservedUiStateKeys?: string[]
}

export function createDeckServerPlugin(options: CreateDeckServerPluginOptions): WorkspaceServerPlugin
```

Default route shape:

- `GET {routeBase}` with `?path=` returns markdown
- `PUT {routeBase}` with `?path=` writes markdown
- `GET {routeBase}/list` lists markdown deck files

For a default route base of `/api/deck`, handlers are:

- `GET /api/deck?path=deck/foo.md`
- `PUT /api/deck?path=deck/foo.md`
- `GET /api/deck/list`

### 6.2 Server storage adapter

```ts
export interface DeckServerStorage {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  list?(): Promise<string[]>
}

export function createFileDeckStorage(options: {
  root: string
  stripPrefix?: string
  allowedExtensions?: string[]
}): DeckServerStorage
```

Security requirements:

- Prevent path traversal with `path.resolve` containment checks.
- Reject null bytes and backslash traversal forms.
- Only allow `.md` writes by default.
- Do not follow arbitrary user-controlled absolute paths.

### 6.3 Prompt contribution

Move generic deck authoring rules into `@hachej/boring-deck/server`:

```ts
export function createDeckSystemPrompt(options?: {
  pathPrefix?: string
  customWidgetDocs?: string
}): string
```

Generic prompt includes:

- write decks as markdown under `deck/`
- split slides with `---`
- keep slides concise
- no walls of text
- chart/widget embeds count as slide content
- avoid nested lists
- frontmatter title behavior

Macro appends widget docs for `TimeSeries` and `TimeSeriesGrid`.

## 7. Parser design

Extract parser from current `DeckPane.tsx` into pure tested helpers:

```ts
export interface ParsedDeck {
  title?: string
  slides: ParsedSlide[]
}

export interface ParsedSlide {
  index: number
  raw: string
  segments: DeckSegment[]
  chartOnly?: boolean
}

export type DeckSegment =
  | { type: 'markdown'; text: string }
  | { type: 'widget'; name: string; attrs: Record<string, string>; raw: string }
```

Functions:

```ts
export function parseDeckMarkdown(input: string): ParsedDeck
export function parseWidgetAttrs(raw: string): Record<string, string>
export function splitSlides(input: string): string[]
```

Tests:

- frontmatter title extracted
- `---` slide split only on delimiter line
- widgets parsed with quoted attrs
- unknown widgets remain structured
- malformed widget syntax falls back to markdown or placeholder

## 8. Macro integration after extraction

In `boring-macro`, remove generic deck code and compose the builder:

```ts
import { createDeckPlugin } from '@hachej/boring-deck/front'

const macroDeckPlugin = createDeckPlugin({
  id: 'boring-macro-deck',
  label: 'Deck',
  panelId: 'deck',
  pathPrefix: 'deck/',
  storageBasePath: '/api/macro/deck',
  widgets: [macroTimeSeriesWidget, macroTimeSeriesGridWidget],
  theme: { accentColor: 'oklch(0.62 0.14 65)' },
})
```

Macro front plugin calls the deck factory inside `setup(api)` or directly composes by invoking the factory.

Server:

```ts
import { createDeckServerPlugin, createFileDeckStorage } from '@hachej/boring-deck/server'

const deckPlugin = createDeckServerPlugin({
  id: 'boring-macro-deck',
  routeBase: '/api/macro/deck',
  storage: createFileDeckStorage({ root: macroConfig.deckRoot, stripPrefix: 'deck/' }),
  systemPrompt: createMacroDeckPrompt(),
})
```

Macro can either:

1. compose `deckPlugin` into its existing `makeMacroServerPlugin` result, or
2. return two server plugins from app boot.

Prefer option 2 if the app composition path accepts multiple plugins cleanly. Prefer option 1 only if macro wants one package-level server entry.

## 9. Migration phases

### Phase 1 — Create generic deck package shell

- Copy `plugins/_template-full` to `plugins/deck`.
- Rename package to `@hachej/boring-deck`.
- Add `front`, `server`, `shared` exports.
- Add workspace/package scripts and tsup entries.
- Add package to `pnpm-workspace.yaml` if needed.

Acceptance:

- `pnpm --filter @hachej/boring-deck typecheck`
- `pnpm --filter @hachej/boring-deck test`

### Phase 2 — Extract pure parser and types

- Move frontmatter parsing, slide splitting, widget parsing into `src/front/parser.ts` or `src/shared/parser.ts` if server-safe.
- Add focused parser unit tests.

Acceptance:

- Parser tests cover current macro deck examples.

### Phase 3 — Extract DeckPane generic UI

- Move `DeckPane` into deck plugin.
- Replace macro-specific widget rendering with registry lookup.
- Replace hardcoded `/api/macro/deck` fetches with `DeckStorageClient`.
- Keep default HTTP storage.
- Add minimal render tests for loading, missing deck, markdown slide, unknown widget.

Acceptance:

- A sample deck renders in a test without macro imports.
- `DeckPane` has no imports from `boring-macro` or macro-specific files.

### Phase 4 — Add server plugin and file storage

- Implement `createDeckServerPlugin`.
- Implement `createFileDeckStorage` with path traversal tests.
- Move generic deck prompt rules.

Acceptance:

- Route tests for read/write/list.
- Path traversal tests for `../`, absolute path, null byte, backslashes.

### Phase 5 — Add plugin builder outputs

- `createDeckPlugin` registers panel, command, surface resolver.
- Use `definePlugin` from `@hachej/boring-workspace/plugin`.
- Surface resolver opens markdown paths under configured prefix.

Acceptance:

- `toWorkspacePlugin(createDeckPlugin(...))` outputs expected panel/command/resolver.

### Phase 6 — Rewire boring-macro to consume deck plugin

- Add dependency on `@hachej/boring-deck`.
- Create macro widget definitions for `TimeSeries` and `TimeSeriesGrid`.
- Remove `DeckPane.tsx` from macro or reduce it to widget-only helpers.
- Remove deck routes from macro routes and compose deck server plugin instead.
- Keep route compatibility at `/api/macro/deck`.
- Keep panel id compatibility as `deck` so saved layouts survive.
- Keep surface resolver id compatibility or map old id to new resolver.

Acceptance:

- Existing macro deck paths still open.
- Existing deck markdown with `TimeSeries` and `TimeSeriesGrid` renders unchanged.
- Existing `/api/macro/deck` route contract remains compatible.

### Phase 7 — Docs and examples

- `plugins/deck/README.md`
- Update root README plugin table.
- Add example deck plugin usage.
- Document widget injection and component slots.

## 10. Testing checklist

Deck package:

```bash
pnpm --filter @hachej/boring-deck typecheck
pnpm --filter @hachej/boring-deck test
pnpm lint:workspace-plugin-invariants
```

Macro after integration:

```bash
pnpm typecheck
pnpm exec vitest run src/plugins/macro/front/__tests__/macroPlugin.test.ts
pnpm build
```

Manual macro smoke:

1. Open existing `deck/intro.md`.
2. Edit markdown and save.
3. Preview slides.
4. Presenter mode next/prev works.
5. `{{TimeSeries ids="CPIAUCSL"}}` renders.
6. `{{TimeSeriesGrid ids="UNRATE,PAYEMS"}}` renders.
7. Click series chip opens chart panel.
8. Agent writes `deck/labor.md`; surface resolver opens deck panel.

## 11. Compatibility constraints

- Preserve macro panel id `deck` during first consumer migration.
- Preserve route prefix `/api/macro/deck` during first consumer migration.
- Preserve markdown widget syntax exactly for existing macro decks.
- Do not require users to rewrite `{{TimeSeries ...}}` embeds.
- Do not break saved Dockview layouts by changing panel id casually.

## 12. Risks and mitigations

### Risk: Deck plugin becomes too macro-specific

Mitigation: generic package must not import macro series APIs. Macro widgets are injected from macro.

### Risk: Extension API freezes internals too early

Mitigation: expose only stable slots and widget registry first.

### Risk: Server route security regression

Mitigation: write traversal corpus tests before deleting macro's existing path guard.

### Risk: Duplicate markdown styling differences

Mitigation: snapshot or DOM tests for representative slides, plus manual visual smoke.

### Risk: Saved macro layouts break

Mitigation: keep `panelId: 'deck'` for macro integration.

## 13. Open decisions

1. Should `@hachej/boring-deck` ship a direct default plugin, or only builders?
   - Recommendation: ship builders; optional default export can use `/api/deck` and basic file storage.
2. Should parser live in `front` or `shared`?
   - Recommendation: `shared` if it has zero React/DOM deps; this enables server-side validation later.
3. Should widget attrs support JSON values?
   - Recommendation: start with quoted string attrs only. Add JSON later if a real widget needs it.
4. Should deck storage be workspace filesystem-backed by default?
   - Recommendation: server plugin provides file storage; frontend default is HTTP storage.
5. Should component slots receive plugin context (`apiBaseUrl`, auth headers)?
   - Recommendation: yes for toolbar/empty/error slots through a `DeckRuntimeContext` prop.

## 14. First implementation bead/task breakdown

1. Scaffold `plugins/deck` from `_template-full`.
2. Add shared constants/types for deck panel ids, surface kind, storage contracts, widget contracts.
3. Extract parser with tests.
4. Port `DeckPane` minus macro widgets.
5. Implement widget registry and unknown-widget placeholder.
6. Implement HTTP storage client.
7. Implement file server storage and routes.
8. Implement `createDeckPlugin` front builder.
9. Implement `createDeckServerPlugin` server builder.
10. Add README and root package table entry.
11. Rewire macro in a separate follow-up branch/PR.
