> **Scope status (2026-07-17): retained architecture; outside the current #391
> static critical path.** Decision 25 supersedes only conflicting AgentHost/D1/
> controller/CAS/revision/publication ordering. Implementation requires a current
> consumer-backed tracker and approved plan.

# 04 — Plugins, hosted runtimes, and child apps

## Goal

Make plugins and child apps declare runtime needs safely, while allowing one full-app deployment to host multiple product shells such as generic Seneca and Macro.

## Child-app target (#376)

One deployment/runtime/auth/Postgres DB/global billing service can serve multiple child apps selected by:

- hostname;
- workspace kind;
- trusted plugins;
- prompts;
- provisioning requirements;
- frontend shell/branding.

Macro-specific tools/prompts/provisioning must not leak into generic workspaces.

## Relationship to shared child-app platform plan

The product/registry/billing/workspace-kind design is owned by [`docs/issues/376/plan.md`](../../../376/plan.md) (issue #376).

This plan only consumes the resolved child-app context for bash/runtime intersection. It must not define a competing `ChildAppDefinition`, workspace-kind schema, billing model, or hostname registry.

Effective authority uses the same algebra as architecture 03:

```txt
maximumAuthority =
  providerFacts
  ∩ host/app policy
  ∩ resolved childApp/workspaceKind policy
  ∩ workspace policy
  ∩ deployment policy

activeAuthority =
  maximumAuthority
  ∩ authenticated grants
  ∩ session/subagent scope

validate plugin/tool requirements(activeAuthority)
```

The resolved child-app policy can narrow the maximum. Requirements never grant
or narrow authority; a missing active capability fails readiness/activation.

Inputs consumed from the child-app plan:

- `childAppId`;
- `workspaceKind`;
- resolved default agent set;
- resolved default/trusted plugins;
- resolved bash/provisioning requirements.

Billing/product ids remain core-owned data and are out of scope for `boring-bash`.

## Plugin manifest requirements

Validation must be import-free and must extend the existing trusted-plugin manifest model (`boring.front`, `boring.server`, hosted iframe fields, plugin system scan), not introduce a second manifest reader.

```jsonc
{
  "boring": {
    "front": "front/index.tsx",
    "server": "server/index.ts",
    "requires": ["boring-bash"]
  },
  "bash": {
    "capabilities": { "fs": "readwrite", "exec": true },
    "nodePackages": [{ "id": "my-cli", "packageName": "my-cli" }],
    "python": [{ "id": "my-sdk", "projectFile": "sdk/pyproject.toml" }],
    "services": [{ "id": "studio", "command": "pnpm studio", "ports": [{ "port": 3000, "purpose": "iframe" }] }]
  }
}
```

Rules:

- validate `boring.requires` and `bash` before executing plugin code;
- fail closed when required features are missing;
- optional requirements degrade with diagnostics;
- remote modes reject unsupported trust tiers;
- frontend-only viewers can request readonly fs without exec;
- shell/service requirements must be explicit.

## First-party plugin dogfooding

First-party `@hachej/boring-bash` ships through the same plugin door as trusted internal plugins. Its package declares the normal `boring.server` and `boring.front` entries; the server entry returns `defineServerPlugin({ agentTools, routes, systemPrompt, piPackages, provisioning })` and the front entry returns `definePlugin(...)` for the file tree/panes. Workspace-family hosts register the package as an internal/default plugin and let the manifest/entry resolver import it dynamically. There is no special static workspace-to-bash import, no bespoke route mount, no hand-appended prompt fragment, and no separate tool-spreading path for these hosts.

The workspace can host several first-party plugins with a mechanism/policy split. `boring-bash` is the multi-fs mechanism: the `@hachej/boring-bash` package owns contracts, enforcement, no-leak projection operations, tools/routes/tree, and the plugin only delivers that mechanism. `boring-governance` (the #475 line, extracted as `plugins/boring-governance` in PR #532, rolled up in #544) is multi-fs policy: YAML governance, `company_context` bootstrap/mount, budgets, and admin UI. Governance depends on `@hachej/boring-bash/shared` **and value-imports the `/server` mechanism exports** (projection operations, `ScopedFilesystemRuntimeBindingManager`, `COMPANY_CONTEXT_FILESYSTEM_ID`); bash enforces the bindings governance resolves. The invariants that hold are: **governance never imports `@hachej/boring-workspace` or workspace internals**, and **bash never imports governance**.

**Amendment (2026-07-08):** D2 shared subdomain tenancy resolves governance
policy per tenant (`SessionCtx.workspaceId` / `governancePolicyRef`) and includes
that resolution in tenant-isolation conformance. An unknown `governancePolicyRef`
fails closed and never falls back to another tenant's policy.

**Amendment (2026-07-08):** `governancePolicyRef` may also deny plugins an
agent or tenant is allowed to load. Plugin denial is governance-gated and
fail-closed; a denied plugin contributes no tools, skills, MCP servers, routes,
or UI panels for that agent.

Reserve plugin-to-plugin composition as a host-mediated seam, not a package import. The boring-bash server plugin exposes a named `bindingResolver` composition point; the governance plugin or host config fulfills it through the host plugin pipeline, following the existing `defineServerPlugin` mediation pattern for bridge handlers and provisioning. If the resolver is absent, bash falls back only to host/library-mode config or no governed bindings; it must not discover governance by importing it.

## MCP consume composition (`boring-mcp`)

`plugins/boring-mcp` is a normal plugin consumer of MCP tools. MCP-backed tools flow through the standard plugin agent-tool seam; they are not a side channel in agent core. Current repo reality: `plugins/boring-mcp/src/server/agentTools.ts:27-40` creates `AgentTool[]` by mapping `listBoringMcpAgentBridgeTools(...)`; `plugins/boring-mcp/src/server/agentBridge.ts:20-28` lists the seven stable bridge/catalog tool names and `agentBridge.ts:230-248` builds/list them. That proves the seam is already "plugin returns agent tools"; the dynamic MCP consume work extends this same seam.

Generated direct MCP tools are named `mcp__<server>__<tool>`, where `<server>` is the stable MCP source/server id and `<tool>` is the provider tool name normalized by the boring-mcp policy layer. Collisions with ordinary tools are structurally impossible because the `mcp__` namespace is reserved for boring-mcp generated tools, and collisions between MCP servers are impossible because the server id is part of the tool name. The seven stable bridge/catalog tools may stay as management tools; provider-native MCP tools use the namespaced form.

Each MCP server connection is also a readiness requirement gating its generated tools (for example `mcp:<sourceId>`), using the same `mergeTools({ checkReadiness })` / `wrapToolForReadiness` mechanism that gates `workspace-fs`. A disconnected or unhealthy MCP source means its generated tools are present only behind a not-ready result, never silently callable.

Dynamic MCP tool prompt presence rides the existing dynamic prompt seam. Current code reality: `createPiCodingAgentHarness` accepts `systemPromptDynamic` in `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:341-345`, appends it through Pi's `before_agent_start` extension in `createHarness.ts:145-152`, and `registerAgentRoutes` can pass a per-request dynamic source in `packages/agent/src/server/registerAgentRoutes.ts:676-679`. boring-mcp should publish the connected, ready MCP tool index through that seam so prompt-visible tool availability matches the currently generated tool set.

## Hosted external plugins (#357)

Hosted iframe plugin mode is intentionally constrained:

- no host React/plugin factory execution;
- no plugin backend code;
- no host route access;
- no generic filesystem access;
- constrained iframe sandbox/CSP;
- diagnostics bridge only.

The new abstraction must preserve this fail-closed posture.

Remote-hosted plugins may declare:

- readonly file visibility;
- iframe panels;
- capability diagnostics.

They may not get bash/server/tools unless promoted to a trusted plugin tier by host policy.

## Runtime plugin RPC

Do not add a competing route family. Keep:

- `/api/v1/plugins/:pluginId/*`;
- runtime backend gateway;
- workspace plugin runtime manager;
- `WorkspaceBridge`.

Add feature context. **The P6a (child-app-independent) shape carries NO `childAppId`/`workspaceKind`** — those are P6b fields (see the P6b follow-up below), and P6a is grep-gated to contain neither:

```ts
// P6a — child-app-independent (grep-gated: no childAppId / workspaceKind)
interface RuntimePluginContext {
  pluginId: string
  workspaceId?: string
  availableFeatures: {
    bash?: BashEnvironmentSummary
    uiBridge?: boolean
    secrets?: Record<string, 'missing' | 'granted' | 'denied' | 'expired'>
    services?: Record<string, 'not-started' | 'starting' | 'ready' | 'failed'>
  }
}
```

### P6b follow-up — child-app scoping fields (outside the epic exit)

When the shared child-app platform type (`ResolvedChildAppContext`, #376) lands, **P6b** extends `RuntimePluginContext` with the resolved child-app scope. These fields are **not** part of the P6a shape above and must not be added before P6b is unblocked:

```ts
// P6b — added only when ResolvedChildAppContext (#376) lands (HARD BLOCKED)
interface RuntimePluginContext {
  // …P6a fields…
  childAppId?: string
  workspaceKind?: string
}
```

## Shared per-workspace plugin runtime (#254)

This plan should compose with a shared per-workspace plugin runtime:

- manager;
- backend registry;
- reload;
- Pi/plugin snapshots;
- dispose;
- multi-tenant route resolver.

Do not duplicate plugin runtime maps in CLI/full-app/workspace modes.

## Hot reload in full-app (#41)

Multi-tenant reload must resolve per-request:

- workspace;
- agent binding;
- plugin runtime;
- beforeReload hook;
- asset manager.

The new runtime-free agent composition should make this easier, not harder.

## Secrets (#181)

Plugin contexts receive secret status and explicit grants only.

No raw secrets in:

- browser plugin contexts;
- manifest files;
- logs;
- issue comments;
- model-visible prompts;
- provisioning plan artifacts.

## Managed service plugins (#328, #258)

Trusted plugins can request managed services through bash requirements.

Examples:

- Remotion Studio preview;
- browser-use runtime;
- local dev preview server.

Required lifecycle:

1. provision deps;
2. start process;
3. health check;
4. grant port/proxy/iframe if policy allows;
5. surface readiness to UI/tools;
6. teardown on workspace/plugin dispose.

## Macro hosted inside full-app

For a Macro child app:

- `childAppId = 'macro'`;
- workspace kind selects Macro default workspace behavior;
- Macro prompts/tools/provisioning are scoped to Macro workspaces;
- generic Seneca workspace does not see Macro requirements;
- billing remains core/global;
- `boring-bash` only receives the resolved policy/requirements.

## Tests

- import-free manifest validation before code execution;
- hosted plugin fail-closed in remote mode;
- child-app scoped default plugins/prompts/provisioning;
- Macro requirements do not leak into generic workspace;
- plugin requiring bash is skipped/diagnosed when bash disabled;
- plugin requiring secrets receives status only;
- trusted service plugin lifecycle works;
- runtime backend RPC still dispatches after bash extraction;
- full-app reload route resolves per workspace/agent/plugin runtime.
- declaring a requirement never grants its capability; a requirement absent
  from active authority fails readiness/activation.
