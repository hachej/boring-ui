# DIRECTION — the one spine

Owner-ratified 2026-07-27. This document is the single source of sequencing
truth for the platform. Every plan folder under `docs/issues/**` is DETAIL,
subordinate to this file: if an issue plan and this file disagree on what
happens next, this file wins until the owner amends it. Orchestrators dispatch
from the waves below — nothing else — regardless of what `br ready` surfaces.

## Vision (unchanged since #391)

A workspace where multiple agents — different models, different capabilities,
different costs — work for you in one console: a default deep-work agent
beside cheaper specialists, extensible toward authored agents (agents as
data), external capabilities via MCP, per-workspace keys, and eventually
third-party agents and a marketplace. The long-form vision persona is a
Chief-of-Staff agent managing issues, mail, and the boring-ui Inbox — that is
where this goes, not what we build next.

How-decisions along the way: Decision 26 (domain-routed workspaces) was
abandoned; Decision 28 (#889: application agent fleets, Workspace
orchestration, transport-neutral Environment service) is current. #909
delivered Decision 28's first construction segment.

## Built and released (do not re-plan this)

v0.1.91: the **AgentGateway v0** engine room — `createAgentHost()` single
construction funnel, `AgentFleetCompiler` fail-fast validation,
`EmbeddedAgentGateway` (frozen 7-method session contract, addressed HTTP
surface per agent), Environment leases, per-agent model policy
(`spec.model.preferred` + strict resolution), all five consumers (workspace,
core, CLI, playground, delegation) composing through it, enforced by CI
invariants. Also shipped: A1 authored-agent groundwork, boring-bash/sandbox
extraction, BYOK credential-injection contract, D1 tenant provisioning.
Authority for what exists: `packages/agent/docs/AGENT_GATEWAY_V0.md` (the
binding contract, colocated with its types, per D29). The gateway plan's §6
(`docs/plans/agent-runtime/gateway/plan.md`) is historical — its own header
says it drifted and defers to the package contract.

## Wave 1 — NOW: the multi-agent console (beads .27 → .31)

Goal: **two agents, visibly, in one UI** — `default` plus a dummy second
agent on a cheaper model. Infra only; no persona content.

1. `wt-391-forward-0jpy.27` (in progress): browser wired to the addressed
   gateway routes — addressed reload-reconnect streams, dynamic agent
   selection from `GET /api/v1/agents`, full-app opt-in, two-agent fixture,
   E2E with a request-route assertion that fails on any legacy-wire use.
2. `wt-391-forward-0jpy.31`: the console UX — agent switcher, per-agent
   session grouping, presence, two agents streaming concurrently, switching
   without losing an in-flight turn.

**Done-bar: works in BOTH workspace-playground and full-app** (playground
green ≠ product works — the 0.1.91-era lesson). Supporting hygiene that lands
inside this wave as needed: `.29` (CSS build), `.26` (E2E in CI — minimal
slice absorbed by .27), `.28` (re-land native sessions + rename menu, after
.27), `.32` (full-app dev onboarding), `.33` (release smoke gate).

## Wave 2 — trigger: Wave 1 demo works

- **Chat streaming durability** (`0jpy.8` + `26v`, ONE lane; issue #1009):
  activate the dormant SqliteEventStreamStore. Trigger is explicit: `.31`'s
  concurrent streams + Seneca production chat. This is where Seneca hardening
  lives. Verified 2026-07-31: this is **wiring plus a read path**, not a build
  — the store and its consumer are both written, and no production caller
  passes `eventStore`. Resolve the agent-keying question (§Lane reality)
  BEFORE any durable schema is written.
- **F-graph execution begins** (Decision 28 detail: `docs/plans/agent-runtime/fleet-and-environments/plan.md`):
  F0b inventory → F1/F2 Environment contracts + boring-bash service → onward.
  F0a paperwork (the rebased #904 with its three shipped-reality amendments)
  is ratified during Wave 1; F1+ execution does NOT start before the Wave 1
  demo exists.

## Wave 3 — trigger: named consumers, not calendar

**BYOK and External MCP share one prerequisite** — a per-workspace credential
and registration substrate (§Lane reality). Whichever fires first builds it;
it is a named deliverable of this wave, not an implementation detail of
either lane. Sequence them adjacently.

- **BYOK** (KEY0 + parked PR #917; issue #1010): becomes load-bearing when
  multi-agent model costs are real. First step is ratifying the de-facto
  policy the shipped code implements. The `.30` model-cap revisit is
  MANDATORY here — it has no bead and nothing else forces it.
- **External MCP** (#900, re-land per #946: small reviewed slices,
  application-owned atomic backend; issue #1011): waits for its consumer —
  mail/tools for the CoS persona, or a client need. Do not re-land #937
  wholesale.
- **Authored catalog** (`0jpy.9`, includes fleet-time model-ID validation and
  maxTokensPerTurn enforcement): when personas become data.

## Wave 4 — v2 era

- **Sandbox/SBX1** (own-cloud runsc fleet; parked PR #916; issue #1012):
  infrastructure for remote/third-party agents. Trigger restated: after F7
  conformance. NOTE: two sandbox facts are true TODAY and are not Wave-4
  problems — see §Lane reality. Decide whether they wait for this wave.
- **#905 v2 remote Host** (`0jpy.11`/`.16`): behind three gates — plugin
  trust cleanup (`.13`), the model-cap revisit (below), and an owner-recorded
  additive-v2 amendment.
- Marketplace-tier lanes (identity, billing, channels, catalog UX) stay
  frozen behind their existing owner gates.

## Decision log (owner, 2026-07-27)

| Decision | Ruling |
|---|---|
| Direction | Multi-agent console is the product thrust; Seneca is its first consumer, not a separate track |
| Demo fleet | `default` + dummy second agent (different model). CoS/personas = vision, not a current lane |
| Done-bar | Playground AND full-app |
| Model-policy cap (`.30`) | (a) caller's per-prompt model wins. MANDATORY revisit before the v2 remote tracer or BYOK, whichever first |
| F-graph | F0a paperwork now; F1+ execution frozen until the Wave 1 demo |
| Streaming | Enters exactly when multi-agent needs it (Wave 2 trigger), merged into one lane |

## Standing execution rules (earned this release cycle)

- Green CI is necessary, never sufficient: every wave's exit includes a real
  smoke of built artifacts (`.33` makes this a release gate).
- Tests must fail when the behavior is broken — no assertions on thrown
  objects where the client sees a different status; no fixtures that pass on
  empty output.
- One heavy executor at a time; independent review before merge; verify
  agent claims against `gh`/git ground truth, never against reports.

## Lane reality (verified against `origin/main`, 2026-07-31)

Read this before dispatching any Wave 2–4 work. It is what the CODE does, not
what the plan folders say; where they disagree, this wins. Full evidence with
file paths lives in the lane issues (#1009 streaming, #1010 BYOK, #1011 MCP,
#1012 sandbox), each with a draft seed PR.

**The pattern: every lane is further built than its plan claims, and three of
four stop at the same missing layer — any way for a user to supply something**
(a key, a server URL, a trust decision). Infrastructure without an on-ramp.

| Lane | Today | The real delta |
|---|---|---|
| Streaming | In-memory ring buffer, NDJSON, correct reconnect. Level B holds — never a silent gap | Wiring + a durable read path. Store and consumer both written; nothing feeds them |
| BYOK | Encrypted `workspace_settings`; model keys come from process env **via Pi**, not from Boring | UI, store backend, authority verifier, and an **injection seam in the harness** — the hard one |
| MCP | Genuinely works: real SDK client, 7 tools live in the toolset, read-only by construction | Only 2 hardcoded providers. No user-supplied URL, no stdio/SSE, no per-server credentials |
| Sandbox | bwrap is real and used by full-app; Vercel Sandbox real; packages published | gVisor does not execute on main; `RemoteWorkerTransportV1` has no implementation |

**The shared substrate.** BYOK, MCP and sandbox converge on one missing
component: per-workspace credentials and registration. Evidence, not
architecture-astronomy: the encrypted settings table's only observed content
is MCP registration data (`__serverBoringMcpSourcesV1`); bead
`wt-391-forward-16f.7` wants BYOK migrated OFF that same table; and the frozen
credential contract's `sandbox-pipe`/`sandbox-tmpfs` delivery modes are stubs
on both ends. Streaming is the genuine exception — independent, and nearly
done.

**Parked PRs do not close their lanes.** #917 is storage+crypto only and
defers UI, lifecycle and resolver wiring by its own body. #916's body says do
not merge and its runsc isolation evidence is self-described as
non-admitting. Neither is a shortcut.

**Two sandbox facts true today, owned by no wave:** the CLI defaults to
`direct` — raw spawn, zero isolation — on every platform, with bwrap opt-in
behind `--mode local-sandbox`; and neither real backend isolates network
egress (bwrap defaults to `--share-net`). Defensible for a local dev tool the
user controls; wrong the moment anything less-trusted runs.

**Inert surfaces that read as working support** — fix or remove, do not build
on: `mcpServerRefs` on agent definitions is validated, frozen and
inventory-checked but never resolved into a connection; managed-agent MCP
ingress is hardcoded off in every released host.

**Streaming keying, decide before durable schema:** the buffer key is
`[sessionId, workspaceId, userId]` and the stream path is
`sessions/<sessionId>` — `agentTypeId` is in the URL but in neither. Not a
live defect (ids are minted unique; cross-agent addressing is rejected), but
durable rows would bake the omission in.
*A1 errata (2026-08-30): the `userId` slot is already empty on every addressed
route, and the durable stream path is now
`sessions/<enc(workspaceScopeId)>/<enc(sessionId)>`.*

**Bookkeeping correction:** bead `0jpy.15` ("duplicate AgentLiveEventBuffer")
has a false premise — there is one such class with no external consumers. The
real duplication is two replay sources. Rewrite the bead before working it.

## Plan-folder map (what still binds)

| Folder | Status |
|---|---|
| `docs/issues/909/` | Frozen record of what shipped + follow-up beads. Binding for the Gateway contract (§6) |
| `docs/issues/391/` | Decision-28 detail for Waves 2+. Binding once its wave opens |
| `docs/issues/805/` | A1 shipped; remainder absorbed into 391's F-graph. Reference only |
| `docs/issues/808/`, `820/`, `806/`, `900/` | Lane detail for Waves 3–4. Reference until their trigger fires — but §Lane reality outranks them on what exists |

Lane tracking issues (each with a draft seed PR): #1009 streaming, #1010 BYOK,
#1011 external MCP, #1012 sandbox. Issues #820 and #808 are CLOSED; #1010 and
#1012 replace them as the tracking issues for their parked PRs.

Bead graph: epic `wt-391-forward-0jpy` follow-ups (Wave 1–2) + F-graph under
`wt-391-forward-step1a-current-xn9` (Wave 2+). Anything not reachable from
this file's waves is not dispatchable without an owner amendment here.

---

## Amendment 2026-08-08 — state verified against `origin/main` + landing this file on main

Everything above is the owner's last ratified direction (2026-07-27, refreshed
2026-07-31 with §Lane reality). This section records what has ACTUALLY landed
since, plus the direction ratified in the 2026-08-08 owner grill. Companion
analysis: [`docs/direction/state/2026-08-08.md`](state/2026-08-08.md).

### Governance fix (this PR)

This file claimed sequencing supremacy while not existing on `origin/main`
(flagged by the #1153 reconciliation memo). This PR lands it on main.
**Decision 29 (AgentGateway v0) was ratified by the owner 2026-08-08**; the
DECISIONS.md status flip lands via a separate ratification PR alongside
Decision 30 (presentation-only landings).

### Verified landed since 2026-07-31 (do not re-plan)

- **Wave 1 (multi-agent console): substantially delivered.** Multi-agent UI +
  addressed lifecycle races (#1102), Agents section with per-agent cards and
  unified labeled chat list (#1149), config-driven production fleet loader
  `BORING_AGENT_FLEET` (#1114), digest refresh/CI (#1108/#1109), per-automation
  agent selection (#1143), exact-SHA release + atomic tag binding (#1105),
  hermetic dev-login + dev smoke (#1104), UI polish epic #1110 lanes.
- **Wave 2 (streaming durability): wired.** SqliteEventStreamStore in
  production behind a flag (#1128), async driver unblocking the event loop
  (#1141); readiness/observability surface in review (#1142).
- **Wave 3 opened early, per its own triggers firing.** BYOK: KmsBackend vault
  + local-KEK backend merged (#1132); durable credential persistence in review
  (#1145); plans r3 ratified (#1137). External MCP: user-registered typed MCP
  source with SSRF-safe validation (#1130), per-agent MCP grants via capability
  projection (#1131) merged; connect-time SSRF enforcement in review (#1135).
- **Landing lane revived within D28** (presentation-only, zero authority
  effects, per the #1153 memo): config-driven bounded hostname landings
  (#1154), per-workspace `default_agent_type_id` persistence (#1156),
  runtime identity separation (#1147) — all in the validation queue.
- **Persona/authored-agent lane started:** agent-definitions-as-packages plan
  r2 merged (#1136); slice 1 (persona discovery via plugin asset manager,
  #1150) in review. Channels (#1127) and executable environments (#1123)
  have ratified plans r2, no implementation.

### Vertical agents — the semantic standard (ratified 2026-08-08)

**"Vertical agent" is the one product noun.** The earlier niche-agent /
influencer-agent taxonomy is dissolved: an influencer agent is simply a
vertical agent whose niche is a person or brand. Every vertical agent is the
same shape — **fleet seat + persona/knowledge package + its own landing page**
(`<agent>.senecaapp.ai`). This is the direct execution of VISION Horizon 1 and
GTM Motions 5/2b.

The surviving distinction is **AUDIENCE**, not agent kind:

- **Private vertical agent** — invite-only members, hand-provisioned
  workspace, workspace/BYOK funding. **Fully operational today** once the
  landing validation queue merges.
- **Public vertical agent** — open registration from the landing page →
  per-signup workspace via the D28 signup-domain hook, pooled funding.
  **REQUIRES** self-signup work, spend caps, and abuse guardrails before
  opening.

**Every agent launches private; "going public" is a per-hostname ops decision
once caps exist.** The former "influencer agent" gap list in the snapshot is
re-labeled **public-vertical-agent features** (self-signup, caps/guardrails,
channels) — see [`state/2026-08-08.md`](state/2026-08-08.md) §5–6 with its
errata.

Sequencing consequences (ratified):

- The niche-vs-influencer ordering dissolves: **ship landing pages per agent
  now (private)**; pull self-signup only when the first public vertical agent
  needs it. Wave 1.5 = merge the landing/default-agent validation queue, then
  ship one named vertical agent end-to-end on a real hostname before further
  Wave 3/4 expansion.
- **#1107 slice 3 (workspace install/update path — add agents without
  redeploy) is queued next** in the agent-packaging lane, below landing/BYOK.

### Commercial premises (ratified 2026-08-08)

- **boring-ui provides the PREMISES, never the pricing.** The platform ships
  the capability substrate — per-user and per-workspace provider credentials
  (the BYOK vault), provenance-labeled provider rows in the model picker
  (workspace / personal / platform-credits), and, when a consumer pulls it, a
  per-workspace usage-facts feed (#819). It stays commercially neutral and
  must not preclude any pricing topology.
- **Each app/tenant repo adapts the strategy for its segment** (Seneca first):
  e.g. monthly subscription (with BYOK or included usage) for private B2B
  vertical agents; credits for public-vertical-agent funnels when self-signup
  opens. Billing systems live app-side; the platform only ever emits facts.
- **Sequencing consequence:** #819 metering ships only when a usage-priced
  offer pulls it — the platform emits facts, the app bills. It is NOT a
  blocker for the first vertical agent under subscription pricing. This
  amends the metering recommendation in
  [`state/2026-08-08.md`](state/2026-08-08.md) §3/§4 (errata noted there).

### Lane priorities (ratified 2026-08-08)

- **#1123 executable environments: ACTIVE at LOW priority** — it is what
  analyst vertical agents need to execute over client data. Background slices
  continue; it never preempts landing, BYOK, or #1107.
- **#1127 channels: deprioritized.**
- **UI polish loop: standing low-effort background work** — keeps running.

---

## Amendment 2026-08-26 — the premises re-sequencing

Everything above stands as written and is not rewritten. This section records
what has landed since 2026-08-08 and **supersedes the wave sequencing** with a
premises-first ordering. This file remains the **sole sequencing authority**:
orchestrators dispatch from the waves named here, and where an issue plan, a
bead priority, or a plan folder disagrees with this section, this section wins
until the owner amends it.

Companion analysis:
[`state/2026-08-26.md`](state/2026-08-26.md) — full snapshot, verified against
`origin/main` at `98619e9b8`. Canonical plan pack:
[#1409](https://github.com/hachej/boring-ui/pull/1409)
(`docs/plans/multiagent-shell/`, chapter 1 `premises.md` owns the program).
Rulings ledger: [#1399](https://github.com/hachej/boring-ui/issues/1399).
Ratifications: [#1401](https://github.com/hachej/boring-ui/pull/1401) (MERGED)
and [#1416](https://github.com/hachej/boring-ui/pull/1416) (CLOSED, absorbed into
#1409 — #1409 was the ratification instrument and is **MERGED 2026-08-27**
(`eb574cfe7`), so `RECONCILIATION.md` §8 is ratified; §9 landed after it via
the second-grill repair PR).

### Naming convention (applies from here down)

Roadmap items carry **descriptive names**, not letter-number codes. Each name
below shows its old code **once**, in parentheses, so existing beads and plan
docs stay traceable; after that the name is the only handle. Bead IDs are
unchanged — they are tracker handles, not prose.

### Reconciling the old wave numbering — honest supersession

The four waves above were correct for their moment and are **not renumbered**.
Their disposition today:

| Old wave | Disposition |
|---|---|
| Wave 1 — multi-agent console | **Complete and closed.** Its 08-08 residue merged: #1147, #1156, #1165. |
| Wave 2 — streaming durability | **Complete at conformance Level B** (#1128, #1141, #1142). It **reopens at Level D** as [durable-streams] below — a new obligation, not a reopened defect. |
| Wave 3 — BYOK / MCP / authored catalog | **Complete except BYOK.** MCP closed (#1135) and correctly paused. Authored catalog delivered (#1202 merged 08-11); epic #1107 closed as a duplicate surface, work lives in the `xp3s` beads. BYOK persistence (#1145) remains open since 08-07 and is now carried in the commercial wave's platform half. |
| Wave 4 — v2 era | **Still frozen for implementation.** Its architecture is now documented and merged (#1220 / #1081, sovereign sandbox service). Documentation is not a gate opening. |
| Landing lane (off-wave) | **Superseded 2026-08-10 by owner ruling** (Option B): per-agent landing pages are an app concern. #1154 closed; #1156/#1165 stayed platform-side and merged. |
| Wave 1.5 (08-08 amendment) | **Partly overtaken.** Its landing half moved app-side per the ruling above; the "one named vertical agent end to end" objective moves to the commercial wave, tenant-repo side. |

**Nothing above is retracted.** The multi-agent console remains the product
thrust and the vertical-agent semantic standard (ratified 2026-08-08) is
unchanged. What changes is the *order of what is built next*.

### The two waves that run now, side by side

Neither gates the other. That independence is the point of the
premises-never-pricing split (ratified 2026-08-08): a commercial decision must
never reorder the kernel, and kernel sequencing must never be justified by an
unnamed offer.

#### Wave A — Premises (platform, NOW)

Kernel capabilities land and are **proven** before the surface built on them.
Two rulings set the tone, both from the owner interview of 2026-08-26:
**the engine does not ship on conformance Level B**, and **the thread storage
model is not decided**. Full program:
`docs/plans/multiagent-shell/premises.md` in #1409.

> **Owner amendments 2026-08-27 (consolidated) — spikes ran, execution
> split.** Two short spikes ran the same day, before [durable-streams]
> commits any implementation schema: the **pi-0.84.3 core-adoption spike**
> (`wt-391-forward-9n6w` — the pi framework shipped its v4 durable core and
> deleted the line our pin sits on; the spike proves the migration path
> under the D29 gateway and sizes what our ~1,700-line bespoke stream
> surface keeps vs delegates) and the **storage-model competitor research**
> (`wt-391-forward-shell-ngfs.13.1`). Both completed: the core spike's
> verdict is **do not wire pi 0.84.3** (published harness = scaffold, not a
> durable substrate; report in the shell pack's `research/`), and the P2
> competitor research is done. **Starts now:** P1-A, the substrate-neutral
> layer — the private harness backend seam under D29
> (`AgentHarnessBackend`), gateway request/effect ledger, effect admission,
> activity recovery, resume protocol — plus the paused-human and headless
> conformance journeys. **P1-B (event-stream backend): the pi wait is
> REMOVED** (owner ruling, second grill 2026-08-27 — RECONCILIATION §9c).
> P1-B builds Boring's own event backend behind the `AgentHarnessBackend`
> seam, after P1-A establishes the seam; no calendar check-in, no
> wait-for-release. The `pi-v2-alignment.md` criteria survive only as the
> bar a future pi release must beat (including migration cost) to replace
> that backend. P1-C (Level-D completion, default-on, D29 evidence) runs
> after P1-B. Gating precision: the headless journey runs parallel and never
> gates substrate-free chrome, but it is required evidence for P1
> completion — and therefore indirectly gates every Job Thread or
> Thread-view slice that consumes P1.

1. **[durable-streams]** (epic `wt-391-forward-9p50`, formerly P1) — **the
   keystone.** Both spikes have reported; P1-A is dispatchable NOW. Structure
   per the amendment box above and `premises.md` P1: **P1-A** = five beads
   (A1 identity/migration, A2 harness seam, A3 request/effect/attention
   durability, A4 activity/resume, A5 headless + paused-human proofs — A5
   after A2–A4); **P1-B** = the Boring event backend behind the seam (pi wait
   removed, §9c); **P1-C** = Level-D completion + `BORING_CHAT_DURABLE_STREAM`
   default-on + the dated Decision 29 re-evaluation addendum (owner merge =
   ratification). This is D29's own named trigger arriving
   (`DECISIONS.md:472`/`:476`), not new scope. The old "two one-session
   slices" estimate is withdrawn. All P0; downstream engine work depends on
   P1-C.
2. **[thread-storage-spike]** (epic `wt-391-forward-shell-ngfs.13`, formerly
   P2) — **rescoped 2026-08-27.** Child `.13.1` (competitor study) is **DONE**
   (`research/thread-storage-competitor-study.md`). The value-root half is
   **ruled, not spiked** (RECONCILIATION §9a: Thread = job root, 0..n
   Sessions). Child `.13.2` shrinks to the storage-**shape** spike only —
   first-class Thread stream vs projection over Session records — and starts
   after durable-streams P1-A establishes the Level D shape. It decides what
   the owner gate may choose for engine storage and #1355 references.
3. **[seat-audit-attribution]** (epic `wt-391-forward-shell-ngfs.14`, formerly
   P3 / seat storage C7) — child `.14.1` lands host catalog/envelope identity;
   child `.14.2` projects immutable `seatId` through messages, trajectories,
   artifacts and usage. Sequencing, not new ontology: already ratified as
   required (`docs/plans/long-term/ratified/RECONCILIATION.md:153`).
   Display-only participant chips are **rejected**. Two one-session slices with
   genuine implementation uncertainty.
4. **[saved-views-kernel]** (formerly P4) — the first ratified View slice, the
   contract as a set. **Unsized; needs its own planning pass before estimation.**
   Does not block a view library over files and built-in views.
5. **[merge-queue]** (formerly P5) — a standing obligation, not a bead: this
   list gets a pass **before any premise bead is dispatched**. Current path
   items: #1382 (and the eval suite stacked behind it) — the sole remaining
   item as of 2026-08-31 (#1343 closed superseded; #1376, #1386 merged);
   kernel-adjacent but off-path: #1145, #1166, #1288. #1409 is MERGED and
   #1416 is closed-absorbed into it — neither is a queue item. Also decide
   the two orphaned weekend branches (`weekend/k7-agent-packages`,
   `weekend/factory-check`).
6. **[gate-re-ruling]** (formerly P6) — re-rule both owner gates after
   [thread-storage-spike] reports, dropping what it answered. Minutes of owner
   time; cannot happen early.

**Runnable in parallel, substrate-free by construction** — a property that can
be checked, not an exemption granted: **[shell-layout]** (formerly L1),
**[shell-location]** (formerly L1.5), and **[shell-navigation]** (formerly L2a,
nav chrome with counts **absent** as a valid state). Everything else in the
shell waits.

**Re-gated behind the premises.** The engine slices (formerly S1–S6) wait on
[durable-streams] and consume [thread-storage-spike]'s findings; the interim
Level-B receipt machinery is `descoped-pending-P1`. The thread-rendering shell
slice **[thread-view]** (formerly L4) waits on all three of
[durable-streams], [thread-storage-spike] and [seat-audit-attribution]. Saved
views in the view library wait on [saved-views-kernel]. Relay-vs-blackboard is
decided **after** [durable-streams], with both candidates live.

**Done-bar, unchanged in spirit from Wave 1:** a premise is done when it is
*proven*, not when it compiles. Note against that bar that the visual-review
harness is broken on clean main ([#1390](https://github.com/hachej/boring-ui/issues/1390))
— repair it before the shell slices need reviewer-agent proof.

#### Wave B — Commercial (tenant repos, in parallel)

**Sequencing for this wave lives in the Seneca tenant app repo's roadmap
(`hachej/boring-ui-constellation`), not here.** Pricing topology, packaging,
vertical-agent go-to-market order, landing-page content and outreach motions are
deliberately absent from this file. The 2026-08-10 landing ruling is the
precedent: per-agent landing pages are an app concern, and #1154 was closed on
exactly that boundary.

What stays platform-side, and is therefore dispatchable from here:

- **BYOK durable credential persistence (#1145)** — open since 08-07 and the
  oldest item in the queue. It is the credential substrate any per-client offer
  needs; it is not on the premise path and must not preempt [durable-streams].
- **Usage facts (#819)** — unchanged from 08-08: the platform emits facts only
  when a usage-priced offer pulls it; apps own billing. Still not a blocker.
- **Provenance-labeled provider rows** in the model picker — the neutral
  substrate, no pricing semantics.

**The boundary test, for future proposals:** if a change encodes what something
costs, who is billed, or how an offer is packaged, it belongs in the tenant
repo. If it encodes *what a workspace can be told about credentials, usage, or
attribution*, it belongs here.

### Lane priorities (amended 2026-08-26)

Carried unchanged from 2026-08-08 unless noted: #1123 executable environments
ACTIVE at LOW priority; #1127 channels deprioritized; UI polish a standing
low-effort background loop. **New:** nothing in the shell or engine is
dispatchable except the three substrate-free chrome slices until the premises
they depend on have landed.

### Decision log (owner, 2026-08-26)

| Decision | Ruling |
|---|---|
| Sequencing | **Premises before surface.** Kernel capabilities land and are proven before the product surface built on them. Supersedes the wave ordering above without retracting it. |
| Keystone | **[durable-streams] first.** Highest-leverage node; its two children are P0 and downstream engine work depends on the rollout child. |
| Engine substrate | **The engine does not ship on conformance Level B.** Interim receipt machinery `descoped-pending-P1`; relay-vs-blackboard decided after the substrate is real, both candidates live. |
| Thread storage model | **NOT decided.** Routed to [thread-storage-spike]; the plan-level noun recommendation is withdrawn. Nothing in the ratified product surface presumes its outcome. |
| Attribution | **Audit-grade from day one.** Display-only participant chips rejected; `seatId` in the seat catalogue pulled forward. |
| Thread noun | **Settled** — a Thread may span multiple Seats, projected as one timeline; one Thread per job (#1401, MERGED 2026-08-26). "Channel" stays reserved for transport/ingress. |
| Thread ↔ Objective | **Optional one-way link.** An Objective is not mandatory for a job. |
| Saved views | **Wait for [saved-views-kernel].** A first view library is files + built-in views only; no lookalike descriptor minted in the product layer meanwhile. |
| Nav extensibility | **Plugins CAN add top-level entries.** The closed-IA recommendation was ruled against; crowding risk noted and accepted. |
| Deep links | **The shell owns the serializable location; the host owns URL translation.** |
| Specification | **The design canvas and `weekend/saas-hybrid-spike` are ratified specification artifacts** — what implementation is checked against, not proposals awaiting a slot (unlike #1409 at the time; since merged 2026-08-27). Their chat column and thread transcript are explicitly visual fixtures; that is not an implementation claim. |
| Commercial split | **Reaffirmed and extended.** Premises never pricing: commercial sequencing lives in the tenant repo; the platform ships credential, attribution and usage-fact substrate only. Precedent: the 2026-08-10 landing ruling. |
| Merge discipline | **Zero autonomous merges holds** (verified: all 31 merges in the 08-22→08-26 window were owner-performed). **Review ladders did not happen** — nine weekend PRs produced zero formal review submissions. Restore the review gate before the premise burn, and never close a PR without a recorded reason (#1380 and #1381 were closed silently). |

---

## Amendment 2026-08-27 (evening) — second-grill rulings + drift repair

A full-repo second-opinion review of the merged #1409 found the strategy
sound but the repository representing several versions of it as
simultaneously executable. The owner grilled through every open branch the
same day. Rulings (ontology halves recorded in
`docs/plans/long-term/ratified/RECONCILIATION.md` §9; this section is the
sequencing record):

| Decision | Ruling |
|---|---|
| Thread/Session | **R-c amended (§9a).** Thread = durable job root, one per job; Session = one runtime conversation; 1 Thread : 0..n Sessions (headless = zero). Channel stays transport. The P2 value-root question is ruled, not spiked — a spike over pre-excluded candidates is ceremony. |
| Thread storage | **Only the shape is still open** — first-class Thread stream vs projection over Sessions. `.13.1` research DONE; `.13.2` rescoped to shape-only, after P1-A. |
| Transcript authorship | **Multi-author (§9b).** One composer, several named agents visibly authoring posts with chips and join/handoff/left markers. "One voice / workers hidden" retired; formula = one job, one composer, explicit specialists. The orchestrator holds its own Seat. |
| Pi gate | **Removed (§9c).** No 2026-09-10 ritual, no wait-for-release. P1-B builds the Boring event backend behind the `AgentHarnessBackend` seam; pi adoptable later only past the behavior + migration-cost bar. |
| P1-A granularity | **Five beads**, A1–A5, individually reviewable (the single `9p50.1` bead under-represented the state machine). |
| Relay engine plan | **Demoted to historical candidate** (`multiagent-shell/research/candidates/`). Its S1–S6 embedded superseded assumptions (display-only participant ids, satisfied-Q1 claims, relay-first shape). A new engine plan is written after the shape spike + gate re-rule, from §9's rulings. |
| Doc governance | **Prose repair + tiny lint.** `scripts/check-strategy-docs.sh` fails CI on known drift markers (merged PRs described as pending, withdrawn estimates in executable sections, missing candidate banners). No YAML state machine. |
| Shell claims | **Left as-is by explicit owner choice** — the "design is settled" framing stands; multi-agent interaction, View-side chat, and mobile remain evidence-gated in fact but are not re-worded. |

Dispatch consequence: **P1-A beads (A1–A5) and P1-B are the active premise
lane**; P1-B after A2. `.13.2` (shape spike) after P1-A. Everything else in
the 2026-08-26 amendment stands as written.

---

## Amendment 2026-08-27 (night) — strategic-audit fold

An external Seneca × Boring strategic audit (business/GTM level) was reviewed
against post-#1433 main. Most of its recommendations were already ratified
position (Work-as-root §9a, one-family-three-jobs, headless-inside-a-product,
Seneca-as-consumer, review-loop freeze, channels/marketplace deferral). Three
genuinely open items were ruled:

| Decision | Ruling |
|---|---|
| Thread staffing | **Two first-class modes (§10a).** Default = one bounded agent, grown on measured evidence; alternative = a predefined fleet declared by the agent/vertical package. The future engine plan optimizes the single-agent path first. |
| Horizon ladder | **Split.** Of the audit's Horizon 0–5 ladder, only Horizon 0 (the internal factory as first consumer) and Horizon 2 (a second consumer proving the substrate) are platform framing — both already implicit here. Horizons 1/3/4/5 (first paid product, packages/distribution, developer cloud, recursive improvement) are commercial sequencing and live in the Seneca tenant repo's roadmap, per the premises-never-pricing split. Nothing new is dispatchable from the ladder. |
| Agent presence | **Vocabulary recorded (§10b):** `hidden · ambient · drawer · page · roster`; `ambient` default for vertical SaaS, Meridian = `roster` flagship. Naming only. |

The audit's decision filter (buyer / work-unit / feedback / reuse /
irreversibility / complexity tests) is adopted as reviewer guidance for
future capability proposals — a filter, not a gate. No premise, bead, or
queue item changes; P1-A dispatch is unaffected.

## Amendment 2026-09-05 — Workspace Evolution

**Owner-requested; effective on owner merge. Specified, not implemented by
this PR.** Add Workspace Evolution as a named platform-consumer program:
direct user requests produce private software revisions that can be previewed,
activated, reconciled with upstream improvements, and selectively reused.
Clinic is the first workflow proof; Seneca is the authenticated host for the
personal-scope proof. Pricing, offer design, and vertical GTM remain tenant-side.

The binding scope is [RECONCILIATION §11](../plans/long-term/ratified/RECONCILIATION.md#11-owner-requested-amendment--2026-09-05-workspace-evolution).
The [execution plan](../plans/workspace-evolution/README.md) owns milestone
acceptance, seam ownership, rollout, and proof. This amendment alone owns
dispatch; the M0–M8 capability crosswalk is not another queue.

| Slice | Dispatch and release dependency |
|---|---|
| E0 — request and preview preparation | May run after owner merge, alongside the existing premise lane: capture the named request, existing component/operation catalog, and a fixture-based preview. No production agent-driven activation, new Job Thread, or lookalike saved View contract. |
| E1 — durable workspace revision | After E0 and [durable-streams] P1-C proves the accepted-work/recovery/paused-human behavior consumed by this loop. Host-owned durable activation and current authorization are release requirements. Any saved semantic composition also waits for [saved-views-kernel]. |
| E2 — personal scope | After E1 and authenticated membership/scoped-store read, preview, write, and revocation evidence. Require [seat-audit-attribution] for Seat-authored provenance where consumed. Do not substitute a browser key or shared local actor for identity. |
| E3 — behavior revision | After E1/E2, exact behavior/run attribution and relevant protected evaluation gates. A presentation preference does not authorize changing shared expert or domain policy. |
| E4 — isolated private module | After E1/E2 and the C4 untrusted tier is admitted/proven for both build and serving; no hosted generated-code preview or install before that gate. |
| E5 — upgrade and reconciliation | After E1/E2 for configuration. Extend after E3/E4 for their artifact classes. Prove an ordinary upstream upgrade and a real conflict before broadening that class's automatic updates. |
| E6 — approved reuse and broader autonomy | Starts after E5; completion requires a useful approved contribution adopted by a second private workspace. Broader autonomy additionally needs retained-use and maintenance evidence for that change class. Publishing and customer adoption remain separate authorizations; a public marketplace is not a prerequisite. |

**Priority and explicit supersession.** The merge-queue preflight and
[durable-streams] keystone priority stand. E0 is an explicit addition to the
earlier list of runnable preparation/chrome work; it does not relabel E1 as
substrate-free. Later E-slices are conditional consumers of their named
premises, not a blanket reopening of the non-chrome shell/engine freeze.
Wave 4's new-repo implementation gate and the interface-first port doctrine
remain unchanged. Use existing published package/app seams; the new-repo
M-labels describe capability relationships only.

Thread-storage shape and the Thread-view joins apply when an E-slice embeds
in Job Threads. They do not gate a standalone configuration preview that
consumes none of them. Saved Views still wait for the complete ratified View
contract. Early product-specific props may select existing components; they
may not create a replacement ViewDescriptor under an overlay name.

**Next work on adoption:** execute E0 against one real Clinic layout request,
record its implementation/acceptance boundaries, and prepare E1's scoped
feature work against the then-current premise evidence. No capability is
closed by this plan PR, and no calendar estimate substitutes for a gate.

The done-bar is a direct request kept through real use and a supported
upgrade, followed by approved reuse in another private workspace. Track all
attempts, including failed builds and repair work; generated-code volume is
not progress by itself.
