# Runtime Plugin Trust Modes Plan — Multi-model Review Synthesis

Reviewed plan: `docs/runtime-plugin-trust-modes-plan.md`

Models consulted:

- xAI Grok 4.3 (`/tmp/runtime_plugin_plan_review_xai_grok.md`)
- Claude Opus 4.7 (`/tmp/runtime_plugin_plan_review_opus.md`)
- GPT-5.5 via OpenRouter (`/tmp/runtime_plugin_plan_review_gpt55.md`)

Notes:

- Direct OpenAI GPT-5.5 call hit quota; GPT-5.5 feedback was obtained through OpenRouter.
- Claude CLI session limit was hit; Opus feedback was obtained through the Anthropic API.

## High-level consensus

All three reviewers agreed with the core thesis:

> Local CLI plugins should be trusted/native for developer experience; hosted external plugins should be iframe/sandboxed and must not execute untrusted code in the host backend process.

The strongest consensus improvements were:

1. Make trust mode multi-dimensional, not a single enum.
2. Add non-negotiable security invariants.
3. Add explicit plugin lifecycle states and health/diagnostics.
4. Harden iframe isolation with a versioned bridge, nonce/capability tokens, target-origin checks, CSP, and preferably per-plugin origins.
5. Replace generic stringly RPC with manifest-declared, schema-validated operations.
6. Harden sandbox proxy tools: no shell strings, structured command argv, timeout/cancellation/concurrency/output limits, env policy.
7. Add plugin provenance/identity/lockfile before marketplace work.
8. Keep local CLI plugin-dev explicit or at least very visible.

## Model-specific highlights

### xAI Grok 4.3

Main recommendations:

- Introduce a `PluginHost` abstraction so trust/policy/lifecycle/telemetry are not scattered.
- Add structured capability tokens and attestation.
- Replace generic RPC endpoint with typed capability-gated bridge calls.
- Add plugin lifecycle hooks and hot-reload semantics for sandboxed plugins.
- Use a dedicated worker and structured cloning for iframe bridge.

Most useful idea: `PluginHost` abstraction. This is a good architectural seam:

```ts
interface PluginHost {
  load(plugin: PluginManifest): Promise<LoadedPlugin>
  reload(pluginId: string): Promise<PluginReloadResult>
  unload(pluginId: string): Promise<void>
  executeTool(pluginId: string, tool: string, args: unknown): Promise<ToolResult>
  getHealth(pluginId: string): PluginHealth
}
```

### Claude Opus 4.7

Main recommendations:

- Replace binary `trusted-native | sandboxed-iframe` with orthogonal axes:
  - provenance
  - frontend runtime
  - backend execution
  - capability grant model
- Make iframe bridge a versioned capability-token protocol, not a method allowlist.
- Use per-plugin origin + SRI/CSP, not just `sandbox="allow-scripts"`.
- Improve sandbox tool framing beyond one-shot stdout JSON; at minimum define strict framing and output caps.
- Add content-addressed plugin store and signed manifests before marketplace.
- Make `/reload` structured and add plugin health surface.
- Decide local CLI should be opt-in `--plugin-dev` with auto-detect hint.
- Phase esbuild endpoint in parallel with Vite, not much later.

Most useful idea: orthogonal runtime axes. This avoids hiding important security decisions behind one enum.

### GPT-5.5

Main recommendations:

- Add non-negotiable invariants.
- Split trust into source, frontend execution, backend execution, and capability grants.
- Add manifest versioning, plugin identity, install lockfile, provenance.
- Replace coarse permissions with scoped, revocable grants.
- Make local native plugin-dev explicitly consented and lifecycle-managed.
- Harden iframe execution with dedicated origin, MessageChannel handshake, CSP, targetOrigin checks.
- Decide hosted bundling direction now: bundle in sandbox, serve immutable artifacts from host.
- Harden sandbox tools: no shell strings, namespaced ids, cancellation, concurrency, env policy.
- Make RPC declarative/schema-driven.
- Add lifecycle states: install, enable, disable, quarantine, uninstall, revoke.
- Add auditing, diagnostics, malicious plugin tests, and plugin management UI/trust badges.

Most useful idea: hosted frontend assets should be built in the sandbox and served as immutable content-addressed artifacts by the host.

## Recommended plan revisions

### 1. Add hard invariants near the top

Add a section like:

```md
## Non-negotiable invariants

1. Host policy, not plugin manifest, determines effective runtime mode.
2. Hosted external plugin executable code is never imported into the host backend process.
3. Hosted external frontend code never runs in the host React tree by default.
4. Host-process routes are only available to internal/promoted app plugins at boot.
5. Hosted external tools are host-registered proxies whose implementation executes inside sandbox.
6. All iframe bridge/RPC/tool calls are schema-validated, permission-checked, audited, and bounded.
7. Promotion to internal plugin is deploy-time/admin-controlled and requires pinned provenance.
```

### 2. Replace single policy enum with orthogonal axes

Instead of only:

```ts
type ExternalPluginPolicy = "trusted-native" | "sandboxed-iframe" | "reject"
```

Use:

```ts
type PluginProvenance = "internal" | "local-generated" | "marketplace" | "uploaded"
type FrontRuntime = "native" | "iframe" | "disabled"
type ToolRuntime = "host" | "sandbox-proxy" | "disabled"
type ServerRuntime = "host-boot" | "disabled"

type CapabilityGrantMode = "implicit-local" | "prompted" | "admin-approved" | "disabled"

interface EffectivePluginRuntime {
  provenance: PluginProvenance
  front: FrontRuntime
  tools: ToolRuntime
  server: ServerRuntime
  grants: CapabilityGrantMode
  reason: string
}
```

Keep the simple host presets (`trusted-native`, `sandboxed-iframe`) as shorthand only.

### 3. Add `PluginHost` abstraction

Introduce an implementation seam:

- `NativeTrustedPluginHost`
- `IframeSandboxPluginHost`
- `InternalBootPluginHost`

This prevents scanning, routing, bridge, reload, and telemetry code from each inventing policy checks.

### 4. Make iframe bridge protocol explicit

Bridge should use:

- `MessageChannel`, not ambient loose `window.postMessage` listeners where possible.
- protocol version
- plugin id
- frame id/session id
- nonce/capability token minted by host
- request/response ids
- schema validation on every call
- explicit `targetOrigin`

Example envelope:

```ts
interface PluginBridgeEnvelope<T = unknown> {
  v: 1
  pluginId: string
  frameId: string
  requestId: string
  capabilityToken: string
  op: string
  payload: T
}
```

### 5. Replace generic RPC with declarative operations

Avoid:

```json
{ "method": "summarizeCsv", "params": {...} }
```

Prefer manifest-declared operations:

```json
{
  "boring": {
    "rpc": [
      {
        "op": "csv.summarize",
        "inputSchema": {...},
        "outputSchema": {...},
        "command": ["node", ".pi/extensions/csv-pro/rpc/summarize.js"],
        "permissions": ["files:read"]
      }
    ]
  }
}
```

### 6. Harden sandbox tool manifest

Replace shell command strings:

```json
"command": "node .pi/extensions/csv-pro/tools/summarize.js"
```

with argv arrays and explicit execution metadata:

```json
{
  "command": ["node", ".pi/extensions/csv-pro/tools/summarize.js"],
  "cwd": ".",
  "timeoutMs": 30000,
  "concurrency": 2,
  "permissions": ["files:read"],
  "env": {}
}
```

Add cancellation and output caps to the contract.

### 7. Add lifecycle states

Add plugin state machine:

```ts
type PluginLifecycleState =
  | "discovered"
  | "installed"
  | "enabled"
  | "disabled"
  | "error"
  | "quarantined"
  | "revoked"
  | "uninstalled"
```

This supports marketplace install, permission revocation, broken reloads, and malicious plugin quarantine.

### 8. Add provenance and lockfile

Before marketplace, add:

```txt
.pi/plugins.lock.json
```

Track:

- package/plugin id
- version
- source URL/registry
- integrity hash
- installed revision
- effective runtime mode
- permissions granted
- promotion status

### 9. Hosted artifact model

For hosted iframe plugin fronts, prefer:

1. build/bundle inside sandbox
2. produce immutable artifact by content hash
3. host serves artifact bytes without executing plugin build output
4. iframe URL includes content hash/revision

This preserves isolation and gives cacheability.

### 10. Adjust phase order

Recommended revised phase order:

1. contracts, invariants, effective-runtime axes
2. policy resolver + plugin lifecycle/health model
3. local CLI plugin-dev transform
4. iframe bridge protocol + sandbox artifact model
5. sandbox proxy tools
6. declarative RPC
7. marketplace install/provenance/lockfile
8. promotion/admin workflows

## Disagreements / things not to adopt immediately

- Do not require signed marketplace manifests before local CLI plugin-dev. That would slow the local UX path.
- Do not replace the first command-tool MVP with full MCP immediately. MCP is likely good later, but command proxy is the right smaller step.
- Do not require iframe for all local generated plugins. The main product goal is local plugins feeling internal.
- Do not overbuild capability tokens before the first iframe bridge, but design the protocol envelope so tokens fit naturally.

## Bottom line

The original plan is directionally correct. The biggest improvement is to make it less binary and more enforceable:

- trust is not one enum; it is provenance + frontend runtime + tool runtime + server runtime + grants
- hosted external code never imports into host process
- iframe bridge and sandbox tools must be typed, versioned, bounded, and auditable
- plugin lifecycle/provenance must exist before marketplace
- local CLI plugin-dev stays powerful, but explicit and visible
