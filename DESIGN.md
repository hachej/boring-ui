# Plugin / Agent Layer — Standalone Implementation Plan

> Sole source of truth for rebuilding the plugin / agent layer of
> `@hachej/boring-workspace` from `main`. Phases are sequential; meet
> each phase's acceptance criteria before moving on. Type signatures,
> validation rules, and the trickier algorithms are spelled out in
> full. The plan does **not** dump source — that defeats the rebuild.

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
`/plugin` / `/app/{front,server}` subpath exports, and four
first-class plugins (`_template`, `ask-user`, `data-explorer`,
`data-catalog`).

After the plan: an app integrates with **one server call** and
**one component**:

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
| **Plugin** | npm package with `package.json#boring.{front,server}`. Contributes UI surfaces and / or agent runtime resources. |
| **Concrete plugin** | Plugin whose default exports take no required config — installable as-is. |
| **Plugin kit** | Package exporting parametrised factories (`createXPlugin(options)`). Not installable on its own; a concrete plugin assembles it. |
| **App** | Host that calls `createWorkspaceAgentServer` + renders `WorkspaceAgentFront`. Declares its plugin set via `package.json#boring.defaultPluginPackages`. |
| **`BoringFrontFactory`** | `(api: BoringFrontAPI) => void`. Default export of `boring.front`. |
| **`WorkspaceServerPlugin`** | Declarative server plugin object (system prompt, agent tools, Pi packages, routes, …). Returned by `boring.server`'s default export, called with `(options, ctx) = (undefined, { workspaceRoot, bridge })`. |
| **Asset manager** | `BoringPluginAssetManager`. Scans plugin dirs, hashes content, emits `boring.plugin.{load,unload,error}` SSE events. |
| **Revision** | Per-plugin monotonic int. Bumps when a plugin's content signature changes. Cache-busts the front module URL. |
| **Surface** | Abstract UI request `{ kind, target, meta }`. Front plugins register resolvers that translate a surface into a panel open. |

---

## 2. End-to-end behaviour

**Install.** App author runs `npm i @me/some-plugin`, adds the name to
`package.json#boring.defaultPluginPackages`, restarts dev. Plugin's
panels, tools and prompt appear. No imports in app source.

**Hot reload.** Author edits plugin source; types `/reload` in the
chat. Server re-scans dirs, jiti re-imports server entries, SSE pushes
new revisions, browser dynamic-imports the new front modules and
atomically replaces registry entries per plugin id. No restart.

**Plugin error.** Plugin server throws on import → asset manager
writes `.error` file, emits `boring.plugin.error`, surfaces in chat
banner. Previous live state remains untouched. Other plugins
unaffected.

**Composition (factory chaining).** A concrete plugin can compose
multiple kits with a shared `api`:

```ts
export default definePlugin("my-concrete", (api) => {
  dataExplorerFactory(api)
  createDataCatalogPlugin({ adapter: pg })(api)
})
```

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

**Reload.** `/reload` → `beforeReload` → `assetManager.load()` re-hashes
and bumps revisions → `rebuildServerPlugins` jiti re-imports →
`systemPromptDynamic` + `getDynamicResources` refresh Pi → SSE pushes
load events with new revisions → front dynamic-imports
`<frontUrl>?v=<rev>` and replaces per registry.

Subpath exports of `@hachej/boring-workspace`:

| Subpath | Audience | Purpose |
| --- | --- | --- |
| `/` | App + plugin | UI runtime (existing on main) |
| `/plugin` | Plugin author | `definePlugin`, `BoringFrontAPI` types, manifest helpers |
| `/app/server` | App author | `createWorkspaceAgentServer`, `defineServerPlugin`, types |
| `/app/front` | App author | `WorkspaceAgentFront` |
| `/server` | Plugin author | `bootstrapServer`, server manifest helpers |
| `/shared` | Plugin author | Runtime-agnostic contracts |

---

## 4. Public API

### Plugin `package.json`

```jsonc
{
  "name":    "@me/some-plugin",
  "type":    "module",
  "boring":  {
    "label":  "My plugin",
    "front":  "dist/front/index.js",   // default export = BoringFrontFactory
    "server": "dist/server/index.js"   // default export = (options, ctx) => WorkspaceServerPlugin | WorkspaceServerPlugin
                                       // boring.server can be false (front-only)
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

### App `package.json`

```jsonc
{ "boring": { "defaultPluginPackages": ["@me/some-plugin", "./src/plugins/inline"] } }
```

Entries: npm names (resolved via `createRequire`) or `./`-prefixed
paths (resolved against the manifest's directory).

### Front authoring (`@hachej/boring-workspace/plugin`)

```ts
type BoringFrontFactory = (api: BoringFrontAPI) => void | Promise<void>

interface BoringFrontAPI {
  registerProvider(reg:        { id; component: PluginProvider }): void
  registerBinding(reg:         { id; component: PluginBinding  }): void
  registerCatalog(catalog:     CatalogConfig): void
  registerPanel<T>(reg:        BoringFrontPanelRegistration<T>): void
  registerPanelCommand(reg:    BoringFrontPanelCommandRegistration): void
  registerLeftTab<T>(reg:      BoringFrontLeftTabRegistration<T>): void
  registerSurfaceResolver(reg: BoringFrontSurfaceResolverRegistration): void
}

interface BoringFrontPanelRegistration<T> {
  id; component; label?; icon?; placement?: string  /* default "center" */
  requiresCapabilities?; essential?; lazy?; chromeless?; source?  /* default "plugin" */
}
interface BoringFrontPanelCommandRegistration { id; title; panelId; run?: () => void }
interface BoringFrontLeftTabRegistration<T>   { id; title; panelId; icon?; component?; lazy?; chromeless?; requiresCapabilities?; source? }
interface BoringFrontSurfaceResolverRegistration {
  id?:     string           // default `${pluginId}:${kind}`
  kind:    string
  source?: string
  resolve: (req: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}

// MUTATES factory in place to attach metadata so identity is preserved
// (registries key on factory reference for replace-by-plugin-id).
function definePlugin(id: string, factory: BoringFrontFactory, options?: { label?: string }): BoringFrontFactoryWithId
type BoringFrontFactoryWithId = BoringFrontFactory & { pluginId: string; pluginLabel?: string }
```

### Server authoring (`@hachej/boring-workspace/app/server`)

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
  routes?:            FastifyPluginAsync          // captured at boot; not hot-reloadable
  preservedUiStateKeys?: string[]
}

type WorkspacePiPackageSource =
  | string
  | { source: string; extensions?: string[]; skills?: string[]; themes?: string[]; prompts?: string[] }

function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T
// Throws ServerPluginError("server plugin \"<id>\": <msg>") on validation failure.
```

### Host entry (`@hachej/boring-workspace/app/server`)

```ts
type WorkspacePluginEntry =
  | WorkspaceServerPlugin
  | { dir: string; options?: unknown; hotReload?: boolean }

interface WorkspaceAgentServerPluginContext { workspaceRoot: string; bridge: ReturnType<typeof createInMemoryBridge> }

interface CreateWorkspaceAgentServerOptions extends Omit<CreateAgentAppOptions, "pi"> {
  pi?:                   WorkspaceAgentPiOptions
  plugins?:              WorkspacePluginEntry[]
  appPackageJsonPath?:   string                // reads boring.defaultPluginPackages on boot AND every /reload
  defaultPluginPackages?: string[]             // inline override; used mainly in tests
  boringPluginReload?:   boolean               // default true; /reload re-scans + jiti re-imports
  piPluginReload?:       boolean               // default true; /reload refreshes Pi resources + prompt
  provisionWorkspace?:   boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?:      boolean
}

function createWorkspaceAgentServer(opts): Promise<FastifyInstance>
```

### Front host (`@hachej/boring-workspace/app/front`)

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
  hotReloadEnabled?: boolean   // default true; gates /reload + PluginUpdateStatus banner
  extraPanels?: string[]       extraCommands?: SlashCommand[]
}
```

---

## 5. Implementation phases

Each phase: **Goal · Deliverables · Algorithms · Acceptance**.
Test scenarios are stated as acceptance bullets; write vitest tests
that exercise each.

### Phase 0 — Scaffolding

**Goal.** Folder + subpath export layout.

**Deliverables.** Folders under `packages/workspace/src/`:
`shared/plugins/`, `server/plugins/`, `server/agentPlugins/`,
`app/server/`, `app/front/`, `front/agentPlugins/`. Add subpath
exports (`/plugin`, `/app/{server,front}`, `/server`, `/shared`) to
`packages/workspace/package.json` and `tsup.config.ts`.

**Critical.** Add `"@mariozechner/pi-coding-agent"` and `"jiti"` to
tsup `external`. Without externalising Pi, Vite fails to bundle the
front (`Could not resolve "fs"`).

**Acceptance.** `pnpm --filter @hachej/boring-workspace build`
produces every subpath dist file; a consumer can import each subpath.

### Phase 1 — Shared contracts

**Goal.** Browser-safe types every phase depends on.

**Deliverables.**

`shared/plugins/manifest.ts`:

```ts
interface BoringPackageBoringField { front?: string; server?: string | false; label?: string; derivesFrom?: string }
interface BoringPackagePiSourceObject { source: string; extensions?: string[]; skills?: string[]; themes?: string[]; prompts?: string[] }
type    BoringPackagePiSource = string | BoringPackagePiSourceObject
interface BoringPackagePiField { extensions?; skills?; packages?: BoringPackagePiSource[]; systemPrompt?: string }
interface BoringPluginPackageJson { name?; version?; boring?; pi? }

type BoringPluginManifestErrorCode = "INVALID_ID" | "INVALID_VERSION" | "INVALID_FIELD" | "INVALID_PATH" | "MISSING_REQUIRED_FIELD"
interface BoringPluginManifestIssue { code; field: string /* dotted path */; message: string }
type BoringPluginManifestValidationResult = { valid: true; packageJson } | { valid: false; issues }

function validateBoringPluginManifest(raw): BoringPluginManifestValidationResult
function isValidBoringPluginId(id): boolean         // /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
function isSafePluginRelativePath(value): boolean    // non-empty, not ".", no nulls, no \, no leading /, no Windows drive, no ".." segments
function isSafePluginRelativeGlob(value): boolean    // adds !, brace-.., ** escape checks
```

Validation rules: `version` matches semver if present;
`boring.{front,server}` (string) must be safe relative paths;
`boring.id` is rejected (use `package.json#name`);
`pi.{extensions,skills}` are arrays of safe relative paths;
`pi.packages[*]`: string or `{ source, …filters }` — workspace
validates source only (npm:/git:/github:/http:/https:/ssh: prefixes,
file: paths, or plain relative). Filter contents are **not** validated
— Pi owns that. At least one of `boring`/`pi` namespaces required.

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
or `PluginError("duplicate-id", …)` on duplicate plugin id; apply
`excludeDefaults`; for each plugin, register `panels[]`, `commands[]`,
`catalogs[]`, then dispatch each `outputs[]` entry to the matching
registry; `binding`/`provider` are no-ops here (mounted later in the
React tree); compute `systemPromptAppend = plugins.filter(p =>
p.systemPrompt?.trim()).map(trim).join("\n\n")`.

`shared/plugins/index.ts`: re-export `PluginError`, `PluginErrorKind`,
`bootstrap`, registry interfaces, `PluginOutput` union arms, and the
output / catalog / pane types. Do **not** re-export the front factory
helpers — those live on the `/plugin` subpath (Phase 8).

**Acceptance.** Manifest validation accepts boring-only, pi-only, both,
neither (→ `MISSING_REQUIRED_FIELD`); rejects `boring.id`, unsafe
paths, unsafe pi.packages sources; leaves filter contents to Pi.
`bootstrap` throws on no chatPanel and duplicate ids; registers each
output via the registry interfaces; returns concatenated prompt.

### Phase 2 — Server plugin contract

**Goal.** `defineServerPlugin` + aggregation.

**Deliverables.**

`server/plugins/defineServerPlugin.ts` — `validateServerPlugin(plugin)`
checks: required non-empty `id`; `agentTools[i]` has non-empty `name`,
`description`, `parameters` object, `execute` function;
`piPackages[i]` is string or `{source, …filters with allowed keys
extensions|skills|themes|prompts}`; `provisioning.templateDirs[*]` has
`{id, path: string|URL, target?}`; `provisioning.nodePackages[*]` has
`{id, packageName, packageRoot: string|URL}`;
`provisioning.python[*]` has `{id, projectFile, extraLibs?, env?}`;
`routes` and `extensionFactories[i]` are functions; `systemPrompt` is
string. On failure: throw `ServerPluginError("server plugin \"<id>\":
<message>")`. `defineServerPlugin(plugin)` calls validate and returns
a shallow clone.

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
`validateServerPlugin` each; throw `Error("plugin \"<id>\" registered
twice")` on duplicate id; aggregate fields flatly; `piPackages =
compactPiPackages(plugins.flatMap(p => p.piPackages ?? []))`;
`systemPromptAppend` per the bootstrap rule; `preservedUiStateKeys`
deduped via Set.

**Acceptance.** Validation covers all rules; aggregator returns
correct shape; duplicate id throws; malformed plugin throws with
clear message.

### Phase 3 — Plugin entry resolver

**Goal.** Single dispatch from any entry shape to a
`WorkspaceServerPlugin`.

**Deliverables.** `app/server/pluginEntryResolver.ts`:

```ts
interface DirPluginEntry         { dir: string; options?: unknown; hotReload?: boolean }
interface PluginResolveContext   { workspaceRoot: string; bridge: unknown }

function isDirEntry(entry): entry is DirPluginEntry
async function resolveOnePluginEntry<T extends WorkspaceServerPlugin>(entry, ctx): Promise<T>
```

Dispatch: `isDirEntry → resolveDirServerPlugin(entry, ctx)` else
pass-through.

`resolveDirServerPlugin`:

1. Read `package.json` from `entry.dir` (throw if absent).
2. Resolve `serverPath`: manifest field `boring.server` first
   (`false` → throw "no server entry"; string → resolve relative;
   throw if file missing); else try conventions
   `["dist/server/index.js", "src/server/index.ts"]`; first existing
   wins.
3. Import via §6.2 (jiti when `hotReload`, native otherwise).
4. `value = mod.default ?? mod`. If function → `value(entry.options,
   ctx)`. If object → return. Else throw.

**Acceptance.** Pre-built object passes through; dir entry loads via
manifest field; convention fallback works; declared-but-missing
throws; function default called with `(options, ctx)`; non-function
non-object default throws; `hotReload: true` re-imports fresh after a
source edit.

### Phase 4 — `createWorkspaceAgentServer`

**Goal.** The orchestrator. Reads app manifest, resolves + aggregates
plugins, boots Fastify + Pi, wires `beforeReload`.

**Deliverables.**

`app/server/rebuildServerPlugins.ts`:

```ts
async function rebuildServerPlugins({ entries, ctx }): Promise<{
  ok: boolean; plugins: WorkspaceServerPlugin[]; diagnostics: { source: string; message: string }[]
}>
```

Loops `resolveOnePluginEntry` over entries; on error pushes
diagnostic with `source = isDirEntry(entry) ? \`directory (${dir})\` :
"entry"`. Failed entries do **not** abort the rest.

`app/server/createWorkspaceAgentServer.ts` orchestration:

1. `bridge = createInMemoryBridge()`.
2. `defaultPluginPackages = [...(opts.defaultPluginPackages ?? []),
    ...(readAppManifestDefaultPlugins(opts.appPackageJsonPath) ?? [])]`.
3. `defaultPluginPackagePaths = resolveDefaultPluginPackagePaths(opts.workspaceRoot, defaultPluginPackages)` — §6.3. Throw on unresolved.
4. `allPluginEntries = [...defaultDirEntries, ...(opts.plugins ?? [])]` where each default gets `hotReload: opts.boringPluginReload ?? true`.
5. `ctx = { workspaceRoot, bridge }`.
6. `resolvedPlugins = await Promise.all(allPluginEntries.map(e => resolveOnePluginEntry(e, ctx)))`.
7. `pluginCollection = collectWorkspaceAgentServerPlugins({ ...opts, plugins: resolvedPlugins })` — calls `bootstrapServer`, prepends `nodePackageContribution`s for `@hachej/boring-workspace` (located by walking up from `__dirname`) and `@hachej/boring-pi` (sibling `packages/pi` → `node_modules/@hachej/boring-pi` → `require.resolve("@hachej/boring-pi/package.json")`), composes `pi.additionalSkillPaths = [workspaceSkillsDir, ...callerAdditional]`, runs `compactPiPackages` on merged Pi packages.
8. Optionally `provisionWorkspaceAgentServer({ workspaceRoot, provisioningContributions, force })` unless `provisionWorkspace === false`.
9. `boringPluginDirs = dedup([\`${workspaceRoot}/.pi/extensions\`, ...extensionPathRoots, ...defaultPluginPackagePaths])`. Extension roots derived via `pluginRootFromExtensionPath` (expects `<root>/agent/<entry>`; throws otherwise).
10. `assetManager = new BoringPluginAssetManager({ pluginDirs: boringPluginDirs, errorRoot: \`${workspaceRoot}/.pi/extensions\` })`.
11. `rebuildPlugins = async () => rebuildServerPlugins({ entries: allPluginEntries, ctx })`.
12. `app = await createAgentApp({
        ...opts,
        beforeReload: async () => {
          if (boringPluginReload !== false) {
            const r = await assetManager.load()
            if (r.errors.length) throw new Error(`Boring plugin scan failed:\n${format(r.errors)}`)
            const rb = await rebuildPlugins()
            if (rb.diagnostics.length) throw new Error(`Boring plugin re-resolve failed:\n${format(rb.diagnostics)}`)
          }
          await opts.beforeReload?.()
        },
        pi: {
          ...pluginCollection.agentOptions.pi,
          additionalSkillPaths: staticSkillPaths,
          packages:            staticPiPackages,
          extensionPaths:      staticExtensionPaths,
          extensionFactories:  pluginCollection.agentOptions.pi?.extensionFactories,
          getDynamicResources: () => readPackageJsonPiSnapshot(boringPluginDirs),
        },
        systemPromptDynamic: piPluginReload !== false ? () => aggregatePluginPrompts(assetManager) : undefined,
      })`.
13. `await assetManager.load()`.
14. Register `uiRoutes` (with `preserveStateKeys`), `boringPluginRoutes` (with manager), each `routeContributions.routes`.
15. Attach `(app as any).__boringRebuildPlugins = rebuildPlugins` for tests / tooling.

`readPackageJsonPiSnapshot(pluginDirs)` re-reads each plugin's
`package.json#pi` and returns `{ packages, skills, extensions }` flat
arrays. Empty snapshot on preflight failure (don't break Pi mid-turn).

`app/server/index.ts` barrel re-exports
`createWorkspaceAgentServer`, `defineServerPlugin`,
`collectWorkspaceAgentServerPlugins`, `provisionWorkspaceAgentServer`,
`buildWorkspaceContextPrompt`, and the relevant types
(`CreateWorkspaceAgentServerOptions`, `WorkspaceAgentPiOptions`,
`WorkspaceAgentServerPluginContext`,
`WorkspaceAgentServerPluginCollection`, `WorkspacePiPackageSource`,
`WorkspaceServerPlugin`, `WorkspaceProvisioningContribution`,
`WorkspaceRouteContribution`).

**Acceptance.** No plugins → empty arrays passed to Pi. Manifest
default plugins resolve and end up as `DirPluginEntry` items.
Unresolved entry → throw. `boringPluginReload: false` skips beforeReload
scan + rebuild. Static + dynamic Pi resources merged correctly.
`systemPromptDynamic` only present when `piPluginReload !== false`. UI
+ plugin SSE routes + per-plugin routes all registered.
`__boringRebuildPlugins` exposed.

### Phase 5 — Asset manager

**Goal.** Scan plugin dirs → hash → emit
`boring.plugin.{load,unload,error}` events. Single-flight,
coalescing.

**Deliverables.**

`server/agentPlugins/types.ts`:

```ts
interface BoringServerPluginManifest {
  id: string; rootDir: string; version: string
  boring: BoringPackageBoringField; pi?: BoringPackagePiField
  frontPath?: string; frontUrl?: string                  // frontUrl = `/@fs/${frontPath}` (vite convention)
  serverPath?: string; extensionPaths?: string[]; skillPaths?: string[]
}
type BoringPluginEvent =
  | { type: "boring.plugin.load";   id; boring; version; revision; frontUrl? }
  | { type: "boring.plugin.unload"; id; revision }
  | { type: "boring.plugin.error";  id; revision; message }
interface BoringPluginListEntry { id; boring; pi?; version; revision; frontUrl? }
```

`server/agentPlugins/scan.ts`:

- `preflightBoringPlugins(pluginDirs)`: discovers dirs
  (`discoverBoringPluginDirs`), parses each `package.json`, validates
  manifest via §Phase 1, derives plugin id (`pkg.name` or
  `basename(rootDir)`, strip leading `@`, replace `/` with `-`,
  validate via `isValidBoringPluginId`), detects duplicates, checks
  path containment via `realpathSync` of root + nearest existing
  ancestor of target. Returns `{ ok, errors: BoringPluginPreflightIssue[] }`
  with codes `MISSING_PACKAGE_JSON | INVALID_PACKAGE_JSON |
  INVALID_PLUGIN_METADATA`.
- `readBoringPlugins(pluginDirs)`: returns `[]` if preflight fails;
  else for each valid dir resolves absolute `frontPath`, derives
  `frontUrl`, resolves `serverPath` via Pi parity (§6.6), resolves
  absolute `extensionPaths` and `skillPaths`.
- `pluginRootFromExtensionPath(extensionPath)`: requires
  `<pluginRoot>/agent/<entry>` shape; throws otherwise.

`server/agentPlugins/manager.ts` (`class BoringPluginAssetManager`):

```ts
constructor({ pluginDirs, errorRoot? })
preflight(): BoringPluginPreflightResult
list():     BoringPluginListEntry[]
getError(pluginId): string | null
subscribe(listener: (event) => void): () => void
load(): Promise<{ loaded: BoringPluginListEntry[]; events: BoringPluginEvent[]; errors: { id; revision; message }[] }>
```

State: `loaded: Map<id, record + revision + signature>`,
`revisions: Map<id, number>`, `listeners: Set`, `loading: Promise|null`,
`reloadQueued: boolean`.

**Single-flight `load()`**: if `loading` set → `reloadQueued = true;
return loading`. Else `loading = drainLoads()`. `drainLoads()` loops
`await doLoadOnce()` while `reloadQueued`.

**`doLoadOnce()`**: preflight; on errors write `.error` file under
`errorRoot/<preflightErrorId(dir)>/.error` (id =
`"preflight-" + sha256(dir).slice(0,12)`), bump revision, emit
error event, **continue** (don't abort the live record). Compute
`next = readBoringPlugins(...)`. Unload set = ids in `loaded` not in
`next` → delete + bump revision + emit unload. For each `next` plugin:
compute `signature = pluginSignature(plugin)` (§6.1); same as
`loaded.get(id)?.signature` → skip silently. Else: bump revision,
update record, clear `.error`, emit load. On exception during the
update step: write `.error`, emit error, keep prior record.

`emit(event)`: try-catch around listener calls (one bad listener
must not break others).

`getError(id)` reads `errorPath(id)` (validate `isValidBoringPluginId`,
ensure resolved path stays under `errorRoot`); returns null if absent.

**Important.** The asset manager does **not** import server modules.
Server-side plugin instantiation lives entirely in
`pluginEntryResolver` and runs inside `rebuildServerPlugins`. The asset
manager's job is scan + hash + emit.

`server/agentPlugins/aggregatePluginPrompts.ts` (one helper):

```ts
function aggregatePluginPrompts(manager): string | undefined
```

Iterates `manager.list()`, collects truthy `pi?.systemPrompt?.trim()`;
returns `undefined` if none, else `"# Loaded boring-ui plugin
context\n\n" + parts.join("\n\n")`. Called from `systemPromptDynamic`
each Pi rebuild.

**Acceptance.** Empty dirs → empty result. Single valid plugin →
load(rev=1). Reload no changes → no events. Edit a file → revision
bumps, single load. Delete a plugin → unload + bump. Preflight failure
→ error events + previous live unchanged. 5 concurrent `load()` calls
→ 1–2 doLoadOnce passes. Listener throw doesn't break others. `.error`
file persisted. Symlinks in plugin tree don't loop the hash.

### Phase 6 — SSE routes + front subscriber

**Goal.** Push events; consume and atomically replace registry entries
per plugin id.

**Deliverables.**

`server/agentPlugins/routes.ts` — `boringPluginRoutes(app, { manager })`:

- `POST /api/boring.reload` → `manager.load()`; 422 with
  `{ ok:false, errors, plugins }` on errors else 200 with `{ ok:true, plugins }`.
- `GET  /api/agent-plugins` → `manager.list()`.
- `GET  /api/agent-plugins/:id/error` → text body or 404.
- `GET  /api/v1/agent-plugins/events` — **SSE** per §6.4.

`front/agentPlugins/reloadEvent.ts`:

```ts
export const WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT = "boring-ui:agent-plugins-reloaded"
```

`front/agentPlugins/registerAgentPlugin.tsx` — `useAgentPluginHotReload(options)`:

```ts
interface RegisterAgentPluginOptions {
  apiBaseUrl?: string; workspaceId?: string; enabled?: boolean
  importFront?: (frontUrl, revision) => Promise<{ default?: BoringFrontFactory }>
}
```

Implements §6.5 (revision dedup) + §6.7 (atomic per-registry replace).
On unmount: clear `latestRequestedRef`, close EventSource.

**Acceptance.** Hook subscribes; renders contributions on
`boring.plugin.load`; new revision remounts updated panes. Slow front
import racing newer revision: only newer commits. Disposed hook
ignores in-flight imports. Failed front import: previous version
stays. Malformed SSE data: logged, no commit. Unload removes entries.
Error event logged. Reconnect: server replays current state, hook
dedups via `lastSeenRef`. Cross-origin SSE with `withCredentials:
true` flows cookies.

### Phase 7 — Hot reload integration

**Goal.** Wire `/reload` through server + front.

**Deliverables.** No new files; modifications:

- `createAgentApp.beforeReload` (Phase 4) calls
  `assetManager.load()` + `rebuildServerPlugins`.
- `systemPromptDynamic` returns `aggregatePluginPrompts(manager)`.
- `pi.getDynamicResources` returns `readPackageJsonPiSnapshot(boringPluginDirs)`.
- `WorkspaceProvider` mounts `useAgentPluginHotReload(...)` inside
  registry context (Phase 8).
- `/reload` slash command (exists on main; if not, add) calls
  `POST /api/v1/agent/reload`. Composer banner uses `PluginUpdateStatus`
  (Phase 8) to surface running / success / error.

**Acceptance.** Edit server file → `/reload` → next agent turn uses
new tools / prompt. Edit front file → `/reload` → SSE re-imports
updated pane. New entry in `defaultPluginPackages` → next `/reload`
picks it up. Removed plugin disappears after reload. Server entry
throws during rebuild → 422 with diagnostics; live plugins unaffected.
Preflight error → 422 + error event.

### Phase 8 — Front authoring + `WorkspaceAgentFront`

**Goal.** Plugin authoring helpers + the top-level shell.

**Deliverables.**

`shared/plugins/defineFrontPlugin.ts` (internal IR):

```ts
class PluginError extends Error { constructor(public kind: PluginErrorKind, message: string) { super(message) } }
type PluginErrorKind = "validation" | "duplicate-id" | "runtime"

interface WorkspaceFrontPlugin { id; label?; systemPrompt?; outputs: PluginOutput[] }
function defineFrontPlugin(input): WorkspaceFrontPlugin
```

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
function definePlugin(id, factory, options?): BoringFrontFactoryWithId   // MUTATES factory
function toWorkspacePlugin(input: WorkspaceFrontPluginInput): WorkspaceFrontPlugin
```

`createCapturingBoringFrontAPI`: each `register*` pushes both into the
matching array and a normalised `PluginOutput` into `outputs` (so
static `defineFrontPlugin` and dynamic SSE paths produce the same shape).

`boringFrontFactoryToPlugin`: calls factory synchronously; throws if
the factory returns a thenable (registration is synchronous by contract);
returns `defineFrontPlugin({ id, label, outputs: captured.outputs })`.

`toWorkspacePlugin`: factory-with-id → wraps via
`boringFrontFactoryToPlugin`; bare factory without id → throws "wrap
with `definePlugin(id, factory)`"; plain `WorkspaceFrontPlugin` → as-is.

Subpath barrel `packages/workspace/src/plugin.ts` re-exports
`definePlugin`, `boringFrontFactoryToPlugin`, the `BoringFront*` types,
`PluginOutput` arms (when needed), manifest validators + types.

`app/front/WorkspaceAgentFront.tsx`:

- Wraps `WorkspaceProvider` (passes panels/commands/catalogs/plugins/
  excludeDefaults/capabilities/apiBaseUrl/authHeaders/apiTimeout/
  defaultTheme/onThemeChange/persistenceEnabled/onAuthError). Pass
  `bridgeEndpoint={null}` — `WorkspaceUiStateSync` here owns PUT state.
- Mounts `useAgentPluginHotReload({ apiBaseUrl, workspaceId, enabled:
  hotReloadEnabled ?? true })` inside the provider tree.
- Storage keys: `providerStorageKey ?? \`boring-ui-v2:layout:${workspaceId}\``;
  `surfaceStorageKey ?? \`${providerStorageKey}:surface\``;
  `shellStorageKey = surfaceStorageKey.slice(0, -":surface".length)`;
  `sessionStorageKey ?? \`boring-workspace:sessions:${workspaceId}\``.
  Persisted booleans use distinct keys derived from `shellStorageKey`:
  `:drawer`, `:workbenchOpen`, `:workbenchLeftOpen`. **The
  `:workbenchOpen` key MUST differ from `surfaceStorageKey`** or both
  writers stomp the layout JSON.
- Plugin normalisation: `normalizedPlugins = plugins?.map(toWorkspacePlugin)
  ?? []`. Flatten `pluginOutputs`, extract `pluginPanelIds`, derive
  `shellExtraPanels = [...extraPanels, ...pluginPanelIds]`, derive
  `hasLeftTabs`.
- Sessions: explicit props OR `useSessions` hook OR fallback local-
  storage sessions. Auto-create first session on idle empty state
  (guarded by `autoCreateSessionRef`).
- `centerParams` forwards `sessionId`, surface API getters,
  `extraCommands`, conditionally `hotReloadEnabled` (only when
  explicitly set — preserves ChatPanel default true).
- `WorkspaceUiStateSync` inner component PUTs UI state to
  `${bridgeEndpoint}/api/v1/ui/state` on change, AbortController on
  prop change, silent on error, noop when `bridgeEndpoint` null.
- `useEffect` adds `window.addEventListener(UI_COMMAND_EVENT, …)` →
  `dispatchUiCommand` with surface APIs.

`app/front/index.ts` barrel re-exports `WorkspaceAgentFront` + its
public prop types.

**`PluginUpdateStatus`** composer banner (co-locate in agent or
workspace; existing chat panel wires it):

```ts
type PluginUpdateState = { kind: "running" } | { kind: "success"; reloaded: boolean } | { kind: "error"; message: string }
function PluginUpdateStatus({ state, onDismiss, onRetry })
```

**Acceptance.** `definePlugin` attaches `pluginId`/`pluginLabel`
in-place (identity preserved). `toWorkspacePlugin` rejects bare
factories. SSE hook mounts only when `hotReloadEnabled !== false`.
Storage keys default correctly. UI state PUT debounced/aborted.
`WorkspaceUiStateSync` noop when `bridgeEndpoint` null.
`PluginUpdateStatus` renders running/success/error; dismiss clears,
retry re-invokes.

### Phase 9 — Built-in plugins

**Goal.** Ship four reference plugins.

| Path | Category | Notes |
| --- | --- | --- |
| `plugins/_template/` | Concrete plugin (reference) | Bare-bones; default-exports `definePlugin(id, factory)`. Server entry: `(options, ctx) => defineServerPlugin({ id, label, systemPrompt, agentTools })`. |
| `plugins/ask-user/` | Concrete plugin | Questions panel + `ask_user` agent tool. Server default: `(options, ctx) => createAskUserServerPlugin({ ...options, workspaceRoot: ctx.workspaceRoot, bridge: ctx.bridge })`. |
| `plugins/data-explorer/` | Concrete plugin (**promoted from library**) | Adds `package.json#boring.{front,server}`. Front default-exports a factory that registers the Explorer left-tab + a `"explorer.open"` surface resolver. Also exports `dataExplorerFactory(api)` named for composition. |
| `plugins/data-catalog/` | Kit | No `package.json#boring`. Exports `createDataCatalogPlugin({ adapter, ... })` (front) and `createDataCatalogServerPlugin({ adapter })` (server). |
| `apps/workspace-playground/src/plugins/playgroundDataCatalog/` | Thin concrete plugin | Default-exports a factory chaining `dataExplorerFactory(api)` + `createDataCatalogPlugin({ adapter: duckdb })(api)`. Listed in playground's `defaultPluginPackages`. |

**Delete** `plugins/askUserPlugin/` (legacy with no manifest).

**Plugin `package.json` template.**

```jsonc
{
  "name": "@hachej/boring-<name>",
  "type": "module", "private": true,
  "boring": { "label": "<Label>", "front": "dist/front/index.js", "server": "dist/server/index.js" },
  "pi":     { "systemPrompt": "<when the agent should use this plugin>" },
  "files":  ["dist"],
  "exports": {
    ".":              { "types": "./dist/front/index.d.ts",  "import": "./dist/front/index.js" },
    "./front":        { "types": "./dist/front/index.d.ts",  "import": "./dist/front/index.js" },
    "./server":       { "types": "./dist/server/index.d.ts", "import": "./dist/server/index.js" },
    "./shared":       { "types": "./dist/shared/index.d.ts", "import": "./dist/shared/index.js" },
    "./package.json": "./package.json"
  },
  "scripts": { "build": "tsup", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "peerDependencies": { "@hachej/boring-workspace": "workspace:*", "react": "^18 || ^19", "react-dom": "^18 || ^19" }
}
```

**Server entry template.**

```ts
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/app/server"

function createXServerPlugin(opts): WorkspaceServerPlugin {
  return defineServerPlugin({ id: "x", label: "X", systemPrompt: "…", agentTools: [...] })
}

// Required (options, ctx) signature for pluginEntryResolver.
export default function defaultXServerPlugin(_options, ctx) {
  return createXServerPlugin({ /* threads ctx.workspaceRoot / ctx.bridge if needed */ })
}
```

**Front entry template.**

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin("x", (api) => {
  api.registerPanel({ id: "x-pane", label: "X", component: XPane, placement: "center" })
  api.registerPanelCommand({ id: "open-x", title: "Open X", panelId: "x-pane" })
}, { label: "X" })
```

**Composition (playgroundDataCatalog).**

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
hot-reload via `/reload`. Factory chaining in playgroundDataCatalog
registers explorer + catalog surfaces from one entry.

### Phase 10 — Docs

`packages/pi/skills/boring-plugin-authoring/SKILL.md`: covers plugin
author contract, app installation, `definePlugin` /
`defineServerPlugin`, the five composition patterns (configure-via-
options, component reuse, factory chaining, side-by-side, fork). Point
to `_template` and the playground for live examples.

Refresh repo `README.md` "Plugin system" section to match this design
(single way: `definePlugin` + `package.json#boring`).

### Phase 11 — Cleanup

Run: `pnpm typecheck`, `pnpm test`, `pnpm lint:invariants`,
`pnpm test:e2e`. Manual smoke in playground: load all plugins, edit a
source file, `/reload`, observe banner. Introduce a syntax error,
observe error banner. Audit `packages/workspace/src/{index,plugin}.ts`
+ `app/{server,front}/index.ts` barrels — confirm exports match §4.

---

## 6. Key algorithms

### 6.1 Plugin signature & revision

`fileSignature(path)`: `"missing"` if absent; else `sha256(mtimeMs +
size + bytes)`.

`directorySignature(root)`: `"missing"` if absent; else walk
recursively sorted-by-name skipping dotfiles, `node_modules`, and
symlinks (skip — do not follow). Per file hash `rel + mtime + size +
bytes`; per dir hash `rel + mtime + size` then recurse.

`pluginSignature(plugin)`: `sha256` of
`JSON.stringify({boring, pi})` + version + frontPath +
`fileSignature(frontPath)` + `directorySignature(dirname(frontPath))` +
`directorySignature(\`${dirname(frontPath)}/../shared\`)` + serverPath +
`fileSignature(serverPath)` + `directorySignature(dirname(serverPath))` +
`extensionPaths.join("|")` + `skillPaths.join("|")`.

Revision: `(revisions.get(id) ?? 0) + 1`, set, return. Signature
unchanged → no bump, no event.

### 6.2 jiti hot-reload import

```
function jitiImport(path) {
  const j = require("jiti")
  if (!j.createJiti) return null
  return j.createJiti(import.meta.url, { moduleCache: false }).import(path)
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

### 6.3 Default plugin package resolution

```
function resolveDefaultPluginPackagePaths(workspaceRoot, entries) {
  return entries.map(entry => {
    if (entry.startsWith("./") || entry.startsWith("../"))
      return resolve(<appPackageJsonDir ?? workspaceRoot>, entry)
    if (isAbsolute(entry)) {
      assert exists(join(entry, "package.json"))
      return entry
    }
    // npm name: app's require first, then workspace package's.
    try { return dirname(createRequire(`${workspaceRoot}/package.json`).resolve(`${entry}/package.json`)) }
    catch {
      try { return dirname(createRequire(import.meta.url).resolve(`${entry}/package.json`)) }
      catch { throw new Error(`default plugin package not resolvable: ${entry}`) }
    }
  })
}
```

**Throw on unresolved.** Silent drop = mystery missing features.

### 6.4 SSE protocol

```
GET /api/v1/agent-plugins/events
< HTTP/1.1 200 OK
< Content-Type: text/event-stream
< Cache-Control: no-cache, no-transform
< Connection: keep-alive
< X-Accel-Buffering: no                 # disable nginx buffering

# Replay current state on connect (browsers auto-reconnect; without
# replay the front would be stale until server-side change)
event: boring.plugin.load
data: { "type":"boring.plugin.load", "id":"…", "boring":{…}, "version":"…", "revision":3, "frontUrl":"/@fs/…" }

# Heartbeat every 25_000 ms (comment lines, ignored by EventSource)
: heartbeat
```

EventSource client uses `withCredentials: true` so auth cookies flow
cross-origin.

### 6.5 Revision-based front dedup

Two refs guard the registry against stale / duplicated events:

- `lastSeenRef` — already committed.
- `latestRequestedRef` — currently in flight (import window).

Proceed only if `event.revision > max(lastSeen, latestRequested)`.
Re-check both before commit (newer event may have arrived during
`await import()`). On disposed unmount, clear `latestRequestedRef`.

### 6.6 Pi parity: manifest-first + convention fallback

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

Conventions for server: `["dist/server/index.js",
"src/server/index.ts"]`. Declared-but-missing throws loudly — no
silent fallback.

### 6.7 Atomic registry replace

Each registry implements `replaceByPluginId(pluginId, newEntries[])`:

```
owned = ids in registry where entry.pluginId === pluginId
if (owned.size === 0 && newEntries.length === 0) return
for (id of owned) registry.delete(id)
for (entry of newEntries) {
  const existing = registry.get(entry.id)
  if (existing && existing.pluginId !== pluginId) {
    console.warn(`[Registry] plugin "${pluginId}" tried to register id "${entry.id}" already owned by "${existing.pluginId}" — skipped`)
    continue
  }
  registry.set(entry.id, { ...entry, pluginId })
}
emit() once   // single transition; Dockview never sees intermediate empty state
```

---

## 7. Gotchas

1. **Externalise Pi in tsup.** `external: ["@mariozechner/pi-coding-agent", "jiti"]`. Otherwise Vite fails to bundle the front (`Could not resolve "fs"`).
2. **jiti `moduleCache: false` is mandatory** for true reload. Without it `/reload` no-ops silently.
3. **No `data:` URL imports** — they can't resolve npm bare specifiers. Use jiti or `pathToFileURL`.
4. **Asset manager does NOT import server modules.** Scan + hash + emit only. Server instantiation lives in `pluginEntryResolver` / `rebuildServerPlugins`. Earlier designs had a route-capture API at the asset-manager layer — drop it; plugins that need HTTP routes use `WorkspaceServerPlugin.routes`.
5. **`React.lazy` types must be stable across renders.** Cache wrapped lazy types by `panelId + importer` reference; hot reload invalidates by changing the importer.
6. **`workbenchOpen` storage key must differ from `surfaceStorageKey`** or both writers stomp the layout JSON.
7. **SSE must replay on connect.** Browsers auto-reconnect; without replay the shell looks half-empty.
8. **Cache-bust front module URL per revision.** `${url}${url.includes("?") ? "&" : "?"}v=${rev}` — browsers key the module cache by URL.
9. **Throw on unresolved `defaultPluginPackages` entries** — silent drop is the worst failure mode.
10. **`boring.id` rejected.** Use `package.json#name`.
11. **Path containment via `realpathSync` on both root + nearest existing ancestor.** Plain `path.relative` misses symlink escapes.
12. **Preflight failures don't break live plugins.** Write `.error` files + emit error events; keep the live `loaded` records intact.
13. **Atomic per-registry replace, not per-output.** Subscribers see one transition per registry.
14. **`WorkspaceUiStateSync` owns PUT-state writes** — pass `bridgeEndpoint={null}` to the inner `WorkspaceProvider` to avoid double-writes.
15. **`definePlugin` mutates** the factory in place — preserves function identity for registries keyed on reference. Document + test.
16. **Single-flight `load()` coalescing** protects against `/reload` spam.

---

## 8. Non-goals

- Plugin marketplace, semver gates, dependency graph, install ordering.
- Plugin-to-plugin RPC. (Plugins talk through the bridge / event bus / shared kits.)
- Lifecycle hooks (`onBeforeLoad`, etc.). Plugins are declarative.
- Backwards-compat shims for earlier shapes (`defineFrontPlugin` as public API, `composePlugins`, `LifecycleBus`, route-capture `BoringServerFactory`).
- Server route or static `agentTools` hot reload (captured at boot / session creation).
- Asset manager serving plugin files. Vite handles `/@fs/...` in dev; host serves built output in prod.

---

## 9. Acceptance

Merge gate:

1. `pnpm test`, `pnpm typecheck`, `pnpm lint:invariants`, `pnpm test:e2e` all green.
2. All four built-in plugins install via the playground's `defaultPluginPackages`.
3. Edit plugin front → `/reload` → updated pane in < 500 ms; no remount of unaffected panes.
4. Edit plugin server → `/reload` → next agent turn uses new tools / prompt.
5. Server throw in one plugin → diagnostics; other plugins still functional.
6. Corrupt plugin front file → SSE error event; other plugins still update.
7. Add / remove from `defaultPluginPackages` takes effect on next `/reload`.
8. No static `import` of plugin modules in `apps/*/src/` (except factory composition inside a concrete inline plugin).
9. Plugin authors import only from `@hachej/boring-workspace/plugin` and `…/app/server`.
10. Public exports diff matches §4 — no accidental private re-exports.
11. Plugin-system-specific code in `packages/workspace/src/{shared,server,app,front}/(plugins|agentPlugins)` ≤ **1,800 LoC**.

---

## 10. Risk register

| Risk | Mitigation |
| --- | --- |
| jiti unavailable in prod | Resolver warns once + falls back to native `import`; document in SKILL.md |
| Slow `directorySignature` on huge plugins | Skip `node_modules` + dotfiles; recomputed only on `/reload`; O(file bytes) — fine under a few MB |
| Race between concurrent `/reload`s | Single-flight `load()` drain loop; `createAgentApp.beforeReload` is serialised |
| Slow front import landing after newer revision | `latestRequestedRef` check before commit drops stale captured payload |
| Stale Pi system prompt after plugin error | `aggregatePluginPrompts` reads `manager.list()` which only contains loaded plugins |
| Vite externalisation regressions | `tsup` `external` list locked; CI `pnpm build` catches breaks |
| Plugin id collision across packages | `bootstrapServer` throws on duplicate; preflight detects across dirs |
| Path traversal in manifest paths | Manifest validation rejects unsafe paths; runtime `realpathSync` containment check |
| Browser holds prior front URL | Cache-bust `?v=<rev>` per revision |

---

*End of plan.*
