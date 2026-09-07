# Amendment record and implementation handoff

> **APPLIED — 2026-09-07.** The rulings were recorded as RECONCILIATION §13 and
> DECISIONS D33 (with dated addenda on D25/D28/D29/D30 and banners at every
> superseded site in VISION, ARCHITECTURE-PLAN, V2-IMPLEMENTATION-SPEC and
> V2-PORT-HANDBOOK), and sequenced by the DIRECTION amendment of 2026-09-07.
> §1 below is the suggested text as it stood before ruling; where it differs
> from §13 (notably: three layers and runtime modes instead of "one trusted
> path resolving contributions dynamically"; execution home = this repo;
> first consumer = Seneca math tutor), §13 wins. §2 is now a record of where
> each edit landed.

## 1. Suggested ruling text

The following clauses require explicit adoption and supersession through the
existing decision process. They do not become operative just because this
proposal is in the repository.

### Product obligation

Seneca supports creating, using, changing, installing, and maintaining expert
software from within Seneca. Software authoring is itself a job. The expert
supplies intent, methods, examples, judgment, and authorization; the platform
performs the engineering. A founder-mediated code session, manual package
publication, or global host redeployment is not an acceptable hidden step in
the initial complete acceptance journey.

That journey includes one private product, an effective immutable release,
installation for a separate consumer, a retained method/UI change, and supported
upstream/private reconciliation. A useful capability absent from the starter
catalog is created through the generated-code path before claiming general
software creation. This includes a backend/domain operation, not only React.
Public marketplace infrastructure and broad commercial distribution remain
later; private installation does not wait for them.

### Installation and authority

A single trusted, scoped installation/activation path may resolve immutable
released contributions dynamically. This explicitly narrows the deployment-
static-only and blanket publication-registry prohibitions in Decisions 28/29.
It does not restore a second authorization path, arbitrary runtime-registry
writes, self-granted capabilities, or the old controller by stealth.

A release declares requirements. An authorized installation binds resources
and grants. Execution remains authorized under the actor, installation, job,
and current policy. Entitlement to software does not grant unrelated workspace
resources. Publication, installation, activation, and commercial launch are
separate acts with separate receipts.

A curator or organization may establish standing authorization for private
changes within an explicit scope and budget. The founder is not the default
approver. Shared platform policy, protected checks, other tenants, and powers
outside that installation remain excluded. The precise default between
standing authorization and preview/Keep remains an owner decision.

### Product and runtime semantics

Thread remains the durable job root and binds zero or more Sessions. Product
language may call it Job; no parallel Job authority is introduced merely for
naming. Workspace enrollment, job participation, installation, and effective
release identity stay distinguishable.

Domain agents use semantic resources and actions. Authorized software builders
may inspect and create renderer code, CSS, domain operations, and tests needed
for a change. This narrows the Port Handbook's blanket renderer prohibition;
it does not expose implementation concepts to every domain interaction or
allow the builder to rewrite protected evaluation/authority controls.

Additive specialist enrollment remains valid. An installed product may select
its primary Experience/agent without silently changing unrelated workspace
defaults, identity, or membership. Any bundle or removal lifecycle needs its
own explicit contract; Decision 32 is not silently rewritten by presentation.

### Change, data, and evidence

Operating work, user-directed software change, downstream maintenance, and
benchmark optimization have different completion conditions. A software
candidate can exist without an optimization Objective. These flows reuse the
accepted-work/artifact/evidence machinery where appropriate instead of creating
competing execution authorities.

Activation is durable, versioned, scoped, and checked against its base. Undo
changes software activation; it does not erase domain records, reverse an
already completed effect, or undo disclosure. Admitted work remains attributable
to its release and inputs, subject to current revocation and supported migration.

Evaluation identifies the exact effective release, input identity, protocol,
suite/checker revision, and result. Completion, quality, observed outcome, and
billing are distinct. Private use, shared improvement, external benchmarking,
and training require the corresponding authorized use. A changed fork cannot
inherit an inapplicable quality claim.

### Execution home and cutover

Name one implementation home and one delivery sequence. Reconcile existing
R-a successor material with incumbent maintenance and #1548. Retain or port
mechanisms that pass the required journey; replace those whose demonstrated
coupling prevents it. Repository choice is an engineering decision, not a
product objective. Preserve valid customer data, authority, and histories
through supported cutover.

## 2. Edit map — where each ruling landed

Applied by PR #1561 (rows below describe the target; the dated banner or
section at each site is the authority). PR #1548's §11/§12 were merged first;
§13 follows them.

| Target | Proposed amendment |
| --- | --- |
| `docs/README.md`, `docs/vision/README.md` | Lead the adopted product story with create → install → use → adapt → maintain; distinguish current implementation, proposal, successor home, and incumbent obligations. This PR only adds a proposal pointer to the index. |
| `docs/plans/long-term/ratified/VISION.md` | Amend the Product deferral (R-e), the K7→K9 creator-publication timing, invariant 10 ("never live self-rewriting") and invariant 4 (renderer prohibition) where they block private creation; separate ordinary software change from benchmark recursion. Reconcile R-a's repository/cutover instruction. Keep public marketplace, "universal app generator", and cross-tenant learning non-goals explicit. |
| `docs/DECISIONS.md`, D25/D28/D29/D30 | Permit one trusted versioned installation/activation path while retaining one authorization/construction funnel, current membership/resource checks, accepted-work identity, and revocation. State exactly which prohibitions are superseded, naming D25 (publication store), D28/D29 (static fleet, no registry), and D30 (journaled publication needs a decision amending 25/28). Record as a new numbered decision with all four fields. |
| `docs/DECISIONS.md`, D32 | Retain additive enrollment; specify product-selected primary UX and bundles without rewriting platform identity or unrelated workspace defaults. |
| `docs/plans/long-term/ratified/RECONCILIATION.md` | Record the adopted clauses and explicit supersessions; retain §9a cardinality and distinguish storage shape from value-root meaning. Coordinate numbering and scope with #1548. |
| `docs/plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md` | Pull bounded private release/install/evolve into the first complete journey; make standalone npx an optional consumer, not a universal predecessor. Separate neutral release definitions from Seneca offers. This PR only repairs the stale Thread example and its immediate session-port wording under existing §9a. |
| `docs/plans/long-term/ratified/V2-PORT-HANDBOOK.md` | Distinguish domain semantic interfaces from builder implementation access. Amend the deferred-noun list (Product, Customization) and the "future customization: declarative over agent-rewritten React" deferral to admit the first product's release/customization contracts; do not require all future nouns before a useful product. The per-session Thread shorthand is corrected by this PR. |
| `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md` | Preserve dated authority/recovery/migration evidence. Amend D-b ("untrusted tier: server disabled") and P0.6 to admit brokered, installation-scoped generated operations, or state that the first journey's backend half runs elsewhere; this is the hardest conflict in the pack. Make older sequencing clearly subordinate to the adopted DIRECTION amendment. Revalidate old source findings before treating them as current defects. |
| `docs/direction/DIRECTION.md`, `docs/roadmap/README.md` | Publish the one creation-first executable sequence, precise prerequisite evidence, execution home, and bounded incumbent maintenance lane after adoption. Re-rule the 2026-08-27 Horizon split, which placed "packages/distribution" tenant-side: private release/installation identity is platform substrate; offers and pricing stay tenant-side. Do not dispatch from this proposal. |
| #1548 `docs/plans/native-creation/LIFECYCLE.md`, `docs/vision/software-model.md` | Retain lifecycle/state/scope/upgrade work. Connect E0–E6 to initial creation and separate-consumer installation. E1a configuration proof is not full creation; new-code and maintenance retain their distinct acceptance bars. |
| `docs/plans/multiagent-shell/`, `docs/plans/workspace-agent-seats.md` | Keep Meridian as a consumer recipe and preserve durability/attribution requirements. Distinguish enrollment, job participation, installation, and release binding rather than rebuilding Seats. |
| Package plugin/bridge contracts | First, repair the existing drift: `PLUGIN_SYSTEM.md` §7 lists hot server routes as a non-goal while `runtimeBackend/` serves them unflagged. After implementation, document contribution identity, installation scope, dependencies, generated-operation isolation, activation, teardown, and serving. Do not describe proposed hosted capabilities as shipped. |
| `docs/PROJECT_ENVIRONMENT_MODEL.md` | Reconcile proposed vocabulary with selected Job/Installation semantics and retain stable execution/lease separation; avoid unnecessary new global entities. |
| `docs/factory/`, `docs/procedures/boring-loop.md`, `.agents/factory/policy.yaml` | Keep the already-approved rollout separate from new product-native evolution. Expose engineering through authoring jobs, not a curator-operated Git/Beads workflow. Policy/control changes still take the owner route. No changes to these files are made here. |
| Research, credit-launch, web/visual guides | Preserve dated evidence, payment correctness, and useful mechanisms; separate external empirical claims and Seneca commercial policy; update implemented lifecycle guidance only when true. |
| Archives, issue records, transcript imports, proof assets | Preserve history. Promote facts needed by canonical docs without bulk deletion or treating historical proposals as current instructions. |

## 3. Crosswalk: amend existing work, do not add another roadmap

| Existing work | Proposed disposition |
| --- | --- |
| M0 kernel-first | Narrow to identities/contracts needed by the first journey and enforceable dependency boundaries. |
| M1 durability/accepted work | Retain actual recovery and attribution obligations; demonstrate behavior rather than just declaring conformance. |
| M2 optimization | Pull evidence/example capture early; keep recursive optimization separate from retaining a user preference. |
| M3 standalone npx | Optional consumer; need not precede native Seneca creation. |
| M4 Agent App/Views | Pull the bounded job canvas and domain-state-independent rendering into the first product. |
| M5 hosted teams/control plane | Pull necessary authentication, separate-consumer installation, and resource boundaries early; defer unrelated operator/fleet breadth. |
| M6 benchmark/challenger | Attach versioned evidence early; broad benchmarking/automatic optimization needs separate proof. |
| M7 second vertical/cloud | Use the second live domain to test generality; do not make owned-cloud completion its prerequisite. |
| M8 Product/distribution | Pull private release/install/adapt/update early; public marketplace remains later. |
| #1548 E0–E6 | Reuse its design and separate proof levels. Do not duplicate its engine, treat fixtures as live consumers, or close its runtime work from this docs PR. |
| Factory/shell | Coordination and operator consumers, not mandatory product UX or substitutes for nontechnical curator proof. |

## 4. Replacement and migration obligations

Probe the uncertain contracts for extension, selective replacement, and runtime
replacement against the same journey. Do not build three complete systems.
Select one path and record retain/adapt/replace/delete decisions with evidence.
Every temporary adapter has an owner and removal condition. Requalify exact
runtime/provider versions; old plans are not current conformance.

Preserve source records, memberships, paid entitlements, valid history, job
results, and known links. Quarantine unknown bindings instead of guessing.
Introduce a bounded private cohort while incumbent customers continue on the
incumbent until their migration is proven. Two paths must not independently
own the same activation or domain record.

Code versioning is not data versioning. State-schema or operation-meaning
changes require supported compatibility/migration, not an unexamined pointer
flip. Publication does not equal adoption; a merged PR does not equal a
published or useful customer product.

## 5. Failure-first acceptance

| Scenario | Required evidence |
| --- | --- |
| Two builders start from one base | Stale activation rejects or explicitly rebases; no lost private change. |
| Crash or lost acknowledgement around activation | One consistent durable activation receipt after restart/retry. |
| Builder environment disappears | Installed product is reconstructible; work and domain data survive. |
| Generated module fails | Independent recovery and pending-decision access remain reachable. |
| Novel UI needs a backend operation | The operation is generated, checked, and served through the supported lifecycle; a manual host edit fails the milestone. |
| Job selection changes during work | Late output stays attached to the original job, resources, and release. |
| Upstream update conflicts with local intent/schema | Compatibility checks catch it; precise conflict or supported migration, not silent overwrite. |
| A fork changes tested behavior | Inapplicable evaluation claims are rejected or clearly invalidated. |
| Builder can edit/access protected checks | Evaluation is not independent; no successful proof claim. |
| Private correction is proposed for reuse | Authorized export, separate maintainer integration and separate downstream adoption; no private data leakage. |
| Change affects authorization or completed effects | No fabricated approval, widening of scope, or claim that UI undo reverses disclosure/effects. |

## 6. Handoff and remaining decisions

The first proof consumer, default private-activation policy, upstream-adoption
policy, and existing successor ownership are unresolved as recorded in the
[pack index](README.md). Do not manufacture answers from the request to create
a PR. The proposal favors a mathematics technical tracer and selective
lifecycle/composition replacement, but neither is recorded as a new owner ruling.

Before implementation, reconcile #1548, adopt the selected clauses through the
ratified decision process, update DIRECTION once, map the useful slices into
existing work, and obtain the proof/review required for the actual revision.
This document creates no scheduler, new authority, production capability, or
permission to merge, deploy, migrate, delete, or broaden automation.
