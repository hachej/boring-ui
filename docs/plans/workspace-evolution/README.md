# [Workspace Evolution] Personal software, maintained through change

2026-09-05. Owner-requested design and milestone plan; effective on owner
merge. **Specified, not implemented by this PR.**

[DIRECTION](../../direction/DIRECTION.md#amendment-2026-09-05--workspace-evolution)
alone owns dispatch. [RECONCILIATION §11](../long-term/ratified/RECONCILIATION.md#11-owner-requested-amendment--2026-09-05-workspace-evolution)
owns the normative amendment. The
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
from shared improvements.** Start with a usable minimal shell and optional
domain starters. Support full Experience variation over a small trusted host
surface, rather than requiring every vertical to adopt one layout.

The first acceptance consumer is Clinic. The first request should rearrange
existing document/chat components and select an existing presentation variant.
Seneca supplies the authenticated host for proving distinct personal choices.
These are platform proof consumers, not pricing or commercial-order decisions.
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
| Visual components | Tables, forms, document blocks, editors, split surfaces; loading/error states, responsive and keyboard behavior. |
| Domain views | Record summaries, review queues, timelines; subject semantics and permitted operations. |
| Operations | Typed queries and actions shared by human UI and agents; current authorization, version preconditions, idempotency/effects. |
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
| E0 — request and preview preparation | Select one real layout request; inventory exact current packages, components, operations, and mutation scope; compare fixture previews. | Concrete selected request, explicit target IDs/props, baseline, missing seams, and a reviewable preview. No private records; no production activation claim. |
| E1 — durable workspace revision | Request in app → candidate → preview → keep/undo, initially one workspace. | No founder source edit; exact digest evidence; stale-candidate rejection; refresh/new work/restart retain the choice; activation crash/lost-ACK retries settle once. |
| E2 — personal scope | Personal and workspace layers resolve under authenticated host authority. | Two users retain different arrangements over shared records; cross-user/workspace candidate reads, previews, and writes fail; revocation denies further preview/data access; an unauthorized personal edit cannot alter shared policy. |
| E3 — behavior revision | Version permitted profile/skill assets and their composition. | Effective behavior is attributable per Run; a shared expert update preserves the local preference; policy/grant expansion fails; required output and affected evaluations pass. |
| E4 — isolated private module | Generate a useful component absent from the catalog, with scoped operations. | Build and serving isolation are exercised; denied host-origin/grant access; install/removal/recovery work; novel component performs its intended task. |
| E5 — upgrade and reconciliation | Adopt a real upstream package change, reconcile overlays, retain or replace private modules where supported. | An ordinary upgrade preserves local intent; an intentional conflict stops activation; supported undo preserves data; newly upstreamed fixes can replace local patches where verified. |
| E6 — approved reuse and broader autonomy | Export approved portable material, publish an optional package, install in another private workspace. | Independent workspace adopts it with different local choices; private canaries stay out of export; no automatic publication/adoption; lower human repair burden supports the next autonomy class. |

E5 starts with E1/E2 configuration and should precede catalog expansion; it
does not depend on E4. E3/E4 extend upgrade evidence for their own artifact
classes. No lane inherits another lane's permission to ship without its checks.

First user journey: "For consultations, keep the document on the left, make
the conversation narrower, and use compact cards." Select a preview, keep it,
start another consultation, restart the app, then apply a supported shared
update. All three persistence boundaries matter.

A later novel-component journey: aggregate proposed document blocks in a
review pane. It may first require an authorized aggregate query; generated UI
cannot invent backend authority. Reuse generic review-list mechanics, while
patient identity and clinical approval meaning remain domain-owned.

## Dependencies and implementation seams

| Slice/claim | Gate |
|---|---|
| E0 fixture preparation | Existing registered components; no production activation, new Job Thread, or saved semantic descriptor. |
| E1 durable agent-driven release | P1-C accepted-work/recovery and relevant paused-human proofs; durable activation store and current authorization. |
| Saved semantic layout/workflow | Complete [saved-views-kernel] View contract, in addition to E1 prerequisites. |
| Personal ownership | Authenticated membership and scoped storage; audit-grade Seat attribution where a Seat authored the work. |
| Job Thread integration | Thread storage-shape result and the existing Thread/attribution joins consumed by that integration. |
| Generated code | C4 admitted isolation for build and serving plus brokered operation contracts; no hosted-code preview shortcut. |
| Shared publication | Approved minimal export, maintainer review, compatibility and reuse evidence; not a marketplace launch. |

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

## Comparison, upgrades, and reuse

Provide three explicit comparison modes. **Preview** compares fixed variants
on the same fixture and records preference. **Shadow/replay** compares outputs
without settling external effects. **Live trials** need frozen versions,
appropriate assignment/exposure, and an outcome that supports a decision.
One user's changing tasks can make causal A/B conclusions untenable; report
preference or inconclusive evidence honestly. Separate clinical/domain-policy
evaluation from UI engagement. Do not auto-promote a medical behavior change
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
evidence. No live patient-data trial or tenant deployment is authorized by
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
cost, upgrade success, and repair/conflict burden. E6 autonomy expansion needs
retained-use and maintenance evidence for that change class, not only adoption
of a shared component. Stop expanding a class if repair work exceeds the
adaptation value or its checks cannot discriminate regressions.

## Review and amendment boundaries

| Existing ruling | Disposition |
|---|---|
| RunId := RequestKey; host mints authority; Seat grants participation | Preserved; no second execution or ownership root. |
| Semantic Views; full View contract before saved Views | Preserved; app props cannot become a lookalike descriptor. |
| Independent challenger checks; no live self-rewriting | Preserved through immutable candidates and host activation. |
| Trusted composition immutable; untrusted tier isolated | Preserved; generated modules use admitted C4, never host imports. |
| Universal app generator excluded | Narrowed explicitly in VISION/§11 to admit bounded workspace evolution. |
| Only named preparation/chrome runnable before premises | DIRECTION adds E0 explicitly; E1 and later remain premise-gated. |
| New-repo freeze/port doctrine; tenant-owned GTM | Preserved; no package rewrite or commercial reorder. |

The docs-only PR records an owner-requested plan and reviewable scope. Runtime
implementation, protected release proofs, and any required owner merge/review
decisions remain separate from this document's creation.
