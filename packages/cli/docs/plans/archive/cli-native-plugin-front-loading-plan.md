# CLI Native Plugin Front Loading Plan

## Goal

Make the **packaged local `boring-ui` CLI** render discovered runtime plugin UIs on:

- **first page load**
- **later `/reload`**

using the **same runtime-plugin pipeline** in both cases.

This plan is only for the **local trusted-native frontend slice** of runtime-plugin v2.
It is **not** the full runtime-plugin roadmap.

---

## The problem in one sentence

Today the CLI can **discover** runtime plugins and wire their **Pi resources**, but the packaged browser app still cannot **import and render** their `boring.front` code.

---

## What already works vs what is broken

### Already works

PR 76 already shipped:

- global Pi-root discovery: `~/.pi/agent/extensions/*`
- workspace-local Pi-root discovery: `<workspace>/.pi/extensions/*`
- server-side plugin listing
- plugin Pi snapshot wiring for the agent
- plugin discovery in folder mode and workspaces mode

### Still broken

The packaged CLI browser app still does **not** render discovered plugin UIs because:

1. `packages/cli/src/front/App.tsx` uses `plugins={[]}`
2. `packages/cli/src/front/App.tsx` uses `frontPluginHotReload={false}`
3. discovered plugin `frontUrl` still points at Vite-dev-style raw source URLs like:

```txt
/@fs/absolute/path/to/front/index.tsx
```

4. the packaged CLI static server cannot transform raw `.ts/.tsx` plugin source into browser-loadable ESM

So the missing piece is:

> **a host-owned browser module loading mechanism for runtime plugin front source**

Important nuance:

- this does **not** mean we are committing to a big permanent REST surface
- this does **not** mean the browser should read plugin files directly from disk
- this **does** mean the browser needs some CLI-owned way to request a plugin module and receive transformed browser-loadable JS back

---

## What will be built

This follow-up builds **five concrete things**.

### 1. A CLI-owned runtime plugin browser-module loader

New server-side component in `packages/cli`.

Its job:

- accept a CLI-owned plugin module request from the browser
- resolve it to the correct loaded plugin + file
- transform the source with **embedded Vite in middleware mode**
- return browser-loadable ESM

This replaces raw `/@fs/...` browser imports in packaged CLI mode.

**Locked implementation direction:**

- Fastify/CLI remains the parent server
- Vite runs behind it in middleware mode as the transform/module-serving engine
- browser sees a CLI-owned module-loading surface, not raw Vite dev URLs as the public contract

So the key requirement is:

> browser asks CLI for plugin module bytes, CLI validates the request, and embedded Vite performs the transform underneath.

### 2. Host-owned `frontUrl` generation

Folder mode and workspaces mode will stop exposing raw Vite dev URLs.

Instead, each discovered plugin will get a **CLI-owned browser module URL**.

**Locked URL-contract direction:** use a **path-style URL** that stays easy to inspect/debug.

Conceptually it should look like:

```txt
/api/v1/agent-plugins/runtime/<workspace>/<plugin>/<revision>/<subpath>
```

The exact prefix can still move, but the contract should stay path-style and **revision-addressed**.

The important part is:

- **CLI owns the module-loading mechanism**
- **CLI owns the transform**
- browser no longer imports raw source by absolute filesystem path
- URL stays human-debuggable
- strict containment validation is mandatory
- dynamic import cache invalidation is deterministic because each loaded revision has a unique module URL

### 3. Workspaces-mode plugin events

Folder mode already has the plugin event path through the workspace server composition.

Workspaces mode still needs matching runtime-plugin event support:

- replay currently loaded plugins on EventSource connect
- emit later updates after `/reload`
- stay workspace-scoped

### 4. Stock CLI frontend runtime plugin loading

The built CLI frontend will stop being permanently "runtime plugin blind".

It will:

- enable the existing runtime plugin event/import path
- connect to plugin events
- import plugin front modules through the new CLI-owned module-loading mechanism
- register panels/commands/resolvers through the existing hot-reload bridge

### 5. Runtime plugin diagnostics

The CLI should expose enough diagnostics to debug why a plugin did not render.

At minimum we should be able to inspect:

- discovered plugin id/root/front entry
- resolved frontend target
- current server-side plugin revision
- latest server load error
- latest browser import/register error
- whether the browser requested the front URL
- whether transform succeeded
- whether registration succeeded

This does not require a huge new UI, but the stock CLI should provide at least a compact runtime-plugin status surface or plugin-inspector-style debug view for loaded, failed, stale, and previously-good revisions.

---

## What this does NOT mean

This plan does **not** ship "most of v2".

It ships a **thin vertical slice**:

- runtime plugin discovery already exists
- Pi resource wiring already exists
- browser runtime import path already exists in workspace hot-reload code
- this plan only fills the missing packaged-CLI gap between:
  - discovered plugin front source on disk
  - browser-importable transformed module in the packaged CLI

### Put differently

This plan is mostly:

1. give packaged CLI a browser module loader for runtime plugin fronts
2. make workspaces mode expose the same plugin events path as folder mode
3. turn on the already-existing browser-side runtime plugin import/register path

### This plan does NOT include the big v2 areas

Not included:

- hosted iframe runtime
- sandbox tool execution
- runtime RPC
- stable artifact publishing
- dynamic provider/binding mounting
- trust-policy finalization
- marketplace/install lifecycle
- full HMR/live-dev architecture

So yes, this uses a **core idea** from v2, but it is **not a big part of v2**. It is a narrow local-CLI frontend-loading slice.

---

## The shape of the final system

## Component diagram

```txt
┌─────────────────────────────────────────────────────────────────┐
│                         Packaged boring-ui CLI                  │
├─────────────────────────────────────────────────────────────────┤
│ Fastify server                                                  │
│                                                                 │
│  1. workspace/agent routes                                      │
│  2. /api/v1/agent-plugins           -> plugin list state        │
│  3. /api/v1/agent-plugins/events    -> plugin load/unload SSE   │
│  4. CLI-owned plugin module loader  -> transformed front module │
│  5. /api/v1/agent/reload            -> reload boundary          │
│                                                                 │
│                  ┌──────────────────────────────┐               │
│                  │ BoringPluginAssetManager     │               │
│                  │ - loaded plugin state        │               │
│                  │ - revisions                  │               │
│                  │ - load/unload/error events   │               │
│                  └──────────────────────────────┘               │
│                                                                 │
│                  ┌──────────────────────────────┐               │
│                  │ PluginFrontRuntimeHost       │               │
│                  │ - CLI-owned module loading   │               │
│                  │ - Vite-backed transforms     │               │
│                  │ - singleton enforcement      │               │
│                  │ - path containment checks    │               │
│                  └──────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ EventSource + import()
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Stock CLI browser app                      │
├─────────────────────────────────────────────────────────────────┤
│ WorkspaceAgentFront                                             │
│  └─ useAgentPluginHotReload()                                   │
│      - connect to /api/v1/agent-plugins/events                  │
│      - receive plugin load events                               │
│      - import plugin front module from host-owned frontTarget   │
│      - atomically register plugin panels/commands/resolvers     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Future-proofing: why this paves the way for full v2

This plan is safe for the broader runtime-plugin v2 roadmap only if we keep one central rule:

> **the local native frontend loader is a mode-specific implementation behind a generic seam**

That means:

- this plan implements the **local trusted-native frontend target only**
- it must **not** redefine the universal plugin frontend architecture
- CLI-owned native module loading is one implementation of a broader frontend-target concept
- hosted / Vercel-sandbox modes must remain free to use a different frontend target later, such as iframe/artifact loading

### The seam we are protecting

The shared runtime-plugin layers should stay shaped like:

```txt
plugin discovery state
+ plugin events/revisions
+ frontend target resolution seam
+ mode-specific frontend target implementation
```

not like:

```txt
plugin discovery state
+ plugin events/revisions
+ hardcoded forever-native frontend loading
```

**Locked direction:** make this seam at least a **small explicit one now**, not purely conceptual.

Conceptually something like:

```ts
resolvePluginFrontTarget(plugin) => {
  kind: "native"
  entryUrl: string
  revision: string
  trust: "local-trusted-native"
}
```

Future modes should be able to return different target kinds later, for example:

```ts
resolvePluginFrontTarget(plugin) => {
  kind: "iframe"
  iframeUrl: string
  revision: string
}
```

```ts
resolvePluginFrontTarget(plugin) => {
  kind: "artifact"
  artifactId: string
  revision: string
}
```

This slice still only implements the `native` case, but the seam should be shaped so future modes can later return other target kinds.

### What this means in practice

1. **Shared discovery stays runtime-agnostic**
  - `BoringPluginAssetManager`
  - plugin events
  - plugin revisions
  - plugin metadata / Pi resources
2. **Frontend target resolution stays a seam**
  - local CLI can resolve to a native browser-module target now
  - hosted/sandbox can later resolve to iframe/artifact targets
3. **CLI-owned Vite loading stays CLI-local**
  - embedded Vite is an implementation detail of local trusted-native mode
  - it must not become a requirement of generic workspace/plugin runtime code
4. `**/reload` remains mode-agnostic**
  - the registry refresh boundary stays the same across modes
  - only the frontend target implementation differs by mode

### Why this matters

If we keep that seam, this work becomes:

- the **local native target implementation** for runtime-plugin v2

instead of accidentally becoming:

- the final plugin frontend model for all runtimes

That is what makes this slice pave the way for the full v2 roadmap instead of boxing us into a local-only architecture.

---

## The key runtime rule

### One pipeline for both first load and `/reload`

We are **not** building two registration systems.

We are **not** doing this:

- boot path A: fetch plugin list and manually register once
- reload path B: SSE + dynamic import later

We **are** doing this:

```txt
same pipeline for first load and reload

server has current plugin state
        ↓
browser connects to SSE
        ↓
server replays current loaded plugin events
        ↓
browser imports each plugin front module from host-owned frontTarget
        ↓
browser validates/imports the new module successfully
        ↓
browser atomically replaces previous plugin outputs
```

Failure rule:

- a failed import must not unregister the previous good plugin revision
- a failed register must not unregister the previous good plugin revision
- the frontend should surface the failed revision as degraded/error state
- the system should distinguish the latest server-loaded revision from the latest browser-successfully-registered revision

That keeps the implementation aligned with runtime-plugin v2.

---

## Why `/reload` still matters

`/reload` remains the **only runtime-plugin registry refresh boundary**.

That means:

- editing plugin files does **not** directly change runtime registration
- Vite/HMR must **not** silently add/remove/re-register runtime plugins
- SSE connect/reconnect must **not** perform a hidden rescan
- only boot/initialization and explicit `/reload` can mutate plugin-manager state

### Important distinction

The embedded Vite layer is only a:

- **frontend source transform / browser-module loading mechanism**

It is **not** the source of truth for plugin discovery or registration.

---

## What exact components will be added or changed

## A. New CLI component: `PluginFrontRuntimeHost`

Think of this as:

> "the small thing that lets the browser ask the CLI for a plugin module"

not as:

> "a giant new plugin server subsystem"

Likely new file:

- `packages/cli/src/server/pluginFrontRuntime.ts`

### This component will do

1. boot one shared embedded Vite-backed transform host
2. expose a CLI-owned browser-module loading entrypoint for plugin front modules
3. look up the plugin from current loaded plugin state
4. resolve the plugin's normalized native front entry
5. validate requested file paths stay inside allowed plugin roots
6. transform TS/TSX/CSS into browser-loadable ESM
7. enforce singleton resolution for React + host runtime modules
8. cache transformed modules by workspaceId + pluginId + revision + normalized path
9. invalidate only affected plugin revision caches on `/reload`
10. bound transform concurrency so first-load spikes do not fan out unbounded work
11. remove SSE listeners on disconnect
12. dispose workspace/plugin module state when a workspace is evicted or replaced
13. close the embedded Vite server during CLI shutdown

### This component will not do

- discover plugins
- decide which plugins are active
- reload plugin registry on file change
- replace `/reload`
- implement hosted iframe mode
- define the final public CLI flag/runtime-policy story

---

## B. New seam: host-owned frontend target

Today shared scanning effectively produces:

```ts
frontUrl: `/@fs/${frontPath}`
```

For packaged CLI mode, we need composition-level override so the final frontend target becomes something the CLI can actually hand to the browser through its own module-loading mechanism.

### Important design choice

Do **not** make the shared scanner globally CLI-aware.

**Locked seam direction:** put the frontend-target override at the **asset-manager option** layer.

Conceptually:

```ts
new BoringPluginAssetManager({
  pluginDirs,
  frontTargetResolver(plugin) {
    return { kind: "native", entryUrl, revision, trust }
  }
})
```

Why this layer wins:

- scanner stays generic and filesystem-focused
- asset manager still owns loaded plugin records/events/list entries
- CLI injects the local browser-module target policy cleanly
- folder mode and workspaces mode can share one seam

So the layering should be:

- scanner discovers plugin facts
- asset manager owns runtime plugin state
- CLI supplies frontend target strategy through an asset-manager seam

---

## C. New workspaces-mode SSE route

Workspaces mode must gain:

- `GET /api/v1/agent-plugins/events`

### Exact behavior

On connect:

1. resolve active workspace from header/query
2. get the request-scoped plugin manager
3. replay the **already-loaded** current plugin state
4. subscribe to future plugin load/unload/error events

### Event contract

- every event includes `workspaceId`, `pluginId`, `revision`, `eventType`, and `frontTarget`
- replay events are marked `replay: true`
- live events are marked `replay: false`
- the frontend ignores events for non-active workspaces
- the frontend ignores stale revisions lower than the currently registered revision
- duplicate events for the same workspace/plugin/revision are treated as idempotent

### Critical rule

This route must **not** call `manager.load()` on every connect/reconnect.

Why:

- `manager.load()` is a mutating rescan
- if SSE connect calls it, reconnect becomes a hidden refresh path
- that would violate the locked `/reload` boundary rule

So workspaces mode also needs an **ensure-loaded / initialize-once** path outside SSE connect.

**Locked direction:** do this at **plugin-manager creation time** for a workspace.

That means:

- the first code path that creates a workspace's plugin manager also performs its initial load
- after that, SSE connect is replay/subscribe only
- later plugin mutations still happen only through explicit `/reload`

---

## D. Stock CLI frontend wiring

Main file:

- `packages/cli/src/front/App.tsx`

### What changes

The stock CLI frontend will:

- stop hard-disabling runtime plugin loading
- use `frontPluginHotReload="vite"` when native frontend loading is enabled
- keep static `plugins` empty for runtime plugins
- rely on SSE + dynamic import path for runtime plugins

### Why this matters

We do **not** want static imports for runtime plugin frontends.

Runtime plugins must stay:

- discovered at runtime
- imported by URL at runtime
- replayable on first load
- swappable on `/reload`

---

## Folder mode vs workspaces mode

## Folder mode

```txt
boring-ui /path/to/project
```

### What exists

- workspace server composition already exists
- plugin events already exist there

### What gets added

- CLI-owned host frontend URLs
- runtime plugin front module serving
- stock CLI frontend opt-in to runtime plugin loading

### Flow

```txt
workspace server boots
  ↓
plugin manager loads plugins
  ↓
plugin list entries contain host-owned frontTarget
  ↓
browser connects to /api/v1/agent-plugins/events
  ↓
current plugins replay
  ↓
browser imports host-owned module URLs
  ↓
plugin UI renders
```

## Workspaces mode

```txt
boring-ui workspaces
```

### What exists

- request-scoped plugin list route
- request-scoped plugin error route
- request-scoped Pi snapshot wiring

### What gets added

- request-scoped SSE events route
- request-scoped host-owned frontTarget generation
- ensure-loaded path outside SSE connect
- reload integration so plugin manager participates in `/api/v1/agent/reload`

### Flow

```txt
select workspace A
  ↓
CLI resolves workspace A plugin manager
  ↓
manager created + initial load runs once
  ↓
browser connects to /api/v1/agent-plugins/events with workspace id
  ↓
current plugins for workspace A replay
  ↓
browser imports host-owned module URLs for workspace A only
  ↓
plugin UI renders
```

---

## Request/response flow diagrams

## First page load

```txt
Browser                                    CLI Server
-------                                    ----------
load app shell          ───────────────▶   serve built SPA
connect EventSource     ───────────────▶   /api/v1/agent-plugins/events
                                           resolve workspace / manager
                                           replay current loaded plugin events
plugin load event       ◀───────────────   { id, revision, frontTarget, replay }
dynamic import(frontTarget.entryUrl) ───▶  /api/v1/agent-plugins/runtime/<workspace>/<plugin>/<revision>/<subpath>
                                           validate workspace/plugin/revision/subpath
                                           Vite-backed transform
browser-loadable ESM    ◀───────────────   return module
register plugin outputs locally
plugin UI appears
```

## Reload

```txt
Browser / chat UI                            CLI Server
-----------------                            ----------
POST /api/v1/agent/reload   ─────────────▶   reload route
                                              plugin manager load()/refresh
                                              emit new revisions/events
reload response             ◀─────────────   standard reload contract
SSE plugin load event       ◀─────────────   { id, revision+1, frontTarget, ... }
dynamic import(frontTarget.entryUrl) ───▶    runtime module host
new module                  ◀─────────────   transformed module
atomic replaceByPluginId()
updated plugin UI appears
```

---

## Singleton rule

Hot-loaded runtime plugins must share the host singleton module graph for at least:

- `react`
- `react-dom`
- `react/jsx-runtime`
- `react/jsx-dev-runtime`
- the documented boring workspace/plugin runtime surface

### Browser dependency rule

- plugin front modules may only import browser-compatible code
- Node built-ins are rejected unless explicitly shimmed by the host
- host runtime packages are resolved to host singletons
- duplicate React/runtime copies are hard errors, not warnings
- unsupported imports should produce structured plugin import errors shown in the UI

### Why

If the plugin gets a second React copy, hooks/context break.

So the runtime asset host must ensure plugin imports resolve back to the host runtime, using aliasing/externalization/shims as needed.

### Test requirement

We need a test that proves:

- plugin panels render with host hooks/context intact
- no second React/context copy is instantiated

---

## Trust/loading state for the stock CLI UI

This slice should expose explicit frontend state through workspace meta.

Locked frontend meta shape:

```ts
{
  runtimePluginFrontLoadingEnabled: boolean
  runtimePluginTrustLabel?: string
  runtimePluginTrustDescription?: string
  runtimePluginDiagnosticsEnabled?: boolean
}
```

Why these names win:

- they are explicitly frontend-scoped
- they avoid accidental broader runtime-policy meaning
- they match the narrow scope of this slice

The UI needs:

- one boolean saying native runtime plugin frontend loading is active
- text for the local trusted-native trust banner/status

This plan does **not** settle the final CLI flag contract.
It only makes frontend loading state explicit.

---

## Optional agent-package seam

Locked preferred approach:

- keep workspaces-mode reload integration **CLI-owned first**

Allowed fallback only if truly needed:

- add a **minimal** seam in `@hachej/boring-agent/server`
- only if the CLI-owned wrapper cannot preserve the standard `/api/v1/agent/reload` contract cleanly
- no broader agent/runtime redesign

If used, it must stay aligned with runtime-plugin v2 and preserve the current reload wire contract used by the chat UI.

---

## What this plan explicitly does NOT build

- hosted iframe runtime
- sandbox tool execution model
- runtime plugin RPC
- stable frontend artifacts
- full HMR authoring workflow redesign
- dynamic provider/binding mounting
- final `--no-plugin-dev` semantics

### Output-surface boundary for this slice

This slice supports runtime-loaded plugin outputs for:

- panels (pane content / screen/component to open)
- commands
- catalogs
- surface resolvers

This slice does **not** promise dynamic runtime mounting for:

- providers
- bindings

Reason:

- panels are the intended primary surface for generated/runtime plugins in the current v2 direction
- providers/bindings imply broader app-tree recomposition and pull in much more of the full v2 runtime architecture

### About `--no-plugin-dev`

This plan **defers** the exact meaning of that flag.

Reason:

- broader runtime docs still contain different provisional wordings
- this follow-up should not accidentally settle global runtime-policy semantics

Authoritative rule for this slice:

> build native frontend loading first; defer final CLI flag semantics to the broader reload-v2/runtime-policy follow-up.

---

## Concrete implementation steps

### Step 1 — build runtime frontend host

Add `pluginFrontRuntime.ts` that:

- owns embedded Vite lifecycle in middleware mode
- owns the CLI-side browser module-loading mechanism
- validates plugin/file containment before handing requests to Vite
- rejects symlink escapes after realpath normalization
- rejects dotfiles, env files, lockfiles, package-manager metadata, and other non-front/private files unless explicitly allowed
- uses Vite to transform plugin front modules
- enforces singleton resolution
- caches transformed modules per workspace/plugin/revision/path
- exposes timing diagnostics for transform and module-load phases

### Step 2 — add frontend-target seam

Add an **asset-manager option seam** so CLI composition can produce host-owned frontend targets instead of raw `/@fs/...`.

### Step 3 — wire folder mode

Folder mode should:

- use the new frontend host
- publish host-owned frontend target
- expose frontend-loading/trust state in meta

### Step 4 — wire workspaces mode

Workspaces mode should:

- publish host-owned frontend target
- add `/api/v1/agent-plugins/events`
- replay current loaded state without rescanning on connect
- ensure initial plugin load happens when the workspace plugin manager is created
- integrate plugin manager into `/api/v1/agent/reload` with a CLI-owned wrapper first

### Step 5 — enable stock CLI frontend path

`packages/cli/src/front/App.tsx` should:

- enable runtime plugin event/import path
- use `frontPluginHotReload="vite"`
- render trust/loading state from meta

### Step 6 — test the real packaged behavior

Prove all of this works in the built CLI, not only in a Vite dev playground.

---

## File targets

Likely files:

- `packages/cli/src/server/cli.ts`
- `packages/cli/src/server/pluginDiscovery.ts`
- `packages/cli/src/server/pluginFrontRuntime.ts` **new**
- `packages/cli/src/front/App.tsx`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/workspace/src/server/agentPlugins/routes.ts` or nearby shared seam
- `packages/workspace/src/server/agentPlugins/manager.ts` or nearby loaded-plugin lookup seam
- `packages/agent/src/server/registerAgentRoutes.ts` **only if** minimal reload seam is needed

Avoid broad scanner rewrite if possible:

- `packages/workspace/src/server/agentPlugins/scan.ts`

---

## Testing plan

## Unit

- asset path containment rejects traversal/escape
- symlink escapes are rejected after realpath normalization
- disallowed dotfiles/env files/lockfiles/package-manager metadata are rejected
- host-owned frontend-target generation is deterministic and revision-addressed
- native front-entry normalization works for current local shape
- singleton resolution prevents second React/context copy
- unsupported browser-unsafe imports produce structured errors
- frontend-loading/trust metadata is exposed consistently

## Integration

### Folder mode

- plugin list uses host-owned frontend target
- events route replays current plugins
- browser import succeeds against transformed module URL

### Workspaces mode

- plugin list uses host-owned frontend target
- events route replays current plugins
- first SSE connect works without prior GET
- SSE reconnect does not trigger hidden refresh outside `/reload`
- reload bumps revision and emits SSE updates
- reload preserves existing response contract
- workspace-local plugins stay scoped to the active workspace
- global plugins appear in all workspaces
- workspace switching while imports are inflight does not register stale plugins into the new active workspace
- duplicate replay/live events do not produce duplicate panels/commands/catalogs/resolvers

## Browser/runtime behavior

- built CLI renders discovered plugin UI on first page load
- `/reload` updates plugin UI through the same SSE path
- failed import keeps previous good version
- failed register keeps previous good version
- trust banner/status renders when frontend loading is enabled
- runtime plugin panels use host React/context singletons cleanly
- reload during an inflight import produces one final registered revision
- disposing a workspace removes its event listeners and plugin runtime state

---

## Acceptance criteria

### Folder mode

- packaged `boring-ui /path` renders discovered native `boring.front` plugins on first page load
- plugin `frontTarget.entryUrl` is browser-loadable in the packaged CLI and revision-addressed
- `/reload` remains the only runtime plugin refresh boundary
- failed runtime front import keeps previous good version
- failed runtime front register keeps previous good version
- local trust banner/status is shown when frontend loading is enabled

### Workspaces mode

- packaged `boring-ui workspaces` renders discovered native `boring.front` plugins for the active workspace on first page load
- switching workspaces changes the effective workspace-local plugin set
- plugin events stay request-scoped by workspace id
- first page load works from SSE replay without separate bootstrap registration
- `/reload` drives plugin-manager refresh and SSE updates in workspaces mode
- switching workspaces while imports are inflight does not leak stale plugin registrations into the newly active workspace
- stale plugin revisions are ignored by the frontend
- duplicate replay/live events remain idempotent
- if a minimal agent seam is used, it preserves the standard reload contract

### Alignment criteria

- no one-off bootstrap registration path was introduced
- no raw `/@fs/<abs-path>.tsx` packaged CLI browser import remains for runtime plugins
- no hosted iframe/tool/RPC scope leaked into this change
- runtime plugin registration still changes only at boot replay or explicit `/reload`

---

## Open questions / decision menu

This section is intentionally written as a decision menu so we can lock answers quickly without re-thinking the whole plan.

### 1. How should the CLI hand browser plugin-module bytes?

**Decision:** use **embedded Vite middleware mode behind a CLI-owned module-loading seam**.

That means:

- parent Fastify server stays in control
- browser gets CLI-owned module URLs
- Vite is the internal transform engine
- raw Vite dev URLs are not the shipped browser contract

The alternatives below stay here only to explain the tradeoff space.

#### A. Mounted Vite middleware prefix

Example idea:

```txt
/plugin-runtime/...
```

Pros:

- closest to the runtime-plugin v2 "embedded Vite middleware" wording
- Vite handles TSX/CSS/dependency transforms naturally
- minimal custom transform glue

Cons:

- feels more like mounting a dev server
- needs careful containment and singleton config

#### B. Narrow Vite-backed transform endpoint

Example idea:

```txt
GET /api/v1/agent-plugins/runtime-module?... 
```

Pros:

- tighter and more explicit boundary
- easier to reason about request validation
- less dev-server feeling in the external shape

Cons:

- more custom glue for relative imports/CSS/deps

#### C. Hybrid

- Vite internally
- but exposed through a narrower CLI-owned module-loading layer

Pros:

- clean browser contract
- still reuses Vite machinery

Cons:

- a bit more plumbing

Recommended answer:

- **Choose C** as the target shape
- implementation may internally resemble A at first, but the shipped browser contract should stay CLI-owned

### 2. What exact browser URL contract should the native frontend target use?

**Decision:** use **A. Path-style URL**.

Canonical shape:

```txt
/api/v1/agent-plugins/runtime/<workspace>/<plugin>/<revision>/<subpath>
```

Why this wins:

- easiest to inspect/debug during local CLI development
- natural fit for module graphs and relative imports
- simplest contract for this local trusted-native slice
- revision-addressed URLs make dynamic import cache behavior deterministic

Tradeoff we accept:

- stricter path parsing and containment validation is required

The alternatives remain here only for context.

#### A. Path-style URL

Example:

```txt
/api/v1/agent-plugins/runtime/<workspace>/<plugin>/<subpath>
```

Pros:

- easy to inspect/debug
- natural for relative module graphs

Cons:

- needs careful path parsing and containment validation

#### B. Query-style URL

Example:

```txt
/api/v1/agent-plugins/runtime?workspace=...&plugin=...&path=front/index.tsx
```

Pros:

- simpler parser shape

Cons:

- uglier and not really safer by itself

#### C. Opaque token URL

Example:

```txt
/api/v1/agent-plugins/runtime/<token>
```

Pros:

- least filesystem-shaped external contract
- smallest traversal surface in the URL itself

Cons:

- more indirection and mapping logic
- harder to debug manually

### 3. Where should workspaces-mode `ensureLoadedOnce` happen?

**Decision:** use **A. At plugin-manager creation**.

Why this wins:

- smallest mental model
- SSE route stays replay/subscribe only
- avoids hidden initialization coupling to browser timing

Tradeoff we accept:

- plugin-manager creation becomes the one place that performs the initial load
- first touch pays load cost

The alternatives remain here only for context.

#### A. At plugin-manager creation

Pros:

- smallest mental model
- SSE route stays pure replay/subscribe

Cons:

- manager creation becomes mutating
- first touch pays load cost

#### B. At first non-SSE plugin route

Pros:

- avoids mutating during construction

Cons:

- easy to get wrong if first browser path is SSE
- needs extra coordination

#### C. At workspace activation/selection

Pros:

- maps to user workflow

Cons:

- more UI/server coupling

#### D. At server boot for all workspaces

Pros:

- everything is preloaded

Cons:

- wasteful and slower boot

### 4. Where should the frontend-target override seam live?

**Decision:** use **B. Asset-manager option**.

Example shape:

```ts
frontTargetResolver(plugin) => ({ kind: "native", entryUrl, revision, trust })
```

Why this wins:

- clean reusable seam
- keeps shared discovery runtime-agnostic
- avoids post-processing hacks in every CLI composition path
- keeps scanner free of browser/runtime-policy concerns

Tradeoff we accept:

- slightly larger asset-manager API

The alternatives remain here only for context.

#### A. CLI composition only

Pros:

- smallest blast radius

Cons:

- may be awkward to reuse across folder/workspaces mode

#### B. Asset-manager option

Example:

```ts
frontTargetResolver(plugin) => ({ kind: "native", entryUrl, revision, trust })
```

Pros:

- clean reusable seam
- still keeps shared discovery runtime-agnostic

Cons:

- slightly larger asset-manager API

#### C. Shared scanner option

Pros:

- direct

Cons:

- risks baking CLI concerns into shared layers

### 5. How should workspaces-mode reload integrate with agent reload?

**Decision:** use **A. CLI-owned wrapper route first**.

Why this wins:

- smallest scope
- CLI owns CLI-specific composition logic
- keeps agent package untouched unless clearly necessary

Tradeoff we accept:

- some route/reply logic may need to be mirrored carefully
- preserving the exact reload contract is now a first-class requirement

Fallback rule:

- only if the wrapper approach becomes awkward should we add a minimal agent seam

The alternatives remain here only for context.

#### A. CLI-owned wrapper route first

Pros:

- smallest scope
- CLI owns CLI-specific composition logic

Cons:

- may duplicate some route/reply logic

#### B. Minimal agent seam if needed

Example idea:

```ts
beforeReload?: async () => ...
```

Pros:

- cleaner preservation of the existing reload contract
- may be reusable for other compositions later

Cons:

- touches `@hachej/boring-agent`

### 6. What frontend meta fields should we expose?

**Decision:** use **A. Explicit frontend-scoped fields**.

Locked names:

```ts
runtimePluginFrontLoadingEnabled
runtimePluginTrustLabel
runtimePluginTrustDescription
```

Why this wins:

- very clear
- avoids accidental broader runtime-policy meaning
- keeps this plan scoped to frontend behavior

Tradeoff we accept:

- names are a bit verbose

The alternatives remain here only for context.

#### A. Explicit frontend-scoped fields

Example:

```ts
runtimePluginFrontLoadingEnabled
runtimePluginTrustLabel
runtimePluginTrustDescription
```

Pros:

- very clear
- avoids accidental broader runtime-policy meaning

Cons:

- verbose

#### B. Shorter generic fields

Example:

```ts
pluginDevEnabled
pluginTrustLabel
pluginTrustDescription
```

Pros:

- shorter

Cons:

- overloaded and politically ambiguous given other docs

### 7. How much plugin output surface should this slice support?

**Decision:** use **A. Panels / commands / catalogs / resolvers only**.

Here, panel means:

- **pane content / screen/component to open**

Why this wins:

- matches the current v2/plugin direction for generated/runtime plugins
- matches the current safe runtime hot-load path
- keeps this slice focused on pane-content loading, not app-tree recomposition

Tradeoff we accept:

- provider/binding-heavy plugins still will not fully work dynamically in this slice

The alternatives remain here only for context.

#### A. Panels / commands / catalogs / resolvers only

Pros:

- matches current safe runtime hot-load path
- keeps scope small

Cons:

- provider/binding-heavy plugins still won't fully work dynamically

#### B. Try providers/bindings too

Pros:

- more complete plugin coverage

Cons:

- much bigger scope and higher rendering risk

### 8. How explicit should the future-proof seam be?

**Decision:** use **B. Small explicit target-resolution seam now**.

Conceptual shape:

```ts
resolvePluginFrontTarget(plugin)
```

Why this wins:

- strongest path toward iframe/artifact modes later
- reduces risk of implementation drifting into forever-native assumptions
- keeps the future-proofing seam real without building a giant framework now

Tradeoff we accept:

- small abstraction cost now

Constraint:

- keep this seam minimal; this slice still implements only the `native` frontend target

The alternatives remain here only for context.

#### A. Conceptual seam only

Pros:

- least abstraction now

Cons:

- easier for implementation drift later

#### B. Small explicit target-resolution seam now

Example idea:

```ts
resolvePluginFrontTarget(plugin)
```

Pros:

- strongest path toward iframe/artifact modes later

Cons:

- some abstraction cost now

### 9. What validation model should module requests use?

**Decision:** use **A. Path-style request with strict containment checks**.

Required flow:

```txt
extract workspace id + plugin id + revision + requested subpath
→ look up loaded plugin record
→ reject invalid ids / absolute paths / null bytes / obvious escapes
→ verify requested revision matches the loaded/replayed revision being imported
→ resolve requested subpath against plugin root
→ verify containment
→ verify allowed subtree (front/shared only as applicable)
→ reject symlink escapes after realpath normalization
→ reject dotfiles, env files, lockfiles, package-manager metadata, and other non-front/private files unless explicitly allowed
→ reject arbitrary absolute imports from plugin source
→ allow only documented browser-safe import patterns
→ only then hand off to Vite for transform
```

This is the cost of choosing a debuggable path-style browser contract.

#### A. Path-style request with strict containment checks

Flow:

```txt
extract plugin id
→ look up loaded plugin record
→ resolve requested subpath against plugin root
→ verify containment + allowed subtree
```

Pros:

- straightforward and debuggable
- enough if implemented carefully

Cons:

- easier to get wrong if validation is sloppy

#### B. Opaque token mapping

Pros:

- safer by design

Cons:

- more machinery and indirection

### 10. How much should land together?

**Decision:** use **A. Folder mode + workspaces mode in the same implementation pass**.

Why this wins:

- avoids split-brain behavior
- gives consistent shipped UX
- keeps the packaged CLI story coherent when this lands

Tradeoff we accept:

- bigger diff

Constraint:

- if the implementation unexpectedly balloons, we can still split the coding work internally, but the planned shipped behavior stays end-to-end for both modes

The alternatives remain here only for context.

#### A. Folder mode + workspaces mode in same implementation pass

Pros:

- avoids split-brain behavior
- gives consistent shipped UX

Cons:

- bigger diff

#### B. Folder mode first, workspaces mode immediately after

Pros:

- smaller chunks

Cons:

- temporary inconsistency

---

## Recommended commit split

1. `feat(cli): add native runtime plugin front asset host`
2. `feat(workspace): add front-url override seam for runtime plugins`
3. `feat(cli): enable runtime plugin SSE loading in stock app`
4. `test(cli): cover built native plugin front loading`

---

## Success definition

This follow-up is done when the stock packaged CLI can:

1. discover plugins from Pi roots
2. expose their Pi resources to the agent
3. hand the browser a CLI-owned module-loading path for plugin fronts
4. render their native `boring.front` UI on first page load
5. refresh that UI only through the existing `/reload` + plugin-event pipeline