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
      useDeckDocument.ts
      widgets.tsx
      components.tsx
      surfaceResolver.ts
      __tests__/
    server/
      index.ts
      fileStorage.ts
      resolveDeckPath.ts
      routes.ts
      prompt.ts
      __tests__/
    shared/
      constants.ts
      parser.ts
      path.ts
      types.ts
      index.ts
      __tests__/
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
  },
  "dependencies": {
    "@hachej/boring-ui-kit": "workspace:*",
    "lucide-react": "^1.8.0",
    "react-markdown": "^9.0.0 || ^10.0.0",
    "remark-gfm": "^4.0.0"
  }
}
```

If the package imports CSS as a side effect, set `sideEffects` to an allow-list such as `["**/*.css"]` instead of `false`. Do not rely on consumer/apps hoisting runtime dependencies for the extracted UI.

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
  /** Optional real command behavior. Without this, the default command should be omitted to avoid a no-op. */
  openCommandRun?: () => void
  /** Optional creation behavior for 404/missing decks. Macro can use this to preserve auto-create. */
  createOnMissing?: boolean
  defaultContent?: (path: string) => string
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
  const pathPrefix = options.pathPrefix ?? 'deck/'
  const storage = options.storage ?? createHttpDeckStorage({ basePath: options.storageBasePath ?? '/api/deck' })
  const widgets = validateDeckWidgets(options.widgets ?? [])
  const DeckPaneComponent = createDeckPaneComponent({
    storage,
    widgets,
    components: options.components,
    markdownComponents: options.markdownComponents,
    remarkPlugins: options.remarkPlugins,
    theme: options.theme,
    defaultPath: options.defaultPath ?? 'deck/intro.md',
    pathPrefix,
    createOnMissing: options.createOnMissing,
    defaultContent: options.defaultContent,
  })

  return definePlugin({
    id,
    label,
    panels: options.includePanel === false ? [] : [{ id: panelId, label, component: DeckPaneComponent, placement: 'center', source }],
    // In the current plugin-agent-layer, `{ panelId }` alone does not open a panel.
    // Register the default command only when real command behavior is supplied.
    commands: options.includeCommand === false || !options.openCommandRun ? [] : [{ id: options.commandId ?? `${id}.open`, title: `Open ${label}`, panelId, run: options.openCommandRun }],
    surfaceResolvers: options.includeSurfaceResolver === false ? [] : [createDeckSurfaceResolver({ id: options.surfaceResolverId ?? `${id}.open-path`, panelId, pathPrefix })],
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
- panel command: omitted by default unless `openCommandRun` is provided; plugin-agent-layer currently treats `{ panelId }` without `run` as no-op
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
  compatibilityMode?: boolean
  includeBundledSkill?: boolean
  piPackages?: unknown[]
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
    piPackages: [
      ...(options.includeBundledSkill === false ? [] : [createDeckPiPackageSource()]),
      ...(options.piPackages ?? []),
    ],
    preservedUiStateKeys: options.preservedUiStateKeys,
  })
}

export default function defaultDeckServerPlugin(
  options?: { routeBase?: string; root?: string },
  ctx?: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  if (!options?.root && !ctx?.workspaceRoot) {
    throw new Error('defaultDeckServerPlugin requires options.root or ctx.workspaceRoot')
  }
  const root = options?.root ?? join(ctx!.workspaceRoot, 'deck')
  return createDeckServerPlugin({
    routeBase: options?.routeBase ?? '/api/deck',
    storage: createFileDeckStorage({ root, stripPrefix: 'deck/' }),
  })
}
```

Default route shape and HTTP compatibility contract:

- `GET {routeBase}` with `?path=` returns `text/markdown`
- `PUT {routeBase}` with `?path=` accepts `{ content: string }` by default. If `compatibilityMode: true`, also accept raw `text/plain` / `text/markdown` string bodies. Respect `readOnly`, `preHandler`, `maxContentBytes`, and `allowedContentTypes` in route tests. Successful writes return `{ ok: true, path, bytes }`.
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

- Split path handling into two layers:
  - `src/shared/path.ts`: browser-safe lexical validation only. No `node:*`, no `Buffer`. It rejects empty paths, null bytes, absolute/drive/UNC paths, backslashes, `.`/`..` segments, encoded traversal after decode, and disallowed extensions. It returns both `{ displayPath: "deck/foo.md", storagePath: "foo.md" }` so panel params/layout ids can preserve `deck/...` while file storage uses root-relative paths.
  - `src/server/resolveDeckPath.ts`: Node-only containment and symlink safety. It realpaths the deck root, rejects symlink roots/parents/targets, checks every existing ancestor with `lstat`, creates missing parents only below the real root, then re-checks containment before read/write.
- Only allow `.md` writes by default.
- Reject symlink escapes for reads and writes, including symlinked parent directories.
- List output format is `{ items: string[] }` where items are display paths with the configured prefix (`deck/foo.md`) for consistency with surface resolver targets.
- Allow nested decks under `deck/**/*.md`; lexical/path checks must protect traversal separately from nesting.
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

When a host loads `@hachej/boring-deck` through package discovery, `package.json#pi.skills` contributes the bundled skill. When a host imports `createDeckServerPlugin(...)` directly, the builder should also contribute the bundled skill through `piPackages` unless `includeBundledSkill: false` is set; otherwise the server prompt could reference a skill that was never loaded.

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
}

export type DeckSegment =
  | { type: 'markdown'; text: string }
  | { type: 'widget'; name: string; attrs: Record<string, string>; raw: string; position: 'block' | 'inline' }
```

Inline custom components should use the same `{{WidgetName ...}}` registry and be represented as widget tokens inside markdown text. The renderer must preserve paragraph flow: do not render inline widgets as sibling block chunks beside independently rendered markdown. Either add a remark plugin that converts moustache text nodes into custom inline nodes, or render parsed paragraph inline tokens directly. Parser must not recognize widgets inside fenced code blocks or inline code spans. Container components with markdown children are deferred until a real consumer needs directive syntax.

Functions:

```ts
export function parseDeckMarkdown(input: string): ParsedDeck
export function parseWidgetAttrs(raw: string): Record<string, string>
export function splitSlides(input: string): string[]
```

Tests:

- YAML frontmatter title extracted
- legacy leading `---` plus `## title: ...` and plain first-slide `## title: ...` stay compatible
- `---` slide split only on delimiter line
- widgets parsed with quoted attrs
- attr grammar is explicit: quoted strings only, strict key regex, escaped quote behavior, duplicate attr behavior, malformed widget fallback behavior
- unknown widgets remain structured
- malformed widget syntax falls back to markdown or placeholder
- inline moustache widgets render custom components inside paragraphs and preserve surrounding text
- block moustache widgets render custom components on their own slide line
- widget-looking text inside fenced code and inline code is not executed
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
- Confirm the target base has `plugins/_template-full`, `@hachej/boring-workspace/plugin`, `definePlugin`, `BoringFrontFactoryWithId`, `toWorkspacePlugin`, `package.json#boring` manifest validation, and default server factory resolver tests.
- Treat `@hachej/boring-deck` as a concrete package.json plugin with safe defaults, while still exporting builders for customized consumers such as `boring-macro`.
- Add any package scripts/invariant checks needed so `plugins/deck/src` is covered by workspace plugin invariants.

Acceptance:

- Plan and implementation references use `definePlugin`, `BoringFrontFactoryWithId`, `defineServerPlugin`, `WorkspaceServerPlugin`, `package.json#boring`, `pi.skills`, and default server factory semantics matching plugin-agent-layer.
- Deck package work does not start against an older pre-merge API shape.

### Phase 1a — Scaffold package and manifest

- Copy `plugins/_template-full` to `plugins/deck` as a starting point.
- Rename package to `@hachej/boring-deck`.
- Keep and update template `package.json#boring` fields so `@hachej/boring-deck` is manifest-loadable; add `pi.skills` for static deck-authoring guidance.
- Add explicit runtime dependencies used by the extracted UI (`@hachej/boring-ui-kit`, `lucide-react`, `react-markdown`, `remark-gfm`) and do not add domain charting dependencies such as `recharts`.
- Verify `pnpm-workspace.yaml` already covers `plugins/*`; only change it if the real target does not.
- Add package scripts, tsconfig, tsup, vitest config, and test setup.

Acceptance:

- Manifest validation accepts `boring.front`, `boring.server`, `pi.skills`, and `pi.systemPrompt`.
- `pnpm --filter @hachej/boring-deck build`, `typecheck`, and `test` can run against stubs.

### Phase 1b — Empty public builders compile

- Add stub exports in `plugins/deck/src/front/index.tsx`, `plugins/deck/src/server/index.ts`, and `plugins/deck/src/shared/index.ts`.
- Export `createDeckPlugin`, default front plugin, `createDeckServerPlugin`, default server factory, shared constants/types.
- Default server factory requires `options.root` or `ctx.workspaceRoot`; it must not silently fall back to `process.cwd()`.

Acceptance:

- `pnpm --filter @hachej/boring-deck typecheck` passes.
- No imports from `boring-macro`, FRED, ClickHouse, `TimeSeries`, `TimeSeriesGrid`, or `recharts` exist in `plugins/deck/src`.

### Phase 2 — Shared path, constants, and parser contracts

- Implement `src/shared/constants.ts`, `src/shared/types.ts`, `src/shared/path.ts`, and `src/shared/parser.ts`.
- `shared/path.ts` performs lexical validation only; no `node:*`, no DOM, no `Buffer`.
- Decide and test list format now: return display paths such as `deck/foo.md`.
- Allow nested decks under `deck/**/*.md`.
- Parser output must support title/frontmatter, slides, block widget lines, and inline widget tokens without breaking paragraph flow.
- Define attr grammar: quoted strings only, accepted key regex, escaped quote behavior, duplicate attr behavior, and malformed widget fallback behavior.
- Add fixtures copied from current macro decks for YAML frontmatter, legacy `## title:`, leading `---`, `TimeSeries`, `TimeSeriesGrid`, chart-only slide, malformed moustache, and widget-looking code spans/fenced code.

Acceptance:

- Shared tests cover empty paths, `../`, encoded traversal after decode, absolute POSIX paths, Windows drive paths, UNC paths, backslashes, null bytes, bad extensions, prefix stripping, and nested decks.
- Parser tests prove inline widgets are renderable without MDX/eval and `splitSlides` only splits delimiter lines.
- `plugins/deck/src/shared/**` has no `node:*`, DOM, React, or `Buffer` imports.

### Phase 3 — Widget registry and front storage primitives

- Implement `plugins/deck/src/front/widgets.tsx` with widget validation, block/inline display handling, unknown-widget placeholder, parser failure placeholder, and deck-owned error boundary.
- Implement `plugins/deck/src/front/storage.ts` with `DeckStorageClient`, `createHttpDeckStorage`, abort handling, headers, base path, and error mapping.
- Add `useDeckDocument` or equivalent headless hook for load/save/autosave/reload behavior before porting visual UI.
- Decide generic missing-deck behavior. Generic default may show empty/error; macro can set `createOnMissing` and `defaultContent` to preserve current auto-create-on-404 behavior.

Acceptance:

- One throwing widget does not blank the slide/deck.
- Duplicate/invalid widget names fail during `createDeckPlugin(...)`.
- Storage tests cover GET text, PUT JSON, optional raw-string compatibility, abort signal, non-OK errors, and no hardcoded app-specific route.

### Phase 4 — Generic DeckPane UI and standalone route component

- Port `DeckPane` as a generic renderer only; exclude macro widgets, macro routes, macro data imports, and charting dependencies.
- `DeckPane` receives configured storage/widgets/slots/theme through a closure component created by `createDeckPlugin(...)`; do not use global mutable registry state.
- Define mode precisely: panel modes are `read`/`edit`; `present` is standalone/fullscreen context if retained. Align `DeckRuntimeContext.mode` with implementation.
- Export `StandaloneDeckRoute` as an optional component only; package plugin registration does not magically register host app routes.
- Keep raw HTML/MDX eval disabled.

Acceptance:

- Render tests pass in jsdom for loading, missing deck, markdown slide, inline widget, block widget, unknown widget, widget error, slots, theme accent override, keyboard navigation, and presenter behavior.
- Grep confirms no imports from `boring-macro`, macro data, FRED, ClickHouse, `TimeSeries`, `TimeSeriesGrid`, `recharts`, or workspace chart packages.

### Phase 5 — Front plugin builder and surface resolver

- Implement `createDeckPlugin(...)` with configured `DeckPaneComponent`, widgets, storage, components, markdown components, theme, default path, path prefix, and missing-deck options.
- Register panel and surface resolver via `definePlugin(...)`.
- Register a command only if it has real behavior (`openCommandRun` or future shell-supported open command); avoid a no-op panel command.
- Surface resolver opens markdown paths under the configured prefix and rejects non-markdown, outside-prefix, traversal-ish, and disabled cases.

Acceptance:

- `toWorkspacePlugin(createDeckPlugin(...))` outputs expected panel/resolver and optional command.
- Tests assert panel id, command id/title/panelId/run behavior, resolver id, resolver kind, source, title, params, disabled resolver, configured prefix, and negative cases.

### Phase 6a — File storage security

- Implement `plugins/deck/src/server/fileStorage.ts` and `plugins/deck/src/server/resolveDeckPath.ts`.
- Use real root containment and symlink-safe ancestor/target checks.
- Do not put Node path logic in `shared`.

Acceptance:

- Tests cover parent symlink, file symlink, nonexistent path under symlinked parent, absolute paths, Windows/UNC strings, null bytes, encoded traversal after route decode, extension allow-list, read/write containment, nested deck paths, and list filtering.

### Phase 6b — Server routes and server plugin builder

- Implement `plugins/deck/src/server/routes.ts`, `createDeckServerPlugin(...)`, default server factory, and prompt wiring.
- Route tests cover GET markdown content type, PUT JSON, optional raw string compatibility, list, readOnly, maxContentBytes, content-type allow list, preHandler invocation, status codes, and stable error response bodies.
- Default server factory requires `options.root` or `ctx.workspaceRoot`.

Acceptance:

- `plugins/deck/src/server/__tests__/fileStorage.test.ts` and `routes.test.ts` pass.
- Route registration works with configured `routeBase` and Fastify prefix composition.

### Phase 6c — Prompt, skill, and Pi resource wiring

- Implement `plugins/deck/src/server/prompt.ts` and `plugins/deck/skills/deck-authoring/SKILL.md`.
- Keep server prompt concise and point to the skill.
- Ensure manifest loading discovers `pi.skills`.
- Ensure direct `createDeckServerPlugin(...)` usage contributes the bundled skill through `piPackages` unless `includeBundledSkill: false` is set.

Acceptance:

- `createDeckSystemPrompt` tests pass.
- Manifest validation includes `boring.front`, `boring.server`, `pi.skills`, and `pi.systemPrompt`.
- Direct builder tests verify skill resource contribution or explicitly disabled contribution.

### Phase 7 — Docs, examples, and invariant gates

- Add `plugins/deck/README.md`.
- Document manifest loading and builder/custom widget usage.
- Update root README plugin table.
- Add one minimal manifest-loading example and one custom widget example.
- Add invariant/grep gates for generic boundaries.

Acceptance:

- `pnpm --filter @hachej/boring-deck typecheck`
- `pnpm --filter @hachej/boring-deck test`
- `pnpm --filter @hachej/boring-deck build`
- `pnpm lint:workspace-plugin-invariants`
- Grep confirms no generic deck imports from macro/domain code.

### Phase 8 — Rewire boring-macro in separate follow-up work

Split macro migration into separate beads/PRs:

1. Macro widget definitions: move `TimeSeries` and `TimeSeriesGrid` behavior into macro-owned widget definitions.
2. Macro front composition: use `createDeckPlugin(...)`, preserve panel id `deck`, resolver behavior, and `/present?path=` route integration.
3. Macro server composition: preserve `/api/macro/deck`, inject `macroConfig.deckRoot`, carry auth/localhost bypass behavior, and compose unique server plugin ids or explicit route/prompt merge.
4. Macro compatibility/e2e gate: run existing macro deck specs and manual smoke before deleting legacy code.

Acceptance:

- Existing macro deck paths still open.
- Existing deck markdown with `TimeSeries` and `TimeSeriesGrid` renders unchanged.
- Existing `/api/macro/deck` GET/PUT/list behavior remains compatible.
- Saved Dockview layouts still open panel id `deck`.
- `TimeSeries` chip opens chart panel.
- Legacy macro files are not deleted until compatibility is proven and deletion is explicitly approved.

## 10. Testing checklist

Deck package:

```bash
pnpm --filter @hachej/boring-deck typecheck
pnpm --filter @hachej/boring-deck test
pnpm --filter @hachej/boring-deck build
pnpm lint:workspace-plugin-invariants
rg -n "boring-macro|FRED|ClickHouse|TimeSeries|TimeSeriesGrid|recharts" plugins/deck/src && false || true
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
6. `{{TimeSeriesGrid ids="UNRATE;PAYEMS" titles="Unemployment;Payrolls" columns="2"}}` renders as a grid.
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
- Preserve `/present?path=...`, supported title conventions, and missing-deck auto-create behavior unless explicitly changed in a separate migration.

## 12. Risks and mitigations

### Risk: Deck plugin becomes too macro-specific

Mitigation: generic package must not import macro series APIs, macro route paths, macro constants, or macro widget implementations. Domain widgets are injected by their owning app/plugin.

### Risk: Extension API freezes internals too early

Mitigation: expose only stable slots and widget registry first.

### Risk: Server route security regression

Mitigation: write traversal corpus tests for the generic file storage before replacing any consumer-specific path guard.

### Risk: Inline widget support breaks markdown paragraph flow

Mitigation: make inline token rendering or a moustache-aware remark transform a dedicated bead, with tests proving surrounding paragraph text, emphasis, links, code spans, and fenced code behavior.

### Risk: Direct builder usage references an unloaded skill

Mitigation: make bundled skill resource contribution part of `createDeckServerPlugin(...)` via `piPackages`, and test both manifest-loaded and directly composed server plugin paths.

### Risk: Duplicate markdown styling differences

Mitigation: snapshot or DOM tests for representative slides, plus manual visual smoke.

### Risk: Saved macro layouts break

Mitigation: keep `panelId: 'deck'` for the generic default plugin and for macro's first integration unless a layout migration is explicitly added.

## 13. Locked decisions and deferred items

1. **Default plugin vs builders** — ship both. `@hachej/boring-deck` is manifest-loadable through `package.json#boring` and also exports builders for customized consumers.
2. **Parser location** — parser and lexical path validation live in `shared` only if they remain browser-safe and import no React, DOM, `node:*`, or `Buffer`.
3. **Widget syntax** — v1 canonical syntax is moustache widgets: `{{WidgetName key="value"}}`. MDX/eval is not allowed. `remark-directive`/container components are deferred until a real consumer needs markdown children inside custom components.
4. **Widget attrs** — start with quoted string attrs only. Define key regex, escaped quote behavior, duplicate attr behavior, and malformed attr fallback before implementation.
5. **Default storage** — frontend default is HTTP storage at `/api/deck`; server default is file storage rooted at `ctx.workspaceRoot/deck` and requires `ctx.workspaceRoot` or explicit `options.root`.
6. **List format** — `GET /list` returns display paths with prefix (`deck/foo.md`) and supports nested `deck/**/*.md`.
7. **Missing deck behavior** — generic default can show empty/error; macro migration can opt into current auto-create behavior with `createOnMissing`/`defaultContent`.
8. **Command behavior** — do not register a default open command unless it has real `run` behavior or the shell adds panel-opening semantics for panel commands.
9. **Deletion** — do not delete legacy macro deck files/routes until compatibility is proven and deletion is explicitly approved.

## 14. Bead-ready implementation breakdown

Each bead should include goal, exact files, dependencies, acceptance commands, fixtures, and non-goals. Avoid beads that require simultaneous edits to both `boring-ui` and `boring-macro` repos.

1. **Base/API verification**
   - Files: plan/docs only.
   - Depends on: plugin-agent-layer branch availability.
   - Acceptance: target branch exposes `plugins/_template-full`, `@hachej/boring-workspace/plugin`, `definePlugin`, `BoringFrontFactoryWithId`, `toWorkspacePlugin`, manifest validation, and default server factory resolver support.

2. **Deck package scaffold + manifest**
   - Files: `plugins/deck/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/test-setup.ts`, empty `src/**` indexes.
   - Acceptance: package builds/types/tests against stubs; manifest contains `boring.front`, `boring.server`, `pi.skills`, `pi.systemPrompt`; no domain deps.

3. **Shared constants/path/parser contracts**
   - Files: `plugins/deck/src/shared/constants.ts`, `types.ts`, `path.ts`, `parser.ts`, shared tests.
   - Acceptance: lexical path corpus and parser fixture corpus pass; shared imports no Node/React/DOM.

4. **Widget registry + inline renderer contract**
   - Files: `plugins/deck/src/front/widgets.tsx`, widget tests.
   - Acceptance: block/inline moustache widgets, unknown placeholder, invalid/duplicate name rejection, parse failure placeholder, and error boundary behavior pass.

5. **HTTP storage client + document state hook**
   - Files: `plugins/deck/src/front/storage.ts`, `useDeckDocument.ts`, tests.
   - Acceptance: GET/PUT/list, aborts, non-OK errors, optional create-on-missing, debounced save behavior, no hardcoded macro route.

6. **Generic DeckPane + standalone component**
   - Files: `plugins/deck/src/front/DeckPane.tsx`, `components.tsx`, `StandaloneDeckRoute.tsx`, render tests.
   - Acceptance: generic markdown deck renders, slots/theme work, presenter navigation works, inline widgets preserve paragraphs, no macro/chart imports.

7. **Front plugin builder + surface resolver**
   - Files: `plugins/deck/src/front/index.tsx`, `surfaceResolver.ts`, plugin tests.
   - Acceptance: `toWorkspacePlugin(createDeckPlugin(...))` captures configured panel/resolver/optional command; widgets/storage/theme are passed through closure component.

8. **File storage security**
   - Files: `plugins/deck/src/server/fileStorage.ts`, `resolveDeckPath.ts`, tests.
   - Acceptance: symlink and traversal corpus passes before any consumer migration.

9. **Routes + server plugin builder**
   - Files: `plugins/deck/src/server/routes.ts`, `index.ts`, route/plugin tests.
   - Acceptance: GET/PUT/list, readOnly, compatibilityMode, preHandler, maxContentBytes, content types, stable errors, default factory root requirements pass.

10. **Prompt + skill + Pi resource wiring**
    - Files: `plugins/deck/src/server/prompt.ts`, `plugins/deck/skills/deck-authoring/SKILL.md`, manifest tests.
    - Acceptance: manifest-loaded and directly composed server plugin paths both make deck authoring guidance available.

11. **Docs/examples/invariants**
    - Files: `plugins/deck/README.md`, root README/plugin table, examples.
    - Acceptance: typecheck/test/build/invariant commands pass; docs show manifest loading and custom widget injection.

12. **Macro follow-up: widget extraction**
    - Repo: `boring-macro` follow-up branch.
    - Acceptance: macro-owned `TimeSeries`/`TimeSeriesGrid` widgets match current behavior; generic deck imports no macro code.

13. **Macro follow-up: front/server composition**
    - Repo: `boring-macro` follow-up branch.
    - Acceptance: panel id `deck`, `/present?path=...`, `/api/macro/deck`, auth/dev bypass, missing-deck behavior, and saved layouts remain compatible.

14. **Macro follow-up: compatibility gate and legacy cleanup**
    - Repo: `boring-macro` follow-up branch.
    - Acceptance: existing focused macro tests and manual smoke pass. Only then request explicit approval before deleting/replacing legacy deck files/routes.
