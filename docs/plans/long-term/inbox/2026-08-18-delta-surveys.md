# Delta survey evidence — 8 area reports (verbatim)

> Inbox drop 2026-08-18. Raw final reports of the eight code-survey agents behind [`../40-delta.md`](../40-delta.md).
> Surveyed at origin/main `d7efb0469`. Verbatim; not canonical.


---

# A. Identity, Parties, Authority & Governance

I have enough verified evidence. Compiling the report.

**Area survey: Identity, Parties, Authority & Governance** — repo `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan` @ `d7efb0469` (origin/main)

---

## 1. Party vs Actor separation

**Status: MISSING**

**Today:** No Party concept anywhere. Identity roots are better-auth `users` (`packages/core/drizzle/schema.js` via `packages/core/src/server/db/schema.ts:7`) and `workspaces` owned by `createdBy: users.id` (`schema.ts:49-51`). No organization/tenant/legal-principal table; billing is user-scoped (`boring_credit_grants.userId`, `schema.ts:294`). `appId` columns partition apps, not Parties. No represented-Party, mandate, or Party Relationship anywhere (`grep Party` hits only test fixtures and unrelated identifiers).

**Delta:** Introduce a Party root + Party-role bindings (controlling Party per workspace/Instance, payer, publisher), migrate `workspaces.createdBy` and credit/usage attribution from raw `userId` to Actor-acting-for-Party pairs. Purely additive tables are easy; re-keying the metering/credits ledgers and workspace ownership later is the expensive part.

## 2. Stable Agent identity with immutable behavior revisions

**Status: PARTIAL**

**Today:** Strong *content* identity, weak *subject* identity. Agent packages compile to a `CompiledAgentBundle` with canonical `definitionDigest` over definition + assets (`packages/agent/src/shared/agent-definition.ts:46-64`, digest primitives in `packages/agent/src/shared/digest.ts`). `AgentDeployment { deploymentId, version, agentId, definition: {definitionId, version, digest} }` (`agent-definition.ts:33-39`) and `createResolvedAgentDigest` binds workspace + deployment + definition digests (`packages/agent/src/server/agentDefinition/resolveAgentDeployment.ts:30-56`). Host-level desired-state revisions `r[0-9]{10}` + sha256 digests are durably admitted in `agent_host_binding_admissions` and append-only `agent_host_destructive_publication_events` (`packages/core/src/server/db/schema.ts:480-530`, migrations `drizzle/0018/0020/0022`). But: `agentId`/`definitionId` are opaque local refs with **no issuer/owner namespace, no fork/derive/transfer/revocation/compromise lineage** (`grep issuer|lineage|fork` in agent-definition.ts: 0 hits); agents are workspace-config `agentTypeId`s from `fleet.yaml` (`loadConfiguredAgentFleet.ts`), so identity is effectively "type name inside one deployment".

**Delta:** Add an issuer-namespaced stable subject ID and a lineage record (fork/derive/transfer/revoke) over the existing digest machinery; make every chat run record the resolved revision (today revision recording exists at binding admission, not per-run — pi metering records `runId` but not revision, `packages/agent/src/server/pi-chat/__tests__/metering.test.ts:207`).

## 3. Agent↔Instance binding ("Seat")

**Status: WRONG-SHAPE**

**Today:** "Seat" exists but as boot config, not durable participation. `fleet.yaml` seats map `agentTypeId` → seat, `policy.yaml` seat tiers select model policy (`loadConfiguredAgentFleet.ts:336-352`, `resolveSeatModel` :455); seat validation is fail-closed per seat. Runtime "bindings" are process-lease lifecycles (`packages/agent/src/server/runtime/runtimeBindingLifecycle.ts`, `agent-host/workspaceAgentLease.ts`, `environmentLease.ts` — one immutable environment snapshot per compatible binding). Per-agent MCP grants are seat-shaped and default-deny per exact `(workspaceId, agentTypeId)` with exact-match tool allowlists (`packages/agent/src/server/agent-host/mcpGrants.ts:40-47`, glob rejection :34-39). Budgets exist but attach to **users**, not seats: `boring_budget_reservations.scope IN ('model','user')` (`schema.ts:398,415`).

**Delta:** Promote Seat to a durable record `(agentIdentity, instance, role, ceiling, budget)` that the admission path resolves — the pieces (mcpGrants, seatTiers, budget reservations, binding admissions) exist but are keyed on three different identity schemes (`agentTypeId`, `userId`, `hostId+bindingId`) that must be unified.

## 4. Host-issued Authority (ceilings, narrowing, delegation, revocation)

**Status: PARTIAL**

**Today:** Several genuine host-issued narrowing mechanisms, no umbrella. (a) `AuthorizedAgentScope` is an issuer-owned unforgeable capability (unique-symbol brand) re-verified against current membership on every use (`packages/agent/src/shared/gateway/types.ts:33-52`). (b) Credential authority: immutable `CredentialConsumerBindingV1` with provider, consumer kind/trust, purpose, `allowedFieldIds`, delivery mode, sandbox egress-origin allowlist (`packages/agent/src/shared/credentials/bindings.ts:27-49`); host resolver vends non-serializable, disposable leases (`packages/agent/src/server/credentials/hostResolver.ts:240-291` — `toJSON` throws); sandbox side enforces consumer allowlist + byte caps (`packages/boring-sandbox/src/providers/runsc/runtime/invocationCredentials.ts:22-36`). (c) MCP grants (above) are ceiling-only, never widening. (d) Workspace RBAC ceiling: `role IN ('owner','editor','viewer')` with `requireWorkspaceMember` preHandler on every workspace route, structurally audited (`packages/core/src/server/db/schema.ts:96`, `packages/core/src/server/routes/__tests__/workspaceAuthAudit.test.ts` L1-L5). (e) Agents can't rewrite their own rules: default readonly `.agents` path policy with revision field (`packages/agent/src/server/runtime/readonlyFilesystemPolicy.ts:20-30`). Missing: request-scoped narrowing grammar, transitive delegation-that-only-narrows, revocation cascade, policy decisions as records.

**Delta:** Define an Authority record decomposition (ceiling / grant / per-invocation decision) over these seams; retrofit delegation depth + revocation cascade. The unforgeable-scope and credential-lease patterns are keepers; the missing piece is a *durable* grant store beyond mcpGrantStore.

## 5. Approvals bound to exact proposal, invalidated by change; step-up/quorum

**Status: WRONG-SHAPE**

**Today:** The only human-in-the-loop primitive is the `ask-user` plugin: typed question/answer schemas with bounded fields (`plugins/ask-user/src/shared/schema.ts:256-285`), durable store, bridge to browser (`askUserBridgeHandlers.ts`), inbox front-end (`src/front/inbox/inboxItemModel.ts`). It is a *question* channel — answers bind to `questionId` only; **no proposal/effect digest, no invalidation on material change, no expiry-bound consumption atomicity, no step-up, no quorum** (`grep digest|expir|supersed` in schema: 0 hits). The closest effect-bound pattern is the *destructive publication* two-phase ledger with expected/target revision+digest preconditions (`schema.ts:501-529` — prepared/committed/aborted, if-match semantics) — but that path is host-internal, no human decision attached. Gateway effects get idempotent admission via `AgentRequestKey` digest conflict detection (`packages/agent/src/server/agent-host/requestLedger.ts:47-66`).

**Delta:** Build Approval as a first-class record joining ask-user's delivery surface with the destructive-publication precondition pattern (expected digest → invalid on change, atomic single consumption). Retrofit cost here is moderate now, severe later once agent effects multiply.

## 6. Authentication context as separate evidence

**Status: MISSING (thin substrate exists)**

**Today:** better-auth sessions store `ipAddress`, `userAgent`, expiry (`packages/core/src/server/auth/createAuth.ts:224-234`); email+password with strength gate, social providers, verification tokens (:255-277). Nothing records *how* identity was proved per consequential action; no assurance levels, no step-up, no per-decision authn evidence. Worse, the CLI/local bridge path explicitly trusts supplied `{workspaceId, userId}` (`packages/workspace/docs/PLUGIN_SYSTEM.md:54`; `createWorkspaceAgentServer.ts:1249` warns when `createLocalCliBridgeAuth` is in use). `AuthorizedAgentScope` carries only `authSubjectId` — no authn context.

**Delta:** Add an AuthenticationContext record referenced from sessions, decisions, and admissions; classify the local-bridge trust as an explicit low-assurance context rather than ambient trust.

## 7. Durable audit of consequential actions

**Status: PARTIAL**

**Today:** Real append-only, attribution-carrying facts exist for *some* domains: usage ledger keyed by caller-stable id with user/workspace/session/run/message attribution (`schema.ts:428-460`), duplicate-safe credit purchase lifecycle with pre-grant tombstones (`schema.ts:306-350`), binding admissions + destructive publication events (append-only, digest-checked), request ledger state machine. But general business audit is `telemetry_events` (`schema.ts:462-478`) — analytics-shaped, `distinct_id default 'anonymous'`, no actor/authority/purpose triplet, not tamper-evident. Workspace mutations (member changes, invites, settings) leave no audit trail beyond row state; sandbox telemetry excludes content by design but isn't a business audit.

**Delta:** A consequential-action audit stream (actor + represented party + authority + purpose + target version) as its own store. The plan's "durable, not just logs" test fails today for everything except money and host publication.

## 8. Trusted vs untrusted execution tiers

**Status: PARTIAL**

**Today:** The tier *boundary* is real at the sandbox/credential layer: providers `runsc` (gVisor), `bwrap`, `vercel-sandbox`, `blaxel`, `remote-worker`, `direct`, `node-workspace` (`packages/boring-sandbox/src/providers/`); credential bindings carry explicit `trust: "trusted" | "untrusted"` per consumer (`bindings.ts:35`) with delivery modes `host-only | sandbox-pipe | sandbox-tmpfs` and fd-3/tmpfs channels + egress-origin allowlists (:39-43); runsc invocation credentials enforce consumer-kind allowlist and size caps. But **plugin code has no untrusted tier**: runtime plugins execute in-process in the trusted host, front plugins are native React in the host tree; hosted/untrusted plugins are explicitly not implemented (`packages/workspace/docs/PLUGIN_SYSTEM.md:41-63,440`; archived plan `docs/plans/archive/runtime-plugin-trust-modes-plan.md`). PR #578's skill access policy (invisible/readonly/readwrite + governance RBAC) is **not on main** — no `skillAccess` hits anywhere. No promotion-to-trusted path.

**Delta:** Untrusted plugin execution (sandbox-proxied tools, iframe fronts) + a promotion record. The credential trust flag and sandbox contracts give the vocabulary; the plugin loader is the retrofit.

---

## Area verdict

The codebase has excellent *mechanism-level* integrity primitives — canonical digests, append-only admission/publication ledgers, unforgeable scopes, leased non-serializable credentials, default-deny grants — but every one is keyed to a different ad-hoc identity (`userId`, `agentTypeId`, `hostId+bindingId`, `workspaceId`) and there is no Party, no Actor abstraction, no Authority umbrella, and no effect-bound Approval. Governance today is exactly workspace RBAC (owner/editor/viewer) plus per-agent MCP/credential ceilings; everything above that layer in the north star is unbuilt. The good news: the plan's hardest invariants (immutability, digest preconditions, fail-closed admission) are already idiomatic here, so the work is mostly *unification and naming*, not culture change.

**Top 3 gaps by retrofit cost (STRUCTURAL test):**
1. **Party/Actor separation (cap. 1)** — every durable table keys on raw `userId`; each month adds more rows that will need re-attribution to Actor-for-Party. Most expensive to defer.
2. **Stable Agent subject identity with lineage (cap. 2)** — `agentTypeId`-as-identity is leaking into grants, seats, admissions, and session namespaces; each new consumer of `agentTypeId` deepens the migration.
3. **Effect-bound Approval (cap. 5)** — ask-user is shipping as *the* human-loop surface; every new tool that treats a free-text answer as authorization builds behavior the digest-bound Approval model will have to break.


---

# B. Work & the Execution Spine

# Work & Execution Spine — Survey (origin/main @ `d7efb0469`)

All paths relative to `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan/`. Everything below was verified by reading source, not docs.

## 1. Durable Work identity — MISSING

**Today:** No Work object anywhere in code. The durable customer-facing units are pi chat sessions — transcripts on the host volume via `PiSessionStore`, listed by a storage-only inventory (`packages/agent/src/server/agent-host/sessionInventory.ts:30-40`), renameable (`session.rename` effect, `types.ts:35-45`). The `tasks` plugin (`plugins/tasks/README.md`) is a Kanban UI over external adapters (GitHub issues etc.) — it doesn't own a durable Work record, and nothing links a task to sessions/runs/cost. Work as in full-plan §2.4 (goal, revisions, Runs, cost, lifecycle facets) exists only in `docs/plans/long-term/full-plan.md:405` and the untracked `boring-tasks-session-linking` plan doc.

**Delta:** New durable Work aggregate (id, name, facets, links to sessions/RequestKeys/usage facts). Greenfield — nothing to refactor, but every surface (chat, tasks, metering) must learn to attach to it.

## 2. Admission-first execution — PARTIAL

**Today:** The C6 commit protocol is genuinely implemented and mandatory for every gateway effect (`session.create/prompt/followup/interrupt/stop/delete/rename/queue.clear`, `agent.reload`, `session.command.execute` — `packages/agent/src/server/agent-host/types.ts:35-46`). Flow in `embeddedGateway.ts:708-846`: `ledger.prepare(key, digest)` → `effectAdmission.admit()` → CAS `acceptAdmission` → `beginEffect` → action → `complete` | `markOutcomeUnknown`. Rejection paths write the ledger before throwing; drain terminalizes pending→rejected and in-flight→outcome-unknown (`createAgentHost.ts:571-590`). Model calls only happen inside admitted `session.prompt`/`followup` effects, and metering reservation is fail-closed before execution (`harnessPiChatService.ts:413`). **But** the default `effectAdmission` is a stub returning `trusted-local:${requestId}` (`createAgentHost.ts:325-329`); the "admission snapshot" is a single receipt string — no resolved payer, budget, authority ceiling, agent revision, or context manifest is captured. `AgentEffectAdmission` (`types.ts:123-132`) is a seam awaiting a real implementation.

**Delta:** Real admission implementation producing an immutable structured snapshot (actor, payer/budget from the metering sink, authority ceiling, definition digest — the digest already exists at `types.ts:167-169`) persisted in the ledger record, not an opaque string.

## 3. Canonical Run identity (RunId := RequestKey) — PARTIAL

**Today:** `AgentRequestKey` = {workspaceScopeId, authSubjectId, operation, target, requestId} (`types.ts:51-57`) is the ledger key, exactly the ratified shape (`docs/plans/long-term/ratified/RECONCILIATION.md:133`). But it joins nothing beyond its own receipt: metering invents a **second** run identity `pi-run:${sessionId}:prompt:${clientNonce}` (`metering.ts:193-200`) plus a per-coordinator `instanceId` (`metering.ts:144-147`); durable event streams key by sessionId path; artifacts/effects aren't recorded at all. There is no Run record that joins inputs, authority, cost, and outputs.

**Delta:** Make the ledger record the canonical Run row; derive the metering runId from the RequestKey (clientNonce ≈ requestId already, so this is mostly a join-table/rename retrofit); add artifact/effect references to the receipt.

## 4. Attempts beneath a Run — MISSING

**Today:** No Attempt records. Retries surface as: metering `instanceId` bumps and "Cleared on auto-retry" bookkeeping (`metering.ts:144-156`) — in-memory only. Lease/fencing exists but only **in-process**: `runWithWorkspaceAgentLease` fences every publication behind a `revoked` flag and drains with a grace deadline (`workspaceAgentLease.ts:136-207,240-244`), and `EnvironmentLeaseManager` refcounts environment generations (`environmentLease.ts:56-60`). There is no persisted fence epoch; a replacement process cannot prove it superseded a stale worker.

**Delta:** Durable Attempt table under the RequestKey (attempt ordinal, runtime identity, fence epoch), with the ledger's `beginEffect` recording the owning attempt; sqlite CAS machinery (`sqliteRequestLedger.ts:149-173`) is a good base — moderate build.

## 5. Recovery (replay, reconnect, process death) — PARTIAL

**Today:** The #1009 durable-streaming work is real code: SQLite `EventStreamStore` with monotone offsets, idempotent `appendEventOnce`, subscribe (`packages/agent/src/server/events/eventStreamStore.ts:32-41`); wired via `buildAgentComposition.ts:87,292`; genuine replay from the durable store on resume, not just seq high-water-marks (`harnessPiChatService.ts:1014-1065`); a failed durable append poisons the live channel rather than silently forking history (`harnessPiChatService.ts:766`); bounded in-memory replay buffer otherwise (`piChatReplayBuffer.ts`, 1000 events). **But** it is opt-in via `BORING_CHAT_DURABLE_STREAM` env flag, default off (`buildAgentComposition.ts:37-43`). Hard-crash recovery is absent: only graceful drain terminalizes ledger records; after `kill -9`, durable rows stuck at `in-flight`/`pending-admission` have no startup reconciliation (verified: no recovery scan in `createAgentHost.ts`/`sqliteRequestLedger.ts`), a retried requestId then hits `AGENT_REQUEST_IN_PROGRESS` forever (`embeddedGateway.ts:713-730`). No checkpoint of an in-flight model turn; the follow-up queue is in-memory over pi's native queue (`piFollowUpQueueCompat.ts:26-33`) and dies with the process.

**Delta:** Startup reconciliation pass (stale in-flight → outcome-unknown or attempt-reissue under fencing), flag-on-by-default durable streams, durable follow-up queue.

## 6. Effect classification + unknown-outcome reconciliation — WRONG-SHAPE (taxonomy) / EXISTS (unknown-outcome)

**Today:** The never-blind-retry half is genuinely implemented: any failure after `beginEffect` becomes `outcome-unknown` (`embeddedGateway.ts:797-820`), replays of that key throw instead of re-executing (`embeddedGateway.ts:712,753`), and `classifySafeActionFailure` is an explicit opt-in for "provably no provider mutation began" (`types.ts` via `embeddedGateway.ts:44-55,806-810`). But "classification" in the gateway means execute/reject request validation (`embeddedGateway.ts:38-41,852-871`) — there is no observe/propose/mutate/external-effect taxonomy anywhere; the operation list is a hardcoded union of 10 session verbs, and agent **tool** calls (the actual external effects) run under the pi harness with no effect declaration or intent record. §5.5's Effect dimensions are doc-only. No reconciliation loop resolves an `outcome-unknown` later — it's terminal.

**Delta:** Effect-dimension declaration on operations/tools, durable effect-intent records, and a reconciler that can move outcome-unknown → resolved by observing the provider.

## 7. Idempotency layers — PARTIAL

**Today:** Layer 4 (admission) is strong: key + canonical digest, same-key/different-digest → `AGENT_REQUEST_CONFLICT` (`requestLedger.ts:53-55`, `sqliteRequestLedger.ts:74-78`), same-key/same-digest → receipt replay with `duplicate: true` marking (`embeddedGateway.ts:710,873-876`). Adjacent layers exist piecemeal: metering usage dedup by `usageId`/message-id (`metering.ts:153-160`), `appendEventOnce` for stream events, follow-up nonce dedup (`piFollowUpQueueCompat.ts`, `metering.ts:187-191`). Missing: operation-invocation and effect-layer idempotency beneath a run — a tool that posts to GitHub twice inside one admitted prompt has no idempotency identity at all.

**Delta:** Per-invocation/effect idempotency keys threaded through the tool adapter; the request-layer pattern is directly reusable.

## 8. Budgets — PARTIAL

**Today:** `AgentMeteringSink` seam (`metering.ts:1-45`): fail-closed `reserveRun` before execution, idempotent `recordUsage` with billed-micros truth, exactly-one settle-or-release per run, user-stop never charged via fallback (`metering.ts:163-169`), zero-token success doesn't settle free (`metering.ts:149-152`). But policy (credits, ceilings, hard stops) lives in the **host-provided sink** — nothing in-repo implements a per-run/per-agent ceiling; there is no mid-run cost check (a run reserved once can burn arbitrarily many tool loops), and exhaustion rejects the *next* prompt rather than pausing a run resumably. `maxTokensPerTurn` is explicitly "RESERVED / NOT ENFORCED" (`types.ts:189`).

**Delta:** Mid-run budget checkpoints (per model invocation) against the reservation, and a pause-with-resume state instead of reject-only.

## 9. Cancellation, deadlines, queues/backpressure — PARTIAL

**Today:** Cancellation is real and admitted: `session.interrupt`/`session.stop`/`session.queue.clear` are ledgered effects; lease bindings expose fenced `interrupt`/`stop` (`workspaceAgentLease.ts:247-268`); stop interacts correctly with billing. Queues: per-session follow-up queue with nonce dedup and selective removal (`piFollowUpQueueCompat.ts`), reserved-follow-up holds (`metering.ts:180-191`); per-binding operation serialization (`createAgentHost.ts:617-621`). Backpressure: bounded replay buffer, `MAX_READ_LIMIT`/`MAX_PAGE_LIMIT`, drain grace (`shutdownGraceMs`). Missing: per-run deadlines/timeouts (none found), cross-session/host admission queue (concurrent prompts just race), durable queues. `.agents/factory` queueing (`.agents/factory/fleet.yaml`) is a beads/markdown human process, not runtime code.

**Delta:** Deadline field in admission + enforcement in the prompt loop; host-level concurrency/admission queue.

---

**Verdict:** The execution spine's *transactional floor* is unusually solid — the W33-ratified C6 commit protocol (admission-first sequencing, CAS-terminal ledger, outcome-unknown-never-replay) is fully implemented, tested, and mandatory at the gateway, and #1009 durable streaming with genuine replay exists behind a flag. What's missing is everything *above* the request layer: there is no Work, no Run record joining cost/effects/artifacts, no Attempts, and no effect taxonomy — the ledger protects ten session verbs while the actual external effects (tool calls) run unclassified and un-idempotent beneath one admitted prompt. The seams (`AgentEffectAdmission`, `AgentMeteringSink`, `EventStreamStore`) are well-placed, so most gaps are additive rather than rework.

**Top 3 gaps by retrofit cost (highest first):**
1. **Effect layer for tool calls** (cap. 6/7) — retrofitting effect intent, classification, and idempotency into the pi harness tool path touches the harness boundary the repo deliberately doesn't own; hardest and highest-risk.
2. **Attempts + persisted fencing + crash reconciliation** (cap. 4/5) — the ledger schema and drain logic assume graceful shutdown; adding fence epochs and startup recovery changes ledger semantics every projection depends on.
3. **Work identity + canonical Run join** (cap. 1/3) — mostly additive (new aggregate + unify metering runId with RequestKey), but it must land before more surfaces mint their own identities, or the join cost grows monotonically.


---

# C. Channels, Threads, Experience & Attention

# Channels, Threads, Experience & the Attention Plane — codebase survey

Worktree `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan` @ `d7efb0469` (origin/main). Refs below are relative to that root.

---

## 1. Thread (durable conversational history) distinct from Work

**Status: PARTIAL** (durable session, no Thread entity)

**Today**
- History = pi JSONL transcripts on a server-side volume, no DB rows: `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:127` (`PiSessionStore`), root resolution `sessions.ts:59-73` (`BORING_AGENT_SESSION_ROOT` → `~/.pi/agent/sessions`); core wiring `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1071-1073`. Core Postgres schema (`packages/core/src/server/db/schema.ts`) has **no** session/message tables.
- Full list/load/resume API: `packages/agent/src/server/agent-host/httpProjection.ts:271` (list), `:340` (state), `:403` (SSE events w/ cursor), `:321` (create; `resumeSessionId` only reuses *empty* sessions, `embeddedGateway.ts:314-334`). Reconnect/device change works because state is server-side; per-device pins/tabs/layout are `localStorage` only (`packages/workspace/src/app/front/WorkspaceAgentFront.tsx:865-888`).
- Session ≠ Thread ≠ Work: `SessionDetail = SessionSummary` (`packages/agent/src/shared/session.ts:38`) — no goal/status/artifact record. Task↔session linkage exists only as a plugin-level after-the-fact join: `plugins/tasks/src/shared/index.ts:174-181` (`BoringTaskSessionLink`), handover summaries `:201-215`.
- Fragility: reading a transcript requires a *published runtime binding* — `embeddedGateway.ts:212-217` throws `AGENT_COMMAND_INVALID_STATE` if the pinned runtime is gone; sessions are workspace-scoped with no per-user attribution (`sessionInventory.ts:19-27`), CLI subject is a constant `"local"` (`packages/cli/src/server/modeApps.ts:44`).

**Delta**: introduce a first-class Thread record (id, participants, linked Work ids, status) indexed server-side (DB in core), decouple transcript *read* from runtime provisioning, per-user attribution, and durable stream-replay on by default (`buildAgentComposition.ts:37` `BORING_CHAT_DURABLE_STREAM` is opt-in).

---

## 2. Channel abstraction (WhatsApp/email/Slack/MCP/API adapters)

**Status: MISSING** (design exists; zero adapter code)

**Today**
- No inbound channel code at all: only outbound auth mail (`packages/core/src/server/mail/transport.ts:32-33`) and payment webhooks (`packages/core/src/server/credits/stripe.ts`). `docs/issues/1210/plan.md:410-430` states it plainly ("No channel code at all").
- Design is written and matches the north star (§3.4.2/§3.4.4): `docs/issues/1127/plan.md:62-130` — webhook ack, `(channel, providerMessageId)` dedupe, `(channel, externalId) → {workspaceScopeId, authSubjectId, sessionId}` binding store, per-binding serialized queue; state `needs-owner-approval`, deferred behind C6 in `docs/plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md:182-183`.
- `plugins/boring-mcp` is the *outbound* direction only — an MCP **client** connecting the agent to external servers (`plugins/boring-mcp/src/server/mcpSdkTransport.ts:5-6,172`; 7 read-biased bridge tools `agentBridge.ts:20-28`).
- Inbound MCP exists but is single-tenant and pinned: `packages/agent/src/server/mcp/managedAgentMcpServer.ts:100-154` (`delegate_task*` tools), mounted only in full-app (`apps/full-app/src/server/managedAgentMcp.ts:20`), auth = one static bearer + env-pinned workspace/user (`:37-68`).
- Idempotency infra is fragmentary and channel-unaware: `Idempotency-Key` middleware used by exactly one route family (invites, `packages/core/src/server/routes/invites.ts:39,58`); bridge idempotency store is in-memory (`packages/workspace/src/server/workspaceBridge/idempotency.ts:47-67`).

**Delta**: build `packages/agent/src/server/channels/` per plan 1127 (adapter contract, binding store, message dedupe), plus a per-caller-credentialed job-submission API — today there is no API-key issuance anywhere (better-auth cookie is the only hosted auth, `packages/core/src/server/auth/authHook.ts:26-69`). Good news: channels were *designed* to link to Work without owning identity, so no wrong-shape code to unwind.

---

## 3. Purpose-built Experience (route-first pages, declarative Views, product-owned nav, theming)

**Status: WRONG-SHAPE** (one universal workbench shell; routes are host-only)

**Today**
- Route surface is fixed by core: `/`, one `workspaceRoute`, and `/full-page/*` (`packages/core/src/app/front/CoreWorkspaceAgentFront.tsx:557-604`, `DEFAULT_FULL_PAGE_BASE_PATH` `:41`). Host apps *can* append raw `<Route>` children (`:604`), but **plugins cannot contribute routes/pages/nav**: the entire plugin surface is panels, workspace sources, panel commands, app-left actions, surface resolvers, providers, bindings (`packages/workspace/src/shared/plugins/frontFactory.ts:118-125,197-203`). No "View" or "Page" contribution type exists.
- The one product shape is the Dockview workbench + chat panes (`packages/workspace/src/app/front/WorkspaceAgentFront.tsx`), with a second shape, chat-first public shell (`chatEntryMode` `CoreWorkspaceAgentFront.tsx:531`, `packages/core/src/app/front/chatFirst/ChatFirstPublicShell.tsx`). Full-page rendering of a panel exists but is a panel *escaped* from the dock with a faked Dockview API (`packages/workspace/src/app/front/WorkspaceFullPagePanel.tsx:28-60`) — presentation identity is still panel/componentId, not a semantic route.
- Semantic targets *do* exist and match §5.1's rule: agents open `{kind, target}` via surface resolvers, not panel IDs (`packages/workspace/src/shared/types/surface.ts:3-49`).
- Theming/branding: `--boring-*` CSS custom properties (`packages/ui/README.md:131-134`), light/dark preference (`packages/workspace/src/front/provider/WorkspaceProvider.tsx:83-126`), `appTitle`/topBar slots — brandable per host app, not per product/workspace config.

**Delta**: add routed Page/View contributions (plugin declares route + nav entry + View over typed data), make navigation a product-owned registry rather than dock left-tabs, and move theming into per-product config. Surface resolvers are the right seed for "View intents"; the dock becomes one optional host among several.

---

## 4. Chat as one optional View over Work

**Status: PARTIAL** (swappable component, but the shell is chat-centric)

**Today**
- The chat implementation is injectable: `chatPanel?: ComponentType<WorkspaceChatPanelProps>` (`packages/workspace/src/app/front/WorkspaceAgentFront.tsx:251`; contract comment `packages/workspace/src/front/chrome/chat/types.ts:31-33` — "The app shell owns the actual chat implementation"), with `PiChatPanel` as default (`WorkspaceAgentFront.tsx:4`).
- But the workspace shell's spine *is* chat: chat-pane state, chat-left overlays, New-chat picker, composer stop events are all shell-level (`WorkspaceAgentFront.tsx:224-320, 784-811, 2236-2565`); attention refresh piggybacks on the chat stream (`plugins/ask-user/src/front/providerHooks.ts:100-175`); ask-user's inline rendering rides transcript tool-calls (`plugins/ask-user/src/front/index.tsx:158-164`). There is no "no-chat" shell configuration — chat is not a View you can omit, it's the shell's primary column.
- Chat degrades honestly without a model (composer blocked, not crashed: `packages/agent/src/front/chat/PiChatPanel.tsx:1091-1098`).

**Delta**: extract chat panes/state into an optional shell module so a route-first product can mount zero chat; route attention refresh and inline questions through the attention plane instead of the chat stream.

---

## 5. Attention plane — unified inbox of approvals/questions/reviews

**Status: PARTIAL** (real primitive + inbox UI exist; client-only, single producer)

**Today**
- The primitive exists in workspace: `packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx:43-68` — `WorkspaceAttentionBlocker` with typed `inbox.kind: "question"|"review"|"approval"|"notice"` (`:29-36`), focus/composer/actions. Inbox model + overlay live in ask-user: `plugins/ask-user/src/front/inbox/inboxItemModel.ts:3-40`, `InboxOverlay.tsx:51`.
- "Inbox Human Intention" is real vocabulary: the `ask_user` tool's system prompt calls its result "a blocking Human Intention in Chat and Inbox" (`plugins/ask-user/src/server/askUserServerPlugin.ts:49-53`); tasks plugin has `HumanIntentionTaskRef` (`plugins/tasks/src/shared/index.ts:182-189`).
- ask-user itself is solid: Zod-typed questions (`plugins/ask-user/src/shared/schema.ts`), file-persisted store with atomic writes (`server/askUserStore.ts:57,202-207`), bridge ops with idempotency + browser scoping (`server/askUserBridgeHandlers.ts:41-116,250-298`), answer-token authz (`server/questionsBridge.ts:74-99`).
- Gaps: the inbox is **`useState` in the browser** (`WorkspaceAttentionProvider.tsx:131`) — no server queue, no persistence, no resolved/dismissed lifecycle (every item hardcoded `status:"open"`, `attentionBlockerAdapter.ts:52`); **one producer** (ask-user; `external-hook`/`review` sources are placeholders); no ranking/deadlines/escalation; no out-of-band notification (mail transport exists but is auth-only; zero push/webhook/Slack); no default timeout — `defaultTimeoutMs` is dead code (`shared/constants.ts:27`), so an unanswered question blocks a turn forever; in-process waiters mean restart → `abandoned` (`server/askUserRuntime.ts:117,163-166`).

**Delta**: promote the inbox to a server-side, persisted attention queue (typed items, lifecycle, cross-device), register ≥2 more producers (tool-approval, task review, automation failures), wire notification delivery, and enforce §5.2's unanswered-policy (block/escalate/auto-decline) as a required field.

---

## 6. Approval UX bound to exact proposals; deep links

**Status: PARTIAL** (deep links good; binding weak; no enforced approvals)

**Today**
- Deep links exist and are explicit-only: `HumanArtifact {surfaceKind, target}` (`packages/workspace/src/shared/artifacts/humanArtifact.ts:18-26`) must be registered, never inferred (`plugins/ask-user/src/server/createAskUserTool.ts:36-52`); opened via `shell.openArtifact` (`packages/workspace/src/front/artifacts/openHumanArtifact.ts:4-20`, `InboxOverlay.tsx:115`).
- Binding is `(questionId, sessionId, answerToken, ownerPrincipalId)` only (`questionsBridge.ts:33-36`) — **no proposal/diff/content digest, no expiry, no precondition check**; a changed proposal is invisibly approvable. Nothing like §5.2's intent digest or stale-target rejection exists.
- There is **no enforced tool-call approval flow at all**: `approval-requested/-responded` are orphan display enums with zero producers (`packages/agent/src/front/primitives/tool.tsx:47-48`); the only gating is static MCP tool grants (`packages/agent/src/server/agent-host/mcpGrantStore.ts:75-147`). A dangerous action is approved only if the agent volunteers an `ask_user`.

**Delta**: add an approval decision kind with a canonical target digest + expiry + single-use consumption, and a runtime interception point in the agent host (`canUseTool`-style) that *forces* approval-class attention items — the display states already exist to receive it.

---

## 7. Multi-workspace / multi-app composition in the hub

**Status: PARTIAL**

**Today**
- CLI hub: YAML registry with per-workspace plugin config (`packages/cli/src/server/localWorkspaces.ts:16-31`), CRUD routes (`modeApps.ts:940-980`), per-workspace runtime dispatch by `x-boring-workspace-id` (`modeApps.ts:645-665`), `/workspace/:id` URLs + switcher dropdown (`packages/cli/src/front/App.tsx:86-104`, `WorkspaceSwitcherControl.tsx:64-354`). No auth (trusted local actor, `modeApps.ts:635-640`).
- Hosted core: real workspaces/members/roles/invites tables (`packages/core/src/server/db/schema.ts:40,81,96,224`), role gates (`requireWorkspaceMember.ts`), membership re-checked per call (`createCoreWorkspaceAgentServer.ts:381-390`).
- Missing: **no entitlement/plan-tier/feature-flag layer, no per-workspace plugin config in core** (grep-confirmed; entitlements only appear as future L7 in `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md:290-292`); the hub navigates *workspaces*, not *apps* — plugins are static app code, no per-workspace app catalog.

**Delta**: per-workspace plugin/entitlement config in core (the CLI's `plugins` map is the shape to port), and an app-level dimension in hub navigation.

---

## 8. Level-0 continuity (no model/agent available)

**Status: PARTIAL**

**Today**
- Graceful pieces: model discovery returns `available:false` instead of 500 (`packages/agent/src/server/http/routes/models.ts:74-118`); UI loads with composer blocked (`PiChatPanel.tsx:1091-1098`); transcript reads short-circuit to persisted snapshot without instantiating a model (`packages/agent/src/server/pi-chat/harnessPiChatService.ts:264-271,367`); files/artifacts browsable model-free (`packages/boring-bash/src/server/routes/file.ts:354-446`).
- Broken pieces: reading history still requires a **provisioned runtime** — `readSessionState`/`connectSession` go through `bindingForSession` → environment lease → `provisionRuntime` (`embeddedGateway.ts:356,377`; `createAgentHost.ts:384-411`; `environmentLease.ts:145`), so a dead sandbox makes intact JSONL unreadable; **no transcript export** (no route; `ConversationDownload` is dead code, `packages/agent/src/front/primitives/conversation.tsx:156`); no declared read-only/degraded capability flag anywhere.

**Delta**: storage-only read path for state/events (the `AgentSessionInventory` listing path already bypasses runtimes — extend it), a transcript export route, and an explicit declared continuity surface per plan §2.3.

---

## Verdict

The substrate under this area is stronger than expected — durable server-side sessions with a full list/load/SSE API, a typed attention primitive with kind-tagged inbox items and explicit artifact deep links, and semantic surface resolvers already obeying the "open intents, not panel IDs" rule. But everything human-facing converges on one universal chat-workbench shell, the attention plane is browser-state with a single producer and no enforcement power, and the entire channel/headless dimension is design documents plus one env-pinned MCP endpoint. The plan's shapes (Thread≠Work, channel-neutral identity, digest-bound approvals) are mostly *absent* rather than *wrong*, which keeps retrofit cost moderate everywhere except the shell.

**Top 3 gaps by retrofit cost:**
1. **Experience shape** — plugins cannot contribute routes/pages/nav; the Dockview+chat shell is the only product form, and chat state is fused into it (`frontFactory.ts:118-125`, `WorkspaceAgentFront.tsx`). Costliest: requires a new contribution tier and shell decomposition, touching every existing plugin's assumptions.
2. **Server-side attention plane with enforced approvals** — today's inbox evaporates on reload, binds to nothing exact, and cannot intercept a tool call (`WorkspaceAttentionProvider.tsx:131`, `tool.tsx:47-48`). Medium cost: the client types and ask-user store are reusable, but persistence, digests, and a runtime hook are new load-bearing infrastructure.
3. **Thread/Work identity + channel intake** — no Thread entity, no per-caller API auth, no channel binding store; all specified (`docs/issues/1127/plan.md`) but zero code. Cheapest per the plan's own sequencing since it's greenfield behind an adapter contract — provided the Thread record lands before adapters, so channels attach to identity instead of inventing it.


---

# D. Sources, Data, Projections & Semantics

# Sources, Data, Projections & Semantics — Codebase Survey

Surveyed at `d7efb0469` (origin/main) in `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan`. All paths below are relative to that root; everything cited was read from real code. Doc-only findings are marked.

---

## 1. Heterogeneous Sources — **PARTIAL**

**Today:** Heterogeneity exists, but as three unrelated abstractions rather than one Source model:
- **Multi-FS / mounts:** logical `FilesystemId` ("user" + arbitrary ids) with per-binding operations and access — `packages/boring-bash/src/shared/index.ts:1-58` (`FilesystemBinding`, `FilesystemBindingResolver/Provider`, `projection: "policy-filtered" | "management"`); runtime contract `packages/boring-bash/src/agent/runtime/types.ts:45-84` (`RuntimeFilesystemBinding` with read/list/find/grep/stat + optional write/delete/move + `resolveAccess`); catalog endpoint `GET /api/v1/filesystems` deriving per-fs capabilities from which operations exist — `packages/boring-bash/src/server/routes/filesystems.ts:48-92`; UI-side `FilesystemId`-qualified file resources — `packages/workspace/src/shared/types/filesystem.ts:1-17`.
- **Databases as governed queries (not mounts):** data-bridge registers `data.v1.query.run/batch` with read-only SQL guard (first-token allowlist, multi-statement rejection, forced LIMIT wrap) — `plugins/data-bridge/src/server/index.ts:68-99,189-191,469-501`; ClickHouse adapter `:225-268`; DuckDB adapters in `plugins/bi-dashboard/playground/src/server.ts:3,42,87`.
- **Services as operations:** boring-mcp models external services as `McpSource` + governed tool calls, explicitly not filesystems — `plugins/boring-mcp/src/shared/index.ts:69-85`.
- **Files as references:** SharePoint documents are durable `*.xlsx.cloud.json` refs (identity + webUrl), not synced content — `plugins/boring-sharepoint/README.md`, front-only.
- **Mail:** only outbound transactional SMTP in core (`packages/core/src/server/mail/transport.ts`). No mail Source or mail operations; the chief-of-staff mail plan exists only as an uncommitted doc in the primary checkout.

**Delta:** Introduce a Source Connection/Resource/Item registry that fs bindings, SQL adapters, and MCP sources all register into; add a mail connector as domain operations. The anti-pattern the plan warns about (everything-as-mount) is already avoided — the gap is unification, not shape.

## 2. Source Connection lifecycle — **PARTIAL**

**Today:** Fully realized for MCP only: `McpSourceStatus = "connected" | "expired" | "revoked" | "error" | "unconfigured"`, `scopes`, `credentialProvider` (provider/composio/app/user-managed), `ownerKind`, `lastVerifiedAt` — `plugins/boring-mcp/src/shared/index.ts:40-43,69-85`; `disconnectSource` seam `:238`; hosted OAuth onboarding via Composio (`plugins/boring-mcp/src/server/composioManagedConnector.ts`); status-gated execution (`shared/index.ts:617,671`); secret redaction by key pattern `:585-594`. Elsewhere: SQL creds are ambient env vars with no health/revocation (`plugins/data-bridge/src/server/index.ts:230-233`); fs bindings are per-actor/session policy-resolved with an `invalidateBinding` seam (`packages/boring-bash/src/shared/index.ts:43-53`); sandbox layer has value-free credential references resolved host-side (`packages/boring-sandbox/src/shared/invocationSecretsV1.ts`).

**Delta:** Generalize the MCP lifecycle/status model into the unified Source registry; move SQL/BSL profile credentials from env vars to brokered, revocable bindings.

## 3. Projections — **PARTIAL (narrow but real)**

**Today:** The governance plugin builds a **materialized, per-actor, regex-policy-filtered readonly projection** of the tenant company-context root (copies allowed files into a temp `projectionRoot`, exposed as the `company_context` filesystem; admins get a management readwrite view) — `plugins/boring-governance/src/server/filesystemBindings.ts:26,64-67` (`RegexProjectionHandle`), backed by `packages/boring-bash/src/server/readonlyProjectionOperations.ts` and `managementProjectionOperations.ts`, with session-scoped lifecycle/invalidation via `ScopedFilesystemRuntimeBindingManager` (`packages/boring-bash/src/plugin/runtimeBindingManager.ts`). This is a genuine policy-inheriting Projection. **No embedding/vector/index stores exist anywhere** (repo-wide grep clean); search is live ripgrep-style (`packages/boring-bash/src/server/routes/search.ts`). Projections carry no dependency manifest, Vintage, or propagation-on-revocation.

**Delta:** Dependency manifests + invalidation propagation on policy change; when an index/vector store arrives, build permission filtering pre-ranking from day one (plan §5.6 hard-requires this; nothing exists to retrofit yet — cheap now, expensive later).

## 4. Vintage / versioning of reads — **MISSING**

**Today:** Zero occurrences of `Vintage` in code. Closest artifacts: `expectedMtimeMs` optimistic-concurrency on file writes — `packages/boring-bash/src/server/routes/file.ts:507-524`; git file-URL resolution (`routes/git.ts`); fingerprinted python venv provisioning (`packages/agent/src/server/workspace/provisioning/fingerprint.ts`). Query results carry only `rowCount`/`truncated` (`plugins/data-bridge/src/shared/index.ts`) — no snapshot ID, as-of, or capture time.

**Delta:** Add a Vintage assurance descriptor field to `DataBridgeTableResult`, file reads, and MCP call receipts — starting with honest `explicitly unversioned` + observed timestamp is a small, plan-compliant first step.

## 5. Analytical semantic layer (BSL) — **PARTIAL, well-decoupled**

**Today:** BSL is an external Python package (`boring_semantic_layer`) consumed by one persistent worker per data-bridge server instance: `from_yaml` model load + `safe_eval` of Ibis expressions with an AST guard blocking dunder access and `...` placeholders — `plugins/data-bridge/python/bsl_worker.py:13-15,51-70`; TS wrapper `plugins/data-bridge/src/server/bsl/pythonBslRuntime.ts`; exposed via `data.v1.query.run/batch` bridge ops and the `query_data` agent tool — `plugins/data-bridge/src/server/index.ts:323-384,469-501`; agent guidance is a skill (`plugins/data-bridge/skills/bsl-querying/SKILL.md`). Coupling is low (one plugin, one env-var model path, worker-local model cache). **Only `query` exists** — there is no `semantic.describe` or `semantic.explain` operation; the skill tells the agent to "inspect the configured model" with no op to do so. Results carry no model digest, plan/SQL, or Vintage (contrast §5.7 semantic-provenance list).

**Delta:** Add describe/explain ops and model-identity+digest provenance on results; a multi-model registry instead of the single `BORING_BSL_MODEL_PATH`.

## 6. Deterministic domain kernels — **PARTIAL (precedent, no contract)**

**Today:** Real precedents for versioned non-LLM calculation hosting: the BSL python worker (deterministic, guarded eval, warm cache); read-only SQL adapters incl. DuckDB; fingerprint-keyed reproducible python envs (`packages/agent/src/server/workspace/provisioning/python.ts`, `fingerprint.ts`); runsc/bwrap isolation with machine-checkable **isolation evidence** and fleet admission (`packages/boring-sandbox/src/providers/runsc/isolationEvidence.ts:119-132,505-520`, `fleetAdmission.ts:8,78`) — a strong base for the plan's Execution Profiles. No kernel registry, no kernel version/digest recorded on results, no receipts.

**Delta:** A kernel registry (id + version + digest + declared inputs) whose invocations return receipts; the data-bridge worker pattern is the template.

## 7. Untrusted content / taint / prompt injection — **MISSING**

**Today:** No taint, origin, or provenance labels on any content entering agent context; tool/Source output flows into the model unlabeled. "Prompt injection" appears only in archived planning docs (`packages/workspace/docs/plans/archive/PLUGIN_MODEL.md:2118`, `packages/agent/docs/plans/archive/agent-package-spec.md:1174`). Existing defenses are all perimeter-shaped: sandbox isolation + no-default-route/no-network policies (above), MCP deny-before-allow read-only risk gating (`plugins/boring-mcp/src/server/readonlyCall.ts:102-118`), secret redaction, value-free credential refs, capability- and caller-class-gated bridge ops (`packages/workspace/src/server/workspaceBridge/authPolicy.ts:19-31,201`), governance-filtered fs projections. Nothing distinguishes an authenticated instruction from narrative Source content.

**Delta:** Origin labels on tool results and fs/MCP reads plus a sticky Run-level taint flag gating high-impact actions. This touches context assembly in the pi harness and every tool path — the costliest retrofit in this area.

## 8. Domain Contract / typed operations — **PARTIAL**

**Today:** Two real typed-operation registries exist:
- **WorkspaceBridge trusted domain ops:** enforced `domain.v1.action` naming, declared `owner`, `callerClassesAllowed`, `requiredCapabilities`, input/output schemas, size/time limits, `idempotencyPolicy` — `packages/workspace/src/server/workspaceBridge/trustedDomainHandler.ts:11,20-70`; registry + auth in `registry.ts`/`authPolicy.ts`. Used by data-bridge, bi-dashboard, ask-user, generated-pane.
- **Agent tools:** JSON-schema `AgentTool` contributed by server plugins with readiness requirements and prompt snippets — `packages/workspace/src/shared/types/agent-tool.ts:35-42`, aggregated in `packages/workspace/src/server/plugins/bootstrapServer.ts:61-87`; plus plugin skills and `systemPrompt` contributions (`plugins/data-bridge/src/server/index.ts:519`); plus MCP tool catalog search/describe with per-tool risk class (`plugins/boring-mcp/src/server/toolCatalog.ts`, risk types `shared/index.ts:41`).

Missing vs the plan: no Operation-kind or multidimensional Effect declaration, no dry-run/reversibility, no receipts, and no enforced parity — agent tools and browser bridge ops are hand-paired per plugin, and raw fs/bash remains the agent's dominant surface. Discoverability is prompt-snippet-based, not a queryable noun/verb contract.

**Delta:** Extend the trusted-domain-handler metadata with Operation kind + Effect declarations and generate the agent tool from the same definition (single source for parity); the versioned-op registry is the right chassis and cheap to extend.

---

## Verdict

The capability-provider side is materially ahead of the data side: versioned capability-gated bridge operations, an MCP source model with a genuine connection lifecycle, and sandbox isolation evidence are real, plan-shaped assets, and BSL is correctly quarantined behind a stable query operation. The data-lineage side is thin: multi-FS bindings plus the governance regex projection are the only Source→Projection seed, with no unified Source Connection object, no Vintage anywhere, and no taint/origin labeling at all. Because no embedding/index store exists yet, the plan's hardest projection rule (pre-ranking permission filtering) can still be built right rather than retrofitted.

**Top 3 gaps by retrofit cost:**
1. **Taint/origin labels + Run-level taint** — cross-cutting through harness context assembly and every tool path; every month of unlabeled tool plumbing raises the price.
2. **Vintage descriptors on all reads/results** — touches every read/query surface (files, data-bridge, MCP); trivial per-site, expensive in aggregate once more sources ship.
3. **Unified Source Connection registry** — three live abstractions (fs bindings, SQL adapters, MCP sources) must converge; the MCP lifecycle model is the template, and each new un-unified connector adds migration debt.


---

# E. Artifacts, Delivery, Evidence, Outcomes & Improvement

# Area survey: Artifacts, Delivery, Evidence, Outcomes & the Improvement loop

Surveyed at `d7efb0469` (origin/main) in `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan`. Plan refs: `docs/plans/long-term/full-plan.md` §2.4 (l.405), §5.8 (l.2327), §5.9 (l.2527).

## 1. Artifact identity (durable outputs, versions, provenance, citations)

**Status: PARTIAL (two disjoint half-implementations)**

**Today:**
- `packages/workspace/src/shared/artifacts/humanArtifact.ts:18` — `HumanArtifactSchema`: `{id, surfaceKind, target, title, description}`. This is a **UI pointer** ("open this surface"), not content identity: no version, no digest, no producing-run link, no lifecycle. `handover.ts:34` (`ProjectedHandover`) does bind an artifact list to `runId` + `terminalEntryId` per run, projected from tool-call details (`packages/agent/src/server/sessionRunDetails.ts:23`).
- `packages/agent/src/shared/agent-consumption.ts:185` — `ArtifactRef` (AC1/Decision 22, A2A-mirrored): `artifactId`, `mimeType`, `WorkspaceFileLocator` with opaque `workspaceId`/`fileId` + **SHA-256 content digest** (l.163-177), explicit `schemaVersion: '2'` (l.263), and `AgentTask.principal`/`actor` for provenance (l.271-274). Types + validators only — no persistence, no dispatcher (stated at l.9-14).
- Citations, logical-artifact-vs-version, lifecycle states, component manifests: nowhere in code.

**Delta:** Unify the two shapes: give `HumanArtifact` a locator+digest (borrow `WorkspaceFileLocator`), add a persistence layer for `AgentTask.artifacts`, and a version-chain (`supersedes` link). Citations and contracts are a later layer.

## 2. Delivery (per-destination handoff lifecycle with receipts)

**Status: MISSING (the word "handover" exists but means UI handoff)**

**Today:** "Handover" (`packages/workspace/src/shared/artifacts/handover.ts:12`) is upsert/remove of artifact pointers into the human-facing list at run end — delivery to the *local UI*, not to a destination. No delivery intent, dispatch record, receipt, acknowledgement, or destination model anywhere. Closest analogue: factory handoff ritual (`.agents/factory/README.md` session rules) prescribes "reference + revision + SHA-256 digest + read-back receipt" for session handoff artifacts — **procedure text, not a code contract**. `plugins/github-pr-tracker` tracks PR status (read-side observation), not deliveries.

**Delta:** Net-new: a `Delivery` record (intent → dispatch → observation → receipt) keyed by artifactId+digest+destination. Greenfield build; the digest-bearing `ArtifactRef` is the right input.

## 3. The evidence join (one identifier: request→execution→cost→artifact→decision→outcome)

**Status: PARTIAL — RunId join is real across 3 of 6 hops**

**Today:** `runId` (the pi entry id of the accepting user message) joins:
- execution: `sessionRunDetails.ts:1-7` (`AuthorizedSessionRunDetails{runId, terminalEntryId, state, details}`);
- cost: `packages/agent/src/server/pi-chat/metering.ts:45-56` — `MeteringRunScope{workspaceId, userId, sessionId, runId}` with reserve/recordUsage/settle/release lifecycle, idempotent `usageId` per usage row, enforced by `PiChatMeteringCoordinator` in `harnessPiChatService.ts:112-130`;
- artifacts: `handover.ts:34` `ProjectedHandover{runId, artifacts}`.

Not joined: human decision (`ask-user` questions carry `sessionId`, not `runId` — `plugins/ask-user/src/server/askUserRuntime.ts`), the accepted contract/Work unit (no Work object exists; Thread/session is the only container), and outcomes (nothing). Attempt/Model-Invocation sublevels (§5.8) don't exist; usage is an opaque blob (`packages/agent/src/shared/chat/piChatEvent.ts:40` `usage: unknown`).

**Delta:** Thread `runId` into ask-user question records and task-session links (`plugins/tasks/src/server/taskSessionLinkStore.ts` already links tasks↔sessions); type the usage payload; introduce a Work id above session. The join *spine* exists — it needs two more edges and a durable store (today it's projected from session JSON, not indexed).

## 4. Preference evidence capture (accept/edit/reject)

**Status: PARTIAL (approvals yes, edit/reject of output no)**

**Today:** `plugins/ask-user` is a durable decision store: `AskUserQuestionStatus = "ready"|"answered"|"cancelled"|"abandoned"` (`shared/types.ts:111`), append-only transcript events (`askUserRuntime.ts:172`), double-answer refusal (`askUserStore.ts:106`). This captures *explicit asked-for* decisions (the factory's two human gates route through it per `.agents/factory/README.md`). Nothing records unsolicited signals: user edits to an agent-produced file, regeneration, rejection of a draft. Review dispositions live in GitHub PR comments (process, per `docs/procedures/owner-review-card.md`), unqueryable as data.

**Delta:** Emit a typed preference event when a human edits/discards an artifact the agent produced (filesystem plugin + chat panel know both facts); ask-user store is a reasonable substrate to extend.

## 5. Outcome capture (real-world result linking)

**Status: MISSING**

**Today:** Nothing. The only later-signal loop is the factory retro pass: one-line `friction` notes on bead close, harvested by the Steward into corrective beads (`.agents/factory/README.md:87`) — free-text process, no Outcome Definition, no attribution, no code. Grep for outcome semantics across `packages/` finds nothing.

**Delta:** Even the plan's "manual" floor is net-new: an `Outcome` record attachable to a Work/artifact id with definition-version and provisional/final status. Cheap once #3's join spine and a Work id exist; unbuildable before.

## 6. Evaluators / evals

**Status: EXISTS (narrow) — tool-trajectory evals + CI hard gates; no protection model**

**Today:**
- `packages/agent/src/eval/` — real framework: YAML suites with `!EvalAny`/`!EvalRegex` matchers (`types.ts:26-48`), `runSuite.ts`, pinned default model as deliberate policy (`evalConfig.ts:9` — "model deprecation is a visible PR"). Runner: `apps/workspace-playground/src/eval/run.ts:34-40` boots a real seeded workspace server and asserts tool-call trajectories (`woreplace-skill.yaml:16-24`). Asserts *which tools were called with which params* — not output quality.
- Factory review gates: `.agents/factory/README.md` stage table — review runs as **fresh-context subagents at gate time** (context isolation from the worker), bounce rules in `policy.yaml` (`review_rounds_max: 3`, `worker_attempts_per_bead: 2`). UI hard gates: `tools/ui-review/` + per-issue `hard-gates.json` in CI.
- Protection from the judged agent: **git trust ladder only** — `policy.yaml` `trust_ladder.class_b_always` blocks agent-merge of `.agents/factory/**`, personas, workflows. Eval fixtures themselves (`apps/workspace-playground/src/eval/*.yaml`) are ordinary repo files a worker can edit in the same PR as the code they judge; no held-out custody, no negative-control/mutation checks (§5.9 "load-bearing gates" is DOC-ONLY).

**Delta:** Add eval fixtures to `class_b_always` (one-line, immediate); longer term, output-quality evaluators with versioned identity and a custody boundary outside the worked-on repo.

## 7. Candidate/incumbent comparison + promotion/rollback of agent behavior

**Status: PARTIAL — immutable revisions exist; comparison/promotion machinery is git+humans**

**Today:** Agent definitions are genuinely versioned and pinned: `compileAgentDirectory.ts:388,486,524` (definition `version`, per-asset digests), `piResourceDigest.ts:95` (`boring-pi-resource-digest-v4`, "immutable digest plus reload fences that defend that exact snapshot" l.158), `fleet.yaml:8-11` (skill digests as **authority pins** — stale pin drops the seat rather than running unpinned; repin must ship in the same commit as the skill edit). Rollback = git revert. Comparison of two agent revisions, exposure records, staged rollout, Objective Basis: nothing. Promotion = PR through the two human gates under the trust ladder.

**Delta:** The hard prerequisite (immutable, digest-addressed revisions) is done. Missing piece is an A/B harness: run the eval suite (#6) against two pinned fleet revisions and diff reports — buildable on `runEvalSuite` + `loadConfiguredAgentFleet` with no new substrate.

## 8. Cost/usage attribution per run/artifact

**Status: PARTIAL — per-run billing seam is strong; per-artifact and analytics attribution absent**

**Today:** `metering.ts` is the best-shaped code in the whole area: fail-closed reserve before execution, idempotent per-message `recordUsage` (`usageId`), exactly-one settle/release per run, billed-micros as the billable truth rather than raw provider fields (l.31-35), all keyed by `runId`+`sessionId`+`workspaceId`+`userId`. But the sink is host-provided — this repo ships the seam, not a ledger. `plugins/ccusage-dashboard/agent/index.ts:30-52` is provider-level: shells out to `ccusage` CLI + OAuth quota endpoints (l.111,132), writes daily aggregates to `.pi/data/` — dev-quota observability, joins to nothing. No cost roll-up to artifact or Work.

**Delta:** Ship a default durable metering sink (append-only usage facts file/DB per workspace); artifact-level cost then falls out of joining `MeteringUsageInput.runId` with `ProjectedHandover.runId` — both already exist.

---

## Verdict

The evidence *spine* is further along than the plan's prose suggests: a stable `runId` already joins execution state, metered cost, and produced-artifact pointers, and agent revisions are immutably digest-pinned with a real (if narrow) eval runner — but everything downstream of production is missing: no delivery/receipt model, no Work unit above the session, no preference capture beyond asked-for approvals, and zero outcome semantics. The two artifact systems (UI `HumanArtifact` pointers vs. digest-bearing `ArtifactRef`) are the same concept built twice and must converge before delivery or outcomes can attach to anything. Evaluation integrity currently rests entirely on the git trust ladder, which does not cover the eval fixtures themselves.

**Top 3 gaps by retrofit cost (cheapest first):**
1. **Eval fixture custody** — add eval YAML paths to `trust_ladder.class_b_always` in `.agents/factory/policy.yaml`; near-zero cost, closes the §5.9 "judged agent edits its own judge" hole today.
2. **Converge `HumanArtifact` onto the digest-bearing `ArtifactRef` locator + a durable metering sink** — both are joins of existing keys (`runId`, digest), no new architecture, and they unlock cost-per-artifact and delivery.
3. **A Work id above session/Thread** — every §2.4/§5.8 capability (Delivered/Accepted/Successful, outcomes, disputes) hangs off it; retrofitting it later means migrating every store that today keys on `sessionId`, so it gets more expensive with each new plugin store shipped.


---

# F. Packaging, Distribution, Instances & Developer path

# Area survey — Packaging, Distribution, Instances & the Developer path

Surveyed at `origin/main` = **d7efb0469** in `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan`. Plan refs: full-plan.md §2.5 (L447+), §3.6 (L976+), §5.12 (L2796+).

---

## 1. Package identity & immutable versions — **PARTIAL**

**Today**
- Plugin identity = `package.json#name` (or `boring.id`), validated + canonical-id asserted against the front's `definePlugin` id: `packages/workspace/src/server/agentPlugins/scan.ts:54-61, 273-311, 328-344`. Version is whatever `package.json#version` says, defaulting `"0.0.0"`: `scan.ts:345`.
- Two distribution channels: (a) **npm** — 21 first-party packages/plugins published in lockstep (all at 0.1.100) with `npm publish --provenance` and tag-vs-version check: `.github/workflows/release.yml:31-41, 74-84`; (b) **workspace registration** — `.pi/settings.json#packages` entries (local path / `npm:` / `git:` specs) resolved into external plugin sources: `packages/workspace/src/server/agentPlugins/settingsSources.ts:34-59`; written by `boring-ui-plugin install`, which records source spec + version and materializes copies under `.pi/npm|.pi/git`: `packages/plugin-cli/src/server/pluginSources.ts:23-29, 311-317, 467`.
- "Version" at runtime is a per-plugin **mutable monotonic revision** for cache-busting, recomputed from file signatures: `packages/workspace/src/server/agentPlugins/manager.ts:184-186`; `PLUGIN_SYSTEM.md` §5.2.

**Delta**: no content digest as identity, no immutability (installed dirs are editable in place), no signing of plugin content (npm provenance covers only the npm channel), no registry object. Need Package/PackageVersion records keyed by digest, and make `.pi/settings.json` a pointer to immutable resolved versions rather than live directories.

## 2. Package → Release → Deployment → Instance separation — **MISSING**

**Today**: exactly the "one mutable installed plugin" shape §5.12 forbids. A plugin is a directory scanned at boot//reload (`scan.ts:220-381`); there is no Release build, no Deployment record, no rollout state. Closest artifacts: `packProvisioningArtifact` tarballs install sources (`pnpm pack`) so sandbox installs get real copies — a proto-Release build step: `packages/agent/src/server/workspace/provisioning/packArtifact.ts:27-52`. Closest Instance: core's Postgres `workspaces` row with members/invites/settings and runtime handles: `packages/core/docs/README.md` (schema line: users, sessions, workspaces, members…).

**Delta**: introduce all four as records. The scan/asset-manager pipeline would need to consume a resolved immutable manifest (compiled composition + digest, as §5.12 "deterministic contribution composition") instead of re-hashing live dirs. Retrofit is deep — every consumer (asset manager, hot reload, provisioning) assumes live paths.

## 3. Instance isolation (workspace-per-customer) — **PARTIAL**

**Today**
- **fs**: workspace = a folder; runtime layout nests everything under `<root>/.boring-agent`: `packages/boring-sandbox/src/providers/node-workspace/runtimeLayout.ts:43-72`. Sandbox is **opt-in**: CLI default `--mode local` = runtime `direct` = "no sandbox, full network"; bwrap only via `local-sandbox` (`packages/cli/docs/README.md` "Runtime modes" table). Read-only path policy exists (default protects `.agents`): `packages/agent/src/server/runtime/readonlyFilesystemPolicy.ts:25`.
- **sessions**: file-backed under one shared root (`~/.pi/agent/sessions` or `BORING_AGENT_SESSION_ROOT`), separated only by namespace subdirectory: `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:60-73, 99-106`.
- **db**: core is one shared Postgres, row-scoped by workspaceId with `requireWorkspaceMember` gating (`packages/core/docs/README.md`, source layout `server/auth/`). No per-instance database.
- **secrets**: CLI hub uses **one global** Pi `AuthStorage.create()` for all workspaces: `packages/cli/src/server/cli.ts:145-147`; workspace docs confirm "provider credentials live in Pi's auth store" (`packages/cli/docs/README.md:6-8`). No per-workspace credential vault on main (BYOK/governance budgets are per-tenant policy, not per-workspace secrets: `plugins/boring-governance/README.md:1-3`).

**Delta**: per-instance credential scoping, session roots, and (for hosted multi-customer) default-on sandbox are the gaps. The workspace-scoped source/plugin shadowing machinery (`scan.ts:287-296`) shows workspace identity already flows through the plugin layer, so scoping secrets/sessions per workspace is a moderate retrofit; per-instance data stores are a large one.

## 4. Capability passport — **MISSING** (one adjacent mechanism EXISTS, one is branch-only)

**Today**
- Plugin manifests declare only entry paths (`boring.front/server`, `pi.extensions/skills/packages`) — **no capability/permission fields at all**: `packages/workspace/src/shared/plugins/manifest.ts` and `packages/plugin-cli/src/manifest.ts` (grep for permission/capability/access: 0 matches).
- Pre-install checks are structural only: path containment + existence (`scan.ts:131-174`, §5.6 realpath containment), `boring-ui-plugin verify` (manifest validity, no code execution: `plugin-cli/README.md:34-37`).
- Closest existing passport-shaped thing: `agentConfigContract.keys` — a fail-closed declaration of accepted Agent-level config keys: `PLUGIN_SYSTEM.md:245-249` (`defineServerPlugin`).
- The skill access policy (invisible/readonly/readwrite, PR #578) is **NOT on main**: commit `9afdbdd69` "feat(governance): add plugin skill access policy" lives only on branch `feat/plugin-skill-access-governance` (`git merge-base --is-ancestor` → not ancestor). Doc-only/branch-only.

**Delta**: add a declared-capabilities block to the plugin manifest (Sources, tools, routes, egress, effects), surface it at `install` time in plugin-cli, and enforce at load. Land/extend the skill-access-policy branch. Greenfield addition — low retrofit cost, high leverage.

## 5. Local overlays & upgrade safety — **WRONG-SHAPE**

**Today**
- Only overlay mechanism: a **workspace-local external plugin silently shadows** a global external plugin with the same id: `scan.ts:287-296` (splices the global one out, no diff, no report beyond scan result).
- Upgrade = files change in place → signature hash changes → revision bump → hot reload; the only safety nets are (a) previous front stays live on import/register failure (`PLUGIN_SYSTEM.md` §4.5 L265-267, §5.4) and (b) `requiresRestart` warnings when server code drifts: `manager.ts:208-218`, §5.5.
- npm/git installs: `boring-ui-plugin install` re-materializes; dependencies are the user's problem (`plugin-cli/README.md:41-44`). No lockfile of the plugin closure, no migration concept, no rollback, no capability diff on update, no consent gate.

**Delta**: §5.12's three-way merge (incumbent defaults / new defaults / local overlays), effective-capability diff, and last-known-good rollback all need the Release/Deployment records from #2 first. Today an update under a customized workspace either shadow-wins (local copy hides the update entirely) or clobbers (in-place update, customizations only survive if they were a separate shadowing copy).

## 6. Trusted vs sandboxed plugin code — **WRONG-SHAPE** (P0.6 not implemented; the opposite exists)

**Today**
- Trust model is explicit and documented: plugin tool `execute()` runs **in the host Node process and bypasses the sandbox by design**; hosted/marketplace untrusted plugins (iframe fronts, sandbox-proxied tools) are "not implemented … future phase": `PLUGIN_SYSTEM.md:58-63`, non-goals §7 L438-446.
- External (`.pi/extensions`, agent-writable) plugin **fronts** run as native React in the host tree (`PLUGIN_SYSTEM.md:47`). No iframe isolation anywhere.
- **`boring.server` from agent-writable roots is not refused — it is loaded.** `RuntimeBackendRegistry.reloadOnce` filters for `source.kind === "external" && plugin.serverPath` and jiti-imports the module into the host process, hot-registering its routes behind a constrained router (`RuntimePluginRouter`, no raw Fastify): `packages/workspace/src/server/runtimeBackend/runtimeBackendRegistry.ts:228-263`, `pluginImports/importServerModule.ts:36-42`, `runtimeBackend/defineRuntimeServerPlugin.ts:27-49`. Dispatched via a per-workspace gateway keyed by `x-boring-workspace-id`: `runtimeBackendGateway.ts:134-166`. Comment confirms intent: `manager.ts:196-197`.
- Real containment that does exist: manifest path containment + realpath symlink checks (`scan.ts` §5.6), provisioning template targets constrained to workspace root (§5.6), readonly fs policy for `.agents` (`readonlyFilesystemPolicy.ts:25`), plugin loading skipped under `vercel-sandbox` mode (`PLUGIN_SYSTEM.md:59-60`).

**Delta**: P0.6 default-deny (or sandbox-execute) for external `serverPath` is a direct contradiction with the shipped runtime-backend feature — resolving it needs a policy decision (local-dev trusted vs hosted default-deny switch), then iframe/sandbox-proxied execution for the hosted tier. This is the highest-risk gap for any hosted multi-tenant offering.

## 7. Developer path (npx boring create/dev/test/deploy) — **PARTIAL**

**Today**
- `npx boring-ui` = zero-config local hub: folder mode (one folder = workspace "default") and workspaces mode (multi-workspace hub, YAML registry at `~/.boring-ui/workspaces.yaml`): `packages/cli/src/server/cli.ts` dispatch + `localWorkspaces.ts`; `packages/cli/docs/README.md:13-63`. That covers the "dev" experience for *using* the platform locally.
- Plugin authoring loop exists end-to-end minus deploy: `boring-ui-plugin create` (npm-package template from `templates/plugin/`), `scaffold` (workspace runtime plugin), `verify`, `test` (self-test against a running server), `install/list/remove`: `packages/plugin-cli/README.md:20-45`.
- **No** `create` for an app, **no** `deploy`, **no** hosted target: grep for deploy in `packages/cli/src/server/cli.ts` → comments only. App deployment today is out-of-repo (child apps like Constellation on VPS/Fly; only `fly-worker-volume-backup.yml` in workflows).

**Delta**: §3.6's `npx boring create/dev/test/deploy` needs an app-level scaffold (templates beyond a single plugin), a manifest describing Agents/Operations/Experience, and a deploy command targeting a hosted control plane that doesn't exist yet. `plugin-cli`'s programmatic API (`plugin-cli/README.md:57-64`) is the natural seed.

## 8. Publisher/subscriber data boundary — **MISSING**

**Today**: no publisher concept. Plugin "provenance" is at most the npm scope `@hachej` and the `source.kind: internal|external` axis (`agentPlugins/types.ts`); nothing records who authored vs who operates. Core's workspaces/members model owner/member roles inside one app but has no notion of installed-package author. `plugins/boring-governance` does tenant policy/model-filter/budget — the closest to per-tenant boundary enforcement — but it's operator config, not a publisher/subscriber contract. Five-data-categories separation (§2.6) has no code counterpart; plugin `pi.skills`/Knowledge and workspace data live in the same fs tree.

**Delta**: publisher identity would ride on Package records (#2) plus signing; the subscriber-data firewall (no evidence/data flowing back to package author) is currently trivially true only because there is no telemetry channel to an author at all — it must be designed in before marketplace distribution, not retrofitted after.

---

## Verdict

The plugin layer is a well-built **local-trust, live-directory** system — deterministic scanning, id canonicalization, path containment, atomic front replacement, and npm-with-provenance publishing are real and solid — but it has exactly one lifecycle stage ("directory on disk, hot-rescanned"), so Package/Release/Deployment/Instance, capability passports, and upgrade merges are all absent by construction, and instance isolation stops at row-scoping plus opt-in sandboxing with globally shared credentials and session roots. The sharpest conflict with the plan is that agent-writable external plugins' `boring.server` is affirmatively hot-loaded into the host process via the runtime-backend registry — the inverse of P0.6 — and both fronts and tools of every tier run in-process. The developer path is half-built: plugin scaffold/verify/test/install exist and are good, but there is no app scaffold, no deploy, and no hosted target.

**Top 3 gaps by retrofit cost (highest first):**
1. **Immutable Package→Release→Deployment→Instance records (#2)** — every consumer (asset manager, hot reload, provisioning, settings sources) assumes mutable live paths; deferring this makes every later capability (passports, diffs, rollback, publisher identity) unanchorable.
2. **Trusted/sandboxed execution split (#6)** — in-process external server/front/tool execution is fine for local dev but structurally disqualifying for hosted multi-tenant; the runtime-backend registry decision must be re-litigated before any marketplace work.
3. **Per-instance credential/session/data isolation (#3)** — shared Pi auth store and shared session root are cheap to scope now (workspace identity already threads through), expensive to untangle after customers exist.


---

# G. Automation, Triggers, Factory & Operator tooling

I have enough evidence. Compiling the report.

# Automation, Triggers, Code Factory & Operator Tooling — Survey

HEAD: `d7efb0469` (worktree `/home/ubuntu/projects/boring-ui-v2/.worktrees/long-term-plan`, = origin/main)

---

## 1. Automation as governed actors

**Status: PARTIAL** — schedules exist as real code; governance (budget, loop prevention, event triggers) does not.

**Today**: `plugins/boring-automation` is a substantial trusted server plugin (~2.9k lines server code):
- CRUD + run of scheduled prompt automations via UI, HTTP routes, and a trusted boot-time `boring_automation` Pi tool (`plugins/boring-automation/src/server/automationTool.ts`, `routes.ts`, `operations.ts`). Model cannot inject workspace/user/path — host-derived context, fail-closed (`README.md` "Scope and authorization").
- Schedule = 5-field cron + IANA tz evaluated per-minute (`src/shared/schedule.ts:1-30`, croner). Dedup via `duplicate-scheduled-run` / `active-run` skip reasons; hosted mode uses DB active-run + scheduled-minute constraints as cross-process guard, 30s heartbeats, 5-min stale terminalization (`src/server/hostedDueRunService.ts`, `hostedScheduler.ts`).
- Local mode has **no background timer** — user cron must POST `/api/v1/boring-automation/due` per minute; missed minutes not backfilled.
- Identity: fixed local actor (CLI) or authenticated actor-scoped Postgres store (hosted). Per-automation model + effort (`thinkingLevel`) — dispatch-time model choice (#1143) is real.

**Delta**: zero budget/spend caps, no loop/causality detection, no fan-out limits, no occurrence identity/backfill policy, no dry-run, no event-trigger rules at all (schedule-only — grep for budget/loop/concurrency in the plugin returns nothing). §5.10's Automation-as-governed-Actor needs: budget binding (the metering seam exists, see §6), a trigger/rule revision record, and an event subscription surface.

## 2. The factory

**Status: PROCEDURE-ONLY core loop, PARTIAL substrate** — seats boot as code; orchestration (dispatch, Beadle, gates) is humans + markdown + `br`/`gh` CLI.

**Today**:
- Executable: `loadConfiguredAgentFleet()` (`packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts`, 522 lines) reads `.agents/factory/fleet.yaml` under `BORING_AGENT_FLEET=1`; skill SHA-256 digest pins (stale pin silently drops the seat, `fleet.yaml:8-11`); model tier fallback chains (`fleet.yaml:32-67`) resolved from `policy.yaml:61-66` seat→tier map. AgentHost is real: `packages/agent/src/server/agent-host/createAgentHost.ts` (34K), `fleetCompiler.ts`, `sessionInventory.ts`, `workspaceAgentLease.ts`, `requestLedger.ts` (idempotent request ledger, sqlite variant).
- Seats: three booted — triage/orchestrator/worker (`fleet.yaml:69-109`); concierge/reviewer/auditor/**beadle** are deferred, personas parked as test fixtures.
- Procedure-only: the stage table, lanes, bounce rules, lease heartbeats, claim order (`.agents/factory/README.md:37-127`) are prose executed by LLM sessions running `br`/`gh`/`git` by hand. **The Beadle supervisor has no code**: grep for "beadle" outside docs hits only the two YAML files; `tools.md:12` assigns it to "scheduled automation" in boring-automation, but no such automation is wired. Work state = beads (`br` CLI, `.beads/` in git); no Work/Run substrate objects.
- `plugins/tasks/src/server/beadsSource.ts` + `githubSource.ts` render beads/GH into the workspace board — explicitly read-only (`tools.md:36-39`).

**Delta**: the §3.5 north star requires factory Work = platform Work. Today's bridge candidates exist (tasks plugin adapters, boring-automation, AgentHost sessions) but nothing joins them: no coded dispatcher, no lease enforcement (policy.yaml thresholds are parsed by nobody), no bounce-rule automation. First build: a Beadle automation reading `policy.yaml` for real.

## 3. Gates

**Status: PARTIAL** — CI + UI-review gates are platform-recorded; thermo/fresh-eyes/plan gates are agent self-report.

**Today**:
- Platform-recorded: `.github/workflows/ci.yml` (30K; `ui-review-fixture` job at `ci.yml:470-533` runs `boring-ui-review-tools ui:review:ci`); `invariants.yml` (action-pin check, `pnpm lint:invariants`, `check:golden-path`). UI review engine is real code: `tools/ui-review/src/core/` (contracts.ts 17K, improvement.ts, replay.ts, trace.ts, imageHash.ts) emitting `hard-gates.json` + `UiCriticReportV1.schema.json` artifacts (examples under `docs/issues/1086/`).
- Self-report: thermo review, `fresh-eyes` review subagents, review dispositions, proof-of-work comments — all skill-markdown procedure (`.agents/skills/fresh-eyes/`, `docs/procedures/proof-of-work.md`) whose evidence is agent-authored GH comments. Trust ladder / class-A auto-merge (`policy.yaml:34-51`) is declared but no merge bot evaluates it.
- §3.5 invariant "worker's self-report is not sufficient" is currently violated by design for everything except CI/UI-review.

**Delta**: platform-originated receipts for review verdicts (recorded check runs, not comments), negative-control/mutation tests proving gates are load-bearing, and an executable class-A merge gate reading `trust_ladder`.

## 4. Delegation / bounded child work

**Status: PARTIAL, mostly out-of-repo**.

**Today**: `pi-subagents` is a **runtime plugin skill from the pi harness, not in this repo** (AGENTS.md notes this; only trace is a renderer-key doc comment `packages/agent/src/shared/tool-ui.ts:2`). Fan-out authority table `tools.md:15`. Bounded-ness is conventions: worker spawns fresh-context review subagents (`fleet.yaml:96-98`), MODEL-CARD says Fable "delegates read-only context gathering to a Sonnet subagent". No budget narrowing, no child-Work objects, no provenance chain in repo code. Isolation that does exist in code: `environmentLease.ts` / `workspaceAgentLease.ts` (agent-host), git worktrees by procedure.

**Delta**: §5.15 "orchestrator and worker-Agent APIs using bounded child Work, isolated execution, budgets, provenance" — none exists as an owned API; requires bringing subagent spawn into the platform with budget/authority narrowing.

## 5. Multi-agent routing (Model Card)

**Status: PARTIAL — policy is doc, tier resolution is code.**

**Today**: `docs/procedures/MODEL-CARD.md` (60 lines) defines tiers/review-ladder/escalation — pure doc, humans/LLMs apply it. But seat→tier→concrete-model fallback **is executed**: `policy.yaml models.seats` + `fleet.yaml models.tiers` env-var-gated candidate lists resolved at boot (`loadConfiguredAgentFleet.ts`, `modelTierCandidates.registry.test.ts`). Per-automation model choice is code (§1). Escalation ("quality miss escalates a tier"), Sol-track caps, review ladder = doc-only.

**Delta**: routing decisions (escalate, defer-not-downgrade, per-bead tier override) need a dispatch-time mechanism; today only boot-time and per-automation selection exist.

## 6. Operator tooling

**Status: PARTIAL** — session-level controls exist; per-run traces/replay/cost dashboards/scoped kill switches don't.

**Today**:
- Stop: `POST /api/v1/agents/:agentTypeId/sessions/:sessionId/stop` (`packages/agent/src/server/agent-host/httpProjection.ts:554`). Automation pause/resume + `agentToolEnabled:false` boot gate (capability-only rollback). Session inventory (`sessionInventory.ts`).
- Budget/metering: real seam — `packages/agent/src/server/pi-chat/metering.ts` (~800 lines): reserve/recordUsage/settle/release per run, idempotent `usageId`, fail-closed reserve so hosts enforce **hard stops**. But it's a hosted-billing seam; no operator dashboard consumes it in-repo. `plugins/ccusage-dashboard` (tracked) shows local Claude-Code spend only.
- Traces/replay: Pi session transcripts are the only execution record (files under session root); `tools/ui-review/src/core/replay.ts`+`trace.ts` do deterministic replay **for UI review only**. No admission snapshot, no append-only execution record, no replay grades (§5.15).
- Diagnostics: SSE ready-status (`packages/agent/src/server/http/routes/readyStatus.ts`), request ledger for duplicate suppression. No cost/error/latency dashboards, no scoped kill-switch matrix, no Effect reconciliation.

**Delta**: largest gap in the area. Minimum viable: per-run record (admission inputs + usage + terminal state) persisted outside transcripts, a runs/cost view, and scoped freezes (per-automation exists; per-agent/model/workspace don't).

## 7. Event/notification substrate

**Status: PARTIAL — SSE + Postgres LISTEN/NOTIFY islands, no unified bus.**

**Today**: transport is SSE everywhere (`text/event-stream` in `uiRoutes.ts`, `agentPlugins/routes.ts`, `agent/src/server/worker/routes.ts`, `agent-host/httpProjection.ts:412-434`, `boring-bash/src/server/routes/fsEvents.ts`, `cli/src/server/modeApps.ts`) — no WebSockets (known 6-connection starvation issue). Cross-process: `PostgresAutomationRunEventBus` on `boring_automation_run_changed` LISTEN/NOTIFY channel (`plugins/boring-automation/src/server/runEventBus.ts:5`), in-memory bus locally. Human decisions flow through the ask-user plugin (`plugins/ask-user/src/server/askUserStatePublisher.ts`, `questionsBridge.ts`) — the Human Intention inbox is real code. Agent-to-agent: none — `tools.md:31-33` explicitly says the bead ID as correlation key "is the whole reason no agent-messaging system is needed yet". Session event queue: `agentSessionEventQueue.ts` (1.2K, per-session).

**Delta**: §5.10 domain events (versioned envelopes, outbox atomicity, consumer checkpoints, replay policy) — nothing; each subsystem invents its own channel. A shared outbox/event contract is a prerequisite for both governed automations and the factory-on-platform migration.

---

## Verdict

The area is a barbell: at one end genuinely production-shaped code (boring-automation's hosted scheduler with heartbeat reconciliation, AgentHost fleet with digest-pinned skills and tier fallback, metering with fail-closed reservations, the ui-review gate engine), and at the other end the entire factory control loop — dispatch, Beadle, bounce rules, trust ladder, review evidence — existing only as markdown executed by humans and LLM sessions over `br`/`gh`. The connective tissue the north star demands (Work/Run/Artifact substrate, domain events, execution records) is absent, so the factory cannot yet be "another customer of the platform" because the platform has no product to be a customer of. The good news is the retrofit ingredients already exist in-repo and mostly need composition, not invention.

**Top 3 gaps by retrofit cost (cheapest first):**
1. **Beadle as a real automation** — cheap: boring-automation can already run a scheduled prompt per policy.yaml tick; wire one that parses `policy.yaml`, sweeps leases, and spawns workers. Turns the factory's supervisor from prose into the first dogfooded governed automation.
2. **Per-run execution record + cost view** — medium: metering.ts and requestLedger already capture the facts; persist them per run and surface a runs/cost/kill pane. Unblocks §5.15 operator minimums and gives gates something platform-recorded to attach to.
3. **Event/outbox contract + event triggers** — expensive: today's SSE/LISTEN-NOTIFY islands must converge on a versioned event envelope before event-initiated automations, loop detection, or factory-on-Work-substrate are buildable; touching every subsystem's notification path is the structural cost.


---

# H. Sovereignty, Deployment, Providers & Continuity

# Sovereignty, Deployment, Providers & Continuity — code survey at `d7efb0469` (origin/main)

Sources: real code + deploy configs; plan targets from `docs/plans/long-term/full-plan.md` §2.3 (:369), §4.9 (:1214), §5.14 (:2984); decisions D27/D28/D29 (`docs/DECISIONS.md:436-478`); W33 findings register (`docs/plans/long-term/ratified/register.md`).

## 1. Model provider replaceability — **PARTIAL (mechanism) / WRONG-SHAPE (authority)**

**Today:** Boring never resolves a provider key itself — auth is delegated wholesale to pi: `AuthStorage.create()` + `ModelRegistry.create()` read process env + `~/.pi/agent/auth.json` (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:591-595`; `packages/agent/src/server/http/routes/models.ts:66-69` caches one registry **per process**). Anthropic/OpenAI/Gemini come from pi's catalog; Boring hardcodes only `infomaniak` (Swiss, `modelConfig.ts:11-19,134-141`) plus one generic OpenAI-compatible custom provider (`modelConfig.ts:200-229`), keys passed by env-var *name* (`apiKey: '$'+env`, `modelConfig.ts:107-112`). So provider *replaceability* is decent (any OpenAI-compatible endpoint via env). Provider *authority* is not: `ModelCapabilityIssuer` (D27/A7) has **zero code hits** — doc-only (`register.md:12`, F-33-G3 verified). **F-33-G15 is live and unremediated**: cached `AuthStorage`/`ModelRegistry` per session (`createHarness.ts:594-595,720`) + ambient host auth = a model path that never consults workspace BYOK; D27 is actively bypassed, and governance model allowlists gate only the `/models` listing, not execution (`plugins/boring-governance/src/server/index.ts:116-134`; same shape as F-33-G4).

**Delta:** Build A7 — an invocation-scoped `ModelCapabilityIssuer` seam between harness and pi (D29 already names the re-evaluation trigger: "harness accepts invocation-scoped capability rather than process env"), kill the process/session-lifetime registry caches, and move the send-path model check from "key present in ambient auth" (`createHarness.ts:258-275`) to issuer-granted authority.

## 2. Sandbox/compute provider replaceability — **EXISTS (interface) / PARTIAL (fleet)**

**Today:** `SandboxProviderV1` is a real contract with 5 implementations — direct, bwrap, blaxel, vercel-sandbox, remote-worker (`packages/boring-sandbox/src/shared/providerV1.ts:97-109`; capability matrix `shared/providerMatrix.ts:23-125`). Selection: `BORING_AGENT_MODE` → 4-arm switch (`packages/agent/src/server/runtime/resolveMode.ts:15-30`; `packages/agent/host/sandbox.ts:97-135`); custom backends only by injecting a `runtimeModeAdapter` (`createWorkspaceAgentServer.ts:1287-1290`), never by config. The gVisor/runsc stack (SBX1) is ~3.7k LOC of real code — Docker `--runtime=runsc`, Go supervisor, isolation-evidence/qualification with a `4.19.0-gvisor` sentinel (`providers/runsc/runtime/dockerArgv.ts:75`, `isolationEvidence.ts:504`) — but **`runsc` is not in the provider union and `RunscSessionRuntimeV1` has no non-test consumers**: qualified-but-unmounted. The new remote-worker provider's transport is interface-only (sole impl is a test fake, `providers/remote-worker/transport.ts:23-33`) and its credential resolver is a stub TODO (`createRemoteWorkerProvider.ts:46-53`).

**Delta:** Mount runsc as a `SandboxProviderV1`/mode, ship one real `RemoteWorkerTransportV1`, and open provider selection to config (closed union → registered providers) so sovereign compute (§5.14 "replaceable compute and sandbox providers") is a deployment choice, not a code change.

## 3. Hosting/deployment — **PARTIAL**

**Today:** One production Dockerfile (`apps/full-app/Dockerfile`): `web-runtime` = single Fastify process serving SPA + agent/plugin/MCP APIs on :3000, uid 10001, `BORING_AGENT_MODE=vercel-sandbox` baked, durable volumes `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces` + `BORING_AGENT_SESSION_ROOT=/data/pi-sessions` (entrypoint chowns + `setpriv` drop, `apps/full-app/docker/web-entrypoint.sh`); `worker-runtime` = bwrap-exec worker (`apps/full-app/src/server/agent-worker.ts:1-17`, config `workerConfig.ts:44-54`) with `--reset-env` allowlist entrypoint. `productionSafety.ts:5-9` rejects direct/local in prod (escapable via `BORING_ALLOW_UNSAFE_AGENT_MODE=1`; `dev.ts` skips the check). **No compose file, no fly.toml, no deploy workflow** — CI builds and health-smokes both images but publishes nothing (`ci.yml:619-665`); the only committed infra is a Fly worker-volume backup cron (`.github/workflows/fly-worker-volume-backup.yml`). Constellation/Tailscale: doc-only, zero code hits. `DEPLOYMENT_WORKFLOW.md:6-9` self-labels as target shape. CLI has no `serve`/hub subcommand — `boring-ui` runs a local workspaces server on :5200 with a YAML registry at `~/.boring-ui/workspaces.yaml` (`packages/cli/src/server/localWorkspaces.ts:32`).

**Delta:** A committed reference topology — compose/manifest with volumes, Postgres, worker routing, and image publication — so "hosted instance" is reproducible from the repo rather than living in operators' heads. Note the `BORING_WORKER_WORKSPACE_ROOT` vs `BORING_AGENT_WORKSPACE_ROOT` naming split.

## 4. Credential handling — **WRONG-SHAPE**

**Today:** Three tiers. (a) Shipping: `workspace_settings` encrypted **inside Postgres** via `pgp_sym_encrypt` with a *single global* passphrase `WORKSPACE_SETTINGS_ENCRYPTION_KEY` (`PostgresWorkspaceStore.ts:153,812-814`) — no per-workspace DEK, no AAD (rows decrypt fine if moved across workspaces), plaintext + KEK transit the SQL wire, and `encryptAndPut` has no non-test callers anyway. (b) Built-but-dead: a genuinely good BYOK vault — AES-256-GCM envelope with workspaceId-bound AAD and per-workspace DEKs (`packages/agent/src/server/credentials/vault/envelopeCrypto.ts:21-35`; `shared/credentials/kmsBackend.ts:99-107`), non-serializable leases — but **no Postgres persistence** (in-memory only; `vault/persistence.ts:14-18` defers it to bead 16f.2) and `withResolvedCredential` has **zero production consumers** (F-33-G6 confirmed). (c) Practice: plaintext process env; MCP secrets are `storage: 'server-env'` (`plugins/boring-mcp/src/server/appServerBinding.ts:127-135`). Worse, spawned sandbox/tool processes in direct mode **inherit the entire host env including all keys** — `{...process.env}` via `getEnvSnapshot()` (`providers/runtimeSupport.ts:12-14` → `workspacePythonEnv.ts:30,37-44`; F-33-G7); the env allowlist exists only on the remote worker exec path (`packages/agent/src/server/worker/exec.ts:24-38`) and scrubbing (R-33-13) is doc-only.

**Delta:** Finish 16f.2 (vault Postgres persistence + KMS backend), wire `withResolvedCredential` onto the MCP/model paths, and scrub spawned-process env with an allowlist in direct/bwrap modes — the highest-leverage single item in this area.

## 5. Region/residency — **MISSING (one exception)**

**Today:** Exactly one enforcing line in the codebase: the Blaxel provider hard-fails unless `BORING_BLAXEL_REGION` starts with `eu-` (`packages/boring-sandbox/src/providers/blaxel/config.ts:78-92`) — the only place "sovereign" appears in code. No residency field in config schema, no region column in the DB, no residency identifier anywhere in `packages/`/`plugins/`/`apps/`. Everything else (Swiss/EU tiers, mount-level `residency: "CH"`) is planning-inbox prose (`docs/plans/long-term/inbox/2026-08-17-*`).

**Delta:** Residency is HOOK-class per the plan's own analysis — introduce a residency/region property on the storage + sandbox-placement seams (workspace runtime, provider selection, session root) now, before tenants exist; §5.14 warns it also covers projections, logs, backups, and keys.

## 6. Backup/restore/export — **MISSING**

**Today:** No export, backup, restore, or snapshot feature in product code — no route, no CLI command, no UI action (route grep: zero hits; the addressed session route list `agent-host/testing/compositionRouteProof.ts:9-28` has delete but no export). Sessions persist as JSONL under `BORING_AGENT_SESSION_ROOT` (`sessions.ts:57-73,190-192`) so files are *operator*-copyable; the one chat-export primitive `ConversationDownload` exists but is never rendered (`packages/agent/src/front/primitives/conversation.tsx:133-192`). Users can download single files only (`MediaViewer.tsx:105-110`, `CodeEditorPane.tsx:48-53`). No git-based workspace versioning (git usage is remote-URL building only, `boring-bash/src/server/routes/git.ts:66-88`). Account deletion exists (`core/src/server/app/routes.ts:157-197`) with no data-export counterpart. Only ops artifact: the Fly volume-snapshot cron (14-day retention). The plan's "portable exit" manifest (§5.14) is entirely unbuilt.

**Delta:** Minimum viable exit: session-transcript export (wire the dead primitive), a workspace archive endpoint (tar of `/data/workspaces/<id>` + sessions), and a GDPR export beside `DELETE /me`. Postgres backup remains undeclared operator responsibility — say so or own it.

## 7. Continuity / Level-0 — **PARTIAL (accidentally good)**

**Today:** Broadly fail-open, model-independent by construction rather than by declared contract. Boot never requires model creds (core config schema has no provider field, `core/src/server/config/schema.ts:41-114`; CLI auth check is a banner only, `cli.ts:426-445`). Workspace readiness ignores provider auth (`buildAgentComposition.ts:220` passes `harnessReady: true`). Chat history reads cold from JSONL with no pi session (`harnessPiChatService.ts:264-271,371-390`); file browse/edit and all filesystemPlugin surfaces have zero model imports; failed keyless turns surface as typed error events and are not billed (`piChatEvents.ts:296-323`; `metering.ts:770-789`). One fail-closed edge: an agent pinning `model.preferred` forces strict resolution, so the SSE connect can 400 with no credentials even though `/state` serves history (`buildAgentComposition.ts:221-229` → `createHarness.ts:231-237,271`). "Level 0"/"continuity surface" appear nowhere in code — the §2.3 versioned continuity declaration is doc-only.

**Delta:** Small: fix the model-pinned SSE 400 (serve history stream, fail only the turn), then codify the existing behavior as a declared, tested continuity surface per §2.3.

## 8. Tenant isolation at infra level — **PARTIAL**

**Today:** App-level isolation is genuinely thorough: membership + role checks (`core/src/server/auth/requireWorkspaceMember.ts:16-73`), request-scoped workspace pinning with HTTP 421 on violation (`requestWorkspaceScope.ts:11-57`), selector allowlists on the agent server (`createWorkspaceAgentServer.ts:395-424`), per-workspace `0o700` dirs with traversal + realpath-symlink jails (`fsProvisioner.ts:31-47`; `node-workspace/paths.ts:50-101`), and gVisor isolation-evidence probes covering cross-sandbox/cross-workspace vectors (`shared/runtimeIsolation.ts:1-49`). But DB isolation is **row-scoping only**: one Postgres, `workspace_id` columns, **no RLS policies anywhere**, no `tenant_id`/`instance_id`, no per-tenant schema — one missed `where` clause is a cross-tenant leak with no backstop, exactly what §5.14 says an `instance_id` column can't cover. The governance "tenant" is a single YAML-file tenant per deployment (`plugins/boring-governance/src/server/policyTypes.ts:4-43`). The shared-`ubuntu`-pg-role clobbering is a VM ops issue (dedicated role owning the db), not addressed in repo config — connection is a single `DATABASE_URL` pool (`core/src/server/db/connection.ts:10-14`). Agent event streams are per-host SQLite, path-scoped (`events/sqlStorage.ts:86-94`; F-33-G13: one DB per host).

**Delta:** Add Postgres RLS keyed on workspace (cheap backstop now), a dedicated db role in reference deploy config, and decide the dedicated-db-per-tenant tier before SaaS tenants exist.

---

**Verdict.** The sovereignty *skeleton* is unusually well-prepared — a real sandbox-provider contract, a qualified gVisor stack, an AAD-bound credential vault, EU-flavored decisions (D23/D27/D28), and an accidentally strong model-down continuity surface — but almost every sovereignty-critical piece is built-and-unwired while the live paths run on ambient env auth, full env inheritance into spawned processes, one global settings passphrase, and row-scoped single-database tenancy. Model-provider *swap* is easy today; model-provider *authority* (who pays, per workspace, per invocation) is the actively bypassed D27/A7 gap that blocks any billed or multi-tenant offering. Export/backup and residency simply don't exist as product concepts, which is tolerable now but is exactly the class the plan flags as expensive to bolt on.

**Top 3 gaps by retrofit cost:**
1. **A7 ModelCapabilityIssuer + BYOK wiring (F-33-G3/G15/G6)** — credential ownership retrofitted after tenants and sessions exist is the plan's own named worst-case; vault crypto is done, so cost is a seam change now vs a migration later.
2. **Tenant isolation backstop (RLS / dedicated roles / per-tenant boundary decision)** — §5.14 explicitly rejects "one column is sufficient"; adding RLS pre-tenants is days, post-tenants it's an audit of every store method.
3. **Residency as a placement property on storage + sandbox seams** — one `eu-` check today; the inbox analysis is right that it's a mount/placement-level property that cannot be a bolted-on workspace setting once data exists. (Export/backup ranks just below: costly to lack, but cheap to add at any time given JSONL + per-workspace dirs.)
