---
program: durable-streams (canonical tracker: docs/plans/multiagent-shell/programs.md — no umbrella issue by owner triage 2026-08-27)
acceptance-issue: https://github.com/hachej/boring-ui/issues/1348
issue: 1348
state: draft — awaiting fresh-eyes + cross-model review, then owner gate 1
updated: 2026-08-29
flag: flag:BORING_CHAT_DURABLE_STREAM (existing; A1–A4 preserve its off-path byte-identical; P1-C flips it)
track: owner
beads: wt-391-forward-9p50 epic — .3 A2 · .1 A1 · .4 A3 · .5 A4 · .6 A5 · .7 P1-B · .2 P1-C
supersedes: the r3 A1–A4 numbering in docs/plans/durable-streams-plan.md (mapped per section; r3 stays the goal/gap record)
---

# Durable streams P1-A — the substrate-neutral layer (detailed plan)

## Problem

D29's own re-evaluation trigger has fired: multi-agent Threads need a
substrate a client can always resume. Today the gateway runs at conformance
Level B (bounded in-memory replay + snapshot rehydrate); the four Level D
conformance cases are empty skips; a hub restart cancels every pending owner
gate (#1348), orphans in-flight requests forever, reports every session idle,
and cannot re-enter a paused turn after the human answers (#1413). The pi
wait on the event backend was removed (RECONCILIATION §9c), so P1-A must be
buildable now and P1-B must plug a Boring backend under it without touching
the gateway again.

## Solution

Five beads, one per slice, dispatched in this order — **A2 first**:

```
A2 seam ─┬─► A1 identity ─► A3 ledger (a: gates survive · b: resume) ─► A4 activity+resume ─► A5 proofs
         └─► P1-B Boring event backend (after A2 only) ─► P1-C Level D + default-on + D29 addendum
```

`A1` may run in parallel with `A2` (disjoint files); `A3` needs both; `A4`
needs `A3` hard; `A5` is written failing-first any time and goes green after
`A4`. P1-B needs only A2.

## Cross-section reconciliation (the owner-visible decisions the five drafts forced)

| Conflict found across the section drafts | Resolution recorded here |
|---|---|
| A3 needs `resumePausedToolCall` on the seam; A2's interface is "existing call sites only" | A2 ships the minimal seam. **A3b adds `resumePausedToolCall` as an additive seam extension**, covered by the same `harnessBackendConformance` suite (case: resume-after-restart is idempotent on `resumeRequestId`). The seam doc states it is extended only by named P1 slices. |
| A3 and A4 both introduced a per-boot host `incarnation` | **A3 owns it** (`ledger_meta` row, claimed at boot); A4 only exposes it on `AgentHostRuntime` and the `/events` response headers. |
| A4's activity seed needs a ledger scan API; A3's interface only had `read(key)` | **A3 ships `listNonTerminal({states, operations, workspaceScopeId?})`**; A4 consumes it. |
| A3's e2e and A5's journeys both need the scripted harness to *really execute* `ask_user` | **One shared prerequisite** — the `@@scripted` directive grammar + real tool execution + per-message persistence — built by whichever of A3/A5 lands first, tracked as its own bullet on both beads. |
| A4's restart e2e and A5's journeys both need a kill/respawn host helper on a fixed port | **One helper** (`hostProcess.ts` + `port` option on `spawnBackend`), same rule. |
| A1 corrected DIRECTION §Lane reality: the `userId` slot is already empty on all addressed routes | Recorded in A1; DIRECTION gets a one-line errata in the PR that lands A1. |

## Decisions (owner, minimal)

1. **Session key = `(workspaceScopeId, sessionId)`; `agentTypeId` a required attribute, not a key** (A1). Alternative — key on agent too — contradicts §9a's multi-Seat projection.
2. **v1 rows migrate in place (schema_version 1→2, quarantine-never-drop)** (A1), vs discard-behind-flag.
3. **The seam is private to the D29 funnel; no public `harnessBackendFactory`** (A2). A public injection point is the parallel session path Pi rule 1 forbids.
4. **Effect classes on tools (`observe · propose · mutate · external-effect · pause`), unknown = external-effect (fail-closed)** (A3).
5. **Graceful drain never cancels a gate; only owner cancel / expiry / supersede write terminal attention states** (A3) — this is the #1348 fix.
6. **Restart proofs use process SIGKILL + respawn, never in-process teardown** (A5).

## Flag / Abstraction
- Needed?: no new flag. `BORING_CHAT_DURABLE_STREAM` gates the event store today and P1-B's backend selection tomorrow; A1–A4 keep the flag-off composition byte-identical.
- Path: A2 = pure refactor (revert = rollback); A1 = schema 1→2 with old-binary refusal as the fence; A3/A4 = additive tables/fields, `inMemoryRequestLedgerMode` unchanged.
- Rollback: flag off → in-memory Level B, as today.

## Test Seams
- Highest public seam: `AgentGateway` (frozen 7-method contract) via `gatewayConformance` — unchanged surface, Level D cases un-skipped only in P1-C.
- New internal seams with their own conformance: `AgentHarnessBackend` (A2), `PiChatReplaySource` (A4), ledger record kinds (A3).
- Existing prior art: `embeddedGatewayFixture` fake service; `pi-native-cross-hub-continuation.spec.ts` restart pattern; `spawnBackend` helper.
- Avoid testing: pi internals; live-model behavior as acceptance (labelled smoke only).

## Acceptance

P1-A is done when: A2's backend conformance passes against both the pi-session adapter and the in-memory fake; A1's migrator round-trips fixtures and the CI invariant forbids any second key grammar; #1348's e2e (SIGTERM + SIGKILL) keeps a gate `ready` and routes the answer once; A4's Level D activity case is green and the resume contract is in `AGENT_GATEWAY_V0.md`; A5's two journeys are green in **both** playground and full-app with their mutation controls red-by-design. P1-C then cites A5's evidence in the D29 addendum.

## Proof
- Exact commands: per section below (each slice lists its own).
- Screenshot/demo: A5 evidence bundles (`.handoff/p1a5-*.{json,png}`) per host.
- Manual steps: `BORING_CHAT_DURABLE_STREAM=1` playground smoke — create session → kill host → respawn → reconnect (A1, A4).
- Waiver: none.

## Slices

| Slice | Bead | Blocked by | Sessions | Ships |
|---|---|---|---|---|
| A2 harness seam | `9p50.3` | — | 2 | private `AgentHarnessBackend`, pi adapter, backend conformance, 2 CI invariants |
| A1 identity + migration | `9p50.1` | — (A2 recommended first) | 1.5 | key grammar, owners table, v1→v2 migrator, `SESSION_IDENTITY.md` |
| A3 ledger (a+b) | `9p50.4` | A1, A2 | 3 | effect + attention records, incarnation/reconcile, ledger-backed ask-user, #1348, #1413 resume |
| A4 activity + resume | `9p50.5` | A3 (hard), A1 (tail corroboration) | 2 | `PiChatReplaySource`, resume contract, activity reconstruction, restart e2e |
| A5 proofs | `9p50.6` | A2, A3, A4 (to go green) | 3 | two journeys × two hosts, mutation controls, evidence bundles |
| P1-B Boring backend | `9p50.7` | A2 | (own plan) | store-backed `readSnapshot().seq` + `watchEvents` behind the seam |
| P1-C Level D + default-on | `9p50.2` | P1-B, A5 | (own plan) | un-skip Level D cases, flip flag, D29 addendum |

Review budget: every slice is inside budget individually; A3 and A5 are 3-session beads by design and split further only if a worker bounces them twice.

## Out of Scope

Store-backed replay and retention (P1-B); flipping the default and the D29 addendum (P1-C); Thread storage or ids (P2 shape spike); `seatId` semantics (P3); the legacy `core/createAgent` facade and `AgentLiveEventBuffer`; transcript-directory re-namespacing (r3 A4); pi-v2 adapters; metering durability; approval RBAC.

## Open Questions

- (owner) Decisions 1–2 above — the only two that change durable bytes.
- (A3b spike, inside the slice) pi 0.80.7 behavior on a transcript with a dangling tool call — resume may need a transcript-rewrite path.
- (A4, inside the slice) whether front zod schemas are strict for the additive summary field.

---

# Section plans (dispatch order)
## P1-A2 — Private `AgentHarnessBackend` seam under the D29 gateway

Bead: `wt-391-forward-9p50.3`. **Numbering map:** r3 `durable-streams-plan.md` A1–A4 ≠ premises P1-A1..A5. r3-A1 (keying ratification + migrator, `:140-158`) ≈ premises **A1**; r3-A2 (store-backed replay read path, `:160-180`) ≈ **P1-B** plus the flag-flip/D29 part of **P1-C**; r3-A3 (crash-proof turn lifecycle, `:182-208`) ≈ premises **A3 + A4**; r3-A4 (storage decoupling, `:210-219`) folds into A1 or later. **Premises A2 — this seam — has no r3 counterpart**; it comes from the removal map (`pi-v2-removal-map.md:74-95`) and the Pi rules (`premises.md:109-112`).

### Today

**The gateway already talks to a service-shaped object, but that object is a concrete pi class.**
- `BuiltAgentComposition.service: HarnessPiChatService` — a concrete class, not an interface (`packages/agent/src/server/agent-host/buildAgentComposition.ts:135`), constructed at `:318-328` with `harness`, `sessionStore`, `eventStore`, `metering`, `onEvent`.
- `EmbeddedAgentGateway` calls `binding.composition.service.{createSession,readState,subscribe,prompt,followUp,interrupt,stop,clearQueue,deleteSession,listSessions}` (`embeddedGateway.ts:406-419, 442-444, 463-479, 518, 532, 546, 580, 604, 687, 749`) and reaches around it to `binding.composition.sessionStore.rename` (`:623-631`). It builds the pi request context by hand in `context()` (`:72-83`: `workspaceId = storageScope = claim.workspaceScopeId`, `authSubject`, `sessionAuthority: 'workspace-scope'`).
- Two more consumers of the same concrete service: the attachment route via `resolveProjectionPiChatService` (`createAgentHost.ts:900-912`, consumed at `httpProjection.ts:376-387`), and the trusted-host binding `ensurePiSessionBound` (`trustedPiSessionBinding.ts:34-41`; implemented at `harnessPiChatService.ts:1371-1380`).
- The one interface that exists, `PiChatSessionService` (`core/piChatSessionService.ts:58-70`), is pi-named, carries `PiSessionRequestContext` with legacy user-keyed semantics (`:18-27`), and is not what composition types the binding as.

**Where pi is actually invoked.** `HarnessPiChatService.getAdapter` → `this.harness.getPiSessionAdapter(...)` (`harnessPiChatService.ts:1143-1165`), implemented by the pi harness at `createHarness.ts:881-885`; the adapter's native event feed is subscribed at `harnessPiChatService.ts:1271-1280`. Nothing under `server/agent-host/**` imports `@mariozechner/pi-*` today (pi imports outside `server/harness/` are `http/routes/{models,skills}.ts`, `models/modelConfig.ts`, `pi-chat/piChatEvents.ts`, `piResourceDigest.ts`, `skillFrontmatter.ts`, `testing/scriptedPiHarness.ts`, `shared/harness.ts`).

**Replay source and durable store.** Live replay is the in-memory `PiChatReplayBuffer` (`pi-chat/piChatReplayBuffer.ts:30-139`, 1000-event ring). With `BORING_CHAT_DURABLE_STREAM` (`buildAgentComposition.ts:38-44`) a `SqliteEventStreamStore` (`events/eventStreamStore.ts:94`) is injected; publishes append-then-fan-out (`harnessPiChatService.ts:1048-1066`) and a cold channel hydrates only `min(1000, MAX_READ_LIMIT)` trailing rows into the ring (`:1313-1364`). `subscribe` still serves from the ring (`:440-446`). Stream path is `sessions/<sessionCacheKey>` (`:1238`, `shared/events.ts:64`) where `sessionCacheKey = JSON([sessionId, workspaceId, userId])` (`:1628-1630`) — the A1 identity question. `AgentLiveEventBuffer` (`core/createAgent.ts:519`) belongs to the legacy `Agent` interface path, which has **no consumers** in workspace/core/cli/apps — not on the gateway path.

**Conformance.** `gatewayConformance.ts` is `replayLevel: 'B'` only (`:16`) and the four Level D cases are `it.skip` (`:674-677`). The gateway fixture already proves the gateway runs over a non-pi in-memory fake (`__tests__/embeddedGatewayFixture.ts:39` `FakeService implements PiChatSessionService`, wired at `:274-285`).

### Delta

Introduce one private, server-side interface — `AgentHarnessBackend` — as the *only* thing `EmbeddedAgentGateway`, the attachment projection, and the trusted binding may call for session runtime; ship the pi-session implementation as an adapter over the unchanged `HarnessPiChatService`; retype the fixture's fake as the in-memory implementation; add a backend conformance suite run against both; add CI invariants that pin the seam private and pi-free at the gateway layer. No behavior change, no wire change, no new flag.

### WHAT

A funnel-private backend seam: `AgentGateway` (D29, frozen) → `EmbeddedAgentGateway` → **`AgentHarnessBackend`** → {`PiSessionHarnessBackend` today | P1-B's Boring event backend | a future pi-v2 substitute}. Satisfies Pi rules 1, 3, 4 structurally and gives rule 2 (reconciliation) a named contract point; the crash matrix itself is A3.

#### Interface sketch (`packages/agent/src/server/agent-host/harnessBackend/types.ts`, server-only)

```ts
import type { AgentSessionRef } from '../../../shared/gateway/types'
import type { PiChatEvent, PiChatSnapshot, PromptReceipt, FollowUpReceipt, QueueClearReceipt,
  CommandReceipt, StopReceipt, FollowUpPayload, QueueClearPayload, InterruptPayload, StopPayload } from '../../../shared/chat'
import type { SessionListOptions, SessionSummary } from '../../../shared/session'
import type { AgentPromptPayload, PiChatAttachmentResult } from '../../../core/piChatSessionService'

/** Workspace-scoped addressing (Pi rule 3). Shape == agentSessionKey tuple; pi ids stay internal. */
export interface HarnessSessionAddress { readonly workspaceScopeId: string; readonly ref: AgentSessionRef }
export interface HarnessAgentScope     { readonly workspaceScopeId: string; readonly agentTypeId: string }
/** authSubjectId is attribution only — never storage ownership (matches toSessionCtx workspace-scope branch). */
export interface HarnessRequestContext { readonly requestId: string; readonly authSubjectId: string }

export type HarnessWatchResult =
  | { readonly type: 'ok'; unsubscribe(): void; readonly closed?: Promise<void> }
  | { readonly type: 'replay_gap' | 'cursor_ahead'; readonly latestSeq: number; readonly minReplaySeq: number }

export interface AgentHarnessBackend {
  readonly id: string                                    // 'pi-session' | 'boring-event-stream' (P1-B)
  listSessions(scope: HarnessAgentScope, ctx: HarnessRequestContext, options?: SessionListOptions): Promise<SessionSummary[]>
  createSession(scope: HarnessAgentScope, ctx: HarnessRequestContext, init?: { title?: string }): Promise<SessionSummary>
  /** Validate identity + instantiate the live runtime handle (== ensurePiSessionBound). */
  openSession(address: HarnessSessionAddress, ctx: HarnessRequestContext): Promise<void>
  readSnapshot(address: HarnessSessionAddress, ctx: HarnessRequestContext): Promise<PiChatSnapshot>
  watchEvents(address: HarnessSessionAddress, ctx: HarnessRequestContext, cursor: number,
              subscriber: (event: PiChatEvent) => void): Promise<HarnessWatchResult>
  submitPrompt(address: HarnessSessionAddress, ctx: HarnessRequestContext, payload: AgentPromptPayload): Promise<PromptReceipt>
  submitFollowUp(address: HarnessSessionAddress, ctx: HarnessRequestContext, payload: FollowUpPayload): Promise<FollowUpReceipt>
  clearQueue(address: HarnessSessionAddress, ctx: HarnessRequestContext, payload: QueueClearPayload): Promise<QueueClearReceipt>
  interrupt(address: HarnessSessionAddress, ctx: HarnessRequestContext, payload: InterruptPayload): Promise<CommandReceipt>
  stop(address: HarnessSessionAddress, ctx: HarnessRequestContext, payload: StopPayload): Promise<StopReceipt>
  renameSession(address: HarnessSessionAddress, ctx: HarnessRequestContext, title: string): Promise<SessionSummary>
  deleteSession(address: HarnessSessionAddress, ctx: HarnessRequestContext): Promise<void>
  readAttachment(address: HarnessSessionAddress, ctx: HarnessRequestContext, messageId: string, index: number): Promise<PiChatAttachmentResult>
  close(): Promise<void>
}

/** Built once per RuntimeBinding by buildAgentComposition. Deliberately carries NO credentials, model catalog, or membership. */
export interface AgentHarnessBackendFactoryInput {
  readonly harness: AgentHarness; readonly sessionStore: SessionStore
  readonly workdir: string; readonly workspace?: Workspace
  readonly eventStore?: EventStreamStore
  readonly metering?: AgentMeteringSink; readonly onEvent?: (sessionId: string, event: PiChatEvent) => void
  readonly attachmentUrl?: HarnessPiChatServiceOptions['attachmentUrl']
}
```

Mapping to the removal-map sketch (`pi-v2-removal-map.md:80-85`): `openSession`=openSession, `readSnapshot`=readSnapshot, `watchEvents`=watchEvents, `submitPrompt`=submitPrompt(+submitFollowUp/clearQueue), `abortOperation`=interrupt/stop, `closeSession`=deleteSession/close. **`importSession` and `inspectOperation` are dropped** — no consumer today; activity is Boring's `AgentSessionActivityIndex` (`sessionInventory.ts:145`), so a backend-level inspect would duplicate it. Every method above has an existing call site; nothing else.

**Error semantics.** The backend throws stable-coded service errors (invariant 8; e.g. `codedError(..., ErrorCode.enum.SESSION_NOT_FOUND, 404)` at `harnessPiChatService.ts:1226`) and **never** `AgentGatewayError`; the gateway keeps sole ownership of D29 codes — `readSnapshot` failure → `AGENT_SESSION_NOT_FOUND` (today `embeddedGateway.ts:445`), `watchEvents` non-ok → `REPLAY_GAP`/`CURSOR_AHEAD` (`:480-488`), action failures via `stableServiceActionFailure` (`:593`, `:614`) which requires the adapter to rethrow service errors *unwrapped*. **Reconcile semantics (Pi rule 2, contract only in A2):** the gateway ledger is the outer transaction (`:827`, `:921`, `:960`); backend effects must be idempotent on `(address, clientNonce)` — already true for prompts via the metering-reservation `duplicate: true` receipt (`harnessPiChatService.ts:469-476`) and for appends via `idempotencyKey: String(seq)` (`:1053`). A2 writes this down in the seam doc and asserts the prompt-duplicate case in the backend conformance suite; the restart/crash matrix is A3.

**What P1-B substitutes.** Only `readSnapshot().seq` and `watchEvents` are substrate-replaceable (`premises.md:125-129`). P1-B implements `AgentHarnessBackend` as a decorator over `PiSessionHarnessBackend`: store-backed replay for those two, delegation for the rest. No second `AgentHarnessBackend` shape, no gateway edit.

### Scope

**Add**
- `packages/agent/src/server/agent-host/harnessBackend/types.ts` — the interface above.
- `packages/agent/src/server/agent-host/harnessBackend/piSessionHarnessBackend.ts` — `createPiSessionHarnessBackend(input)`: constructs `HarnessPiChatService` exactly as `buildAgentComposition.ts:318-328` does; one private `toPiSessionRequestContext(address|scope, ctx)` that reproduces `embeddedGateway.ts:72-83` byte-for-byte (the single A1 touchpoint); `renameSession` delegates to `sessionStore.rename` with the `AGENT_COMMAND_INVALID_STATE`-equivalent coded error when absent (today `:626-628`).
- `packages/agent/src/server/agent-host/testing/harnessBackendConformance.ts` — `harnessBackendConformance({ createBackend })`, sibling of `gatewayConformance.ts`.
- `packages/agent/src/server/agent-host/__tests__/harnessBackend.piSession.test.ts` (scripted pi harness, `testing/scriptedPiHarness.ts`) and `harnessBackend.inMemory.test.ts` (the fixture fake).
- Doc section "Private backend seam" in `packages/agent/docs/AGENT_GATEWAY_V0.md`; invariant 10 in `docs/procedures/coding-invariants.md`.

**Change**
- `buildAgentComposition.ts`: `BuiltAgentComposition.service` → `backend: AgentHarnessBackend`; construct via `createPiSessionHarnessBackend`; `dispose()` calls `backend.close()`. `harness`, `sessionStore`, `pi`, `tools`, `readyTracker`, `runtimeBundle` stay (consumed by `runtimeCapabilityProjection.ts:237-283, 358-372, 483-495` for reload/slash commands — a host-effect path, not a session path; out of scope).
- `embeddedGateway.ts`: every `composition.service.*` and `composition.sessionStore.rename` call → `backend.*`; delete `context()` and the `PiChatSessionService` import; `loadSummary`/`queueClearAdmission`/`promptAdmission` take `AgentHarnessBackend`.
- `createAgentHost.ts:900-912` → `resolveHarnessBackend`; `httpProjection.ts:37, 376-387` types accordingly (route body unchanged).
- `trustedPiSessionBinding.ts:34-41` → `backend.openSession`.
- `__tests__/embeddedGatewayFixture.ts`: `FakeService implements AgentHarnessBackend`; `resolveBinding` returns `composition: { backend }`.
- `scripts/check-invariants.sh`: add `run_check` "No pi runtime imports in src/server/agent-host/**" (pattern `from\s+['"]@mariozechner/pi-|@earendil-works/pi-`, path `src/server/agent-host`) and "Only harnessBackend/ may import HarnessPiChatService in agent-host" (`-g '!**/harnessBackend/**'`).
- `scripts/check-alignment-invariants.mjs`: extend `findConsumerInternalReferences` (`:121`) so consumer roots (`:8-13`) fail on any reference to `harnessBackend/` or the identifier `AgentHarnessBackend`, type-only included (matches the existing "even when type-only" fixture at `:198`).

**Not added:** no `harnessBackendFactory` on `CreateAgentHostOptions`. Injection stays `harnessFactory` (pi harness, `types.ts:402`); a public backend injection point would be exactly the parallel session path rule 1 forbids. P1-B selects its backend inside `buildAgentComposition` by the existing flag.

### Proof

```
pnpm --filter @hachej/boring-agent run test -- src/server/agent-host/__tests__/harnessBackend.piSession.test.ts
pnpm --filter @hachej/boring-agent run test -- src/server/agent-host/__tests__/harnessBackend.inMemory.test.ts
pnpm --filter @hachej/boring-agent run test -- src/server/agent-host   # gateway conformance + fixture + createAgentHost
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm lint:alignment-invariants
pnpm test:agenthost-compositions
pnpm typecheck
```

Failing-first assertions in `harnessBackendConformance`: (1) `watchEvents(cursor=0)` after 6 published events over a 5-event buffer returns `{type:'replay_gap', minReplaySeq, latestSeq}` and `readSnapshot().seq === latestSeq` (mirrors `gatewayConformance.ts:593-607` one layer down); (2) `submitPrompt` twice with the same `clientNonce` returns a receipt with `duplicate: true` and starts one model loop; (3) `openSession` on an unknown session rejects with a coded error whose `code === ErrorCode.enum.SESSION_NOT_FOUND` — **not** an `AgentGatewayError`; (4) the same `sessionId` under two `workspaceScopeId`s resolves two independent streams (today's `harnessPiChatService.eventStore.test.ts:192`); (5) after `close()` every method rejects. The pi-session test additionally asserts the `PiSessionRequestContext` the adapter hands `HarnessPiChatService` deep-equals what `embeddedGateway.ts:72-83` produced (snapshot fixture), so identity/key grammar is provably untouched. Invariant proof: a fixture under `scripts/__fixtures__` importing `@mariozechner/pi-coding-agent` into `agent-host/` must make `lint:invariants` exit non-zero (negative-fixture mode exists, `check-alignment-invariants.mjs:147`).

### Negative proof

- `git diff --stat` shows **zero changes** to `harnessPiChatService.ts`, `createHarness.ts`, `eventStreamStore.ts`, `piChatReplayBuffer.ts`, `core/createAgent.ts`, `shared/**`, `front/**`, `http/routes/**`, and `testing/gatewayConformance.ts`. The Level D skips at `gatewayConformance.ts:674-677` stay skipped; `replayLevel` stays `'B'`.
- Wire: no route, DTO, error code (`AGENT_GATEWAY_ERROR_CODES` list at `gatewayConformance.ts:110`), or HTTP status changes; `httpProjection.test.ts` green unchanged.
- Flag: `buildAgentComposition.durableStream.test.ts` green unchanged; flag-off remains byte-identical composition; flag-on still injects the same `SqliteEventStreamStore` into the same service.
- Legacy: `core/createAgent.ts` / `AgentLiveEventBuffer` untouched (no production consumers).
- Consumers: `workspace`, `core`, `cli`, `agent-playground` composition roots (`check-alignment-invariants.mjs:38-56`) keep passing only `harnessFactory`; the new consumer-reference invariant proves none references the seam.

### Migration / flag strategy

None for A2: pure structural refactor, single production backend, existing `BORING_CHAT_DURABLE_STREAM` semantics preserved verbatim. P1-B uses that same flag to select the Boring backend; P1-C flips its default. Rollback of A2 is a plain revert.

### Dependencies on A1, and what A2 does before A1

A2 does not depend on A1. The seam addresses sessions by `{workspaceScopeId, ref}` — the tuple `agentSessionKey` already uses (`agentSessionKey.ts:3-5`) — and does **not** mint a fifth key grammar. The legacy mapping to `sessionCacheKey`/stream path lives in one adapter function; when A1 ratifies keying and migrates rows, only `HarnessPiChatService` internals (A1's scope) and possibly that one function change. A2 should land first: it gives A1 a single seam-level test to prove identity before/after migration, and gives P1-B its target. Ordering: A2 → {A1, A3, A4} in any order → P1-B (needs A2 only, per `premises.md:87`).

### Risks

1. **Concrete-type leakage.** Some test in `__tests__/createAgentHost.test.ts` or `acceptanceIntegration.test.ts` may reach `composition.service` directly; fix in the same PR — never re-export the concrete class from the composition.
2. **Error-shape drift.** `stableServiceActionFailure` (`stableServiceError.ts`) inspects `statusCode/code` on thrown errors; wrapping errors in the adapter silently degrades every action failure to `AGENT_REQUEST_OUTCOME_UNKNOWN`. Adapter rethrows raw; conformance case (3) guards it.
3. **Two look-alike interfaces** (`PiChatSessionService` for the legacy `createAgent` path, `AgentHarnessBackend` for the gateway). Accepted; note "retire `PiChatSessionService` when `core/createAgent` is deleted" in the doc — not in this bead.
4. **Reload/slash-command host effects** still touch `composition.harness` (`runtimeCapabilityProjection.ts:358-372, 483-495`). They are `agent.reload`/`session.command.execute` host effects (`types.ts:46-47`), pi-specific by design; leaving them outside the seam is correct but must be stated so nobody "completes" the seam speculatively.
5. **Scope creep toward P1-B** (serving `watchEvents` from SQLite "while we're here"). Forbidden: A2 changes no replay source.

### Sizing

**2 sessions.** S1: types + pi adapter + gateway/composition/projection/trusted-binding swap + fixture retype; full agent suite green (the negative proof). S2: backend conformance suite against both backends, the two CI invariants with negative fixtures, docs, PR. Roughly +450/−150 lines. If S1 uncovers `HarnessPiChatService` internals that must change to satisfy the interface, stop and re-scope — that would mean the seam is wrong, not that the service is.

### Non-goals

Store-backed replay or any `EventStreamStore` read-path change (P1-B); un-skipping Level D cases or widening `GatewayReplayConformanceLevel` (P1-C); keying ratification, migrator, `cursorSecret` persistence (A1); ledger/incarnation/crash matrix (A3); activity reconstruction and resume protocol (A4); renaming `PiChat*` DTO types in `shared/chat` (Boring-owned wire schemas despite the prefix); `importSession`/`inspectOperation`; any pi-v2 adapter; touching `harnessFactory` injection or the D28 fleet; the legacy `core/createAgent` path.
## P1-A1 — Session identity + migration contract

Bead: `wt-391-forward-9p50.1` (re-body from "implement Level D conformance" to A1 before dispatch).

### Numbering map (r3 plan vs premises)

| `durable-streams-plan.md` r3 | premises P1 | Note |
|---|---|---|
| A1 owner keying + v1-row migration (`:138-166`) | **P1-A1 (this)** | closest prior art; its recommendation (a) is adopted with one amendment (workspace in the key) |
| A2 store-backed replay (`:168-181`) | P1-B + P1-C | not A2 in premises' sense |
| A3 crash-proof lifecycle (`:183-208`) | P1-A3 + P1-A4 | ledger/queue/reconciler/activity |
| A4 session-storage decoupling (`:210-218`) | none — deferred, out of P1-A | transcript dirs only |
| — | P1-A2 harness seam, P1-A5 proofs | no r3 counterpart |

### Today / Delta

**Four key grammars, none of which is the durable one on purpose.**

| Where | Key | Cite |
|---|---|---|
| Service cache + live channel | `JSON([sessionId, workspaceId ?? '', userId ?? ''])` | `packages/agent/src/server/pi-chat/harnessPiChatService.ts:1628-1630` |
| Durable stream path | `sessions/<that JSON string>` — the cache key is embedded verbatim | `harnessPiChatService.ts:1238` calling `packages/agent/src/shared/events.ts:64-66` |
| Gateway host key (knownSessions, writerTails, activity index) | `JSON([workspaceScopeId, agentTypeId, sessionId])` | `packages/agent/src/server/agent-host/agentSessionKey.ts:3-5`; used `embeddedGateway.ts:179,412,424,723,1064`, `sessionInventory.ts:150-180` |
| Transcript directory namespace | `[agentTypeId, sha256(workspaceScopeId)[:20], namespace]`; default agent → `undefined` (cwd-derived legacy dir) | `sessionInventory.ts:38-47`; inventory cache `[agentTypeId, workspaceScopeId, sessionDir]` `:125` |

**Correction to DIRECTION §Lane reality.** The buffer key grammar is `[sessionId, workspaceId, userId]`, but on every addressed route the `userId` slot is already empty: `toSessionCtx` drops the subject and substitutes `storageScope ?? workspaceId` when `sessionAuthority === 'workspace-scope'` (`harnessPiChatService.ts:1602-1612`), and both producers set `storageScope = workspaceScopeId` (`embeddedGateway.ts:73-83`, `httpProjection.ts:387-392`). So production v1 rows are keyed `sessions/["<uuid>","<workspaceScopeId>",""]`. The userId-bearing shape survives only in `trustedPiSessionBinding.ts:101-105` (no non-test caller found) and the eventStore unit test, which hardcodes the legacy grammar with `ctx.authSubject` and never sets `sessionAuthority` (`harnessPiChatService.eventStore.test.ts:14-24, 510-512`) — the durable test does not exercise the production key shape.

**Store.** Three tables keyed on an opaque `path TEXT` (`packages/agent/src/server/events/eventStreamStore.ts:69-92`); envelope `{v:1,eventIndex,timestamp,sessionId,chunk}` (`:195-201`); default-path footgun `opts.streamPath ?? sessionStreamPath(sessionId)` (`:179`). `migrateEventStreamSqlSchema` asserts, never migrates: unversioned tables → throw, any version ≠ 1 → throw (`schemaVersion.ts:3,14-17,31-44`). One sqlite file per host session root shared by all agents and workspaces (`buildAgentComposition.ts:39,72-78,311-317`), opened once per agent composition, so N `SqliteEventStreamStore` instances with separate in-process listener maps share one file (`eventStreamStore.ts:95,294-306`).

**Session ids** are host-minted `randomUUID()` (`packages/agent/src/server/harness/pi-coding-agent/sessions.ts:324`); the transcript header pins `boringSessionCtx` and ownership is `sameSessionCtx` on `workspaceId`+`userId` (`:326-333, 1342-1344`). **Cross-agent addressing** is rejected by directory lookup, not by key: `bindingForSession` → `assertAgentAccess` → `compiledById` → `resolveSessionRuntime` (per-agent store dir) → `knownSessions` → `AGENT_SESSION_NOT_FOUND` (`embeddedGateway.ts:714-736`).

**Two replay sources** (the real 0jpy.15 issue): the in-memory `PiChatReplayBuffer` hydrated from the store on channel open with a `min(1000, MAX_READ_LIMIT)` window and a silent `break` on non-monotonic seq (`harnessPiChatService.ts:1313-1370`), versus the store's own `readEvents` which nobody serves from. `AgentLiveEventBuffer` (`packages/agent/src/core/createAgent.ts:519`, keyed by the same JSON grammar `:483-485`) is a third, facade-level ring behind `Agent.stream` (`packages/agent/src/server/createAgent.ts:47`) — one class, not a duplicate. A1 records this; it does not touch it.

**Flag.** `BORING_CHAT_DURABLE_STREAM` (`buildAgentComposition.ts:38-44`); no deploy config in the repo sets it. Whether any v1 rows exist is operator-side knowledge — the migrator must be correct for an unknown, possibly empty, population. Level D skips: `gatewayConformance.ts:674-677`; `replayLevel` type is `'B'` only (`:38`).

**Delta (A1 delivers):** one typed identity module, one path grammar, an owner/attribute table, a real 1→2 data migration for v1 rows, the footgun removed, a colocated contract doc, and CI proof that no other grammar can be written.

### The identity contract to ratify

**A durable session stream is keyed by `(workspaceScopeId, sessionId)`. Everything else is an attribute.**

| Field | Role | Why |
|---|---|---|
| `workspaceScopeId` | **key** | the authority partition of `AuthorizedAgentScope` (`AGENT_GATEWAY_V0.md:19-33`); premises' "session identity stays workspace-scoped" (`premises.md:116-118`); already in today's path; makes per-workspace enumeration/erasure a prefix scan and reads structurally scoped (the service builds the path from the verified claim, never from client input) |
| `sessionId` | **key** | host-minted UUID, unique by construction (`sessions.ts:324`) |
| `agentTypeId` | **required attribute**, not key | in the URL and in the transcript dir (`sessionInventory.ts:44`) but rightly not in the stream key: a §9a Thread projects across Seats/agents, and P2's projection shape must read Session streams without knowing the agent first. Stored so A4 can rebuild `AgentSessionRef` after restart and so cross-agent addressing can be rejected from durable state, not only from directory existence |
| `authSubjectId` / userId | **attribute**, execution attribution only | matches `toSessionCtx`'s ruling (`:1603-1607`) and #1147; never ownership. Legacy rows carrying it are quarantined (migration §) |
| `seatId` | **reserved nullable attribute** | P3 `.14.1` fills it; A1 creates the column, writes NULL |
| `threadId` | **reserved nullable attribute** | §9a: 1 Thread : 0..n Sessions. A1 leaves the slot so a Session can be bound to a Thread root later; it defines no Thread table, no FK, no semantics — that is `.13.2`'s question |
| `keyVersion` | attribute | `2` for rows written under this grammar; migrated rows record their origin |

**Path grammar:** `sessions/<workspaceScopeId>/<sessionId>` with a strict parser (`sessionId` must be a UUID; `workspaceScopeId` must match a conservative charset or be percent-encoded — pick one and enforce it in the parser). One typed constructor `sessionStreamPath({ workspaceScopeId, sessionId })` replaces `sessionStreamPath(sessionId: string)`; `parseSessionStreamPath(path)` is the inverse and the invariant oracle. The r3 "stream path stops embedding the JSON cache key" requirement is met; DIRECTION's "`sessions/<sessionId>`" shape gains the workspace segment already present in practice.

**Attribute table (new, v2):** `boring_event_stream_owners(path PK → boring_event_streams.path, workspace_scope_id, session_id, agent_type_id NULL, auth_subject_id NULL, seat_id NULL, thread_id NULL, key_version INT, created_at)`. `createStream` for session streams becomes `createSessionStream(identity, attrs)` and writes both rows in one `BEGIN IMMEDIATE` transaction. `HarnessPiChatService` needs `agentTypeId` injected explicitly (today it only sees it inside the `attachmentUrl` closure, `buildAgentComposition.ts:324-328`).

**Thread-root room, nothing more.** No Thread storage, no Thread id minting, no join table. The nullable `thread_id` column plus the ownership row are exactly enough for either P2 shape (projection: query owners by `thread_id`; first-class stream: a later `threads/<id>` path family with its own parser).

### Migration contract for already-written v1 rows

| Option | Cost | What it loses | Verdict |
|---|---|---|---|
| **(a) in-place re-key, schema_version 1→2 with a real migrator** | one migrator + fixtures; rollback = flag off | nothing; old binaries refuse a v2 file (loud, by the existing assert) | **recommended** |
| (b) versioned v2 tables, v1 read-only side-by-side | two read paths forever, two grammars in one file | nothing, but A2/P1-B inherit a legacy branch | reject — the "two replay sources" mistake at the schema layer |
| (c) discard behind flag | zero | v1 rows are today only a replay cache (transcript of record is pi's jsonl, AGENTS.md rule 9); flag off by default; loss = exactly what Level B already loses on restart | cheapest and defensible, but P1-C makes this store load-bearing, so the migration discipline has to exist from now — do (a) even if the population is empty |

r3's "do NOT bump `schema_version`" (`durable-streams-plan.md:151-154`) was a warning against bumping without a migrator; with one, the bump is the correct rollback fence. Rollback story: flag off → in-memory, byte-identical (`buildAgentComposition.ts:32-36`); an old binary pointed at a v2 file fails boot loudly via `EventStreamSchemaVersionError` rather than writing mixed-grammar rows.

**Migrator rules (v1→v2), inside one `BEGIN IMMEDIATE`, idempotent, run by whichever composition opens first (the others see `2` and skip):**
1. Every `boring_event_streams.path` matching `^sessions/(\[.*\])$` is JSON-parsed as `[sid, ws, user]`.
2. `user === ''` → re-key `sessions/<ws>/<sid>` across all three tables; owners row with `agent_type_id = NULL`, `key_version = 1`.
3. `user !== ''` (legacy wire rows) → same target if free; on collision with a `user === ''` sibling for the same `(ws, sid)`, move to `quarantine/v1/<original path>` and emit one telemetry event with the count — never merge two seq spaces, never silently drop.
4. Any path that neither parses nor matches → quarantine + telemetry; migration still completes.
5. Write `schema_version = 2`; the existing post-write assert (`schemaVersion.ts:54-57`) stays.
6. Lazy backfill: on the next `buildChannel` for a stream whose owners row has `agent_type_id IS NULL`, write it from the injected `agentTypeId`. A4's reconstruction must treat NULL as "unknown, ask the inventory", never as "default agent".

`migrateEventStreamSqlSchema` becomes a stepwise ladder (`{1: v1→v2}`) rather than an assert; the "unversioned tables" branch stays a hard error.

### WHAT / Scope / Proof

**Files (create/modify):**
- `packages/agent/src/shared/events.ts:64-66` → replace `sessionStreamPath(sessionId)` with the typed constructor + `parseSessionStreamPath`; export `SessionStreamIdentity`.
- `packages/agent/src/server/events/eventStreamStore.ts` → `:35,178-235` remove the default path, require `streamPath` (typed); add `createSessionStream`, `readStreamOwner`, `backfillStreamOwner`; owners table DDL.
- `packages/agent/src/server/events/schemaVersion.ts` → version 2, migration ladder, quarantine + telemetry hook.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts:1238,421,1628-1630` → build the path from `{workspaceScopeId: toSessionCtx(ctx).workspaceId, sessionId}`; constructor gains `agentTypeId`; the cache key may keep its shape (process-local) but must be derived from the same identity object.
- `packages/agent/src/server/agent-host/buildAgentComposition.ts:318-328` → pass `agentTypeId`.
- `packages/agent/docs/SESSION_IDENTITY.md` (new, colocated per D29's "code wins" pattern in `AGENT_GATEWAY_V0.md:11-16`): the four grammars, which is durable, the attribute table, the migration ladder, the rollback fence.
- `scripts/check-alignment-invariants.mjs` (or `check-invariants.sh`) → new rule (below).
- Tests: `events/__tests__/schemaVersion.migration.test.ts` (new), `events/__tests__/eventStreamStore.conformance.test.ts`, `pi-chat/__tests__/harnessPiChatService.eventStore.test.ts` (fix `:510-512` to the production shape and add a `sessionAuthority: 'workspace-scope'` ctx), `agent-host/__tests__/buildAgentComposition.durableStream.test.ts:121` (restart proof re-run over a migrated file).

**Proof (failing-first, exact commands):**
- Migrator over pre-change fixtures: a v1 sqlite fixture with (i) addressed rows, (ii) legacy-user rows, (iii) a colliding pair, (iv) a garbage path → after open: every `boring_event_streams.path` parses under the v2 grammar or sits under `quarantine/`; old events replay read-only at the same seq; second open is a no-op; `schema_version = 2`; an old-binary open (simulate by asserting version 1) throws `EventStreamSchemaVersionError`.
- Concurrency: two `SqliteEventStreamStore` instances opening the same v1 file concurrently (reuse `__tests__/fixtures/concurrentAppendWorker.ts`) → exactly one migration, no `SQLITE_BUSY` escape.
- Footgun removal: `appendAgentEvent` without `streamPath` is a type error and a runtime throw.
- Commands: `pnpm --filter @hachej/boring-agent exec vitest run src/server/events src/server/pi-chat/__tests__/harnessPiChatService.eventStore.test.ts src/server/agent-host/__tests__/buildAgentComposition.durableStream.test.ts`; `pnpm --filter @hachej/boring-agent typecheck`; `pnpm lint:invariants`; `BORING_CHAT_DURABLE_STREAM=1` playground smoke: create session → restart → reconnect, then `sqlite3 <sessionRoot>/.agent-event-stream.sqlite 'select path from boring_event_streams'` shows only v2 paths.

**Negative proof:**
- Legacy wire unchanged: flag-absent composition is byte-identical (existing `buildAgentComposition.durableStream.test.ts:23,33` stay green); the addressed HTTP routes (`httpProjection.ts:283-587`) and `AgentGateway` DTOs (`AGENT_GATEWAY_V0.md:36-66`) are untouched — no method, field, or error code added (`check-agenthost-cutover-matrix.mjs` still passes).
- Cross-agent addressing still rejected: a gateway test that connects `{agentTypeId: 'beta', sessionId}` for a session created under `alpha` → `AGENT_SESSION_NOT_FOUND` before and after migration; and a store-level test that a migrated stream with `agent_type_id = NULL` is never served to a binding whose agent does not own the transcript directory.
- CI invariant: `sessionStreamPath(`/`parseSessionStreamPath(` may be called only from `shared/events.ts`, `eventStreamStore.ts`, `schemaVersion.ts`, `harnessPiChatService.ts`; no `JSON.stringify([` inside any stream-path expression; no string literal `'sessions/'` outside the identity module. Grep-based, in the existing invariants script.

### What A2–A5 / P1-B / P2 / P3 consume

- **A2 (harness seam):** `SessionStreamIdentity` is the seam's session parameter; the backend receives an identity, never a string path.
- **A3 (request/effect/attention ledger):** rows key on `(workspace_scope_id, session_id)` and carry the same reserved `seat_id`/`thread_id` columns; `SqliteAgentRequestLedger` adopts the ladder-style migrator.
- **A4 (activity/resume):** rebuilds `AgentSessionRef` from `owners.agent_type_id`; NULL → inventory lookup.
- **P1-B:** serves replay from `readEvents(path)` — one grammar, one store, the ring becomes a write-through cache; the hydrate `break` at `harnessPiChatService.ts:1349-1352` becomes a loud failure there, not here.
- **P2 `.13.2`:** `thread_id` slot; no semantics promised. **P3 `.14.1`:** `seat_id` slot.

### Owner decisions to surface (minimal)

1. Ratify key = `(workspaceScopeId, sessionId)`, `agentTypeId` as required attribute (r3 option (a) plus the workspace segment). The only alternative worth stating is adding `agentTypeId` to the key; it would contradict §9a's multi-Seat projection.
2. Migration: schema_version 1→2 with in-place re-key; rollback fence = old binaries refuse the file, flag off = in-memory. (vs. discard.)
3. Legacy-user rows on collision: quarantine + telemetry (recommended) vs. drop.
4. **Bookkeeping:** re-body `9p50.1` to A1 before dispatch; rewrite `0jpy.15` per DIRECTION `:173-176` (two replay sources, not a duplicate class).

### Risks

- Unknown v1 population: mitigated by fixture-driven migrator + quarantine-never-drop.
- `workspaceScopeId` charset: full-app scope ids come from `createWorkspaceAgentServer.ts:360-398` / CLI `modeApps.ts:54`; the parser must be validated against both before the grammar is frozen (encoding decision is inside the slice, not an owner question).
- N store instances per file: migration must be transactional-immediate; existing `retryBusy` window is 250 ms (`eventStreamStore.ts:15`) — a large v1 file could exceed it on the losing opener; the migrator should use a longer bound explicitly.
- Scope creep into P1-B (serving replay from the store) or into the transcript-dir namespace (r3 A4) — both out.

### Sizing / Non-goals

**Sizing:** 1 session for identity module + store + migrator + tests + invariant; +0.5 session for `SESSION_IDENTITY.md`, bead re-body, and the eventStore test correction.

**Non-goals:** store-backed replay, Level D test bodies, `replayLevel: 'D'` (P1-B/P1-C); request ledger / follow-up queue / activity reconstruction (A3/A4); Thread storage or Thread ids (P2); `seatId` semantics (P3); `AgentLiveEventBuffer` contraction (0jpy.15, after rewrite); transcript-directory re-namespacing (r3 A4); any change to `AgentGateway` methods, DTOs, error codes, or HTTP routes; the per-process `cursorSecret` (P1-B).
## P1-A3 — Durable request/effect/attention ledger + effect admission

Bead: `wt-391-forward-9p50.4`. Acceptance bug: #1348 (open). Absorbed: #1413 (closed, C5 resume), PR #1384 (closed, branch `weekend/approvals-hardening` still on origin, merge-base `31361f157`, 18 files, +2160/-94).

### Numbering map (r3 plan vs premises)

| r3 `durable-streams-plan.md` | premises.md P1 slice | Note |
|---|---|---|
| A1 keying ratification + migrator (`:138-160`) | **A1** identity + migration | same |
| A2 store-backed replay + Level D flip (`:162-182`) | **P1-B** (event backend) + **P1-C** (Level D completion, default-on) | the *seam* is premises **A2**, which r3 has no row for |
| A3 crash-proof turn lifecycle (`:184-208`) | **A3 (this)** for the ledger/admission/attention half; presence/activity half → **A4**; follow-up-queue persistence → **A4** (resume protocol); metering durability → out of P1 | r3's rule "extend `SqliteAgentRequestLedger` rather than a second claim protocol" is load-bearing here |
| A4 session-storage decoupling | not in P1 | — |

### Today (file:line)

**Request ledger (exists, Level-B-shaped).** Key = 5-part `AgentRequestKey` `{workspaceScopeId, authSubjectId, operation, target, requestId}` (`packages/agent/src/server/agent-host/types.ts:53-59`); states `pending-admission → admission-accepted → in-flight → completed | rejected | outcome-unknown` (`types.ts:80-98`); interface `types.ts:100-113`. Two impls: `InMemoryAgentRequestLedger` (`requestLedger.ts:45-129`) and `SqliteAgentRequestLedger` — one table, WAL, CAS `UPDATE ... WHERE state IN (...)` (`sqliteRequestLedger.ts:39-174`). Selection in `createAgentHost.ts:380-383`; path chain `requestLedgerPath.ts` (host root `.agent-request-ledger.sqlite`, legacy `.boring/agent-request-ledger.sqlite`). The gateway effect pipeline is `embeddedGateway.ts:788-981`: `prepare → classify → effectAdmission.admit → acceptAdmission → beginEffect → complete/markOutcomeUnknown`; replay of terminal records at `:839-841`. Admission seam: `AgentEffectAdmission.admit` (`types.ts:125-134`), default accept-all at `createAgentHost.ts:406`. Effects are gateway *commands* only (`types.ts:36-47`); `runHostEffect` (`embeddedGateway.ts:121-166`) is the only host-owned "execute something under the ledger" seam (`session.command.execute`).

**Restart behavior today.** Graceful drain terminalizes: pending/accepted → `rejected(GATEWAY_CLOSED)`, in-flight → `outcome-unknown` (`createAgentHost.ts:629-650`). SIGKILL leaves `in-flight` rows forever; the next identical request hits `AGENT_REQUEST_IN_PROGRESS` permanently (`embeddedGateway.ts:883-885`). No boot-time reconciliation exists. The four Level-D conformance cases are empty skips (`testing/gatewayConformance.ts:674-677`); `GatewayReplayConformanceLevel = 'B'` only (`:16`); fixture has no restart affordance (`:20-32`).

**Owner gates / ask_user (the #1348 root).** Durable object = question row in a JSON file `.boring/ask-user.json` (`plugins/ask-user/src/server/askUserServerPlugin.ts:72-75`), `FileAskUserStore` write-chain + tmp/rename, no lock, no version envelope (`askUserStore.ts:173-207`). Continuation = `InProcessAskUserCoordinator.waiters` map (`askUserRuntime.ts:37-82`). #1358 removed the boot sweep (`askUserServerPlugin.ts:37-41`) and made `submitAnswer` persist without a waiter (`askUserRuntime.ts:167-186`, test `__tests__/askUserRuntime.test.ts:269-283`). What still voids gates on restart:
- **Graceful restart cancels every live gate.** Host dispose aborts all live channels (`pi-chat/harnessPiChatService.ts:181-204`) → tool `AbortSignal` fires → waiter resolves `"aborted"` (`askUserRuntime.ts:44-47`) and `waitForAnswer` calls `cancelQuestion(..., "aborted")` → `store.cancel` (`askUserRuntime.ts:215-221`, `:188-206`). Status `cancelled`, same felt symptom as `abandoned`.
- `cancelQuestion` without waiter → `abandoned` (`askUserRuntime.ts:191-194`, test `:316-324` asserts this *as desired*); `ask()` failure path → `abandoned` (`:161-164`); re-ask by same session → `supersedeSessionPending` abandons (`:126-131`).
- No recovery op for the 9 already-abandoned records (issue item 4).
- **#1413:** answer persists but nothing re-enters the turn; the harness surface has only `prompt/followUp/abort` (`packages/agent/src/shared/harness.ts:49-53`); tool execution receives `toolCallId, sessionId, requestId` via `harness/pi-coding-agent/tool-adapter.ts:53-66` from `RunContext` (`shared/harness.ts:125-138`).

**Attention.** Front-only: `WorkspaceAttentionBlocker` (`packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx:43-61`), fed by ask-user's `questions.pending` ui-state hints (`askUserStatePublisher.ts:8-23`). No server-side attention record. Activity index is process-lifetime (`sessionInventory.ts:144-181`) — A4's.

### Delta — what A3 ships

**One durable ledger, three record kinds, one SQLite file** (the existing `requestLedgerPath` DB). No second store: `SqliteAgentRequestLedger` grows two tables and the `AgentRequestLedger` interface grows additive methods; `InMemoryAgentRequestLedger` mirrors them for `inMemoryRequestLedgerMode` hosts.

#### Minimal record set and identity rules

| Record | Key (identity) | Fields added | Terminal/CAS |
|---|---|---|---|
| **Request** (exists) | 5-part `AgentRequestKey`; **RunId := RequestKey** of the admitting `session.prompt`/`session.followup` (VISION.md:40,156) | `incarnation` (host boot id, `randomUUID` persisted in a `ledger_meta` row), `leaseUntil` on in-flight | existing states; reconcile adds `in-flight(prior incarnation) → outcome-unknown` unless a `pause` effect holds it |
| **Effect** (new) | `(runRequestKey, effectId)`; `effectId = toolCallId` for tool effects, `operation` for gateway effects | `effectClass: 'observe' \| 'propose' \| 'mutate' \| 'external-effect' \| 'pause'`, `idempotent: boolean`, `state: admitted \| in-flight \| settled \| outcome-unknown \| paused`, `outcomeDigest`, `receipt` | CAS by exact prior state; `settled` is idempotent on matching digest (D-c) |
| **Attention** (new; C5 pause record, tool-independent) | `attentionId` (= today's `questionId` for wire compat) + FK `(runRequestKey, toolCallId)` + `sessionRef {agentTypeId, sessionId}` | `kind: question \| approval \| review \| notice`, `status: ready \| answered \| cancelled \| expired \| superseded` (`abandoned` kept read-only for legacy rows), `ownerPrincipalId`, `expiresAt`, `riskTier`, `answer {values, resolvedBy, resolvedAt}`, `resume: {state: pending \| resumed \| outcome-unknown, resumeRequestId, error?}`, payload (title/context/schema/artifacts) | `ready → answered/cancelled/expired/superseded` CAS; answer is idempotent on identical values (same `resolvedBy`), conflict otherwise |

Identity rules: `RunId := RequestKey` — the effect/attention rows carry the *prompt command's* request key, never a fresh id. `resumeRequestId` is deterministic: `attention:<attentionId>:resume` so double-answer, double-boot, or two clients produce one ledger row. `abandoned` is never written by any code path after A3; it only means "owner/superseded" via the `superseded` status.

#### Effect admission and classification on tools

- Tools declare `effect?: EffectClass` on `AgentTool` (`packages/agent/src/shared/tool.ts`); unknown → `external-effect` (fail-closed: crash mid-call = `outcome-unknown`, never re-run). Read-only tools (`read/grep/find/ls/list`) declare `observe`; `ask_user` declares `pause`. `observe` records nothing (free, VISION.md:45).
- `adaptToolForPi` (`tool-adapter.ts:53-66`) wraps `execute` for non-observe classes: `effect.admit(runKey, toolCallId, class)` → run → `settle(digest)`; `pause` transitions to `paused` and stays there across restart. The admission hook reuses `AgentEffectAdmission.admit` (`types.ts:125-134`) with the effect key — same seam, no second admission protocol.
- Boot reconciliation (`createAgentHost` after ledger open): claim new incarnation; for each non-terminal row from a prior incarnation: `pause` effect with attention `ready|answered` → keep (turn is parked); declared-idempotent → reset to `pending-admission` (re-executable on replay); everything else → `outcome-unknown` (D-c rule, ARCHITECTURE-PLAN.md:196-210).

#### Resume after restart — replay vs re-execute

- **Replayed from the ledger (no side effects):** completed receipts, rejections, `outcome-unknown` errors (already, `embeddedGateway.ts:839-841`); attention items and their status; the parked turn's `(runKey, toolCallId)`.
- **Never auto re-executed:** model turns, `mutate`/`external-effect` tools.
- **Re-entered on human action only:** `submitAnswer` → CAS `ready→answered` → `resumeTurn(attention)`: host issues a `session.command.execute`-class effect through `runHostEffect` (`embeddedGateway.ts:121-166`) with `requestId = resumeRequestId`, whose action calls the A2 seam capability `backend.resumePausedToolCall({sessionRef, toolCallId, result})` (**additive seam extension shipped by A3b, not part of A2's minimal surface** — see the plan header). The pi backend implements it as "append the tool result to the native transcript, then continue the turn"; the scripted harness implements it natively. Success → `resume.state = resumed`; crash while in-flight → next boot marks `resume.state = outcome-unknown` and surfaces an attention `notice` ("decision recorded; turn did not resume — retry") with a fresh explicit retry op. The decision is never lost.
- **Graceful drain must not cancel gates:** drain sets `runtime.draining`; the ask_user tool's abort handler, when `draining`, returns `cancelled('aborted')` to pi without persisting `cancel` — the attention row stays `ready`, effect stays `paused`. Only owner cancel, expiry, or explicit supersede write terminal states.

#### ask-user becomes an adapter over the ledger (C5 absorption, #1413 decision)

`AskUserStore` interface (`askUserStore.ts:28-41`) is kept; `FileAskUserStore` is replaced in production wiring by `LedgerAskUserStore` backed by the host's attention ledger, injected as a host capability (not an import across the plugin boundary): `CreatedAgentHost` exposes `attention` and the workspace server passes it into the ask-user plugin options where `requestLedgerPath` is already resolved (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1777`). One-time import of `.boring/ask-user.json` rows on first open (idempotent by `questionId`), then the JSON channel is removed. `restoreAbandoned` (from #1384) becomes the recovery op for the 9 wiped records (#1348 item 4).

### Scope (files)

- `packages/agent/src/server/agent-host/types.ts` — effect/attention record types, `EffectClass`, interface additions, `incarnation`.
- `packages/agent/src/server/agent-host/sqliteRequestLedger.ts`, `requestLedger.ts` — two tables + `ledger_meta`, CAS transitions, `reconcileAfterRestart`, `listNonTerminal` (the scan API A4 consumes).
- `packages/agent/src/server/agent-host/createAgentHost.ts` — incarnation claim + boot reconcile; `draining` flag; expose `attention`.
- `packages/agent/src/server/agent-host/embeddedGateway.ts` — thread `runKey` into `RunContext`; `resumeTurn` through `runHostEffect`.
- `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts`, `packages/agent/src/shared/tool.ts` — effect classification + admission wrapper.
- `packages/agent/src/shared/harness.ts` + A2's `AgentHarnessBackend` — `resumePausedToolCall` capability; pi impl in `harness/pi-coding-agent/createHarness.ts`; scripted impl in `testing/scriptedPiHarness.ts` (must actually invoke registered tools; today it synthesizes a fake tool call, `:311-391`).
- `plugins/ask-user/src/server/{askUserStore,askUserRuntime,askUserServerPlugin,askUserBridgeHandlers}.ts`, `shared/{types,constants,bridge}.ts` — ledger-backed store, drain-aware abort, `restore` bridge op, decision-record fields.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, `apps/workspace-playground/src/server/dev.ts:114` — wiring.
- Tests: `agent-host/__tests__/requestLedger.test.ts`, `testing/gatewayConformance.ts:675-676` (real bodies), `plugins/ask-user/src/server/__tests__/*`, new `packages/agent/e2e/paused-human-restart.spec.ts`.

### Proof

1. **#1348 e2e, written first and failing** — `packages/agent/e2e/paused-human-restart.spec.ts` using `spawnBackend` (`e2e/helpers/backend.ts:199`, kill paths `:250-264`) with `BORING_AGENT_E2E_SCRIPTED_PI=1`, `BORING_AGENT_SESSION_ROOT` (pattern: `pi-native-multi-session-cold-reload.spec.ts:127-134`). Prompt `ASK_USER_E2E` → poll bridge `ask-user.v1.pending` (`shared/bridge.ts:14`) is `ready` → **(a)** SIGTERM restart and **(b)** SIGKILL restart, same roots → assert status still `ready` (fails today: (a) yields `cancelled`, `:215-221`) → submit via `ask-user.v1.answer` → `answered`; submit again → same receipt, no error.
   `pnpm --filter @hachej/boring-agent... --filter @hachej/boring-workspace... run build && pnpm --filter @hachej/boring-agent run test:e2e -- paused-human-restart.spec.ts`
2. **#1413 resume** — same spec continues: after answer, `readSessionState` shows the tool result and exactly one new assistant message (`PI_NATIVE_ASSISTANT_DONE`); repeat answer + one more restart → still exactly one; kill between `answered` and resume → boot issues the resume once (idempotent `resumeRequestId`).
3. **Unit/conformance** — `requestLedger.test.ts`: reopen with new incarnation → in-flight → outcome-unknown except paused; attention CAS; digest-idempotent settle. `gatewayConformance.ts:675` ("replays receipts and create tombstones across restart") and `:676` (crash matrix) get real bodies behind a new fixture capability `restart(): Promise<fixture>`; P1-C later folds them into the Level-D axis. `pnpm --filter @hachej/boring-agent test -- requestLedger gatewayConformance effectAdmission lifecycle`; `pnpm --filter @hachej/boring-ask-user test`; `pnpm lint:invariants`.

**Negative proof.** (i) One ledger: no new sqlite/JSON file path — test asserts the host opens exactly the `resolveRequestLedgerPath` file and `FileAskUserStore` is unreferenced by production wiring (grep invariant in `scripts/check-alignment-invariants.mjs`). (ii) Accepted-work boundary intact: `AgentGateway` stays 7 methods + close, error codes stay 14, request states `types.ts:80-98` unchanged; effect rows are *separate* durable semantics beside the stream (premises.md:95-101) — no effect data written into the event stream and `BORING_CHAT_DURABLE_STREAM` untouched. (iii) Legacy path: `inMemoryRequestLedgerMode` hosts behave as today (existing `lifecycle.test.ts`, `effectAdmission.test.ts` green unchanged); `observe` tools have zero ledger writes (assert row count).

### Dependencies — what A3 cannot start without

- **A1 (keys):** the attention row's `sessionRef` and the migration of `ask-user.json` rows (which carry `sessionId` only, no `agentTypeId`) need the ratified key grammar. Also `RunContext.requestId` (`shared/harness.ts:129`) must be verified/redefined as the prompt's gateway `requestId` so `RunId := RequestKey` is real. Without A1, A3a can still do the incarnation/reconcile work and the #1384 salvage (they key on the existing 5-part key); it cannot write attention rows in final shape.
- **A2 (seam):** `resumePausedToolCall` must live under `AgentHarnessBackend`. Without A2, #1348 (gates survive, answer durable, cancel semantics) ships; #1413's resume (A3b) does not.

### Salvage from #1384 (`weekend/approvals-hardening`)

Keep (port to ledger transitions; tests port near-verbatim): `restoreAbandoned` store+runtime+bridge (`cd5a3b408`, `44c63fb3d`); persisted `expiresAt` + startup `reconcileExpiries` (`e2d886753`); CAS boolean transitions (`markAbandoned/restoreAbandoned → boolean`); versioned envelope + refuse-newer-version + validated load (`2d16aa5e2`, `faff66a85`); `riskTier`/`resolvedBy` thin decision record + `getDecisionRecord` (`25c514711`, `f15f5c4d9`, `516617bbc`; explicitly interim, no RBAC); `appendTranscriptEventIfMissing` + `reconcileTranscripts` (becomes a single-transaction write); restart-path tests with separate store instances (`ec26fc69a`).
Drop: lock file + stale-lock reclamation + revision-CAS on JSON (`askUserStore.ts` branch `:516-600`), expiry retry/rearm backoff loops (`cancelExpiredWithRetry`) — all exist only to fake transactions over a JSON file; SQLite makes them dead.

### Risks

- pi 0.80.7 behavior on a transcript with a dangling tool call is unverified (pi packages not resolvable in this checkout); resume may need a transcript rewrite path (`nativeSessionTranscript.ts`) — spike first inside A3b.
- Plugin↔host boundary: ask-user must receive the ledger as an injected capability, never import `packages/agent` internals.
- Multiple hosts/legacy ledger layouts (`requestLedgerPath.ts`) mean attention rows land in whichever file a host opens; the cutover note there applies.
- Front expects `abandoned` (`shared/types.ts:111`); keep it readable, stop producing it.
- Scripted harness must execute real tools for e2e; today it fakes them (shared prerequisite with A5's directive grammar — build once).

### Sizing and non-goals

**3 sessions:** S1 = ledger extension + incarnation/reconcile + conformance bodies; S2 = attention table + ledger-backed ask-user + #1384 salvage + #1348 e2e green (A3a, ships #1348); S3 = resume via A2 seam + crash matrix + #1413 test (A3b). Non-goals: C6 cross-host exactly-once settle/Artifacts/Delivery/cost; metering durability; follow-up-queue persistence and activity index (A4); stream store / default-on (P1-B/C); cross-process live tail; approval RBAC; channel delivery beyond request-ID keyed bridge ops; inbox UI redesign.
## P1-A4 — Activity reconstruction + browser resume protocol

Bead: `wt-391-forward-9p50.5`.

### Numbering map (r3 plan vs premises)

| premises.md slice | durable-streams-plan.md r3 | Note |
|---|---|---|
| A1 identity + migration | r3 §4 A1 (`docs/plans/durable-streams-plan.md:140-161`) | same |
| A2 harness seam | none | new in premises |
| A3 request/effect/attention durability | r3 A3 (`:184-208`) | same; r3 A3's proof line "presence/activity degrades explicitly after restart" (`:207-208`) moves to **this** slice |
| **A4 activity + resume (this)** | no r3 slice. Composed from r3 A2 "zero-gap client resume" (`:179`) + r3 A3 activity proof | r3 **A2 store-backed replay** (`:163-182`) is **P1-B**, incl. its step 5 `cursorSecret` fix. r3 **A4 session-storage decoupling** (`:210-219`) is *not* this slice |
| A5 headless + paused-human | r3 "Named proofs" | — |

### Today → Delta

#### Resume path browser → gateway

**Today.**
- Front entry: `packages/agent/src/front/chat/pi/remotePiSession.ts:224-235` `start(cursor?)`. Reload = no cursor → `hydrateAndConnect` (`:344-374`): GET `/state`, `hydrate` dispatch, then `connectEvents(snapshot.seq)`. In-tab reconnect = `scheduleReconnect` (`:534-555`) → `connectEvents(state.lastSeq)` if hydrated.
- Stream: `runEventStream` (`:392-517`). URL `piChatStream.ts:189-202` (`/api/v1/agents/:agentTypeId/sessions/:sessionId/events?cursor=`). Non-2xx with `AGENT_SESSION_REPLAY_GAP`/`CURSOR_AHEAD` (`piChatStream.ts:167-179`) → `rehydrateAfterStreamReset` (`:519-524`, `allowSeqRewind` only on CURSOR_AHEAD, `:447`). In-band hole detection: `piChatReducer.ts:321-333` (`event.seq > lastSeq+1` → `needsResync`) → re-hydrate at `remotePiSession.ts:485-488`.
- HTTP: `server/agent-host/httpProjection.ts:416-489` NDJSON, cursor query `:96-101`, heartbeat first frame `:463-466` every 25 s (`:27`). No frame or header tells the client `latestSeq`/`minReplaySeq`/host incarnation on success.
- Gateway: `embeddedGateway.ts:458-488` `connectSession` — default cursor = `readState().seq` (`:463-466`); gap → error with `{latestSeq, minReplaySeq}` (`:480-488`). `readSessionState` `:437-456` overlays `summary.status` from the in-memory activity index (`:449`).
- Service: `harnessPiChatService.ts:436-446` subscribe = `channel.buffer.subscribe`. Channel build `:1230-1284`; ring hydrated from sqlite `:1313-1364` with window `min(1000, MAX_READ_LIMIT)` (`:1330`); corrupt hydrate `break`s (`:1346`). Append-then-publish `:1031-1065` (idempotency key = seq). Ring semantics `piChatReplayBuffer.ts:69-84` (validate), `:94-139` (replay-before-live ordering).
- **Second replay source** (DIRECTION `:173-175`): `core/createAgent.ts:519-635` `AgentLiveEventBuffer` — indexes by `eventIndex` not `seq` (`shared/events.ts:54-60`), bridges from `service.subscribe` at `:122-140`, throws `AgentNotImplementedError` on eviction (`:617-619`). Legacy `Agent.stream/send` facade wire (`:175-195`).
- Conformance: `testing/gatewayConformance.ts:16` level type is `'B'` only; Level B gap case `:593-607`; Level D stubs `:674-677`.

**Delta (A4).**
1. **Name the replay-source seam.** New `server/pi-chat/piChatReplaySource.ts`: `interface PiChatReplaySource { latestSeq; minReplaySeq; subscribe(cursor, subscriber, opts) }` — exactly `PiChatReplayBuffer`'s public surface (`piChatReplayBuffer.ts:41-47, :94`). `LiveSessionChannel.buffer` (`harnessPiChatService.ts:1260`) and `subscribeBeforeDispose` (`:443`) type against it. Ring stays the only implementation in A4. P1-B plugs a store-backed source *under this interface* and keeps the ring as a write-through cache; the gateway/HTTP/front do not change again.
2. **Write the resume contract** into `packages/agent/docs/AGENT_GATEWAY_V0.md` (new §"Resume protocol", after "Conformance levels" `:116-128`) — text below — and mirror it as a doc-comment on `ConnectAgentSessionInput.cursor` (`shared/gateway/types.ts:152-156`).
3. **Additive resume metadata, no wire change.** On a successful `/events` response add headers `X-Boring-Resume-Cursor`, `X-Boring-Latest-Seq`, `X-Boring-Min-Replay-Seq`, `X-Boring-Host-Incarnation` (`httpProjection.ts:478-482`). `AgentSessionConnection` gains optional `readonly resume?: { latestSeq; minReplaySeq }` (`types.ts:254-262`), filled from `subscribed.latestSeq/minReplaySeq` (`embeddedGateway.ts:467-479`). No new NDJSON frame type (`shared/chat/piChatEvent.ts:47` `heartbeat` remains the only control frame) — old clients ignore headers.
4. **Front: record resume metadata, no behavioral change to the state machine.** `remotePiSession.ts:427-472` reads the headers into debug state (`getDebugState` `:188-218`: add `lastResume`, `hostIncarnation`) and, when `hostIncarnation` changes between attempts, bumps a `restartCount`. Reload keeps snapshot-first; in-tab keeps cursor-first. `allowSeqRewind` stays CURSOR_AHEAD-only (`:447`) — what makes Level B restart (seq restarts at 0 without a store) still converge.
5. **Host incarnation — consumed, not defined.** A3 owns the per-boot `incarnation` (persisted in `ledger_meta`); A4 exposes it on `AgentHostRuntime` (`createAgentHost.ts:62-69`) to the projection (`:926`).

#### Activity (what the UI shows after reload/restart)

**Today.**
- `AgentSessionActivityIndex` (`sessionInventory.ts:144-188`) is a process-lifetime `Map`; `observe` on `agent-start`/`agent-end`/`error` (`:183-187`). Fed from `createAgentHost.ts:517-521` and `embeddedGateway.ts:472`; set imperatively at prompt `:588`, interrupt `:521-522`, stop `:535`, create `:413,:425`, delete `:690`.
- Consumers: `listSessions` status `embeddedGateway.ts:368`; `readSessionState` `:449`; SSE `/api/v1/agents/session-activity/events` `httpProjection.ts:224-281`. Front: `packages/workspace/src/front/sessionActivity.ts:34-74`, `useWorkingSessionIds` `:77-124`, `WorkspaceAgentFront.tsx:1046-1070`, `SessionBrowser.tsx:187,:440` (`error` renders as failed), `plugins/tasks/src/front/TaskSessionDisclosure.tsx:39-45`.
- After a hub restart **everything reads idle**: empty index; persisted snapshot hard-codes `status:'idle'` (`harnessPiChatService.ts:422`); live snapshot derives from a fresh adapter (`piChatSnapshot.ts:39-43`). A session killed mid-turn shows as idle with a truncated assistant message. This is the "silently wrong" state r3 A3 named.
- The ledger (`server/agent-host/types.ts:100-112`; sqlite `sqliteRequestLedger.ts:46-55`) knows which `session.prompt`/`session.followup` requests were `admission-accepted`/`in-flight` at the crash, but has no scan API — `read(key)` only (A3 adds `listNonTerminal`).

**Delta (A4).**
1. **Reconstruction module** `server/agent-host/activityReconstruction.ts` (pure): input = A3's ledger scan of non-terminal *and* `outcome-unknown` records for `session.prompt|session.followup|session.interrupt|session.stop` (ordered by `updated_at`), optional stream-tail probe per session; output = `{ ref, workspaceScopeId, status, reason }[]`. Rule: last non-settled prompt/follow-up for a session → `status:'error'`, `reason:'restart-interrupted'`, carrying the ledger `requestId`; a later `completed` prompt or `stop` for the same session supersedes it → idle. With the stream store on, corroborate: read the tail (`eventStore.readEvents`, `eventStreamStore.ts:36`) — if an `agent-end`/`error` follows the record's `updatedAt`, treat as settled. Paused-human (`input-required`) comes from A3's attention record → `status:'idle'` + `attention:{kind:'input-required', requestId}` — no new enum value.
2. **Seed the index at boot.** `AgentSessionActivityIndex.seed(entries)` + `reasonFor(ws, ref)`; call in `createAgentHost.ts:363` after the ledger opens and *after* A3's own startup reconciliation. Cheap (sqlite state-filtered scan, no channel/adapter boot).
3. **Per-session repair on first touch (lazy, self-describing stream).** When a seeded `restart-interrupted` session is first opened (`readSessionState` `embeddedGateway.ts:437-456` / `connectSession` `:458`), call a new service op `markTurnInterrupted(ctx, sessionId, {requestId, incarnation})` in `harnessPiChatService.ts` that publishes one synthetic `error` event (`retryable:false`, `error.code = 'AGENT_RUNTIME_RESTART_REQUIRED'` — existing code, `gatewayHttpStatus.ts:18`) through `publishChannelEvents` (`:1031`) so it is durably appended with a continuous seq and reaches every replaying client. Mirrors the existing synthetic-failure path (`:1025-1028`). Idempotent via the index (`clearReason` after publish). The gateway overlays `state.status='error'` and `state.error` on the snapshot it returns (`embeddedGateway.ts:450-455`) until the repair event lands, so a reload-first client sees the same truth as a cursor-first client.
4. **Summary carries the reason.** Additive optional `AgentSessionSummary.attention?: { kind: 'restart-interrupted' | 'input-required'; requestId?: string }` (`types.ts:123-136`, same precedent as `turnCount?`/`archived?`). `AgentSessionActivity` (`:121`) is **not** widened. SSE `activity` payload (`httpProjection.ts:249-261`) unchanged in shape; the reason rides on the summary.
5. **Front.** `sessionActivity.ts` needs nothing (error already terminal). Chat: map `AGENT_RUNTIME_RESTART_REQUIRED` in the error banner copy to "This turn was interrupted by a host restart — send again"; reducer already flips to streaming on the next `agent-start` (`piChatReducer.ts:341`). `TaskSessionDisclosure.tsx:39-45` unchanged.

### Resume protocol contract (to be written into AGENT_GATEWAY_V0.md)

- **Cursor** = the highest `PiChatEvent.seq` the client has *applied* (exclusive lower bound). `0` = nothing applied. Seq is per session, integer, strictly monotonic within a host incarnation; with the durable store on it is monotonic across incarnations; Level B without a store may restart at 0 after a restart (contract allows this; client must accept `CURSOR_AHEAD` + snapshot rewind).
- **Client sends on reattach**: `cursor` (query), nothing else. Reload uses snapshot-first (`GET /state` → `seq S` → `cursor=S`); in-tab reconnect uses cursor-first (`cursor=lastSeq`).
- **Server guarantees**: (1) *no silent gap*: either every event `cursor+1 … latestSeq` is delivered in order before any live event, or the request fails with `REPLAY_GAP {latestSeq, minReplaySeq}` / `CURSOR_AHEAD` and delivers nothing; (2) delivered seqs are contiguous — a client-observed hole is a server bug, not a recovery path (the reducer check at `piChatReducer.ts:324` stays as a tripwire); (3) **snapshot rehydrate boundary**: `/state` returns `seq S` such that every event with `seq ≤ S` is reflected in the snapshot and no event `> S` is; connecting at `S` is therefore lossless; (4) `minReplaySeq` is the replay source's floor — ring window today, retention floor after P1-B; (5) resume metadata headers are advisory and may be absent (old hosts).
- **Restart**: the host publishes `incarnation`; a session whose turn was admitted in an earlier incarnation and never settled is terminated with a durable synthetic `error` event, so the stream itself records the interruption; activity/summary reflect it before any client connects.
- **Substrate independence**: the contract is stated only in terms of `latestSeq/minReplaySeq/seq contiguity`, all provided by `PiChatReplaySource`; P1-B changes the floor, never the client algorithm.

### WHAT / Scope / Proof

**Server (packages/agent/src):** `server/pi-chat/piChatReplaySource.ts` (new), `harnessPiChatService.ts` (`:1260`, `:436-446`, new `markTurnInterrupted`), `server/agent-host/activityReconstruction.ts` (new), `sessionInventory.ts:144-188`, `createAgentHost.ts:363, :62-69, :926`, `embeddedGateway.ts:437-456, :458-488`, `httpProjection.ts:416-489`, `shared/gateway/types.ts:123-136, :254-262`, `testing/gatewayConformance.ts:16, :20-34, :677`, `__tests__/embeddedGatewayFixture.ts:203` (sqlite-ledger + `restart()` variant), `docs/AGENT_GATEWAY_V0.md`.
**Front:** `front/chat/pi/remotePiSession.ts:188-218, :427-472` (debug/resume metadata), error copy for `AGENT_RUNTIME_RESTART_REQUIRED`. `packages/workspace/src/front/sessionActivity.ts` — no change expected (verify).

**Proof (exact commands, from repo root):**
1. Unit + conformance: `pnpm --filter @hachej/boring-agent test -- src/server/agent-host src/server/pi-chat` — new `activityReconstruction.test.ts`; `gatewayConformance.ts:677` un-skipped and green at `replayLevel:'D'` via a new `embeddedGatewayConformance.level-d.test.ts` that builds the fixture on a tmp `sessionRoot` with `SqliteAgentRequestLedger`, drives a prompt into `in-flight`, calls `fixture.restart()`, asserts `listSessions` status `error` + `attention.kind==='restart-interrupted'`, `connectSession({cursor})` yields the synthetic `error` event with a contiguous seq, and a fresh prompt returns to `running`. Level B file (`embeddedGatewayConformance.test.ts:6-10`) stays as is.
2. Restart-replay e2e on the playground golden route: new `packages/agent/e2e/pi-native-restart-resume.spec.ts`, modelled on `pi-native-cross-hub-continuation.spec.ts:19-56` (`createAgentPlaygroundRuntime({sessionRoot, harnessFactory: createPersistedScriptedPiHarness})`, `apps/agent-playground/src/server/agentHost.ts:76-150`) with `BORING_CHAT_DURABLE_STREAM=1` and `BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS` large enough to kill mid-turn (`pi-native-harness-queue-stop-reload.spec.ts:13-21`). Browser attached via `spawnBackend` (`e2e/helpers/backend.ts:199`), prompt, `backend.stop()` mid-turn, re-spawn on the same port/workspace (needs a `port` option in `spawnBackend` — shared with A5's restart harness), no page reload: assert `data-pi-chat-connection` returns to `connected`, transcript shows one assistant message with the interruption error, session row not "working", `/state.seq` after restart > seq before, then a new prompt streams. Run: `pnpm --filter @hachej/boring-agent test:e2e -- pi-native-restart-resume.spec.ts`.
3. Reload-reconnect with a forced gap: (a) mock, extend `pi-native-replay-gap.spec.ts` (mock hook `pi-native-mock.ts:207-217`) with a `cursor_ahead` failure whose `statePatch.seq` is lower (restart shape; exercises `allowSeqRewind`); (b) real backend: add composition option `replayBufferMaxEvents` (plumbed to `PiChatReplayBuffer` `maxEvents`, `piChatReplayBuffer.ts:37`) read from `BORING_CHAT_REPLAY_BUFFER_MAX_EVENTS` in `buildAgentComposition.ts`; spec drives > N events, reloads, asserts one `REPLAY_GAP` in backend logs, final DOM equals `/state`, no duplicated assistant text. Run: `pnpm --filter @hachej/boring-agent test:e2e -- pi-native-replay-gap.spec.ts pi-native-chat-reload.spec.ts`.
4. Typecheck/invariants: `pnpm --filter @hachej/boring-agent lint` (runs `tsc --noEmit` + `scripts/check-invariants.sh`).

**Negative proof:**
- Legacy wire unchanged: `git diff --stat` shows no change in `core/createAgent.ts`, `shared/events.ts`, `shared/chat/piChatEvent.ts`; `grep -n "type: '" shared/chat/piChatEvent.ts` count unchanged (18); existing `pi-native-chat-reload.spec.ts`, `m3a-sessions.spec.ts`, `pi-native-replay-gap.spec.ts` pass unmodified except the added case.
- Level B preserved: `embeddedGatewayConformance.test.ts` at `'B'` green; `gatewayConformance.ts:593-607` untouched; replay-buffer unit tests untouched.
- No store schema written: `git diff` touches neither `server/events/sqlStorage.ts`, `schemaVersion.ts`, nor the `CREATE TABLE` in `sqliteRequestLedger.ts:46-55`; `git diff | grep -c "CREATE \(TABLE\|INDEX\)"` = 0. The synthetic event uses the existing `appendAgentEvent` path only.
- No gateway widening: `AgentGateway` method count unchanged (`types.ts:264-279`); `AgentSessionActivity` alias unchanged (`:121`).

### Dependencies

- **A3 (hard).** Needs from A3: (i) `AgentRequestLedger.listNonTerminal({states, operations, workspaceScopeId?})` — today only `read(key)` (`types.ts:111`); (ii) A3's startup reconciliation transitioning stale `admission-accepted`/`in-flight` → `outcome-unknown` *before* A4's seed runs; (iii) the attention/`input-required` record shape for the paused-human case; (iv) the host `incarnation`. If A3 slips, A4 can land server+front behind an internal `activitySource` interface with an `InMemory` scan returning `[]`, but the Level D activity case cannot be greened.
- **A1 (hard for stream-tail corroboration, soft otherwise).** Reconstruction maps ledger `target.ref` + `workspaceScopeId` to the stream path — the key grammar A1 ratifies. Until A1 lands, ledger-only mode.
- **A2 (ordering).** `markTurnInterrupted` and the replay-source seam must sit *above* the `AgentHarnessBackend` seam (service/gateway), never inside the pi adapter.
- **Feeds P1-B:** `PiChatReplaySource` + `GatewayReplayConformanceLevel: 'B' | 'D'` widening + `fixture.restart()`; P1-B implements store-backed `minReplaySeq` and un-skips `:674`. **Feeds A5:** the restart e2e harness pattern.

### Risks

1. Snapshot/summary additive fields may hit strict zod on the front (`PiChatSnapshotSchema.parse`, `remotePiSession.ts:365`; `piChatSchemas.ts`) — verify non-strict before adding; otherwise keep the reason on the summary only.
2. Restarting the spawned backend on the same port in Playwright (`helpers/backend.ts`) may need a fixed-port option and a readiness wait; fallback is the gateway-level restart proof plus a mock-driven browser case.
3. Synthetic terminal event must go through `publishChannelEvents` so the mapper's `initialSeq` (`:1250-1254`) stays consistent; direct `appendAgentEvent` would collide on the idempotency key (`:1053`).
4. Ambiguity for sessions with many historical `outcome-unknown` records — the "superseded by a later completed/stop" rule must be tested with fixtures, including interrupt/stop after a crash.
5. A3/A4 landing order; if reversed, A4's Level D case stays skipped and the PR must say so.
6. `AgentLiveEventBuffer` duplication (DIRECTION `:173-175`) is *not* fixed here — recorded as a non-goal.

### Sizing and non-goals

**Sizing:** 2 sessions — S1 server (seam, reconstruction, seed, gateway overlay, synthetic event, conformance D case, doc §Resume protocol); S2 front copy + resume metadata, restart e2e, forced-gap e2e, negative-proof commands in the PR. Budget a third if the backend-restart helper is fiddly.

**Non-goals:** store-backed replay / retention / corrupt-hydrate loudness / `cursorSecret` persistence (P1-B); widening `AgentSessionActivity`; ledger scan API and follow-up/attention persistence (A3); resuming an in-flight model turn; multi-process live tail; default-on flip and D29 addendum (P1-C); removing the core-facade `AgentLiveEventBuffer`; any new sqlite table/index.
## P1-A5 — Named conformance proofs as falsifiable e2e journeys

Bead: `wt-391-forward-9p50.6` (deps A2–A4). Governing text: `premises.md:137-147` (the two named proofs), `:86` (A5 ready after A2–A4); `DIRECTION.md:109` (done-bar playground AND full-app), `:116-120` (green CI never sufficient; tests must fail when behavior is broken; no fixtures that pass on empty output); `RECONCILIATION.md` §9a (Thread = job root, Session = one runtime conversation, headless = Thread with zero Sessions).

### Today

**Conformance tests that are skipped, and why.** `packages/agent/src/server/agent-host/testing/gatewayConformance.ts:674-677` — four `it.skip` stubs with empty bodies: Level D restart sequence continuity, durable request-ledger replay/tombstones, admission/effect crash matrix, activity-index reconcile at startup (`:678-679` are #905 pool-cursor/remote-wire, not P1). Nothing selects them: `GatewayReplayConformanceLevel` is `'B'` only (`:38`; `__tests__/gatewayConformance.test.ts:913`; `__tests__/embeddedGatewayConformance.test.ts:8`). `durable-streams-plan.md:80-82` records the reason: the Level D read path does not exist. Unskipping them is P1-C's job; A5 supplies the journeys P1-C cites.

**E2E infrastructure that exists.**
- Playground golden route: `apps/workspace-playground/e2e/agent-host-golden-route.spec.ts:14-107` — real wire (no route mocks), new chat via palette, prompt, reload, rename, delete. Config `apps/workspace-playground/playwright.config.ts:18-22`, `:31` workers=1, `:49-72` webServer boots vite with `BORING_AGENT_E2E_SCRIPTED_PI=1`, `BORING_AGENT_MODE=direct`, isolated `BORING_AGENT_SESSION_ROOT`. The agent API runs **in-process inside vite** (`vite.config.ts:6` → `src/server/dev.ts:55-137`, `app.listen` on `AGENT_API_PORT` at `:136`, proxy at `vite.config.ts:202-206`). There is no way to restart the host without killing vite.
- Process-spawn harness: `packages/agent/e2e/helpers/backend.ts:199-290` — spawns `packages/agent/src/bin/boring-agent.ts` as a child, polls health, `stop()` = SIGTERM then SIGKILL (`:277-286`). Used by `packages/agent/e2e/fixtures.ts:35-62`. No spec restarts a backend on the same workspace today.
- In-process teardown pattern: `packages/agent/e2e/pi-native-cross-hub-continuation.spec.ts:18-49` — `createAgentPlaygroundRuntime` (`apps/agent-playground/src/server/agentHost.ts:76-150`), `first.close()`, re-create on a shared `sessionRoot`. Also the evidence convention: proof object + screenshot to `.handoff/` and `testInfo.attach` (`:96-120`; `.gitignore:28`).
- ask_user gate fixtures: `plugins/ask-user/e2e/ask-user.spec.ts:42-58` mocks `/api/v1/ui/state` and the whole workspace-bridge — a UI test, not a durability proof. Server side: `askUserStore.ts` file store at `<workspaceRoot>/.boring/ask-user.json` (`askUserServerPlugin.ts:72-75`); waiters in-process only (`askUserRuntime.ts:122-125`); `submitAnswer` persists the answer with no waiter after restart, resolving is a no-op (`:167-180`); boot must not sweep pending questions (`askUserServerPlugin.ts:37-40`, #1348); the state publisher re-hydrates `questions.pending` on start (`askUserStatePublisher.ts:43-57`). The tool blocks the turn inside `runtime.ask` (`createAskUserTool.ts:94-101`) and on answer emits a handover with `artifacts` upserts (`:124-129`).
- Scripted harness: neither scripted harness executes a tool. `packages/agent/src/server/testing/scriptedPiHarness.ts:112-150` emits a fake `grep`; the playground variant picks a `*_capability` tool by name only and fabricates its output (`apps/workspace-playground/src/server/testing/scriptedPiHarness.ts:97`, `:498-499`). The persisted variant writes the transcript only after `prompt()` resolves (`scriptedPiHarness.ts:57-61`).
- Job entry points: (a) gateway HTTP `POST /api/v1/agents/:agentTypeId/sessions/:sessionId/prompt` (`httpProjection.ts:545`), state `:353`, events `:416`, activity SSE `:224`; (b) automation manual run `POST <prefix>/automations/:id/run` (`plugins/boring-automation/src/server/routes.ts:180-195`) with a **durable run record** (`manualRunExecutor.ts:121-177`: dispatching → running (+sessionId) → completed; file store and Postgres store); (c) MCP `delegate_task*` (`packages/agent/src/server/mcp/managedAgentMcpServer.ts:101,125,155`) — full-app only, delegation status in an in-memory `Map` (`managedAgentDelegate.ts:180`). No CLI headless command exists.
- Full-app e2e: `apps/full-app/e2e/playwright.config.ts` builds dist via `google-auth-webserver.sh` against real Postgres; every spec route-mocks the agent API. Full-app never passes `harnessFactory` (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:263` accepts it; `apps/full-app/src/server/main.ts:40-61` does not), so there is **zero full-app evidence of a real agent turn** today. Dev login exists behind `ENABLE_DEV_LOGIN=1` (`apps/full-app/src/server/dev.ts:33-35`).
- Host state that dies with the process: `harnessPiChatService.ts:142` (`activePromptRuns`), `sessionInventory.ts:144-146`, `createAgentHost.ts:363`.
- CI: root `pnpm e2e` runs only `packages/agent` e2e (`package.json:41`; `.github/workflows/ci.yml:506-507`); playground `test:e2e` is separate (`apps/workspace-playground/package.json:14`).

### Delta (what A5 adds)

1. **Scripted directive grammar** in both scripted harnesses: a prompt starting with `@@scripted ` carries a JSON script (`[{tool:'ask_user', args:{…}}, {write:'deliverables/report.md', text:'…'}, {final:'DONE <nonce> answer={{ask_user.values.choice}}'}]`). The harness **really calls** `input.tools.find(t => t.name === 'ask_user').execute(...)` (tools arrive via `AgentHarnessFactoryInput.tools`, `packages/agent/src/shared/harness.ts:8`) and blocks the turn on it; transcript persistence moves to per-message. Shared prerequisite with A3 (its e2e needs real tool execution too) — build once, in whichever lands first.
2. **Restart harness** `apps/workspace-playground/e2e/helpers/hostProcess.ts` modelled on `packages/agent/e2e/helpers/backend.ts:199-290`, adding `kill('SIGKILL')` and `respawn()` on the same port/roots, returning pids and exit signal. Shared with A4's restart e2e.
3. **Playground external-API mode**: env `BORING_WORKSPACE_PLAYGROUND_AGENT_API=external` makes `vite.config.ts` skip `startPlaygroundServer()` and only proxy; new 15-line entry `apps/workspace-playground/src/server/standalone.ts` calling `startPlaygroundServer()`. Separate config `apps/workspace-playground/playwright.journeys.config.ts` (same env block plus the flag, plus `BORING_CHAT_DURABLE_STREAM=1`), so kill/respawn never disturbs the shared suite.
4. **Automation plugin loaded in journey mode** (`dev.ts:113-121` currently loads tasks, ask-user, diagram).
5. **Full-app scripted-pi support**: `apps/full-app/src/server/dev.ts` honors `BORING_AGENT_E2E_SCRIPTED_PI=1` exactly like `packages/agent/src/bin/boring-agent.ts:137-138` (non-production only).
6. Two journey specs × two hosts, evidence writer, mutation controls.

### Journey 1 — The paused-human restart

**Spec**: `apps/workspace-playground/e2e/p1a5-paused-human-restart.spec.ts`. Command: `cd apps/workspace-playground && pnpm exec playwright test -c playwright.journeys.config.ts p1a5-paused-human`. Full-app twin: `apps/full-app/e2e/p1a5-paused-human-restart.spec.ts`, added to the explicit `testMatch` list; command `cd apps/full-app && pnpm e2e -- p1a5-paused-human` (needs the local Postgres the config already assumes). The full-app spec spawns its own `tsx src/server/dev.ts` on `FULL_APP_E2E_PORT+1` with `ENABLE_DEV_LOGIN=1`, authenticates via `/dev-login`, and drives `/workspace/<id>`.

Script (nonce `N = Date.now()`):
1. Spawn host H1 (scripted harness, ask-user plugin, durable flag on). Open `/`, wait `data-pi-chat-connection=connected`, "New Chat" via palette, capture `sessionId`.
2. Send `@@scripted [{tool:'ask_user', args:{title:'Choose <N>', schema:{wireVersion:1, fields:[radio choice A|B]}}}, {final:'ANSWERED <N> choice={{choice}}'}]`.
3. Assert pause: `GET .../state` → `status:'working'`; DOM shows the user prompt and an `ask_user` tool card; "Open Questions" button visible; `GET /api/v1/ui/state` → `questions.pending.hintsBySession[sid].questionId = Q`; attention row `Q` is `ready`; record `seqBefore`.
4. `SIGKILL` H1. Assert the kill was observed: child `signalCode === 'SIGKILL'`, and the browser flips `data-pi-chat-connection` away from `connected` within 10s (a "restart" the client never noticed is not a restart).
5. Respawn H2 on the same port/roots; assert `pid2 !== pid1`.
6. Reattach **without reload**: `data-pi-chat-connection=connected`, `data-pi-chat-session-id === sid`. Then assert the three intact things: (a) question — Questions pane heading `Choose <N>` and pending hint with the same `Q`; (b) transcript — DOM and `/state.messages` contain the user prompt and the ask_user tool call with `state:'input-available'`, and nothing after it; (c) pending state — `/state.status` is not `idle` (pending attention), `session-activity/events` reports the session non-quiescent. Repeat (a)–(c) after `page.reload()` as the fallback path.
7. Answer through the UI (radio A → Submit, against the real bridge). Assert routability: `Q` `answered` with `values.choice='A'`; `/state.messages` gains exactly one tool result containing `User answered` and one assistant text `ANSWERED <N> choice=A`; `status:'idle'`; assistant message count for this turn is exactly 1 (no double execution).
8. Replay: `GET .../events?cursor=0` yields contiguous seq through `seqBefore` and beyond with no `REPLAY_GAP`.

**Assertions that fail today (named):**
- **F1 answer-not-routable** — step 7: the answer persists (`askUserRuntime.ts:167-171`) but no turn resumes. Needs A3b (pending ask as durable attention with its `toolCallId`, resume via the seam) and A4.
- **F2 pending-state-lost** — step 6(c): activity index is process-lifetime (`sessionInventory.ts:144`), `/state` reports `idle`. Needs A4 reconstruction from A3's ledger.
- **F3 transcript-truncated** — step 6(b): scripted persistence happens after `prompt()` resolves; after SIGKILL the prompt and tool call are absent. Fixed by Delta 1 for the fixture; for the real pi harness this is A2/P1-B territory and the live-model smoke will report it.
- **F4 reattach-without-reload** — step 6 first half: unverified today whether the client reconnects on a dead NDJSON stream; likely fails. Needs A4's resume protocol.
- **F5 replay gap** — step 8: within-window today (Level B), so passes at ring size; P1-C tightens it to N > window.

**Restart mechanism — recommendation: process SIGKILL, not in-process teardown.** In-process `close()` + re-create keeps module singletons alive (`getWorkspaceUiBridge()`, ask-user waiter map, harness Maps) and can pass falsely; `durable-streams-plan.md:180,207` sets the bar at "mid-turn kill -9". The vite in-process boot forces Delta 3. Keep the in-process variant only as a fast unit-level companion under `gatewayConformance` (P1-C), never as the named proof.

**Fixture vs live model.** Acceptance = fixture-gated (scripted directive), per the ratified bar. A second test in the same file, `test.skip(!HAS_KEY)` like `packages/agent/src/eval/__tests__/canary.test.ts:25`, tagged `@live-smoke`, sends "Ask me to choose A or B with ask_user, then echo my choice" against the real harness and runs the same steps 3–8 with looser text assertions. It never gates merge.

### Journey 2 — The headless journey

**Spec**: `apps/workspace-playground/e2e/p1a5-headless-journey.spec.ts` (API-only; `page` used solely for the evidence screenshot), same journeys config with filter `p1a5-headless`. Full-app twin hits the same routes with the dev-login cookie (Postgres automation store). Entry point chosen: the automation manual run (`routes.ts:180`) because it is the only API job entry with a durable job record whose id is not a sessionId. MCP `delegate_task` is a non-goal here (in-memory status; recorded as a follow-up assertion for P1-C).

Script:
1. Spawn H1. `POST <prefix>/automations` with prompt `@@scripted [{write:'deliverables/report-<N>.md', text:'REPORT <N>'}, {tool:'ask_user', args:{title:'Approve report <N>', artifacts:[{id:'r', surfaceKind:'file', target:'deliverables/report-<N>.md', title:'Report'}], schema:{…approve|reject}}}, {final:'DELIVERED <N> decision={{decision}}'}]`.
2. `POST .../automations/:id/run` → 201, capture `runId`. Poll `GET .../automations/:id/runs` → run `status:'running'` with `sessionId` set.
3. Poll the bridge `ask-user.v1.pending` → question `Q` with `artifacts[0].target` = the report path; assert the file exists with byte length > 0 and contains `REPORT <N>`. Record `sha256`.
4. `SIGKILL` H1; assert `signalCode`.
5. Respawn H2. Assert survival: run `runId` still present and not silently `completed`/`failed`; `Q` still `ready`; artifact bytes unchanged (same sha256).
6. Human decision: bridge `ask-user.v1.answer {questionId:Q, sessionId, answerToken, values:{decision:'approve'}}` → `answered`.
7. Delivery: poll run → `status:'completed'` with a terminal result; the run's session state contains `DELIVERED <N> decision=approve`; `Q` `answered`; exactly one completed run for the automation. Do **not** assert `run.sessionId` unchanged — a resumed job may legitimately bind a new Session (§9a).
8. Wrong-token control: answering `Q` with a bad `answerToken` before step 6 must be rejected and must not advance the run.

**Fails today:** **F6 run-orphaned** — the executor's in-memory event loop (`manualRunExecutor.ts:155-177`) dies with H1; the record stays `running` forever and step 7 times out (needs A3 effect/attention durability + A4 resume of a job with no client attached). Steps 2–5 pass today (file store): red for a named reason, not for infrastructure.

**What the journey must NOT assume (§9a):** no browser or SSE subscriber attached at any point; the job's identity is the run id, never the sessionId; a single Session across the restart; that `questions.pending` (a UI slot) is the delivery channel; any Thread store, Delivery store, or Outcome record — "delivery" is asserted as observable effects (run terminal state, final text, artifact bytes, answered decision), and the spec must not write or read any new durable table.

### Negative proof — anti-fake checks

- No route mocks, no `it.skip`/`test.skip` in journey files (the `@live-smoke` test uses a key-gated skip only). Assertions are structural `toMatchObject` on a proof object, never `expect(bool).toBe(true)` on derived booleans.
- Nonce `N` in prompt, question title, artifact content and final text; a stale transcript or fixture default cannot satisfy them. Exact message/tool-result counts; artifact `byteLength > 0` and content match; `pid2 !== pid1` and `signalCode === 'SIGKILL'`.
- Every timeout names its step and dumps the observed state, so a red run is diagnosable.
- **Mutation controls**, run in CI as their own labelled tests: (i) `BORING_CHAT_DURABLE_STREAM=0` → the spec must fail at F1/F6 specifically; (ii) wrong `answerToken` → no progress; (iii) a kill that is not observed by the client fails step 4. If a control passes when it should fail, the journey is not a proof.

### Evidence for P1-C's D29 addendum

Per run, `testInfo.attach` + `.handoff/p1a5-paused-human.{json,png}` and `.handoff/p1a5-headless.{json,png}` containing: commit SHA, host (`playground`|`full-app`), flag values, `pid1/pid2/signal`, `sessionId`, `questionId`, `seqBefore/seqAfter`, replay-gap check, run id + status timeline, artifact sha256, message counts, wall-clock per step. The addendum (`docs/DECISIONS.md` D29) cites the two spec paths, the CI run URL with the HTML report, and the four JSON artifacts (2 journeys × 2 hosts). Proof-of-work comment format per `docs/procedures/proof-of-work.md:14-30`.

### Dependencies on A2/A3/A4 (per assertion)

| Assertion | Needs |
|---|---|
| Scripted harness pluggable behind the seam; same spec later runs against P1-B backend | A2 |
| F1/F6 answer routed into a resumed turn; pending ask visible as durable attention after restart | A3 (a + b) |
| F2 activity non-idle after boot; F4 reattach without reload; headless resume with no client | A4 |
| F5 zero-gap replay beyond the ring | P1-B/P1-C (not A5) |

A5 can be written failing-first before A2–A4 merge (steps 1–5 of each journey go green immediately); it cannot go fully green before A3 and A4.

### Risks

- Port reuse after SIGKILL (TIME_WAIT/listen race) — respawn with retry, but pin the port because vite's proxy is fixed. Flake budget: `retries: 0` locally, 1 in CI.
- Scripted persistence semantics (Delta 1) may diverge from real pi's — the live smoke is the honesty check; do not let the fixture "prove" what pi does.
- Full-app journey depends on local Postgres and the dev entry (not built dist); RC smoke stays the dist proof. Record as a known gap in the proof comment.
- Client reconnect behavior is unknown; if A4 delivers reconnect only on reload, the "without reload" half becomes a follow-up, stated explicitly.
- `workers:1` sequencing: journeys config is separate so kill/respawn cannot leak into the shared suite.

### Sizing (sessions)

S1: Delta 1 + 2 + 3 and the playground paused-human spec, red at F1–F4 by name. S2: automation plugin in journey mode + headless spec (red at F6) + full-app scripted-pi support + full-app twins. S3 (after A3/A4 land): green both hosts, mutation controls, evidence writer, CI job wiring, proof comment. Three sessions; split S3 if A4's reconnect shape forces spec changes.

### Non-goals

Thread/Delivery/Outcome storage; unskipping `gatewayConformance.ts:674-677` (P1-C); default-on flip; MCP delegate durability; multi-process live tail; live-model as acceptance; Questions-pane UX; cross-hub root moves (already covered by `pi-native-cross-hub-continuation.spec.ts`).
