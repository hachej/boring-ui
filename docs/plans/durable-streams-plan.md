# Plan — Clean, durable, stateless agents composable in workspaces

Status: **r3 — superseded-in-part by owner rulings 2026-08-27 (recorded by
the shell-pack session); r2 body preserved below as historical detail.**
Spine authority: `docs/direction/DIRECTION.md` (2026-07-27, amended 2026-08-08).
Decision 28/29 govern architecture; `packages/agent/docs/AGENT_GATEWAY_V0.md`
governs the session contract ("code wins" rule applies); the #391 F-graph
governs Environment execution. Where this plan and DIRECTION disagree,
DIRECTION wins until the owner amends it.

## r3 revision summary (2026-08-27)

Per the owner's post-spike rulings, this plan is re-cut as three P1 slices
(see `docs/plans/multiagent-shell/premises.md` P1 for the authoritative
slice table):

- **P1-A (substrate-neutral durability) — DISPATCHABLE NOW:** canonical
  session identity memo, gateway request/effect ledger, activity-index
  reconstruction, follow-up/attention persistence, two-store reconciliation
  contract, private harness backend seam under D29, headless + paused-human
  tests.
- **P1-B (transcript/event sequence continuity) — BLOCKED** on a qualifying
  pi runtime release plus an empirical re-spike; criteria live in
  `docs/plans/multiagent-shell/research/pi-v2-alignment.md` §Adoption
  qualification criteria.
- **P1-C (Level-D completion, default-on, D29 re-evidence gate)** — after
  P1-B.

r2's open questions are superseded: identity is **workspace-scoped**, per
the premise constraints (not the r2 global-`sessionId`-vs-`agentTypeId`
question); the serial A1→A2→A3 sequencing and "packaging Plan B" question
move out of this plan. The r2 owner-gate note below (missing second
reviewer) applies to the **r2 body only** — P1-A dispatches under the
DIRECTION amendment regardless of that stalled review.

---

## Review log (r2, historical)

| Round | Reviewer | Verdict | Disposition |
|---|---|---|---|
| r1 | grok-4.6 (thermonuclear, fresh context) | NEEDS REVISION — 4 blockers, 8 majors | Folded into r2: split into Plan A/B, killed S6, rewrote S1/S2/S3/S4/S5, fixed factual errors, made proofs falsifiable |
| r1 | claude-fable-5 | **NOT RUN** — OpenRouter credits exhausted (402); Anthropic OAuth refresh token expired | **Blocker for owner gate.** Re-auth Anthropic (`pi` auth) or top up OpenRouter, then rerun |

## 1. Goal statement (owner intent)

Have a **clean durable stateless agent** that we can **compose in workspaces**:

- **Clean** — an agent runtime is a pure composition of (agent definition,
  environment lease, session state). No ambient process globals, no
  host-path-coupled identity, no hidden singletons.
- **Durable** — sessions, event streams, queued follow-ups, and receipts
  survive process restarts. Replay never silently gaps. Level D in the
  gateway-conformance sense — which today exists only as empty stubs, not as a
  selectable level.
- **Stateless** — session-serving state is derived from durable stores or is a
  documented cache with a rebuild path; a crash loses nothing a user wrote.
  **Scope ruling requested from owner (see Q1):** single-writer-per-session
  across restarts (crash-safe) is IN scope; arbitrary multi-process serving of
  one live session is OUT of scope unless the owner says otherwise — the
  shipped request ledger already arbitrates claims, and true multi-process
  live-tail needs infrastructure (cross-process subscribe) that is its own
  lane.
- **Composable in workspaces** — agent definitions are data (packages);
  seating is per-workspace configuration; install/update follows the ratified
  reboot flow without platform-image redeploy.

This plan covers **Wave 2 streaming durability** (trigger fired) plus the
already-ratified packaging slice. It does not open new lanes.

## 2. Where the long-term plan and the code actually are

Re-verified against this checkout after review (detached HEAD `d1b671bcc`,
2026-08-21; plan claims must be re-checked against current `origin/main`
before beads are cut):

| Spine says | Code reality | Verdict |
|---|---|---|
| AgentGateway v0 frozen contract (D29) | `shared/gateway/types.ts`, 7 methods + close, branded `AuthorizedAgentScope`, nested scope DTOs, 15 error codes | Shipped; CI-invariant enforced |
| Keyset pagination cursors are HMAC-signed | Actually SHA-256 MAC over a **per-process `randomUUID` secret** (`embeddedGateway.ts` `cursorSecret`) — list cursors die on restart. `AGENT_GATEWAY_V0.md` says code wins; doc bug noted | Shipped, but restart-hostile; see S3 |
| Level B replay ships; Level D "parameterized" | Conformance type is `'B'` only (`GatewayReplayConformanceLevel`); the Level D cases are `it.skip` stubs (request-ledger restart, admission crash matrix, activity-index reconcile). Nothing selects them | Matches spine; "parameterized" overstated in v0 doc |
| Streaming durability = wiring plus read path | `SqliteEventStreamStore` written and wired behind `BORING_CHAT_DURABLE_STREAM`. But the "durable replay buffer" hydrates only `min(1000, MAX_READ_LIMIT)` trailing events back into the in-memory ring (`hydrateDurableReplayBuffer`); subscribe still serves from the ring. Older-than-window cursors still `REPLAY_GAP`. Schema v1 rows are ALREADY being written in production when the flag is on | Wiring done; **the Level D read path does not exist** |
| Agent definitions as packages (#1136 r2); #1107 slice 3 queued next, below landing/BYOK | Repo personas + workspace-local registration; boot-time-only fleet (D28: fleet copied/frozen/validated before serving; change = deploy/restart, no registry/controller) | Partially; slice 3 = discover local packages + **documented bump→digest→reboot flow**, not hot seating |
| Workspace-scoped fleet boundary | Named future work in `AGENT_PACKAGES.md`; NOT scheduled by any DIRECTION wave | Out of scope here |
| F-graph frozen until Wave 1 demo | Stale: Wave 1 substantially delivered; amendment makes #1123 ACTIVE at LOW priority. F-graph execution opened in Wave 2 | S3 must consume F1b/request-ledger contracts, not freelance lifecycle |

## 3. Gap analysis — what makes today's agent not stateless/durable

Inventory done against the files, per review demand. Every Map below becomes a
checklist row in S3: durable source of truth, or accepted-loss with a
user-visible error.

G1. **In-process service state machine** (`harnessPiChatService.ts`):
   `channels`, `channelCreations`, `sessionGenerations`, `activePromptRuns`,
   `syntheticPromptFailures`, `activeSyntheticPromptErrors`, `liveAttachments`;
   reconciler Maps (`piChatMessageMetadataReconciler` ×3 — clientNonce/clientSeq
   recovery for follow-ups and metering); per-channel `messageTurnIds`, mapper
   seq, `publishQueue`; `piFollowUpQueueCompat` in-memory `queue` +
   `seenNonces`; metering coordinator's in-process run table even when the
   sink has durable reservation ids. Keys:
   `sessionCacheKey = JSON([sessionId, workspaceId, userId])` — no
   `agentTypeId`.

G2. **Keying is triple-tracked and undocumented.**
   `sessionCacheKey [sessionId, workspaceId, userId]` vs stream path
   `sessions/<that JSON>` vs `agentSessionKey
   [workspaceScopeId, agentTypeId, sessionId]` vs
   `sessionNamespaceForAgent [agentTypeId, sha256(workspaceScopeId)[:20],
   namespace]`. Production configured agents already use namespaced dirs (no
   cwd coupling); the cwd-derived `defaultSessionDir` is the legacy/unset
   fallback. Session ids are minted UUIDs, so uniqueness-of-sessionId is the
   de facto invariant. DIRECTION's "decide keying BEFORE durable schema" was
   written before #1128 wrote schema-v1 rows anyway.

G3. **Durability stops at Level B, by construction.** Hydrated ring window =
   1000 events; anything older `REPLAY_GAP`s even when sqlite holds the rows;
   corrupt/non-monotonic hydrate stops early and continues (silent partial
   replay); queued follow-ups die with the process; a crash between
   persist-enqueue steps can double-execute or lose a receipt.

G4. **Host-process state beyond the service**: `createAgentHost` binding Maps
   (bindings/published/reservations/generations/operation tails),
   `AgentSessionActivityIndex` (process-lifetime presence projection),
   `EnvironmentLeaseManager` in-process refcounts, per-process `cursorSecret`,
   in-process store listener Maps (no cross-process notify).

G5. **Fleet is boot-time-frozen by Decision 28.** Install/update/seating
   requires restart. Ratified #1107 slice 3 = discovery + documented bump →
   `write:skill-digests` → reboot flow. Hot recomposition would require a D28
   amendment and is NOT planned here.

Non-gaps (out of scope): BYOK injection seam, external MCP on-ramps, sandbox
egress isolation, hub seating of workspace-local packages (S6 killed per
review — unscheduled lane), public vertical agents, marketplace lanes.

## 4. Plan A — Wave 2 streaming durability (issue #1009)

### A1 — Owner keying ratification + migration of already-written v1 rows

The schema exists; the decision doesn't. Before ANY further production rows:

- Owner ratifies exactly one of: (a) uniqueness-of-sessionId is THE invariant
  (de facto today; `agentTypeId` stays out of keys, addressing already rejects
  cross-agent use), or (b) add `agentTypeId` to durable keys/paths.
  Recommendation: (a) — it matches `randomUUID()` minting, avoids inventing a
  fourth key grammar, and keeps alignment with `agentSessionKey` where the
  agent dimension already lives.
- Align the four key shapes in one identity memo: `sessionCacheKey`,
  `sessionStreamPath`, `agentSessionKey`, `sessionNamespaceForAgent`.
  Stream path stops embedding the JSON cache key.
- Write a real DATA migrator for existing v1 rows (re-key/rename stream paths
  if ratification changes them). Do NOT bump `schema_version` for this —
  `migrateEventStreamSqlSchema` asserts, it does not migrate; a bump bricks
  boot on existing DBs.
- Remove the `appendAgentEvent` default `streamPath ?? sessionStreamPath(
  sessionId)` footgun — require an explicit typed path.
- Proof (failing-first): migrator test with pre-change fixtures; assertion
  that every written stream path parses under the ratified grammar; old rows
  still replay read-only post-migration.

### A2 — Store-backed replay: the real Level D read path

Not a flag flip. In order:

1. Serve subscribe/replay FROM the store (bounded by a stored retention
   policy, not `min(1000,1000)`); the ring becomes a write-through cache, not
   the replay source.
2. Widen `GatewayReplayConformanceLevel` to `'B' | 'D'`; convert the empty
   Level D skips into real tests written failing-first: cursor N−(window+1)
   after restart returns the event, not `REPLAY_GAP`; corrupt-hydrate fails
   loudly instead of continuing silently.
3. D29 re-evaluate is an explicit owner gate (D29 lists Level D activation as
   its own trigger) — present evidence, get ratification.
4. Only then flip `BORING_CHAT_DURABLE_STREAM` default-on in production host
   compositions, keeping an explicit off-switch.
5. Fix the restart-hostile list cursor while here: persist or derive
   `cursorSecret` (host key) so pre-restart pages keep working — otherwise
   the Wave 1 console lies about sessions after every deploy.
- Done-bar: playground AND full-app; E2E includes >1000-event stream,
  mid-turn kill -9, restart, zero-gap client resume.
- Proof (failing-first): each named assertion above; suite runs green ONLY at
  `replayLevel: 'D'` with non-empty test bodies.

### A3 — Crash-proof the turn lifecycle (consume the request ledger)

Scope: single-writer crash safety, NOT multi-process live serving (Q1).

- Full state census from §3-G1/G4: every Map/Set gets "durable source" or
  "accepted loss + surfaced error" in the PR description table.
- Extend `SqliteAgentRequestLedger` (durable-transactional, CAS on
  request_key) rather than inventing a second claim protocol: incarnation/
  ownership tokens, generation continuity across restart.
- Persist the follow-up queue with idempotency key = requestId + clientNonce +
  sessionKey (reuse `appendEventOnce` machinery); required test: kill between
  queue-persist and harness-enqueue does not double-run.
- Reconciler nonce/clientSeq state rebuilt from transcript + durable stream,
  or persisted; attachment bytes located durably or re-requested with a clear
  client error.
- Metering: make reservations durable BEFORE run start and settle-or-release
  from terminal lifecycle across restart. Optional-sink durability only — no
  new general metering schema in this lane (DIRECTION commercial premises:
  #819 ships only when a usage-priced offer pulls it).
- Cross-process subscribe stays out of scope; document that two processes on
  one store do not live-tail each other (accepted limitation, revisit only if
  a named consumer appears).
- Proof (failing-first): kill -9 mid-turn → restart → queue intact, no
  duplicate execution, metering settled or released, client replays zero-gap;
  presence/activity degrades explicitly (not silently wrong) after restart.

### A4 — Finish session-storage decoupling (narrowed)

Production configured agents are already namespace-clean. This slice only:

- Migrate leftover cwd-mangled `defaultSessionDir` / legacyDefault stores to
  the stable namespace; read-compat window.
- Remove residual `cwd` carried inside native transcript wrappers.
- Keep `BORING_AGENT_SESSION_ROOT` contract unchanged (AGENTS.md rule 9).
- Proof: legacy fixture migrates and lists correctly; move session root
  between deploys → history survives; grep-prove no wrapper writes `cwd`.

## 5. Plan B — Packaging: #1107 slice 3, reboot-honest

Sequencing per DIRECTION: agent-packaging lane, **below landing/BYOK**; this
is the already-ratified slice, executed as written — no hot reload.

- Discover workspace-local packages + document/verify the full flow:
  bump package + agent versions → `pnpm write:skill-digests` → host reboot;
  seat-authoritative digest mismatch excludes only that seat.
- Fleet stays compile-once at boot (D28 untouched). If hot seating is ever
  wanted, that is an owner D28/D29 amendment in its own plan — explicitly not
  this work.
- Proof: install → chat → update definition → reboot → next turn uses new
  digest, old session continues; mismatch excludes only that seat; no code
  path mutates a running fleet (negative test).

## 6. Dependencies

```text
A1 ──► A2 ──► A3 ──► conformance gate      (Plan A = #1009)
A4 ───────────────────────┘                (independent within Plan A)
Plan B (#1107 slice 3): independent lane, ordered below landing/BYOK by DIRECTION
```

## 7. Risk register (reordered per review)

| # | Risk | Handling |
|---|---|---|
| 1 | D28 static-fleet authority vs any "live update" wording | Plan B is reboot-honest; hot seating requires owner amendment, out of scope |
| 2 | Bounded hydration marketed as Level D | A2 forbids default-on until store-backed replay + real Level D tests exist |
| 3 | Default-on bakes undecided keys into production rows | A1 gates everything; migrator before any further rows |
| 4 | `schema_version` bump bricks boot on existing DBs (assert-not-migrate) | Data migrator only; version bump only with migrator + boot-compat proof |
| 5 | One sqlite file per sessionRoot; 25ms blocking busy timeout + 250ms retry window vs request-ledger's separate file @5000ms — divergent lock policies under one "stateless host" | Document; measure under A3 crash tests; unify only if evidence demands |
| 6 | Store listeners in-process → no cross-process tail; WAL does not fix it | Accepted limitation recorded in A3 |
| 7 | Per-process `cursorSecret`: console presence/list breaks every deploy | Fixed in A2 step 5 |
| 8 | Double-execution in persist↔enqueue crash window | Idempotency key design REQUIRED in A3, with gap-crash test |
| 9 | Plugin tools execute in host Node process (`pluginSandboxBypass.test.ts`) — relevant the day untrusted packages compose into shared hosts | Recorded; belongs to the future trust-gate lane, not Plan A/B |
| 10 | Corrupt hydrate silently truncates replay | A2 converts to loud failure |

## 8. Open questions for the owner (gate together with the fable review)

Q1. Stateless scope: is single-writer crash-safety enough, or is arbitrary
    multi-process serving of one live session a requirement? (Recommendation:
    crash-safety only.)
Q2. Keying ratification per A1(a)/(b). (Recommendation: (a).)
Q3. Confirm Plan B stays sequenced below landing/BYOK per DIRECTION.
Q4. D29 re-evidence gate for Level D activation (A2 step 3).

## 9. Out of scope

Hot fleet recomposition, hub seating of workspace-local packages (former S6 —
unscheduled lane, needs its own DIRECTION amendment + trust model), BYOK UI,
external MCP providers, sandbox egress isolation, persona content, CoS
features, public vertical agents/self-signup, marketplace lanes, #905 v2
remote Host.
