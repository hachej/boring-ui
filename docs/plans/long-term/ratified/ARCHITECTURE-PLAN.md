# Boring Agent Framework — Architecture Plan (v3, canonical)

> **RATIFIED & FROZEN 2026-08-16** with owner rulings in
> [`RECONCILIATION.md`](RECONCILIATION.md) §6 (ladder standalone shapes; Track B
> = ratchet; RunId := RequestKey; B2 semantic-ownership split; seatId in P0,
> AgentRef opportunistic; Seat-grants-participation invariant). Where this file
> and §6 differ, §6 wins. Next input: implementation, not abstraction.

2026-08-14/15. Produced by the W33 research cycle (5 framework scouts, 6 executable
spikes, 4 code censuses, PR #1256 review) and hardened by two adversarial passes +
one transcript-recall pass (Sol xhigh); dispositions in
`ARCHITECTURE-PLAN-v2-history.md`, `sol-adversarial.md`, `sol-recall.md`, `sol-pass2.md`.

**Provenance vocabulary** (every load-bearing claim carries one):
**executed** (spike-demonstrated) · **verified** (traced in source at
main@1ed49b7e2, 2026-08-14 — re-verify against current main before execution;
origin has moved) · **reported** (worker-emitted, unreproduced) · **ratified**
(owner-directed in session) · **inferred**.

---

## 1. Target architecture

| package | is | is NOT |
| --- | --- | --- |
| **agent** | The standalone agent framework: loop + tools + gateway + chat surface + logically-owned session records (physical shard = **per session**). Complete alone. | a workspace client; a tenancy system |
| **workspace** | Multi-agent **composition + workspace view** — and, decided here, the **trusted plugin-host process** (hosting first-party plugins is composition; see B7) | a plugin SDK; a session-auth/token issuer |
| **core** | Identity/membership; mints transport scope; will own the model-credential issuer's trust root (A7/D27) | an agent runtime |
| **boring-bash / boring-sandbox** | Leaf mechanism packages (verified: zero runtime value imports of agent from `src/`; build scripts exempt) | — |
| **NEW leaves** | `agent-types` (A1), `plugin-sdk` (B1) | — |

### Governing rules

**R1 — Authority vs mechanism** (ratified reasoning, survived three passes).
*Can this unit increase what the agent is permitted to do — including what data
it may disclose?* Yes → authority: single, host-owned, handed into the funnel,
never inferred from ambient env, never authored, never runtime-mutable.
No → mechanism: freely pluggable at composition time by the host.
Classifications: tool registration = authority; sandbox-provider *selection* =
authority-adjacent (host-only); **model/provider selection = disclosure
authority**; loop, storage backends, model adapters = mechanism.
Scope note: "never authored" holds for the **trusted tier**. The ratified
third-party tier (§6) admits authored capability only via isolation + explicit
promotion — a deliberate D26 amendment, not an exception smuggled in.

**R2 — Record vs envelope** (verified + ratified).
The agent logically owns its conversation records (physical unit: one record
per session — a per-agent WAL would recreate cross-session contention one level
down). The host owns the interaction **envelope**: the request ledger, keyed
`(workspaceScopeId, authSubjectId, operation, target, requestId)`
(`requestLedger.ts:10-20`, verified). Tenancy, metering and telemetry read the
envelope, never the record. Envelope transitions become **append-only** (today
they overwrite — `sqliteRequestLedger.ts`, verified) or R2 stops claiming
audit-sufficiency.

**R3 — State is recoverable from the record, at safe checkpoints** (executed,
with proven boundaries). Three spikes ground it: separate-PID conversational
continuation (`spike-pi-storage`), full-transcript round-trip
(`spike-migration`), pause-row SIGKILL survival (`spike-durable-pause`).
Boundaries, stated plainly:
- Recovery equality holds **at safe checkpoints**; unresolved ordinary side
  effects recover as explicit **`unknown-outcome`**, never silent retry.
- Mid-turn *execution* resumption (durable runner re-entry) is C6 **work**, not
  a proven fact — the pause spike proved persistence, not resumption.
- "Model-visible means logged" therefore obliges **new record event kinds**:
  queue admission, prompt-assembly inputs (frozen initial prompt + append-only
  capability signals), grant/config snapshots, provided-argument bindings,
  fiber/settlement/incarnation records (Flue vocabulary).
- Snapshots are derived caches with a **replay budget** (checkpoint every N
  events; recovery = nearest checkpoint + tail).
- `readStateBeforeDispose`'s `Math.max(persisted.seq, liveSeq)` reconciliation
  is deleted by construction once the record is sole authority.

---

## 2. Ground truth (both good and bad; provenance labeled)

**Already true — do not rebuild:**
- Agent is a runtime leaf; `agent/shared` is extraction-clean (92 files, no
  server/core/node imports). *(verified)*
- Standalone dev server runs gateway + environment routes + chat front with no
  workspace/core — but is E2E-grade: Vite in-process, wildcard CORS, constant
  session/host IDs, no `bin` entry, not in tsup. *(verified)*
- Four `AgentScopeVerifier` implementations, one per host, WeakMap-identity
  based, always wired (required option). Sound in-process; cannot cross a
  process boundary; no revocation of issued scopes. *(verified)*
- MCP grants (policy) and transport (mechanism) are separate modules; the
  grant-check → connection-open wiring is **unresolved**. *(verified / reported)*
- Exec wire vocabulary exists and is production-proven
  (`RemoteWorkerExecRequestSchemaV1/ResponseSchemaV1` + error codes) — but a
  **second, incompatible legacy worker exec route also exists**; C1 is a
  protocol merge, not reuse. *(verified)*
- Sandbox descriptor registry **lands with PR #1256 (OPEN, not merged)**.
  *(verified)*

**Misplaced (workspace census; 459 files / 93k LOC; ~30% out of role):**
generic plugin SDK ~5k LOC; session auth/RPC plumbing (`workspaceBridge`)
~4.5k; agent↔UI command transport ~3.7k; bundled first-party plugins ~14.4k
(coupled to workspace-private APIs — **not** a pure move); `runtimeBackendRegistry`;
`createWorkspaceAgentServer.ts` is ~45% fleet assembly by line range. *(verified)*

**Security posture:**
- **FATAL, live:** external plugin code imported unsandboxed into the host with
  route registration; agent-writable `.pi/extensions` metadata can trigger
  import before ownership validation. *(verified; mitigation P0.6)*
- **F-33-G15 VERIFIED (upgraded from reported):** cached
  `AuthStorage`/`ModelRegistry`/`AgentSession` + ambient host pi auth = live
  model-invocation path that never consults workspace BYOK. D27 is not merely
  unimplemented; it is actively bypassed. → A7.
- **F-33-G16 substantially verified:** control audit = 23 convention-only,
  15 code-enforced, 2 structural. The "durable governance differentiator" claim
  is withdrawn; our honest position is *capability-model architecture ahead,
  enforcement depth behind*. Mutation tests required to call any control
  structural.
- **F-33-G17 reported, unscheduled until call-path verification:** provisioning
  atomicity (destructive reprovision, no canonical-root locking, non-atomic
  publish/rollback, generation drain).
- Register reconciliation: ~250 candidate findings unextracted (~5× under-mined);
  one of five reported security defects unrecoverable from the register.
  → blocking pre-phase (P-1).
- Env inheritance: **all traced sites** (~15) pass full `process.env`; zero
  filtering found; runsc quota helper / docker runner / `resolveMode` untraced.
  `getEnvSnapshot` duplicated across two packages. HOME preservation on
  direct/host is intentional (gh/git). *(verified at traced sites)*
- Scope revocation: verify-once-into-closure on subscribe paths; no epoch, no
  stream invalidation. **Scheduled implementation** (A8), not just docs.
- Front approval states: dead code (absent from wire type, no producers, no pi
  mechanism at 0.80.7). *(verified)*
- pi 0.80.7 constraints, stated as plan constraints: **no MCP client** (A5 keeps
  the client agent-side), **no stable durable seq** (A6/D-3 own canonical seq);
  upgrades pass a conformance gate. *(verified)*

**Field position (corrected):** Flue, eve, dsh all lack tenancy; Mastra/LangGraph
ship authorization in paid/platform tiers **and** LangGraph custom auth is
available across LangSmith plans — the earlier "paid-tier-only" line is
withdrawn. No surveyed framework closes prompt injection, tool-result
exfiltration, confused deputy, or result authorization; those stay open as
reported risks with spike gates — never marked absorbed.

---

## 3. The item-level DAG (canonical ordering)

```
P-1 register re-extraction + evidence preservation
   ║  (BARRIER: no track item starts before P-1 completes)
   ╚═► P0.1-0.6 hygiene        A0/B0 release & semver gate
            │                       │
            ├── A1 types ───────────┤
            │        │              │
   A7 model-credential issuer ──────┼──────────────► A3 npx product
   A8 scope revocation epochs ──────┤                     ▲
            │                       │                     │
   A2a per-session records ── A2b/C7 host session catalog │
            │                            │                │
   A6 wire cleanup ── A2c-complete       │                │
            │   (A2c-migrate may start after A2a;         │
            │    A2c completion requires A6 — see D-d)    │
   A4 env policy (all sites)    A5 MCP client agent-side  │
            │                            │                │
   A1 ──► B1 SDK (+B7 decision, made: D-b) ── B3 bridge ── B4 moves ── B5 ── B6 ratchet
            │            B2 workspaceBridge split (after B1+B3; owner sign-off) ─┘
            │                            │
   C3 transport scope ───────────────────┤
   C5 durable pause ── C6 accepted-work ── C1 exec merge ── C2 code-mode ── C4 remote tier
                                                                 ▲    ▲    ▲
                                              C7 ────────────────┘    │    │
                                              A7 (model creds remote) ┘    │
                                              B7/P0.6 (plugin-tier final removal) ┘
D-1..D-6: D-2 (D31) after A2a; D-1 after A8 + G16 matrix
```

Tracks are **not** independently shippable; this DAG is the ordering authority.

---

## 4. Decisions made in this plan (were open; now closed)

**D-a C7 ownership — host-owned, envelope-derived, host-signed for remote.**
The session catalog (ownership, tenant, runtime pin, placement) is **host
authority**, populated from append-only envelope events at accepted-work
admission. The agent's record carries a *copy* for self-description; the host
never trusts it. Single-host: ledger-derived catalog suffices. C4/remote: the
host issues **signed session-ownership attestations**; an agent cannot rewrite
who owns a session because ownership never lived in its record. (Discharges
pass-1 #4.)

**D-b B7 ownership — the workspace app process hosts trusted plugins.**
Scanning/loading/serving first-party plugins **is composition** and stays in the
workspace application, importing the extracted SDK for contracts. What leaves
workspace is the *generic machinery* (SDK) and the *untrusted tier* (C4:
iframe UI, sandbox-proxy tools, server disabled, prompted grants, explicit
promotion — ratified). There is no third "plugin-host service" to invent.
(Discharges pass-1 #6.)

**D-c C6 commit protocol (cross-host exactly-once terminal recording).**
- **Admission:** host appends `admitted(requestKey)` to the envelope *before*
  dispatch (requestKey = the five-part ledger key). Duplicate requestId with a
  different digest → reject (exists today).
- **Execution:** at-least-once. Agent-side appends are idempotent by requestKey.
- **Terminal:** exactly-once via envelope compare-and-set
  `in-flight → settled(outcome-digest)`; a second settle attempt is a no-op if
  digests match, a conflict alarm if not.
- **Recovery reconciliation:** on restart, for each `in-flight` past its lease:
  query the agent record for a terminal event bearing that requestKey — found →
  settle from it; not found → mark **`unknown-outcome`** (never auto-retry
  ordinary side effects; retry only operations declared idempotent at
  registration).
- **Lost ACK:** covered by idempotent settle.
(Discharges pass-1 #3. C6 conformance = the Level D extension of
`gatewayConformance`, plus kill/reconnect tests with the stable-prefix rule.)

**D-d A2c cutover (event-store retirement) — two stages.**
*A2c-migrate* (after A2a): per-session version marker; new sessions
record-authoritative from day one; existing sessions dual-read (record
authoritative, event store fallback); migration tool imports streams (executed:
4,229-line round-trip). **During the dual-read release the host also
dual-writes** — every record append is mirrored to the old event stream — so
rollback (flip the marker) loses nothing: post-cutover writes exist in both
stores. Quiescence = no live subscribers on the old store → stop mirroring for
that session, mark migrated.
*A2c-complete* (requires A6): cursors/idempotency keys are envelope/wire
concerns and move with A6's opaque-cursor change; only then is the old store
deleted. Mirroring ends per-session at quiescence, globally at A2c-complete.
(Discharges pass-1 #2 including rollback safety.)

**D-e C4 deployment topology — named as C4 acceptance criteria** (not deferred
prose): per-agent durable storage allocated **beneath `BORING_AGENT_SESSION_ROOT`
(customarily `/data/pi-sessions`, itself sibling to `/data/workspaces`)** per
AGENTS.md rule 9; session-affinity
routing via the C7 catalog's placement facts; restart/discovery through the
envelope; backup/restore owned by the deploying app (full-app README already
claims this); staged coexistence = in-process tier remains the default while
remote is opt-in per agent type; GC of removed agent types via catalog drain.
Tenant-repo (Seneca/Constellation) rollout gets its own checklist item.
(Discharges pass-1 #8.)

**D-f A3 production acceptance criteria:** `npx @hachej/boring-agent` on a clean
machine with no repo checkout; built static front (no Vite); declared `bin` +
tsup entry; auth = local token or A7-backed BYOK prompt (no `--api-key` args, no
foreign auth-file writes — ratified); configurable storage root honoring the
session-compat manifest on upgrade; a distribution smoke test in CI.
(Discharges pass-1 #11.)

---

## 5. Work items (delta view; each cites its grounding)

**P-1 (blocking pre-phase):** re-extract ~250 register candidates with
provenance/status transitions; reconcile the five-defect security queue (the
fifth is unrecoverable — find or formally void it); pin + archive the six spikes
(commands, expected outputs, versions).

**P0:** .1 delete dead approval states (successor = C5) · .2 CLI hub loopback
guard · .3 converge duplicated `getEnvSnapshot` · .4 **collision handling on the
runtime path**: pin current precedence with a test (safety today is accidental:
standard-tools-first), route `buildAgentComposition`'s concatenation through
validation, then adopt eve's ratified namespace vocabulary — disable / alias /
trusted-host wrap / replace-with-admitted-reference, compiled immutable
(this, not `collisionPolicy` on dead `mergeTools`) · .5 PR #1256 invariant text +
TODO(#1220) · .6 **RCE mitigation now**: default-deny external runtime plugins;
refuse `boring.server` from agent-writable roots; allowlist flag for the
transition; migration note for existing external plugins.

**Track A:** A0 release/semver gate → A1 types → **A7 invocation-scoped
ModelCapabilityIssuer** (D27; kills the verified BYOK bypass; vault decision:
wire it in or replace explicitly — not delete-only) → **A8 revocation epochs**
(connection epoch, stream invalidation, disconnect-on-revoke + mutation tests) →
A2a per-session records (+ new R3 event kinds; kill-9-at-checkpoint CI chaos
test with recovery-time budget) → A2b/C7 catalog → A2c-migrate (D-d) → A6 wire
cleanup (opaque cursors, implicit sessions, authoritative final, stable-prefix
conformance) → A2c-complete → A4 env allowlist at **all** sites incl. the three untraced (+
tool-output secret redaction, storage AAD) → A5 MCP client agent-side (grants
host-issued; resolve the grant→open trace first) → A3 npx product (D-f).

**Track B:** B0=A0 → B1 SDK extraction (contracts out of workspace-private
surface; workspace hosts trusted plugins per D-b) → B3 bridge/uiCommand
transport to agent front → B4 bundled plugins move (now that contracts exist) →
B5 decompose `createWorkspaceAgentServer` by its line-range map → B6 CI ratchet.
`workspaceBridge` split (B2): token issuance → core; session RPC → agent; needs
owner sign-off on the split line.

**Track C:** C3 claim-based transport scope (WeakMaps don't serialize) → C5
durable pause (ratified spec: tool-independent, channel-answerable, request-ID
keyed, denial/expiry, one-shot approval capabilities; ask-user plugin absorbed
with migration of its store/API/UI) → C6 accepted-work + commit protocol (D-c) +
abort–record–replay spike (Think pattern) → C1 exec projection (lease exec
capability; merge or deprecate legacy worker route; reuse V1 schema) → C2
code-mode with **pre-call authorization**: first-class child events, immutable
post-validation plans, invocation-scoped authz; summary-level exposure (~2.9k
bytes for 40 tools, executed) — post-hoc identity logging alone is refuted →
C4 remote/untrusted tier (D-e topology; retires the RCE *class*; P0.6 already
stopped the bleeding) + hub transport item (multiplex WS/h2, durable
subscription reconstruction, backpressure). Channels: separate C6-gated item
with boring-owned identity/idempotence/retry. VFS-first container-on-demand:
ratified, deferred until after A4, revisit with C2.

**Track D:** D-1 DECISIONS.md corrections *after* A8 + the G16 authority-path
matrix (docs follow implementation, not before) · D-2 draft D31
(authority/mechanism + composition-time selection + disclosure-authority
classification + descriptor mechanism-facts/host-policy split) after A2a ·
D-3 "model-visible means logged" + generated event catalog + canonical seq
ownership · D-4 seam completeness CI · D-5 host-supplied runtime-admission
policy (reviewer design) · D-6 telemetry-reads-envelope-only + no-record-content
test · compatibility manifests (reject-or-migrate, session pinning,
drain/reseed) ride with A2a/A6.

---

## 6. What NOT to do (each with its receipt)

- No swappable loop for untrusted code in-process (loop trace: in-process
  harness = full host authority; untrusted composition is C4's tier only).
- No runtime-mutable registries or authored executable selection **in the
  trusted tier**; the untrusted tier admits authored capability only through
  isolation + prompted grants + explicit promotion (ratified D26 amendment).
- No canonical-record mega-schema (refuted twice, mutation-tested).
- No catalog dispatch that intermediates identity without pre-call authorization
  (refuted by its own spike; C2's triple is the surviving form).
- No authority inferred from ambient env (`NODE_ENV` lesson, PR #1256 review).
- No declared-but-unenforced security metadata (env field without all-site
  enforcement = false claim).
- No per-agent physical WAL (recreates the contention it fixes).
- No integrating Flue/celld (patterns yes, dependency no; celld: empty
  `process.env`, 435 ms cold start vs 4 ms advertised — executed; feasibility
  gates recorded for any future revisit).
- Docs corrections never precede the implementations they describe (G16 lesson:
  we documented guarantees that never ran — that is how this cycle started).

## 7. Open items (owned, not dropped)

Owner decision: B2 split line. Verification queue: G17 call paths; grant→open
MCP trace; three untraced spawn sites; the unrecoverable fifth security defect.
Spike: pi-transcript-vs-event-stream elision detectability (optional after A2a);
abort–record–replay (C6). External: tenant-repo rollout checklists.

## 8. The convergent statement

An agent is an independent unit that **owns a complete, per-session record of
everything its model ever saw**; that **accepts work only through durable,
admission-first envelopes with exactly-once terminal recording and honest
`unknown-outcome`s**; that **spends — never mints — capability, including the
capability to disclose**; and that **composes with other agents and plugins only
through host-owned selection: composition-time for the trusted tier, isolated
and explicitly promoted for the untrusted tier**. The refuted spikes mark the
boundaries: don't centralize the record, don't intermediate dispatch without
pre-call authority. What survived three adversarial passes unchallenged: the
leaf structure, the exec gap, the dead approval states, and the storage seam —
the foundations are real; the work is finishing what the seams promised.
