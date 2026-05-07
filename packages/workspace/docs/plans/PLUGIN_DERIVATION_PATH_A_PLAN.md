# Boring Plugins — Path A: Derivation

**Last updated:** 2026-05-07  
**Status:** Draft — split from HOT_RELOADABLE_AGENT_PLUGINS_PLAN.md

---

## What is Path A?

An inside plugin can declare `"derivesFrom": "<base-plugin-id>"` in its manifest. This signals that it is a **derived plugin** — it builds on an existing plugin (inside or outside) by adding contributions on top without replacing the base.

**Key properties:**
- Base plugin stays active and is unaware of the derived plugin
- Derived plugin is **purely additive** — it adds panels, commands, left tabs, surface resolvers on top of base
- Agent tools in `agent/index.ts` are always allowed (come from pi's extension mechanism, not gatable at boring-ui level)
- When derived plugin unloads, base becomes fully active again (shadow lifted)

---

## Use cases

| Use case | Example |
|---|---|
| Specialised view | CSV plugin derives from macro — adds a "CSV Editor" panel that replaces the generic text editor for `.csv` surfaces |
| Language mode | Python plugin derives from code-editor — overrides surface resolver for `.py` files |
| Customer override | Enterprise customer overrides base analytics dashboard panel with their own branding |
| A/B experiment | Experimental UI replaces a panel for a subset of users while base remains the default |

---

## `extensionContract`

Each outside plugin (and registered inside plugin) that allows derivation declares an extension contract. This lives in the plugin registration at bootstrap time for outside plugins, or is derived from the manifest for inside plugins.

```ts
interface ExtensionContract {
  allowedContributions: Array<"panel" | "panelCommand" | "leftTab" | "surfaceResolver">
}
```

Agent tools (`registerTool` in `agent/index.ts`) are **always allowed** for derived plugins — they flow through pi's extension mechanism, not boring-ui's UI registry.

If a base plugin has no `extensionContract`, it does not allow derivation. Deriving from it is a hard manifest validation failure: `DERIVES_FROM_NON_EXTENSIBLE`.

---

## Surface resolver LIFO stack

Surface resolvers are the primary mechanism derived plugins use to shadow base behavior. The stack is per `surfaceKind`. Entries are tagged with `(pluginId, revision)` for unload targeting.

```
Bootstrap:
  outside-a registers csv.open → [outside-a:csv.open]
  outside-b registers csv.open → [outside-a:csv.open, outside-b:csv.open]
  active resolver for csv.open → outside-b (LIFO)

Inside plugin load:
  derived-a registers csv.open → [..., derived-a:csv.open]
  active → derived-a

  derived-b registers csv.open → [..., derived-a:csv.open, derived-b:csv.open]
  active → derived-b

Unload:
  derived-b unloads → [..., derived-a:csv.open]   active → derived-a
  derived-a unloads → [outside-a:csv.open, outside-b:csv.open]   active → outside-b
```

Outside plugin entries are pushed at bootstrap and never pop during the session. Inside plugin entries push on load and pop on unload (including on `/boring.reload`).

---

## Manifest declaration

```json
{
  "boring": {
    "front": "./front/index.tsx",
    "agent": "./agent/index.ts",
    "label": "CSV Viewer",
    "derivesFrom": "macro",
    "panels":          [{ "id": "csv-panel",   "title": "CSV Viewer" }],
    "surfaceResolvers":[{ "id": "csv-open",    "surfaceKind": "csv.open", "panelId": "csv-panel" }]
  }
}
```

- `"derivesFrom"` must be a valid plugin id (inside or outside)
- Base plugin must be loaded and must have an `extensionContract`
- `"derivesFrom"` is resolved at load time; missing base = `DERIVES_FROM_MISSING` hard failure

---

## `BoringPackageField` additions

```ts
interface BoringPackageField {
  // ... existing fields ...
  derivesFrom?: string  // plugin id of base plugin
}
```

Base plugin registration (outside plugin, at bootstrap):
```ts
interface RegisteredOutsidePlugin {
  id: string
  extensionContract?: ExtensionContract  // undefined = not extensible
}
```

---

## Validation

### Manifest validation (parse-time, in `readBoringPackage`)

- `derivesFrom` value must pass `isValidBoringPluginId` format check
- Error code: `INVALID_DERIVES_FROM` (format check only)

### Load-time validation (in `loadBoringPlugins` / `registerAgentPlugin`)

- Base plugin with id = `derivesFrom` must be registered
  - Error: `DERIVES_FROM_MISSING`
- Base plugin must have `extensionContract`
  - Error: `DERIVES_FROM_NON_EXTENSIBLE`
- All declared contributions must be in `extensionContract.allowedContributions`
  - Error: `CONTRIBUTION_NOT_ALLOWED`

### V1 runtime validation (in `registerAgentPlugin`, post-factory)

After `front/index.tsx` runs and registrations are captured:
- Every contribution type registered must be allowed by `extensionContract`
  - Error: `CONTRIBUTION_NOT_ALLOWED` → rollback browser state, toast

### V2 manifest-only validation (in `registerAgentPlugin`, pre-registration)

- Check `boring.panels[]`, `boring.commands[]`, `boring.leftTabs[]`, `boring.surfaceResolvers[]` against `extensionContract.allowedContributions`
- Error: `CONTRIBUTION_NOT_ALLOWED` → discard SSE event, toast

---

## Error codes

```ts
type DerivationErrorCode =
  | "INVALID_DERIVES_FROM"       // bad format
  | "DERIVES_FROM_MISSING"       // base plugin not loaded
  | "DERIVES_FROM_NON_EXTENSIBLE" // base has no extensionContract
  | "CONTRIBUTION_NOT_ALLOWED"   // contribution type not in allowedContributions
```

---

## `agentPluginRegistry.ts` — derivation state

```ts
// Set at bootstrap from outside plugin registrations
const extensionContracts = new Map<string, ExtensionContract>()

// Set when an inside plugin loads successfully with derivesFrom
const derivedFrom = new Map<string, string>()  // pluginId → basePluginId

function getExtensionContract(baseId: string): ExtensionContract | undefined {
  return extensionContracts.get(baseId)
}

function validateDerivation(
  pluginId: string,
  manifest: BoringPackageField,
  capturedContributions: Array<"panel" | "panelCommand" | "leftTab" | "surfaceResolver">
): DerivationError | null {
  if (!manifest.derivesFrom) return null
  const contract = extensionContracts.get(manifest.derivesFrom)
  if (!contract) return { code: "DERIVES_FROM_MISSING" }
  const disallowed = capturedContributions.filter(c => !contract.allowedContributions.includes(c))
  if (disallowed.length) return { code: "CONTRIBUTION_NOT_ALLOWED", contributions: disallowed }
  return null
}
```

---

## Outside plugin `extensionContract` registration

Outside plugins declare their extension contract in `defineFrontPlugin` or `composePlugins`:

```ts
// Outside plugin — app developer declares this
export const macroPlugin = defineFrontPlugin({
  id: "macro",
  extensionContract: {
    allowedContributions: ["panel", "panelCommand", "surfaceResolver"]
  },
  // ... rest of plugin
})
```

At `bootstrap()` time, `agentPluginRegistry.ts` collects all outside plugin `extensionContract` values.

---

## Resolver stack implementation

```ts
// Resolver stack entry
interface ResolverEntry {
  pluginId: string
  revision: number        // for targeted unload
  kind: string            // surfaceKind
  resolve: (ctx: unknown) => { panelId: string } | null
}

// Stack per surfaceKind; last entry is active
const resolverStacks = new Map<string, ResolverEntry[]>()

function pushResolver(entry: ResolverEntry): void {
  const stack = resolverStacks.get(entry.kind) ?? []
  resolverStacks.set(entry.kind, [...stack, entry])
}

function popResolversForPlugin(pluginId: string): void {
  for (const [kind, stack] of resolverStacks) {
    resolverStacks.set(kind, stack.filter(e => e.pluginId !== pluginId))
  }
}

function resolveKind(kind: string, ctx: unknown): { panelId: string } | null {
  const stack = resolverStacks.get(kind) ?? []
  for (let i = stack.length - 1; i >= 0; i--) {
    const result = stack[i].resolve(ctx)
    if (result) return result
  }
  return null
}
```

---

## Agent authoring flow

Agent writes a derived plugin in 3 steps:

```
1. write front/index.tsx   — register contributions allowed by extensionContract
2. write package.json      — set "derivesFrom": "<baseId>"
3. /boring.reload           — validates derivation, loads plugin
```

If derivation fails validation, SSE `boring.plugin.error` fires and agent reads `.error` file.

Agent can discover base plugin's `extensionContract` via:
- `GET /api/agent-plugins` — returns `extensionContract` for each registered plugin
- `.boring/docs/plugins.md` — documents which outside plugins are extensible and what they allow

---

## `GET /api/agent-plugins` response shape

```ts
type AgentPluginsResponse = {
  plugins: Array<{
    id: string
    tier: "outside" | "inside"
    boring: BoringPackageField
    version: string
    revision: number
    extensionContract?: ExtensionContract   // present if extensible
  }>
}
```

---

## Implementation TODOs

### A — Outside plugin `extensionContract`

- [ ] Add `extensionContract?: ExtensionContract` to `PluginOutput` / `WorkspaceFrontPlugin` definition
- [ ] `defineFrontPlugin` and `composePlugins` pass-through `extensionContract`
- [ ] `bootstrap()` collects and registers `extensionContracts` in `agentPluginRegistry.ts`
- [ ] `GET /api/agent-plugins` includes `extensionContract` for outside plugins (and for inside plugins that declare one)

### B — Manifest validation additions

- [ ] `readBoringPackage`: validate `derivesFrom` format (`isValidBoringPluginId`)
- [ ] Error code: `INVALID_DERIVES_FROM`

### C — Load-time derivation validation

- [ ] `agentPluginRegistry.ts`: `validateDerivation()` function
- [ ] `registerAgentPlugin` V1: call `validateDerivation` post-factory; rollback on failure
- [ ] `registerAgentPlugin` V2: call `validateDerivation` against manifest arrays; discard on failure
- [ ] Error codes: `DERIVES_FROM_MISSING`, `DERIVES_FROM_NON_EXTENSIBLE`, `CONTRIBUTION_NOT_ALLOWED`

### D — Resolver LIFO stack

- [ ] `resolverStacks: Map<surfaceKind, ResolverEntry[]>` in resolver store
- [ ] `pushResolver(entry)` — append
- [ ] `popResolversForPlugin(pluginId)` — filter by pluginId; called on unload
- [ ] `resolveKind(kind, ctx)` — LIFO scan
- [ ] Bootstrap: outside plugin resolvers seeded at `bootstrap()` time (base layer, never pop)
- [ ] Inside plugin resolvers: push on successful `registerAgentPlugin`, pop on unload

### E — Agent docs

- [ ] `plugins.md` section: "Deriving from a plugin" — how to use `derivesFrom`, what `extensionContract` means, error codes
- [ ] `plugins.md` section: "Extensible outside plugins" — list outside plugins that have `extensionContract` and what they allow
- [ ] `GET /api/agent-plugins` includes `extensionContract` so agent can inspect at runtime

---

## Out of Scope

- Derived plugins that extend other derived plugins (chain derivation) — hard load failure: `DERIVES_FROM_INSIDE_PLUGIN` for now
- Runtime negotiation of `allowedContributions` expansion — base plugin declares statically
- `host.query()` bridge for V2 derived plugins — deferred until full postMessage bridge lands
- Derivation of outside plugins from inside plugins — outside plugins are app-dev authored, inside are agent-authored; direction is always inside derives from outside (or another inside with explicit chain allowance)
