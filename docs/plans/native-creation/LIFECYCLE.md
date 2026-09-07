# [Native Creation] Lifecycle: personal software, maintained through change

2026-09-05; generalized across domains 2026-09-06; folded into the native-creation
pack and ratified 2026-09-07 (PR #1561, formerly PR #1548). **Specified, not
implemented by this PR.** This is the lifecycle "how" of the program; the
obligation, the host / product-runtime / sandbox ruling, timing, execution home
and first consumer live in [RECONCILIATION §13](../long-term/ratified/RECONCILIATION.md#13-owner-ruling--2026-09-07-native-creation-the-first-complete-product-journey)
and the [pack index](README.md). Where this document says generated code is
served "only through the isolated tier" and "never registers its server
routes", read §13(c): served inside a product runtime in `local`/`remote`
mode, whose declared operations the host registers under the installation's
grants. The Clinic / Charlotte / ESG consumers below remain E0 preparation
fixtures and later structurally different consumers; the first live proof
consumer is the Seneca mathematics tutor product (§13(g)).

The [DIRECTION amendment of 2026-09-07](../../direction/DIRECTION.md#amendment-2026-09-07--native-creation-is-the-first-complete-product-journey)
alone owns current dispatch. [RECONCILIATION §11](../long-term/ratified/RECONCILIATION.md#11-owner-requested-amendment--2026-09-05-workspace-evolution)
owns the release contract; [§12](../long-term/ratified/RECONCILIATION.md#12-owner-requested-amendment--2026-09-06-software-model-and-cross-domain-proof)
owns the software-model and consumer-scope clarification. The
[implementation-spec crosswalk](../long-term/ratified/V2-IMPLEMENTATION-SPEC.md#workspace-evolution-milestone-extension--2026-09-05)
maps this program to M0–M8 without changing that program's repository or freeze.

## Problem and product contract

Today a bespoke workspace can be assembled through application code, plugins,
and authored instructions. The owner wants users to request that adaptation
directly, instead of relaying each request through a founder to a coding agent.
The product must also maintain local choices when shared software improves.
Code generation alone does not close either loop.

The promise: **tell the workspace how you want to work; it can change its
interface and permitted behavior, retain that change, and keep benefiting
from shared improvements.** Start with a usable minimal Experience and optional
domain starters. Workspace names the governed world underneath; it need not
be the visible product metaphor. Support full Experience variation over a
small trusted host surface.

The general product model is **state/knowledge + domain operations +
Experiences + durable work**, under authority, evidence and lifecycle control.
These are responsibilities over existing contracts, not a new ontology.
Sources may remain external or read-only; deterministic calculation and manual
work are first-class. An agent does not own domain truth or business rules.
The [software model](../../vision/software-model.md) maps existing nouns and
separates verified evidence from proposed examples.

Prepare against two materially different source-backed adaptations: Clinic's
French **Documents médicaux** workflow and Charlotte/Seneca's governance
knowledge/draft workflow. Add ESG portfolio-impact analysis as an owner-described
stress case; its repository, inputs and method remain unverified. E0 uses
synthetic fixtures, normalized references and a fixture-only adapter. It proves
neither a live Clinic migration nor a deployed Charlotte package version.
One selected consumer earns the initial live loop; a second structurally
different live consumer earns a claimed cross-domain capability. This is not
an all-client rollout gate or a substitute for Rule of Three.

Clinic's Session-keyed consultation adapter retains its mandatory live
migration. Charlotte adds source attribution, read-only knowledge/writable
drafts and scoped extensions, without a patient-like CRUD schema. Proposed ESG
fixtures add method/input versions, coverage and freshness. Use the selected
consumer's locale for navigation, actions, status, decisions, errors, accessible
labels and dates/numbers without rewriting source material. Seneca supplies
both an adaptation context and an authenticated host for personal choices.
These are proof consumers, not pricing or commercial-order decisions.
This public plan contains no private source, customer records, credentials,
or clinical examples from tenant workspaces; proofs use synthetic fixtures.

Three loops have independent outcomes:

| Loop | Complete when |
|---|---|
| Private adaptation | A direct request becomes a checked, adopted revision without founder source edits. |
| Downstream maintenance | A supported upstream change preserves local intent or exposes a resolvable conflict. |
| Shared improvement | Approved portable material becomes an optional package adopted by another private workspace. |

A private success needs no central PR. An upstream merge does not activate
customer software. The user may keep a working optional package version
within support policy and export permitted private composition/custom source.
External services and licensed dependencies can limit standalone portability.

## Composition and ownership

| Layer | Owner and invariant |
|---|---|
| Host and platform contract | Identity, tenancy, capability admission, durable active pointers, recovery, and security policy remain host-owned. Pin a supported contract, never an obsolete security implementation. |
| Shared packages | Exact releases of component, operation, behavior, and domain contracts; no floating latest dependency in an active revision. |
| Workspace overlay | Authorized shared workflow and configuration changes; cannot widen host/organization grants. |
| Personal overlay | Arrangement and permitted behavior within shared rules; cannot silently change other users or shared domain policy. |
| Private modules | Custom source and immutable build artifacts with contracts, provenance, isolation, and an upgrade/repair path. |
| Business data | Records, drafts, files, session history, and credentials; separate from software identity and undo. |

Git can own custom source and ancestry. Ordinary preferences are typed changes
over exact package versions. Three-way reconciliation uses old base, local
intent, and new base; a whole-repository fork is an escape path with explicit
maintenance responsibility, not a prerequisite for personalization.

Agent identity stays independent of Workspace/Seat identity. A local behavior
choice constrains a binding or produces an explicit derived definition with
source lineage. It does not rewrite a shared expert for all subscribers.
Record the effective behavior digest for admitted work.

## Building blocks and mutation lanes

The machine-readable catalog needs purpose, stable namespaced IDs, version,
props/slots, input/output contracts, source bindings, operation effects,
capabilities, examples, state compatibility, and relevant evaluations. Index
the subset useful to the request; do not put every component in every prompt.

| Catalog kind | What is reusable |
|---|---|
| Governed source bindings | Owned records, external sources, read-only knowledge and writable drafts; identity, scope, version/freshness and explicit limitations. Extend existing resource/mount/query seams, without a universal source schema. |
| Visual components | Tables, forms, document blocks, editors, split surfaces; loading/error states, responsive and keyboard behavior. |
| Domain views | Record summaries, review queues, timelines; subject semantics and permitted operations. |
| Operations | Typed queries and actions shared by human UI and agents; current authorization, version preconditions, idempotency/effects. |
| Deterministic domain methods | Versioned calculation, validation and transitions with reproducible fixtures. Domain meaning and acceptance remain domain-owned. |
| Behavior assets | Instructions, skills, templates, and allowed routing bindings with representative evaluation cases. |
| Domain packages/recipes | Compatible components, operations, behavior, fixtures, and migrations. Domain meaning stays outside core. |

Use the smallest sufficient mutation lane: existing preference → compose
registered components/operations → permitted behavior asset → new isolated
module → trusted domain-operation/schema release. The last lane can automate
engineering, but its activation authority belongs to the owning maintainer.
Unsupported requests must identify the missing capability or take the next
admitted lane; a theme change must not masquerade as novel software.

Product-specific configuration may select props of already registered
components. A saved semantic composition consumes the ratified View contract
as a set; it cannot introduce a substitute ViewDescriptor before that gate.
Provider/binding lifetimes, dependencies, state namespaces, and removal are
part of installation. Frontend hot reload alone does not supply that lifecycle.

## Composable Experiences and ambient work

Clinic exposed chat coupling; Charlotte and ESG expose domain coupling.
RECONCILIATION §§8–10 already permit route-first SaaS, knowledge experts,
headless work and ambient presence. A hidden chat column or a second skin over
Clinic is insufficient evidence of a shared platform contract.

Compose independent choices through the existing `AppComposition` boundary:

| Choice | Contract and owner |
|---|---|
| Domain resources and operations | Domain package owns record/source meaning, authoritative storage or connected bindings, versioned queries/actions/methods, and review rules. Session, tab, or renderer identity does not own domain identity. |
| Primary surfaces and navigation | Experience composes registered collections, records, documents, forms, dashboards, and optional conversations. Host translates semantic locations into URLs; a View can have several supported mounts. |
| Agent presence | Keep §10's `hidden · ambient · drawer · page · roster` vocabulary. Ambient is Clinic's default; opening a temporary assistant drawer does not switch its domain model or staffing. |
| Work initiation | Explicit UI commands, conversation requests, or admitted events/schedules call the same governed operations. Trigger policy is independent of layout and presence; showing/hiding a component never enables automation. |
| Context and state | Each View/action has explicit subject/resource bindings, current authority, and version preconditions. Personal presentation state is distinct from shared domain data and durable work. |

Chat-first, SaaS-first, document-first, and workbench are recipes of these
choices, not a closed global `appMode` switch with separate data and runtime
stacks. Recipes can be mixed within one product. The supported compatibility
matrix is explicit: composable does not mean every component fits every mount.
Publish only combinations with meaningful consumer evidence, not an exhaustive
Cartesian product or a new universal UI language.

| Reference recipe | Primary experience | Assistant and work |
|---|---|---|
| Clinic | Patients → Documents médicaux → document/detail/review | Ambient status and proposals; contextual drawer on request. |
| Charlotte/Seneca knowledge expert | Conversation with inspectable attributed knowledge and user drafts | Addressed expert, read-only corpus, scoped plugin; no invented transactional record model. |
| ESG workbench (proposed stress case) | Scenario table, result chart, method and source evidence | Deterministic domain calculation plus optional explanation; uninspected client implementation. |
| Conventional SaaS | Routes, collections, record forms, review queues | Ambient or hidden agent; decisions/results reachable without chat. |
| Meridian | Search, Inbox, Work, Agents, Library and workbench | Roster presentation over the same governed work. |
| Embedded or headless | A supported document/record mount, or no UI | Host-injected context; accepted work and delivery independent of a mounted browser. |

**Reusable units must compose below the pane.** A document viewer/editor,
block, source/provenance display, query-backed list/table, chart, status,
review action and assistant entry point can compose without an entire vertical
shell. Share mechanisms; patient identity, corpus attribution and impact
methodology retain their domain owners. Two mounts and different domain
fixtures expose the actual common contract before broader extraction.

Extend catalog entries with supported mounts/slots, typed bindings and emitted
intents, capability requirements, provider ownership/lifetime, instance keys,
state namespace/schema, responsive variants, accessibility behavior, and
unmount/reconnect semantics. Bindings pass semantic references, not arbitrary
host callbacks or executable strings. Slot compatibility, missing providers,
invalid bindings, and duplicate instance keys fail candidate validation.
Sharing a provider does not imply sharing a selected patient, corpus or portfolio. Product-specific
props can prove two mounts now; persisting semantic layouts still consumes the
complete ratified View contract. Resolve only the providers a composition
needs; opening a document must not require mounting chat or starting inference.

**Domain identity precedes the selected live proof.** Owned entities,
connected sources and artifacts need their own identity/version semantics.
Charlotte's corpus stays read-only, drafts writable, and source/package
versions attributable. Proposed ESG work declares its snapshot and method;
an LLM explanation does not define the calculation. These are different domain
obligations, not one shared record schema.

**Clinic-specific migration.** Patient, encounter, and
document identities belong to the domain store. One patient may have multiple
encounters and documents; a document may participate in several jobs and
conversations. A Session is an optional conversation binding, never the record
owner. Clinic's current session-keyed consultation document path needs an
explicit trusted adapter/migration before the live E1b proof: preserve old
links and records, map only known
bindings, quarantine ambiguous/unbound records for resolution, and prove
repeatable migration and compatible rollback. Do not guess patient identity or
create synthetic chat sessions to satisfy a document API. This is consumer
domain work, not a new kernel noun or a generated-UI migration.

**Ambient work has an independent lifecycle.** Host admission captures the
subject, input versions, behavior/release identity, trigger identity, and
current scope. Thread remains the durable job root with zero or more Sessions;
using that integration retains its storage/attribution gates. Retry/reconnect
and duplicate event delivery settle through accepted-work identity, never
through component mount effects. Layout switches, drawer closure, and loss of
the browser do not cancel or duplicate admitted server work. Live browser
capture is different: microphone consent, recording state, stop controls, and
interruption must remain explicit; closing the browser cannot promise continued
capture. A UI unmount must not silently stop or retarget an active capture.

Status, pending decisions, failures, results, and supported stop/recovery
controls are available outside chat through projections of existing
Activity/Approval/artifact state. Hiding an agent cannot hide a required
decision or imply permission for unattended effects. Source documents,
agent-generated drafts/proposals, and approved records remain distinguishable
with provenance and freshness. A new source or concurrent human edit makes an
incompatible proposal stale; version-checked acceptance must not overwrite the
edit or silently turn a generated suggestion into approved domain truth.

Optional chat receives the explicitly bound, authorized working set for that
interaction. It does not inherit every open subject or follow a mutable global
selection mid-Run. Each pane, job, subscription, and cached result is isolated
by its subject and current scope; revocation closes further delivery as well as
new reads. Presentation preferences such as card density or collapse state
must not increment a domain record, knowledge-source or analytical-input version.

## Release contract

These are product-module records, not new universal kernel nouns. Reuse
existing Artifact/Evaluation and accepted-work mechanisms where implemented.
Keep RunId := RequestKey; use Thread when the workflow actually needs a durable
job root. An optimization Objective/Candidate is optional for preference work.

1. **Capture intent.** Resolve the authenticated requester and target scope;
   record the direct request, current revision, and selected semantic target.
   A screenshot may help but coordinates alone are not identity. Imported
   documents/tool output and passive usage are not change authorization.
2. **Prepare candidate.** An admitted builder Run produces an immutable
   manifest: parents/base, exact package lock, overlay and artifact digests,
   behavior digest, declared state compatibility, provenance, and evidence
   references. The builder receives relevant catalog/fixtures and only the
   private inputs explicitly authorized for the task.
3. **Verify and preview.** Bind results to the exact artifact and suite
   version. Protected checks and release credentials stay outside the editable
   candidate. Separate preview state/data namespaces. Missing required output
   or verification evidence fails release; an optional diagnostic skip is
   never silently counted as a pass.
   Candidate requests, source, artifacts, and evidence are private scoped
   resources. Candidate retrieval, preview access/rendering, and every brokered
   read/action check current authorization. A preview URL or artifact digest is
   not a grant. Revocation invalidates preview access and denies further
   retrieval/broker calls; it cannot undo already disclosed content.
4. **Activate.** The host checks current authority and the expected generation
   vector for platform contract, package lock, workspace/personal overlays,
   state/schema compatibility, and policy. Commit the active pointer and
   append-only receipt durably with compare-and-set/idempotent settlement.
   A concurrent change in any relevant scope requires revalidation/rebase.
5. **Observe and recover.** Record the active software and behavior used by
   work. Undo creates a new authorized activation of a supported prior
   revision; it never rewrites release history or business data.

The builder proposes; a trusted host verifier and activation controller decide.
The builder cannot mutate protected suites or release pointers. A bounded
standing user policy can authorize small changes without another approval
prompt. Expanding capabilities or changing shared domain policy requires the
corresponding host/maintainer decision. Bound retries, build/runtime spend,
and evaluator feedback; repeated generation must not become an unbounded loop.

Separate authoring, verification, and serving authority. Generated code needs
actual confinement during build and when served, using the admitted C4 tier
(isolated frontend and brokered capabilities). Never load generated JavaScript
into the authenticated host origin or register its server routes. A snapshot
or disposable directory alone is not a security boundary. Keep host recovery
and disable controls reachable if the custom surface fails.

Already admitted work pins code/behavior/state contracts while current
revocation still applies. Shared releases must check personal-overlay
compatibility. Incompatible work is drained or explicitly migrated. Module
state needs copy-on-write or a supported dual-readable format for rollback;
business-schema changes use a separate trusted migration release. Reverting
software cannot undo an external effect or a prior disclosure.

Quarantining a digest stops its serving instances and broker authority, blocks
resume, and exposes recovery. Do not claim that moving a pointer alone removes
already running code. Unknown external outcomes use accepted-work recovery;
comparison or retry must never duplicate a non-idempotent effect.

## Milestones

All milestones below are **unbuilt in this plan PR**. Dependencies describe
readiness, not a promised calendar. DIRECTION owns permission to dispatch.

| Milestone | Working capability | Required acceptance evidence |
|---|---|---|
| E0 — request and preview preparation | Map Clinic and Charlotte/Seneca requests to current contracts; add a labeled ESG hypothesis. | Reuse one registered unit in two mounts and both synthetic domain fixtures with the smallest fixture adapter/extraction. Browsing needs no chat/Session; source/draft ownership remains distinct. No live compatibility, deployment or kernel generality claim. |
| E1 — durable workspace revision | E1a: selected consumer request → candidate → preview → keep/undo. E1b: that consumer's live domain work and bounded Job Thread. | E1a: no founder source edit; exact evidence; stale-candidate rejection; refresh/new work/restart retain the choice; crash/lost-ACK settlement once. E1b: live domain identity/operations independent of Session and a bounded Job Thread with result/decision after chat/browser closure. Required domain migrations remain. Both subproofs complete E1. |
| E2 — personal scope | Personal and workspace layers resolve under authenticated host authority. | Two users keep different presentations over shared records without mutating document content; two open subjects stay isolated; cross-user/workspace candidate reads, previews, and writes fail; revocation stops further access/delivery; personal edits cannot alter shared policy. |
| E3 — behavior revision | Version permitted profile/skill assets and their composition for chat and ambient work. | Effective behavior is attributable per Run; a shared expert update preserves the local preference; policy/grant expansion fails; required output and affected evaluations pass. A presentation change neither enables a trigger nor approves a domain proposal. |
| E4 — isolated private module | Generate a useful component absent from the catalog, with scoped operations. | Build and serving isolation are exercised; denied host-origin/grant access; install/removal/recovery work; novel component performs its intended task. |
| E5 — upgrade and reconciliation | Adopt a real upstream package change, reconcile overlays, retain or replace private modules where supported. | An ordinary upgrade preserves local intent across supported mounts; a binding/state conflict stops activation; undo preserves data and admitted work. Repeat a claimed cross-domain capability in a second structurally different live consumer; a fixture/skin is insufficient. |
| E6 — approved reuse and broader autonomy | Export approved portable material, publish an optional package, install in another private workspace. | Independent workspace adopts it with different local choices; private canaries stay out of export; no automatic publication/adoption; lower human repair burden supports the next autonomy class. |

E5 starts with E1/E2 configuration and should precede catalog expansion; it
does not depend on E4. E3/E4 extend upgrade evidence for their own artifact
classes. No lane inherits another lane's permission to ship without its checks.
E1a can land before E1b; it earns the durable configuration claim only.
E1b retains unconditional [thread-storage-spike] and [seat-audit-attribution]
gates. The selected consumer's required migration also gates its live proof;
Clinic's Session-keyed migration applies when Clinic is selected. DIRECTION
owns dispatch and the E1 done-bar. Earlier private changes do not wait for
every consumer; kernel promotion retains Rule of Three beyond this readiness bar.

Prepare these bounded examples without treating one as the universal product.
The Clinic example paraphrases the owner's direction; Charlotte is a
source-backed proposed fixture request and ESG is an unverified analytical
hypothesis. These are not verbatim customer quotes. E0 records requester,
provenance and confirmation status; confirm proposed requests with the intended
requester before labeling them actual customer requests.

| Consumer | Bounded request / first proof |
|---|---|
| Clinic | "Ouvre sur Documents médicaux, regroupe par patient, montre ce qui est à valider, et garde l'assistant à la demande." Missing aggregate/review operations and identity migration are trusted domain prerequisites. |
| Charlotte/Seneca (proposed fixture) | "Keep the relevant sources beside my draft, and preserve this arrangement when I switch agents." Preserve read-only corpus, writable drafts and addressed-agent context. This public-corpus package is not evidence about the person or their endorsement. |
| ESG (proposed) | "Compare these scenarios and show the input date, method and evidence behind the result." Confirm actual data/method and domain operation first; a synthetic table does not prove live analysis. |

Choose one useful live workflow and domain owner before E1 implementation.
Select a preview, keep it, inspect another authorized resource, restart, then
adopt a supported shared update. E1b adds bounded live work and non-chat
status/result/decision proof. A missing component may require a new trusted
query or method; generated UI cannot invent that backend authority.

## Dependencies and implementation seams

| Slice/claim | Gate |
|---|---|
| E0 fixture preparation | Requester/provenance and confirmation status for each request; registered units plus a fixture-only adapter/extraction; normalized Clinic and proposed Charlotte/Seneca fixtures, labeled ESG assumptions. No live data path, production activation, new Job Thread or saved semantic descriptor. |
| E1a durable agent-driven release | P1-C accepted-work/recovery; paused-human proofs when the workflow resumes a paused Run, not merely because a host preview has a Keep button. Durable activation/current authorization and any Job Thread premises actually consumed by the release workflow remain required. |
| E1b selected live domain acceptance | E1a plus the consumer's trusted identity/operation and required migration evidence; Clinic's Session-keyed migration is mandatory for Clinic. [thread-storage-spike] and [seat-audit-attribution] remain mandatory for every E1b bounded Job Thread and non-chat delivery. A fixture or hidden Session is insufficient. |
| Saved semantic layout/workflow | Complete [saved-views-kernel] View contract, in addition to E1 prerequisites. |
| Personal ownership | Authenticated membership and scoped storage; audit-grade Seat attribution where a Seat authored the work. |
| Job Thread integration | Thread storage-shape result and the existing Thread/attribution joins consumed by that integration. |
| Generated code | C4 admitted isolation for build and serving plus brokered operation contracts; no hosted-code preview shortcut. |
| Shared publication | Approved minimal export, maintainer review, compatibility and reuse evidence; not a marketplace launch. |
| Cross-domain capability claim | Second structurally different live consumer exercises the supported capability and domain invariants. Distinct skins, source inspections and the ESG hypothesis do not satisfy this proof or Rule of Three. |

Start as one logical evolution module with host-injected stores, a composition
resolver, candidate coordinator, verifier, and activation controller. This
does not require five services, a new universal registry, or a broad package
reorganization. Map to the approved package boundary at implementation time
and keep the existing interface-first port doctrine.

Public platform seams inspected at main 3db6a237d0ace94c83fb4967e43407d65202706e
(2026-09-04); recheck changed interfaces before implementation:

| Existing seam | Reuse and missing capability |
|---|---|
| [Frontend plugin contract](../../../packages/workspace/src/shared/plugins/frontFactory.ts) | Stable panel/command/catalog registrations; add scoped revision resolution and lifecycle handling. |
| [Generated-pane vocabulary](../../../plugins/generated-pane/src/shared/index.ts) | Declarative component/graph checks; operations and semantic composition need their admitted contracts. |
| [Workspace Bridge registry](../../../packages/workspace/src/server/workspaceBridge/registry.ts) | Typed, scoped capability calls; extend release/preview admission without a second authority model. |
| [Agent definition assets](../../../packages/agent/src/shared/agent-definition.ts) | Versioned behavior identity; add derived lineage and effective per-Run composition evidence. |
| [Sandbox provider contract](../../../packages/boring-sandbox/src/shared/providerV1.ts) | Provision/health/invalidate/dispose; candidate export, preview routing, serving confinement, and activation are additional responsibilities. |
| [Factory snapshot materialization](../../../plugins/boring-factory/src/server/sandbox/localDisposableProvider.ts) | Exact-commit starting point; current disposable local snapshot is not hosted confinement or an artifact publication channel. |

Keep the domain worker focused on its work. Direct customization dispatches a
bounded builder function with relevant context; it does not inject engineering
guidance into every clinical interaction or require a roster of agents.

Seneca's creator-package publication, exact-commit validation and host
activation are additional reuse seams ([source scope](../../vision/software-model.md#source-scope)).
They do not prove generic personal overlays/reconciliation, and source
inspection does not establish the active production digest.

## Composability stress cases

These are required acceptance scenarios for the named slices, not runtime
results of this documentation PR. E0 inventories unmet seams using synthetic
fixtures; it does not claim that background execution or migrations work.

| Stress case | Passing behavior | Proof slice |
|---|---|---|
| Start with no chat mounted and inference unavailable | Normalized resources and permitted manual/deterministic paths remain usable. Repeat the selected live path before claiming independence. | E0 fixture; E1b live domain adapter |
| Reuse one resource/evidence unit in two mounts and two domains | Composition changes; operation meaning and source/subject identity do not fork. Domain rules stay in their adapters. | E0 fixture; E1 selected live; E5 second consumer |
| Close chat/browser during admitted server work; reconnect elsewhere | Work retains its subject and release identity; status, results, and decisions reappear outside chat; no duplicate effect. | E1b with mandatory Thread/attribution premises |
| Switch layout during capture or a pending decision | Capture remains visibly controlled or reports interruption; the decision remains reachable and is neither accepted nor lost by the switch. | E1 for supported live inputs |
| Open two patients, corpora or portfolios simultaneously | A late result/action for A cannot read, write, display in, or retarget B; optional chat binds one explicit working set. | E2 |
| Human edits while agent drafts from an earlier version | Proposal shows its source versions; stale acceptance conflicts instead of overwriting the edit. A layout undo leaves both records intact. | E1 domain operations; E3 behavior |
| Switch from ambient to chat-first and back | No new grant, automatic trigger, duplicated job, lost record, or new domain identity; personal settings stay personal. | E1/E2; E3 for behavior |
| Compose a missing provider, incompatible slot, or two instances sharing a forbidden state key | Candidate fails validation; no blank live surface or cross-instance state leak. Missing optional chat requires no chat provider. | E1; E4 for private modules |
| Upgrade a shared unit used by different domain adapters | Supported mounts retain local bindings and domain meaning, or expose a precise conflict before activation. | E5 |
| Open at narrow width or use keyboard navigation | Document and review tasks remain usable; required status/decision controls remain reachable without forcing chat into the primary surface. | E0 fixture; E1 live |
| Use read-only knowledge and writable drafts | Corpus scope/attribution remain visible; source writes fail while drafts remain useful without a fake CRUD schema. | E0 fixture; selected live consumer |
| Change an analytical snapshot or method (proposed ESG case) | Result identifies inputs/method and is stale or recomputed; unknown/estimated/zero stay distinct; deterministic fixtures reproduce. | E0 assumptions; domain proof before live claim |

## Comparison, upgrades, and reuse

Provide three explicit comparison modes. **Preview** compares fixed variants
on the same fixture and records preference. **Shadow/replay** compares outputs
without settling external effects. **Live trials** need frozen versions,
appropriate assignment/exposure, and an outcome that supports a decision.
One user's changing tasks can make causal A/B conclusions untenable; report
preference or inconclusive evidence honestly. Separate domain-method/policy
evaluation from UI engagement. Do not auto-promote a domain behavior change
because a layout was preferred or a model judge assigned a higher score.

Rebase semantic operations against stable IDs and declared contracts. Preserve
local intent where the new base permits it; surface removed targets,
incompatible props/effects, competing edits, or state changes as conflicts.
A clean source merge can still change meaning, so validate contracts and
affected outcomes. AI can propose conflict repairs; it cannot guarantee them.

Private-to-shared export is explicit and minimal. The receiving generalizer
builds from approved portable requirements/code and synthetic fixtures with
no access to the originating workspace. Review prompts, comments, logs,
screenshots, tests, dependencies/licenses, and data bindings as well as source.
A scanner is evidence, not proof of complete de-identification. Publish an
immutable optional package through maintainer policy; each customer adopts it
under its own update policy. Do not automatically merge private work into main.

## Rollout, rollback, and proof

Each runtime slice ships behind an opt-in host-controlled flag for its admitted
scope. Expose candidate, active, and prior supported revisions separately.
Configuration is the first automatic class; broader classes follow their own
evidence. No live customer-data trial or tenant deployment is authorized by
this plan PR. A first configuration prototype can prove one shared workspace;
only E2 earns per-person ownership claims.

| Failure to inject | Required result |
|---|---|
| Two candidates from one base; or shared package/policy changes during preview | Relevant generation mismatch blocks stale activation; no lost update or stale grant. |
| Candidate edits tests, evidence, or artifact bytes after validation | Trusted gate is unaffected; altered digest/evidence is rejected. |
| Crash before/after activation settlement or lost acknowledgement | Active pointer/receipt remain consistent and retry returns the settled outcome. |
| User loses access after preview | Candidate retrieval, preview access, activation, and every brokered read/action deny further unauthorized access; already disclosed content is not claimed undone. |
| Another user guesses a candidate digest or preview URL | Candidate/source/evidence retrieval and preview rendering remain scoped and deny access. |
| Personal overlay conflicts with a shared update | Resolve before activating that incompatible combination; preserve a supported incumbent where policy permits. |
| Broken/quarantined custom module | Serving and broker authority stop; independent recovery remains reachable. |
| Undo after state migration or external effect | Compatibility checked; no silent data loss or replayed effect. |
| Private canary in builder input | It cannot enter the approved reusable export or telemetry artifacts. |
| Expected result missing; only a refusal/diagnostic skip produced | The feature acceptance gate remains open. |

Tests follow the changed contract/effect surface. Small preferences do not
require a full platform rerun; activation, isolation, migration, and domain
changes need their corresponding protected checks and recovery evidence.
Implementation PRs record exact revisions and commands; this plan proves no
runtime behavior by itself.

Pilot measures include every attempted change: time to useful preview,
founder relay minutes, correction/revert rate, retained use, model/build/runtime
cost, upgrade success, and repair/conflict burden. For Clinic also measure
document-task completion without chat, time to find/review the intended
document, missed or stale proposals, and unnecessary assistant interruptions.
For Charlotte/Seneca measure grounded useful drafts, source accuracy and human
correction burden. For the proposed ESG case, select a reproducibility,
coverage/freshness and analyst-review baseline once the real method is known.
Set baselines on the selected workflow; chat engagement is not its success
metric. E6 autonomy expansion needs
retained-use and maintenance evidence for that change class, not only adoption
of a shared component. Stop expanding a class if repair work exceeds the
adaptation value or its checks cannot discriminate regressions.

## Review and amendment boundaries

| Existing ruling | Disposition |
|---|---|
| RunId := RequestKey; host mints authority; Seat grants participation | Preserved; no second execution or ownership root. |
| Semantic Views; full View contract before saved Views | Preserved; app props cannot become a lookalike descriptor. |
| SaaS/headless Experiences (§8), Thread with 0..n Sessions (§9), ambient default (§10) | Preserved; domain identity and work outlive UI. §12 broadens E0 preparation and selects one live E1 consumer, retaining Thread/attribution gates and each domain's obligations. |
| Clinic-first/Seneca-only-as-host framing (§11) | Explicitly amended by §12: source-backed Clinic and Charlotte/Seneca fixture preparation; ESG remains a hypothesis; second live consumer evidence precedes cross-domain claims. |
| Independent challenger checks; no live self-rewriting | Preserved through immutable candidates and host activation. |
| Trusted composition immutable; untrusted tier isolated | Preserved; generated modules use admitted C4, never host imports. |
| Universal app generator excluded | Narrowed explicitly in VISION/§11 to admit bounded workspace evolution. |
| Only named preparation/chrome runnable before premises | DIRECTION adds E0 explicitly; E1 and later remain premise-gated. |
| New-repo freeze/port doctrine; tenant-owned GTM | Preserved; no package rewrite or commercial reorder. |
| Documentation never precedes implementation | Clarified by §11(g): implementation guarantees need evidence; explicitly unbuilt plans/specifications may precede implementation. |

The docs-only PR records an owner-requested plan and reviewable scope. Runtime
implementation, protected release proofs, and any required owner merge/review
decisions remain separate from this document's creation.
