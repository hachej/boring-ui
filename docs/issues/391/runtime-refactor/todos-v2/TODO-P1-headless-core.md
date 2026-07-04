# TODO-P1 — Headless core: `createAgent()`, dependency inversion, pure mode

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No access to prior conversation assumed.

## Context (read first)

Phase 1 of the #391 runtime refactor (v2) — the critical path. Goal: extract a Fastify-free `createAgent()` façade from the agent server, make `createAgentApp()` / `registerAgentRoutes()` thin adapters over it with **zero behavior change**, add a pure `runtime: 'none'` path, and prove the core has no ambient host-file authority. Phase 0 (`TODO-P0-adr-decisions.md`) must be merged first.

Required reading (relative to repo root):

- `docs/issues/391/runtime-refactor/00-global-isa.md` — package ownership, non-negotiable invariants 1–14, seams to reuse.
- `docs/issues/391/runtime-refactor/01-agent-core-runtime-free.md` — the pure-mode contract, the `AgentEnvironment` shape, and the **no-`AgentFeature`** rule (config uses the existing `tools`/`systemPromptAppend`/`systemPromptDynamic`/readiness seams directly; boring-bash contributes a plain `{ tools, readinessRequirements }` bundle the host spreads in), the pi-harness audit questions, required tests.
- `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` — the `createAgent()` API surface (`start`/`stream`/`send`/`resolveInput`/`sessions`/`readiness`/`dispose`; `start`=accepted-receipt write, `stream`=replay+live-tail read, `send`=convenience over both), the two-handles rule, the "façade has no Fastify import / no env reads / no file discovery" rule.
- `docs/issues/391/runtime-refactor/06-migration-phases.md` — "Phase 1" deliverables + exit criteria (this TODO expands them).
- `docs/issues/391/runtime-refactor/todos/TODO-01-agent-core-pure-mode.md` — the v1 bead breakdown for the same phase; reuse its test intent (BBA-010..016) and house style.

Repo facts (verified — cite these exact paths/signatures):

- **Two server shapes, both Fastify, both to become adapters:**
  - `packages/agent/src/server/createAgentApp.ts` — Shape A. `createAgentApp(opts: CreateAgentAppOptions): Promise<FastifyInstance>`. Owns its own `Fastify({...})` instance + auth middleware (`createAuthMiddleware`). Single static runtime binding.
  - `packages/agent/src/server/registerAgentRoutes.ts` — Shape B. `registerAgentRoutes: FastifyPluginAsync<RegisterAgentRoutesOptions>`. Host provides the Fastify app; supports per-request workspace scoping (`getWorkspaceId`/`getWorkspaceRoot`/…), a `runtimeBindings` LRU (`MAX_RUNTIME_BINDINGS = 256`), and background provisioning. This is the richer path.
  - Both are exported from `packages/agent/src/server/index.ts` (lines 98–99, 114–115).
- **The real turn loop is NOT `harness.sendMessage`.** The shared `AgentHarness` interface (`packages/agent/src/shared/harness.ts`) has **no** `sendMessage`. The streaming turn lives in `packages/agent/src/server/pi-chat/harnessPiChatService.ts` (`HarnessPiChatService implements PiChatSessionService`), which uses `harness.getPiSessionAdapter(input, ctx)` → `PiAgentSessionAdapter`, subscribes to its events, and maps them to `PiChatEvent`s (SSE). `08`'s `AgentHarness.sendMessage(...): AsyncIterable<UIMessageChunk>` is an idealization — `agent.send()` must be built over the existing `HarnessPiChatService` prompt + event-subscribe flow, not a nonexistent method. **Do not invent a new streaming path.**
- **HTTP chat route** is `packages/agent/src/server/http/routes/piChat.ts` (registered as `piChatRoutes`), served by `HarnessPiChatService` (`packages/agent/src/server/pi-chat/harnessPiChatService.ts`). There is **no** `http/routes/chat.ts` or `http/sse.ts`; the SSE/replay logic is inside `piChat.ts` + `pi-chat/piChatReplayBuffer.ts`. Auth middleware is `packages/agent/src/server/http/middleware.ts` (`createAuthMiddleware`).
- **Harness factory contract** (`packages/agent/src/shared/harness.ts`): `AgentHarnessFactory = (input: AgentHarnessFactoryInput) => AgentHarness | Promise<AgentHarness>`. Input includes `tools`, `cwd`, `runtimeCwd?`, `systemPromptAppend?`, `sessionNamespace?`, `sessionRoot?`, `sessionDir?`, `systemPromptDynamic?`, `telemetry?`. Default factory is `createPiCodingAgentHarness` (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`).
- **Runtime mode types** live in `packages/agent/src/server/runtime/mode.ts` (`RuntimeModeAdapter`, `RuntimeBundle`, `RuntimeModeId = 'direct' | 'local' | 'vercel-sandbox' | (string & {})`). Resolution is `packages/agent/src/server/runtime/resolveMode.ts` (`resolveMode()` / `autoDetectMode()`). `autoDetectMode()` reads `BORING_AGENT_MODE` and probes `bwrap`.
- **Session store** (`packages/agent/src/shared/session.ts`): `SessionStore { list, create, load, delete }` keyed by `SessionCtx { workspaceId, userId? }`. Pi impl: `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` (`PiSessionStore`); session root default is `~/.pi/agent/sessions`, overridable via `BORING_AGENT_SESSION_ROOT` (`SESSION_ROOT_ENV`, line 55).
- **Existing invariant enforcement to extend:**
  - `packages/boring-bash/scripts/check-invariants.mjs` (lines 63–70) already fails on any **value** import from `@hachej/boring-bash` inside `packages/agent/src/**` (allows `import type`). Extend for the façade.
  - `packages/agent/src/__tests__/invariants.test.ts` runs `scripts/check-invariants.sh` (ripgrep-based) against the package.
  - `packages/agent/scripts/check-agent-isolation.ts` (`check:isolation` script) walks `dist/` and forbids `@hachej/boring-core` specifiers.
- **Consumers that must keep working unchanged** (found via grep for `registerAgentRoutes`/`createAgentApp`):
  - `packages/cli/src/server/modeApps.ts` (registers `registerAgentRoutes` at line ~671; `workspacesMode` path reads a `workspaces.yaml` registry — CLI-owned, already host composition).
  - `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` (registers `registerAgentRoutes`).
  - `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`.
  - `packages/agent/src/bin/boring-agent.ts`, `packages/agent/src/server/dev.ts`, `packages/agent/examples/with-custom-tool/server.ts`.
- **E2E coverage that must stay green:** `packages/agent/e2e/` (Playwright: `m2-modeflip.spec.ts`, `m3a-sessions.spec.ts`, `bridge-protocol.spec.ts`, `bombadil/`). Run via `pnpm --filter @hachej/boring-agent run test:e2e`.

## Goal / exit criteria

Matches `06-migration-phases.md` "Phase 1":

- `createAgent()` exported from `@hachej/boring-agent/server`, Fastify-free, returning `{ start, stream, send, resolveInput, sessions, readiness, dispose }`. The write primitive is `start(input): Promise<{ sessionId, startIndex }>` (accepted receipt; the turn runs to completion on an independent producer appending to the EventStreamStore regardless of any consumer); the read primitive is `stream(sessionId, { startIndex }): AsyncIterable<AgentEvent>` (replay-from-offset + live tail — it replaces a separate `replay()`); `send(input)` is documented convenience = `start` + `stream`. Producers are never consumer-backpressured; cancelling a stream iterator never cancels the turn; `interrupt()` is the only way to stop a turn.
- `createAgentApp()` / `registerAgentRoutes()` are adapters over `createAgent()`; all current HTTP consumers behave identically (cli hub, workspace, core, agent-playground e2e).
- Typed config object only: **no** `process.env` reads, **no** `process.cwd()` defaults, **no** `.pi/*` discovery, **no** `workspaces.yaml` reads inside `createAgent()`. All such reads move to host/CLI composition and are passed in.
- A pure agent starts via `createAgent({ runtime: 'none' })` in a plain Node script with no Fastify, no workspace/sandbox/cwd/file routes/bash tools.
- `sessionStorageRoot` is separated from workspace roots.
- pi-coding-agent cwd/resource assumptions are audited; findings doc + follow-up seals produced (blocks pure-mode exit).
- Invariant tests: no agent value import from boring-bash; no Fastify in the façade module graph; smoke test `createAgent({ runtime: 'none' })` runs a turn with a fake harness in plain Node.

## Non-negotiables

- **Zero behavior change** for existing HTTP consumers. The adapters must produce byte-identical route surfaces and readiness semantics. Prove via the existing agent test + e2e suites, unchanged.
- `createAgent()`'s module graph must not transitively import `fastify`. This is invariant-tested (BBP1-006).
- No new plugin registry and **no `AgentFeature` abstraction** (single-consumer speculative abstraction — forbidden). `createAgent()` config exposes the existing seams directly — `tools`, `systemPromptAppend`/`systemPromptDynamic`, readiness (`mergeTools({ checkReadiness })`, `registerCapabilitiesContributor`). Boring-bash later contributes a plain `{ tools, readinessRequirements }` bundle (P3's `createBashAgentFeature()`) the host spreads into `tools` — see `01-agent-core-runtime-free.md` "Public core contracts".
- Type-only `RuntimeModeAdapter`/`RuntimeBundle` imports may stay in agent during migration; concrete mode adapters (`direct`/`local`/`vercel-sandbox`) and `resolveMode()` stay put in P1 (they move to boring-bash in Phase 2). P1 only inverts *who calls* them: host composition, not `createAgent()` internals.
- Pure mode must pass **no cwd** or a sealed virtual root with no host files to the harness — stronger than "omit cwd from prompt" (invariant 1, `00-global-isa.md`).
- Session-history durability is separate from file/workspace durability (invariant 5).

## Do NOT

- Do NOT move provider implementations to `boring-bash` in this phase — that is Phase 2 and requires the injection seam from here first (`01` "Dependency inversion first").
- Do NOT invent a new streaming/event protocol — reuse `HarnessPiChatService`. The indexed `AgentEvent` envelope + durable offset-addressed event log are Phase T1; in P1 `stream` is a **minimal non-durable live tail** over the existing `HarnessPiChatService`/replay-buffer path (so `send` = `start` + `stream` works end-to-end), and only *historical* replay from an offset older than the live buffer throws `AgentNotImplementedError` / `ERR_NOT_IMPLEMENTED_UNTIL_T1`. `resolveInput` remains a typed stub throwing the same error (see BBP1-002).
- Do NOT add env-var reads or file discovery inside `createAgent()`. If the façade needs a value that today comes from `process.env`, take it as a config field and let the adapter/host read the env.
- Do NOT change `workspaces.yaml` handling in the CLI — it is already host composition (`packages/cli/src/server/modeApps.ts`); just confirm the façade does not re-read it.
- Do NOT re-export moved values from agent barrels in a way that creates a cycle.

## Beads

### BBP1-001 — Config-surface inventory: enumerate every env/cwd/file-discovery read in agent server code — M

- **Description:** Produce the exhaustive list of ambient reads inside `packages/agent/src/server/**` that must move to host/CLI composition, so BBP1-002/003 can turn each into a typed config field. This is a research + documentation bead feeding the façade design.
- **Files to touch/create:** create `docs/issues/391/runtime-refactor/todos-v2/_p1-config-surface.md` (the inventory table). No product code.
- **Implementation notes — the inventory (already grounded; verify and complete):**
  - `process.cwd()` defaults: `createAgentApp.ts:123` (`workspaceRoot ?? process.cwd()`), `registerAgentRoutes.ts:352`, `config/workspaceRoot.ts:3`, `models/modelConfig.ts:236` (`SettingsManager.create(process.cwd(), getAgentDir())`), `sandbox/direct/createDirectSandbox.ts:74`.
  - Env vars via `getEnv()`/`process.env`:
    - `BORING_AGENT_TEMPLATE_PATH` — `createAgentApp.ts:125`, `registerAgentRoutes.ts:354`.
    - `BORING_AGENT_MODE` — `runtime/resolveMode.ts:26` (`autoDetectMode`).
    - `BORING_AGENT_WORKSPACE_ROOT` — `config/workspaceRoot.ts:4` (`WORKSPACE_ROOT_ENV`).
    - `BORING_AGENT_SESSION_ROOT` — `harness/pi-coding-agent/sessions.ts:55` (`SESSION_ROOT_ENV`); default `~/.pi/agent/sessions`.
    - `BORING_MAX_WATCHED_ENTRIES` — `workspace/nodeWatcher.ts:77`.
    - `BORING_WORKER_BASE_URL`, `BORING_WORKER_INTERNAL_TOKEN` — `runtime/modes/remote-worker.ts:28–29`.
    - `BORING_AGENT_UV_BIN` — `workspace/provisioning/provisionWorkspaceRuntime.ts:217`.
    - Model-config family (`models/modelConfig.ts:35–255`): `BORING_AGENT_INFOMANIAK_*`, `BORING_AGENT_CUSTOM_MODEL_*`, `BORING_AGENT_DEFAULT_MODEL` / `_ID` / `_PROVIDER`.
    - `BORING_AGENT_VERBOSE` — `server/logging.ts:64`.
    - `getEnvSnapshot()` / `process.env` spread: `sandbox/workspacePythonEnv.ts:30`, `runtime/modes/provisioningAdapter.ts:86`, `workspace/provisionRuntime.ts:71`.
    - Test-only: `BORING_AGENT_E2E_SCRIPTED_PI*` (`bin/boring-agent.ts:131`, `testing/scriptedPiHarness.ts`).
  - File discovery / home-dir reads:
    - `.pi/` plugin discovery: `harness/pi-coding-agent/pluginLoader.ts:10–12` — `GLOBAL_DIR = ~/.pi/agent/extensions`, `LOCAL_DIR = .pi/extensions`, `EXTENSIONS_JSON = .pi/extensions.json`. Triggered by `loadPlugins({ cwd })` in both server shapes when `externalPlugins !== false` **and** `modeAdapter.workspaceFsCapability === 'strong'` (`createAgentApp.ts:156`, `registerAgentRoutes.ts:617`).
    - Pi auth/settings: `AuthStorage.create()` / `getAgentDir()` / `SettingsManager.create()` — `harness/pi-coding-agent/createHarness.ts:444,490,497`, `http/routes/models.ts:48`, `models/modelConfig.ts:236`.
    - `workspaces.yaml` — consumed only in `packages/cli/**` (host composition), **not** inside agent server. Record as "already host-owned; confirm façade does not re-read".
  - For each row record: file:line, what is read, whether it feeds `createAgent()` config or stays inside the (host-composed) harness/provider, and the target config field name.
- **Tests to add:** none (doc). The grep commands used become the reproducer in the doc.
- **Acceptance:** Every ambient read in `packages/agent/src/server/**` is classified as (a) → typed config field on `createAgent()`, (b) stays in host composition, or (c) test-only/ignore. No unknowns.

### BBP1-002 — `createAgent()` façade (Fastify-free) — L

- **Description:** Add `createAgent(config): Agent` to `@hachej/boring-agent/server`, returning `{ start, stream, send, resolveInput, sessions, readiness, dispose }`. Fastify-free. Config shape derived from what `createAgentApp` currently reads (BBP1-001), passed in — never read from env inside the façade. `start` is the write primitive (accepted receipt), `stream` the read primitive (replay+live-tail), `send` a convenience over both — see `08` "Producer/consumer split".
- **Files to touch/create:**
  - create `packages/agent/src/server/createAgent.ts` (the façade + `AgentConfig` type).
  - `packages/agent/src/server/index.ts` — export `createAgent` + `AgentConfig`.
  - possibly `packages/agent/src/shared/` — if `AgentEvent`/`Agent` public types belong in the shared (type-only) surface, add them there (front-safe: no `node:*`, no `Buffer`, no Fastify).
- **Implementation notes:**
  - Derive `AgentConfig` from `CreateAgentAppOptions` minus HTTP/Fastify concerns. Concretely it carries: `harnessFactory?` (default `createPiCodingAgentHarness`), `runtime: RuntimeModeAdapter | 'none'`, `tools?: AgentTool[]` (extra app-owned tools — the boring-bash bundle's tools are spread in here by the host, there is **no** `features?` member), `readinessRequirements?: string[]` (opaque gates, host-supplied), `sessions?` override, `systemPromptAppend?`, `systemPromptDynamic?`, `telemetry?`, `metering?`, `sessionStorageRoot?` (see BBP1-004), and the resolved non-env values that were previously env-read (template path, workspace/session roots) — all supplied by the caller. Do **not** add an `AgentFeature`/`features` config surface.
  - **Single send-input type — `AgentSendInput` (shared).** Name the `send` input `AgentSendInput`, reconciled from the existing `packages/agent/src/shared/harness.ts` `SendMessageInput` (extend and rename — **one** type, defined in the shared/type-only surface; do not keep two parallel input types). `SendMessageInput`'s callers migrate to `AgentSendInput` in the same PR. `AgentSendInput` carries the normalized user turn (`{ sessionId?, content, attachments?, actor }` — omit `sessionId` to create a new session) and is the type T2's `ChatTransport.sendMessages` and 08's message-in shape both reference.
  - `agent.start(input: AgentSendInput): Promise<{ sessionId, startIndex }>` — the write primitive. Admit the turn onto `HarnessPiChatService` (`packages/agent/src/server/pi-chat/harnessPiChatService.ts`): build the service once from `{ harness, sessionStore: harness.sessions, workdir, workspace?, metering }`, drive the prompt on an **independent producer** that runs to completion regardless of any consumer, and return the accepted receipt `{ sessionId, startIndex }` the instant the turn is admitted. Producers are never consumer-backpressured. In P1 the producer's events may be the existing `PiChatEvent`/chunk stream; the indexed `AgentEvent` envelope + durable append are T1. Keep the async-iterable/subscriber shape so T1 can wrap it without an API break.
  - `agent.stream(sessionId, { startIndex }): AsyncIterable<AgentEvent>` — the read primitive (replay-from-offset + live tail; the single read primitive, there is no separate `replay()` method). **Minimal non-durable implementation in P1** — the durable offset-addressed event log is T1, but P1 ships a working *live tail* over the existing `HarnessPiChatService`/`PiChatReplayBuffer` path so `send()` = `start` + `stream` yields events end-to-end and the "send yields at least one event" acceptance is satisfiable. What is NOT available before T1 is *historical* replay: `stream(sessionId, { startIndex })` with a `startIndex` offset older than the live buffer throws a typed `AgentNotImplementedError` with code `ERR_NOT_IMPLEMENTED_UNTIL_T1` (the durable back-log that answers stale offsets does not exist yet). Keep the exact signature so T1 swaps the internals for the durable DS store without an API break. Cancelling the returned iterator must never cancel the turn (document this on the method).
  - `agent.send(input: AgentSendInput): AsyncIterable<AgentEvent>` — documented convenience only: `const { sessionId, startIndex } = await start(input); yield* stream(sessionId, { startIndex })`. Because P1's `stream` provides a working live tail, `send` is functional end-to-end in P1 (it drives one turn and yields its events); keep it defined purely as the composition with no independent semantics, so T1's durable swap flows through unchanged.
  - `agent.sessions` = `harness.sessions` (the `SessionStore`).
  - `agent.readiness` = the per-requirement view already produced by `createRuntimeReadyStatusTracker(...)` (`runtime/modeReadiness.ts`) + `mergeTools({ checkReadiness })`. Surface it as data, not routes.
  - `agent.resolveInput(...)` — **stub in P1** (real approvals path is T1). Provide the method signature `(sessionId, requestId, response)` and throw the typed `AgentNotImplementedError` (`ERR_NOT_IMPLEMENTED_UNTIL_T1`). Document the T1 hand-off.
  - **Typed stub error:** define `AgentNotImplementedError` (code `ERR_NOT_IMPLEMENTED_UNTIL_T1`) in the shared/type-only surface; `resolveInput` throws it unconditionally, and `stream` throws it **only** for a historical `startIndex` older than the live buffer (live-tail streaming works in P1). **Do NOT** ship any downstream pack (T2, S1, P3, …) that depends on durable historical replay or on approvals — they block on T1 filling these in.
  - `agent.dispose()` — dispose the mode adapter (`modeAdapter.dispose?.()`) and any harness/service resources.
  - When `runtime: 'none'`: build no `RuntimeBundle`, register no file/bash tools/features, and construct the harness with a sealed/absent cwd (see BBP1-004 + BBP1-005).
- **Tests to add:** unit test that `createAgent({ runtime: 'none', harnessFactory: fakeHarness })` constructs without Fastify and exposes all six members; `send` yields at least one event from a fake harness turn via the live tail (fuller smoke is BBP1-006); a `stream(sessionId,{startIndex})` call with an offset older than the live buffer throws `AgentNotImplementedError`/`ERR_NOT_IMPLEMENTED_UNTIL_T1`.
- **Acceptance:** `createAgent()` is importable and usable with no Fastify, no env reads; the six-member API exists; `send` drives one turn through a fake harness.

### BBP1-003 — Make `createAgentApp()` + `registerAgentRoutes()` thin adapters — L

- **Description:** Refactor both server shapes so they *compose* `createAgent()` (or share its internals) and only add HTTP concerns (Fastify instance, auth middleware, route registration, request→workspace scoping, LRU bindings). Zero behavior change.
- **Files to touch:** `packages/agent/src/server/createAgentApp.ts`, `packages/agent/src/server/registerAgentRoutes.ts`. Do not change the exported option types' observable behavior.
- **Implementation notes:**
  - Keep `CreateAgentAppOptions` / `RegisterAgentRoutesOptions` as the public HTTP-adapter option types. Internally, each resolves its ambient inputs (`process.cwd()`, `getEnv('BORING_AGENT_TEMPLATE_PATH')`, `resolveMode(...)`, `loadPlugins({cwd})`) — i.e. env/cwd/discovery stays in the **adapter**, not the façade — then builds an `AgentConfig` and calls `createAgent()`.
  - `registerAgentRoutes` is the hard one: its per-request `RuntimeBinding` LRU (`createRuntimeBinding`, `getOrCreateRuntimeBinding`, `MAX_RUNTIME_BINDINGS`) plus background provisioning must be preserved. Model each workspace binding as a `createAgent()` instance (or a shared factory) keyed by `scope.key`. The two-handles rule (`00` invariant 12): the raw `x-boring-workspace-id` header (a surface/transport input) is resolved **adapter-side** to a `SessionCtx`. `SessionCtx { workspaceId, userId? }` is boring's OWN runtime tenancy context (the `SessionStore` key) and is explicitly ALLOWED on the façade — it is **not** "platform addressing". Platform addressing = surface-native identifiers only (Slack team/channel/thread ts, workbook/sheet ids, workspace pane ids), which never reach the façade. So the façade legitimately sees `sessionId` and `SessionCtx`.
  - Route wiring (`fileRoutes`, `treeRoutes`, `searchRoutes`, `gitRoutes`, `piChatRoutes`, `systemPromptRoutes`, `modelsRoutes`, `skillsRoutes`, `catalogRoutes`, `commandsRoutes`, `reloadRoutes`, `readyStatusRoutes`, `healthRoutes`) stays in the adapters. `piChatRoutes` consumes the same `HarnessPiChatService` the façade builds — thread it through rather than constructing twice.
  - Preserve `registerCapabilitiesContributor('agent', …)` (`registerAgentRoutes.ts:866–881`) and the reload route (`:998`) semantics exactly.
- **Tests to add:** none new here beyond keeping existing green — the whole point is behavior parity. Add a note in the PR that BBP1-006 + existing suites are the guardrail.
- **Acceptance:** `pnpm --filter @hachej/boring-agent run test` and `pnpm --filter @hachej/boring-agent run test:e2e` pass unchanged; cli hub, workspace, core servers start and serve identically; no route added or removed for existing modes.

### BBP1-004 — `runtime: 'none'` pure path + `sessionStorageRoot` separation — M

- **Description:** Add the pure composition path (`runtime: 'none'`, no bash bundle spread into `tools`) and separate transcript/session storage (`sessionStorageRoot`) from workspace file roots.
- **Files to touch:** `packages/agent/src/server/createAgent.ts` (pure branch); `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` / `sessions.ts` (accept an explicit session root distinct from `cwd`); adapters (`createAgentApp.ts`, `registerAgentRoutes.ts`) to expose a way to select pure mode.
- **Implementation notes:**
  - Pure mode registers only: chat/session/model routes (in the HTTP adapter), host-configured non-bash tools/hooks, app-owned tools. It must NOT register `fileRoutes`/`treeRoutes`/`searchRoutes`/`fsEventsRoutes`/`gitRoutes`, and must NOT include `read/write/edit/find/grep/ls`/`bash`/`execute_isolated_code`/upload tools (per `01-agent-core-runtime-free.md` "Pure runtime mode").
  - No `modeAdapter.create()` call, no `RuntimeBundle`. `HarnessPiChatService` needs a `workdir`/`workspace` today; in pure mode pass a sealed/virtual value with no host authority (coordinate with BBP1-005 audit outcome) or make those fields optional.
  - `sessionStorageRoot`: today `PiSessionStore` derives the session dir from `cwd` + `BORING_AGENT_SESSION_ROOT` (`sessions.ts:41–55`). Add an explicit `sessionStorageRoot` on `AgentConfig` that flows to `sessionRoot`/`sessionDir` in `AgentHarnessFactoryInput`, decoupled from `cwd`. Host reads `BORING_AGENT_SESSION_ROOT`; the façade takes the resolved path.
  - Skip boot-time plugin discovery (`loadPlugins`) in pure mode — it is already gated behind `workspaceFsCapability === 'strong'`, which `'none'` will not have; verify no other path calls it.
- **Tests to add:** pure-mode route list excludes file/tree/search/fs-events/git routes; tool catalog excludes the fs/bash/upload tools; a session can be created + listed + deleted from `sessionStorageRoot` with no workspace root; assert no `process.cwd()`/repo-root/`/workspace` path appears in pure config. Mirror `TODO-01` BBA-013 test intent.
- **Acceptance:** `createAgent({ runtime: 'none' })` yields an agent with app-owned tools only, durable sessions under `sessionStorageRoot`, and no file/bash routes or tools anywhere.

### BBP1-005 — pi-coding-agent cwd/resource assumption audit → findings + seals — M

- **Description:** Audit `createPiCodingAgentHarness` and its resource/session/prompt paths for ambient host-file authority, since removing tools is insufficient if the harness still gets `process.cwd()` or reads `AGENTS.md`/global resources. Produce a findings doc and concrete follow-up "seals" (config flags / disable switches).
- **Files to touch/create:** create `docs/issues/391/runtime-refactor/todos-v2/_p1-pi-harness-audit.md` (findings); code seals land in `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` (+ `sessions.ts`, `pluginLoader.ts`) as the audit dictates.
- **Implementation notes — known suspects to answer (from `01` "Pi harness audit"):**
  - **Session JSONL location:** `sessions.ts` `sessionBaseDir` → `~/.pi/agent/sessions` unless `BORING_AGENT_SESSION_ROOT`; `SessionManager.create(runtimeCwd, nativeSessionDir)` (`createHarness.ts:463,467`) where `runtimeCwd = opts.runtimeCwd ?? ctx.workdir` (`:457`). Confirm pure mode passes a sealed root and never `ctx.workdir = process.cwd()`.
  - **`.pi` extension loading:** `pluginLoader.ts` `GLOBAL_DIR`/`LOCAL_DIR`/`EXTENSIONS_JSON`. Confirm gated off in pure mode.
  - **Skills dir + context files:** `DefaultResourceLoader({ cwd: opts.cwd, agentDir, … })` (`createHarness.ts:502`), `noContextFiles`/`noSkills` flags (`:509–511`). Does it auto-discover `AGENTS.md`/`CLAUDE.md` from `cwd`? Determine and seal (pure mode should set `noContextFiles`/`noSkills` or an equivalent unless the host opts in).
  - **Model registry / auth file:** `AuthStorage.create()` (`:444`), `getAgentDir()` (`:490`), `SettingsManager.create(process.cwd(), getAgentDir())` (`modelConfig.ts:236`). These read host auth/settings; decide whether pure mode tolerates Pi-owned auth reads (credentials are legitimately Pi-owned — see `08` trust boundary) but must not leak a host **cwd** into settings resolution.
  - **System prompt:** does the composed prompt inject cwd / file-tree / file-tool hints (`createHarness.ts:477–486` comments mention a workspace-paths guideline appended on top of pi's cwd line)? Pure mode must produce a prompt with no cwd/workspace/AGENTS.md leakage (snapshot-tested).
  - **Compaction / session identity:** does compaction assume file tools exist; does session identity assume a workspace root? Answer explicitly.
- **Decision to record:** per `08` decision 2 + `00` open-decision 1, the outcome is **sealed pi harness, not a second harness**. The audit must show pi can run with cwd disabled/sealed, or escalate.
- **Tests to add:** harness-construction spy asserting no host cwd/path in pure mode; system-prompt snapshot with no cwd/workspace/AGENTS.md/file-tool text (extend the existing `packages/agent/src/server/__tests__/system-prompt-size.regression.test.ts` neighborhood or add a new snapshot test).
- **Acceptance:** findings doc enumerates each suspect with verdict + seal; pure mode has no host file authority (not just no model-visible file tools); the "sealed pi" decision is encoded in a test.

### BBP1-006 — Invariant + smoke tests — M

- **Description:** Lock the architecture with executable checks: (a) no agent value import from boring-bash; (b) no Fastify in the `createAgent()` module graph; (c) a plain-Node smoke test that `createAgent({ runtime: 'none' })` runs a turn with a fake harness.
- **Files to touch/create:**
  - extend `packages/boring-bash/scripts/check-invariants.mjs` — its agent→boring-bash value-import scan (lines 63–70) already covers `packages/agent/src/**`; add an explicit assertion that `packages/agent/src/server/createAgent.ts` (and its non-adapter dependency closure) contains no `fastify` import. A static-graph check is acceptable (scan the façade file + a curated import-closure list) or add a runtime test that imports `@hachej/boring-agent/server`'s `createAgent` in a Fastify-free module and asserts `require.cache`/`import.meta` has no `fastify`.
  - add `packages/agent/src/server/__tests__/createAgent.pure.test.ts` (vitest) — the smoke test.
- **Implementation notes:**
  - **Fastify-graph check:** the cleanest enforcement is a dedicated built-artifact scan mirroring `check-agent-isolation.ts` (which forbids `@hachej/boring-core` in `dist/`). Add a companion that walks the built `createAgent` entry and forbids a `fastify` specifier in its transitive closure — but note `createAgent` currently ships inside `dist/server/index.js` alongside the adapters (which legitimately import Fastify). Therefore either give `createAgent` its own entry/subpath export so its closure is separable, or do a source-level graph walk from `createAgent.ts` following relative imports and fail on any module that imports `fastify`. Prefer the source-graph walk to avoid a new public subpath in P1.
  - **Smoke test:** in plain Node/vitest (no Fastify), build a fake `AgentHarnessFactory` returning a minimal `AgentHarness` (in-memory `SessionStore`, a `getPiSessionAdapter` stub emitting one text event), call `createAgent({ runtime: 'none', harnessFactory: fake, tools: [echoTool] })`, drive `send()`, and assert: one turn completes, no file/bash tool in catalog, no `process.cwd()`/repo path in any config/prompt, session persisted under a temp `sessionStorageRoot`.
- **Tests to add:** the three checks above.
- **Acceptance:** all three fail on the pre-refactor tree in the intended way (add a negative fixture/assertion for the boring-bash + Fastify import checks) and pass on the refactored tree; the smoke test proves a pure turn in plain Node.

## Verification

Commands (verified to exist in `packages/agent/package.json` / root `package.json`):

- `pnpm --filter @hachej/boring-agent run build` — tsup build (must stay green; `build:assert` runs artifact assertions).
- `pnpm --filter @hachej/boring-agent run typecheck` — `tsc --noEmit`.
- `pnpm --filter @hachej/boring-agent run test` — vitest (all existing agent tests + new BBP1 tests).
- `pnpm --filter @hachej/boring-agent run lint:invariants` — `bash ../../scripts/check-invariants.sh .` (ripgrep invariant scan).
- `pnpm --filter @hachej/boring-bash run check:invariants` — runs `packages/boring-bash/scripts/check-invariants.mjs` (extended agent→boring-bash + Fastify-graph checks).
- `pnpm --filter @hachej/boring-agent run check:isolation` — `check-agent-isolation.ts` dist scan (requires a build first).
- `pnpm --filter @hachej/boring-agent run test:e2e` — Playwright e2e (`m2-modeflip`, `m3a-sessions`, `bridge-protocol`, `bombadil`); the parity guard for the adapter refactor.
- Root aggregate (optional, heavier): `pnpm lint:invariants` (runs agent + boring-bash + workspace-plugin invariants).
- Manual: start the cli hub and the workspace playground against the refactored build and confirm chat + file tree + sessions behave identically (see the repo's playground run recipe).

## Review gates

- Thermo architecture review must be clean (per `README.md` "Review rule"): no `boring-agent → boring-bash` cycle, no duplicated provisioning/readiness system, no fs/bash split brain, no hidden cwd/fs leak in pure mode.
- BBP1-005's pi-harness audit findings must be reviewed and the "sealed pi, not second harness" decision confirmed **before** the pure-mode exit criteria are claimed (BBP1-004 depends on BBP1-005's seals).
- Behavior-parity gate: the reviewer must confirm the existing agent unit + e2e suites pass unchanged, and that no existing route was added/removed for `direct`/`local`/`vercel-sandbox` modes.
- The Fastify-graph invariant (BBP1-006) must actually fail when a `fastify` import is introduced into the façade closure — reviewer verifies the negative case.
- Do not start Track T1 (event envelope / durable `stream` / `resolveInput`) until BBP1-002..006 are merged; T1 depends on the stub seams landing here.
