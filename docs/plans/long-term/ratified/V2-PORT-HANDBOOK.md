# boring-v2 Port Handbook

2026-08-16. The build document for the new repo, per ruling R-a (new repo,
interface-first, port mechanisms). Companion to VISION.md (north star) and
ARCHITECTURE-PLAN v3 (frozen engineering spec — the port implements it).
This file is inclusion-complete for the owner's V2 document; nothing in it is
summarized away.

---

## Part I — Kernel interfaces (V2-00; freeze these first)

Twelve nouns. Each gets: one-sentence responsibility, identity, lifecycle
owner, allowed references, forbidden knowledge. Nothing else enters `kernel/`.

### Agent
First-class durable actor, independent of any Workspace.
```ts
interface AgentRef { agentId: string; definitionDigest: string }
```
- `agentId` = continuing identity; `definitionDigest` = exact immutable version.
- Identity never depends on Workspace membership; zero/one/many workspaces.
- Runtime provider is NOT part of identity.
- Port mapping: `agentTypeId → agentId`, `definition.digest → definitionDigest`.

### Run
Universal execution/evidence spine.
```ts
interface Run {
  runId: string            // == envelope RequestKey (ratified); branded projection type, never a second UUID
  agentId: string; definitionDigest: string
  workspaceId?: string; threadId?: string
  admittedAt: string; startedAt?: string; finishedAt?: string
  status: string; usage?: unknown; result?: unknown
}
```
HARD INVARIANT: runId minted before accepted execution by the admitting
authority; stable across metering, artifacts, trajectories, evaluations,
candidates, outcomes. (This is C6/D-c ported, not redesigned.)

### Workspace
Durable governed world where humans and agents do optimization/research work.
Not Dockview, not a filesystem root, not an AgentHost, not a chat container.
```ts
interface Workspace { workspaceId: string; mounts: MountRef[]; agentBindings: AgentBinding[]; threads: ThreadRef[] }
```
No UI semantics in the type, ever.

### Thread
Resumable unit of work ("ACME proposal", "Why is EZ inflation sticky?",
"New low-cost formulation"). NOT a runtime process, Pi session, transcript, or tab.
```ts
interface Thread { threadId: string; workspaceId: string; title?: string; participants?: ParticipantRef[]; workingSet?: ResourceRef[] }
```
Implementation: recasts AgentGateway session machinery; owns one per-session
record (A2a) and many Runs.

### Mount
Addressable governed namespace exposing data/resources/capabilities to a
Workspace. Deepest V2 abstraction.
- Namespace examples: `filesystem://workspace`, `filesystem://github`,
  `database://app`, `database://warehouse`, `gmail://company`, `odoo://erp`,
  `knowledge://research`, `objectstore://artifacts`.
- A Mount answers exactly five questions: what namespace/provider exists ·
  what resources are discoverable · what operations are possible · what
  authority governs them · what changed.
- **V0 implements ONLY `FilesystemMount` and `SemanticDataMount`.**
- Reference implementation = current multi-FS bindings. Preserve on the way up:
  named bindings; readonly/readwrite; operation boundaries; per-path access
  resolution; ONE coherent namespace across shell, model, and file tree;
  provider abstraction. Do NOT force all providers into one giant operation set.

### Authority
Host/control-plane-issued governance context; unforgeable by agents.
```ts
interface Authority { principal: PrincipalRef; scope: unknown; grants: Grant[]; revision: number }
```
Core law: `effective access = declared capability ∩ workspace grant ∩ agent
binding ∩ thread/run restriction`. Authority only narrows as scope becomes
more specific. `revision` exists for revocation epochs (A8 ported on day one).

### Capability
One governed operation defined once, projected to every authorized surface
(UI, agent tool, HTTP, MCP, A2A, automation, CLI).
```ts
interface Capability<I, O> {
  id: string                       // e.g. "portfolio.evaluate"
  inputSchema: unknown; outputSchema: unknown
  effect: "observe" | "propose" | "mutate" | "external-effect"
  authorize(ctx: ExecutionContext, input: I): Promise<void>
  execute(ctx: ExecutionContext, input: I): Promise<O>
  surfaces?: unknown
}
```
Effect semantics: agents are maximally autonomous in `observe + propose`;
`mutate` requires authority; `external-effect` (email, trade, deploy) settles
through accepted-work and is where `unknown-outcome` lives. This replaces the
binary can/cannot-act model.

### Objective
Optimization intent must not live only in prompt text.
```ts
interface Objective { objectiveId: string; workspaceId: string; spec: unknown }
```
`spec`: measures, constraints, preferences, evaluator refs, weights, hard/soft.

### Candidate
**A versioned proposition that can be evaluated against an Objective** — the
generalized definition (the macro-analyst stress test forced it): formulation,
forecast, hypothesis, portfolio, campaign, factory schedule, pricing strategy,
AgentDefinition, View configuration.
```ts
interface Candidate { candidateId: string; objectiveId: string; producedByRunId: string; parentCandidateId?: string; payload: unknown }
```
`parentCandidateId` = the lineage that makes generations analyzable.

### Evaluation
Our assessment of a Candidate — deterministic metrics, simulations, benchmarks,
independent models, human experts, statistical tests, policy gates.
```ts
interface Evaluation { evaluationId: string; candidateId: string; evaluator: string; score?: number; evidence: unknown }
```
NEVER self-grading-only loops.

### Outcome
What actually happened — **new evidence from the world after a Candidate was
produced or tested** (generalized: not only "business result").
```ts
interface Outcome { outcomeId: string; candidateId: string; observedAt: string; payload: unknown }
```
The sacred distinction: **Evaluation = what we thought. Outcome = what happened.**
Macro example: candidate "EZ core inflation 2.3% by Q2-27" → evaluation =
ensemble + backtest + analyst confidence → outcome = actual print → recursive
analysis = which assumptions failed, which model family won.

### View
Human projection/control surface over Workspace state. Semantic request, never
a React component or Dockview panel.
```ts
interface ViewDescriptor { kind: string; subject?: unknown; query?: unknown; actions?: string[]; presentation?: unknown }
```
Kinds: collection, record, document, kanban, timeline, dashboard, inbox,
chart, table, map, artifact. The Agent reasons about these; it NEVER reasons
about Dockview groups, component names, tab ids, CSS, grid widths, modals.

### Supporting kernel types (from the agent-native harvest — adopt directly)

```ts
interface ExecutionContext {
  runId: string; threadId?: string
  principal: PrincipalRef; authority: Authority
  workspaceId?: string; agentId?: string
  invocation: "human" | "agent" | "automation" | "external-agent" | "api"
  signal?: AbortSignal
  delegation?: { depth: number; visited?: string[] }
  approvalRef?: string
}
```
The system must always answer: who did this · under what authority · in which
Run · in which Thread · via which surface · was human approval involved · was
this delegated.

```ts
interface Approval { approvalId: string; principal: PrincipalRef; runId: string; target: unknown; scope: unknown; createdAt: string }
```
Approval is BOTH authority and evidence. Flow: agent proposes → human approves
→ ApprovalRef → execution. **Agents cannot invent approvals** (the
approvedToolCallKey idea, generalized; consistent with AuthorizedAgentScope
philosophy).

```ts
interface AuthorizedEnvironment { mounts: MountRef[]; capabilities: CapabilityRef[] }
```
Per-request hard allowlist (resolveActionSurface generalized): the runtime
derives the actual tool/action catalog from this; unknown names FAIL rather
than widen. Our multi-FS/resource-level model is more general than an action
allowlist — the environment is the unit, actions derive.

```ts
interface ViewContext { activeView: unknown; selectedResources: ResourceRef[]; focusedResource?: ResourceRef; workingSet: ResourceRef[] }
```
Context-awareness made semantic: "compare this to last quarter" resolves via
focusedResource — never DOM selectors or tab IDs.

```ts
interface ViewRef { workspaceId: string; descriptor: ViewDescriptor }
```
Deep links from agent results back into the human app: "Created candidate
portfolio. [Open candidate comparison]".

### Deferred nouns — single list with promotion triggers
Product (after two real verticals) · Seat-as-full-subsystem (seatId itself IS
P0 per ratification — the subsystem waits) · Process · Schema · Module ·
Navigation · Customization · DataSource · **Experiment** (promote when three
verticals need a durable experimental protocol independent of Runs — macro,
industrial R&D, marketing all have it; until then Run+Candidate+Evaluation+
Outcome represents it) · AgentState (reserved, empty) · MountSlot ·
**Computation** (see Part IV — promote when V2 needs a persisted reusable query).

---

## Part II — Semantic data & BSL (V2-04)

BSL/Data Bridge leaves "BI plugin" status and becomes platform infrastructure.

**The boundary:** `Mount = access to data. BSL = semantic reasoning/query layer
over queryable data.`

```
Postgres · Odoo · DuckDB · Files · Warehouse
        \      |      |      |      /
              Mount adapters
                   ↓
             Semantic models
                   ↓
                  BSL
            /      |       \
        Agent    View    Evaluator     ← SAME query path for all three
```

Requirements (V2-04, verbatim): same query path for Agent and View ·
authority-aware execution · existing BSL query API reused as an engine
boundary · **no BSL rewrite (not Rust, not Node)** · raw SQL remains a
privileged escape hatch.

**Per-viewer authority is mandatory in the query signature:**
`query = f(Mount, semanticQuery, Authority)` — never `f(Mount, query)`.
(Per-viewer cached results must never leak across viewers; credentials and
permissions differ by viewer.)

Semantic operations the macro vertical needs BSL to express without bespoke
Python: series (GDP growth, CPI, core CPI, policy rate, unemployment, yield
curve, FX, credit spreads) × transformations (YoY, MoM, rolling average, lag,
difference, real value, spread, index rebasing).

---

## Part III — UI thesis & Views (V2-08)

**The AI is underneath the application.** Default = purpose-built SaaS UI +
ambient agent layer — NOT persistent chat + panels. The agent appears through:
universal composer · inline suggestions · proposals · approvals · automations ·
explanations · a temporary conversation drawer. Chat-first remains one shell
option, never the universal architecture.

Sacred UX principle: **complexity appears only when the user creates
complexity.**

**Apps are Views, not the platform.** An app ≈ a domain-specific composition of
Views and Capabilities over a Workspace. CRM, mail, macro terminal, recipe
optimizer, creator studio = cheap last-mile code. Engineering time concentrates
on governance, execution, provenance, Mounts, semantic data, optimization,
evaluation, recursion, durable state — not generic CRUD UI.

Macro terminal sketch (the chat is subordinate; research objects and evidence
are primary):
```
┌────────────┬─────────────────────────────────────┐
│ Research   │ Eurozone inflation                  │
│ Forecasts  │ CPI YoY · Core CPI · Policy rate    │
│ Indicators │ Forecast scenarios                  │
│ Scenarios  │  Base 2.3% · Bull 1.8% · Bear 3.1%  │
│ Reports    │                                     │
├────────────┴─────────────────────────────────────┤
│ Ask / test a hypothesis / build a scenario...    │
└──────────────────────────────────────────────────┘
```

View hosts: `SingleViewHost` and `DockviewViewHost`. Dockview is a renderer.
Adapter path: `openView() → view resolver → renderer/panel → Dockview`.
Port as Views: BI dashboard renderers, Data Explorer, filesystem tree/editor.

Layout principle: left = intent & collaboration, right = materialized context —
a good default, NOT the ontology. Variants: desktop persistent team pane,
tablet floating agent, mobile bottom composer, command bar, automation with no
conversation UI. The data model never assumes one permanent primary chat agent
(left side may become Team/Participants).

---

## Part IV — The agent-native harvest (what to take, what to refuse)

TAKE (each already reflected in Part I types or here):
1. **Define work once, project to surfaces** → Capability. The strongest lesson:
   *"Define the real work once, keep invocation identity/authority attached to
   it, and let humans, agents, automations and other agents reach the same
   governed operation through different surfaces."*
2. **Provenance in context** → ExecutionContext (their ActionRunContext, cleaned).
3. **Approval lineage** → Approval/approvalRef; agent loop generates trusted
   approval metadata; agents cannot mint it.
4. **Hard per-request capability surfaces** → AuthorizedEnvironment; outside
   the list = invisible to model schemas AND execution failure.
5. **Effect classification** → observe/propose/mutate/external-effect
   (generalized from their read/write/unknown plan-mode).
6. **Deep links** → ViewRef in agent results.
7. **Context-awareness** → ViewContext (semantic, not browser).
8. **Data Programs → future `Computation`**: agent does ad-hoc analysis →
   useful computation discovered → persisted → rerun automatically → Views
   bind to it → other Threads reuse it. (Macro: "financial conditions impulse";
   industrial: supplier-cost normalization.)
   ```ts
   interface Computation { computationId: string; inputs: MountRef[]; query: unknown; parameters?: unknown; outputSchema: unknown; provenance: unknown; refreshPolicy?: unknown }
   ```
   **BSL computations are provider #1.** Deferred until a vertical needs a
   persisted reusable query — do not create the noun early.
9. **Dry-run before persistence** — GENERAL boring principle for everything
   agent-generated (View, Evaluator, Computation, Workflow, AgentDefinition):
   `propose → validate/sandbox → test → persist/promote`. Never
   `generate → production`.
10. **Stale-good over blank failure** — distinguish cache freshness /
    background computation / stale result / execution failure. Dataset refresh
    fails → show last-known-good + stale marker. Evaluation generation fails →
    incumbent agent remains active. **Never replace a known-good incumbent
    until the challenger proves itself.**
11. **Per-viewer credential/data semantics** → the Authority-in-query-signature
    rule (Part II).

REFUSE (deliberate divergences):
- Action as the center — our center is Workspace/Mounts/Objectives/Evidence/
  Capabilities → Runs; actions are one layer.
- SQL-backed app state as the durable base — Mounts are more general and suit
  sovereign/private environments (files, Postgres, BSL, lab data, market data,
  customer VPC).
- Their chat → inline UI → full-app ladder as the conceptual ladder — ours is
  purpose-built View + ambient agent, chat optional.

---

## Part V — Clean-by-construction rules for the port
*(NEW — this session's five-framework study turned into day-one rules for
boring-v2. In the old repo these are remediations; in v2 they are how code
enters at all.)*

From **DeepSeek Harness** (dsh):
- **"Model-visible means logged"** is a kernel invariant from commit one; the
  event catalog is GENERATED from source declarations and CI-verified, with a
  surface/log-only event split. No ungenerated catalog ever exists.
- **A capability seam ships Owner + Implementation + Consumer in one change** —
  the port's PR rule. v2 must never accumulate the old repo's dead seams
  (collision policy, credential vault).
- Defensive patterns as lint: spawned commands get a scrubbed env
  (**allowlist**, not their denylist — theirs misses VAULT_ADDR/AWS_*/GH_*),
  with `direct`-mode's gh/git HOME inheritance as an explicit declared
  exception; 0700 temp dirs, `wx`+0600 opens; no recursive delete without
  lstat symlink check; orthogonal outcome reporting (timedOut/signal/exitCode
  each on its own); teardown closes registries BEFORE killing children then
  awaits exit.
- Profiles/bundles/patch layers as the composition/customization mechanism —
  defaults and overrides are the same mechanism at different layers.

From **Flue**:
- Storage injected by the host from day one (the pi seam is proven at pinned
  0.80.7); pi never owns durable state in v2.
- **Physical durability shard = the session/thread**, agent ownership is
  logical. Never a per-agent WAL.
- Fiber/settlement/incarnation vocabulary for in-turn checkpointing; the
  accepted-work contract (admitted-before-invocation; at-least-once execution,
  exactly-once terminal recording; recorded results never rerun;
  `unknown-outcome` for unresolved ordinary effects) is the Run lifecycle.
- Channels are NOT à-la-carte transports: boring owns identity mapping, grants,
  session addressing, inbound idempotence, outbound retry/dedup,
  channel-answerable pauses. Channel adapters only verify webhooks/payloads.
- Config/schema compatibility: reject incompatible persisted versions rather
  than handing bad state to an agent; drain by configuration revision.

From **eve**:
- Tool-mount namespace with **immutable override vocabulary**: disable / alias
  / trusted-host wrap / replace-with-already-admitted-reference — compiled
  into an immutable binding. No order-based shadowing can exist in v2 (the old
  repo's first-wins `extraTools` spread is un-portable by construction).
- **Provided arguments are host-bound and session-snapshotted**: tenant,
  workspace, resource, payer args are never model-selectable; config is
  versioned and fixed per session (prevents confused-deputy and replay drift).
- Durable pause (`input.requested`/`session.waiting` style): human input and
  OAuth are first-class waits keyed by request ID — tool-independent,
  channel-answerable, with denial/expiry and one-shot approval capabilities.

From **opencode**:
- Bounded catalog: summary-level capability exposure (~2.9k bytes for 40 tools,
  measured) beats both all-resident (10.3k) and search-per-task (extra round
  trip, decaying advantage).
- Code-mode with **pre-call authorization**: first-class child events,
  immutable post-validation plans, invocation-scoped authz. Post-hoc identity
  logging alone is REFUTED (the spike) — identity lives in the record AND
  authorization precedes the child call.

From **Cloudflare Think**:
- Abort–record–replay approval: abort generated code at the first unapproved
  action, record completed calls, replay by stable position, apply only the
  approved action. The C2×C5×C6 mechanism; needs a spike before adoption.

From this session's own failures (equally binding):
- **Mutation-test every "structural" claim** — 17 green tests survived deleting
  the constraints they claimed to test. A control is convention until a
  mutation test proves CI fails without it.
- **Stable-prefix rule** for any state→delta translation: emit only the prefix
  before the last unsettled message (reconnect correctness).
- **Docs never precede implementation** — the entire G16 episode (23
  convention-only controls documented as guarantees).
- No authority inferred from ambient env (`NODE_ENV` lesson); admission policy
  is handed into the funnel by the host.
- Recovery equality only at safe checkpoints; snapshot caches carry a replay
  budget (checkpoint every N events).
- Kill-9 chaos test in CI from the first ported runtime, with a recovery-time
  budget.
- Hub transport: multiplex (WS/h2) from day one; durable subscription
  reconstruction; never per-tab detection (6-connections-per-origin lesson).
- celld/isolate feasibility gates if ever revisited: cold-start budget
  (measured 435ms vs 4ms advertised), credential injection (empty
  `process.env`), secret semantics, fleet topology.
- pi 0.80.7 constraints: no MCP client (client stays boring-side), no stable
  seq (kernel owns canonical seq); pi upgrades pass a conformance gate.

---

## Part VI — The quarry (verbatim green/yellow/red)

**GREEN — port almost directly:** boring-sandbox · boring-bash · runtime
provider adapters · runtime filesystem bindings · large parts of AgentGateway ·
AgentHost execution internals · Pi harness · metering primitives
(`AgentMeteringSink`: reserveRun/recordUsage/settleRun/releaseRun,
credit-micros) · UI kit · host-issued authorization philosophy.

**GREEN/YELLOW — port behind a new boundary:** share entries →
Resource/Artifact implementation (AR1's opaque id + workspaceId + path +
provenance already solves ResourceRef; finish AR1-003 `/a/<id>` + AR1-004 MCP
exposure old-side first) · Data Bridge + BSL → semantic data infrastructure ·
BI dashboard renderers → Views · Data Explorer → View · Dockview →
DockviewViewHost · filesystem tree/editor → Views/Navigator · auth/security/
core DB primitives · plugin domain logic.

**RED — never crosses:** old panel/surface public API · Dockview-as-workspace
semantics · current workspace plugin ontology · giant composition roots ·
playground glue · duplicate app boot paths · "full-app" as architectural
concept · legacy convenience APIs duplicating new semantics.

Migration rule: compatibility may exist at storage/provider boundaries, but
NOT as two competing conceptual APIs.

**Rename at port time:** agent-package `Workspace` (filesystem/execution
state) → **`RuntimeFilesystem`**. `Workspace` is reserved for the governed
world.

Repo shape and dependency direction:
```
boring-v2/
  packages/ kernel · agent · runtime · workspace · data · views · ui
  experiments/ creator · optimization-benchmark · commercial-discovery
  benchmarks/ recursive-optimization · evaluator-quality

kernel ← {agent, workspace, data} ← views ← app     (enforced by lint)
```

---

## Part VII — Roadmap, research, autonomy, GTM (operational detail)

**V2-00..13** as in the owner doc, with our integration: V2-01 port order =
sandbox/bash/gateway/host/pi/adapters/fs-bindings, goal
`await runtime.run({agent, input})` with no Workspace UI/Dockview/plugins;
V2-02 Run+Authority = C6+A7+A8 ported; V2-03 Mount extraction; V2-04 BSL
(Part II requirements); V2-05 Workspace; V2-06 Thread; V2-07 optimization
records (JSON payloads fine); V2-08 Views + two hosts; **V2-09 benchmark**:
deterministic ground truth (supplier allocation / factory scheduling /
portfolio allocation / constrained recipe), compare baseline heuristic ·
LLM one-shot · agent+tools · agent+semantic-data · agent+previous-outcomes ·
recursive agent, measuring quality, iterations, inference cost, human burden,
latency; **V2-10 first challenger loop**: meta-agent proposes changes ONLY to
instructions/tool-selection/model-routing/reasoning strategy — never repo
rewriting, destructive schema mutation, uncontrolled production changes,
autonomous infra — benchmark incumbent vs challenger, promote only if
independently better; V2-11 first vertical (creator growth — shortest
feedback); V2-12 second structurally different vertical (macro / industrial
formulation / portfolio / SME GTM); V2-13 only then extract Product.

**Research program:** H1 agents generate useful candidates · H2 explicit
objectives/evaluators discriminate · H3 human+world feedback improves later
generations · H4 improvements reuse without collapse · H5 one vertical pays.
Scorecard: solution quality, learning efficiency, economic efficiency, human
burden. Kill criteria: recursion ≤ non-recursive baseline · feedback cannot
become reliable evaluation · users like output but won't pay · abstractions
need domain exceptions everywhere · human burden stays high · outcome value
doesn't justify inference+acquisition cost.
**MVP:** user operates an optimization workspace end-to-end and a subsequent
Candidate/Agent version measurably outperforms; several customers repeatedly
pay. **Key metric: second-cycle completion rate.**

**Autonomy ladder** (internal commercial-discovery workspace is customer #0;
mounts: Reddit, web, analytics, Stripe, CRM, GitHub, ad platforms, creator
lists):
```
L0 agent recommends, human executes
L1 agent builds, human approves launch
L2 agent launches under fixed budget, human approves scaling
L3 agent kills/iterates automatically inside budget
L4 system allocates portfolio capital under human strategy/constraints
```

**GTM:** two engines (commercial: current Boring, one concrete outcome, 5
design partners, concierge OK, charge early, record objections/customizations/
approvals/outcomes as V2 research input · platform: kernel+research).
Allocation ~50-60% V2/research, 30-40% customers/sales, ~10% current-product
fixes. Creator pitch example: *"A private AI growth system built around your
content, analytics and goals. It learns what you approve, measures what
performs and improves what it recommends next."* Creator flywheel (expertise →
product → audience → users → evidence → better product → earnings →
distribution) deferred until the loop is proven.

**Recursive moat ladder:** one user customization → repeated successful
pattern → workspace/product improvement → vertical intelligence → platform
primitive. Reusable improvements: AgentDefinitions, evaluators, BSL metrics,
workflows, Views, semantic models, agent topology, computations, capability
policy.

**Sovereignty:** Boring owns memory, context, data, optimization history,
policy, evaluation, recursive intelligence. Model providers = replaceable
inference. Cloud planes (control/data/execution) may be one process today;
preserve the boundaries, build nothing.

**Data separation:** CONTROL data (auth, memberships, billing, workspace
registry, authority) ≠ APP/WORKSPACE data (domain records, files, artifacts,
processes, indexes) ≠ AGENT EXECUTION (replaceable sandbox). Authoritative
customer data never lives inside one agent runtime.

**Future customization** (deferred): semantic/declarative over agent-rewritten
React; inheritance Platform → Vertical → Product → Workspace → User.

**Non-goals now** (full list): marketplace · creator revenue sharing · custom
domains · universal app generator · generalized A2A network · full cloud
scheduler · Kubernetes abstraction · multi-region · arbitrary persistent
processes · universal schema builder · destructive autonomous schema mutation ·
autonomous trading · autonomous large ad budgets · self-modifying production
repo · generic Product DSL · Rust BSL rewrite · universal Mount · full
cross-tenant recursive learning · platform-wide AgentState.
