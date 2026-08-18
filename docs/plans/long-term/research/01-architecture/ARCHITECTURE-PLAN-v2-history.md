# Boring Agent Framework — Architecture Plan

Audit date 2026-08-14, against `main`. Every claim carries a file:line verified this date.
Method: 4 parallel code censuses (workspace contents, agent standalone-readiness,
env/exec paths, security questions) + the W33 research cycle (DeepSeek/Flue/eve/opencode
scouts, seam census, loop-authority trace, PR #1256 review).

---

## 1. Target architecture

One sentence per layer; everything below is measured against this.

| package | is | is NOT |
| --- | --- | --- |
| **agent** | The Flue-equivalent: loop + tools + gateway + chat surface + **its own per-agent record**. Complete standalone. | a workspace client; a tenancy system |
| **workspace** | Multi-agent **composition + workspace view**, consuming N agents through the same gateway the standalone binary serves. | a plugin SDK; an auth/token issuer; a plugin host |
| **core** | Identity/membership; the only authority that mints real user scope. | an agent runtime |
| **boring-bash / boring-sandbox** | Leaf mechanism packages. | *(already true: zero value imports of agent — census 2)* |
| **NEW: agent-types (or plugin-sdk)** | Extracted leaves; see Track B. | — |

### Two governing rules (ratified this cycle, survived adversarial review)

**R1 — Authority vs mechanism** (R-33-15): *can this unit increase what the agent
is permitted to do?* Yes → single, host-owned, handed into the funnel, never
inferred from env, never authored, never runtime-mutable. No → freely pluggable
at composition time. Corollaries: tool registration is authority; sandbox
provider *selection* is authority-adjacent; the loop, storage backends, and
model adapters are mechanism.

**R2 — Record vs envelope** (R-33-16): the agent owns its conversation record
(its own store, "model-visible means logged" is its contract). The host owns the
interaction envelope — the request ledger (`agent-host/requestLedger.ts`,
already built, keyed `(agentTypeId, sessionId)` per census 2). Tenancy audits
the envelope, never the record. This split is what makes independent agents
compatible with governance.

---

## 2. What the audit established (grounding)

### 2.1 Already true — do not rebuild

- **Agent is a leaf at runtime.** All 52 reverse imports from bash/sandbox are `import type`; zero value/dynamic imports (census 2).
- **`agent/shared` is leaf-clean.** 92 files, zero server/core imports, zero node-only APIs. Extraction = import-path bump only.
- **Standalone runs.** `bin/boring-agent.ts` boots gateway + env routes + chat front with no workspace/core.
- **Scope verification exists.** Four `AgentScopeVerifier` impls, one per host, all wired (required option). Object-identity (WeakMap) based — sound in-process.
- **MCP policy/mechanism already split.** Grants (`mcpGrantStore.ts:13`) vs transport (`managedAgentMcpServer.ts:184`) are separate modules.
- **Exec wire vocabulary exists.** `RemoteWorkerExecRequestSchemaV1/ResponseSchemaV1` (`remoteWorkerProtocolV1.ts:326-360`) + full error-code set, production-proven via `workerClient.exec`.
- **Sandbox registry landed** (PR #1256): immutable descriptor registry, no mutation API, fixture-tested openness.

### 2.2 Misplaced — the workspace audit (census 1; package = 459 files, 93k LOC)

| what | where | LOC | belongs |
| --- | --- | --- | --- |
| Generic plugin SDK (define→scan→load→serve→consume) | `shared/plugins/*`, `server/plugins/*`, `server/pluginImports/*`, front plugin client | ~5,000 | new leaf `plugin-sdk` package |
| Session auth/RPC plumbing | `server/workspaceBridge/*` (authPolicy, runtimeToken, refreshTokenStore, idempotency, httpRoutes) | ~4,500 | agent (session transport) / core (token issuance) — split decision needed |
| Agent↔UI command transport | `front/bridge/*` (uiCommandBus/Dispatcher/Stream) | ~3,700 | agent front (it is session transport, not view) |
| Bundled first-party plugins | `plugins/filesystemPlugin`, `plugins/urlPanePlugin` | ~14,450 | `plugins/<name>/` top-level, like other first-party plugins |
| Generic runtime-backend registry | `server/runtimeBackend/runtimeBackendRegistry.ts` | 278 | plugin-sdk — AND it is the RCE site (see 2.4) |
| Agent-invocable UI tools | `server/ui-control/tools/uiTools.ts` | 458 | agent tool surface |
| `createWorkspaceAgentServer.ts` internals | lines 354-425 scope issuance; 426-853 packaging/provisioning/artifact identity; 1163-1236 auth/health | ~1,200 of 2,172 | only ~45% of the fleet-assembly file is fleet assembly |

Net: **~28k LOC (~30% of the package) is not composition or view.** The rule
holds; the package doesn't.

### 2.3 Environment inheritance (census 3)

~15 spawn sites; **zero filter anywhere**. Full `process.env` reaches: direct
sandbox exec, bwrap exec (values inherited even though FS is namespaced),
host-strategy bash spawns, ALL provisioning subprocesses
(`provisioningAdapter.ts:82-88`, `provisionRuntime.ts:69`, `packArtifact.ts:41,55`,
vercel `provisioningAdapter.ts:46,62`), git ops (`gitFileUrl.ts:12`).
`getEnvSnapshot` is **duplicated** (`boring-sandbox/providers/runtimeSupport.ts:12`
+ `boring-bash/agent/runtime/environment.ts:1`). HOME preserved on direct/host
(intentional, gh/git auth), rewritten on bwrap.

### 2.4 Security posture (census 4 + cycle)

| finding | status |
| --- | --- |
| External plugin code imported into unsandboxed host, may register routes (`runtimeBackendRegistry.ts:228,241,243` vs PLUGIN_SYSTEM.md "route-free") | **FATAL, live**; gates the external-plugin epic; handled privately |
| CLI hub mints scope from self-asserted `x-boring-workspace-id` header, no token (`modeApps.ts:956`,`:99`) | OK localhost-only as documented; **any non-local exposure = mint any workspace's scope**. Needs a bind guard. |
| Scope verified once into closure; WeakMap membership never revoked (`embeddedGateway.ts:155`) | membership-epoch fix stands (R-33-11 revised) |
| Env inheritance (2.3) | undeclared + unbounded, not "leak" — P2 end-to-end per PR #1256 review |
| Approval states in front (`Tool.tsx:13-14`, `'approval-needed'` group state) | **confirmed dead code**: absent from wire type `BoringChatToolState` (5 members), zero server producers, zero pi-side mechanism at 0.80.7 |
| Durable event stream default-off (`BORING_CHAT_DURABLE_STREAM`), single host-wide sqlite with busy-retry | superseded by Track A2 (per-agent record) rather than fixed in place |

---

## 3. The plan — five tracks

Ordering rule: each track independently shippable; arrows are hard prerequisites.

```
P0 (hygiene, this week)
Track A (agent = Flue-equivalent)  ──┐
Track B (workspace slims to its name)├──> Track C (remote/independent agents)
Track D (decisions & invariants) ────┘        └──> senecaapp.ai external-agent tier
```

### P0 — Hygiene (days, no design)

| # | action | grounding |
| --- | --- | --- |
| P0.1 | Delete dead approval states from front unions + group state, or file "build a real approval flow" and keep behind it — never both silently | census 4 Q3 |
| P0.2 | CLI hub: refuse non-loopback bind unless a real verifier is configured; one assertion + test | census 4 Q2 |
| P0.3 | Converge duplicated `getEnvSnapshot` to one exported site (prep for A4, no behavior change) | census 3 |
| P0.4 | Delete or wire the two dead seams: tool `collisionPolicy` (set `'error'` in `buildAgentComposition` — one line makes shadowing loud) and the credential vault (delete or name its consumer + date) | seam census |
| P0.5 | `TODO(#1220)` marker + selection invariant paragraph in PR #1256 (agreed with reviewer) | PR #1256 |

### Track A — Agent package becomes the Flue-equivalent

| # | action | contents | grounding |
| --- | --- | --- | --- |
| A1 | Extract `agent/shared` → leaf types package | mechanical: 92 files already clean; consumers bump import paths; kills the type-only reverse edge and makes "agent is a leaf" structural, CI-enforceable | census 2 §1-2 |
| A2 | **Per-agent record** (R-33-16 core) | replace host-wide `.agent-event-stream.sqlite` with a per-agent store the agent owns; import pi JSONL as the migration path (R-33-04, proven on a 4,229-line transcript); host keeps the ledger as envelope; kill `BORING_CHAT_DURABLE_STREAM` flag — the record is not optional | R-33-01 restated + spike-pi-storage + census 2 §3 |
| A3 | Production standalone mode | built static front (no Vite), real auth option, no wildcard CORS, non-constant `sessionId`/`hostId` | census 2 §4 lists every literal |
| A4 | Env policy end-to-end | descriptor `env:` field + enforcement at ALL spawn sites from census 3's table + allowlist with `direct` keeping gh/git HOME intent explicit + tests; the census table IS the checklist | census 3, PR #1256 review |
| A5 | MCP connection moves agent-side; grant stays host-issued | the module split already exists; move ownership, and trace grant-check → connection-open (currently unverified) | census 2 §5 |

A2 is the keystone: it discharges the loop-elision finding (host audits envelope,
not record), unblocks D31, and is Flue's core pattern applied at home.

### Track B — Workspace slims to composition + view

| # | action | grounding |
| --- | --- | --- |
| B1 | Extract the ~5k LOC plugin SDK to its own leaf package (shared/plugins + server/plugins + pluginImports + front plugin client) | census 1 |
| B2 | Split `workspaceBridge` (~4.5k): token issuance/auth-policy → where core's scope authority lives; session RPC/idempotency → agent transport | census 1; decision needed on the split line — flagged, not assumed |
| B3 | Move `front/bridge/*` (uiCommandBus etc., ~3.7k) to agent front — it is session transport | census 1 |
| B4 | Move bundled `filesystemPlugin`/`urlPanePlugin` (~14.4k) to top-level `plugins/` like every other first-party plugin | census 1 |
| B5 | Decompose `createWorkspaceAgentServer.ts` by its own line-range map: scope issuance out, provisioning/artifact-identity out, keep prompt+plugin composition and fleet assembly | census 1 breakdown |
| B6 | CI rule: workspace imports nothing that isn't composition/view/(new SDK); ratchet, not big-bang | — |

B4 first (pure move, huge LOC win, zero risk). B2 last (needs the split decision).

### Track C — Independent / remote agents (needs A2 + parts of B)

| # | action | grounding |
| --- | --- | --- |
| C1 | **Exec projection**: exec capability on `AgentHostEnvironmentLease` (today: no sandbox handle — `types.ts:303-311`), new `execRoutes` in boring-bash/server, reuse `RemoteWorkerExecRequestSchemaV1` as the HTTP contract | census 3 §B — three named pieces, schema exists |
| C2 | Shape exec as **code-mode** (one `exec({code})` batching many fs ops) — the chattiness answer; opencode/Flue-validated | scouts |
| C3 | **Claim-based scope over the wire** — WeakMap identity cannot cross processes (census 4); token exchange, issuer stays core; this is also where D27's `ModelCapabilityIssuer` finally lands | R-33-11 revised |
| C4 | Remote agent tier: agent process holds its record (A2) + MCP connections (A5), consumes Environment via C1, presents envelope events to host ledger | R-33-16 |

C4 is the senecaapp.ai answer: user-authored agents run out-of-process as
untrusted clients holding leased capabilities — no code loaded into the host,
which retires the RCE class rather than patching it.

### Track D — Decisions & invariants (cheap, high leverage)

| # | action | grounding |
| --- | --- | --- |
| D-1 | R-33-08: correct DECISIONS.md — D27 unimplemented (`ModelCapabilityIssuer` zero hits), D29's "re-checked on every use" not implemented as stated, brand semantics | verified |
| D-2 | Draft **D31** (authority/mechanism, composition-time selection) — now unblocked: A2 removes the record-elision precondition; include reviewer's mechanism-facts vs host-policy descriptor split as the worked example | R-33-15 + PR #1256 review |
| D-3 | Adopt "model-visible means logged" in coding-invariants.md + generate the event catalog from source (DeepSeek's checkable form) | R-33-10 |
| D-4 | Adopt "a seam ships Owner+Impl+Consumer" + the CI check (fires today on the two dead seams from P0.4) | R-33-09 |
| D-5 | New decision: host-supplied runtime-admission policy handed into the funnel (reviewer's design, replaces my rejected NODE_ENV inference) | PR #1256 review |

---

## 4. What NOT to do

- **No swappable loop for untrusted code, ever** — harness runs in-process; trust tier is the boundary (loop trace, Finding 2 caveat). Untrusted composition = Track C's out-of-process tier only.
- **No runtime-mutable registries, no authored executable selection** — D25–D29's actual content; D31 legalizes plurality, not mutability.
- **No canonical-record mega-schema** — refuted twice by its own spikes (R-33-05); per-agent stores + envelope, not one normalized DB.
- **No authority inferred from ambient env** in shared mechanisms (the NODE_ENV lesson).
- **No descriptor security metadata without end-to-end enforcement** — a declared-but-unenforced `env:` field is a false security claim (reviewer, accepted).
- **No integrating Flue/celld** — patterns yes, dependency no (memory: celld-flue eval; re-confirmed by dsh having the same tenancy hole).

## 5. Where we are genuinely ahead — protect these

Tenancy/scope discipline (absent in Flue, eve, AND dsh — paid-tier-only in
Mastra/LangGraph), plugin trust levels + hot reload with revisions, the
capability/admission model (D28), and now a frozen descriptor registry. Every
scout confirmed: **the field's OSS harnesses trade tenancy away for
pluggability. The plan above refuses that trade** — plural mechanisms, singular
authority.

## 6. Open items carried (not silently dropped)

- boring-mcp double-enforcement question (grants AND template allowedTools) — untraced.
- Grant-check → MCP-connection-open call-site link — unverified (census 2 §5).
- pi-transcript-vs-event-stream elision detectability spike — narrow, optional after A2.
- workspaceBridge split line (B2) — needs an owner decision.
- Register under-mining from earlier in W33 (~250 candidate findings) — separate cleanup.

---

## 7. Convergence — every W33 recommendation, one fate each

Added after review: the plan must account for all sixteen, not the nine it
happened to cite. Fates: **absorbed** (lives inside a track item), **superseded**
(a later finding replaced it — successor named), **refuted** (its own spike
killed it — kept as a guard), **scheduled** (real work the tracks missed; now
added).

| id | recommendation | fate | where |
| --- | --- | --- | --- |
| R-33-01 | Log as single owner of session state | **superseded → R-33-16** | restated as record/envelope (R2); implemented by **A2**. The spike (`spike-pi-storage`) remains the enabling proof. |
| R-33-02 | Durable journaled pause for human input | **scheduled → C5 (new)** | was missing from the plan. It is the input half of the accepted-work contract and the mechanism replacing the dead approval states (P0.1's "real approval flow" successor). SIGKILL-survival spike already proven. |
| R-33-03 | Opaque cursors · implicit sessions · authoritative `final` | **scheduled → A6 (new)** | was missing. Wire spike proved it lands in 12 files (+77/−106) with known front-end schema changes. Belongs in Track A: the standalone agent's wire should be clean before Track C freezes a remote contract on top of it. |
| R-33-04 | Import pi JSONL, abandon event rows | **absorbed** | A2's migration path, named there. |
| R-33-05 | Canonical record schema | **refuted ×2** | preserved as guard §4 ("no mega-schema"). |
| R-33-06 | Bounded tool catalog | **refuted in part; surviving part absorbed** | the dispatch design died by its own spike (#1226); the surviving idea — bounded catalog *presentation* over many tools/MCPs — is how **C2 code-mode** exposes capability without context flooding. Noted at C2. |
| R-33-07 | Accepted-work contract as #1009's spec | **scheduled → C6 (new)** | was missing. It is D29's deferred Level D, and it is what makes A2's per-agent record *trustworthy under crash* — "the durable input record is the precondition for invoking the loop." Sequenced after A2, with C5 as its input side. |
| R-33-08 | Correct DECISIONS.md security claims | **absorbed** | D-1, updated with the census-4 corrections (verifier exists; revocation + CLI minting are the real items). |
| R-33-09 | Seam ships Owner+Impl+Consumer | **absorbed** | D-4 + P0.4 wires/deletes today's two violations. |
| R-33-10 | Model-visible means logged | **absorbed** | D-3; becomes the *agent's* contract to its own record under R2. |
| R-33-11 | Runtime invariants over the brand | **absorbed, revised** | census 4 narrowed it: P0.2 (CLI bind guard), embeddedGateway epoch fix (D-1 scope), C3 (claim-based scope — WeakMaps don't serialize). |
| R-33-12 | Profiles/bundles/patch layers | **absorbed** | the composition story of D-2/D31 + Track C's external tier; still blocked on the RCE finding, which C4 retires by design. |
| R-33-13 | Scrub spawned env | **absorbed** | A4, at the reviewer-corrected scope (all census-3 sites, end-to-end, allowlist, explicit gh/git HOME intent). |
| R-33-14 | Composition-time provider selection | **absorbed / half-superseded** | sandbox half landed as PR #1256; session-persistence half is **superseded by A2** — once the record is per-agent and mandatory, there is no backend *choice* to compose, the flag simply dies. |
| R-33-15 | Authority vs mechanism | **absorbed** | R1 — it *is* the plan's first governing rule; D-2 ratifies it as D31. |
| R-33-16 | Independent agent units (record/envelope) | **absorbed** | R2 + A2/A5/C4 — the plan's spine. |

### New track items from this reconciliation

- **A6 — wire cleanup** (from R-33-03): opaque cursors, implicit session create, authoritative `final`; execute the proven 12-file change plus the front schema updates the spike identified. Before C freezes the remote contract.
- **C5 — durable pause** (from R-33-02): journaled human-input pause as the approval/input mechanism for remote and long-running agents; successor to the deleted front approval states.
- **C6 — accepted-work contract** (from R-33-07): Level D conformance as the spec for durable turns over the per-agent record; requires A2, consumes C5.

### The single convergent statement

Everything the cycle learned lands in one sentence: **an agent is an independent
unit that owns a complete record of everything its model ever saw (R-33-01/04/10/16),
accepts work only through durable, resumable envelopes (R-33-02/03/07 + ledger),
spends — never mints — capability (R-33-11/15 + D25–D29), and composes with other
agents only at deployment time through host-owned selection (R-33-09/12/13/14 + PR #1256).**
The refuted spikes (R-33-05, R-33-06's dispatch) mark the two over-reaches to
not repeat: don't centralize the record, don't intermediate dispatch.

---

## 8. R3 — State is recoverable from the log (added after spike revisit)

### The principle

**No snapshot is authoritative. Live state is a projection of the record;
recovery is replay.** This is the third governing rule, alongside R1
(authority/mechanism) and R2 (record/envelope). R2 says who owns the record;
R3 says what the record is *for*.

### Already proven three independent ways (this session's spikes, revisited)

| spike | what it proved | R3 reading |
| --- | --- | --- |
| `spike-pi-storage` | two Gemini turns in **separate PIDs** from one host-supplied JSONL; turn 2 recalled turn 1's secret | full conversational state reconstructed from log across process death |
| `spike-migration` | 4,229-line real transcript round-tripped | the record is sufficient — no side-tables needed to rebuild state |
| `spike-durable-pause` | SIGKILL mid-turn; resume from journal; 5 constraint-enforced invariants | in-flight (not just settled) state recovers by replay |

Corroboration: DeepSeek's invariant exists *for* this ("reconstructible from the
session log… durability, replay, UI fidelity across fork/resume"); Flue's
accepted-work contract is its write-side; Cloudflare Think's abort-record-replay
approval is it applied to permissions.

### Consequences for the plan

1. **A2 gains its acceptance test**: kill -9 the agent mid-turn, restart, replay
   record + envelope, diff projected state against pre-kill snapshot. The three
   spikes compose into this test today.
2. **`readStateBeforeDispose` is deleted by construction, not fixed.** The
   `seq: Math.max(persisted.seq, liveSeq)` reconciliation exists only because
   snapshots were allowed to be authoritative. Under R3 there is nothing to
   reconcile.
3. **Snapshots/caches are legal but must be labeled derived** — rebuildable,
   never merged from.
4. **C5/C6 are R3's write-side**: a pause is an event; accepted work is the
   record-before-invoke discipline.

### R3 repairs R-33-06's refutation (tool catalog / MCP design)

The spike's artifacts, now actually read (`spike-tool-catalog/artifacts/`):

| exposure strategy (40 tools) | single-shot request bytes | multiturn (8 tasks) |
| --- | --- | --- |
| all 40 resident | 10,344 | 16 requests, 10.4k→13.3k |
| summaries in system prompt + `call_tool` | **2,867** (−72%) | — |
| `search_tools` + `call_tool` only | 1,129 (−89%) | **24 requests** (+1 round-trip per task), payload grows 1.2k→10.3k |

So: search-catalog wins on cold bytes but costs an extra round-trip per task and
its advantage decays as the search/call transcript accumulates; summary-only is
the sweet spot on bytes — but both dispatch through `call_tool`, and the
refutation stands: **pi emits `toolName:"call_tool"`, provider-wire identity is
lost** (`test/identity.test.js`).

R3 dissolves the dilemma: identity does not need to live on the provider wire —
it needs to live **in the agent's record**. With C2's code-mode, invocation runs
as `exec({code})`; the record logs which underlying tools the code invoked
(R-33-10 obliges it: those results are model-visible). The provider wire carries
one generic tool; the durable record carries true identity; replay/audit/UI read
the record, not the wire.

**C2 is therefore amended**: code-mode + summary-level capability exposure
(≈2.9k bytes for 40 tools, no per-task round-trip penalty), with per-invocation
tool identity recorded in the agent's record as first-class events. This is the
opencode design (bounded catalog + host-resident dispatch + `execute({code})`)
made compatible with our durability rules — the part of #1226 worth keeping,
minus the part its own spike killed.

---

## 9. Self-review revisions (pre-adversarial pass, 2026-08-14)

Applied before external review; each names the defect it fixes.

**9.1 Migration & deployment compatibility was absent — plan-breaking omission.**
The plan restructures packages and moves the session store while: Constellation
is a live client tenant; packages publish on the 0.1.98 semver line; AGENTS.md
rule 9 pins session transcripts to the host durable volume (`/data/pi-sessions`).
A2 changes where user data lives → needs an explicit data-migration step with
rollback; A1/B1-B5 change published import paths → each move ships `git mv` +
one-release barrel re-exports (the 2026-08-11 "no backward compat" ruling was
for the wire, not for in-flight branches of a multi-agent factory repo).
**New: A2 gains "migrate /data/pi-sessions layout + rollback"; every B move is a
single-day PR with shims deleted next release.**

**9.2 R3 needs a bounded-recovery clause or it will not survive production.**
"Recovery is replay" is unbounded over long sessions. Amend R3: snapshots are
derived caches **with a replay budget** — checkpoint every N events; recovery =
nearest checkpoint + tail replay; the kill-9 test asserts a max recovery time,
not just equality. (dsh ships compaction with shadow pricing for exactly this.)

**9.3 Cross-agent session listing was dropped between conversation and plan.**
Per-agent stores (A2) break "list all sessions in a workspace" as a single-DB
query. Stated in discussion, absent from the tracks. **New A2b: workspace-level
session index derived from envelope events** — read model, rebuildable (R3),
never authoritative.

**9.4 The kill-9 acceptance test becomes permanent CI chaos, not a one-off.**
A2's test (§8.1) runs in CI on every agent-package PR: spawn, kill -9 mid-turn,
replay, diff, assert recovery-time budget. The three spikes compose into the
harness; keeping it green is what makes R3 a fact rather than a launch claim.

**9.5 Telemetry/observability track was missing — and R2 gives it for free.**
No plan item covers metering/tracing. The Flue OTel finding (adapters capture
content by default — reversed claim, security-relevant) shows the danger of
bolting it on. Principle: **host telemetry reads the envelope only; content
stays in the agent record.** Privacy boundary by architecture, and #819 metering
lands on the ledger it already needs. **New D-6: telemetry-from-envelope
invariant + a test asserting no record content crosses into telemetry sinks.**

**9.6 §5 "protect these" gets enforcement, not sentiment.**
Extend `gatewayConformance` with a suite asserting every gateway/environment
route rejects an unverified scope, and that a revoked-epoch scope (post
R-33-11 fix) terminates subscriptions. Tenancy stays ahead only if regression
is impossible, not discouraged.

**9.7 A3 becomes a product, not a mode: `npx @hachej/boring-agent`.**
dsh onboards with one command (`npx @deepseek-ai/dsh web`); our standalone bin
is E2E-labeled dev scaffolding. The earlier onboarding recommendation folds in
here: one command → built front, sane defaults, BYOK prompt on first run.
This is the wow-effect item and it is cheap once A3's literals are fixed.

**9.8 C6 acceptance = conformance Level D suite, not prose.**
D29 already defines Level B tests in `agent-host/testing/gatewayConformance.ts`.
The accepted-work contract ships as the Level D extension of that suite, so
"durable" is a runnable conformance claim exactly like Level B is today.

---

## 10. Adversarial pass 1 (Sol xhigh, 2026-08-14) — dispositions

Meta-finding first: **Sol's file:line citations are partly fabricated**
(`server/createHarness.ts`, `plugins/filesystem/`, `contracts/` — none exist;
real paths differ). Its findings are treated as *arguments*, each re-judged on
merits. Two of its factual attacks verified TRUE against origin/main and are
corrected below. Verified-wrong citations do not excuse the findings they
decorate — most survive without them.

### Corrections to this plan's own grounding (verified)

- **§2.1 "Sandbox registry landed (PR #1256)" is FALSE — the PR is OPEN.** All
  references to the registry as existing are re-labeled "lands with #1256".
  R-33-14's sandbox half is *in flight*, not done.
- **The audit ran on a stale checkout** (1ed49b7e2; origin/main at ee2017188).
  Before execution starts, re-verify §2's load-bearing claims against current
  main. The plan's file:line grounding is dated 2026-08-14 at 1ed49b7e2.
- "Zero value imports" (census 2) was scoped to `src/`; Sol notes a build script
  (`integrate-docker-runsc-runtime.mjs`-shaped) may value-import agent. Scripts
  are excluded from the leaf claim explicitly, and A1's CI rule covers `src/`
  only.
- Ledger key: census said `(agentTypeId, sessionId)`; the full key is
  `(workspaceScopeId, authSubjectId, operation, target, requestId)` —
  `requestLedger.ts:10-20`. Corrected; strengthens R2 (envelope is
  per-principal, not per-session).

### Accepted — plan-changing (10 findings)

| # | finding (re-judged) | plan change |
| --- | --- | --- |
| S1 | **R3 over-claims**: queued follow-ups, dynamic prompt contributions (`systemPromptDynamic`), and transient authorizations are model-visible but not in the record; kill-9 equality fails for them | R3 rescoped: "recoverable" = *everything model-visible*, which obliges **new record events** for queue admission, prompt-assembly inputs, and grant snapshots (this is R-33-10 applied honestly, not a retreat). A2 acceptance test enumerates the event kinds first. |
| S2 | **A2 conflates two stores**: event-stream offsets/idempotency/cursors vs pi transcript are different records; migration/rollback/dual-read unspecified. Most-likely-cost-blowup item. | A2 split: **A2a** per-agent *record* (transcript authority), **A2c** event-stream *retirement plan* (cursors/idempotency move to envelope or die with the wire change A6), each with dual-read rollout + rollback. A2 stops being "storage layout". |
| S3 | **R2 distributed commit**: host ledger in-flight + agent record append + crash = duplicate-or-lose. C5/C6 are prerequisites of C4, not follow-ups | Track C resequenced (below). Accepted-work (C6) is the commit protocol; it moves **before** C4. |
| S4 | **C4 makes the untrusted agent the ownership oracle** — session tenant/runtime pins live in the record the agent owns | New **C7: host-authoritative session catalog** (ownership/placement facts host-side, signed or ledger-derived) — precondition of C4. A2b upgraded from "index" to this catalog's read model. |
| S5 | **B4 is not a pure move** — bundled plugins import workspace-private registry/bridge/panel APIs | B resequenced: B1+B3 (SDK + bridge extraction, defining the public contracts) precede B4. "B4 first" withdrawn. |
| S6 | **Plugin-host role left unassigned** after B1 (scan/load/serve/lifecycle are host duties, not SDK duties) | New **B7: name the plugin-host runtime component** (in workspace-as-composer or its own process) with capability enforcement + failure isolation. B1 ships SDK *and* names its host. |
| S7 | **RCE not retired by C4 alone** — in-process external imports remain until removed | New **P0.6: default-deny external runtime plugins** behind an explicit allowlist flag now; full removal lands with B7/C4. The epic stays blocked on P0.6, not on C4. |
| S8 | **C1 before C3 is backwards** — exec projection needs verified claims/lease/authz first; also two exec protocols exist (V1 sandbox vs legacy worker route) and must be merged, not "reused" | C resequenced: **C3 → C1**; C1 gains "merge or explicitly deprecate the legacy worker exec route". |
| S9 | **Release/CI topology absent** — hard-coded package lists in version/publish/CI scripts; export moves are semver-breaking per D-14/15 while releases default to patch | New **A0/B0 gate: release-tooling + semver plan** (package-major sequencing, peer ranges) before any package move ships. §9.1 upgraded from shims-only. |
| S10 | **Ledger row-overwrite vs R2/R3 audit claims** — status transitions overwrite; retry provenance unrecoverable | Amend envelope contract: ledger transitions become append-only (or R2 stops claiming audit-sufficiency). Folded into C6. |

Also accepted: revocation epochs get their own scheduled item (was "absorbed" —
Sol is right that no track implemented it; now inside §9.6's conformance work
with connection-epoch invalidation named); dependency graph redrawn to include
A6/C5/C6/C7 (below); A3 costed honestly (no `bin` entry, not in tsup — §9.7 is
packaging work, not a rename).

### Rejected — with reasons (4)

| finding | why rejected |
| --- | --- |
| "R-33-11's D-1 premise stale — verifiers already recheck" | Partially conceded (verifiers exist — §10 census correction already said so) but the *scheduled* item is precisely the callback-path revocation Sol itself confirms unfixed. Nothing to change beyond wording. |
| "A2b duplicates existing sessionInventory" | Inventory enumerates *stores*; the catalog (C7) holds *ownership/placement authority*. Different object. A2b/C7 must, however, specify backfill from legacy JSONL — that clause added. |
| "R-33-14 not superseded: `sessions?: SessionStore` remains a published extension point" | The extension point remains as *mechanism*; A2a makes the record's *existence* mandatory, not its backend. Supersession claim narrowed to the env flag only. |
| "R1 omits disclosure authority (model choice routes data)" | Real, but not a rejection of R1 — an extension. Model/provider selection classified as **disclosure authority** under R1; noted in D-2 for D31's text. Grants being runtime-mutable is D28-sanctioned host policy data, not a mechanism violation. |

### Re-drawn dependency graph (v2)

```
P0.1-0.6 ──────────────────────────────────────────────┐
A0 release/semver gate ── A1 types ── A2a record ── A2c event-store retirement
                                        │  └─ A2b/C7 host catalog
                                        A6 wire cleanup
B0 = A0 ── B1 SDK + B7 plugin-host ── B3 bridge ── B4 plugin moves ── B5 ── B6
D-1..D-6 (docs/decisions; D-2 after A2a)
C3 scope-over-wire ── C5 durable pause ── C6 accepted-work+ledger-append-only
                                             └── C1 exec (merge legacy route) ── C2 code-mode ── C4 remote tier
```

Sol's cost-blowup call is accepted as the plan's stated top risk: **A2 family.**
It is sequenced first after the gates precisely so it fails early if it fails.

---

## 11. Recall pass (Sol xhigh transcript mining, 2026-08-14) — v3 amendments

29 forgotten learnings + 17 contradictions surfaced. Dispositions below;
transcript line refs are in `sol-recall.md`. Confidence vocabulary adopted
plan-wide: **executed / verified / reported / ratified / inferred** — §2's
"every claim verified" header is corrected to carry per-claim provenance.

### Structural amendments (accepted)

**11.1 The durability shard is the SESSION, not the agent** (recall #5, contradiction #8).
Target architecture amended: the agent *logically owns* a set of physically
per-session records (Flue's actual topology). A per-agent WAL would recreate
cross-session contention/failure coupling — the same defect the host-wide DB has
one level down. A2a re-scoped; agent/session index is derived (C7 read model).

**11.2 R3 rescoped a second time** (recall #3, #4; contradictions #3, #4).
The durable-pause spike proved *the pause row survives*; production resumption
needs durable runner re-entry (L1a) — that is C6 work, not a done fact. And
kill-9 equality is only valid at **safe checkpoints**; unresolved ordinary side
effects recover as explicit **`unknown-outcome`**, never silent retry
(accepted-work semantics: durably admitted before invocation; at-least-once
execution, exactly-once terminal recording; recorded results never rerun).
A2/C6 adopt Flue's fiber vocabulary: fiber / settlement / incarnation records.

**11.3 C3 was conflating two authority planes** (recall #19; contradiction #6).
Transport identity (who may reach a session) ≠ **D27 model-credential/payer
authority** (whose key pays for an invocation). **F-33-G15 is VERIFIED, not
reported**: cached `AuthStorage`/`ModelRegistry`/`AgentSession` + ambient host pi
auth = a live path that never consults workspace BYOK. New item **A7 (P0-adjacent):
invocation-scoped ModelCapabilityIssuer** — D27's actual implementation;
A3's BYOK onboarding depends on it; C3 keeps only transport identity.

**11.4 C2's "R3 repairs the refutation" was half-wrong** (contradiction #5).
Recording child-tool identity repairs *audit*, not *authorization* — approval
and metering must happen **before** a child call, and the spike's surviving
requirements were first-class child events + immutable post-validation plans +
invocation-scoped authorization. C2 re-scoped to that triple; post-hoc identity
logging alone is insufficient and the catalog-dispatch refutation stands.

**11.5 P0.4 was aimed at dead code** (recall #10; contradiction #12).
`mergeTools` is not on the runtime path — production concatenates directly, and
current safety (standard tools first) is *accidental*. P0.4 v3: (1) pin current
precedence with a test, (2) route the shipped path through collision validation,
(3) then adopt **eve's ratified mount-namespace vocabulary — disable / alias /
trusted-host wrap / replace-with-admitted-reference, compiled into an immutable
binding** — as the real R-33-12 deliverable (recall #9; contradiction #14:
R-33-12 was NOT absorbed; it now has a concrete work item).

**11.6 The ratified third-party plugin product restored** (recall #25; contradiction #10).
Owner-accepted shape at L2924: **untrusted-by-default, iframe UI, sandbox-proxy
tools, server disabled, prompted grants, explicit promotion**. §4's blanket "no
authored executable selection, ever" is amended: it holds for the *trusted* tier;
the untrusted tier admits authored capability via isolation + promotion, as an
explicit D26 amendment. C4 expands to UI isolation, provenance, artifact
admission, grants, immutable promotion, lifecycle.

**11.7 The ratified UI/runtime addendum restored** (recall #26, #8).
Missing owner-ratified items, now scheduled: durable named in-place UI data;
provisional replace-in-place results; immutable attachments; **structured,
tool-independent, channel-answerable human input keyed by request ID** (C5's
real spec — auth/OAuth prompts are first-class waits, not errors); per-session
token ceilings; `agent info --json` (→ A3). Cloudflare Think's
abort–record–replay gets its own C2×C5×C6 spike (recall #7).

**11.8 Security register reconciliation becomes a gate** (recall #1, #19-24, #22).
- **F-33-G16 substantially verified**: 23 convention-only / 15 code-enforced /
  2 structural controls; the "governance differentiator" claim was withdrawn in
  session and §5 is softened accordingly (also contradiction #9: the
  "paid-tier-only Mastra/LangGraph" line was withdrawn — removed).
  Verifier/revocation *implementation* items precede D-1's docs correction; the
  revocation fix is now a scheduled item (contradiction #15), with mutation
  tests required to prove controls structural (recall #18).
- **F-33-G17 stays reported** — provisioning atomicity (destructive reprovision,
  no canonical-root locking, non-atomic publish/rollback) needs call-path
  verification before scheduling; C4 does not absorb it.
- The fifth reported security defect is **unrecoverable from the register** —
  the register re-extraction (~250 candidates) becomes a **blocking pre-phase**
  with provenance/status transitions, and the six spikes get an
  evidence-preservation gate (pin, commit/archive, record commands) (recall #2).
- Credential vault P0.4 outcome widened: **wire-into-D27/A7 or replace
  explicitly** — not delete-only (recall #24); A4 gains tool-output secret
  redaction + storage binding/AAD.

### Smaller accepted items

- **Stable-prefix rule** → A6/C4 conformance tests (state→delta: emit only the prefix before the last unsettled message) (recall #13).
- **Hub connection starvation** → C4/C5 transport item: multiplex (WS/h2), durable subscription reconstruction, backpressure (recall #14).
- **pi 0.80.7 constraints stated as plan constraints**: no MCP client (A5 keeps the client agent-side), no stable durable seq (A6/D-3 own canonical seq); upgrade conformance gate (recall #16).
- **Compatibility manifests** for config/persisted-state versions: reject-or-migrate, session pinning, drain/reseed (Flue rejects incompatible schema; Managed Agents drains by config revision) (recall #17).
- **Frozen prompt + append-only capability signals** and **host-bound, session-snapshotted provided arguments** → A2/D-3 event vocabulary + A5/C3 projection (recall #11, #12).
- **VFS-first, container-on-demand** — ratified; recorded as deferred C2/environment optimization after A4, with reason (recall #27).
- **Channels** are a C6-gated downstream item with boring-owned identity/idempotence/retry contracts — not folded into C4 (recall #6).
- **First-run DX contract**: scaffold page/panel consistency test; D27-backed credential prompt; CLI secret args and foreign auth-file writes stay forbidden (recall #28).
- **Residual field-wide risks stay open**: prompt injection, tool-result exfiltration, confused deputy, result authorization — no framework solved them; marked reported with spike gates, never "absorbed" (recall #29).
- **A4 claim downgraded** to "all traced sites" (runsc quota helper, docker runner, resolveMode unverified); **A5 grant→connection-open wiring downgraded** to unresolved (Deliverable-2 downgrades).
- **Tracks become an item-level DAG** — "independently shippable" withdrawn (contradiction #17); §10's graph is the canonical ordering.

### Rejected (1)

- Contradiction #7 (R1 vs A2 backend choice): already narrowed in §10 dispositions — the record's *existence* is mandatory; its backend remains a trusted composition-time seam. No further change.

### What survived both passes unchallenged

Zero runtime reverse imports; `agent/shared` leaf cleanliness; standalone-dev
limitations; exec projection's three missing pieces; dead approval UI states;
pi JSONL migration; separate-process conversational continuation (which does
NOT prove mid-turn recovery — R3's honest boundary).
