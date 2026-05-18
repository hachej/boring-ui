# Plugin / Agent Layer — Standalone Implementation Plan

> Sole source of truth for rebuilding the plugin / agent layer of
> `@hachej/boring-workspace` from `main`. Phases are sequential; meet
> each phase's acceptance criteria before moving on. Type signatures,
> validation rules, error contracts, and the trickier algorithms are
> spelled out in full. The plan does **not** dump source — that
> defeats the rebuild.

## Contents

0. [Starting state](#0-starting-state)
1. [Glossary](#1-glossary)
2. [End-to-end behaviour](#2-end-to-end-behaviour)
3. [Architecture](#3-architecture)
4. [Public API](#4-public-api)
5. [Implementation phases](#5-implementation-phases)
6. [Key algorithms](#6-key-algorithms)
7. [Gotchas](#7-gotchas)
8. [Non-goals](#8-non-goals)
9. [Acceptance](#9-acceptance)
10. [Risk register](#10-risk-register)

---

## 0. Starting state

`main` already has:

- `@hachej/boring-workspace` — UI runtime (`WorkspaceProvider`, panel /
  command / catalog / surface-resolver registries, layouts, bridge,
  Dockview shell, slash-command registry).
- `@hachej/boring-agent` — `createAgentApp`, `ChatPanel`, Pi harness.
- `@hachej/boring-ui-kit`, `@hachej/boring-pi` (vendored).

This plan adds: the plugin contract, `createWorkspaceAgentServer`, the
asset manager + SSE pipeline, `WorkspaceAgentFront`, the
`/plugin`, `/plugin/server`, `/app/{front,server}` subpath exports,
and four first-class plugins (`_template`, `ask-user`,
`data-explorer`, `data-catalog`).

After the plan, an app integrates with one server call and one
component:

```ts
await createWorkspaceAgentServer({
  workspaceRoot,
  mode: "local",
  appPackageJsonPath: resolve(APP_ROOT, "package.json"),
})

<WorkspaceAgentFront workspaceId="myapp" apiBaseUrl="" />
```

Plugins are listed in `apps/<app>/package.json#boring.defaultPluginPackages`.
The app never imports plugin modules statically.

---

## 1. Glossary

| Term | Definition |
| --- | --- |
| **Plugin** | npm package with `package.json#boring.{front,server}` (one may be `false`; at least one of the two is required). Contributes UI surfaces and / or agent runtime resources. Listed in `defaultPluginPackages`. |
| **Plugin kit** | npm package **without** `package.json#boring`. Exports named factories like `createXPlugin(options)` returning an unbranded `BoringFrontFactory` (or a plain `WorkspaceServerPlugin` from the server side). Not installable on its own; composed inside a Plugin. |
| **Library** | npm package with normal exports (components, types). Not a plugin or kit. Imported anywhere. |
| **App** | Host that calls `createWorkspaceAgentServer` + renders `WorkspaceAgentFront`. Declares its plugin set via `package.json#boring.defaultPluginPackages`. |
| **`BoringFrontFactory`** | `(api: BoringFrontAPI) => void`. Default export of `boring.front`. |
| **`WorkspaceServerPlugin`** | Declarative server plugin object (system prompt, agent tools, Pi packages, routes, dispose, …). Returned by `boring.server`'s default export, called with `(options, ctx) = (undefined, { workspaceRoot, bridge })` — see §4 for the typed-factory helper. |
| **Asset manager** | `BoringPluginAssetManager`. Scans plugin dirs, hashes content, emits `boring.plugin.{load,unload,skip,error}` SSE events. Owns a single Pi-resource snapshot served to `getDynamicResources`. |
| **Revision** | Per-plugin monotonic int. Bumps when a plugin's content signature changes. Cache-busts the front module URL. |
| **Surface** | Abstract UI request `{ kind, target, meta }`. Front plugins register resolvers that translate a surface into a panel open. |

Note: "concrete plugin" / "thin concrete plugin" terminology from
earlier drafts has been collapsed. There are two categories that
matter for loading: **Plugin** (manifest-driven, default-exports
branded factory; installable) and **Plugin kit** (no manifest; named
exports; composed inside a Plugin).

---

## 2. End-to-end behaviour

**Install.** App author runs `npm i @me/some-plugin`, adds the name to
`package.json#boring.defaultPluginPackages`, restarts dev. Plugin's
panels, tools and prompt appear. No imports in app source.

**Hot reload.** Author edits plugin source; types `/reload` in the
chat. Server re-scans dirs, jiti re-imports server entries (after
awaiting the previous instance's `dispose()`), SSE pushes new
revisions, browser dynamic-imports the new front modules and
atomically replaces registry entries per plugin id. No restart.
**Per-plugin failures do not block other plugins** — the failed
plugin's previous version stays live, error surfaces in the chat
banner; other plugins' new code lands normally.

**Plugin error.** Plugin server throws on import → asset manager
writes `.error` file, emits `boring.plugin.error`, banner surfaces.
Previous live state untouched. Other plugins unaffected.

**Composition (factory chaining).** A Plugin can compose multiple
kits with a shared `api`:

```ts
export default definePlugin("my-concrete", (api) => {
  dataExplorerFactory(api)
  createDataCatalogPlugin({ adapter: pg })(api)
})
```

Intra-plugin id collisions across kits are **detected at capture
time** and throw a `PluginError("duplicate-id", …)` naming both the
plugin id and the colliding output id — see §6.7.

---

## 3. Architecture

```
┌─ App ──────────────────────────────────────────────────────────────┐
│ package.json#boring.defaultPluginPackages                          │
│ server.ts  → createWorkspaceAgentServer(opts)                      │
│ App.tsx    → <WorkspaceAgentFront workspaceId apiBaseUrl />        │
└──────────────────────┬──────────────────────────┬──────────────────┘
                       ▼                          ▼
┌─ @hachej/boring-workspace/app/server ───┐  ┌─ /app/front ─────────┐
│ readAppManifestDefaultPlugins           │  │ WorkspaceAgentFront  │
│ resolveDefaultPluginPackagePaths        │  │  ├ WorkspaceProvider │
│ pluginEntryResolver (jiti)              │  │  ├ ChatLayout        │
│ bootstrapServer (aggregate)             │  │  └ useAgentPlugin    │
│ BoringPluginAssetManager (scan + SSE)   │  │     HotReload (SSE)  │
│ createAgentApp (Fastify + Pi)           │  └──────┬───────────────┘
│ boringPluginRoutes                      │         │
│ beforeReload → load + rebuildPlugins    │         ▼
└─────────────────────────────────────────┘  Registries (atomic
                                              replaceByPluginId)
```

**Boot.** App manifest → resolve dirs → `resolveOnePluginEntry` each →
`bootstrapServer` aggregates → `createAgentApp` boots Pi + Fastify →
asset manager initial scan emits SSE events → routes registered.

**Reload.** `/reload` → `beforeReload` → `assetManager.load()`
re-hashes and bumps revisions → `rebuildServerPlugins` jiti re-imports
(after `await prev.dispose?.()`) → `systemPromptDynamic` +
`getDynamicResources` refresh Pi from the manager's cached snapshot →
SSE pushes load events with new revisions → front dynamic-imports
`<frontUrl>?v=<rev>` and replaces per registry. Per-plugin failures
emit error events but do not abort the rest of the reload.

### Subpath exports

The split is by **audience**, not by physical layer:

| Subpath | Audience | Contents |
| --- | --- | --- |
| `/` | App + plugin | UI runtime (existing on main) |
| `/plugin` | Plugin author (front) | `definePlugin`, `BoringFrontAPI`, manifest validators, test harness |
| `/plugin/server` | Plugin author (server) | `defineServerPlugin`, `defineServerPluginFactory`, `WorkspaceServerPlugin` type |
| `/app/server` | App author | `createWorkspaceAgentServer`, orchestration types |
| `/app/front` | App author | `WorkspaceAgentFront` |
| `/shared` | Both | Runtime-agnostic contracts |

Note: a plugin author imports **only** from `/plugin` and
`/plugin/server`. They do not touch the orchestration types in
`/app/server` — that's host-only surface.

---

## 4. Public API

### 4.1 Plugin `package.json`

```jsonc
{
  "name":    "@me/some-plugin",
  "type":    "module",
  "boring":  {
    "label":  "My plugin",
    "front":  "dist/front/index.js",   // default export = BoringFrontFactory; or "false" for server-only
    "server": "dist/server/index.js"   // default export = (options, ctx) => WorkspaceServerPlugin
                                       //                | WorkspaceServerPlugin object
                                       //                | result of defineServerPluginFactory<TOptions>(...)
                                       // or "false" for front-only
  },
  "pi": {
    "systemPrompt": "…",
    "packages":     ["./some-pkg", "npm:remote-pkg"],
    "skills":       ["skills/x"],
    "extensions":   ["dist/agent/index.js"]
  },
  "exports": { /* . / ./front / ./server / ./shared / ./package.json */ },
  "peerDependencies": { "@hachej/boring-workspace": "workspace:*", "react": "^18 || ^19", "react-dom": "^18 || ^19" }
}
```

At least one of `boring.front` / `boring.server` must be set. The
plugin id is **always derived from `package.json#name`** (with leading
`@` stripped, `/` → `-`, validated against `PLUGIN_ID_RE`). Authors do
not pass an id separately; `definePlugin(id, …)` must be called with
the same derived id — `lint:invariants` enforces this so a copy-paste
mismatch fails fast (§Phase 9).

### 4.2 App `package.json`

```jsonc
{ "boring": { "defaultPluginPackages": ["@me/some-plugin", "./src/plugins/inline"] } }
```

Entries: npm names (resolved via `createRequire`) or `./`-prefixed
relative paths. **If any entry is relative, `appPackageJsonPath` is
required** in `createWorkspaceAgentServer({ … })` so the host can
anchor resolution — otherwise startup throws with the offending entry
listed. Unresolved npm names also throw at boot — silent drop is
forbidden.

### 4.3 Front authoring (`@hachej/boring-workspace/plugin`)

```ts
type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>

interface BoringFrontAPI {
  registerProvider(reg:        { id; component: PluginProvider }): void
  registerBinding(reg:         { id; component: PluginBinding  }): void
  registerCatalog(catalog:     CatalogConfig): void
  registerPanel<T>(reg:        BoringFrontPanelRegistration<T>): void
  registerPanelCommand(reg:    BoringFrontPanelCommandRegistration): void
  registerLeftTab<T>(reg:      BoringFrontLeftTabRegistration<T>): void
  registerSurfaceResolver<K extends string>(reg: {
    id?:     string                                // default `${pluginId}:${kind}`
    kind:    K
    source?: string
    resolve: (req: Extract<SurfaceOpenRequest, { kind: K }>) =>
               SurfacePanelResolution | null | undefined
  }): void
}

interface BoringFrontPanelRegistration<T> {
  id; component; label?; icon?; placement?: string  /* default "center" */
  requiresCapabilities?; essential?; lazy?; chromeless?; source?  /* default "plugin" */
}
interface BoringFrontPanelCommandRegistration { id; title; panelId; run?: () => void }
interface BoringFrontLeftTabRegistration<T>   { id; title; panelId; icon?; component?; lazy?; chromeless?; requiresCapabilities?; source? }

// Returns a NEW wrapper that delegates to the caller's factory. Does NOT
// mutate the input. Caller's factory remains unbranded and reusable.
// Throws if the wrapper would clash with a pre-existing brand on `factory`.
function definePlugin(id: string, factory: BoringFrontFactory, options?: { label?: string }): BoringFrontFactoryWithId
type BoringFrontFactoryWithId = BoringFrontFactory & { pluginId: string; pluginLabel?: string }
```

### 4.4 Server authoring (`@hachej/boring-workspace/plugin/server`)

```ts
interface WorkspaceServerPlugin {
  id: string
  label?: string
  systemPrompt?: string
  agentTools?:        AgentTool[]
  piPackages?:        WorkspacePiPackageSource[]
  extensionPaths?:    string[]
  extensionFactories?: WorkspaceExtensionFactory[]
  provisioning?:      RuntimeProvisioningContribution
  routes?:            FastifyPluginAsync          // captured at boot; see §4.7 hot-reload table
  preservedUiStateKeys?: string[]
  /** Called before the plugin is replaced (new revision) OR unloaded.
   *  Must complete within 5 s; the manager logs + continues on timeout.
   *  Required for plugins that hold disposable resources (DB connections,
   *  intervals, bridge listeners). Without it, reloads leak. */
  dispose?(): void | Promise<void>
}

type WorkspacePiPackageSource =
  | string
  | { source: string; extensions?: string[]; skills?: string[]; themes?: string[]; prompts?: string[] }

// Validates + returns the plugin (shallow clone).
function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T

// Branded typed-factory wrapper. Plugin authors who need access to
// `ctx.workspaceRoot` / `ctx.bridge` and / or typed `options` should use
// this; resolver detects the brand to give clearer "did you forget
// `export default`?" errors and to type-check options.
function defineServerPluginFactory<TOptions = void, T extends WorkspaceServerPlugin = WorkspaceServerPlugin>(
  factory: (input: { options: TOptions; workspaceRoot: string; bridge: WorkspaceBridge }) => T | Promise<T>,
  schema?: { parse: (raw: unknown) => TOptions },   // optional zod-like validator
): BoringServerPluginFactory<TOptions, T>
```

The destructured single-arg signature (`{ options, workspaceRoot,
bridge }`) is preferred to `(options, ctx)` for new code: it
self-documents which ctx fields are used, makes typed options
ergonomic, and matches the front's single-arg `(api)` shape.

### 4.5 Host entry (`@hachej/boring-workspace/app/server`)

```ts
type WorkspacePluginEntry =
  | WorkspaceServerPlugin
  | { dir:     string; options?: unknown; hotReload?: boolean }
  | { package: string; options?: unknown; hotReload?: boolean }   // npm-name; resolved via §6.3

interface WorkspaceAgentServerPluginContext { workspaceRoot: string; bridge: ReturnType<typeof createInMemoryBridge> }

interface CreateWorkspaceAgentServerOptions extends Omit<CreateAgentAppOptions, "pi"> {
  pi?:                   WorkspaceAgentPiOptions
  plugins?:              WorkspacePluginEntry[]
  appPackageJsonPath?:   string                // required if any defaultPluginPackages entry starts with "./" or "../"
  defaultPluginPackages?: string[]             // inline override; mainly for tests
  pluginHotReload?:      boolean               // default: NODE_ENV !== "production"; governs server re-import + Pi-resource refresh
  /** Server-side allowlist. Plugins not in the list are loaded front-only
   *  (their boring.server is ignored with a logged warning). `"all"`
   *  trusts every defaultPluginPackages entry. Recommended in prod: list
   *  the exact ids you trust to execute server code. */
  serverPluginAllowlist?: "all" | "none" | string[]   // default in prod: "all"; explicit list is safer
  provisionWorkspace?:   boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?:      boolean
  /** Optional structured logger. Defaults to a pino-style adapter on Fastify's logger. */
  logger?: { info(msg: string, fields?: object): void; warn(...): void; error(...): void }
}

function createWorkspaceAgentServer(opts): Promise<FastifyInstance>
```

A single `pluginHotReload` flag drives both server re-import and Pi
resource refresh; the historical `boringPluginReload` /
`piPluginReload` split is collapsed because their useful matrix had
only two states.

### 4.6 Front host (`@hachej/boring-workspace/app/front`)

```ts
interface WorkspaceAgentFrontProps<TSession>
  extends Omit<WorkspaceProviderProps, "children" | "workspaceId" | "storageKey" | "chatPanel">,
          Omit<ChatLayoutProps, "navParams" | "centerParams" | "surfaceParams" | "sidebarParams"> {
  workspaceId: string
  chatPanel?:  WorkspaceChatPanelComponent
  useSessions?: UseWorkspaceAgentSessions<TSession>
  /* sessions, activeSessionId, onSwitchSession, onCreateSession, … */
  sessionStorageKey?:  string  providerStorageKey?: string  surfaceStorageKey?: string
  beforeShell?: ReactNode      afterShell?: ReactNode
  appTitle?: string            defaultSessionTitle?: string
  defaultSurfaceOpen?: boolean defaultWorkbenchLeftTab?: WorkbenchLeftTabId
  topBarLeft?: ReactNode       topBarRight?: ReactNode
  chatParams?: Partial<WorkspaceChatPanelProps>
  /** Default: undefined → use the server's reported capability (from a header on the
   *  SSE handshake). Setting `true` / `false` overrides. Avoid setting unless you have
   *  a specific reason — letting the server own this prevents UI/server drift. */
  hotReloadEnabled?: boolean
  extraPanels?: string[]       extraCommands?: SlashCommand[]
}
```

### 4.7 Hot-reload coverage table

| Plugin contribution | Reload mechanism | When the change is visible |
| --- | --- | --- |
| `package.json#pi.systemPrompt` | asset-manager re-hash → `getDynamicResources` | next agent turn |
| `package.json#pi.{packages,extensions,skills}` | asset-manager snapshot | next agent turn |
| `WorkspaceServerPlugin.systemPrompt` | server rebuild via jiti | next agent turn |
| `WorkspaceServerPlugin.agentTools` | server rebuild — tool registry rebuilt | **next chat session** (existing session keeps boot-time tools) |
| `WorkspaceServerPlugin.extensionFactories` | server rebuild | next agent turn |
| `WorkspaceServerPlugin.routes` | **NOT reloaded** | server restart required |
| Front: panels / panel commands / left tabs / surface resolvers | SSE → atomic registry replace | immediately |
| Front: providers / bindings | NOT reloaded (mounted in React tree at boot) | server restart required |

If a `/reload` cycle changes a plugin whose signature includes a
server file *and* the plugin declares `routes`, the response includes
a tip: `"Route handlers changed — restart server to apply."`

### 4.8 Prompt-location guidance

Two valid places exist; pick one per plugin:

- **`WorkspaceServerPlugin.systemPrompt`** — preferred when the plugin
  ships `agentTools`. Prompt + tool defs co-evolve in the same file.
- **`package.json#pi.systemPrompt`** — use only for plugins with no
  server entry (front-only / prompt-only).

`aggregatePluginPrompts` walks both in a deterministic order
(alphabetical by plugin id, server prompt first per plugin) and
dedupes identical lines. Authors who put a prompt in both locations
get a single boot warning naming the plugin.

---

## 5. Implementation phases

Each phase: **Goal · Deliverables · Algorithms · Acceptance**. Test
scenarios are stated as acceptance bullets; write vitest tests that
exercise each.

### Phase 0 — Scaffolding

**Goal.** Folder + subpath export layout.

**Deliverables.** Folders under `packages/workspace/src/`:
`shared/plugins/`, `server/plugins/`, `server/agentPlugins/`,
`app/server/`, `app/front/`, `front/agentPlugins/`. Subpath exports
in `packages/workspace/package.json` and `tsup.config.ts`:
`/plugin`, `/plugin/server`, `/app/{server,front}`, `/shared`. (No
`/server` — `bootstrapServer` is host-internal.)

**Critical.** `tsup` `external` MUST include
`"@mariozechner/pi-coding-agent"` and `"jiti"`. Without externalising
Pi, Vite fails to bundle the front (`Could not resolve "fs"`).

**Acceptance.** `pnpm --filter @hachej/boring-workspace build`
produces every subpath dist file; a consumer can import each subpath.

### Phase 1 — Shared contracts

**Goal.** Browser-safe types every phase depends on.

**Deliverables.**

`shared/plugins/manifest.ts`:

```ts
interface BoringPackageBoringField { front?: string | false; server?: string | false; label?: string; derivesFrom?: string }
interface BoringPackagePiSourceObject { source: string; extensions?: string[]; skills?: string[]; themes?: string[]; prompts?: string[] }
type    BoringPackagePiSource = string | BoringPackagePiSourceObject
interface BoringPackagePiField { extensions?; skills?; packages?: BoringPackagePiSource[]; systemPrompt?: string }
interface BoringPluginPackageJson { name?; version?; boring?; pi? }

type BoringPluginManifestErrorCode = "INVALID_ID" | "INVALID_VERSION" | "INVALID_FIELD" | "INVALID_PATH" | "MISSING_REQUIRED_FIELD"
interface BoringPluginManifestIssue { code; field: string /* dotted path */; message: string }
type BoringPluginManifestValidationResult = { valid: true; packageJson } | { valid: false; issues }

function validateBoringPluginManifest(raw, source?: string): BoringPluginManifestValidationResult
function isValidBoringPluginId(id): boolean         // /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
function isSafePluginRelativePath(value): boolean    // non-empty, not ".", no nulls, no \, no leading /, no Windows drive, no ".." segments
function isSafePluginRelativeGlob(value): boolean    // adds !, brace-.., ** escape checks
```

Validation rules: `version` matches semver if present;
`boring.{front,server}` (string) must be safe relative paths; either
field can be `false` (front-only or server-only plugin), but at least
one of `boring.front` / `boring.server` must be present (else
`MISSING_REQUIRED_FIELD`); `boring.id` is **rejected** (use
`package.json#name`); `pi.{extensions,skills}` are arrays of safe
relative paths; `pi.packages[*]`: string or `{ source, …filters }` —
workspace validates source only (npm:/git:/github:/http:/https:/ssh:
prefixes, file: paths, or plain relative). Filter contents are **not**
validated — Pi owns that.

**Every validation error carries an absolute path** to the offending
`package.json` (passed in via `source`) and the dotted `field` path so
the operator can click-to-open in their editor.

`shared/plugins/types.ts`: `PluginOutput` discriminated union with
literal `type` field; arms: `left-tab`, `panel`, `command`, `catalog`,
`binding`, `provider`, `surface-resolver`. Plus supporting catalog /
pane / left-tab types.

`shared/plugins/bootstrap.ts`:

```ts
interface PanelRegistryLike            { register(id, config): void }
interface CommandRegistryLike          { registerCommand(command): void }
interface CatalogRegistryLike          { register(catalog, pluginId): void }
interface SurfaceResolverRegistryLike  { register(id, config): void }

function bootstrap(opts: {
  chatPanel; plugins?; defaults?; excludeDefaults?: string[];
  registries: { panels; commands; catalogs?; surfaceResolvers? }
}): { registered: string[]; systemPromptAppend: string }
```

Algorithm: throw `PluginError("validation", …)` on missing chatPanel
or `PluginError("duplicate-id", \`plugin id "${id}" registered twice:
\n  first:  ${a.source}\n  second: ${b.source}\`)` on duplicate
plugin id; apply `excludeDefaults`; for each plugin, register
`panels[]`, `commands[]`, `catalogs[]`, then dispatch each `outputs[]`
entry to the matching registry; `binding`/`provider` are no-ops here
(mounted later in the React tree); compute `systemPromptAppend` per
§4.8 ordering rules.

`shared/plugins/index.ts`: re-export `PluginError`, `PluginErrorKind`,
`bootstrap`, registry interfaces, `PluginOutput` union arms, and the
output / catalog / pane types. Do **not** re-export the front factory
helpers — those live on the `/plugin` subpath (Phase 8).

**Acceptance.** Manifest validation accepts boring-front-only,
boring-server-only, pi-only, both, neither (→
`MISSING_REQUIRED_FIELD`); rejects `boring.id`, unsafe paths, unsafe
pi.packages sources; leaves filter contents to Pi. Every error message
includes the source `package.json` absolute path. `bootstrap` throws
on no chatPanel and duplicate ids (with both source paths); registers
each output via the registry interfaces; returns concatenated prompt.

### Phase 2 — Server plugin contract

**Goal.** `defineServerPlugin` + `defineServerPluginFactory` +
aggregation.

**Deliverables.**

`server/plugins/defineServerPlugin.ts` — `validateServerPlugin(plugin,
source?)` checks: required non-empty `id`; `agentTools[i]` has
non-empty `name`, `description`, `parameters` object, `execute`
function; `piPackages[i]` is string or `{source, …filters with allowed
keys extensions|skills|themes|prompts}`;
`provisioning.templateDirs[*]` has `{id, path: string|URL, target?}`;
`provisioning.nodePackages[*]` has `{id, packageName, packageRoot:
string|URL}`; `provisioning.python[*]` has `{id, projectFile,
extraLibs?, env?}`; `routes` and `extensionFactories[i]` are
functions; `systemPrompt` is string; `dispose` (if present) is a
function. On failure: throw `ServerPluginError(\`${source ??
"<unknown source>"}: server plugin "${id ?? "<unknown>"}" — ${field ?
field + ": " : ""}${message}\`)`. `defineServerPlugin(plugin)` calls
validate and returns a shallow clone with a brand symbol
(`__boringServerPlugin: true`) so the resolver can detect "you
accidentally exported a plain object that happens to look like a
plugin."

`defineServerPluginFactory<TOptions, T>(factory, schema?)` brands the
factory with `__boringServerFactory: true` so the resolver gives the
"did you forget `export default`?" error when the import lands the
factory on a *named* export. When `schema` is provided, the resolver
calls `schema.parse(entry.options)` before invoking the factory;
otherwise `options` flows through unchanged.

`server/plugins/piPackages.ts`: re-export adapter:

```ts
export { compactPiPackages, PI_PACKAGE_RESOURCE_FILTERS, type PiPackageSource as WorkspacePiPackageSource } from "@hachej/boring-agent/server"
```

`server/plugins/bootstrapServer.ts`:

```ts
function bootstrapServer({ plugins?, defaults?, excludeDefaults? }): {
  systemPromptAppend: string
  piPackages:         WorkspacePiPackageSource[]
  extensionPaths:     string[]
  extensionFactories: WorkspaceExtensionFactory[]
  agentTools:         AgentTool[]
  provisioningContributions: { id; provisioning }[]
  routeContributions:        { id; routes }[]
  preservedUiStateKeys:      string[]
}
```

Algorithm: `final = [...defaults.filter(p => !excludeDefaults.has(p.id)), ...plugins]`;
`validateServerPlugin(p, p.__source)` each; throw on duplicate id
naming both source files; aggregate fields flatly; `piPackages =
compactPiPackages(plugins.flatMap(p => p.piPackages ?? []))`;
`systemPromptAppend` per §4.8 (alphabetical by id, server prompt first,
deduped); `preservedUiStateKeys` deduped via Set.

**Acceptance.** Validation covers all rules with file-path-bearing
errors; aggregator returns correct shape; duplicate id throws with
both sources; malformed plugin throws with clear message naming the
source.

### Phase 3 — Plugin entry resolver

**Goal.** Single dispatch from any entry shape to a
`WorkspaceServerPlugin`.

**Deliverables.** `app/server/pluginEntryResolver.ts`:

```ts
interface DirPluginEntry     { dir:     string; options?: unknown; hotReload?: boolean }
interface PackagePluginEntry { package: string; options?: unknown; hotReload?: boolean }   // resolves via §6.3 to a dir, then like DirPluginEntry
interface PluginResolveContext { workspaceRoot: string; bridge: WorkspaceBridge }

function isDirEntry(entry):     entry is DirPluginEntry
function isPackageEntry(entry): entry is PackagePluginEntry
async function resolveOnePluginEntry<T extends WorkspaceServerPlugin>(entry, ctx): Promise<T>
```

Dispatch: `isPackageEntry → resolve npm name → resolveDirServerPlugin
(synthetic DirPluginEntry)` · `isDirEntry → resolveDirServerPlugin` ·
else pass-through.

`resolveDirServerPlugin`:

1. Read `package.json` from `entry.dir` (throw if absent).
2. Resolve `serverPath`: manifest field `boring.server` first (`false`
   → return `null` and tag the plugin as front-only; string → resolve
   relative; throw if file missing). Else try conventions (§6.6). If
   `hotReload`, conventions prefer `src/` so dev source wins over
   stale `dist/`.
3. Import via §6.2 (jiti when `hotReload`, native otherwise).
4. **Detect missing `export default`**: if `mod.default` is absent but
   `mod` has any named exports shaped like a server factory (function
   with `length >= 1` or object with `__boringServerPlugin` /
   `__boringServerFactory` brand), throw `Error(\`${serverPath}: boring.server
   entry must use \`export default\`. Got named exports: ${Object.keys(mod).join(", ")}\`)`.
5. `value = mod.default`. If `value.__boringServerFactory` → call with
   `{ options: schema?.parse(entry.options) ?? entry.options, workspaceRoot,
   bridge }` and return. If plain function → call `value(entry.options,
   ctx)` (legacy signature support) and return. If object with
   `__boringServerPlugin` brand → return. If object with `id` but no
   brand → warn `[boring] plugin at ${serverPath} returns a plain
   object — prefer defineServerPlugin({...}) for validation` and
   return. Else throw with `serverPath` in the message.
6. **Path containment**: `realpathSync(serverPath)` must stay under
   `realpathSync(entry.dir)`; throw `BoringPluginError("PATH_ESCAPE",
   …)` otherwise. (This is a load-time guard against manifest-pointed
   symlink escapes; it is NOT a sandbox — see §7.)

**Acceptance.** Pre-built object passes through; dir entry loads via
manifest field; convention fallback works in declared mode order;
declared-but-missing throws; missing-default-export error names the
named exports; function default called per §4 signature rules;
non-function non-object default throws; `hotReload: true` re-imports
fresh after a source edit and prefers `src/` over `dist/`; manifest
pointing at a symlink that escapes the plugin dir throws
`PATH_ESCAPE`.

### Phase 4 — `createWorkspaceAgentServer`

**Goal.** The orchestrator. Reads app manifest, resolves + aggregates
plugins, boots Fastify + Pi, wires `beforeReload` with **partial-
failure tolerance** and **dispose lifecycle**.

**Deliverables.**

`app/server/rebuildServerPlugins.ts`:

```ts
async function rebuildServerPlugins({ entries, ctx, previous, logger }): Promise<{
  ok: boolean; fatal: boolean
  plugins: WorkspaceServerPlugin[]
  diagnostics: { source: string; pluginId?: string; message: string }[]
}>
```

For each entry: optionally `await previous.get(id)?.dispose?.()` with
a 5s timeout (`logger.warn` on timeout); then
`resolveOnePluginEntry(entry, ctx)`. On error, push diagnostic with
`source = isDirEntry(entry) ? \`directory (${dir})\` : isPackageEntry ?
\`package (${entry.package})\` : "entry"`. Failed entries do **not**
abort the rest. `fatal = false` always (a fatal flag is reserved for
infrastructural failures like the asset manager being unable to
enumerate dirs).

`app/server/createWorkspaceAgentServer.ts` orchestration:

1. `bridge = createInMemoryBridge()`; resolve `logger` (caller's or
   default Fastify pino adapter).
2. `defaultPluginPackages = mergeManifestAndInline({ inline:
   opts.defaultPluginPackages, manifest:
   readAppManifestDefaultPlugins(opts.appPackageJsonPath) })`. If
   inline overrides manifest, log `[boring] inline plugins override
   manifest` listing both sources. If both empty and not in test mode,
   warn `[boring] no plugins declared — pass appPackageJsonPath or
   defaultPluginPackages`.
3. `defaultPluginPackagePaths = resolveDefaultPluginPackagePaths({
   workspaceRoot, appPackageJsonPath }, defaultPluginPackages)` —
   §6.3. **Throw if any relative entry exists and `appPackageJsonPath`
   is unset.** Throw on unresolved npm names with the resolution
   attempts and `appPackageJsonPath` in the error.
4. Apply `serverPluginAllowlist`: for each resolved dir, if `id` is
   not allowed for server, override the synthetic entry with
   `boring.server: false` (front-only) and log `[boring] plugin
   "${id}" loaded front-only (not in serverPluginAllowlist)`.
5. `allPluginEntries = [...defaultDirEntries, ...(opts.plugins ?? [])]`
   where each default gets `hotReload: opts.pluginHotReload ??
   (process.env.NODE_ENV !== "production")`.
6. `ctx = { workspaceRoot, bridge }`.
7. `resolvedPlugins = await Promise.all(allPluginEntries.map(e =>
   resolveOnePluginEntry(e, ctx)))` — fatal at boot only (per-entry
   throw aborts boot); reload is tolerant via `rebuildServerPlugins`.
8. `pluginCollection = collectWorkspaceAgentServerPlugins({ ...opts,
   plugins: resolvedPlugins })` — calls `bootstrapServer`, prepends
   workspace + Pi `nodePackageContribution`s, composes
   `pi.additionalSkillPaths = [workspaceSkillsDir, ...callerAdditional]`,
   runs `compactPiPackages`.
9. Optionally `provisionWorkspaceAgentServer` unless
   `provisionWorkspace === false`.
10. `boringPluginDirs = dedup([\`${workspaceRoot}/.pi/extensions\`,
    ...extensionPathRoots, ...defaultPluginPackagePaths])`.
11. `assetManager = new BoringPluginAssetManager({ pluginDirs:
    boringPluginDirs, errorRoot:
    \`${workspaceRoot}/.pi/extensions\`, logger })`.
12. `rebuildPlugins = async () => rebuildServerPlugins({ entries:
    allPluginEntries, ctx, previous: lastResolvedById, logger })`.
13. `app = await createAgentApp({
        ...opts,
        beforeReload: async () => {
          if (opts.pluginHotReload !== false) {
            const r = await assetManager.load()
            if (r.fatal) throw new Error("Boring plugin scan failed fatally: " + r.fatalMessage)
            // Per-plugin scan errors are already surfaced via SSE error events + .error files.
            const rb = await rebuildPlugins()
            if (rb.fatal) throw new Error("Boring plugin re-resolve failed fatally")
            // Per-plugin rebuild diagnostics flow into POST /api/boring.reload's 422 body
            // via a side-channel — they do NOT throw here.
          }
          await opts.beforeReload?.()
        },
        pi: {
          ...pluginCollection.agentOptions.pi,
          additionalSkillPaths: staticSkillPaths,
          packages:            staticPiPackages,
          extensionPaths:      staticExtensionPaths,
          extensionFactories:  pluginCollection.agentOptions.pi?.extensionFactories,
          getDynamicResources: () => assetManager.piResourceSnapshot(),   // O(plugins) map read, no I/O
        },
        systemPromptDynamic: opts.pluginHotReload !== false ? () => aggregatePluginPrompts(assetManager) : undefined,
      })`.
14. `await assetManager.load()`.
15. Register `uiRoutes`, `boringPluginRoutes(app, { manager: assetManager, logger, capability: { hotReload: pluginHotReload !== false } })`, each `routeContributions.routes` inside encapsulated `app.register(plugin.routes, { prefix: \`/api/plugins/${id}\` })` scopes so Fastify validates uniqueness per-plugin.
16. Attach `(app as any).__boringRebuildPlugins = rebuildPlugins`.

`app/server/index.ts` barrel re-exports `createWorkspaceAgentServer`,
`collectWorkspaceAgentServerPlugins`, `provisionWorkspaceAgentServer`,
`buildWorkspaceContextPrompt`, and orchestration types. **It does NOT
re-export `defineServerPlugin` / `WorkspaceServerPlugin`** — those
live on `/plugin/server` for plugin authors.

`readAppManifestDefaultPlugins` re-reads on **every** `/reload` so a
user can add or remove plugins by editing the manifest without
restarting the dev server.

**Acceptance.** No plugins → empty arrays passed to Pi. Manifest
default plugins resolve and end up as `DirPluginEntry` items.
Unresolved npm entry → throw with `appPackageJsonPath` in the
message. Relative entry without `appPackageJsonPath` → throw.
`pluginHotReload: false` skips beforeReload scan + rebuild. `dispose`
of the previous instance is awaited (with 5 s timeout + log on
timeout) before its replacement loads. **Per-plugin rebuild
diagnostics do NOT abort the reload**; they flow to the 422 body of
`POST /api/boring.reload`. `serverPluginAllowlist` enforces front-only
fallback on disallowed plugins. `getDynamicResources` does zero I/O
(reads manager's cached snapshot). UI + plugin SSE routes + per-plugin
routes (encapsulated under `/api/plugins/<id>`) all registered.
`__boringRebuildPlugins` exposed.

### Phase 5 — Asset manager

**Goal.** Scan plugin dirs → hash → emit
`boring.plugin.{load,unload,skip,error}` events. Single-flight,
coalescing. Cache Pi resource snapshot. GC stale `.error` files.

**Deliverables.**

`server/agentPlugins/types.ts`:

```ts
interface BoringServerPluginManifest {
  id: string; rootDir: string; version: string
  boring: BoringPackageBoringField; pi?: BoringPackagePiField
  frontPath?: string; frontUrl?: string    // frontUrl = `/@fs/${frontPath}` (vite); production builds use a workspace-relative URL the host serves
  serverPath?: string; extensionPaths?: string[]; skillPaths?: string[]
}
type BoringPluginEvent =
  | { type: "boring.plugin.load";      id; boring; version; revision; frontUrl? }
  | { type: "boring.plugin.unload";    id; revision }
  | { type: "boring.plugin.skip";      id; revision; reason: "signature-unchanged" }
  | { type: "boring.plugin.error";     id; revision; message; source?: string }
  | { type: "boring.plugin.heartbeat"; ts: number }   // synthetic, every 60 s; lets the front observe SSE liveness
interface BoringPluginListEntry { id; boring; pi?; version; revision; frontUrl?; lastLoadedAt: number; signatureSegments?: string[] }
```

`server/agentPlugins/scan.ts`:

- `preflightBoringPlugins(pluginDirs)`: discovers dirs, parses each
  `package.json`, validates manifest, derives plugin id, detects
  duplicates, checks `realpathSync` path containment (caveat: this is
  a load-time input guard, **not a sandbox** — see §7).
- `readBoringPlugins(pluginDirs)`: returns `[]` only on **fatal**
  enumeration failures (cannot stat the input dirs). Per-plugin
  manifest issues become diagnostics, not silent drops.
- `pluginRootFromExtensionPath(extensionPath)`: requires
  `<pluginRoot>/agent/<entry>` convention.

`server/agentPlugins/manager.ts` (`class BoringPluginAssetManager`):

```ts
constructor({ pluginDirs, errorRoot?, logger? })
preflight(): BoringPluginPreflightResult
list():     BoringPluginListEntry[]
getError(pluginId): string | null
subscribe(listener: (event) => void): () => void
load(): Promise<{ loaded: BoringPluginListEntry[]; events: BoringPluginEvent[]; errors: { id; revision; message }[]; fatal: boolean }>
piResourceSnapshot(): { packages, skills, extensions }            // cached, served to getDynamicResources without I/O
diagnostics(): { perPlugin: { id; revision; signatureSegments; lastEvent; lastEventAt }[]; totals }
```

State: `loaded`, `revisions`, `listeners`, `loading`, `reloadQueued`,
`piSnapshot`, `lastQuickSigById`.

**Two-tier signature** (§6.1): `quickSignature` is `O(N stat)`,
`fullSignature` is `O(N file bytes)`. `doLoadOnce` computes
`quickSignature` first; if unchanged vs last load → skip
`fullSignature` and emit `boring.plugin.skip { reason:
"signature-unchanged" }` so operators can see why the reload was a
no-op for that plugin. Otherwise compute full to decide if revision
should bump.

**Single-flight `load()`**: if `loading` set → `reloadQueued = true;
return loading`. Else `loading = drainLoads()`. `drainLoads()` loops
`await doLoadOnce()` while `reloadQueued`.

**`doLoadOnce()`**: preflight; on errors write `.error` files under
`errorRoot/<preflightErrorId(dir)>/.error`, bump revision, emit error
event, **continue** (don't abort the live record). Compute `next =
readBoringPlugins(...)`. Unload set = ids in `loaded` not in `next` →
delete + bump revision + emit unload. For each `next` plugin: quick
signature → maybe full signature → bump revision and emit
load/skip/error as appropriate. Update `piSnapshot` from `next`
manifests so `getDynamicResources` returns fresh state without
re-reading disk.

**`.error` GC**: at end of every load, enumerate
`errorRoot/preflight-*` and `errorRoot/<id>/` directories; delete
those whose ids are no longer in either `loaded` or the current
preflight error set. Operators won't see orphan errors after fixing a
manifest.

**Symlink handling in signatures** (§6.1, important DX correctness
fix): `directorySignature` follows symlinks via `realpathSync` and
dedupes via a visited-realpath Set (depth cap 8, count cap 50 000,
abort with warning log if either cap hit). This makes pnpm `link:`
and symlinked `dist/` workflows hot-reloadable.

**Server module loading is NOT done here.** Asset manager is pure
scan + hash + emit. Server instantiation lives in `pluginEntryResolver`
and runs inside `rebuildServerPlugins`. The split is intentional: it
lets server-side tests run without an SSE pipeline, and lets the asset
manager's signature decision be the **single source of truth** for
"did this plugin change" — `rebuildServerPlugins` reads the manager's
state (`previous` arg from Phase 4) to skip jiti re-import when the
quick signature matches, paying full re-import cost only when content
actually changed.

`server/agentPlugins/aggregatePluginPrompts.ts` (one helper):

```ts
function aggregatePluginPrompts(manager): string | undefined
```

Iterates `manager.list()` in alphabetical id order, collects truthy
prompts per §4.8 ordering, dedupes identical lines; returns
`undefined` if none.

**Logging.** Every notable event flows through the injected `logger`:
`boring.plugin.scan.skipped { id, reason: "symlink-cycle"|"node_modules" }`,
`boring.plugin.signature.{quick-unchanged,full-changed,full-unchanged}`,
`boring.plugin.load { id, revision, durationMs }`,
`boring.plugin.error`, `boring.plugin.dispose { id, durationMs,
timedOut }`, `boring.plugin.registry.collision-skipped`,
`boring.plugin.sse.{subscribe,unsubscribe,dropped}`. Operators
debugging "why didn't my edit reload" follow the log.

**Acceptance.** Empty dirs → empty result. Single valid plugin →
load(rev=1). Reload no changes → skip events emitted (not silent
no-op). Edit a file → quick sig changes → full sig hash → revision
bumps → single load. Delete a plugin → unload + bump. Preflight
failure → error events + previous live unchanged. 5 concurrent
`load()` calls → 1–2 doLoadOnce passes. Listener throw doesn't break
others. `.error` file persisted; orphan `.error` files GC'd on next
load. Symlinked plugin (pnpm link:) reloads correctly. Manager serves
Pi resource snapshot with zero I/O. Symlink cycles don't loop;
visited cap aborts cleanly.

### Phase 6 — SSE routes + front subscriber

**Goal.** Push events; consume and atomically replace registry
entries per plugin id. Surface SSE liveness on the front.

**Deliverables.**

`server/agentPlugins/routes.ts` — `boringPluginRoutes(app, { manager,
logger, capability })`:

- `POST /api/boring.reload` → `manager.load()`; if any per-plugin
  errors or rebuild diagnostics: 422 with `{ ok:false, errors,
  diagnostics, plugins }`; else 200 with `{ ok:true, plugins }`. The
  body carries diagnostics from BOTH the asset manager AND
  `rebuildServerPlugins` (Phase 4 wires them in).
- `POST /api/boring.reload/:id` → load a single plugin by id (looks up
  dir from manager); useful for "reload only this plugin while I'm
  iterating."
- `GET  /api/agent-plugins` → `manager.list()`.
- `GET  /api/agent-plugins/:id/error` → text body or 404.
- `GET  /api/agent-plugins/diagnostics` → `manager.diagnostics()` —
  last-load summary, per-plugin revisions and signature segments,
  registry collision warnings. Pi capability reported here too
  (`{ pluginHotReload }`) so the front can drive its
  `hotReloadEnabled` from server truth.
- `GET  /api/v1/agent-plugins/events` — **SSE** per §6.4.

**SSE auth + caps.** The endpoint reuses the same auth predicate as
the agent's other routes (`/api/v1/agent/*`); unauthenticated requests
get `401`. Cap: 32 concurrent connections per workspaceId; over cap
returns `429`. Per-client backpressure: if `res.writableNeedDrain`,
drop the event for that client and log
`boring.plugin.sse.dropped { reason: "slow-consumer" }`. `req.raw.on("close" | "error", unsubscribe)`
guarantees listener removal even when the client never sends a FIN.
The heartbeat write doubles as liveness probe: on throw, unsubscribe.

**SSE replay on connect.** Browsers auto-reconnect; the server emits
`boring.plugin.load` for every current plugin on every connection so
the front never lands in stale state.

**SSE observable heartbeat.** Every 60 s the server emits a
*non-comment* `boring.plugin.heartbeat { ts }` event in addition to
the 25 s comment-style `: heartbeat`. The comment keeps proxies alive;
the observable event lets the front compute `sseHealthy =
(Date.now() - lastEventAt) < 90 000`.

**Production `frontUrl`.** In dev `frontUrl = \`/@fs/${absPath}\``
(Vite filesystem convention). In production builds, the host serves
plugin bundles at a workspace-relative URL like
`/_plugins/<id>/<rev>/index.js`; the asset manager emits that URL
instead of `/@fs/...` (Vite's `/@fs` would leak the server's
filesystem layout to any reader of the SSE stream).

`front/agentPlugins/reloadEvent.ts`:

```ts
export const WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT = "boring-ui:agent-plugins-reloaded"
```

`front/agentPlugins/registerAgentPlugin.tsx` —
`useAgentPluginHotReload(options)`:

```ts
interface RegisterAgentPluginOptions {
  apiBaseUrl?: string; workspaceId?: string; enabled?: boolean
  importFront?: (frontUrl, revision) => Promise<{ default?: BoringFrontFactory }>
  onHealthChange?: (healthy: boolean) => void   // surfaces sseHealthy to PluginUpdateStatus
}
```

Implements §6.5 (revision dedup) + §6.7 (atomic per-registry replace
with **intra-pluginId collision detection** — see §6.7). Tracks
`lastEventAt` and exposes `sseHealthy` via `onHealthChange` (Phase 8
wires it into the banner). On unmount: clear `latestRequestedRef`,
close EventSource. Server-only plugins (`frontUrl` absent) skip the
import path but still update `lastSeenRef` so subsequent events are
processed in order.

**Acceptance.** Hook subscribes; renders contributions on
`boring.plugin.load`; new revision remounts updated panes. Slow front
import racing newer revision: only newer commits. Disposed hook
ignores in-flight imports. Failed front import: previous version
stays. Malformed SSE data: logged, no commit. Unload removes entries.
Error event logged. Skip event arrives → banner says "no changes
detected" (Phase 8). Reconnect: server replays current state, hook
dedups via `lastSeenRef`. Cross-origin SSE with `withCredentials:
true` flows cookies. Server-only plugin (no `frontUrl`) emits load
events but no banner spam. SSE health: if no event for 90 s after a
successful `/reload`, banner shows degraded state. SSE auth: requests
without the agent auth predicate get 401. Connection cap enforced.

### Phase 7 — Hot reload integration

**Goal.** Wire `/reload` through server + front; deliver the
coverage promised by §4.7.

**Deliverables.** No new files; modifications:

- `createAgentApp.beforeReload` (Phase 4) calls
  `assetManager.load()` + `rebuildServerPlugins` and **propagates
  diagnostics into the response body without throwing** (per-plugin
  failures don't abort the reload).
- `systemPromptDynamic` returns `aggregatePluginPrompts(manager)`.
- `pi.getDynamicResources` returns `manager.piResourceSnapshot()` (no
  I/O in the hot path).
- `WorkspaceProvider` mounts `useAgentPluginHotReload(...)` inside
  registry context.
- `/reload` slash command (exists on main; if not, add) calls
  `POST /api/v1/agent/reload`. Composer banner uses
  `PluginUpdateStatus` (Phase 8) to surface running / success /
  degraded / error.
- If a reloaded plugin declares `routes`, the response body carries a
  tip; banner shows "Route handlers changed — restart server to apply."
- If a reloaded plugin declares `agentTools`, the response body
  carries a tip about new-session-needed pickup; banner shows
  "Tools updated — start a new chat session to pick them up" (matches
  §4.7).

**Acceptance.** Edit server file → `/reload` → next agent turn uses
new prompt + extensionFactories. Edit a tool → next chat session has
new tool. Edit a route handler → banner says "restart required" + no
silent acceptance. Edit front file → SSE re-imports updated pane. New
entry in `defaultPluginPackages` → next `/reload` picks it up.
Removed plugin disappears after reload. Server entry throws during
rebuild → 422 with diagnostics; live plugins unaffected; other
plugins' new code lands. Preflight error → 422 + error event +
previous live plugins untouched. Reload after fixing a manifest:
old `.error` files are gone.

### Phase 8 — Front authoring + `WorkspaceAgentFront`

**Goal.** Plugin authoring helpers + the top-level shell + test
harness exports.

**Deliverables.**

`shared/plugins/defineFrontPlugin.ts` (internal IR):

```ts
class PluginError extends Error { constructor(public kind: PluginErrorKind, message: string) { super(message) } }
type PluginErrorKind = "validation" | "duplicate-id" | "runtime"

interface WorkspaceFrontPlugin { id; label?; systemPrompt?; outputs: PluginOutput[] }
function defineFrontPlugin(input): WorkspaceFrontPlugin
```

Note: `WorkspaceFrontPlugin.systemPrompt` exists for the legacy
static-composition path but **§4.8 deprecates front-side prompts**.
Front-only / prompt-only plugins should put the prompt in
`package.json#pi.systemPrompt`. The field stays on the IR for the
moment; lint:invariants warns when both are set.

`shared/plugins/frontFactory.ts`:

```ts
type BoringFrontFactory       = (api: BoringFrontAPI) => void | Promise<void>
type BoringFrontFactoryWithId = BoringFrontFactory & { pluginId: string; pluginLabel?: string }
type WorkspaceFrontPluginInput = WorkspaceFrontPlugin | BoringFrontFactoryWithId

interface CapturedBoringFrontRegistrations {
  panels: BoringFrontPanelRegistration<any>[]
  panelCommands: BoringFrontPanelCommandRegistration[]
  leftTabs: BoringFrontLeftTabRegistration<any>[]
  surfaceResolvers: BoringFrontSurfaceResolverRegistration[]
  outputs: PluginOutput[]
}

interface CapturingBoringFrontAPIHandle extends BoringFrontAPI { flush(): CapturedBoringFrontRegistrations }

function createCapturingBoringFrontAPI(opts?: { pluginId?: string }): CapturingBoringFrontAPIHandle
function boringFrontFactoryToPlugin(id, factory, options?): WorkspaceFrontPlugin
function definePlugin(id, factory, options?): BoringFrontFactoryWithId
function toWorkspacePlugin(input: WorkspaceFrontPluginInput): WorkspaceFrontPlugin
```

`definePlugin` returns a **new wrapper function** that delegates to
the caller's factory; attaches `pluginId` / `pluginLabel` via
`Object.defineProperty` (enumerable, non-writable). Does **not**
mutate the input factory. If the input already carries a different
`pluginId` brand → throws (prevents accidental rebrand of a shared
factory). The wrapper sets `Symbol.toStringTag` to `"BoringFront(<id>)"`
for better stack traces.

`createCapturingBoringFrontAPI`: each `register*` pushes both into
the matching array and a normalised `PluginOutput` into `outputs`.
**Intra-`pluginId` collision detection at capture time**: if two
`register*` calls in the same factory chain land the same output id,
throw `PluginError("duplicate-id", \`plugin "${pluginId}" registers
${kind} "${id}" twice\`)` with a stack-derived source hint. This
catches composition-pattern bugs (two kits both registering panel
"table") that §6.7's atomic replace cannot detect (same pluginId →
last-write-wins).

`boringFrontFactoryToPlugin`: calls factory synchronously; throws if
the factory returns a thenable (registration is synchronous by
contract); returns `defineFrontPlugin({ id, label, outputs:
captured.outputs })`.

`toWorkspacePlugin`: factory-with-id → wraps via
`boringFrontFactoryToPlugin`; bare factory without id → throws "wrap
with `definePlugin(id, factory)`"; plain `WorkspaceFrontPlugin` →
as-is.

**Test harness** (`shared/plugins/testing.ts`, exported from
`/plugin`):

```ts
function createTestFrontApi(opts?: { pluginId?: string }): CapturingBoringFrontAPIHandle
async function runFactoryAndCapture(factory: BoringFrontFactoryLike): Promise<CapturedBoringFrontRegistrations>
function createTestServerCtx(opts?: { workspaceRoot?: string }): WorkspaceAgentServerPluginContext
function mountPaneInHarness(component, opts?: { params?, workspaceProviderProps? }): RenderResult
async function runAgentToolInTestHarness(tool: AgentTool, args, opts?): Promise<ToolResult>
```

These are the **only supported** API surface for plugin authors'
unit tests. Authors who reach into internals must accept they may
break across patch releases.

Subpath barrel `packages/workspace/src/plugin.ts` re-exports
`definePlugin`, `boringFrontFactoryToPlugin`, all `BoringFront*`
types, `PluginOutput` arms, manifest validators + types, and the test
harness.

`app/front/WorkspaceAgentFront.tsx` (~400 LoC target). Composition
detail kept from prior draft; key revisions:

- Pass `bridgeEndpoint={null}` to `WorkspaceProvider`;
  `WorkspaceUiStateSync` owns PUT state.
- Mount `useAgentPluginHotReload({ apiBaseUrl, workspaceId, enabled:
  resolveHotReloadEnabled(opts.hotReloadEnabled), onHealthChange:
  setSseHealthy })`. `resolveHotReloadEnabled` reads server capability
  (Phase 6 `GET /api/agent-plugins/diagnostics`) on mount; falls back
  to `opts.hotReloadEnabled ?? true` if the endpoint isn't available.
- Storage keys: same as before; `:workbenchOpen` key MUST differ from
  `surfaceStorageKey`.
- Plugin normalisation, sessions, centerParams, `WorkspaceUiStateSync`
  inner component, UI command listener — same as prior draft.

`app/front/index.ts` barrel re-exports `WorkspaceAgentFront` + its
public prop types.

**`PluginUpdateStatus`** composer banner states:

```ts
type PluginUpdateState =
  | { kind: "running" }
  | { kind: "success"; reloaded: boolean; tips?: string[] }   // tips: route/tool reload caveats
  | { kind: "no-changes" }                                     // emitted when all events were "skip"
  | { kind: "degraded"; message: string }                      // SSE healthy=false ≥ 5 s after success
  | { kind: "error"; message: string }
function PluginUpdateStatus({ state, onDismiss, onRetry })
```

**Acceptance.** `definePlugin` returns a NEW function; input factory
remains unbranded and reusable. `definePlugin` with conflicting
existing brand throws. `toWorkspacePlugin` rejects bare factories.
Intra-pluginId collision throws at capture with both source hints.
SSE hook mounts only when `hotReloadEnabled`. Storage keys default
correctly. UI state PUT debounced/aborted. `WorkspaceUiStateSync`
noop when `bridgeEndpoint` null. `PluginUpdateStatus` renders all 5
states; "degraded" surfaces SSE staleness; "no-changes" appears when
all events were `skip`. Test harness exports import cleanly; an
example plugin's tests pass using only the harness API.

### Phase 9 — Built-in plugins

**Goal.** Ship four reference plugins + lint:invariants.

| Path | Category | Notes |
| --- | --- | --- |
| `plugins/_template/` | Plugin (reference) | See "Template contents" below — explicit checklist. |
| `plugins/ask-user/` | Plugin | Questions panel + `ask_user` tool. Server default uses `defineServerPluginFactory({ options, workspaceRoot, bridge }) => createAskUserServerPlugin({ ...options, workspaceRoot, bridge })`. |
| `plugins/data-explorer/` | Plugin (**promoted from library**) | Adds `package.json#boring.{front,server}`. Front default-exports a factory that registers the Explorer left-tab + a `"explorer.open"` surface resolver. Also exports `dataExplorerFactory(api)` named for kit-style composition. |
| `plugins/data-catalog/` | Kit | No `package.json#boring`. Exports `createDataCatalogPlugin({ adapter })` (front) and `createDataCatalogServerPlugin({ adapter })` (server). |
| `apps/workspace-playground/src/plugins/playgroundDataCatalog/` | Plugin | Default-exports a factory chaining `dataExplorerFactory(api)` + `createDataCatalogPlugin({ adapter: duckdb })(api)`. Listed in playground's `defaultPluginPackages`. |

**Delete** `plugins/askUserPlugin/` (legacy with no manifest).

#### Template contents (explicit)

`plugins/_template/` MUST demonstrate the patterns plugin authors ask
about within the first hour:

- Front entry: one panel, one panel-command, one surface resolver,
  one left-tab.
- Server entry: one `agentTool` that emits a `SurfaceOpenRequest`
  opening the panel; demonstrates `defineServerPluginFactory` with
  typed options.
- Shared types in `shared/index.ts` (front + server type-sharing
  example).
- `tests/panel.test.tsx` using `mountPaneInHarness` from the test
  harness.
- `tests/server.test.ts` using `runAgentToolInTestHarness`.
- `README.md` sections: "What this template demonstrates"
  (checklist); "Where to put your system prompt" (rule from §4.8);
  "Common mistakes" (forgot `export default`; pluginId != name;
  registered same id from two kits; tried to share state across panels
  — use the bridge).
- Top-of-file comment in the server entry naming WHY it puts the
  prompt in `WorkspaceServerPlugin.systemPrompt` (not pi) per §4.8.

#### `lint:invariants` rules added in this phase

For every package in `plugins/*` and `apps/*/src/plugins/*`:

1. If `package.json#boring` exists, `boring.front` or `boring.server`
   (or both) MUST be set; manifest must pass `validateBoringPluginManifest`.
2. **Plugin id consistency**: if `boring.front` exists, the default
   export of the built front file MUST be branded with `pluginId`
   equal to the derived id from `package.json#name`. Same for
   server's `defineServerPlugin({ id })` / `defineServerPluginFactory`
   returns. Mismatch fails CI.
3. `peerDependencies` MUST include `@hachej/boring-workspace`.
4. No static `import` of plugin modules from `apps/*/src/` (except
   factory-chaining composition inside a Plugin's own factory).

#### Plugin `package.json` template

Unchanged from prior draft (front + server + shared exports +
peerDeps + scripts).

#### Server entry template (using the typed-factory helper)

```ts
import { defineServerPlugin, defineServerPluginFactory, type WorkspaceServerPlugin } from "@hachej/boring-workspace/plugin/server"

interface XOptions { /* declare yours */ }

export default defineServerPluginFactory<XOptions>(({ options, workspaceRoot, bridge }) =>
  defineServerPlugin({
    id: "x",
    label: "X",
    systemPrompt: "…",   // co-located with the tool below per §4.8
    agentTools: [makeXTool({ workspaceRoot, bridge, ...options })],
    dispose: async () => { await myConnectionPool.close() },   // see §4 contract
  }),
)
```

#### Front entry template

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin("x", (api) => {
  api.registerPanel({ id: "x-pane", label: "X", component: XPane, placement: "center" })
  api.registerPanelCommand({ id: "open-x", title: "Open X", panelId: "x-pane" })
}, { label: "X" })
```

#### Composition (playgroundDataCatalog)

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { dataExplorerFactory } from "@hachej/boring-data-explorer/plugin"
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/plugin"
import { duckdbAdapter } from "./duckdbAdapter"

export default definePlugin("playground-data-catalog", (api) => {
  dataExplorerFactory(api)
  createDataCatalogPlugin({ adapter: duckdbAdapter })(api)
}, { label: "Catalog" })
```

Update playground's `package.json`:

```jsonc
"boring": { "defaultPluginPackages": [
  "@hachej/boring-ask-user",
  "@hachej/boring-data-explorer",
  "./src/plugins/playgroundDataCatalog"
] }
```

**Acceptance.** All four build, install via `defaultPluginPackages`,
hot-reload via `/reload`. `_template` contents match the checklist
above. Factory chaining in playgroundDataCatalog registers explorer +
catalog surfaces from one entry. Intra-plugin id collision (deliberately
introducing one) throws at capture with a clear error. lint:invariants
catches id-derivation mismatches and missing peerDeps.

### Phase 10 — Docs

`packages/pi/skills/boring-plugin-authoring/SKILL.md`: covers plugin
author contract, app installation, `definePlugin` /
`defineServerPlugin` / `defineServerPluginFactory`, the test harness,
the five composition patterns (configure-via-options, component reuse,
factory chaining, side-by-side, fork), and the prompt-location rule
from §4.8. Point to `_template` and the playground for live examples.

Refresh repo `README.md` "Plugin system" section to match this design.

### Phase 11 — Cleanup

Run: `pnpm typecheck`, `pnpm test`, `pnpm lint:invariants`,
`pnpm test:e2e`. Manual smoke in playground: load all plugins, edit a
source file, `/reload`, observe banner cycle (running → success or
no-changes). Introduce a syntax error, observe error banner; confirm
other plugins still update. Add a route to a plugin, observe the
"restart required" tip. Audit `packages/workspace/src/{index,plugin}.ts`
+ `plugin/server.ts` + `app/{server,front}/index.ts` barrels — confirm
exports match §4 and the public surface allowlist snapshot.

### Phase 12 — Deferred (post-merge)

Out of scope for the first cut but worth tracking:

- `create-boring-plugin` CLI generator (`pnpm dlx create-boring-plugin
  <slug>`) that copies `_template` with token replacement and prints
  the exact `defaultPluginPackages` line to add. Reduces "renamed
  template" desync mistakes to zero. Reasonable v2.
- `pnpm boring doctor` — a one-shot health check (extends
  lint:invariants with runtime checks like "front+server pluginId
  matches built code").
- Plugin asset CDN: instead of `/@fs/` for dev, serve hashed plugin
  bundles from the host app's static asset path in production.

---

## 6. Key algorithms

### 6.1 Plugin signature & revision (two-tier)

`fileSignature(path)`: `"missing"` if absent; else `sha256(mtimeMs +
size + bytes)`.

`directorySignature(root)`: `"missing"` if absent; else walk
recursively sorted-by-name skipping dotfiles and `node_modules`. For
symlinks: `realpathSync(linkPath)`; if target is under
`realpathSync(workspaceRoot)`, **follow once** tracking visited
realpaths via a Set (depth cap 8, count cap 50 000; abort + warn on
either cap). If target is outside the workspace, add a hash entry
`symlink-external:<rel>` and don't follow. The follow-once policy
makes pnpm `link:` workflows hot-reloadable.

`quickSignature(plugin)`: `sha256(version + frontPath + serverPath +
mtimeMs/size of each tracked file + top-level dir mtime/size)`.
`O(N stat)` — cheap.

`fullSignature(plugin)`: `sha256` of
`JSON.stringify({boring, pi})` + version + frontPath +
`fileSignature(frontPath)` + `directorySignature(dirname(frontPath))` +
`directorySignature(\`${dirname(frontPath)}/../shared\`)` + serverPath +
`fileSignature(serverPath)` + `directorySignature(dirname(serverPath))` +
`extensionPaths.join("|")` + `skillPaths.join("|")`. `O(N file bytes)`
— expensive.

`doLoadOnce` computes quick first; if unchanged → emit `skip` event,
no revision bump. Otherwise compute full; bump revision iff full
changed; emit `load` if revision bumped; emit `error` if hashing
threw.

Revision: `(revisions.get(id) ?? 0) + 1`, set, return.

### 6.2 jiti hot-reload import

```
function jitiImport(path) {
  const j = require("jiti")
  if (!j.createJiti) return null
  // Reuse a SHARED jiti instance across all reloads. moduleCache:false
  // ensures fresh module per call; recreating createJiti each call would
  // leak compile-cache state per reload.
  jitiInstance ??= j.createJiti(import.meta.url, { moduleCache: false })
  return jitiInstance.import(path)
}

async function importServerModule(path, hotReload) {
  if (hotReload) { const p = jitiImport(path); if (p) return await p }
  return await import(/* @vite-ignore */ pathToFileURL(path).href)
}
```

`moduleCache: false` is non-negotiable. Without it, the second import
returns the cached module → reload silently no-ops. If jiti is
unavailable warn once and fall back; subsequent reloads won't pick up
source changes (Node module cache). Note: don't use `data:` URLs —
they can't resolve npm bare specifiers.

The shared `jitiInstance` avoids leaking transformer + per-call
compile cache state across N reloads. Combined with plugin
`dispose()` (§4.4), the per-reload memory footprint stays bounded
even on dev sessions with hundreds of reloads.

### 6.3 Default plugin package resolution

```
function resolveDefaultPluginPackagePaths({ workspaceRoot, appPackageJsonPath }, entries) {
  return entries.map(entry => {
    if (entry.startsWith("./") || entry.startsWith("../")) {
      if (!appPackageJsonPath) throw new Error(
        `default plugin package "${entry}" is relative but appPackageJsonPath was not set; ` +
        `pass appPackageJsonPath to createWorkspaceAgentServer or use an absolute / npm name`
      )
      return resolve(dirname(appPackageJsonPath), entry)
    }
    if (isAbsolute(entry)) {
      if (!existsSync(join(entry, "package.json"))) throw new Error(`no package.json at ${entry}`)
      return entry
    }
    // npm name: try the app's require first (sees the app's node_modules
    // including pnpm-hoisted siblings), then workspace package's require.
    const tries: string[] = []
    if (appPackageJsonPath) {
      try { return dirname(createRequire(appPackageJsonPath).resolve(`${entry}/package.json`)) }
      catch (e) { tries.push(`app: ${e.message}`) }
    }
    try { return dirname(createRequire(`${workspaceRoot}/package.json`).resolve(`${entry}/package.json`)) }
    catch (e) { tries.push(`workspace: ${e.message}`) }
    try { return dirname(createRequire(import.meta.url).resolve(`${entry}/package.json`)) }
    catch (e) { tries.push(`internal: ${e.message}`) }
    throw new Error(`default plugin package not resolvable: ${entry}\n  appPackageJsonPath: ${appPackageJsonPath ?? "(unset)"}\n  ${tries.join("\n  ")}`)
  })
}
```

**Throw on unresolved.** Silent drop = mystery missing features. The
error includes every resolution attempt so the operator sees exactly
which lookup paths were tried.

### 6.4 SSE protocol

```
GET /api/v1/agent-plugins/events
< HTTP/1.1 200 OK
< Content-Type: text/event-stream
< Cache-Control: no-cache, no-transform
< Connection: keep-alive
< X-Accel-Buffering: no                 # disable nginx buffering

# Replay current state on connect
event: boring.plugin.load
data: { "type":"boring.plugin.load", "id":"…", "boring":{…}, "version":"…", "revision":3, "frontUrl":"…" }

# Comment-style heartbeat every 25 s (keeps proxies alive; not observable to EventSource handlers)
: heartbeat

# Observable heartbeat every 60 s (lets the front compute SSE liveness)
event: boring.plugin.heartbeat
data: { "type":"boring.plugin.heartbeat", "ts":1747600000 }
```

EventSource client uses `withCredentials: true`. Auth: the endpoint
reuses the same predicate as `/api/v1/agent/*`. Caps: 32 connections
per workspaceId, 429 over. Backpressure: drop events for slow consumers
(logged). On `req.raw.on("close" | "error", …)`: unsubscribe + clear
heartbeat interval.

### 6.5 Revision-based front dedup

Two refs guard the registry against stale / duplicated events:

- `lastSeenRef` — already committed.
- `latestRequestedRef` — currently in flight (import window).

Proceed only if `event.revision > max(lastSeen, latestRequested)`.
Re-check both before commit (newer event may have arrived during
`await import()`). On disposed unmount, clear `latestRequestedRef`.
Server-only plugins (no `frontUrl`) skip the import but still update
`lastSeenRef`.

### 6.6 Resolution conventions (manifest-first + dev-source-first fallback)

```
function resolvePluginEntryPath(dir, explicit, conventions) {
  if (explicit === false) return null
  if (explicit) {
    const p = resolve(dir, explicit)
    if (!existsSync(p)) throw new Error(`boring plugin entry declared but not found: ${p}\n  declared in: ${dir}/package.json#boring`)
    return p
  }
  for (const c of conventions) { const p = resolve(dir, c); if (existsSync(p)) return p }
  return null
}
```

Conventions when `hotReload: true` (dev): server prefers source first
to avoid loading a stale build:

```
["src/server/index.ts", "src/server.ts", "server/index.ts",
 "dist/server/index.js", "dist/server.js", "dist/index.js"]
```

Conventions when `hotReload: false` (prod): dist first:

```
["dist/server/index.js", "dist/server.js", "dist/index.js",
 "src/server/index.ts", "src/server.ts"]
```

Declared (`boring.server`) always wins. Earlier drafts framed this as
"Pi parity" — own it as Boring's resolution convention; reference the
behaviour, not the upstream file.

### 6.7 Atomic registry replace + intra-pluginId collision detection

Each registry implements `replaceByPluginId(pluginId, newEntries[])`:

```
owned = ids in registry where entry.pluginId === pluginId
if (owned.size === 0 && newEntries.length === 0) return
for (id of owned) registry.delete(id)
for (entry of newEntries) {
  const existing = registry.get(entry.id)
  if (existing && existing.pluginId !== pluginId) {
    logger.warn(`registry collision: plugin "${pluginId}" tried to register id "${entry.id}" already owned by "${existing.pluginId}" — skipped`)
    continue
  }
  registry.set(entry.id, { ...entry, pluginId })
}
emit() once   // single transition; Dockview never sees intermediate empty state
```

**Intra-pluginId collision is caught earlier**, at capture time inside
`createCapturingBoringFrontAPI`. Two `register*` calls in the same
factory chain landing the same output id throw `PluginError("duplicate-id",
\`plugin "${pluginId}" registers ${kind} "${id}" twice\`)` with a
stack-derived source hint. This is the composition-pattern failure
mode `replaceByPluginId` cannot detect (same pluginId → silent
last-write-wins).

### 6.8 Plugin dispose lifecycle

When `rebuildServerPlugins` is about to replace plugin id `X`:

1. Look up `prev = lastResolvedById.get(X)`.
2. If `prev?.dispose` exists, race `prev.dispose()` against a 5 s
   `setTimeout(reject)`. On timeout, log `boring.plugin.dispose {
   id: X, timedOut: true }` and continue — don't block the rebuild.
3. Catch + log thrown errors from `dispose`; continue.
4. Resolve the new plugin via `resolveOnePluginEntry`.
5. Update `lastResolvedById.set(X, newPlugin)`.

The same path runs on full unload (plugin removed from
`defaultPluginPackages`).

---

## 7. Gotchas

1. **Externalise Pi in tsup.** `external: ["@mariozechner/pi-coding-agent", "jiti"]`. Otherwise Vite fails to bundle the front (`Could not resolve "fs"`).
2. **jiti `moduleCache: false` is mandatory** for true reload. Without it `/reload` no-ops silently. **Reuse one jiti instance** across reloads (don't `createJiti` per call) to avoid leaking transformer state.
3. **No `data:` URL imports** — they can't resolve npm bare specifiers. Use jiti or `pathToFileURL`.
4. **Asset manager does NOT import server modules.** Scan + hash + emit only. Server instantiation lives in `pluginEntryResolver` / `rebuildServerPlugins`. The asset manager's signature is the single source of truth for "did this plugin change"; the rebuild path consults it to skip jiti re-import when nothing changed.
5. **`React.lazy` types must be stable across renders.** Cache wrapped lazy types by `panelId + importer` reference; hot reload invalidates by changing the importer.
6. **`workbenchOpen` storage key must differ from `surfaceStorageKey`** or both writers stomp the layout JSON.
7. **SSE must replay on connect.** Browsers auto-reconnect; without replay the shell looks half-empty.
8. **Cache-bust front module URL per revision.** `${url}${url.includes("?") ? "&" : "?"}v=${rev}` — browsers key the module cache by URL.
9. **Throw on unresolved `defaultPluginPackages` entries** — silent drop is the worst failure mode. The error includes every resolution attempt + `appPackageJsonPath`.
10. **Relative `defaultPluginPackages` entries require `appPackageJsonPath`.** Anchor must be the app, not the workspace root, or `./src/plugins/inline` resolves wrong in monorepos.
11. **`boring.id` rejected.** Plugin id is derived from `package.json#name`. `definePlugin(id, …)` must use the derived id (lint:invariants enforces).
12. **`realpathSync` path containment is a load-time input guard, NOT a sandbox.** Server plugins run with full host privileges; the containment check only constrains the *declared* entry path. Use `serverPluginAllowlist` for trust boundaries.
13. **Preflight failures don't break live plugins.** Write `.error` files + emit error events; keep the live `loaded` records intact. `.error` files are GC'd on the next successful load.
14. **Atomic per-registry replace, not per-output.** Subscribers see one transition per registry. Intra-pluginId collisions are caught earlier, at capture, not by the registry.
15. **`WorkspaceUiStateSync` owns PUT-state writes** — pass `bridgeEndpoint={null}` to the inner `WorkspaceProvider` to avoid double-writes.
16. **`definePlugin` returns a NEW wrapper.** It does not mutate the input factory (the input remains unbranded and reusable). Calling `definePlugin` twice on the same input with the same id is safe; with different ids throws.
17. **Per-plugin failures during `/reload` MUST NOT abort the whole reload.** Diagnostics flow into the response body; healthy plugins still pick up new code. Only infrastructural failures (cannot enumerate dirs) throw out of `beforeReload`.
18. **Plugins that hold disposable resources MUST implement `dispose()`.** Without it, every reload leaks DB connections / intervals / bridge listeners — the "no restart" promise becomes false within minutes.
19. **pnpm symlinked plugins require follow-once-via-realpath** in `directorySignature`. Naive symlink skip silently breaks hot reload for `pnpm link:` workflows.
20. **`agentTools` reload requires a new chat session.** Existing sessions hold the boot-time tool registry. The banner surfaces this tip after `/reload`.
21. **`routes` are captured at boot.** Edits don't reload — the banner surfaces "restart required" when a route-bearing plugin's signature changes.
22. **Single-flight `load()` coalescing** protects against `/reload` spam.
23. **`getDynamicResources` MUST do no I/O.** Pi calls it on every rebuild including mid-turn; a slow disk would stall Pi. Use the manager's cached snapshot.
24. **Server-only plugins are valid.** `boring.front: false` (or absent) skips front import path. The SSE consumer must handle `frontUrl?: undefined` cleanly.

---

## 8. Non-goals

- Plugin marketplace, semver gates, dependency graph, install ordering.
- Plugin-to-plugin RPC. (Plugins talk through the bridge / event bus / shared kits.)
- Lifecycle hooks beyond `dispose()`. The plugin is declarative: factory + plugin object.
- Backwards-compat shims for earlier shapes (`composePlugins`, `LifecycleBus`, route-capture `BoringServerFactory`).
- Hot reload of `WorkspaceServerPlugin.routes` or static `agentTools` mid-session. See §4.7 coverage table.
- Asset manager serving plugin files. Vite handles `/@fs/...` in dev; host serves built output in prod.
- Sandboxing of server plugins. They run with host privileges; trust is gated by `serverPluginAllowlist`, not by isolation.

---

## 9. Acceptance

Merge gate:

1. `pnpm test`, `pnpm typecheck`, `pnpm lint:invariants`,
   `pnpm test:e2e` all green.
2. All four built-in plugins install via the playground's
   `defaultPluginPackages`.
3. Edit plugin front → `/reload` → updated pane visible (p95 ≤
   500 ms with 4 plugins loaded; quick-signature path keeps the
   no-change case ≤ 50 ms).
4. Edit plugin server → `/reload` → next agent turn uses new prompt /
   extensionFactories. Tool edits visible in next chat session;
   banner surfaces this.
5. Server throw in one plugin → diagnostics in the 422 body; other
   plugins still functional; **healthy plugins still pick up edits in
   the same reload**.
6. Corrupt plugin front file → SSE error event; other plugins still
   update.
7. Add / remove from `defaultPluginPackages` takes effect on next
   `/reload` (no restart).
8. No static `import` of plugin modules in `apps/*/src/` (except
   factory composition inside a Plugin's own factory).
9. Plugin authors import only from `@hachej/boring-workspace/plugin`
   and `…/plugin/server` (lint:invariants check).
10. Public exports diff vs §4 — no accidental private re-exports.
    CI compares the surface against a snapshot allowlist
    (`packages/workspace/__snapshots__/public-api.json`); changes
    require a PR review of the snapshot.
11. SSE liveness: the front banner reflects SSE health (degraded
    state if no event for 90 s after a successful POST).
12. Plugin `dispose` is invoked before replacement; timeouts logged
    + non-blocking.
13. pnpm `link:` workflow: editing a linked plugin's source triggers
    a reload (symlink follow-once works).
14. Plugin id mismatch (front pluginId !== derived id from
    `package.json#name`) fails `pnpm lint:invariants`.

---

## 10. Risk register

| Risk | Mitigation |
| --- | --- |
| jiti unavailable in prod | Resolver warns once + falls back to native `import`; document in SKILL.md |
| jiti compile-cache leak across reloads | One shared jiti instance, reused across reloads; `moduleCache:false` per import |
| Server-side resource leak across reloads (DB, intervals, bridge listeners) | Plugins MUST implement `dispose()`; rebuild awaits with 5 s timeout. Log `dispose timedOut` for operator visibility |
| Slow `directorySignature` on huge plugins | Skip `node_modules` + dotfiles; two-tier signature short-circuits on quick-stat unchanged; full hash only when needed |
| Race between concurrent `/reload`s | Single-flight `load()` drain loop; `beforeReload` is serialised |
| Slow front import landing after newer revision | `latestRequestedRef` check before commit drops stale captured payload |
| Stale Pi system prompt after plugin error | `aggregatePluginPrompts` reads `manager.list()` which only contains loaded plugins |
| Vite externalisation regressions | `tsup` `external` list locked; CI `pnpm build` catches breaks |
| Plugin id collision across packages | `bootstrapServer` throws on duplicate; preflight detects across dirs; both source files in error |
| Intra-pluginId output collision in factory-chained kits | Detected at capture in `createCapturingBoringFrontAPI`; throws with kind + id + stack source |
| Path-shape attacks in manifest paths | Manifest validation rejects unsafe paths; runtime `realpathSync` containment for declared entry only. NOT a sandbox |
| RCE via malicious npm-installed plugin | `serverPluginAllowlist` gates server-side load; prod default should explicitly list trusted plugin ids; document like a `dependencies` trust boundary |
| Browser holds prior front URL | Cache-bust `?v=<rev>` per revision |
| SSE connection silently dies (corporate proxy buffering, k8s ingress) | Observable heartbeat every 60 s; front computes `sseHealthy`; banner degraded state |
| SSE connection exhaustion | 32-connection cap per workspaceId; slow-consumer events dropped + logged |
| pnpm `link:` workflow not reloading | `directorySignature` follows symlinks once via `realpathSync` with cycle detection |
| `routes` edits not landing silently | Banner surfaces "restart required" tip when reloaded plugin has `routes` |
| `agentTools` edits not picked up in current session | Banner surfaces "new chat session required" tip |

---

*End of plan.*
