# Native creation and maintained expert software

> **RATIFIED — 2026-09-07 (owner ruling via PR #1561).** This pack carries
> the owner's Seneca vision from reassessment to ruling: the product
> obligation, the [RECONCILIATION §13](../long-term/ratified/RECONCILIATION.md#13-owner-ruling--2026-09-07-native-creation-the-first-complete-product-journey)
> and [DECISIONS D33](../../DECISIONS.md#33-installed-products-run-in-their-own-runtime-one-trusted-installationactivation-path)
> rulings, the lifecycle "how" folded from PR #1548, and the dispatchable bead
> map in the [DIRECTION amendment of 2026-09-07](../../direction/DIRECTION.md#amendment-2026-09-07--native-creation-is-the-first-complete-product-journey).
> `DIRECTION.md` remains the only executable ordering; nothing here is
> implemented by the documentation itself. Epic
> [#1562](https://github.com/hachej/boring-ui/issues/1562).

## The product obligation

An expert creates useful software **inside Seneca**, uses it to complete a job,
changes its method and interface, installs it for a separate consumer, and
maintains it through an upstream update **without founder source edits**.

Creation is itself a job. The expert supplies intent, knowledge, examples,
judgment, and authorization; the platform performs the engineering. A starter
catalog accelerates creation but cannot be the permanent ceiling: the proof
must include a useful new frontend component and a useful new backend/domain
operation, not a panel hiding a manually implemented host endpoint.

Private release and installation belong to this first complete journey. Public
discovery, marketplace infrastructure, commercial packaging, specialist models,
and owned compute do not have to precede it.

## Read this pack

| Document | Owns |
| --- | --- |
| [Rulings](../long-term/ratified/RECONCILIATION.md#13-owner-ruling--2026-09-07-native-creation-the-first-complete-product-journey) (§13) and [D33](../../DECISIONS.md#33-installed-products-run-in-their-own-runtime-one-trusted-installationactivation-path) | The obligation, three layers, runtime modes, installation path, builder class, execution home, first consumer, platform/tenant line. |
| [Lifecycle](LIFECYCLE.md) | Release contract, composition layers, mutation lanes, E0–E6 acceptance ladder, failure injection (folded from PR #1548; §11/§12). |
| [Reassessment](REASSESSMENT.md) | Findings that led to the rulings: what existed, what conflicted, the code/doc drift. Context, not authority. |
| [Amendment record](DOCUMENT_AMENDMENTS.md) | Where each ruling landed in the canonical docs, and the crosswalk to M/E work. |
| [Coverage and sources](COVERAGE_AND_SOURCES.md) | Pinned evidence and inspection limits of the reassessment. |
| [360 gap map](360-GAP-MAP.md) | What the whole spec requires that the first bead cut missed; prior designs to reuse; owner decisions and defaults. |
| [Seneca experience](SENECA-EXPERIENCE.md) | The UX target (bots, chat with cards and canvas, bot page, rooms, no trace) mapped to our nouns and beads; the Thread question. |
| [Runtime SDK and package split](RUNTIME-SDK.md) | `packages/agent` as the runtime SDK (spawn as a first-class primitive), chat and views as their own packages; the delta and the proposed ruling. |
| [Expert software building blocks](EXPERT-SOFTWARE-BUILDING-BLOCKS.md) | Clinic vs multi-worker product; user-facing bots vs remote workers; remote creator agents; shadcn-based composition; expert personalization; questions for the owner grill. |
| [OpenComputer interface reference](OPENCOMPUTER-INTERFACE-REFERENCE.md) | Concrete interface lessons for agent definitions, Sessions, events, BYOK, sources, computer leases and previews; retain/sharpen/fill Boring's mechanisms, never replace them with a mandatory provider. |
| [Credentials and egress](CREDENTIALS-AND-EGRESS.md) | Surrogate tokens, egress proxy, three deciders, grant types — adopted from Muse; proposed D33 addendum. |
| [Plan and show-me](../../issues/1562/plan.md) | Epic plan, bead graph, proof commands, gate-1 artifact. |

This is a repository-ready synthesis of the September 7 reassessment, not a
verbatim archive of its exported reports. Its source register preserves the
limits of that review; it does not claim an exhaustive recursive `docs/` audit.

## Relationship to existing work

Draft [PR #1548](https://github.com/hachej/boring-ui/pull/1548), reviewed separately
at `cb6b476aefb8d8fb3b1395a72a006264f5326d8d`, is the main existing lifecycle
design input. Its release contract (capture intent → immutable candidate
manifest → verify and preview → activate against an expected generation vector
→ observe and recover) is the same Change loop this pack describes, and its
E4 milestone already names generating a component absent from the catalog.
This pack does not re-specify that contract; it adds the product obligation,
the re-timing, and the Installation and Release identities the contract
assumes but does not name. Its E0–E6 runtime milestones remain unbuilt in that PR. Preserve
its separation of domain state, changes, scopes, upgrades, and proof levels;
add creation and installation for a separate consumer as the overarching
acceptance journey. Do not treat an E1a configuration preview as the complete
product, close its work, or duplicate its engine.

The [interview-intake proposal](../agent-interview-intake-plan.md) newly present
on the PR base can inform authoring briefs: typed input, deterministic
completeness, human confirmation, and frozen provenance. It explicitly excludes
execution, reports, and revision. Its claimed Seneca deployment was not tested
in this review; it does not prove the release/install/evolve lifecycle.

The existing ratified Thread root stands: **one job, zero or more runtime
Sessions**. This pack does not mint a second Job authority. Meridian remains a
valid operator Experience, not a mandatory canvas for every expert product.
Existing runtime, security, migration, and recovery obligations remain in force
until their exact amendments are approved through the existing process.

## Proposed end-to-end proof

These are the acceptance stages; the bead map in the DIRECTION amendment
implements them for the first consumer, and nc-7 is the only bead that can
close the epic.

| Stage | Observable acceptance |
| --- | --- |
| Create and retain a private product | The creator obtains a useful preview and retains method/UI changes from inside Seneca. The release and installed state survive destruction of the builder environment. |
| Run it for a separate consumer | A second authorized user completes a real job. Installation, learner/customer data, authoring work, release identity, and conversations stay distinguishable. |
| Exercise job continuity | Closing chat, reconnecting, and switching between jobs preserve results and pending decisions. Late results remain bound to their original job and resources. |
| Build a missing capability | A requested component and domain operation absent from the starter catalog are generated, checked, and served within the installation's authority. No founder source edit or global app redeploy is the hidden step. |
| Adapt and maintain | A private choice survives a compatible upstream update; a real incompatibility produces a precise conflict. Undo preserves business records and does not pretend to reverse completed external effects. |
| Generalize with evidence | A nontechnical curator and a materially different domain use the same lifecycle. Factory coordination and two cosmetic skins do not substitute for this proof. |

Every stage records the effective release, relevant input identity, checks,
result, acceptance, cost, and any founder intervention. Missing proof is not a
pass. Evaluation evidence must identify the tested behavior and cannot be
inherited by a fork that changes it without an applicability check.

## Decisions ruled 2026-09-07

| Decision | Ruling (RECONCILIATION §13) |
| --- | --- |
| Execution home | **This repository.** `boring-v2` does not exist; nothing was ported. R-a stays doctrine for a later, evidence-triggered port. (§13f) |
| Where generated code runs | **Host / product runtime / sandbox.** One runtime per installed product; modes `embedded` (single-tenant curator only, default off) · `local` · `remote` are host policy. Today's in-process hot loading is `embedded` and is gated first. (§13b, c) |
| Runtime unit | **Per installed product**, not per agent; single-agent products match D-e unchanged. (§13b) |
| PR #1548 | **Folded** into this pack as [LIFECYCLE.md](LIFECYCLE.md); closes superseded on merge. (§13i) |
| First proof consumer | **Seneca mathematics tutor product** for a second learner, then a nontechnical curator. (§13g) |
| Private activation | Preview/Keep by default; standing authorization opt-in per installation within a declared change class and budget; the founder is not the default approver. (§13d) |
| Upstream adoption | Compatible maintenance under the installation's policy; conflicts surfaced precisely; admitted work stays attributable to its release. (§11d, §13a) |
| Platform/tenant | Release, installation, activation, runtime modes = platform substrate; offers/pricing tenant-side. (§13h) |
| 360 re-cut (night) | Six sweeps of the whole spec ([360-GAP-MAP.md](360-GAP-MAP.md)) added data, tutor-agent package, evidence, authority substrate, reconciliation and model-credential beads; premise edges are machine-checkable; lane 2 kernel-port beads deferred; owner defaults recorded in DIRECTION. |
| Building blocks pulled forward (evening) | Thread **identity** record now (timeline shape stays spiked; no product key may use a session id); the **first View slice** as the product canvas; the product lives in **Library and opens as a Thread in Work**. DIRECTION amendment, "Premises pulled forward". |

## Scope of PR #1561

Documentation and beads only. It records the rulings in the ratified pack
(§13, D33, dated banners at every superseded site), amends DIRECTION once,
folds PR #1548, propagates the ratified §9a Thread/Session split into the two
stale spec/handbook examples, and creates epic #1562 with 18 dependency-linked
beads (four initially ready). No code, dependency, schema, Factory policy, merge
authority, infrastructure, customer data or production service changes here;
the first implementation wave includes `nc-0`, which gates the existing
in-process runtime default-off.
