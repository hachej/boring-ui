# boring-v2 — Full Product Specification

2026-08-16 (v2 of this spec — expanded from runtime-only to the full vision on
owner direction). The complete system, every layer with its abstractions,
defined ONCE — gaps filled incrementally by milestones. Companions:
VISION.md (north star) · V2-PORT-HANDBOOK.md (design inputs + quarry) ·
ARCHITECTURE-PLAN v3 (frozen engineering spec).

Locked decisions: single-package repo, folders-as-modules, dependency-cruiser
DAG (packages extracted only on publish pressure) · per-Session runtime records +
workspace envelope/kernel DBs *(2026-09-05 reconciliation with §9a: Thread is
the job root with 0..n Sessions; only its timeline storage shape remains spiked)* · first vertical = creator growth · repo =
`hachej/boring-v2` private · M1 = headless `runtime.run()`.

---

# PART A — THE SYSTEM (all layers, right abstractions)

Seven layers. Each: responsibility · abstractions · ports from boring-ui ·
new build · milestone where its gap gets filled.

```
L7  DISTRIBUTION   Products · creator publishing · entitlements · hosted URLs
L6  SURFACES       web app · npx · CLI · MCP · API · automations · channels
L5  OPTIMIZATION   Objective · Candidate · Evaluation · Outcome · benchmark · challenger
L4  VIEWS/APP      ViewDescriptor · resolvers · hosts · ambient-agent UX · ViewContext
L3  WORKSPACE      Seats · Threads · shared state · Artifacts · Activities · composition
L2  DATA           Mounts · semantic layer (BSL) · Resources · Computations(deferred)
L1  AGENT          definition · runtime · record · capabilities · skills · model policy
L0  HOST/CLOUD     identity · authority · envelope · metering · placement · planes
```

Dependency rule: a layer imports only downward. The kernel (`src/kernel/`)
holds the nouns every layer shares; it imports nothing.

---

## L0 — Host & Cloud plane

**Responsibility:** identity, authority issuance, work admission (envelope),
metering, placement, tenancy. The only layer that MINTS anything.

**Abstractions:**
```ts
Principal        = { kind: "human"|"agent"|"automation"|"service"; id }
Identity         // orgs, users, memberships (Ory-adapter port; D24)
Authority        { principal; scope; grants; revision }        // narrow-only, revocable
Envelope         // append-only admissions/settlements; RunId := RequestKey minted here
MeteringSink     { reserveRun; recordUsage; settleRun; releaseRun }  // credit-micros (port)
Placement        { workspaceId → environment/runtime location }      // trivial local impl first
AdmissionPolicy  // host-supplied, handed into the funnel (never inferred from env)
```
Three planes — control (auth, orgs, workspaces registry, billing, product
registry, placement) / data (workspace environments, mounts, DBs, artifacts) /
execution (agent runtimes, sandboxes, jobs) — **one process now, boundaries in
the type system from day one** so the EU-cloud ladder (shared EU → Swiss →
dedicated → VPC → self-host) is a deployment change, not a rewrite.

**Ports:** requestLedger (append-only rebuild) · scope-issuer pattern
(claim-based, `revision` for revocation — A8 done right) · AgentMeteringSink ·
core auth/DB primitives · Ory adapter.
**New:** Principal beyond {workspace,user} · AdmissionPolicy · placement stub.
**Milestones:** M1 (envelope+authority local) · M5 (multi-tenant control plane) ·
M7 (cloud ladder).

## L1 — Agent

**Responsibility:** the durable intelligence unit — complete WITHOUT a
workspace (Bare Agent is a product).

**Abstractions:**
```ts
AgentRef         { agentId; definitionDigest }
AgentDefinition  // instructions · skills · knowledge refs · model policy ·
                 // declared capabilities · evaluation history refs  (content-addressed)
AgentRuntime     { run(input, ctx): Run }          // pi harness behind the seam
SessionRecord    // per-Session runtime record; append-only; seq owned here; checkpoints;
                 // event kinds: user/assistant/tool-call/tool-result/queue-admitted/
                 // prompt-assembled/grant-snapshot/pause/approval/checkpoint
Capability<I,O>  { effect: observe|propose|mutate|external-effect; authorize; execute }
ModelPolicy      // provider selection = disclosure authority; keys via A7 issuer only
AgentState       // RESERVED, empty until pulled
```
**Ports:** pi harness (Flue seam: pi in-memory, our record durable, pinned
0.80.7) · boring-sandbox (direct+bwrap first) · multi-FS bindings (renamed
`RuntimeFilesystem`) · skills/knowledge loading.
**New:** effect-classed capability wrapper · A7 ModelCapabilityIssuer ·
per-Session record store · durable pause as record events.
**Milestones:** M1 (headless run) · M3 (Bare Agent npx product).

## L2 — Data

**Responsibility:** governed access to everything that exists.

**Abstractions:**
```ts
Mount            // 5 questions: namespace? discoverable? operations? authority? changed?
FilesystemMount  // the multi-FS port
SemanticDataMount// wraps BSL query engine; query = f(Mount, semanticQuery, Authority)
ResourceRef      // opaque id + workspaceId + provenance (share-entry port; path never leaks)
Artifact         // durable agent output; a ResourceRef with producedByRunId
SemanticModel    // BSL models; same query path feeds Agent, View, Evaluator
Computation      // DEFERRED (persisted reusable query; BSL provider #1)
```
**Ports:** share entries (AR1 — old repo finishes 003/004 first) · Data
Bridge/BSL engine (no rewrite; raw SQL privileged escape hatch) · fs bindings.
**New:** Mount interface + provider registry (immutable, PR-1256 pattern) ·
authority-in-query-signature · per-viewer result isolation.
**Milestones:** M1 (fs) · M2 (semantic + artifacts) · M4+ (connector mounts:
gmail://, odoo://, analytics://… pulled by verticals).

## L3 — Workspace

**Responsibility:** the durable governed WORLD — goal, participants,
composition, shared context. Never a renderer, never an agent owner.

**Abstractions:**
```ts
Workspace        { workspaceId; mounts; seats; threads; sharedState; artifacts }
Seat             { seatId; workspaceId; agentId; role?; budget?; permissions?; bindingState }
                 // grants participation, NOT identity (invariant 5); type is kernel-level,
                 // lifecycle is workspace-level (ratified Q4)
Thread           { threadId; workspaceId; title; participants; workingSet; sessionRefs }
                 // durable job root — RECONCILIATION §9a (2026-08-27): one Thread binds
                 // 0..n runtime Sessions; Session = one runtime conversation; headless
                 // jobs have none. sessionRefs expresses the relationship, not a
                 // storage-schema ruling; timeline shape (stream vs projection) stays spiked.
Activity         // what happened: runs, delegations, approvals, interventions
                 // (envelope projection — no second event system)
SessionCatalog   // host-authoritative ownership/placement (C7); seats ledger;
                 // envelope-derived; signed attestations when remote
Delegation       // agent.call({target: AgentRef, task, resources, budget}) —
                 // local gateway impl now; resolver seam for remote later
EffectiveCapability = agentDeclared ∩ workspaceGrants ∩ seatBinding ∩ threadRestriction
```
**Ports:** AgentGateway session machinery (for a Thread's runtime Session bindings) ·
workspace scope issuance (rebuilt claim-based) · fleet compilation idea
(deployment-static seats).
**New:** Seat entity · SessionCatalog/C7 · Activity projection · effective-
capability intersection compiler (eve vocabulary: disable/alias/wrap/replace,
compiled immutable).
**Milestones:** M4 (single-agent workspace = Agent App) · M5 (multi-seat).

## L4 — Views / App

**Responsibility:** human projection & control. The AI is UNDERNEATH the app.

**Abstractions:**
```ts
ViewDescriptor   { kind: collection|record|document|kanban|timeline|dashboard|
                   inbox|chart|table|map|artifact; subject; query; actions; presentation }
ViewResolver     // descriptor → renderer; agent never sees renderers
ViewHost         // SingleViewHost (M4) · DockviewViewHost (pulled later)
ViewContext      { activeView; selectedResources; focusedResource; workingSet }
ViewRef          // deep links in agent results
AmbientAgent     // composer · inline suggestions · proposals · approvals ·
                 // automations · explanations · temporary drawer (chat = one shell option)
AppComposition   // an "app" = Views + Capabilities over a Workspace (cheap last-mile)
```
**Ports:** BI dashboard renderers · Data Explorer (→ collection) · fs
tree/editor (→ navigator/document) · UI kit · Dockview (as renderer only).
**New:** resolver · ViewContext plumbing · ambient-agent surface · approval UI
(C5-backed — the OLD dead approval states finally get their real producer).
**Milestones:** M4 (Agent App with views) · M5 (workspace UI, team pane).

**Workspace Evolution extension (2026-09-05; retained contract, with
first-consumer timing superseded by §13 on 2026-09-07):** AppComposition
becomes privately revisable through the product-module release
contract in [RECONCILIATION §11](RECONCILIATION.md#11-owner-requested-amendment--2026-09-05-workspace-evolution).
Use the existing View contract as a set for saved semantic compositions;
early app-specific props do not create another ViewDescriptor. The host owns
revision activation, current grants, and durable receipts; the Experience
owns presentation and domain adapters. See the milestone crosswalk below.

**Ambient/composability clarification (2026-09-05):** AppComposition combines
domain capabilities, primary surfaces/navigation, presence, triggers, and
scoped context/state independently. An ambient Experience may expose a
temporary contextual drawer using §10's existing vocabulary. Clinic's primary
surface is Documents médicaux; it must support document tasks without mounting
chat or creating a Session. The same document unit also mounts beside chat;
compatible mounts share domain operations, not entire shells. Domain records
retain their own identity and versioning; admitted server work and non-chat
status/decisions outlive a browser. Session-keyed consumers need a trusted
adapter/migration before that live proof. The SessionRecord/Thread annotations
above explicitly correct the stale one-object terminology under the already
ratified §9a; they do not decide the outstanding Thread timeline storage shape.
Contracts and stress cases: [execution plan](../../native-creation/LIFECYCLE.md#composable-experiences-and-ambient-work).

## L5 — Optimization

**Responsibility:** the loop that justifies the company.

**Abstractions:** Objective · Candidate (versioned proposition; lineage via
parentCandidateId) · Evaluation (what we thought) · Outcome (what happened) ·
Evaluator (metric | simulation | independent-model | human | statistical |
policy-gate — never self-grading-only) · Benchmark (ground-truth harness) ·
ChallengerLoop (dry-run → independent benchmark → gated promotion; targets:
instructions, tool selection, model routing, reasoning strategy ONLY) ·
TrajectoryQuery (joins envelope + records + kernel stores via RunId — no new
storage).
**Ports:** none (genuinely new; small).
**Milestones:** M2 (stores + headless loop) · M6 (benchmark + challenger).

## L6 — Surfaces

Every surface is a projection of Capabilities + Views; none owns semantics:
**web app** (workspace UI, M5) · **npx Bare Agent** (M3, first package
extraction, D-f acceptance) · **CLI** (`run/threads/loop/outcome/info --json`,
M1) · **MCP** (expose capabilities + artifacts; client stays boring-side —
pi 0.80.7 has none; M4) · **HTTP API** (gateway projection, M3) ·
**automations** (scheduled principals, M5) · **channels** (DEFERRED behind C6;
boring owns identity/idempotence/retry; adapters only verify webhooks).

## L7 — Distribution

```ts
Product          { primaryAgent; agents[]; modules[]; defaultViews[]; workflows;
                   branding; pricing; entitlements; deploymentSettings }
                 // Product definition → instantiate → Workspace
Entitlement      // what a customer's plan enables (control-plane)
Publishing       // creator flow: build agent → publish → hosted URL → users
```
Ladder (ratified): Bare Agent → +Workspace → Agent App → +Seats → Team →
Product. Upgrades additive, never migratory.
*(2026-09-07, RECONCILIATION §13a: the private release/installation half of
this layer is the first complete journey and executes now in `hachej/boring-ui`
— see the native-creation extension below; only public packaging keeps M8.)*
**Milestones:** M5 (one hosted Agent App URL, manual/concierge) · M8 (Product
extraction — ONLY after two real verticals).

---

# PART B — CROSS-CUTTING CONTRACTS (bind all layers)

1. **ExecutionContext** everywhere: runId, thread, principal, authority,
   invocation surface, delegation depth, approvalRef. Six provenance questions
   answerable for every governed operation, always.
2. **Approval** = authority + evidence; C5 durable pause (request-ID keyed,
   tool-independent, channel-answerable, denial/expiry); agents cannot mint.
3. **Record/envelope split** (R2): telemetry, metering, Activity, billing read
   the ENVELOPE only; content stays in agent records. Privacy by architecture.
4. **Recovery** (R3): replay to checkpoints; `unknown-outcome` for unresolved
   external effects; last-known-good over blank failure; kill-9 chaos in CI
   from M1 onward.
5. **Clean-by-construction rules** (handbook Part V): generated event catalog
   with drift-fail · seam ships owner+impl+consumer · env allowlist at every
   spawn · mutation-tested controls · stable-prefix on state→delta · no
   ambient-env authority · dry-run before persisting anything agent-generated.
6. **Sovereignty:** Boring owns memory/context/history/policy/evaluation;
   model providers are replaceable inference behind A7.

---

# PART C — MILESTONES (incremental gap-fill; each independently valuable)

| M | delivers | product meaning | layers |
|---|---|---|---|
| **M0** | repo + kernel nouns + 5 conformance suites + 3 CI tools (lint-deps · gen-event-catalog · port-check) — "nothing can be added wrongly" | — | kernel |
| **M1** | headless `runtime.run()`: admit→sandbox→record→settle; CLI; kill-9 chaos CI | an agent you can trust to crash | L0/L1 local |
| **M2** | kernel stores + SemanticDataMount + creator mounts + `loop`/`outcome` CLI | **the MVP loop headless: 2 real cycles, cycle-2 measurably better** | L2/L5 |
| **M3** | Bare Agent `npx` product (built front, A7 BYOK prompt, D-f criteria; first package extraction) + HTTP API | *"deploy an agent"* — the developer entry point | L1/L6 |
| **M4** | single-agent Workspace: Seat #1, ViewResolver + SingleViewHost, artifacts UX, approval UI, MCP surface | **Agent App** — Bare Agent + workspace = views/modules | L3/L4 |
| **M5** | multi-seat workspace + team pane + control plane (orgs, entitlements, metering settlement) + one hosted URL | first paying design partners on hosted Agent App | L3/L6/L7/L0 |
| **M6** | benchmark harness + challenger loop (gated targets) | recursion measured against baselines — H1..H4 answered | L5 |
| **M7** | second vertical (macro → forces BSL transforms) + placement/plane separation exercised | kernel proven across two domains; cloud shape real | L2/L0 |
| **M8** | Product extraction + creator publishing flow | the distribution flywheel starts | L7 |

Gate between milestones = its acceptance + all conformance suites green + no
red-list symbol entered (port-check). The DAG of Part A decides order inside a
milestone; the kill criteria (handbook Part VII) can stop the line at M2 or M6.

Old repo in parallel, unchanged: P0.6 · A7 (ports into M1's L0) · P0.2 ·
AR1-003/004 (ports into M2's L2) · result→runId · keep selling.

## Native creation re-timing — 2026-09-07

**Ratified via #1561 (RECONCILIATION §13).** The first complete journey
(private product → immutable release → install for a separate consumer →
retained change → reconciliation) is built now, in this repository, on the
existing packages; it does not wait for M3 (npx) or M8 (Product extraction).
Three layers (host / product runtime / sandbox) and the installation/activation
path are the contracts; E0–E6 below remain the lifecycle acceptance ladder.
Bead map and gates: DIRECTION amendment 2026-09-07.

## Workspace Evolution milestone extension — 2026-09-05

> Consumer scope was updated 2026-09-06 under RECONCILIATION §12, then its
> first consumer, timing and execution home were superseded by §13 on 2026-09-07.
> The rows below remain the E0–E6 acceptance vocabulary; they are not the current
> dispatch order.

**Specified, unbuilt by this PR.** This adds a named product proof to the
capabilities above without renumbering M0–M8 or requiring M8 Product extraction
for a private change. The [execution plan](../../native-creation/LIFECYCLE.md#milestones)
owns E0–E6 acceptance; the [DIRECTION amendment of
2026-09-07](../../../direction/DIRECTION.md#amendment-2026-09-07--native-creation-is-the-first-complete-product-journey)
owns current dispatch. M-labels below map capability dependencies, not a second
queue.

| Extension | Capability relationship | Product proof |
|---|---|---|
| E0 — request and preview preparation | Registered units plus fixture-only adapter/extraction; no new runtime/storage premise | Two mounts and Clinic + Charlotte/Seneca synthetic fixtures; ESG is a labeled hypothesis; no live data-path claim. |
| E1 — durable workspace revision | E1a: M1 host/admission/recovery + M4 composition, current-repo P1 and consumed gates. E1b adds selected domain migration as needed, mandatory [thread-storage-spike] and [seat-audit-attribution] | E1a activation/undo survives restart. E1b proves selected live domain work and bounded Job Thread with non-chat results/decisions. Both complete E1; Clinic selection requires its identity migration. |
| E2 — personal scope | M4 workspace bindings + relevant M5 identity/membership substrate | Two authenticated users keep different presentations over shared work; personal UI state does not mutate content; parallel subjects remain isolated. Multi-seat UI is not a prerequisite. |
| E3 — behavior revision | M1 agent identity/provenance + E1/E2; relevant M6 evaluation machinery where present | Permitted personal behavior survives a shared expert update and is attributable to the work that used it. |
| E4 — isolated private module | E1/E2 + admitted C4 isolation and capability contracts | A novel component runs with scoped data and can be removed without breaking recovery. |
| E5 — upgrade and reconciliation | E1/E2 + supported package/state compatibility; E3/E4 when those classes are included | Real update and conflict proof; a second structurally different live consumer exercises a capability before a cross-domain claim. Kernel promotion retains its existing gate. |
| E6 — approved reuse and broader autonomy | E5 + repeat-use evidence and maintainer/export authority | A second private workspace adopts an optional generalized package and retains its own choices. |

E5's ordinary configuration upgrade proof should run before expanding the
catalog; it need not wait for E4. Behavior/module upgrades extend that proof
when those lanes exist. L7 owns reusable distribution and entitlements, while
private activation belongs to the host and Experience. Cross-domain
preparation uses Clinic and Charlotte/Seneca; one selected consumer earns the
first live loop. ESG remains a proposed stress case until inspected. This is
a platform acceptance choice, not a new commercial-vertical ordering.

# PART D — repo tree (full vision, single package)

```
boring-v2/
├── ARCHITECTURE.md  PORT-PROTOCOL.md
├── src/
│   ├── kernel/          # nouns + conformance (M0)
│   ├── host/            # L0: identity, authority, envelope, metering, admission (M1,M5)
│   ├── agent/           # L1: definition, runtime, record, capabilities (M1,M3)
│   ├── runtime-fs/      # L1: sandbox + RuntimeFilesystem (M1)
│   ├── data/            # L2: mounts, semantic, resources/artifacts (M2)
│   ├── workspace/       # L3: seats, threads, catalog, delegation (M4,M5)
│   ├── views/           # L4: descriptors, resolver, hosts, ambient (M4)
│   ├── optimization/    # L5: stores, evaluators, benchmark, challenger (M2,M6)
│   ├── surfaces/        # L6: cli, http, mcp, web (M1,M3,M4,M5)
│   └── product/         # L7: packaging, entitlements, publishing (M8)
├── experiments/creator/  experiments/macro/
├── benchmarks/
└── tools/               # lint-deps · gen-event-catalog · port-check · chaos
```
Dependency-cruiser enforces: kernel ← host ← {agent,runtime-fs,data} ←
workspace ← {views,optimization} ← surfaces ← product. Extraction to published
packages only on publish pressure (first: M3).
