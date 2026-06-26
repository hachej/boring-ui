# 01 — Runtime-free `@hachej/boring-agent`

## Goal

Make `@hachej/boring-agent` a model/session/tool harness that can run with no filesystem and no sandbox.

A pure agent must be valid for Slack/email/support/concierge/research workflows where the only state is session history plus app-owned tools.

## Current blocker

The agent server composition still assumes a runtime bundle and imports runtime mode resolution. File/bash/upload tools and file routes are registered by agent server paths.

This creates two bugs in the architecture:

1. `direct` means host filesystem, not no-runtime.
2. Any app wanting a headless agent has to fake a workspace/cwd or avoid the normal server composition.

## Dependency inversion first

Before moving providers to `@hachej/boring-bash`, invert composition:

- `createAgentApp()` and `registerAgentRoutes()` stop value-importing built-in runtime modes in the pure path.
- Host/CLI/core passes runtime/features in.
- `@hachej/boring-agent` exports only type contracts for features/tool registration.
- A package invariant test fails if agent has value imports from `@hachej/boring-bash`.
- Existing runtime mode support may remain as compatibility wiring only if it does not force a runtime bundle for pure agents.

This prevents the cycle:

```txt
bad: boring-agent -> boring-bash -> boring-agent
```

Target:

```txt
boring-core/full-app/cli compose boring-agent + optional boring-bash
boring-agent has no bash knowledge except type-level feature hooks
```

## Public core contracts

This must not become a second plugin registry. `AgentFeature` is a small composition façade over existing server/plugin seams (`WorkspaceServerPlugin`, tool contributors, route contributors, system prompt contributors, `registerCapabilitiesContributor`) so pure agents and non-workspace hosts can use the same concepts without importing workspace internals.

```ts
interface AgentEnvironment {
  sessionStorageRoot: string
  workspaceId?: string
  agentId?: string
  featureGrants?: Record<string, unknown>
}

interface AgentFeature {
  id: string
  tools?(ctx: AgentFeatureContext): AgentTool[] | Promise<AgentTool[]>
  systemPrompt?(ctx: AgentFeatureContext): string | undefined | Promise<string | undefined>
  readinessRequirements?: string[]
}

interface AgentServerFeature extends AgentFeature {
  routes?(ctx: AgentFeatureContext): FastifyPluginAsync | undefined
}

interface AgentFeatureContext {
  agentId: string
  workspaceId?: string
  environment: AgentEnvironment
  getGrant<T>(id: string): T | undefined
}
```

Rules:

- `routes` is server-only; no `Fastify` value/type leaks into shared/front packages.
- `featureGrants` must not be confused with current `AgentRuntimeCapabilities`.
- `sessionStorageRoot` is transcript/session storage, not workspace file storage.

## Pure runtime mode

Add a composition path equivalent to:

```ts
features: []
runtime: 'none'
```

It registers only:

- chat/session/model routes;
- session store routes;
- non-bash operational hooks explicitly configured by host;
- app-owned tools that do not require files or shell.

Pure mode must not build the harness with `process.cwd()` or any host workspace path. It must pass no cwd, or a sealed virtual root with no host files. This is stronger than "do not mention cwd in prompt"; the harness itself must not have ambient host file authority. Pure mode must also skip or relocate boot-time plugin discovery that currently receives a cwd, unless the host explicitly enables a non-bash plugin source.

It must not register:

- file/tree/search/fs-events/git routes;
- `read/write/edit/find/grep/ls`;
- `bash`;
- `execute_isolated_code`;
- upload/runtime artifact tools bound to a workspace;
- cwd, workspace path, or AGENTS.md context in the system prompt.

## Pi harness audit

`createPiCodingAgentHarness` must be audited before pure mode ships.

Questions to answer:

1. Can pi-coding-agent run with no cwd?
2. Does it auto-load AGENTS.md/CLAUDE.md/workspace resources?
3. Does it inject current directory, file tree, or file tool hints into the prompt?
4. Does compaction assume file tools exist?
5. Does session identity assume workspace root?

Outcome must be explicit:

- either pure mode uses pi with cwd/resource loading disabled and snapshot-tested;
- or pure mode uses a separate non-pi harness.

## Non-bash operational seams

Some open issues are agent/session problems, not bash problems. The agent core needs optional seams for them:

### External review/question hooks (#380)

Add a channel-neutral hook ingestion contract:

```ts
interface ExternalAgentHookRequest {
  source: {
    harnessId: string
    agentId?: string
    workspaceId?: string
    sessionId?: string
    provider?: string
  }
  kind: 'review' | 'question' | 'approval'
  body: unknown
  redactionPolicy?: string
  callback?: { url: string; authRef?: string }
}
```

Requirements:

- auth before accept;
- redaction before session write;
- clear source attribution;
- routing to correct workspace/agent/session;
- works without boring-bash.

### Operational event/command seam (#371, #228, #224)

Expose command/event hooks for reload, slash commands, compaction/provider recovery, and session operational notices without depending on bash.

Do not route these through `boring-bash`; they are agent/session concerns.

## Feature/tool readiness

The agent core should know readiness keys only as opaque gates. Concrete runtime readiness is supplied by features.

Preserve existing `mergeTools({ checkReadiness })` behavior. Do not replace it with a parallel tool catalog.

## Tests

Required tests for this area:

- pure agent starts without workspace/sandbox/runtime bundle;
- no file/bash/upload routes are registered in pure mode;
- no file/bash/upload tools appear in catalog;
- harness construction receives no host cwd/path, or receives a sealed virtual root with no host files;
- system prompt snapshot has no cwd/workspace/AGENTS.md leakage;
- pi pure-mode audit result is encoded in tests;
- external hook accepts/renders/rejects with auth/redaction rules;
- operational command seam works without boring-bash;
- import invariant: `@hachej/boring-agent` has no value import from `@hachej/boring-bash`.

## Acceptance

This area is done when an app can instantiate a useful conversational agent with app-owned tools, durable sessions, and no host file authority anywhere in the request path.
