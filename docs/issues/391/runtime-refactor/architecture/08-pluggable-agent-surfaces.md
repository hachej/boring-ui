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

Mechanism, not hand-waving: Phase 7 delivers public **agent steering endpoints** (`GET /api/v1/agents` — scrubbed declared-agent list; `GET /api/v1/agents/:agentId/info` — model, tools, readiness, channels, environments; eve's `/eve/v1/info` analog) consumed by workspace panels. Steering = the workspace consuming the same public contracts, with more of them — never private hooks into the core.

**The workspace chat UI IS a surface like any other.** Being the control plane is a *product* role, not a *contract* privilege: the front consumes the same message-in/event-stream-out/approvals/two-handles contract as Slack or an embed, and holds no private core hook. `channels/` (the `@flue/*`-backed platform-ingress packages) is merely the **platform-ingress sub-family** of surfaces — a Slack webhook needs signature verification and a `conversationKey` codec; the workspace composer does not. The front is not "more of a surface" for living in `packages/agent/src/front` or `packages/workspace`: its surface status is enforced by the **T2 platform-addressing import lint** (public agent APIs accept `sessionId`/`SessionCtx` only, never surface-native addressing), **not by package location**. A surface that passed the T2 guard is a surface, wherever its code lives.

**Task-layer principle (substrate here, ownership elsewhere):** Task state is owned by a durable **task service** (issue #397 scope — assignment/claim, wake/run lifecycle, supervision), surfaced in the workspace through the **boring-tasks source-adapter board** (merged PR #486, a presentation layer over pluggable sources). Tasks **LINK** to this pack's primitives — `taskId ↔ sessionId`, assignment by `agentId`, run status enriched from the T1 event log — but **neither pi sessions nor the kanban plugin is the source of truth for task state**. This pack guarantees the **substrate** the task service consumes: runtime-owned `sessionId` identity, `agentId` scoping (P7), replayable event streams (T1), and `sessions.pendingInputs` for human-intervention state.

**Farm-MCP note (deferred — filed at P8 as a follow-up):** the farm may expose **control-plane tools** (create/read task, publish artifact, request human input) over an **MCP surface** so ANY foreign agent integrates (00 North star "open integration"). It rides **E2's MCP infrastructure** + **T1's `sessions.pendingInputs`/`resolveInput`** — no new mechanism. This is deferred to the farm epic; recorded here so the direction is reserved (P8 BBP8-004 files the follow-up).

### Plugin-extensibility (the host-product differentiator)

The steering surface itself is **plugin-extensible, and so is the agent — internally AND externally**, over real, shipped APIs (verified against the current plugin/agent layer, not aspirational). This is what distinguishes boring from an agent framework: **eve/Flue give you APIs to extend *your own* agent; boring's plugin layer lets a third party extend the *host product* — the workspace UI and the agents running inside it — without forking it.**

- **Front (workspace UI):** `definePlugin({ … })` (from `@hachej/boring-workspace/plugin`) contributes `panels` (workspace pages/panes), `workspaceSources` (left-rail entries), `commands`, `appLeftActions`, `surfaceResolvers` (map a typed open-request → a panel — the `openSurface` path), `catalogs`, and `toolRenderers` (custom rendering for a tool's transcript output). These install into the same `PanelRegistry`/`WorkspaceSourceRegistry`/`CatalogRegistry` the built-ins use.
- **Server (agent):** `defineServerPlugin({ … })` (from `@hachej/boring-workspace/server`) is a trusted boot-time contribution: `agentTools` merged in as **`extraTools`**, Fastify `routes`, a `systemPrompt` append, and Pi `extensions`/`skills`/packages. This is how a plugin adds agent capability, not just UI.
- **Runtime backend RPC:** a plugin's server code is reachable from its front over the workspace-owned **`/api/v1/plugins/:pluginId/*`** route family (00 "current seams to reuse").
- **Distribution:** plugins install from **local / git / npm** via the **`boring-ui-plugin` CLI** (scaffold/verify), and a **safe subset hot-reloads** (front + Pi resources refresh via `/reload` + SSE; **server routes/tools require a restart** — hot-reload does not rewire Fastify routes or `agentTools`).

**Honest caveats (do not oversell):**

- **External plugins are trusted local code, NOT sandboxed** — a plugin tool's `execute()` runs in the host Node process and bypasses the sandbox by design; provenance/trust is "local developer/workspace code," not untrusted third-party.
- The **hosted/marketplace model — untrusted external code behind iframe fronts + sandbox-proxied tools — is a FUTURE phase, not implemented.**
- **`full-app` ships `externalPlugins: false`** today (external/runtime plugin loading off in the flagship app).
- **`boring.requires` + bash-requirement validation is P6a** (`TODO-P6`), not already-shipped.

**Named farm-epic plugin surfaces (deferred — reserved, not built here):** **fleet-page widgets** (custom per-agent/fleet-wide widgets on the Fleet page — `TODO-S3` BBS3-001), **task sources** (pluggable boring-tasks sources feeding the task board — #397/#486 direction), and **artifact viewers** (custom renderers for `data-artifact` parts in the artifact shelf). These are the plugin extension points the farm epic opens on top of this epic's substrate.

### Deferred interop directions (reserved, not built)

- **MCP-as-a-channel (filed at P8 with Farm MCP):** an agent **exposed as an MCP server is just another surface adapter** — it rides the **same four-part contract** (message in / event-stream out / approvals on-stream / runtime-owned `sessionId` with surface-owned addressing), where the MCP client's session/tool-call context is the surface-owned addressing. It reuses E2's MCP infrastructure; it is **not** a new mechanism and **not** built in this epic. This is the ingress dual of E2's MCP *projection* (which exposes an *environment* over MCP) and of the Farm-MCP control-plane note above.
- **Cross-org artifact delivery (farm epic):** delivering an artifact from one org's agent to another composes two primitives already reserved here — the **`data-artifact` stream part** and **shared-S3-prefix environments** (E1/09 + `TODO-X1` prefix-scoped mounts). A publishing agent writes to a shared-prefix environment and emits `data-artifact`; a consuming org attaches the same prefix (or receives the part). No new artifact store — the environment write + the part are the only sanctioned path. Deferred to the farm epic (Horizon-3, `00` "Business horizons").

## What every framework converges on (adopted here)

A surface and the agent core exchange exactly four things:

1. **Message in** — a normalized user turn: `AgentSendInput` = `{ sessionId?, content, attachments?, actor, ctx?, originSurface? }` (**omit `sessionId` to create a new session**). `ctx?: SessionCtx` is boring's own tenancy context resolved by the adapter/host (the `SessionStore` scoping key — never surface-native platform addressing); `originSurface?: string` is session-create provenance written by adapters. The full type is defined once in shared (P1); façade calls are single-argument everywhere (`start(input)`, `send(input)` — never `send(input, ctx)`). Core accepts a string or message parts; the surface does platform parsing (Slack signature + payload, Excel cell context, workspace composer state).
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
Features    boring-bash THE RUNTIME (fs+exec env, file tools/routes/  (optional, injected)
            file UI, bash tool, resolveMode = CHOICE of sandbox),
            upload, web, ui-bridge (workspace-owned), plugins
Runtime     providers: direct | bwrap | vercel-sandbox |           (@hachej/boring-sandbox)
            remote-worker | readonly | none  +  FUSE-S3 mounts,     (providers, mounts, lifecycle,
            sandbox lifecycle, capability facts (reported|unknown)   capability facts)
```

This preserves the 00-global-isa three-layer model and adds the two layers above it that make "pluggable" real. The three-package stack under Features/Runtime (00 open decision 3, RESOLVED; decision 11 below): `boring-agent` (contracts, imports neither) ← `boring-bash` (THE RUNTIME: fs/tools/routes/UI + bash + `resolveMode`; imports boring-sandbox values + agent types) ← `boring-sandbox` (providers/mounts/lifecycle/capability facts; imports agent types only). Acyclic.

## The headless façade: `createAgent()`

Today the only delivery of the harness is Fastify (`createAgentApp` / `registerAgentRoutes`). The real loop — the harness chat service (`HarnessPiChatService`, reached via `harness.getPiSessionAdapter`, streaming `PiChatEvent`s) — is already transport-agnostic; `agent.send()` wraps that verified seam (see `../work/P1-headless-core/TODO.md` for the grounded signatures). We export it properly instead of making every consumer mount routes:

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

Reality note: a bespoke replay path already exists (`PiChatReplayBuffer` + `?cursor=` NDJSON in `piChat.ts`) — T1/T2 supersede it with the DS protocol; it stays live until the T2 cutover (see `../work/T1-durable-events/TODO.md`).

- `eventIndex` + a persisted event log per session make the stream **replayable**: `agent.stream(sessionId, { startIndex })` (in-process) and (HTTP adapter) `GET …/events?offset=N`. Naming equivalence, stated once: in-process APIs use `startIndex`; the wire uses the Durable-Streams-native `offset` param — they are the same monotonic position (`?offset=N` ⇔ `{ startIndex: N }`), the adapter translates. This is what lets Slack reconnect after a webhook retry and the workspace survive an SSE drop without protocol forks.
- **Implementation choice (locked, verified): adopt the Durable Streams wire protocol instead of inventing one.** Durable Streams (github.com/durable-streams/durable-streams, ElectricSQL, MIT, protocol extracted from production) specifies exactly T1's semantics: monotonic offsets, catch-up reads from arbitrary offset, SSE + long-poll live tailing, ETag caching, `Stream-Next-Offset`/`Stream-Up-To-Date` headers. Server side: embed an `EventStreamStore` (append-only SQLite, monotonic `seq` per stream) + DS-compliant read handlers — Flue's implementation of both is ~1000 lines of framework-agnostic WHATWG `Request→Response` code (`event-stream-store.ts` + `handle-stream-routes.ts`, Apache-2.0) we can adapt behind a thin Fastify bridge; `@durable-streams/server`/the Caddy binary are alternative sidecar deployments. Client side: `@durable-streams/client` (deps: fetch-event-source + fastq) gives reconnection, backoff, and offset checkpointing for free in the browser and in channel adapters. Known caveat to fix when adapting: Flue's SQLite append is two non-transactional statements (single-process only) — make it transactional.
- Approvals ride the same stream as `data-approval-request` parts in v1, migrating to native AI-SDK `tool-approval-request/response` parts when the `PiChatEvent` reducer/view-model migrates to native `UIMessage`/tool-approval parts. Surface answers via `agent.resolveInput(...)` (in-process) or `POST …/input` (HTTP).
- Surface-specific projections are the adapter's job: workspace renders the full stream; Slack maps activity → `setStatus`, text deltas → `sayStream`, approval parts → buttons; Excel maps structured tool outputs → cell writes.
- **Reserved (namespace claimed NOW, delivery deferred to the farm epic): the `data-artifact` stream part.** An agent publishes an output by **writing it to its environment** (a filesystem the agent already holds — E1/09) **and emitting a `data-artifact` part** on its stream:
  ```jsonc
  {
    "type": "data-artifact",
    "artifactId": "…",
    "kind": "markdown|code|dashboard|deck|dataset|html/generated",
    "title": "…",
    "filesystem": "user",
    "path": "/out/report.md",
    "version": 3
  }
  ```
  The farm UI folds these parts across sessions into an **artifact shelf** (the "artifacts" pillar of the farm — 00 North star). This is **deferred to the farm epic** — but the `data-artifact` part name + payload fields `{ artifactId, kind, title, filesystem, path, version }` are **reserved here NOW** so nothing else squats on the namespace, and so environment writes + this part are the *only* sanctioned publish protocol (no side-channel artifact store). The reference to `filesystem`/`path` is the #416 `(filesystem, path)` identity; `version` is monotonic per `artifactId`.

#### Artifact renderer reservations (farm epic, no implementation here)

- **Kind catalog:** seed from existing renderers only: `markdown` (Streamdown/editor),
  `code` (CodeMirror/code-block), `dashboard` (`plugins/bi-dashboard`),
  `deck` (`plugins/deck`), `dataset` (`plugins/data-explorer`),
  `html/generated` (`plugins/generated-pane`). Viewers must stay pure and embeddable:
  no workspace-shell dependencies; P4/S3 consume the catalog, they do not couple
  viewers to the shell.
- **Editable artifacts:** edit is a capability on the share, not a different protocol.
  A signed, revocable, actor-attributed token grants `read` or `edit`;
  public shares default read-only. Edits create **new artifact versions**,
  never overwrite existing ones, and emit an `artifact-edited` stream event
  for the owning agent to consume so client edits become the agent review loop.
  Multiplayer editing is later #367 TipTap/Yjs work on the same version chain.
- **Renderer security contract:** render on a separate viewer origin in a sandboxed iframe,
  CSP `default-src 'none'`, no host cookies/storage, signed URLs only,
  EU S3 blob storage, and zero viewer-side credentials.
- **Package extraction:** `boring-artifact` is a named deferral, triggered only by a second consumer: S2 embed, Slack link-out, or a customer review page.
- **PR #424 learning:** the public workspace Markdown share is explicitly **non-artifact**.
  Carry forward only the rules: tokens address `artifactId + version + capability`,
  never workspace paths; snapshot-on-publish beats live-file access; assets are
  collected into a manifest at publish time; viewer/editor separation is mandatory;
  downloads such as portable Markdown and bundle ZIPs are first-class kind metadata.

## Two handles (hard rule)

- `sessionId` — runtime-owned. Attaches to the stream, resumes, inspects, forks.
- Continuation/addressing — surface-owned. Slack thread `ts`, workbook id, workspace pane binding. Each surface maintains its own `addressing → sessionId` map (its own store or the host DB). Public agent APIs never accept platform addressing; they accept `sessionId` (or create one).

This keeps multi-tenant routing out of the core: `x-boring-workspace-id` is an HTTP-adapter concern that resolves to a `SessionCtx`, exactly as a Slack adapter resolves team+channel+thread to one. `SessionCtx.workspaceId` is **optional**: a workspace adapter fills it, but pure/headless surfaces (Slack-only, embeds, plain Node) omit it and the session store namespaces by the host-composed `sessionStorageRoot` — a surface must never synthesize a fake `workspaceId`.

### Route-family scope (locked — what `/api/v1/agents/:agentId/...` covers)

The canonical `/api/v1/agents/:agentId/...` path-prefix family (00 open decision 4, resolved) covers **agent-session routes ONLY**: session create/list, `events/stream`, `prompt`, `input`, `interrupt`, `stop`, `pending-inputs`, and `/info`. **File/environment routes are explicitly OUT of this family** — `/api/v1/files/*` and the tree/search/fs-events/git routes are **workspace/environment-scoped**, not agent-scoped: files belong to environments, not agents (E2 exposes them per-environment over MCP). An `agentId` therefore never prefixes a file route; those routes keep their existing paths and gain no `agents/:agentId` segment. The agent-session family and the file/environment routes are two disjoint route surfaces.

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
10. **No retro-compat, no speculative abstraction.** All `@hachej/*` consumers are in-repo: importers migrate in the same PR, transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead (a later TODO owner is allowed only when explicitly named per `../INDEX.md`), no abstraction without two real consumers (binding policy: `../INDEX.md` "Simplicity & no-compat policy"). Exceptions that MUST stay compatible: on-disk pi session JSONL, the landed #416 shared contracts, server↔front within one release train.
11. **Three-package runtime stack (00 open decision 3, RESOLVED).** Concrete sandbox providers are **not** subpaths of boring-bash; they live in a dedicated **`@hachej/boring-sandbox`** package. The stack, top-down: **`@hachej/boring-agent`** (top — defines ALL contracts, imports neither boring-bash nor boring-sandbox) ← **`@hachej/boring-bash`** (THE RUNTIME — fs bindings/tools/routes/UI + bash tool + runtime modes = the CHOICE of sandbox; `resolveMode` lives here; imports boring-sandbox **values** + agent **types**) ← **`@hachej/boring-sandbox`** (sandbox management — providers `direct`/`bwrap`-gVisor/`vercel`-PROXY/`remote-worker`-client, FUSE-S3 mounts, sandbox lifecycle, capability facts `reported | unknown`; imports agent **types only**). Acyclic: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`. P2 creates the `boring-sandbox` scaffold and moves the providers into it; `resolveMode` stays/lands in boring-bash.
