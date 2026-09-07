# Reassessment: from agent runtime to expert-created software

> **CONTEXT — ruled 2026-09-07.** The findings below led to RECONCILIATION §13
> and DECISIONS D33; they are kept as the record of *why*, not as authority.
> Where a "proposed correction" here differs from §13, §13 wins. Source labels
> refer to [the coverage register](COVERAGE_AND_SOURCES.md).

Assessment baseline: `4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6`.
PR base reconciliation: `aaa713a19cd4a4236a27f96b5c3eb77261a15ebb`.
Workspace Evolution: separate draft #1548 at
`cb6b476aefb8d8fb3b1395a72a006264f5326d8d`.

## 1. The gap is the complete product journey

The documents already contain much of the intended vocabulary: independent
agents, Seats, durable work, semantic Views, operations, evaluation, outcomes,
and reusable expertise. They even record a new-repository, interface-first port
strategy. The problem is not lack of ambition or a need to invent all of those
ideas again. [S01–S05]

The M0–M8 sequence starts with kernel contracts, headless execution, and an
optimization loop. Standalone `npx`, an Agent App, hosted teams, benchmarking,
and a second vertical precede Product extraction and creator publishing at
M8. Earlier hosting may be manual/concierge. That sequence can succeed while
leaving the founder responsible for implementing every expert's change. [S03]

**Proposed correction:** private creation, release, installation, adaptation,
and maintenance become the first complete product obligation. Public discovery
and marketplace economics remain later. Installing a private product is not
synonymous with launching a marketplace.

A useful job may be ordinary deterministic work, a human-directed change, or an
optimization experiment. Evidence should be available in each case, but an
explicit Objective/Candidate/Evaluation/Outcome loop is not compulsory for every
retained user preference; the later vision amendment already limits that
universal interpretation. [S02, S05]

## 2. Existing mechanisms are assets, not a complete installation model

### Fleet and operation composition

Decisions 28/29 select deployment-static agent fleets and prohibit the earlier
registry/publication-controller architecture. The plugin contract describes
trusted boot-time server contributions, local generated resources, and a
revision number used for frontend import/cache invalidation. It explicitly
separates that local tier from unimplemented hosted external-code support.
The WorkspaceBridge likewise requires trusted registration of host operations.
[S06, S08, S09]

The prohibition is older and wider than Decisions 28/29. Decision 25 rejects
the AgentHost/controller/publication/content-addressed-store path and states
that immutable identity does not imply a publication store; Decision 30 says
journaled multi-host publication needs a new decision amending 25/28. The
architecture plan's D-b ruling makes the untrusted tier (C4) the only ratified
home for authored code, with **server disabled**, and P0.6 refuses
`boring.server` modules from agent-writable roots. Any amendment must name
D25, D28, D29, D30, D-b, and P0.6 together, not D28/D29 alone. [S04, S06]

Code and documents disagree here, and the disagreement is load-bearing.
`packages/workspace/src/server/runtimeBackend/` dynamically imports external
plugins' `boring.server` modules into the host Node process and dispatches
them through `/api/v1/plugins/:pluginId/*`, wired without a flag in
`createWorkspaceAgentServer.ts`. The plugin contract's non-goals still list
"hot-registering Fastify routes from generated plugins" as excluded. The
generated backend path therefore exists today in the least acceptable form:
in-process, under host authority, with a workspace-id header check as its only
scope. Declaring the lifecycle without ruling on this path would leave the
security ground truth unchanged. [S08, S20]

These mechanisms provide useful composition boundaries. They do not by
themselves establish immutable effective software releases, scoped customer
installations, durable activation, or private/upstream reconciliation.

**Proposed correction:** one trusted installation/activation path resolves
versioned released contributions. The author declares requirements; an
authorized installation binds resources and grants. Generated private code
runs under the supported isolation contract, not by secretly registering itself
as globally trusted host code. This requires explicit amendments to the
static-only prohibition; renaming a mutable registry a plugin setting is not a
solution.

### Seats

The pinned source includes durable `workspace_agent_seats` with a `seat_id`,
workspace/agent enrollment, source, and uniqueness per workspace/agent pair.
The Seats plan explicitly excludes dynamic deployment, release pinning,
active-generation reconciliation, and rollback history. [S10, S11]

Do not claim Seats are wholly missing. Do distinguish workspace enrollment,
job participation, installation, and effective software version. They need not
be four services, but one relation must not silently answer all four questions.
Decision 32 preserves additive specialist enrollment and names primary-composer
and multi-specialist-bundle changes as re-evaluation triggers. Product UX need
not dictate an unrelated workspace default. [S06]

### Thread and Session

RECONCILIATION §9a settles the value root: a Thread is one durable job and binds
zero or more Sessions; a Session is one runtime conversation. The baseline v2
specification still has a `// = session` example. Its newer ruling wins, but
the example is a real implementation hazard. [S03, S05]

This PR corrects that example, its immediate port wording, and the matching
per-session shorthand in the Port Handbook's Thread entry. It does not
choose first-class Thread stream versus projection storage, implement the
binding, or add a competing Job store. Customer language can say Job while the
existing Thread identity remains authoritative.

## 3. The proposed central layer has four responsibilities

These are lifecycle responsibilities to fit to existing contracts, not four
new kernel entities or four microservices approved by this proposal.

| Responsibility | Meaning | Must not be confused with |
| --- | --- | --- |
| Effective release | Immutable identity of behavior, UI/operations, dependencies, relevant state compatibility, and applicable evidence. | A cache-busting revision, running sandbox, or billing offer. |
| Installation | Authorized personal/shared scope, selected release, resource bindings, local choices, and active generation. | User identity, workspace membership, or a Seat alone. |
| Job | Current inputs, working set, participants, decisions, outputs, and effective version for one unit of work. | Chat history, a tab, or every underlying domain record. |
| Change | Requested modification, intended scope/base, candidate artifacts, checks, preview, activation, and recovery. | A required optimization Objective or implicit permission to publish. |

A release may assemble separately loaded behavior, operation, UI, and evaluation
contributions. They share an effective identity but need not become one giant
cross-process JavaScript object. Loading a UI contribution must not itself
start an agent, grant resource access, create a schedule, or admit work.
Dependencies, state namespace, teardown, and serving ownership must be explicit.

The interface must distinguish three requests even when they use one composer:
“improve this output,” “change my future jobs,” and “improve the shared product.”
Operating work, changing software, maintaining downstream variations, and
benchmark-driven optimization have different completion conditions.

A software change can be kept because the user prefers it. A claimed quality
improvement needs appropriate evidence. A private adaptation does not silently
become a shared product release; publication does not silently activate other
installations.

## 4. Domain agents and software builders have different needs

The Port Handbook's renderer prohibition is sensible for a tutor or analyst:
those agents should use semantic resources and actions, not tab IDs and CSS.
Applied to all agents, it conflicts with a builder tasked with changing the
interface itself. [S07]

**Proposed amendment:** domain agents remain semantic consumers; scoped software
builders can inspect and change renderer code, CSS, operation implementations,
and tests needed for the requested software change. Their scope does not
include platform authority or protected evaluation controls. This is an
explicit narrowing of the blanket rule, not permission for every domain agent
to manipulate the application internals.

Similarly, defer a universal Product DSL or general workflow/schema designer,
not the minimum release/install/change contracts required by the first product.
The shortest working lifecycle should shape abstraction, rather than all
future nouns being prerequisites for its first useful preview.

## 5. Job-first experience, not mandatory console-first navigation

The ratified shell is a valid flagship Experience, and later rulings already
permit other product surfaces. The entry-point reading route and shell pack
nevertheless organize much of the program around Search, Inbox, Work, Agents,
and Library. [S01, S05, S12]

For an expert product, opening a job should restore its useful canvas. A
student need not navigate an operator roster to resume a learning task. Domain
records and knowledge can participate in many jobs; they should not be copied
merely because a job starts or a layout changes.

Views, operations, subscriptions, delayed results, and pending decisions need
explicit job/resource bindings. Selecting job B must not retarget work admitted
for job A. Closing a chat drawer must not cancel server work or make a required
decision unreachable. A failed generated UI must leave independent recovery
and decision access available.

The same distinction applies to collaboration. Multi-author display and
thread naming conventions do not prove message delivery. A real team job needs
authenticated participants, addressed settled posts, defined wakeup/admission,
deduplication, recovery, and visible status. The current no-A2A/shared-runtime
boundaries remain in force pending an explicit amendment. Do not introduce a
second agent-mail authority merely to bypass an inadequate relay. Keep the
single-agent path lightweight. [S05, S12]

## 6. Factory is an implementation engine, not the curator's workflow

The September 7 delivery procedure broadens automatic eligibility while
reserving protected boundaries for the owner. It explicitly says the broader
path is not yet enabled; the inspected policy still contains the older
path-allowlist/300-line predicate. That is acknowledged rollout work, not proof
of operational autonomy. [S13–S15]

Implement approved automation through its existing rollout gates. Do not treat
this new proposal as permission to change policy, bypass reviews, fabricate an
approval, or enable merging. Nor should the curator have to operate Beads,
worktrees, exact-SHA builds, or PRs. Those can remain internal engineering
mechanisms behind an authoring job.

A Factory gate that requires the founder to approve every private adaptation
has moved the bottleneck, not removed it. The proposed installation authority
should permit appropriately delegated private changes while keeping shared
platform powers and other tenants outside the builder's reach.

## 7. Replace the failing boundary before choosing a total rewrite

The older vision already permits a new repository, selective ports, and
product-by-product cutover (ruling R-a, 2026-08-16). Incumbent maintenance is
compatible with that strategy. DIRECTION is the single declared sequencing
authority and it has never scheduled the v2 port: the K-track, M0–M8, and
V2-00..13 orders are ratified dependency rationale, not dispatched work, and
DIRECTION's only v2 line says Wave 4 stays frozen. The gap is not competing
authorities; it is that no execution home for the new journey is named
anywhere DIRECTION can dispatch from. `hachej/boring-v2` does not resolve for
the repository owner's token and no local worktree or port exists; nothing has
been ported. [S01–S04, S21]

Compare three options against the same end-to-end journey: extend current
composition; replace lifecycle/composition and UX while retaining suitable
runtime mechanisms; replace the runtime too. Probe the uncertain boundaries,
not three complete systems. Record actual coupling around release identity,
installation, persistence, resource authority, generated operations, recovery,
serving isolation, and migration.

**Current recommendation, not a demonstrated bake-off result:** replace or add
the product/evolution/installation layer and job-first experience, retaining
runtime mechanisms where their conformance supports the journey. Replace the
runtime when evidence shows its coupling prevents a maintainable result.
Neither preserving every plugin nor rewriting everything is the objective.

Evaluate an exact candidate Pi/runtime version against required behavior and
migration cost. An old pin, past failed spike, or a promising release name is
not the decision. No current upstream capability or version claim is made here.

Git can hold source and ancestry; artifacts hold builds; installation state
holds active versions and bindings; customer data has its own lifecycle. A
user is not a branch. A builder sandbox is not the permanent product host.
Destroying that environment must leave the installed product reconstructible
and customer work intact.

## 8. Evidence, models, economics, and commercial scope

The repository already has an evaluation and recursive-improvement agenda.
The immediate contribution is connecting trustworthy evidence to the exact
installed behavior that performed a job, not merely adding another benchmark
proposal. [S02, S16]

Record effective release, input identity, task protocol, suite/checker version,
result, acceptance/outcome, and permitted reuse. Keep worker-editable examples
separate from protected checks. A changed fork must not automatically inherit
an evaluation claim. Completion, measured quality, observed business outcome,
and billing remain distinct. Private corrections are not automatically shared
benchmarks or training data.

A deterministic mathematics check and an expert rubric can validate a bounded
product's behavior; they do not prove learning gains. A nontechnical curator's
successful adaptation is usability evidence, not broad market validation.
Specialist models require adequate authorized evidence and measured total
cost/quality benefit; owned compute requires actual operating economics. None
is a prerequisite for the first private product.

Research notes explicitly flag unverified references; do not turn their
numbers into external claims without primary-source verification. Existing
credit-launch prices describe a particular offer, not the strategy for every
expert. Preserve payment invariants while keeping Seneca pricing, creator
agreements, and revenue sharing separate from neutral release/usage contracts.
[S16, S18]

## 9. Success is founder-independent useful change

The principal measure is founder intervention per accepted, retained expert
adaptation, including why intervention occurred. Count the entire attempted
population, not just selected successes. Also record preview latency, correct
job completion, human repair effort, total creation/evaluation/execution cost,
retained use, upgrade/conflict burden, recovery, isolation, and evaluation
applicability.

The first proof fails when a required backend change goes back to the founder;
installation still requires global application redeployment; destroying the
builder loses the product; job switching retargets delayed work; an update
silently loses private choices/data; or a demo hides manual engineering steps.
A configuration-only success earns its own credit, not closure of the entire
creation obligation.

The [proposed amendment map](DOCUMENT_AMENDMENTS.md) connects these changes to
existing work. The [pack index](README.md) preserves unresolved consumer,
autonomy, update, and execution-home choices. This assessment does not certify
security, production reliability, privacy compliance, educational efficacy,
benchmark novelty, or business economics.
