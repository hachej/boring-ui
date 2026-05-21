# Deck Plugin Extraction Plan

Status: draft plan — aligned to `feat/plugin-agent-layer-rebased-main` plugin authoring/runtime shape  
Target worktree: `/home/ubuntu/projects/boring-ui-v2-deck-plugin-plan`  
Target package: `plugins/deck` / `@hachej/boring-deck`  
Primary consumer: `boring-macro` deck generation and presentation UI

## 1. Goal

Extract the generic markdown deck generation/presentation surface currently living inside `boring-macro` into a reusable Boring UI plugin package under `boring-ui-v2/plugins/deck`.

The extracted plugin must be reusable by future apps, while still allowing `boring-macro` to inject domain-specific slide widgets such as economic time-series charts.

## 2. Non-goals

- Do not move macro data/catalog/query logic into `@hachej/boring-deck`.
- Do not hardcode FRED, ClickHouse, `TimeSeries`, or `TimeSeriesGrid` into the generic deck plugin.
- Keep macro-specific `TimeSeries` and `TimeSeriesGrid` widget implementations in `boring-macro`; the deck plugin only provides the widget registry/host.
- Do not require `boring-macro` to switch to manifest/defaultPluginPackages loading in its first migration; direct static composition remains acceptable even though `@hachej/boring-deck` itself should be manifest-loadable.
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
  - currently co-located macro-specific `TimeSeries` and `TimeSeriesGrid` widget rendering, which should **not** be extracted into the generic package and should instead become `boring-macro` widget definitions
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

  skills/
    deck-authoring/
      SKILL.md

  src/
    front/
      index.tsx
      DeckPane.tsx
      StandaloneDeckRoute.tsx
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
      parser.ts
      types.ts
      index.ts
    test-setup.ts
```

Package metadata should follow the soon-to-merge plugin-agent-layer package.json plugin shape. `@hachej/boring-deck` should be a **manifest-loadable plugin package** with safe generic defaults **and** a builder library for consumers that need app-specific storage/widgets/theme.

The default package plugin is intentionally generic: it can open/edit markdown decks under `deck/`, includes no macro-specific widgets, and uses a file-backed server rooted at the workspace deck directory. Consumers such as `boring-macro` can still call `createDeckPlugin(...)` / `createDeckServerPlugin(...)` or provide a thin wrapper when they need `TimeSeries`/`TimeSeriesGrid` widget injection.

```json
{
  "name": "@hachej/boring-deck",
  "version": "0.1.17",
  "type": "module",
  "private": true,
  "license": "MIT",
  "description": "Manifest-loadable Boring workspace markdown deck plugin plus builders for app-specific storage, widgets, and theme.",
  "boring": {
    "label": "Deck",
    "front": "dist/front/index.js",
    "server": "dist/server/index.js"
  },
  "pi": {
    "skills": ["skills/deck-authoring"],
    "systemPrompt": "Use the deck-authoring skill for markdown slide decks under deck/*.md."
  },
  "files": ["dist", "skills"],
  "exports": {
    ".": { "types": "./dist/front/index.d.ts", "import": "./dist/front/index.js" },
    "./front": { "types": "./dist/front/index.d.ts", "import": "./dist/front/index.js" },
    "./server": { "types": "./dist/server/index.d.ts", "import": "./dist/server/index.js" },
    "./shared": { "types": "./dist/shared/index.d.ts", "import": "./dist/shared/index.js" },
    "./package.json": "./package.json"
  },
  "sideEffects": false,
  "peerDependencies": {
    "@hachej/boring-workspace": "workspace:*",
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

Default exports:

- `src/front/index.tsx` default-exports `createDeckPlugin()` for package discovery/static loading.
- `src/server/index.ts` default-exports `defaultDeckServerPlugin(options, ctx)` for directory-source package loading; it builds `createDeckServerPlugin(...)` with `routeBase: options.routeBase ?? '/api/deck'` and `root: options.root ?? path.join(ctx.workspaceRoot, 'deck')`.

Consumer-specific wrappers remain useful but optional. `boring-macro` should use the builders to inject macro widgets and keep `/api/macro/deck` compatibility, while the generic package itself remains runnable through `package.json#boring`.

## 4.1 Alignment with plugin-agent-layer

The implementation must target the authoring/runtime shape in `~/projects/boring-ui-v2-plugin-agent-layer`:

- Front builders import from `@hachej/boring-workspace/plugin` and return `BoringFrontFactoryWithId` produced by `definePlugin({ id, label, panels, commands, surfaceResolvers, setup? })`.
- Front `setup` remains synchronous. `createDeckPlugin` must not require async front bootstrap.
- Consumers pass the returned factory directly to `WorkspaceProvider.plugins`; tests normalize with `toWorkspacePlugin(...)` where needed.
- Server builders import from `@hachej/boring-workspace/server` and return `WorkspaceServerPlugin` produced by `defineServerPlugin({ id, label, routes, systemPrompt, preservedUiStateKeys })`.
- Manifest/directory loading calls a server default export as `(options, ctx)` and supports async factories. `@hachej/boring-deck/server` should provide that default factory and use `ctx.workspaceRoot` for its default file root.
- Directory-source packages should declare explicit `package.json#boring.front` / `boring.server` entries. `@hachej/boring-deck` must include those fields because it is a concrete package.json plugin as well as a builder library.
- Server route edits still require host restart; do not promise hot reload for routes beyond the plugin-agent-layer contract.

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

Implementation shape:

```ts
import { definePlugin, type BoringFrontFactoryWithId } from '@hachej/boring-workspace/plugin'

export function createDeckPlugin(options: CreateDeckPluginOptions = {}): BoringFrontFactoryWithId {
  const id = options.id ?? 'deck'
  const label = options.label ?? 'Deck'
  const panelId = options.panelId ?? 'deck'
  const source = options.source ?? 'app'

  return definePlugin({
    id,
    label,
    panels: options.includePanel === false ? [] : [{ id: panelId, label, component: DeckPane, placement: 'center', source }],
    commands: options.includeCommand === false ? [] : [{ id: options.commandId ?? `${id}.open`, title: `Open ${label}`, panelId }],
    surfaceResolvers: options.includeSurfaceResolver === false ? [] : [createDeckSurfaceResolver({ id, panelId, pathPrefix: options.pathPrefix ?? 'deck/' })],
  })
}

const deckPlugin = createDeckPlugin()
export default deckPlugin
```

Default behavior:

- `id`: `deck`
- `label`: `Deck`
- `panelId`: `deck` by default for the generic package plugin; consumers with multiple deck instances may use `${id}.panel`
- `pathPrefix`: `deck/`
- default storage: HTTP storage under `/api/deck`
- panel command: use plugin-agent-layer `BoringFrontPanelCommandRegistration` shape (`{ id, title, panelId }`), optionally with `run` only if a consumer needs custom behavior
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

This keeps the deck UI independent of any app-specific deck route, including macro's `/api/macro/deck` compatibility route.

### 5.3 Custom markdown component and widget injection

Generic deck supports custom component injection through a named widget registry. The v1 deck language should use the existing boring-macro moustache syntax as the canonical syntax because it is simple, already deployed, and works for both block widgets and inline leaf components.

Canonical syntax:

```md
{{WidgetName key="value" another="value"}}

Inline status {{Badge text="Preliminary" tone="warning"}} inside a paragraph.

{{Kpi label="GDP" value="2.1%" tone="good"}}
```

Current boring-macro usage is exactly this family of syntax:

```md
{{TimeSeries ids="CPIAUCSL" title="Consumer Price Index"}}
{{TimeSeriesGrid ids="UNRATE;PAYEMS" titles="Unemployment;Payrolls" columns="2"}}
```

Implementation notes:

- Parse all `{{WidgetName key="value"}}` occurrences, including occurrences inside paragraphs.
- Treat widgets on their own line as block widgets by default.
- Treat widgets inside paragraph text as inline leaf components when the widget definition declares `display: 'inline'`.
- Do not add MDX/eval. Do not require markdown-directive syntax for v1.
- A future version can add `remark-directive` for container components with markdown children if a real consumer needs it.
- The generic package ships no domain widgets by default beyond safe placeholders/examples.

Types:

```ts
export type DeckWidgetDisplay = 'block' | 'inline'

export interface DeckWidgetDefinition<TAttrs = Record<string, string>> {
  name: string
  display?: DeckWidgetDisplay
  parse?: (attrs: Record<string, string>) => TAttrs
  render: ComponentType<DeckWidgetRenderProps<TAttrs>>
}

export interface DeckWidgetRenderProps<TAttrs> {
  attrs: TAttrs
  rawAttrs: Record<string, string>
  context: DeckRuntimeContext
}

export interface DeckRuntimeContext {
  path?: string
  deckTitle?: string
  slideIndex: number
  slideCount: number
  mode: 'read' | 'edit' | 'present'
  compact: boolean
  openSurface(request: SurfaceOpenRequest): void
  openPanel?(params: { id: string; component: string; params?: Record<string, unknown> }): void
}
```

Rules:

- Unknown widgets render a visible non-fatal placeholder.
- Parser failures render a visible placeholder with error details in dev/test only.
- Renderers are wrapped in a deck-owned error boundary; one bad custom component must not blank the slide or deck.
- Names must match a strict identifier regex and duplicate names fail during `createDeckPlugin(...)`.
- Definitions are matched by exact `name`.
- Raw HTML remains disabled by default; custom components must go through the widget registry, not arbitrary HTML/MDX eval.

Domain consumers can supply their own widgets. For example, `boring-macro` can supply `TimeSeries` and `TimeSeriesGrid`, but those implementations stay outside the generic deck package.

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

App-specific visual accents should be provided through theme options instead of hardcoded `.deck-root` CSS.

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
  preHandler?: unknown
  readOnly?: boolean
  maxContentBytes?: number
  allowedContentTypes?: string[]
}

export function createDeckServerPlugin(options: CreateDeckServerPluginOptions): WorkspaceServerPlugin
```

Implementation shape:

```ts
import { defineServerPlugin, type WorkspaceServerPlugin } from '@hachej/boring-workspace/server'

export function createDeckServerPlugin(options: CreateDeckServerPluginOptions): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: options.id ?? 'deck',
    label: options.label ?? 'Deck',
    routes: createDeckRoutes(options),
    systemPrompt: options.systemPrompt ?? createDeckSystemPrompt(),
    preservedUiStateKeys: options.preservedUiStateKeys,
  })
}

export default function defaultDeckServerPlugin(
  options?: { routeBase?: string; root?: string },
  ctx?: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  const root = options?.root ?? join(ctx?.workspaceRoot ?? process.cwd(), 'deck')
  return createDeckServerPlugin({
    routeBase: options?.routeBase ?? '/api/deck',
    storage: createFileDeckStorage({ root, stripPrefix: 'deck/' }),
  })
}
```

Default route shape and HTTP compatibility contract:

- `GET {routeBase}` with `?path=` returns `text/markdown`
- `PUT {routeBase}` with `?path=` accepts `{ content: string }` or raw string if compatibility mode is enabled, writes markdown, and returns `{ ok: true, path, bytes }`
- `GET {routeBase}/list` returns `{ items: string[] }`
- errors use stable status codes and response bodies; app-specific compatibility routes can preserve legacy `400`/`404` behavior during consumer migrations

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

- Centralize path canonicalization in a shared `normalizeDeckPath(path, { pathPrefix, allowedExtensions })` helper used by the HTTP client, server routes, file storage, and surface resolver.
- Prevent path traversal with `path.resolve` containment checks and `realpath`/`lstat` checks for existing paths.
- Reject absolute paths, drive-letter paths, UNC paths, null bytes, backslash traversal forms, encoded traversal, and empty paths.
- Only allow `.md` writes by default.
- Reject symlink escapes for reads and writes, including symlinked parent directories.
- Do not follow arbitrary user-controlled absolute paths.

### 6.3 Agent guidance: system prompt plus deck-authoring skill

Ship a small reusable Pi skill at `skills/deck-authoring/SKILL.md`. The skill should explain the markdown deck format in enough detail that the agent can author decks without overloading every server prompt.

Skill scope:

- deck files live under the configured deck path, usually `deck/*.md`
- `---` on its own line splits slides
- optional frontmatter title
- concise slide-writing rubric
- canonical widget/component syntax `{{WidgetName key="value"}}`
- inline widget usage such as `Status: {{Badge text="Draft" tone="warning"}}`
- generic component sizing/layout conventions
- warning to preserve existing custom widget syntax supplied by the host app

Keep `systemPrompt` short and use it to point the agent at the skill and the current route/path conventions. Move generic deck authoring rules into `@hachej/boring-deck/server`:

```ts
export function createDeckSystemPrompt(options?: {
  pathPrefix?: string
  customWidgetDocs?: string
}): string
```

Generic prompt includes:

- use the `deck-authoring` skill for detailed deck-writing rules
- write decks as markdown under `deck/`
- split slides with `---`
- keep slides concise
- widget embeds count as slide content

Domain plugins append their own widget docs either in a domain-specific skill overlay or a short server prompt addendum.

## 7. Parser design

Extract parser from current `DeckPane.tsx` into `src/shared/parser.ts` as pure tested helpers. The shared parser must not import React, DOM APIs, `node:*`, or front/server modules:

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

Inline custom components should use the same `{{WidgetName ...}}` registry and be represented as widget tokens inside markdown text. Container components with markdown children are deferred until a real consumer needs directive syntax.

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
- inline moustache widgets render custom components inside paragraphs
- block moustache widgets render custom components on their own slide line
- raw HTML/MDX eval remains disabled

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

Macro front plugin should prefer direct static composition if the host accepts multiple factories. If macro needs to remain one factory, it can use the plugin-agent-layer `definePlugin({ id, setup(api) { deckFactory(api) } })` escape hatch synchronously; do not invent a separate composition abstraction.

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

Macro should prefer returning two unique `WorkspaceServerPlugin` entries from app boot: the macro data/tool plugin and the `boring-macro-deck` route/prompt plugin. If a single macro server entry is required, merge explicitly by concatenating prompts, unioning `preservedUiStateKeys`, and registering both route functions; do not reuse plugin ids because plugin-agent-layer rejects duplicate ids.

## 9. Migration phases

### Phase 0 — Re-sync against plugin-agent-layer

- Confirm imports and public types against `~/projects/boring-ui-v2-plugin-agent-layer` before implementation starts.
- Treat `@hachej/boring-deck` as a concrete package.json plugin with safe defaults, while still exporting builders for customized consumers such as `boring-macro`.
- Add any package scripts/invariant checks needed so `plugins/deck/src` is covered by workspace plugin invariants.

Acceptance:

- Plan and implementation references use `definePlugin`, `BoringFrontFactoryWithId`, `defineServerPlugin`, `WorkspaceServerPlugin`, `package.json#boring`, `pi.skills`, and default server factory semantics matching plugin-agent-layer.

### Phase 1 — Create generic deck package shell

- Copy `plugins/_template-full` to `plugins/deck` as a starting point.
- Rename package to `@hachej/boring-deck`.
- Keep and update template `package.json#boring` fields so `@hachej/boring-deck` is manifest-loadable; add `pi.skills` for static deck-authoring guidance.
- Add `front`, `server`, `shared` exports.
- Add default front export `createDeckPlugin()` and default server factory `defaultDeckServerPlugin(options, ctx)`.
- Add `skills/deck-authoring/SKILL.md` and include `skills` in package files.
- Add workspace/package scripts and tsup entries.
- Add package to `pnpm-workspace.yaml` if needed.

Acceptance:

- `pnpm --filter @hachej/boring-deck typecheck`
- `pnpm --filter @hachej/boring-deck test`

### Phase 2 — Extract pure parser and types

- Move frontmatter parsing, slide splitting, widget parsing into `src/shared/parser.ts`.
- Add focused parser unit tests.

Acceptance:

- Parser tests cover generic deck examples plus fixtures copied from the first consumer migration.

### Phase 3 — Extract DeckPane generic UI

- Move `DeckPane` into deck plugin.
- Replace macro-specific widget rendering with registry lookup; do not copy the `TimeSeries`/`TimeSeriesGrid` renderers into `@hachej/boring-deck`.
- Replace hardcoded app-specific deck fetches with `DeckStorageClient`.
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

### Phase 7 — Docs, skill, and examples

- `plugins/deck/README.md`
- `plugins/deck/skills/deck-authoring/SKILL.md`
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

Generic deck package constraints:

- Keep default package behavior domain-neutral: markdown decks under `deck/`, no built-in domain data widgets, no dependency on macro APIs.
- Preserve generic widget syntax `{{WidgetName key="value"}}` so domain widgets can be moved in/out without changing deck markdown.
- Do not break saved Dockview layouts by changing panel ids casually.

First consumer migration constraints for `boring-macro`:

- Preserve macro panel id `deck` during the migration.
- Preserve route prefix `/api/macro/deck` during the migration.
- Preserve existing macro widget syntax exactly.
- Do not require users to rewrite existing `{{TimeSeries ...}}` embeds.

## 12. Risks and mitigations

### Risk: Deck plugin becomes too macro-specific

Mitigation: generic package must not import macro series APIs, macro route paths, macro constants, or macro widget implementations. Domain widgets are injected by their owning app/plugin.

### Risk: Extension API freezes internals too early

Mitigation: expose only stable slots and widget registry first.

### Risk: Server route security regression

Mitigation: write traversal corpus tests for the generic file storage before replacing any consumer-specific path guard.

### Risk: Duplicate markdown styling differences

Mitigation: snapshot or DOM tests for representative slides, plus manual visual smoke.

### Risk: Saved macro layouts break

Mitigation: keep `panelId: 'deck'` for the generic default plugin and for macro's first integration unless a layout migration is explicitly added.

## 13. Open decisions

1. Should `@hachej/boring-deck` ship a direct default plugin, or only builders?
   - Decision: ship both. The package is manifest-loadable through `package.json#boring`, and also exports builders for customized consumers.
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
4. Port `DeckPane` as a generic renderer only; exclude macro widgets, macro routes, and macro data imports.
5. Implement moustache widget registry, inline markdown component rendering, and unknown-component placeholder.
6. Implement HTTP storage client.
7. Implement file server storage and routes.
8. Implement `createDeckPlugin` front builder.
9. Implement `createDeckServerPlugin` server builder.
10. Add README and root package table entry.
11. Rewire macro in a separate follow-up branch/PR.
