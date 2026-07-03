# 06 — Migration phases (v2)

## Rules

1. Dependency inversion happens before package extraction. Otherwise we create an agent↔bash import cycle.
2. Each phase must preserve existing workspace behavior unless that phase explicitly changes a documented invariant.
3. v2 adds two tracks on top of the original bash track: **Track T (transport/event contract)** and **Track S (surfaces)**. Bash-track phase numbers are unchanged so existing beads/TODOs keep their references.
4. Reconciliation: work that already landed via #416 (company-fs PR stack #437/#440/#429/#454) is marked **[landed]** and must not be redone — later phases build on it.

## Track overview and ordering

```txt
Phase 0 ─ Phase 1 ──┬── Phase 2 ── Phase 3 ── Phase 4 ── Phase 5 ── Phase 6 ── Phase 7 ── Phase 8
   (ADR)  (headless │   (bash pkg)  (routes/   (file UI)  (provis./  (plugins/  (multi-    (cleanup)
          core)     │        │      tools)                readiness) child-app) agent)
                    │        └── Phase E1 ─── Phase E2
                    │            (env registry/ (MCP env
                    │             attachments)  projection)
                    └── Phase T1 ── Phase T2 ─────────────── Phase S1 ── Phase S2
                        (event      (transport               (Slack      (pi-excel
                         envelope)   adapters)                channel)    embed)
```

Track T starts after Phase 1 and runs parallel to Phases 2–4. Track S needs T2. Track E (environments as attachable resources, 09) starts after Phase 2 and runs parallel to Phases 3–5; E2 needs E1 only. Governance work (#475 line) continues independently on the landed #416 contracts.

## Phase 0 — ADR, naming lock, invariant update

Deliverables:

- ADR: `@hachej/boring-agent` becomes runtime-free **and surface-agnostic**; `@hachej/boring-bash` owns files/bash/file UI; surfaces are thin adapters (08).
- Update `docs/DECISIONS.md` §7 and `packages/agent/docs/runtime.md`.
- Lock package name: `@hachej/boring-bash` **[landed — package exists]**.
- Namespace semantics: one `/workspace` view superseded by named `(filesystem, path)` bindings **[landed via #416; pack already carries the V1 caveat]**.
- Lock v2 decisions from 08: event envelope over AI-SDK chunks; pure mode via sealed pi harness; per-channel surface packages; readonly fs is v1 (resolved).
- State that the old monolithic plan is superseded by this plan pack, and that 08 supersedes the surface-related open decisions in 00.

Exit criteria: ADR accepted; plan pack (incl. 08) thermo-reviewed; issue #391 points to the v2 pack.

## Phase 1 — Headless core: dependency inversion, pure mode, `createAgent()`

Deliverables:

- `createAgentApp()` / `registerAgentRoutes()` receive runtime/features by injection.
- **Export `createAgent()`** from `@hachej/boring-agent/server`: Fastify-free façade returning `{ send, resolveInput, sessions, replay, readiness, dispose }` (see 08). `createAgentApp()` becomes an adapter over it.
- Typed config object only: no env-var reads or file discovery inside `createAgent()`; `.pi/*`, workspaces.yaml, env parsing move to host/CLI composition.
- Remove static value imports from agent server composition to built-in mode resolution where needed for pure mode. Type-only `RuntimeModeAdapter` contracts may stay in agent during migration; `resolveMode()` and concrete mode adapters move to boring-bash/host composition after compatibility shims.
- Package invariant test: no agent value import from boring-bash **[landed: `scripts/check-invariants.mjs` — extend to the façade]**.
- Add `runtime: 'none'` / `features: []` path.
- Separate `sessionStorageRoot` from workspace roots.
- Audit pi-coding-agent cwd/resource assumptions (blocks pure-mode exit; decision: sealed pi harness, not a second harness).
- Add external hook and operational event seams if route composition changes.

Exit criteria:

- pure agent starts via `createAgent({ runtime: 'none' })` with no workspace/sandbox/cwd/file routes/bash tools, in a plain Node script with no Fastify;
- existing direct/local/vercel modes still work through host composition;
- all current HTTP consumers unchanged.

## Phase T1 — Event envelope and replay (after Phase 1)

Deliverables:

- `AgentEvent` envelope (`v`, `eventIndex`, `timestamp`, `sessionId`, `chunk`) around the existing `UIMessageChunk` stream; monotonic index persisted with the session transcript.
- `agent.replay(sessionId, { startIndex })`; HTTP adapter `GET …/events?startIndex=N`.
- Approvals/HITL on-stream: `needsApproval` on `AgentTool`; approval/input-request events; `resolveInput()`; durable `session.waiting` park/resume. Migrate permission prompts + ask-user plugin onto this path (no second approval channel).
- Harness conformance suite additions: envelope ordering, replay-from-index, approval park/resume (extends #12 conformance).

Exit criteria: SSE drop + reconnect replays losslessly in the workspace; an approval issued in one client can be answered from another client holding the same session.

## Phase T2 — Transport adapters

Deliverables:

- Transport contract (`send` + `reconnect`) documented; in-process transport (direct `createAgent()` consumption) and HTTP+SSE adapter both pass a shared transport conformance suite.
- `useAgentChat`/ChatPanel refit to consume only the public contract (no internal imports); custom `ChatTransport` reconnect wired to `startIndex` replay.
- Two-handles rule enforced: public agent APIs accept `sessionId` only; `x-boring-workspace-id`→`SessionCtx` mapping is HTTP-adapter code, documented as the pattern surface adapters replicate.

Exit criteria: workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI.

## Phase 2 — `@hachej/boring-bash` package (bash track)

Deliverables:

- package skeleton and exports **[landed via #416: skeleton, shared filesystem-binding contracts, readonly/management company-context operations, fixture provider, leakage/conformance tests]**;
- provider capability model; mode/provider mapping docs;
- move concrete provider implementations (direct, bwrap, vercel-sandbox, remote-worker client) to `boring-bash/providers`;
- provisioning ownership docs: agent owns engine/types over injected adapters; boring-bash owns requirement normalizer and provider adapters;
- remote-worker split docs: protocol/shared types, client/provider adapter, optional server package path;
- compatibility strategy: type-only old-path exports where safe; moved values must not be re-exported from agent/workspace if that creates cycles — host/composition shims or explicit import migrations instead.

Do not move providers until Phase 1 injection is complete.

Exit criteria: package builds; no import cycle; current apps still compile after import migration or safe host-level shims; landed #416 contracts unchanged (governance consumers #476–#501 keep working).

## Phase 3 — Move server routes and tools (bash track)

Deliverables:

- move file/tree/search/fs-events/stat/dir routes to `boring-bash/server` — preserving the `(filesystem, path)` addressing **[landed for routes/tools wiring via #429/#454: `filesystem` param, spoof guard, readonly enforcement — this phase moves the code, not the behavior]**;
- move filesystem tools to `boring-bash/agent`; move or explicitly assign `bash`, `execute_isolated_code`, and upload tools;
- preserve readiness tags and `disableDefaultFileTools`;
- replace hardwired registration with `createBashAgentFeature()` consumed as `features` by `createAgent()`.

Exit criteria: workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled; pure mode still has none of those routes/tools; company_context no-leak conformance still green.

## Phase 4 — Move filesystem front plugin (bash track)

Deliverables: move filesystem front plugin to `boring-bash/plugin`; preserve panel ids and `workspace.open.path` resolver; preserve file panel binding and agent file bridge/session changes **[Company file-tree root + capability-based readonly panes landed via #416 — carry over intact]**; add `FileTreeDataProvider` boundary; add document-authority override seam.

Exit criteria: `exec_ui openFile` still opens files; file tree can consume provider boundary; active document coordinator can intercept writes.

## Phase 5 — Extend provisioning/readiness (bash track)

Unchanged from v1: `BashRequirement` normalizer outside agent feeding `provisionWorkspaceRuntime()` via host/core/CLI composition; re-point callers; import-free requirement validation; per-requirement readiness metadata; `optional_failed` derived state; health checks; SDK archive support; managed service requirements; secret status/grant model; remote-worker capability handshake; two-phase bootstrap/onSession reconciliation.

Additional v2 deliverable: **credential brokering rule** — secrets are injected at the environment boundary (provider adapter), never into the sandbox process env or the model transcript (08 trust boundary).

Exit criteria: as v1, plus: no test can read a brokered secret from inside the sandbox.

## Phase E1 — Environment registry and attachments (after Phase 2; see 09)

Deliverables:

- `Environment` / `EnvironmentAttachment` / `EnvironmentRegistry` contracts in boring-bash (generalizing, not replacing, the landed #416 binding shapes); `company_context` re-expressed as the reference environment + readonly attachment.
- Scoped views (`scope.subpath`) enforced by the environment host; subagents attach explicitly (same handle or scoped view) — no cwd inheritance.
- `createBashAgentFeature()` re-expressed as attachment sugar; agent core sees `ResolvedEnvironments` type-only (invariant-checked).
- Environment conformance suite extended to scoped-view attachments.

Exit criteria: existing workspace + company_context behavior unchanged (governance consumers green); a subagent can be attached to a scoped view of the parent's environment; an agent can hold two environments with distinct `filesystem` identities.

## Phase E2 — MCP environment projection (after E1)

Deliverables:

- MCP server projection for any registered environment: fs ops (+ exec where policy allows) as MCP tools, enforcement via the existing readonly/management projection operations; MCP session → `BoundFilesystemContext` identity mapping.
- No-leak conformance suite runs against the MCP projection (same suite, fourth mount: in-process / scoped / remote-worker / MCP).
- Remote-worker reclassified in docs as an environment transport.

Exit criteria: an external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process readonly attachment sees; denied files absent over MCP; no broker secret reachable from the client.

## Phase S1 — Slack reference channel (after T2; parallel to Phases 4–5)

Deliverables:

- `@hachej/boring-channel-slack` (`packages/channels/slack`): **thin adapter over `@flue/slack` ingress** (pinned; signature verification, payload parsing, `conversationKey` come from the package) — we write only: callback → `agent.send()`, `conversationKey → sessionId` store, egress + approval blocks via `@slack/web-api`, Hono→Fastify handler wrapper (shared, reusable for every other `@flue/*` channel).
- Surface adapter conformance suite (first consumer): message-in/events-out, approval round-trip, addressing isolation.
- Runs against `runtime: 'none'` and against readonly `company_context` bindings (governed-context answering in Slack).

Exit criteria: same agent + same session store serves the workspace UI and a Slack thread; an approval requested in Slack can be answered in Slack or the workspace; Slack package imports only the public agent contract + `@flue/slack`; adding a second channel (e.g. Teams) requires no new ingress code beyond the per-channel callback.

## Phase S2 — Spreadsheet embed (pi-excel) (after S1 learnings)

Deliverables:

- Embedding guide + client contract for mounting the agent inside another product: host supplies domain tools (read/write range etc.) as `tools`, `runtime: 'none'`, optional readonly bindings; approvals via host dialog.
- Reference implementation in the pi-excel plugin (or the closest existing spreadsheet surface) consuming only the published contract.

Exit criteria: the embed has no boring-bash dependency; tool outputs project into the sheet; conformance suite passes.

## Phase 6 — Plugin and child-app integration

Unchanged from v1 (consume shared child-app platform context; `AgentRegistry` introduction; import-free `boring.requires`/`bash` manifest validation; hosted plugin fail-closed; Macro scoping; multi-tenant reload). Prerequisite unchanged: do not define a competing child-app registry here.

Exit criteria: as v1.

## Phase 7 — Multi-agent routing/session/search

Unchanged from v1 (`agentId`-scoped routes or request-scope equivalent against the Phase 6 `AgentRegistry`; binding scope key and `sessionNamespace` include `agentId`; per-agent catalog/readiness; scoped session search; external hook target resolution).

v2 note: surface adapters address agents through the same `agentId` scoping; a Slack channel or embed binds to one `agentId` per addressing entry.

Exit criteria: as v1, plus: two surfaces bound to two agents in one workspace do not collide.

## Phase 8 — Cleanup and deprecation

Unchanged from v1: remove remaining compatibility exports after the migration window; update package docs; migration notes for app authors; convert remaining plan tasks into beads/issues.

Additional v2 exit criterion: `@hachej/boring-agent` README documents the four-part surface contract (08) as the stable public API.
