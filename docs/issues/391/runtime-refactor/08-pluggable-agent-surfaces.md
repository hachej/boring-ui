# 08 — Pluggable agent surfaces: transport, event stream, channels

Status: v2 broadening of the plan pack. This file adds the layer the original pack stopped short of: `@hachej/boring-agent` as a **surface-agnostic agent** that mounts behind the boring-ui workspace (first-class UI), Slack, a spreadsheet add-in (pi-excel), the CLI, or any future interface — with `@hachej/boring-bash` as one optional, injected environment.

Inputs: current couplings audit (agent stack architecture map), #391 plan pack 00–07, shipped #416 filesystem-binding work, and framework analysis of Flue (`withastro/flue`), eve (`vercel/eve`), Vercel AI SDK v5/v6 transport + approvals, Claude Agent SDK, OpenAI Agents SDK, Slack Bolt AI apps.

## Intent

One agent definition, many surfaces. A surface is a **thin ingress/egress adapter** over the agent's event stream. A surface never owns the loop, never reimplements sessions, never sees provider internals.

Target mounts, in order of delivery:

1. **boring-ui workspace** — the existing first-class UI, refitted to consume only the public contract.
2. **Slack channel** — reference proof that a non-HTTP-UI, non-filesystem surface works.
3. **pi-excel / spreadsheet add-in** — reference proof that the agent embeds inside another product surface, with `runtime: none` or readonly `company_context` only.
4. CLI / cron / API — headless invocations of the same contract.

## What every framework converges on (adopted here)

A surface and the agent core exchange exactly four things:

1. **Message in** — a normalized user turn: `{ sessionRef, content, attachments?, actor }`. Core accepts a string or message parts; the surface does platform parsing (Slack signature + payload, Excel cell context, workspace composer state).
2. **Event stream out** — one ordered, indexed, replayable stream of typed events. Every surface renders the same stream differently; the wire/transport is swappable.
3. **Approvals / human-in-the-loop** — a request event out + a response call in, on the same channel, declared on the tool — not per-surface special cases.
4. **Session state** — a runtime-owned `sessionId` + serializable transcript. Persistence and addressing are boundary decisions.

Design rules imported:

- **Flue `SessionEnv`**: one universal environment interface; the core has no mode-specific branching. (Already the plan's spine — 02.)
- **Flue/eve events**: every event carries a monotonic `eventIndex` → durable, replayable, reconnectable streams (`startIndex` resume).
- **eve two-handles rule**: the **continuation/addressing handle is owned by the surface** (Slack thread `ts`, workbook+sheet id, workspace pane id); the **`sessionId`/stream handle is owned by the runtime**. Each surface keeps its own token-joiner/mapping; the runtime never learns platform addressing.
- **eve trust boundary**: tools execute on the trusted core side; the environment (bash/fs) is the untrusted side; credentials are injected at the environment boundary and never enter the sandbox or the model transcript.
- **Vercel AI SDK `ChatTransport`**: UI state and wire protocol are separate; `sendMessages` + `reconnectToStream` is the entire transport contract.
- **AI SDK v6 / eve HITL**: `needsApproval` declared on the tool; `tool-approval-request` / `input.requested` events park the turn durably; any surface holding the session can answer.

## Layering (v2 target)

```txt
Surfaces    workspace UI | Slack | pi-excel | CLI | cron/API      (ingress/egress only)
Transport   in-process | HTTP+SSE (existing) | future: WS/durable  (sendMessages + reconnect)
Agent core  createAgent(): model/session/tool loop, event stream,  (@hachej/boring-agent)
            approvals, readiness types — zero fs/bash/HTTP/React
Features    boring-bash (fs+exec env, file tools/routes/file UI),  (optional, injected)
            upload, web, ui-bridge (workspace-owned), plugins
Runtime     providers: direct | bwrap | vercel-sandbox |           (@hachej/boring-bash/providers)
            remote-worker | readonly | none
```

This preserves the 00-global-isa three-layer model and adds the two layers above it that make "pluggable" real.

## The headless façade: `createAgent()`

Today the only delivery of the harness is Fastify (`createAgentApp` / `registerAgentRoutes`). The real loop — `AgentHarness.sendMessage(input, ctx): AsyncIterable<UIMessageChunk>` — is already transport-agnostic. We export it properly instead of making every consumer mount routes:

```ts
import { createAgent } from '@hachej/boring-agent/server'

const agent = createAgent({
  harnessFactory,            // optional; default = pi-coding-agent harness
  runtime,                   // RuntimeModeAdapter | 'none'  (pure mode)
  features,                  // AgentFeature[] e.g. createBashAgentFeature(env)
  tools,                     // extra AgentTool[]
  sessions,                  // SessionStore (default: JSONL under sessionStorageRoot)
  systemPrompt, systemPromptDynamic,
  telemetry,
})

// The whole public runtime API:
agent.send(input, ctx): AsyncIterable<AgentEvent>   // one turn
agent.resolveInput(sessionId, requestId, response)  // approvals / questions
agent.sessions                                      // list/load/fork/delete
agent.replay(sessionId, { startIndex })             // reconnect/replay
agent.readiness                                     // per-requirement status
agent.dispose()
```

Rules:

- `createAgent()` has **no Fastify import, no env-var reads, no file-based config discovery**. Everything arrives as a typed config object. Discovery (`.pi/*`, workspaces.yaml, env) is host/CLI composition that *builds* the config.
- `createAgentApp()` / `registerAgentRoutes()` become **adapter #1 over `createAgent()`** — they keep working unchanged for every current consumer.
- The agent definition itself is a pure config object (Flue `defineAgent` / AI SDK `Agent` model). No transport, no persistence decisions, no UI inside it.

## Event stream contract

Do **not** replace the streaming protocol. The AI-SDK `UIMessageChunk` union is already the harness output and what `useChat` consumes. V1 wraps it in an envelope:

```ts
interface AgentEvent {
  v: 1
  eventIndex: number        // monotonic per session — replay/reconnect key
  timestamp: number
  sessionId: string
  chunk: UIMessageChunk     // existing AI-SDK part union (text/reasoning/tool/data-*)
}
```

- `eventIndex` + a persisted event log per session make the stream **replayable**: `agent.replay(sessionId, { startIndex })` and (HTTP adapter) `GET …/events?startIndex=N`. This is what lets Slack reconnect after a webhook retry and the workspace survive an SSE drop without protocol forks.
- Approvals ride the same stream as `data-approval-request` parts in v1, migrating to native AI-SDK `tool-approval-request/response` parts when we adopt the v6 line. Surface answers via `agent.resolveInput(...)` (in-process) or `POST …/input` (HTTP).
- Surface-specific projections are the adapter's job: workspace renders the full stream; Slack maps activity → `setStatus`, text deltas → `sayStream`, approval parts → buttons; Excel maps structured tool outputs → cell writes.

## Two handles (hard rule)

- `sessionId` — runtime-owned. Attaches to the stream, resumes, inspects, forks.
- Continuation/addressing — surface-owned. Slack thread `ts`, workbook id, workspace pane binding. Each surface maintains its own `addressing → sessionId` map (its own store or the host DB). Public agent APIs never accept platform addressing; they accept `sessionId` (or create one).

This keeps multi-tenant routing out of the core: `x-boring-workspace-id` is an HTTP-adapter concern that resolves to a `SessionCtx`, exactly as a Slack adapter resolves team+channel+thread to one.

## Human-in-the-loop

- `AgentTool` gains `needsApproval?: boolean | (params, ctx) => boolean | Promise<boolean>`. Policy lives with the tool/host, not the surface.
- When approval is needed (or the ask-user tool fires), the harness emits an approval/input-request event, persists the pending request, and parks the turn (`session.waiting`). Durable across process restarts once the session event log lands.
- Any surface holding the `sessionId` answers via `resolveInput`. A web modal, a Slack button, and an Excel task-pane dialog are the same protocol.
- Existing permission prompts and the ask-user plugin migrate onto this path; no second approval channel.

## Surface adapters

A surface adapter does three things (eve channel model): normalize input → `agent.send()`; subscribe/replay events → project to the platform; collect approval responses → `resolveInput`. It owns platform auth (Slack signing secret, Office add-in token) on the trusted side.

Reference adapters, each a separate optional package:

| Surface | Package (proposed) | Environment | Notes |
| --- | --- | --- | --- |
| Workspace UI | `@hachej/boring-agent/front` + `@hachej/boring-workspace` (existing) | full boring-bash | Refit to consume only the public contract; `ChatPanel`/`useAgentChat` unchanged externally. UI bridge (`exec_ui`/`get_ui_state`) stays workspace-owned `extraTools`. |
| Slack | `@hachej/boring-channel-slack` (new, `packages/channels/slack`) | `runtime: none` or readonly `company_context` | Raw signature verification (or Bolt); thread `ts` = continuation; feedback + approval blocks. |
| Spreadsheet (pi-excel) | plugin in the pi-excel repo consuming `@hachej/boring-agent` client contract | `none` / readonly bindings | Agent tools are spreadsheet tools (read/write range) supplied by the host as `tools`; boring-bash not installed. Proves the "agent as a library inside another product" story. |
| CLI/cron | existing hub + `createAgent()` direct | any | Headless `send()` + transcript out. |

Non-negotiable: no surface package imports provider internals or `boring-bash` server code; a surface depends on `@hachej/boring-agent` (client or server contract) only.

## Multi-filesystem contract intersection

The #416 binding model that already shipped in `packages/boring-bash` is the fs identity surface all of this rides on:

- Tools and routes address files as `(filesystem, path)` — landed for `company_context`.
- A Slack or Excel mount that exposes governed context does it by **injecting bindings** (`FilesystemBindingResolver`), not by having a cwd.
- Pure mode = no bindings, no env. Readonly mode = bindings without exec.

## Conformance (extends 07 and #12 harness conformance)

Executable contract suites, in-repo, run against every implementation:

1. **Harness conformance** (#12): text/tool chunks, abort, sessions, follow-up — plus new: event envelope ordering, replay-from-index, approval park/resume.
2. **Environment conformance** (02/#416): `SessionEnv`-style ops, path safety, readonly projection no-leak (exists: `readonlyProjectionConformance`), timeout+abort normalization implemented once in the adapter layer.
3. **Transport conformance**: `send` + `reconnect` semantics identical in-process and over HTTP.
4. **Surface adapter conformance**: message-in → events-out, approval round-trip, addressing→session mapping isolation (one surface cannot resolve another's continuation).

## Decisions this file locks (recommendations)

1. **Wire protocol**: keep AI-SDK `UIMessageChunk` as the v1 event payload, add the indexed envelope. Do not invent a parallel event union. Revisit only at the AI-SDK v6 migration.
2. **Pure mode** (#391 open decision 1): pi-coding-agent with `runtime: none` and sealed cwd, behind the Phase 1 audit — not a second harness. Epic #12 keeps pi as the batteries-included default; a non-pi harness remains a conformance-suite consumer, not a prerequisite.
3. **Surfaces live outside the agent package**: per-channel packages (Flue model), not subpaths of `boring-agent` (eve model) — matches the existing monorepo layout and keeps the core dependency-free.
4. **Readonly fs is v1**: already true — shipped via #416. The 00-global-isa open decision 6 is resolved.
5. **One namespace rule**: superseded by named `(filesystem, path)` bindings, as already reflected in the pack's V1 caveat.
