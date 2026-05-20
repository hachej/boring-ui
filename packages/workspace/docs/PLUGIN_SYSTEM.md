# Plugin / Agent Layer

Normative spec for `@hachej/boring-workspace`'s plugin + agent layer:
package manifest fields, the public authoring APIs on the
`/plugin`, `/server`, `/app/server`, and `/app/front` subpath
exports, the hot-reload coverage table, prompt-location guidance, the
core algorithms (plugin signature, jiti reload, default-package
resolution, SSE protocol), and the operating-time gotchas + risks
the code is aware of. Code cites this doc as `Per PLUGIN_SYSTEM.md
§X` — keep section numbers stable.

(Originated as `DESIGN.md` at the repo root during the v1 rebuild;
the rebuild's "implementation phases" narrative has been retired —
the code is the implementation truth. Pre-relocation history lives
in `git log -- DESIGN.md`.)

## Contents

1. [Glossary](#1-glossary)
2. [End-to-end behaviour](#2-end-to-end-behaviour)
3. [Architecture](#3-architecture)
4. [Public API](#4-public-api)
5. [Key algorithms](#5-key-algorithms)
6. [Gotchas](#6-gotchas)
7. [Non-goals](#7-non-goals)
8. [Risk register](#8-risk-register)

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
| **Asset manager** | `BoringPluginAssetManager`. Scans plugin dirs, hashes content, emits `boring.plugin.{load,unload,error}` events on its listener bus + the SSE endpoint. |
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
id and the colliding output id — see §5.7.

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
| `/server` | Plugin author (server) + advanced hosts | `defineServerPlugin`, `WorkspaceServerPlugin` type, asset manager, signature helpers |
| `/app/server` | App author | `createWorkspaceAgentServer`, orchestration types |
| `/app/front` | App author | `WorkspaceAgentFront` |
| `/shared` | Both | Runtime-agnostic contracts |

A plugin author imports **only** from `/plugin` and `/server`. They
do not touch orchestration types in `/app/server`.

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

### 4.4 Server authoring (`@hachej/boring-workspace/server`)

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

When a `/reload` cycle changes a plugin whose server file's
fileSignature differs from the previous revision, the SSE
`boring.plugin.load` event carries a structured
`requiresRestart: ('routes' | 'agentTools')[]` field. Subscribers
(the chat UI banner, `boring-ui verify-plugin` output, etc.) render
a "restart needed for: routes, agentTools" hint — better than the
free-text tip the previous design relied on.

```ts
// Event shape after a server-file edit:
{
  type: "boring.plugin.load",
  id: "my-plugin",
  revision: 7,
  boring: { ... },
  frontUrl: "/@fs/...",
  requiresRestart: ["routes", "agentTools"]
}
```

First-time loads (no `previous`) and front-only edits omit the field
(the running server still has the correct boot-time wiring).

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

## 5. Key algorithms

### 5.1 Plugin signature & revision

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
unchanged → no bump, no event (silent skip).

### 5.2 jiti hot-reload import

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

### 5.3 Default plugin package resolution

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

### 5.4 SSE protocol

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

### 5.5 Revision-based front dedup

Two refs guard the registry against stale / duplicated events:

- `lastSeenRef` — already committed.
- `latestRequestedRef` — currently in flight (import window).

Proceed only if `event.revision > max(lastSeen, latestRequested)`.
Re-check both before commit (newer event may have arrived during
`await import()`). On disposed unmount, clear `latestRequestedRef`.
Server-only plugins (no `frontUrl`) skip the import but still update
`lastSeenRef`.

### 5.6 Resolution conventions (manifest-first + dev-source-first fallback)

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

### 5.7 Atomic registry replace + intra-pluginId collision detection

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

## 6. Gotchas

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

## 7. Non-goals

- Plugin marketplace, semver gates, dependency graph, install ordering.
- Plugin-to-plugin RPC. (Plugins talk through the bridge / event bus / shared kits.)
- Plugin lifecycle hooks beyond declaration. No `dispose()` / `onLoad` / etc. — plugins that hold disposable resources (DB pools, intervals, websockets) leak across reloads; restart the workspace process to recover.
- Backwards-compat shims for earlier shapes (`composePlugins`, `LifecycleBus`, route-capture `BoringServerFactory`).
- Hot reload of `WorkspaceServerPlugin.routes` or static `agentTools` mid-session. See §4.5 coverage table.
- Asset manager serving plugin files. Vite handles `/@fs/...` in dev; host serves built output in prod.
- Sandboxing of server plugins. They run with host privileges; trust comes from controlling what's in `defaultPluginPackages`.
- Per-plugin reload routes, structured operator logs, SSE auth / caps / observable heartbeats, test harness exports.

---

## 8. Risk register

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
| Server-side resource leak across reloads (DB pools, intervals) | No lifecycle hook yet; restart the workspace process to recover. A `dispose()` lifecycle is a known future extension when plugins routinely hold disposable resources. |
