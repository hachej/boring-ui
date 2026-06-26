---
github: https://github.com/hachej/boring-ui/issues/12
issue: 12
state: queued
phase: plan
track: owner
flag: not-needed
updated: 2026-06-26
---

# Pi Decoupling Plan

Status: draft  
Branch: `pi-decoupling`  
Scope: `packages/agent`

## Goal

Make `@boring/agent` harness-pluggable without removing the default Pi implementation.
Pi remains the batteries-included default, but LangChain, DeepAgents, or any other
agent runtime can be mounted behind the same Boring chat/workspace surface.

## Current State

Boring already has good public seams:

- `shared/harness.ts` defines `AgentHarness`.
- `shared/tool.ts` defines `AgentTool`.
- Chat routes consume only `AgentHarness.sendMessage()` and AI SDK `UIMessageChunk`s.
- Workspace/sandbox/tool construction is mostly independent of the harness loop.

But the server factories are Pi-first:

- `createAgentApp()` directly calls `createPiCodingAgentHarness()`.
- `registerAgentRoutes()` directly calls `createPiCodingAgentHarness()`.
- Standard tools are sourced from Pi tool-definition factories.
- `modelsRoutes` and `skillsRoutes` are Pi-specific.
- Pi plugin loading and Pi resource loading live on the default path.

## Desired Architecture

```txt
Boring HTTP/UI/workspace
        ↓
AgentHarness interface
        ↓
Pi harness | LangChain harness | DeepAgents harness | custom host harness
```

Pi becomes one provider, not the architectural center.

## Non-goals

- Do not remove Pi.
- Do not rewrite the workspace/sandbox adapters.
- Do not require LangChain or DeepAgents as core dependencies in v1.
- Do not degrade the current Pi CLI/default app path.

## Work Plan

### Phase 1 — Harness factory injection

Add a factory seam to app construction:

```ts
harnessFactory?: (ctx: {
  tools: AgentTool[]
  workspaceRoot: string
  runtimeBundle: RuntimeBundle
  sessionId: string
  resourceLoaderOptions?: PiResourceLoaderOptions
  systemPromptAppend?: string
}) => AgentHarness | Promise<AgentHarness>
```

Use it in:

- `packages/agent/src/server/createAgentApp.ts`
- `packages/agent/src/server/registerAgentRoutes.ts`

Default remains Pi:

```ts
const harness = opts.harnessFactory
  ? await opts.harnessFactory(ctx)
  : createPiCodingAgentHarness(piCtx)
```

Acceptance:

- Existing tests keep passing with default Pi path.
- New tests prove a fake harness can be injected into both server factory paths.

### Phase 2 — Provider metadata and optional routes

Separate Pi-only support routes from generic harness routes.

Options:

```ts
modelProvider?: AgentModelProvider
skillProvider?: AgentSkillProvider
```

or simple route gates:

```ts
registerModelRoutes?: boolean | ModelRouteProvider
registerSkillRoutes?: boolean | SkillRouteProvider
```

Acceptance:

- Pi default still registers `/api/v1/models` and `/api/v1/skills`.
- Custom harness can opt out or provide replacement implementations.
- Generic chat/files/session routes do not import Pi.

### Phase 3 — Tool catalog decoupling

Keep `AgentTool` as the universal tool type. Move Pi standard-tool construction
behind a named provider:

```ts
createPiStandardTools(runtimeBundle): AgentTool[]
```

Future providers can either:

- consume Boring `AgentTool[]` directly, or
- adapt Boring tools into LangChain/DeepAgents native tools.

Acceptance:

- Pi tool factories are localized to `server/tools/pi-*` or equivalent.
- No public API requires Pi `ToolDefinition`.

### Phase 4 — Prototype DeepAgents adapter

Add experimental adapter outside default dependency path:

```txt
packages/agent/src/server/harness/deepagents/
```

Adapter responsibilities:

- Convert `AgentTool[]` to DeepAgents/LangChain tools.
- Convert DeepAgents stream events to AI SDK `UIMessageChunk`s.
- Implement a minimal `SessionStore`.
- Propagate file-change metadata from Boring tools.

Acceptance:

- Basic text streaming works.
- Tool calls render in existing chat UI.
- Read/write/edit tools operate against the same workspace/sandbox bundle.

### Phase 5 — Contract tests

Create harness conformance tests using a fake harness and adapter fixtures:

- emits text chunks
- emits tool input/output chunks
- handles abort signal
- persists/list/loads sessions through `SessionStore`
- optional `followUp()` behavior is clearly documented

Acceptance:

- Pi harness passes conformance.
- Fake harness passes conformance.
- DeepAgents prototype passes at least basic chat/tool tests.

## Open Questions

1. Should non-Pi adapters live in `@boring/agent` or separate packages like
   `@boring/agent-langchain`?
2. Should model/skill routes become generic provider interfaces or stay Pi-only
   optional routes?
3. Should default standard tools continue to use Pi factories, or should we port
   them into Boring-owned implementations long term?
4. How much of Pi plugin loading should be exposed to non-Pi harnesses?

## Recommended First Beads

1. Add `harnessFactory` to `createAgentApp()`.
2. Add `harnessFactory` to `registerAgentRoutes()`.
3. Add fake-harness injection tests.
4. Gate model/skills routes behind provider options.
5. Add a DeepAgents research/prototype bead.
