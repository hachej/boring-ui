# 06 — Migration phases (v2)

## Rules

1. Dependency inversion happens before package extraction. Otherwise we create an agent↔bash import cycle.
2. Each phase must preserve existing workspace behavior unless that phase explicitly changes a documented invariant.
3. v2 adds two tracks on top of the original bash track: **Track T (transport/event contract)** and **Track S (surfaces)**. Bash-track phase numbers are unchanged so existing beads/TODOs keep their references.
4. Reconciliation: work that already landed via #416 (company-fs PR stack #437/#440/#429/#454) is marked **[landed]** and must not be redone — later phases build on it.

## Track overview and ordering

```txt
Phase 0 ─ Phase 1 ──┬── Phase 2 ── Phase 3 ──┬── Phase 4 ── Phase 5 ── Phase 6 ── Phase 7 ── Phase 8
   (ADR)  (headless │   (bash pkg)  (routes/  │   (file UI)  (provis./  (plugins/  (multi-    (cleanup)
          core)     │               tools)    │              readiness) child-app) agent)
                    │                          └── Phase E1 ─────────── Phase E2
                    │                              (env attachments/     (MCP env
                    │                               resolveAttachments)   projection)
                    └── Phase T1 ── Phase T2 ──┬──────────── Phase S1 ── Phase S2
                        (event      (transport  │            (Slack      (pi-excel
                         envelope)   adapters)   │            channel)    embed)
                                                 └── Phase S3 (control-plane UX; also needs Phase 7)
```

Track T starts after Phase 1 and runs parallel to Phases 2–4. Track S needs T2 (S1→S2); **S3 needs T2 and Phase 7** (it consumes the Phase 7 `/info` inspection endpoint + scoped session search). Track E (environments as attachable resources, 09) starts after Phase 3 (E1 depends on Phase 2 **and** Phase 3 — it re-implements the P3 bash bundle's internals over attachments without changing its public signature) and runs parallel to Phases 4–5; E2 needs E1 only. Governance work (#475 line) continues independently on the landed #416 contracts.

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

- `createAgentApp()` / `registerAgentRoutes()` receive the runtime adapter and any extra tools (incl. the boring-bash bundle's `{ tools, readinessRequirements }`) by injection — no `features` registry, no `AgentFeature` contract.
- **Export `createAgent()`** from `@hachej/boring-agent/core` — the canonical Fastify-free public entry for `createAgent()` everywhere: façade returning the **nine** members `{ start, stream, send, resolveInput, interrupt, stop, sessions, readiness, dispose }` (see 08). `start(input): Promise<{ sessionId, startIndex }>` is the accepted-receipt write primitive (turn runs on an independent producer, never consumer-backpressured); `stream(sessionId, { startIndex })` is the replay+live-tail read primitive (replaces `replay()`); `send` = convenience over both; `interrupt(sessionId)` aborts the current turn and `stop(sessionId)` ends/closes the session. `createAgentApp()` becomes an adapter over it. The `@hachej/boring-agent/server` barrel is an **adapter that re-exports `createAgent` from `/core`** for convenience only — it carries no contract status; the Fastify-free guarantee is anchored on `/core`.
- Typed config object only: no env-var reads or file discovery inside `createAgent()`; `.pi/*`, workspaces.yaml, env parsing move to host/CLI composition.
- Remove static value imports from agent server composition to built-in mode resolution where needed for pure mode. Type-only `RuntimeModeAdapter` contracts may stay in agent during migration; `resolveMode()` and concrete mode adapters move to boring-bash/host composition after compatibility shims.
- Package invariant test: no agent value import from boring-bash **[landed: `scripts/check-invariants.mjs` — extend to the façade]**.
- Add the pure `runtime: 'none'` path (no bash bundle spread into `tools`).
- Separate `sessionStorageRoot` from workspace roots.
- Audit pi-coding-agent cwd/resource assumptions (blocks pure-mode exit; decision: sealed pi harness, not a second harness).
- Add the boring-bash-free operational event/command seam (reload, slash commands, compaction/provider recovery, session notices) if route composition changes. (**External** hook request/callback/redaction contracts and their target resolution are **not** Phase 1 scope — they depend on durable approvals (T1) and land in Phase 7; see Phase 7 "external hook target resolution".)

Exit criteria:

- pure agent starts via `createAgent({ runtime: 'none' })` with no workspace/sandbox/cwd/file routes/bash tools, in a plain Node script with no Fastify;
- existing direct/local/vercel modes still work through host composition;
- all current HTTP consumers unchanged.

## Phase T1 — Event envelope and replay (after Phase 1)

Implementation choice (08, verified): adopt the **Durable Streams wire protocol** — embed an append-only SQLite `EventStreamStore` + DS-compliant read handlers (adapt Flue's ~1000-line Apache-2.0 framework-agnostic implementation, fixing the non-transactional append) behind a Fastify bridge; use `@durable-streams/client` in browser/channel consumers. Do not design a bespoke replay protocol.

Deliverables:

- `AgentEvent` envelope (`v`, `eventIndex`, `timestamp`, `sessionId`, `chunk`) around the existing harness stream unit (`PiChatEvent`); monotonic index persisted in the append-only SQLite `EventStreamStore` (DS `seq`/offset). Supersedes the bespoke `PiChatReplayBuffer` + `?cursor=` NDJSON replay (kept live until T2 cutover).
- **Two authorities, separate:** the SQLite `EventStreamStore` is the **replay authority**; the pi session JSONL remains the **conversation-state authority** for harness rehydration (unchanged — existing sessions keep loading). Pending approval requests live in the event-stream SQLite DB, not the JSONL/session store.
- `agent.stream(sessionId, { startIndex })` (replay-from-offset + live tail — the read primitive from 08); HTTP adapter = DS-compliant `GET`/`HEAD` stream routes (catch-up from offset, SSE + long-poll).
- Approvals/HITL on-stream: `needsApproval` on `AgentTool`; approval/input-request events; `resolveInput()`. **Durable = the pending request + `session.waiting` state (event-store SQLite), not an in-memory turn.** Same-process resume continues the live parked turn; after a process restart, `resolveInput` continues the session via a **new harness turn seeded with the approval outcome** (tool-result injection on pi JSONL rehydration) — no rehydrated in-memory continuation, no `WaitingTurn` state machine. Migrate permission prompts + ask-user plugin onto this path (no second approval channel).
- Harness conformance suite additions: envelope ordering, replay-from-index, durable pending-request survival across restart, same-process approval park/resume (extends #12 conformance).

Exit criteria: SSE drop + reconnect replays losslessly in the workspace; an approval issued in one client can be answered from another client holding the same session; after a process restart the pending request + `waiting` state survive and `resolveInput` continues the session via a new seeded turn (a parked turn does not resume from restored in-memory state).

## Phase T2 — Transport adapters

Deliverables:

- Transport contract (`send` + `reconnect`) documented; in-process transport (direct `createAgent()` consumption) and HTTP+SSE adapter both pass a shared transport conformance suite.
- Front transport refit (`RemotePiSession`/`usePiSessions`/`PiChatPanel` — the actual client stack) to consume only the public contract (no internal imports); reconnect wired to DS `startIndex` replay via `@durable-streams/client`.
- Two-handles rule enforced: public agent APIs accept `sessionId` only; `x-boring-workspace-id`→`SessionCtx` mapping is HTTP-adapter code, documented as the pattern surface adapters replicate.

Exit criteria: workspace UI runs unmodified against the refit; a headless Node consumer drives the same session interleaved with the UI.

## Phase 2 — `@hachej/boring-bash` package (bash track)

Deliverables:

- package skeleton and exports **[landed via #416: skeleton, shared filesystem-binding contracts, readonly/management company-context operations, fixture provider, leakage/conformance tests]**;
- provider capability model; mode/provider mapping docs;
- move concrete provider implementations (direct, bwrap, vercel-sandbox, remote-worker client) to `boring-bash/providers`;
- provisioning ownership docs: agent owns engine/types over injected adapters; boring-bash owns requirement normalizer and provider adapters;
- remote-worker split docs: protocol/shared types, client/provider adapter, optional server package path;
- migration strategy (v2, strict): **migrate every importer in the same PR** — no type-only old-path exports, no re-export stubs, no host shims that outlive the phase. Intra-phase transitional code carries `// TODO(remove:<bead-id>)` + a deletion bead (see `todos-v2/README.md` "Simplicity & no-compat policy").

Do not move providers until Phase 1 injection is complete.

Exit criteria: package builds; no import cycle; current apps still compile after same-PR importer migration (no old-path re-export, no host shim); landed #416 contracts unchanged (governance consumers #476–#501 keep working).

## Phase 3 — Move server routes and tools (bash track)

Deliverables:

- move file/tree/search/fs-events/stat/dir routes to `boring-bash/server` — preserving the `(filesystem, path)` addressing **[landed for routes/tools wiring via #429/#454: `filesystem` param, spoof guard, readonly enforcement — this phase moves the code, not the behavior]**;
- move filesystem tools to `boring-bash/agent`; move or explicitly assign `bash`, `execute_isolated_code`, and upload tools;
- preserve readiness tags and `disableDefaultFileTools`;
- replace hardwired registration with `createBashAgentFeature()` — **defined once in Phase 3** — returning a plain boring-bash-local bundle `{ tools, readinessRequirements }` (not a core `AgentFeature` contract) that host composition **spreads into the `createAgent()` config** (`tools: [...bashBundle.tools]`, readiness gates from the bundle). There is no `features` config member.
- E1 (which depends on P2 **and** P3) may later re-implement the bundle's **internals** over environment attachments **without changing its public `{ tools, readinessRequirements }` signature**.

Exit criteria: workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled; pure mode still has none of those routes/tools; company_context no-leak conformance still green.

## Phase 4 — Move filesystem front plugin (bash track)

Deliverables: move filesystem front plugin to `boring-bash/plugin`; preserve panel ids and `workspace.open.path` resolver; preserve file panel binding and agent file bridge/session changes **[Company file-tree root + capability-based readonly panes landed via #416 — carry over intact]**; factor tree data into a plain internal tree function (the pluggable `FileTreeDataProvider` boundary is **deferred to #295**, per `todos-v2/TODO-P4-file-ui-plugin.md`). The **document-authority override seam is deferred out of this epic** (zero real consumers — no live document system exists; it arrives with #367/#226), per `todos-v2/TODO-P4-file-ui-plugin.md` BBP4-013.

Exit criteria: `exec_ui openFile` still opens files; file tree data flows through one internal function with unchanged behavior (provider boundary deferred to #295). (Document-authority override deferred out of this epic — `write`/`edit` stay raw file ops.)

## Phase 5 — Extend provisioning/readiness (bash track; hard dependency P3, parallel to P4)

Phase 5's hard prerequisite is **Phase 3** (routes/tools moved + host-composed bash bundle) plus the **Phase 2** provider capability matrix; it does **not** gate on Phase 4. The linear `Phase 4 ── Phase 5` arrow in the track overview reflects bash-track numbering, not a Phase-4→Phase-5 dependency: Phase 5 runs parallel to Phase 4.

Unchanged from v1: `BashRequirement` normalizer outside agent feeding `provisionWorkspaceRuntime()` via host/core/CLI composition; re-point callers; import-free requirement validation; per-requirement readiness metadata; `optional_failed` derived state; health checks; SDK archive support; managed service requirements; secret status/grant model; remote-worker capability handshake; two-phase bootstrap/onSession reconciliation.

Additional v2 deliverable: **credential brokering rule** (00 invariant 14, 08 trust boundary) — brokered secrets are host-side handles consumed **only by trusted-core tools**; they **never enter any sandboxed environment** or the model transcript. There is no raw-env injection path: the `direct` provider is not a sandbox (a host process running as the developer with their own ambient environment), so nothing is "injected" there either — the distinction is sandbox vs. host process, not an exception clause.

Exit criteria: as v1, plus: no test can read a brokered secret from inside the sandbox; no brokered secret is reachable from inside any sandboxed environment (there is no raw-env injection path — the `direct` provider is a host process, not a sandbox).

## Phase E1 — Environment attachments (after Phase 2 **and** Phase 3; see 09)

Deliverables:

- `Environment` / `EnvironmentAttachment` / `ResolvedEnvironments` contracts in boring-bash (generalizing, not replacing, the landed #416 binding shapes); `company_context` re-expressed as the reference environment + readonly attachment.
- Scoped views (`scope.subpath`) enforced by the environment host — no cwd inheritance. (The subagent attachment seam that consumes scoped views is deferred to Phase 7, the first real subagent consumer.)
- agent core sees `ResolvedEnvironments` type-only (invariant-checked).
- A thin `resolveAttachments` adapter reduces attachments to the existing #416 `FilesystemBinding[]` via the landed `ScopedFilesystemRuntimeBindingManager` — **no `EnvironmentRegistry` class and no new prepare/dispose lifecycle**. Address-by-id lookup (a plain `Map<environmentId, Environment>`) is deferred to **E2**, where the MCP projection needs it.
- Environment conformance suite extended to scoped-view attachments.

Exit criteria: existing workspace + company_context behavior unchanged (governance consumers green); a scoped view of an environment can be attached and is physically jailed (subagent consumer deferred to Phase 7); an agent can hold two environments with distinct `filesystem` identities.

## Phase E2 — MCP environment projection (after E1)

Deliverables:

- MCP server projection for any environment: fs ops (+ exec where policy allows) as MCP tools, enforcement via the existing readonly/management projection operations; MCP session → `BoundFilesystemContext` identity mapping. E2 introduces the address-by-id lookup (a plain `Map<environmentId, Environment>`) it needs to resolve an environment by id.
- No-leak conformance suite runs against the MCP projection (same suite, MCP mount; delivered mounts by name: in-process, scoped-view, MCP — the remote-worker provider mount is deferred to BBP5-010).
- Remote-worker stays a provider in this epic (P2/P5). Reclassifying it as an environment transport is **deferred to a post-E2 follow-up filed at P8** — not an E2 deliverable.

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

Unchanged from v1 (`agentId`-scoped routes against the Phase 6 `AgentRegistry`; per-agent catalog/readiness; scoped session search; external hook target resolution). The binding/route scope key includes `agentId` for **all** agents; **`sessionNamespace` includes `agentId` for non-default agents only — the default agent keeps its pre-P7 `sessionNamespace` unchanged** as an explicit on-disk JSONL-compatibility exception (per `TODO-P7` BBP7-003 and `05-multi-agent-sessions-hooks.md`).

v2 additions:

- surface adapters address agents through the same `agentId` scoping; a Slack channel or embed binds to one `agentId` per addressing entry;
- **agent inspection endpoint** `GET /api/v1/agents/:agentId/info` (model, tools, readiness, channels, environments — eve `/eve/v1/info` analog) consumed by workspace panels: the steering-surface mechanism (08, 00 "North star").

Exit criteria: as v1, plus: two surfaces bound to two agents in one workspace do not collide.

## Phase 8 — Cleanup and deprecation

v2 rewrite — Phase 8 is a **verification** phase, not a deferred-deletion dump: assert zero `TODO(remove:*)` markers remain repo-wide (add the check to the invariant scripts); update package docs; convert remaining plan tasks into beads/issues. There is no "migration window" — all import migrations happened in-PR per the no-compat policy (`todos-v2/README.md`).

Additional v2 exit criterion: `@hachej/boring-agent` README documents the four-part surface contract (08) as the stable public API.
