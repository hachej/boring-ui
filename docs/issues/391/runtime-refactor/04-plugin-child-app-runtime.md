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

The product/registry/billing/workspace-kind design is owned by [`docs/plans/shared-child-app-platform.md`](../shared-child-app-platform.md) and issue #376.

This plan only consumes the resolved child-app context for bash/runtime intersection. It must not define a competing `ChildAppDefinition`, workspace-kind schema, billing model, or hostname registry.

Effective bash policy includes the resolved context:

```txt
app defaults < resolved childApp/workspaceKind policy < workspace policy < agent policy < session grants < plugin/tool requirements
```

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

Add feature context:

```ts
interface RuntimePluginContext {
  pluginId: string
  workspaceId?: string
  childAppId?: string
  workspaceKind?: string
  availableFeatures: {
    bash?: BashEnvironmentSummary
    uiBridge?: boolean
    secrets?: Record<string, 'missing' | 'granted' | 'denied' | 'expired'>
    services?: Record<string, 'not-started' | 'starting' | 'ready' | 'failed'>
  }
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
