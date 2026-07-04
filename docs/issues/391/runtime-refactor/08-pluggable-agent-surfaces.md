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

### The steering surface

Surfaces are peers on the event contract, but they are not peers in the product (00 "North star"): the **boring-ui workspace is the control plane**. Concretely, the workspace is where you:

- author and configure agents (north star: eve-style agent-as-directory, deferred until `AgentRegistry` — Phase 6/7);
- wire channels and attach environments;
- observe any session regardless of which surface it runs on — the replayable event log (T1) makes cross-surface observation free: the workspace attaches to a Slack-born session by `sessionId` like any other;
- answer approvals centrally (same `resolveInput` path as every surface).

Mechanism, not hand-waving: Phase 7 delivers an **agent inspection endpoint** (`GET /api/v1/agents/:agentId/info` — model, tools, readiness, channels, environments; eve's `/eve/v1/info` analog) consumed by workspace panels. Steering = the workspace consuming the same public contracts, with more of them — never private hooks into the core.

## What every framework converges on (adopted here)

A surface and the agent core exchange exactly four things:

1. **Message in** — a normalized user turn: `AgentSendInput` = `{ sessionId?, content, attachments?, actor }` (**omit `sessionId` to create a new session**). Core accepts a string or message parts; the surface does platform parsing (Slack signature + payload, Excel cell context, workspace composer state).
2. **Event stream out** — one ordered, indexed, replayable stream of typed events. Every surface renders the same stream differently; the wire/transport is swappable.
3. **Approvals / human-in-the-loop** — a request event out + a response call in, on the same channel, declared on the tool — not per-surface special cases.
4. **Session state** — a runtime-owned `sessionId` + serializable transcript. Persistence and addressing are boundary decisions.

Design rules imported:

- **Flue `SessionEnv`**: one universal environment interface; the core has no mode-specific branching. (Already the plan's spine — 02.)
- **Flue/eve events**: every event carries a monotonic `eventIndex` → durable, replayable, reconnectable streams (`startIndex` resume).
- **eve two-handles rule**: the **continuation/addressing handle is owned by the surface** (Slack thread `ts`, workbook+sheet id, workspace pane id); the **`sessionId`/stream handle is owned by the runtime**. Each surface keeps its own token-joiner/mapping; the runtime never learns platform addressing.
- **eve trust boundary**: tools execute on the trusted core side; the environment (bash/fs) is the untrusted side; credentials are brokered on the trusted core side; environments receive only derived non-secret effects/status.
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

Today the only delivery of the harness is Fastify (`createAgentApp` / `registerAgentRoutes`). The real loop — the harness chat service (`HarnessPiChatService`, reached via `harness.getPiSessionAdapter`, streaming `PiChatEvent`s) — is already transport-agnostic; `agent.send()` wraps that verified seam (see `todos-v2/TODO-P1-headless-core.md` for the grounded signatures). We export it properly instead of making every consumer mount routes:

```ts
import { createAgent } from '@hachej/boring-agent/core'

const agent = createAgent({
  harnessFactory,            // optional; default = pi-coding-agent harness
  runtime,                   // RuntimeModeAdapter | 'none'  (pure mode)
  tools,                     // AgentTool[] — host spreads the boring-bash bundle in here:
                             //   tools: [...appTools, ...createBashAgentFeature(env).tools]
  readinessRequirements,     // opaque readiness gates (e.g. from the bash bundle)
  sessions,                  // SessionStore (default: JSONL under sessionStorageRoot)
  systemPrompt, systemPromptDynamic,
  telemetry,
})
// No `features` member and no `AgentFeature` abstraction — a single-consumer registry is
// forbidden. createBashAgentFeature() returns a plain { tools, readinessRequirements } bundle.

// The whole public runtime API — NINE members (two primitives + one convenience + control + inspection):
agent.start(input: AgentSendInput): Promise<{ sessionId, startIndex }>  // WRITE: accepted receipt (omit input.sessionId to start a new session)
agent.stream(sessionId, { startIndex }): AsyncIterable<AgentEvent>      // READ: replay-from-offset + live tail
agent.send(input: AgentSendInput): AsyncIterable<AgentEvent>            // convenience = start + stream (documented sugar, no new semantics)
agent.resolveInput(sessionId, requestId, response)  // approvals / questions
agent.interrupt(sessionId)                          // abort the current turn (turn-level stop)
agent.stop(sessionId)                               // end/close the session (session-level stop)
agent.sessions                                      // list/load/fork/delete
agent.readiness                                     // per-requirement status
agent.dispose()
```

Producer/consumer split (locked — this is the core write/read contract):

- `agent.start()` returns an **accepted receipt** the instant the turn is admitted. The turn then runs to completion on an **independent producer** that appends `AgentEvent`s to the `EventStreamStore` **regardless of whether any consumer is reading**. Producers are **never consumer-backpressured**.
- `agent.stream()` is the only read primitive — it replays from `startIndex` (offset) and then live-tails; it **replaces the separate `replay()`**. Cancelling a stream iterator **never cancels the turn**; it only stops that reader. `interrupt(sessionId)` — **abort the current turn** — is the **only** way to stop a running turn (`stop(sessionId)` ends/closes the whole session, not a single turn). The two mirror today's pi-chat routes: `interrupt` = turn abort, `stop` = session end.
- `agent.send()` exists **only** as documented convenience defined as `start()` then `stream()` from the returned `startIndex`; it introduces no semantics of its own.

Rules:

- `createAgent()` has **no Fastify import, no env-var reads, no file-based config discovery**. Everything arrives as a typed config object. Discovery (`.pi/*`, workspaces.yaml, env) is host/CLI composition that *builds* the config.
- `createAgentApp()` / `registerAgentRoutes()` become **adapter #1 over `createAgent()`** — they keep working unchanged for every current consumer.
- The agent definition itself is a pure config object (Flue `defineAgent` / AI SDK `Agent` model). No transport, no persistence decisions, no UI inside it.

## Event stream contract

Do **not** replace the streaming protocol. V1 wraps the existing harness stream unit — `PiChatEvent` (the pi chat event union the front already consumes; the repo already depends on `ai ^6`, so the deferred work is not an AI-SDK version bump but **migrating the `PiChatEvent` reducer/view-model to native `UIMessage`/tool-approval parts**) — in an envelope:

```ts
interface AgentEvent {
  v: 1
  eventIndex: number        // monotonic per session — replay/reconnect key (DS offset)
  timestamp: number
  sessionId: string
  chunk: PiChatEvent        // existing harness stream unit, unchanged
}
```

Reality note: a bespoke replay path already exists (`PiChatReplayBuffer` + `?cursor=` NDJSON in `piChat.ts`) — T1/T2 supersede it with the DS protocol; it stays live until the T2 cutover (see `todos-v2/TODO-T1-durable-events-approvals.md`).

- `eventIndex` + a persisted event log per session make the stream **replayable**: `agent.stream(sessionId, { startIndex })` (in-process) and (HTTP adapter) `GET …/events?offset=N`. Naming equivalence, stated once: in-process APIs use `startIndex`; the wire uses the Durable-Streams-native `offset` param — they are the same monotonic position (`?offset=N` ⇔ `{ startIndex: N }`), the adapter translates. This is what lets Slack reconnect after a webhook retry and the workspace survive an SSE drop without protocol forks.
- **Implementation choice (locked, verified): adopt the Durable Streams wire protocol instead of inventing one.** Durable Streams (github.com/durable-streams/durable-streams, ElectricSQL, MIT, protocol extracted from production) specifies exactly T1's semantics: monotonic offsets, catch-up reads from arbitrary offset, SSE + long-poll live tailing, ETag caching, `Stream-Next-Offset`/`Stream-Up-To-Date` headers. Server side: embed an `EventStreamStore` (append-only SQLite, monotonic `seq` per stream) + DS-compliant read handlers — Flue's implementation of both is ~1000 lines of framework-agnostic WHATWG `Request→Response` code (`event-stream-store.ts` + `handle-stream-routes.ts`, Apache-2.0) we can adapt behind a thin Fastify bridge; `@durable-streams/server`/the Caddy binary are alternative sidecar deployments. Client side: `@durable-streams/client` (deps: fetch-event-source + fastq) gives reconnection, backoff, and offset checkpointing for free in the browser and in channel adapters. Known caveat to fix when adapting: Flue's SQLite append is two non-transactional statements (single-process only) — make it transactional.
- Approvals ride the same stream as `data-approval-request` parts in v1, migrating to native AI-SDK `tool-approval-request/response` parts when the `PiChatEvent` reducer/view-model migrates to native `UIMessage`/tool-approval parts. Surface answers via `agent.resolveInput(...)` (in-process) or `POST …/input` (HTTP).
- Surface-specific projections are the adapter's job: workspace renders the full stream; Slack maps activity → `setStatus`, text deltas → `sayStream`, approval parts → buttons; Excel maps structured tool outputs → cell writes.

## Two handles (hard rule)

- `sessionId` — runtime-owned. Attaches to the stream, resumes, inspects, forks.
- Continuation/addressing — surface-owned. Slack thread `ts`, workbook id, workspace pane binding. Each surface maintains its own `addressing → sessionId` map (its own store or the host DB). Public agent APIs never accept platform addressing; they accept `sessionId` (or create one).

This keeps multi-tenant routing out of the core: `x-boring-workspace-id` is an HTTP-adapter concern that resolves to a `SessionCtx`, exactly as a Slack adapter resolves team+channel+thread to one. `SessionCtx.workspaceId` is **optional**: a workspace adapter fills it, but pure/headless surfaces (Slack-only, embeds, plain Node) omit it and the session store namespaces by the host-composed `sessionStorageRoot` — a surface must never synthesize a fake `workspaceId`.

## Human-in-the-loop

- `AgentTool` gains `needsApproval?: boolean | (params, ctx) => boolean | Promise<boolean>`. Policy lives with the tool/host, not the surface.
- When approval is needed (or the ask-user tool fires), the harness emits an approval/input-request event, persists the pending request, and parks the turn (`session.waiting`). Durable across process restarts once the session event log lands.
- Any surface holding the `sessionId` answers via `resolveInput`. A web modal, a Slack button, and an Excel task-pane dialog are the same protocol.
- Existing permission prompts and the ask-user plugin migrate onto this path; no second approval channel.

## Surface adapters

A surface adapter does three things (eve channel model): normalize input → `agent.send()`; subscribe/replay events → project to the platform; collect approval responses → `resolveInput`. It owns platform auth (Slack signing secret, Office add-in token) on the trusted side.

### Channel ingress for free: reuse `@flue/*` channel packages

Verified against Flue @ `ffbe359`: the 13 per-channel ingress packages (`@flue/slack`, `teams`, `discord`, `telegram`, `github`, `linear`, `intercom`, `whatsapp`, `messenger`, `twilio`, `google-chat`, `zendesk`, `notion`) import **nothing from `@flue/runtime`** — dependencies are `hono` + provider type packages only. Apache-2.0. Each package provides: signature verification, provider-native payload parsing, Hono route handlers, and a self-contained `conversationKey`/`parseConversationKey` codec.

Consequences:

- **We do not write platform ingress.** A boring channel adapter is ~15–50 lines: fill the channel's callback (`events`/`interactions`/`commands`) with `agent.send()`, use `channel.conversationKey(ref)` as the surface-owned addressing key (exactly the two-handles rule), and post egress via the provider SDK (`@slack/web-api` etc. — egress was never framework-specific).
- Hono handlers mount behind Fastify via a `Request→Response` wrapper or a mini-Hono app — trivial either way. **The wrapper lives inside the first channel package (`packages/channels/slack`), not in an upfront shared package** — a single channel is one consumer, and the no-abstraction-without-two-consumers rule applies. Extract a shared `packages/channels/shared` package **only when a second `@flue/*` channel actually lands** (that second channel is the state trigger); until then there is no `boring-channel-core`.
- Risk: the packages are pre-1.0 (`1.0.0-beta.x`); pin versions. Fallback is vendoring (~700 LOC per channel, Apache-2.0 permits it) — strictly worse, only if the beta dep becomes untenable.
- Not adopted — now verified, not just judged: mounting boring-agent *inside* Flue's runtime. Flue's LLM loop is a hardwired `new Agent(...)` from `pi-agent-core` inside its 125 KB `session.ts` — rich seams *around* the loop (tools, `SessionEnv`, model providers, execution interceptors) but **no seam at the loop**; hosting our pi-coding-agent harness means forking their core. Additionally: single flat `SessionEnv` per harness (our governed multi-fs would be a userland path-multiplexing hack), and session persistence is an event-sourced SQL record log (schema-gated) incompatible with pi-coding-agent JSONL sessions. The shared pi lineage (`pi-agent-core@0.80.x` vs our `pi-coding-agent@0.75.x`) makes vocabulary compatible, not runtimes. **Strategy: cherry-pick, don't adopt** — channel ingress packages (above) + the Durable Streams protocol/client for T1; keep our harness, our multi-fs, our sessions.

Reference adapters, each a separate optional package:

| Surface | Package (proposed) | Environment | Notes |
| --- | --- | --- | --- |
| Workspace UI | `@hachej/boring-agent/front` + `@hachej/boring-workspace` (existing) | full boring-bash | Refit to consume only the public contract; `ChatPanel`/`useAgentChat` unchanged externally. UI bridge (`exec_ui`/`get_ui_state`) stays workspace-owned `extraTools`. |
| Slack | `@hachej/boring-channel-slack` (new, `packages/channels/slack`) | `runtime: none` or readonly `company_context` | Thin adapter over `@flue/slack` ingress; `conversationKey` = continuation; egress + approval blocks via `@slack/web-api`. |
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

1. **Wire protocol**: keep the existing harness stream unit (`PiChatEvent`) as the v1 event payload, add the indexed envelope. Do not invent a parallel event union. The repo already depends on `ai ^6`; the deferred work is not an AI-SDK version bump but migrating the `PiChatEvent` reducer/view-model to native `UIMessage`/tool-approval parts (decision 8).
2. **Pure mode** (#391 open decision 1): pi-coding-agent with `runtime: none` and sealed cwd, behind the Phase 1 audit — not a second harness. Epic #12 keeps pi as the batteries-included default; any alternative harness remains a conformance-suite consumer only, never a Phase 1 prerequisite or the pure-mode path.
3. **Surfaces live outside the agent package**: per-channel packages (Flue model), not subpaths of `boring-agent` (eve model) — matches the existing monorepo layout and keeps the core dependency-free.
4. **Readonly fs is v1**: already true — shipped via #416. The 00-global-isa open decision 6 is resolved.
5. **One namespace rule**: superseded by named `(filesystem, path)` bindings, as already reflected in the pack's V1 caveat.
6. **Channel ingress is reused, not written**: depend on `@flue/*` channel packages (pinned beta) with per-channel thin adapters; egress via provider SDKs. Vendoring is the fallback; hosting inside Flue's runtime is explicitly not adopted.
7. **Environments are attachable resources** (see [`09-environments-attachable.md`](09-environments-attachable.md)): fs+sandbox has identity independent of any agent; agents/subagents/external agents consume it via attachments; external agents attach via MCP projection.
8. **Front chat provider unchanged.** The chat UI is already a vendored ai-elements fork on shadcn primitives (`boring-ui-kit`, Tailwind v4), and the render layer is insulated from the wire protocol by the `PiChatEvent → piChatReducer → BoringChatMessage` projection — T2 therefore forces zero render-layer work, and "adopt shadcn" is a no-op. Two follow-ups only: (a) opportunistic S-sized upgrade after T2 — replace `use-stick-to-bottom` + the custom transcript windowing in `PiConversationSurface` with shadcn's headless `MessageScroller` (June 2026 release; purely presentational, zero AI-SDK coupling, verified); (b) the `BoringChatMessage → UIMessage.parts` view-model swap (to use Vercel AI Elements' Tool/Reasoning/Confirmation cards natively) stays **deferred** — M–L rewrite of the reducer pipeline (~1,600 LOC) + both tool-renderer stacks for little present gain; if ever done, it rides with T2's `AgentEvent` as the single projection, per decision 1.
9. **No feature-flag framework; version rides existing carriers.** `AgentEvent.v` is the wire version; DS routes land additive in T1 next to the legacy `?cursor=` route (that additive window is the only "flag") and the legacy route is deleted at the T2 cutover; the injectable front transport (`usePiSessions({ createRemoteSession })`) may dark-launch DS for at most one PR before the default flips; minor version bumps of `@hachej/boring-agent` mark the T2 (protocol) and P3 (relocation) cutovers. Server+front ship together in the CLI package — no long-lived skew exists to flag for.
10. **No retro-compat, no speculative abstraction.** All `@hachej/*` consumers are in-repo: importers migrate in the same PR, transitional code carries `TODO(remove:<bead-id>)` with a same-phase deletion bead, no abstraction without two real consumers (binding policy: `todos-v2/README.md` "Simplicity & no-compat policy"). Exceptions that MUST stay compatible: on-disk pi session JSONL, the landed #416 shared contracts, server↔front within one release train.
