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

Before moving runtime-mode resolution to `@hachej/boring-bash` and concrete providers to `@hachej/boring-sandbox`, invert composition:

- `createAgentApp()` and `registerAgentRoutes()` stop value-importing built-in runtime modes in the pure path.
- Host/CLI/core passes runtime/features in.
- `@hachej/boring-agent` exports only type contracts for features/tool registration.
- A package invariant test fails if agent has value imports from `@hachej/boring-bash` or `@hachej/boring-sandbox`.
- Existing runtime mode support is migrated to host composition **in the same PR** (no long-lived compatibility wiring); a pure agent must never be forced to build a runtime bundle. Any temporary bridge carries a `// TODO(remove:<bead-id>)` marker naming its deletion-owner bead; a later owner is allowed only when explicitly named per `../INDEX.md`, and no marker outlives its named owner's phase.

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

**No `AgentFeature` abstraction.** There is exactly one prospective contributor (boring-bash), so a `features` registry is a speculative abstraction with a single consumer — forbidden by the no-abstraction-without-two-consumers policy. `createAgent()` config uses the **existing seams directly**: `tools` (extra `AgentTool[]`), `systemPromptAppend` / `systemPromptDynamic`, and readiness gates (`mergeTools({ checkReadiness })` + `registerCapabilitiesContributor`). A pure agent and a non-workspace host use these same seams without importing workspace internals — no new registry, no `AgentFeature`/`AgentFeatureContext` interface, no `features?: AgentFeature[]` config member.

Boring-bash contributes through those seams as a **plain bundle**, not a core contract: `createBashAgentFeature()` (defined in Phase 3, [`../work/P3-routes-tools/TODO.md`](../work/P3-routes-tools/TODO.md)) returns `{ tools, readinessRequirements }` — a boring-bash-local type — that the host **spreads into the `createAgent()` config** (`tools: [...hostTools, ...bashBundle.tools]`). The core never learns the word "feature".

```ts
interface AgentEnvironment {
  sessionStorageRoot: string
  workspaceId?: string
  agentId?: string
  // No `grants` escape hatch in the P1 config. Typed grant fields arrive in P5/P7,
  // where they are actually consumed (provisioning/secrets, multi-agent scoping) —
  // not as an opaque `Record<string, unknown>` here.
}
```

HTTP routes are owned by the HTTP adapter (`createAgentApp` / `registerAgentRoutes`), which imports and mounts a route module directly (e.g. `registerBashRoutes`) via **host composition** — never through the agent core and never through the bash bundle. The bundle carries tools + readiness only, no route metadata.

Rules:

- Routes are mounted by host composition, not by the core or the bundle. No `Fastify` value/type leaks into shared/front packages.
- `sessionStorageRoot` is transcript/session storage, not workspace file storage.

## Pure runtime mode

Add a composition path equivalent to:

```ts
runtime: 'none'
// no bash bundle spread into `tools`; only host/app-owned non-file tools, if any
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

- Pure mode uses the **sealed pi harness only** — pi with cwd/resource loading disabled and snapshot-tested — per the locked decision in `08-pluggable-agent-surfaces.md` (decision 2) and `00-global-isa.md` (open-decision 1). There is **no** separate non-pi harness option for Phase 1: if the audit shows pi cannot run with cwd disabled/sealed, **STOP and escalate** rather than introducing an alternative harness.

## Non-bash operational seams

Some open issues are agent/session problems, not bash problems. The agent core needs optional seams for them:

### External review/question hooks (#380) — deferred to Phase 7 (NOT P1 scope)

The external-hook request/callback/redaction contract is **not a Phase 1 deliverable**. External hooks depend on durable approvals (the single on-stream approval channel, T1) and on multi-agent target resolution, so the request shape, auth/redaction/callback contract, and target resolution all land in **Phase 7** (`../work/P7-multi-agent-inspection/TODO.md`, BBP7-006), routed onto the T1 approval channel — never a second channel. P1 adds **no** external-hook request/callback/redaction contract and **no** hook route.

### Operational event/command seam (#371, #228, #224)

Expose command/event hooks for reload, slash commands, compaction/provider recovery, and session operational notices without depending on bash.

Do not route these through `boring-bash`; they are agent/session concerns.

## Tool readiness

The agent core should know readiness keys only as opaque gates. Concrete runtime readiness is supplied by the injected tools/bundle (e.g. the boring-bash bundle's `readinessRequirements`), not by a feature registry.

Preserve existing `mergeTools({ checkReadiness })` behavior. Do not replace it with a parallel tool catalog.

## Tests

Required tests for this area:

- pure agent starts without workspace/sandbox/runtime bundle;
- no file/bash/upload routes are registered in pure mode;
- no file/bash/upload tools appear in catalog;
- harness construction receives no host cwd/path, or receives a sealed virtual root with no host files;
- system prompt snapshot has no cwd/workspace/AGENTS.md leakage;
- pi pure-mode audit result is encoded in tests;
- operational command seam works without boring-bash;
- import invariant: `@hachej/boring-agent` has no value import from `@hachej/boring-bash`.

## Acceptance

This area is done when an app can instantiate a useful conversational agent with app-owned tools, durable sessions, and no host file authority anywhere in the request path.
