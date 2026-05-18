# Plugin / Agent Layer — Standalone Implementation Plan

> Sole source of truth for rebuilding the plugin / agent layer of
> `@hachej/boring-workspace` from `main`. Phases are sequential; meet
> each phase's acceptance criteria before moving on. Type signatures,
> validation rules, and the trickier algorithms are spelled out in
> full. The plan does **not** dump source — that defeats the rebuild.
>
> **Scope discipline.** This is a v1 rebuild. Production hardening
> (allowlists, SSE caps, dispose lifecycles, reload correlation ids,
> latency benches in CI, typed-factory variants, test harness exports)
> is intentionally out of scope. The current branch ships without
> them and works; adding them here would dress a v1 rebuild as a v2
> wishlist. They are tracked under §11.

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
11. [Deferred (post-v1)](#11-deferred-post-v1)

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
| **`WorkspaceServerPlugin`** | Declarative server plugin object (system prompt, agent tools, Pi packages, routes, …). Returned by `boring.server`'s default export, called with `(options, ctx) = (undefined, { workspaceRoot, bridge })`. |
| **Asset manager** | `BoringPluginAssetManager`. Scans plugin dirs, hashes content, emits `boring.plugin.{load,unload,skip,error}` events on its listener bus + the SSE endpoint. |
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
time** and throw a `PluginError("duplicate-id", …)` naming the plugin
id and the colliding output id — see §6.7.

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
re-hashes and bumps revisions → `rebuildServerPlugins` jiti
re-imports → `systemPromptDynamic` + `getDynamicResources` refresh
Pi → SSE pushes load events with new revisions → front
dynamic-imports `<frontUrl>?v=<rev>` and replaces per registry.
Per-plugin failures emit error events but do not abort the rest of
the reload.

### Subpath exports

The split is by **audience**:

| Subpath | Audience | Contents |
| --- | --- | --- |
| `/` | App + plugin | UI runtime (existing on main) |
| `/plugin` | Plugin author (front) | `definePlugin`, `BoringFrontAPI`, manifest validators |
| `/plugin/server` | Plugin author (server) | `defineServerPlugin`, `WorkspaceServerPlugin` type |
| `/app/server` | App author | `createWorkspaceAgentServer`, orchestration types |
| `/app/front` | App author | `WorkspaceAgentFront` |
| `/shared` | Both | Runtime-agnostic contracts |

A plugin author imports **only** from `/plugin` and `/plugin/server`.
They do not touch orchestration types in `/app/server`.

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

At least one of `boring.front` / `boring.server` must be set. Plugin
id is **always derived from `package.json#name`** (strip leading `@`,
`/` → `-`, validated against `PLUGIN_ID_RE`). Authors do not pass an
id separately; `definePlugin(id, …)` must use the same derived id —
`lint:invariants` enforces this so a copy-paste mismatch fails fast.

### 4.2 App `package.json`

```jsonc
{ "boring": { "defaultPluginPackages": ["@me/some-plugin", "./src/plugins/inline"] } }
```

Entries: npm names (resolved via `createRequire`) or `./`-prefixed
relative paths. **If any entry is relative, `appPackageJsonPath` is
required** in `createWorkspaceAgentServer({ … })` — otherwise startup
throws with the offending entry listed. Unresolved npm names also
throw at boot — silent drop is forbidden.

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
// Throws if the input already carries a different `pluginId` brand.
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
  routes?:            FastifyPluginAsync          // captured at boot; see §4.5 hot-reload table
  preservedUiStateKeys?: string[]
}

type WorkspacePiPackageSource =
  | string
  | { source: string; extensions?: string[]; skills?: string[]; themes?: string[]; prompts?: string[] }

// Validates + returns the plugin (shallow clone). Throws ServerPluginError
// with the source file path on validation failure.
function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T
```

The server default export is `(options, ctx) =>
WorkspaceServerPlugin` (or a plain object). `ctx` is
`{ workspaceRoot, bridge }`. Plugins that need typed options handle
that themselves (zod, etc.) — keeping the contract one function.

### 4.5 Hot-reload coverage table

| Plugin contribution | Reload mechanism | When the change is visible |
| --- | --- | --- |
| `package.json#pi.systemPrompt` | asset-manager re-scan → `getDynamicResources` | next agent turn |
| `package.json#pi.{packages,extensions,skills}` | asset-manager re-scan | next agent turn |
| `WorkspaceServerPlugin.systemPrompt` | server rebuild via jiti | next agent turn |
| `WorkspaceServerPlugin.agentTools` | server rebuild — tool registry rebuilt | **next chat session** (existing session keeps boot-time tools) |
| `WorkspaceServerPlugin.extensionFactories` | server rebuild | next agent turn |
| `WorkspaceServerPlugin.routes` | **NOT reloaded** | server restart required |
| Front: panels / commands / left tabs / surface resolvers | SSE → atomic registry replace | immediately |
| Front: providers / bindings | NOT reloaded (mounted in React tree at boot) | server restart required |

If a `/reload` cycle changes a plugin whose signature includes a
server file *and* the plugin declares `routes`, the response body
carries a tip: `"Route handlers changed — restart server to apply."`
Same for `agentTools` (`"new chat session required"`).

### 4.6 Prompt-location guidance

Two valid places exist; pick one per plugin:

- **`WorkspaceServerPlugin.systemPrompt`** — preferred when the
  plugin ships `agentTools`. Prompt + tool defs co-evolve in the same
  file.
- **`package.json#pi.systemPrompt`** — use only for plugins with no
  server entry (front-only / prompt-only).

`aggregatePluginPrompts` walks both in alphabetical id order, server
prompt first per plugin, dedupes identical lines. Authors who set
both get a single boot warning naming the plugin.

### 4.7 Host entry (`@hachej/boring-workspace/app/server`)

```ts
type WorkspacePluginEntry =
  | WorkspaceServerPlugin
  | { dir: string; options?: unknown; hotReload?: boolean }

interface WorkspaceAgentServerPluginContext { workspaceRoot: string; bridge: ReturnType<typeof createInMemoryBridge> }

interface CreateWorkspaceAgentServerOptions extends Omit<CreateAgentAppOptions, "pi"> {
  pi?:                   WorkspaceAgentPiOptions
  plugins?:              WorkspacePluginEntry[]
  appPackageJsonPath?:   string                // required if any defaultPluginPackages entry starts with "./" or "../"
  defaultPluginPackages?: string[]             // inline override; mainly for tests
  pluginHotReload?:      boolean               // default true; governs server re-import + Pi-resource refresh on /reload
  provisionWorkspace?:   boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?:      boolean
}

function createWorkspaceAgentServer(opts): Promise<FastifyInstance>
```

### 4.8 Front host (`@hachej/boring-workspace/app/front`)

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
  hotReloadEnabled?: boolean   // default true; gates /reload + PluginUpdateStatus banner + SSE subscriber mount
  extraPanels?: string[]       extraCommands?: SlashCommand[]
}
```

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
`/plugin`, `/plugin/server`, `/app/{server,front}`, `/shared`.

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
one of `boring.front` / `boring.server` must be present;
`boring.id` is **rejected** (use `package.json#name`);
`pi.{extensions,skills}` are arrays of safe relative paths;
`pi.packages[*]`: string or `{ source, …filters }` — workspace
validates source only (npm:/git:/github:/http:/https:/ssh: prefixes,
file: paths, or plain relative). Filter contents are **not** validated.

**Every validation error carries the absolute `package.json` path**
(passed in via `source`) and the dotted `field` path so the operator
can click-to-open in their editor.

`shared/plugins/types.ts`: `PluginOutput` discriminated union with
literal `type` field; arms: `left-tab`, `panel`, `command`, `catalog`,
`binding`, `provider`, `surface-resolver`.

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
or `PluginError("duplicate-id", …)` on duplicate plugin id naming
both source files; apply `excludeDefaults`; for each plugin, register
`panels[]`, `commands[]`, `catalogs[]`, then dispatch each
`outputs[]` entry; `binding`/`provider` are no-ops (mounted later in
the React tree).

**Acceptance.** Manifest validation accepts boring-front-only,
boring-server-only, pi-only, both, neither (→
`MISSING_REQUIRED_FIELD`); rejects `boring.id`, unsafe paths, unsafe
pi.packages sources. Every error message includes the source
`package.json` absolute path. `bootstrap` throws on no chatPanel and
duplicate ids (with both source paths); registers each output via the
registry interfaces; returns concatenated prompt.

### Phase 2 — Server plugin contract

**Goal.** `defineServerPlugin` + aggregation.

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
functions; `systemPrompt` is string. On failure: throw
`ServerPluginError(\`${source ?? "<unknown>"}: server plugin "${id ??
"<unknown>"}" — ${field ? field + ": " : ""}${message}\`)`.

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
`validateServerPlugin` each; throw on duplicate id naming both
source files; aggregate fields flatly; `piPackages =
compactPiPackages(plugins.flatMap(p => p.piPackages ?? []))`;
`systemPromptAppend` per §4.6 (alphabetical by id, server prompt
first, deduped); `preservedUiStateKeys` deduped via Set.

**Acceptance.** Validation covers all rules with file-path-bearing
errors; aggregator returns correct shape; duplicate id throws with
both sources; malformed plugin throws with clear message.

### Phase 3 — Plugin entry resolver

**Goal.** Single dispatch from any entry shape to a
`WorkspaceServerPlugin`.

**Deliverables.** `app/server/pluginEntryResolver.ts`:

```ts
interface DirPluginEntry       { dir: string; options?: unknown; hotReload?: boolean }
interface PluginResolveContext { workspaceRoot: string; bridge: WorkspaceBridge }

function isDirEntry(entry): entry is DirPluginEntry
async function resolveOnePluginEntry<T extends WorkspaceServerPlugin>(entry, ctx): Promise<T>
```

Dispatch: `isDirEntry → resolveDirServerPlugin(entry, ctx)` else
pass-through.

`resolveDirServerPlugin`:

1. Read `package.json` from `entry.dir` (throw if absent).
2. Resolve `serverPath`: manifest field `boring.server` first
   (`false` → return null and tag plugin as front-only; string →
   resolve relative; throw if file missing). Else try conventions
   (§6.6). If `hotReload`, conventions prefer `src/` so dev source
   wins over stale `dist/`.
3. Import via §6.2 (jiti when `hotReload`, native otherwise).
4. **Detect missing `export default`**: if `mod.default` is absent,
   throw `Error(\`${serverPath}: boring.server entry must use
   \`export default\`. Got named exports: ${Object.keys(mod).join(",
   ")}\`)`.
5. `value = mod.default`. If function → `value(entry.options, ctx)`
   and return. If object → return. Else throw with `serverPath` in
   the message.
6. **Path containment**: `realpathSync(serverPath)` must stay under
   `realpathSync(entry.dir)`; throw `BoringPluginError("PATH_ESCAPE",
   …)` otherwise. (This is a load-time input guard, **not a
   sandbox** — server plugins run with full host privileges.)

**Acceptance.** Pre-built object passes through; dir entry loads via
manifest field; convention fallback works in dev-then-prod order;
declared-but-missing throws; missing-default-export error names the
named exports; function default called with `(options, ctx)`;
non-function non-object default throws; `hotReload: true` re-imports
fresh after a source edit and prefers `src/` over `dist/`; manifest
pointing at a symlink that escapes the plugin dir throws
`PATH_ESCAPE`.

### Phase 4 — `createWorkspaceAgentServer`

**Goal.** The orchestrator. Reads app manifest, resolves + aggregates
plugins, boots Fastify + Pi, wires `beforeReload` with **partial-
failure tolerance**.

**Deliverables.**

`app/server/rebuildServerPlugins.ts`:

```ts
async function rebuildServerPlugins({ entries, ctx }): Promise<{
  ok: boolean
  plugins: WorkspaceServerPlugin[]
  diagnostics: { source: string; pluginId?: string; message: string }[]
}>
```

For each entry: `resolveOnePluginEntry(entry, ctx)`. On error, push
diagnostic with `source = isDirEntry(entry) ? \`directory
(${dir})\` : "entry"`. Failed entries do **not** abort the rest.

`app/server/createWorkspaceAgentServer.ts` orchestration:

1. `bridge = createInMemoryBridge()`.
2. `defaultPluginPackages = [...(opts.defaultPluginPackages ?? []),
    ...(readAppManifestDefaultPlugins(opts.appPackageJsonPath) ??
    [])]`.
3. `defaultPluginPackagePaths = resolveDefaultPluginPackagePaths({
   workspaceRoot, appPackageJsonPath }, defaultPluginPackages)` —
   §6.3. **Throw if any relative entry exists and
   `appPackageJsonPath` is unset.** Throw on unresolved npm names
   with the resolution attempts in the message.
4. `allPluginEntries = [...defaultDirEntries, ...(opts.plugins ??
   [])]` where each default gets `hotReload: opts.pluginHotReload ??
   true`.
5. `ctx = { workspaceRoot, bridge }`.
6. `resolvedPlugins = await Promise.all(allPluginEntries.map(e =>
   resolveOnePluginEntry(e, ctx)))` — per-entry throw at boot only
   (boot is fatal; reload is tolerant via `rebuildServerPlugins`).
7. `pluginCollection = collectWorkspaceAgentServerPlugins({ ...opts,
   plugins: resolvedPlugins })` — calls `bootstrapServer`, prepends
   workspace + Pi `nodePackageContribution`s, composes
   `pi.additionalSkillPaths = [workspaceSkillsDir,
   ...callerAdditional]`, runs `compactPiPackages`.
8. Optionally `provisionWorkspaceAgentServer` unless
   `provisionWorkspace === false`.
9. `boringPluginDirs = dedup([\`${workspaceRoot}/.pi/extensions\`,
   ...extensionPathRoots, ...defaultPluginPackagePaths])`.
10. `assetManager = new BoringPluginAssetManager({ pluginDirs:
    boringPluginDirs, errorRoot:
    \`${workspaceRoot}/.pi/extensions\` })`.
11. `rebuildPlugins = async () => rebuildServerPlugins({ entries:
    allPluginEntries, ctx })`.
12. `app = await createAgentApp({
        ...opts,
        beforeReload: async () => {
          if (opts.pluginHotReload !== false) {
            const r = await assetManager.load()
            // Per-plugin scan errors are surfaced via SSE error
            // events + .error files. Only abort the entire reload on
            // infrastructural failure (e.g. preflight could not
            // enumerate dirs at all).
            const rb = await rebuildPlugins()
            // Per-plugin rebuild diagnostics flow into the response
            // body of POST /api/boring.reload without throwing here.
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
        systemPromptDynamic: opts.pluginHotReload !== false ? () => aggregatePluginPrompts(assetManager) : undefined,
      })`.
13. `await assetManager.load()`.
14. Register `uiRoutes`, `boringPluginRoutes(app, { manager:
    assetManager })`, each `routeContributions.routes`.
15. Attach `(app as any).__boringRebuildPlugins = rebuildPlugins` for
    tests / tooling.

`readPackageJsonPiSnapshot(pluginDirs)` re-reads each plugin's
`package.json#pi` and returns `{ packages, skills, extensions }` flat
arrays. Empty snapshot on preflight failure.

`readAppManifestDefaultPlugins` re-reads on **every** `/reload` so a
user can add or remove plugins by editing the manifest without
restarting.

`app/server/index.ts` barrel re-exports
`createWorkspaceAgentServer`, `collectWorkspaceAgentServerPlugins`,
`provisionWorkspaceAgentServer`, `buildWorkspaceContextPrompt`, and
orchestration types. **It does NOT re-export `defineServerPlugin` /
`WorkspaceServerPlugin`** — those live on `/plugin/server`.

**Acceptance.** No plugins → empty arrays passed to Pi. Manifest
default plugins resolve and end up as `DirPluginEntry` items.
Unresolved npm entry → throw with `appPackageJsonPath` in the
message. Relative entry without `appPackageJsonPath` → throw.
`pluginHotReload: false` skips beforeReload scan + rebuild.
**Per-plugin rebuild diagnostics do NOT abort the reload**; they flow
to the 422 body of `POST /api/boring.reload`. UI + plugin SSE routes
+ per-plugin routes registered. `__boringRebuildPlugins` exposed.

### Phase 5 — Asset manager

**Goal.** Scan plugin dirs → hash → emit
`boring.plugin.{load,unload,skip,error}` events. Single-flight,
coalescing.

**Deliverables.**

`server/agentPlugins/types.ts`:

```ts
interface BoringServerPluginManifest {
  id: string; rootDir: string; version: string
  boring: BoringPackageBoringField; pi?: BoringPackagePiField
  frontPath?: string; frontUrl?: string    // frontUrl = `/@fs/${frontPath}` (vite convention)
  serverPath?: string; extensionPaths?: string[]; skillPaths?: string[]
}
type BoringPluginEvent =
  | { type: "boring.plugin.load";   id; boring; version; revision; frontUrl? }
  | { type: "boring.plugin.unload"; id; revision }
  | { type: "boring.plugin.skip";   id; revision; reason: "signature-unchanged" }
  | { type: "boring.plugin.error";  id; revision; message; source?: string }
interface BoringPluginListEntry { id; boring; pi?; version; revision; frontUrl? }
```

The `skip` event lets the front banner show "no changes detected"
rather than treating a silent reload as success.

`server/agentPlugins/scan.ts`:

- `preflightBoringPlugins(pluginDirs)`: discovers dirs, parses each
  `package.json`, validates manifest, derives plugin id, detects
  duplicates, checks `realpathSync` path containment.
- `readBoringPlugins(pluginDirs)`: returns `[]` only on fatal
  enumeration failures. Per-plugin manifest issues become diagnostics.
- `pluginRootFromExtensionPath(extensionPath)`: requires
  `<pluginRoot>/agent/<entry>` convention.

`server/agentPlugins/manager.ts` (`class BoringPluginAssetManager`):

```ts
constructor({ pluginDirs, errorRoot? })
preflight(): BoringPluginPreflightResult
list():     BoringPluginListEntry[]
getError(pluginId): string | null
subscribe(listener: (event) => void): () => void
load(): Promise<{ loaded: BoringPluginListEntry[]; events: BoringPluginEvent[]; errors: { id; revision; message }[] }>
```

State: `loaded: Map<id, record + revision + signature>`, `revisions:
Map<id, number>`, `listeners: Set`, `loading: Promise|null`,
`reloadQueued: boolean`.

**Single-flight `load()`**: if `loading` set → `reloadQueued = true;
return loading`. Else `loading = drainLoads()`. `drainLoads()` loops
`await doLoadOnce()` while `reloadQueued`.

**`doLoadOnce()`**: preflight; on errors write `.error` files under
`errorRoot/<preflightErrorId(dir)>/.error` (id = `"preflight-" +
sha256(dir).slice(0,12)`), bump revision, emit error event,
**continue**. Compute `next = readBoringPlugins(...)`. Unload set =
ids in `loaded` not in `next` → delete + bump revision + emit unload.
For each `next` plugin: compute `signature = pluginSignature(plugin)`
(§6.1); if `loaded.get(id)?.signature === signature` → emit `skip
{ reason: "signature-unchanged" }`. Else: bump revision, update
record, clear `.error`, emit `load`. On exception during update:
write `.error`, emit error, keep prior record.

`emit(event)`: try-catch around listener calls.

`getError(id)` reads `errorPath(id)` (validate
`isValidBoringPluginId`, ensure resolved path stays under
`errorRoot`); returns null if absent.

**The asset manager does NOT import server modules.** Scan + hash +
emit only. Server-side plugin instantiation lives in
`pluginEntryResolver` and runs inside `rebuildServerPlugins`. The
manager's signature is the single source of truth for "did this
plugin change"; rebuild reads the manager's state (`previous`
implicit via `lastResolvedById`) to skip jiti re-import when the
signature matches — paying full re-import cost only when content
actually changed.

`server/agentPlugins/aggregatePluginPrompts.ts` (one helper):

```ts
function aggregatePluginPrompts(manager): string | undefined
```

Iterates `manager.list()` in alphabetical id order, collects truthy
prompts per §4.6 ordering, dedupes identical lines; returns
`undefined` if none.

**Acceptance.** Empty dirs → empty result. Single valid plugin →
load(rev=1). Reload no changes → `skip` events emitted (not silent
no-op). Edit a file → revision bumps, single load. Delete a plugin →
unload + bump. Preflight failure → error events + previous live
unchanged. 5 concurrent `load()` calls → 1–2 doLoadOnce passes.
Listener throw doesn't break others. `.error` file persisted.
Symlinked plugin (pnpm `link:`) reloads correctly (§6.1 follow-once
algorithm).

### Phase 6 — SSE routes + front subscriber

**Goal.** Push events; consume and atomically replace registry
entries per plugin id.

**Deliverables.**

`server/agentPlugins/routes.ts` — `boringPluginRoutes(app, { manager
})`:

- `POST /api/boring.reload` → `manager.load()`; if any per-plugin
  errors or rebuild diagnostics: 422 with `{ ok:false, errors,
  diagnostics, plugins }`; else 200 with `{ ok:true, plugins }`. The
  body carries diagnostics from BOTH the asset manager AND
  `rebuildServerPlugins` (Phase 4 wires them in).
- `GET  /api/agent-plugins` → `manager.list()`.
- `GET  /api/agent-plugins/:id/error` → text body or 404.
- `GET  /api/v1/agent-plugins/events` — **SSE** per §6.4.

**SSE replay on connect.** Browsers auto-reconnect; the server emits
`boring.plugin.load` for every current plugin on every connection so
the front never lands in stale state.

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
}
```

Implements §6.5 (revision dedup) + §6.7 (atomic per-registry replace
with **intra-pluginId collision detection** — see §6.7). Server-only
plugins (`frontUrl` absent) skip the import path but still update
`lastSeenRef` so subsequent events are processed in order. On
unmount: clear `latestRequestedRef`, close EventSource.

**Acceptance.** Hook subscribes; renders contributions on
`boring.plugin.load`; new revision remounts updated panes. Slow front
import racing newer revision: only newer commits. Disposed hook
ignores in-flight imports. Failed front import: previous version
stays. Malformed SSE data: logged, no commit. Unload removes entries.
Error event logged. Skip event → banner says "no changes detected".
Reconnect: server replays current state, hook dedups via
`lastSeenRef`. Cross-origin SSE with `withCredentials: true` flows
cookies. Server-only plugin (no `frontUrl`) emits load events but no
banner spam.

### Phase 7 — Hot reload integration

**Goal.** Wire `/reload` through server + front; deliver the
coverage promised by §4.5.

**Deliverables.** No new files; modifications:

- `createAgentApp.beforeReload` (Phase 4) calls
  `assetManager.load()` + `rebuildServerPlugins` and **propagates
  diagnostics into the response body without throwing** (per-plugin
  failures don't abort the reload).
- `systemPromptDynamic` returns `aggregatePluginPrompts(manager)`.
- `pi.getDynamicResources` returns
  `readPackageJsonPiSnapshot(boringPluginDirs)`.
- `WorkspaceProvider` mounts `useAgentPluginHotReload(...)` inside
  registry context.
- `/reload` slash command calls `POST /api/v1/agent/reload`. Composer
  banner uses `PluginUpdateStatus` to surface running / success /
  no-changes / error.
- If a reloaded plugin declares `routes` or `agentTools`, the
  response body carries a tip; banner shows the appropriate
  "restart required" / "new session required" message.

**Acceptance.** Edit server file → `/reload` → next agent turn uses
new prompt + extensionFactories. Edit a tool → next chat session has
new tool. Edit a route handler → banner says "restart required". Edit
front file → SSE re-imports updated pane. New entry in
`defaultPluginPackages` → next `/reload` picks it up. Removed plugin
disappears after reload. Server entry throws during rebuild → 422
with diagnostics; live plugins unaffected; **other plugins' new code
lands in the same reload**. Preflight error → 422 + error event +
previous live plugins untouched.

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

Note: `WorkspaceFrontPlugin.systemPrompt` exists for legacy
static-composition; §4.6 prefers `package.json#pi.systemPrompt` for
front-only plugins.

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
`pluginId` brand → throws.

`createCapturingBoringFrontAPI`: each `register*` pushes both into
the matching array and a normalised `PluginOutput` into `outputs`.
**Intra-`pluginId` collision detection at capture time**: if two
`register*` calls in the same factory chain land the same output id,
throw `PluginError("duplicate-id", \`plugin "${pluginId}" registers
${kind} "${id}" twice\`)`. This catches composition-pattern bugs
(two kits both registering panel "table") that §6.7's atomic replace
cannot detect (same pluginId → last-write-wins).

`boringFrontFactoryToPlugin`: calls factory synchronously; throws if
the factory returns a thenable; returns `defineFrontPlugin({ id,
label, outputs: captured.outputs })`.

`toWorkspacePlugin`: factory-with-id → wraps via
`boringFrontFactoryToPlugin`; bare factory without id → throws "wrap
with `definePlugin(id, factory)`"; plain `WorkspaceFrontPlugin` →
as-is.

Subpath barrel `packages/workspace/src/plugin.ts` re-exports
`definePlugin`, `boringFrontFactoryToPlugin`, all `BoringFront*`
types, `PluginOutput` arms, manifest validators + types.

`app/front/WorkspaceAgentFront.tsx` (~400 LoC target):

- Wraps `WorkspaceProvider`. Pass `bridgeEndpoint={null}` —
  `WorkspaceUiStateSync` here owns PUT state.
- Mount `useAgentPluginHotReload({ apiBaseUrl, workspaceId, enabled:
  hotReloadEnabled ?? true })` inside the provider tree.
- Storage keys: `providerStorageKey ?? \`boring-ui-v2:layout:${workspaceId}\``;
  `surfaceStorageKey ?? \`${providerStorageKey}:surface\``;
  `shellStorageKey = surfaceStorageKey.slice(0, -":surface".length)`;
  `sessionStorageKey ?? \`boring-workspace:sessions:${workspaceId}\``.
  Persisted booleans use distinct keys derived from `shellStorageKey`:
  `:drawer`, `:workbenchOpen`, `:workbenchLeftOpen`. **The
  `:workbenchOpen` key MUST differ from `surfaceStorageKey`** or
  both writers stomp the layout JSON.
- Plugin normalisation: `normalizedPlugins =
  plugins?.map(toWorkspacePlugin) ?? []`. Flatten `pluginOutputs`,
  extract `pluginPanelIds`, derive `shellExtraPanels = [...extraPanels,
  ...pluginPanelIds]`.
- Sessions: explicit props OR `useSessions` hook OR fallback
  local-storage sessions. Auto-create first session on idle empty
  state.
- `centerParams` forwards `sessionId`, surface API getters,
  `extraCommands`, conditionally `hotReloadEnabled`.
- `WorkspaceUiStateSync` inner component PUTs UI state to
  `${bridgeEndpoint}/api/v1/ui/state` on change, AbortController on
  prop change, silent on error, noop when `bridgeEndpoint` null.
- `useEffect` adds `window.addEventListener(UI_COMMAND_EVENT, …)` →
  `dispatchUiCommand` with surface APIs.

`app/front/index.ts` barrel re-exports `WorkspaceAgentFront` + its
public prop types.

**`PluginUpdateStatus`** composer banner states:

```ts
type PluginUpdateState =
  | { kind: "running" }
  | { kind: "success"; reloaded: boolean; tips?: string[] }   // tips: route/tool reload caveats
  | { kind: "no-changes" }                                     // emitted when all events were "skip"
  | { kind: "error"; message: string }
function PluginUpdateStatus({ state, onDismiss, onRetry })
```

**Acceptance.** `definePlugin` returns a NEW function; input factory
remains unbranded and reusable. `definePlugin` with conflicting
existing brand throws. `toWorkspacePlugin` rejects bare factories.
Intra-pluginId collision throws at capture. SSE hook mounts only when
`hotReloadEnabled !== false`. Storage keys default correctly.
`WorkspaceUiStateSync` noop when `bridgeEndpoint` null.
`PluginUpdateStatus` renders all 4 states; "no-changes" appears when
all events were `skip`.

### Phase 9 — Built-in plugins

**Goal.** Ship four reference plugins + lint:invariants.

| Path | Category | Notes |
| --- | --- | --- |
| `plugins/_template/` | Plugin (reference) | See "Template contents" below. |
| `plugins/ask-user/` | Plugin | Questions panel + `ask_user` tool. Server default: `(options, ctx) => createAskUserServerPlugin({ ...options, workspaceRoot: ctx.workspaceRoot, bridge: ctx.bridge })`. |
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
  opening the panel.
- Shared types in `shared/index.ts` (front + server type-sharing).
- `tests/panel.test.tsx` — example RTL test that mounts the panel
  with `WorkspaceProvider`.
- `tests/server.test.ts` — example tool execution test.
- `README.md` sections: "What this template demonstrates"
  (checklist); "Where to put your system prompt" (rule from §4.6);
  "Common mistakes" (forgot `export default`; pluginId != name;
  registered same id from two kits).

#### `lint:invariants` rules added in this phase

For every package in `plugins/*` and `apps/*/src/plugins/*`:

1. If `package.json#boring` exists, `boring.front` or `boring.server`
   (or both) MUST be set; manifest must pass
   `validateBoringPluginManifest`.
2. **Plugin id consistency**: the default export of the built front
   file MUST be branded with `pluginId` equal to the derived id from
   `package.json#name`. Same for server's `defineServerPlugin({ id
   })` return. Mismatch fails CI.
3. `peerDependencies` MUST include `@hachej/boring-workspace`.
4. No static `import` of plugin modules from `apps/*/src/` (except
   factory-chaining composition inside a Plugin's own factory).

#### Plugin `package.json` template

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

#### Server entry template

```ts
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/plugin/server"

function createXServerPlugin(opts: { workspaceRoot: string }): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "x", label: "X",
    systemPrompt: "…",   // co-located with the tool below per §4.6
    agentTools: [makeXTool(opts)],
  })
}

// Default export — adapter for the standard load process.
export default function defaultXServerPlugin(
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return createXServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}
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
catalog surfaces from one entry. Intra-plugin id collision throws at
capture with a clear error. lint:invariants catches id-derivation
mismatches and missing peerDeps.

### Phase 10 — Docs

`packages/pi/skills/boring-plugin-authoring/SKILL.md`: covers plugin
author contract, app installation, `definePlugin` /
`defineServerPlugin`, the five composition patterns
(configure-via-options, component reuse, factory chaining,
side-by-side, fork), and the prompt-location rule from §4.6. Point
to `_template` and the playground for live examples.

Refresh repo `README.md` "Plugin system" section to match this design.

### Phase 11 — Cleanup

Run: `pnpm typecheck`, `pnpm test`, `pnpm lint:invariants`,
`pnpm test:e2e`. Manual smoke in playground: load all plugins, edit
a source file, `/reload`, observe banner cycle (running → success or
no-changes). Introduce a syntax error, observe error banner; confirm
other plugins still update. Add a route to a plugin, observe the
"restart required" tip. Audit barrel exports — confirm they match §4.

---

## 6. Key algorithms

### 6.1 Plugin signature & revision

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

`pluginSignature(plugin)`: `sha256` of `JSON.stringify({boring,
pi})` + version + frontPath + `fileSignature(frontPath)` +
`directorySignature(dirname(frontPath))` +
`directorySignature(\`${dirname(frontPath)}/../shared\`)` + serverPath +
`fileSignature(serverPath)` + `directorySignature(dirname(serverPath))` +
`extensionPaths.join("|")` + `skillPaths.join("|")`. The `../shared`
walk targets the **source** layout (`src/front` + `src/shared`); in
`dist` layouts it usually resolves to `dist/shared` which may not
exist (shared types are inlined at build) — `directorySignature`
returns `"missing"`, hashed stably as a single segment, no false
invalidation.

Revision: `(revisions.get(id) ?? 0) + 1`, set, return. Signature
unchanged → no bump, emit `skip` event so the front can show "no
changes detected".

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
unavailable, warn once and fall back; subsequent reloads won't pick
up source changes. Note: don't use `data:` URLs — they can't resolve
npm bare specifiers.

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
    // npm name: app's require first, then workspace package's.
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

**Throw on unresolved.** Silent drop = mystery missing features.

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
data: { "type":"boring.plugin.load", "id":"…", "boring":{…}, "version":"…", "revision":3, "frontUrl":"/@fs/…" }

# Heartbeat every 25 s (keeps proxies alive)
: heartbeat
```

EventSource client uses `withCredentials: true` so auth cookies flow
cross-origin. On `req.raw.on("close" | "error", …)`: unsubscribe +
clear heartbeat interval.

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

Declared (`boring.server`) always wins.

### 6.7 Atomic registry replace + intra-pluginId collision detection

Each registry implements `replaceByPluginId(pluginId, newEntries[])`:

```
owned = ids in registry where entry.pluginId === pluginId
if (owned.size === 0 && newEntries.length === 0) return
for (id of owned) registry.delete(id)
for (entry of newEntries) {
  const existing = registry.get(entry.id)
  if (existing && existing.pluginId !== pluginId) {
    console.warn(`registry collision: plugin "${pluginId}" tried to register id "${entry.id}" already owned by "${existing.pluginId}" — skipped`)
    continue
  }
  registry.set(entry.id, { ...entry, pluginId })
}
emit() once   // single transition; Dockview never sees intermediate empty state
```

**Intra-pluginId collision is caught earlier**, at capture time
inside `createCapturingBoringFrontAPI`. Two `register*` calls in the
same factory chain landing the same output id throw
`PluginError("duplicate-id", \`plugin "${pluginId}" registers ${kind}
"${id}" twice\`)`. This is the composition-pattern failure mode
`replaceByPluginId` cannot detect (same pluginId → silent
last-write-wins).

---

## 7. Gotchas

1. **Externalise Pi in tsup.** `external: ["@mariozechner/pi-coding-agent", "jiti"]`. Otherwise Vite fails to bundle the front (`Could not resolve "fs"`).
2. **jiti `moduleCache: false` is mandatory** for true reload. Without it `/reload` no-ops silently.
3. **No `data:` URL imports** — they can't resolve npm bare specifiers. Use jiti or `pathToFileURL`.
4. **Asset manager does NOT import server modules.** Scan + hash + emit only. Server instantiation lives in `pluginEntryResolver` / `rebuildServerPlugins`.
5. **`React.lazy` types must be stable across renders.** Cache wrapped lazy types by `panelId + importer` reference; hot reload invalidates by changing the importer.
6. **`workbenchOpen` storage key must differ from `surfaceStorageKey`** or both writers stomp the layout JSON.
7. **SSE must replay on connect.** Browsers auto-reconnect; without replay the shell looks half-empty.
8. **Cache-bust front module URL per revision.** `${url}${url.includes("?") ? "&" : "?"}v=${rev}`.
9. **Throw on unresolved `defaultPluginPackages` entries** — silent drop is the worst failure mode. Error names every resolution attempt + `appPackageJsonPath`.
10. **Relative `defaultPluginPackages` entries require `appPackageJsonPath`.** Anchor must be the app, not the workspace root.
11. **`boring.id` rejected.** Plugin id is derived from `package.json#name`; `definePlugin(id, …)` must use the derived id (lint:invariants enforces).
12. **`realpathSync` path containment is a load-time input guard, NOT a sandbox.** Server plugins run with full host privileges.
13. **Preflight failures don't break live plugins.** Write `.error` files + emit error events; keep the live `loaded` records intact.
14. **Atomic per-registry replace, not per-output.** Subscribers see one transition per registry. Intra-pluginId collisions are caught at capture, not by the registry.
15. **`WorkspaceUiStateSync` owns PUT-state writes** — pass `bridgeEndpoint={null}` to the inner `WorkspaceProvider` to avoid double-writes.
16. **`definePlugin` returns a NEW wrapper.** It does not mutate the input factory. Calling `definePlugin` twice on the same input with the same id is safe; with different ids throws.
17. **Per-plugin failures during `/reload` MUST NOT abort the whole reload.** Diagnostics flow into the response body; healthy plugins still pick up new code.
18. **pnpm symlinked plugins require follow-once-via-realpath** in `directorySignature`. Naive symlink skip silently breaks hot reload for `pnpm link:` workflows.
19. **`agentTools` reload requires a new chat session.** Existing sessions hold the boot-time tool registry.
20. **`routes` are captured at boot.** Edits don't reload — the banner surfaces "restart required" when a route-bearing plugin's signature changes.
21. **Single-flight `load()` coalescing** protects against `/reload` spam.
22. **Server-only plugins are valid.** `boring.front: false` (or absent) skips front import path. The SSE consumer must handle `frontUrl?: undefined` cleanly.
23. **Missing `export default` on server entry gives a clear error.** The resolver names the file path + the named exports it saw.

---

## 8. Non-goals

- Plugin marketplace, semver gates, dependency graph, install ordering.
- Plugin-to-plugin RPC. (Plugins talk through the bridge / event bus / shared kits.)
- Plugin lifecycle hooks beyond declaration. No `dispose()` / `onLoad` / etc. in v1 — plugins that hold disposable resources will leak across reloads; restart the server to recover. Tracked under §11.
- Backwards-compat shims for earlier shapes (`composePlugins`, `LifecycleBus`, route-capture `BoringServerFactory`).
- Hot reload of `WorkspaceServerPlugin.routes` or static `agentTools` mid-session. See §4.5 coverage table.
- Asset manager serving plugin files. Vite handles `/@fs/...` in dev; host serves built output in prod.
- Sandboxing of server plugins. They run with host privileges; trust comes from controlling what's in `defaultPluginPackages`.
- Per-plugin reload routes, structured operator logs, SSE auth / caps / observable heartbeats, test harness exports. Tracked under §11.

---

## 9. Acceptance

Merge gate:

1. `pnpm test`, `pnpm typecheck`, `pnpm lint:invariants`,
   `pnpm test:e2e` all green.
2. All four built-in plugins install via the playground's
   `defaultPluginPackages`.
3. Edit plugin front → `/reload` → updated pane visible without
   restart. No re-mount of unaffected panes.
4. Edit plugin server → `/reload` → next agent turn uses new prompt
   / extensionFactories. Tool edits visible in next chat session;
   banner surfaces this.
5. Server throw in one plugin → diagnostics in the 422 body; other
   plugins still functional; **healthy plugins still pick up edits
   in the same reload**.
6. Corrupt plugin front file → SSE error event; other plugins still
   update.
7. Add / remove from `defaultPluginPackages` takes effect on next
   `/reload` (no restart).
8. No static `import` of plugin modules in `apps/*/src/` (except
   factory composition inside a Plugin's own factory).
9. Plugin authors import only from `@hachej/boring-workspace/plugin`
   and `…/plugin/server` (lint:invariants check).
10. Plugin id mismatch (front pluginId !== derived id from
    `package.json#name`) fails `pnpm lint:invariants`.
11. pnpm `link:` workflow: editing a linked plugin's source triggers
    a reload (symlink follow-once works).

---

## 10. Risk register

| Risk | Mitigation |
| --- | --- |
| jiti unavailable in prod | Resolver warns once + falls back to native `import`; document in SKILL.md |
| Slow `directorySignature` on huge plugins | Skip `node_modules` + dotfiles; recomputed only on `/reload`; O(file bytes) — fine under a few MB |
| Race between concurrent `/reload`s | Single-flight `load()` drain loop; `beforeReload` is serialised by `createAgentApp` |
| Slow front import landing after newer revision | `latestRequestedRef` check before commit drops stale captured payload |
| Stale Pi system prompt after plugin error | `aggregatePluginPrompts` reads `manager.list()` which only contains loaded plugins |
| Vite externalisation regressions | `tsup` `external` list locked; CI `pnpm build` catches breaks |
| Plugin id collision across packages | `bootstrapServer` throws on duplicate; preflight detects across dirs; both source files in error |
| Intra-pluginId output collision in factory-chained kits | Detected at capture in `createCapturingBoringFrontAPI`; throws with kind + id |
| Path-shape attacks in manifest paths | Manifest validation rejects unsafe paths; runtime `realpathSync` containment for declared entry only (not a sandbox) |
| Browser holds prior front URL | Cache-bust `?v=<rev>` per revision |
| pnpm `link:` workflow not reloading | `directorySignature` follows symlinks once via `realpathSync` with cycle detection |
| `routes` edits not landing silently | Banner surfaces "restart required" tip when reloaded plugin has `routes` |
| `agentTools` edits not picked up in current session | Banner surfaces "new chat session required" tip |
| Server-side resource leak across reloads (DB pools, intervals) | v1: restart the server to recover. v2: add `dispose()` lifecycle — see §11 |

---

## 11. Deferred (post-v1)

Out of scope for the first cut; track for v2. Each is justified
production hardening that the current branch ships without and that
adding now would expand scope unnecessarily.

- **`dispose()` lifecycle on `WorkspaceServerPlugin`** — needed once
  plugins routinely hold DB pools / websockets / intervals. Until
  then, restart-on-leak is acceptable.
- **`serverPluginAllowlist` + fail-closed prod default** — RCE
  hardening for environments that npm-install untrusted plugin
  packages. The first-party plugin set is trusted by construction.
- **SSE auth / connection caps / backpressure / observable
  heartbeats** — multi-tenant ops concerns; the dev / single-operator
  workflow doesn't hit them.
- **`reloadId` correlation on events** — disambiguates concurrent
  reloads from multiple tabs. Single-tab dev workflow is fine
  without.
- **Two-tier signature (quick stat + full hash)** — perf optimisation
  for hundreds of plugins. Linear hashing of 4-10 plugin trees is
  cheap enough.
- **`defineServerPluginFactory<TOptions>`** — typed-options helper.
  Plugins that need it can implement zod inside their default export
  today.
- **Test harness exports (`/plugin/testing`)** — authors can use
  vitest + the existing internals for now; an official harness is
  worth shipping once the plugin author count grows.
- **`POST /api/boring.reload/:id`** — single-plugin reload route;
  requires filtered `rebuildServerPlugins` path. Defer until base
  `/reload` is stable.
- **Latency bench in CI** — measurable SLO for `/reload` end-to-end;
  worth adding once perf regresses or is suspected.
- **Structured operator logger** — replace ad-hoc `console.warn` with
  a pino-shaped logger interface for production debugging.
- **`create-boring-plugin` CLI generator** — `pnpm dlx
  create-boring-plugin <slug>` with token replacement. lint:invariants
  catches the worst footgun (id mismatch); CLI is convenience.
- **Plugin asset CDN for production** — serve hashed bundles from
  static asset path instead of `/@fs/` (which leaks server filesystem
  layout). Important for prod deployment; not for dev.

---

*End of plan.*
