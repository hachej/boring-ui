# Native creation and maintained expert software

> **PROPOSED — NON-DISPATCHABLE.** September 7, 2026. This pack translates the
> owner's Seneca vision and the documentation reassessment into a reviewable
> product obligation, amendment proposal, and acceptance plan. It is not an
> owner ratification, implementation claim, new roadmap authority, or permission
> to change runtime policy. `docs/direction/DIRECTION.md` remains the only
> executable ordering. Recording this proposal does not activate it.

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
| [Reassessment](REASSESSMENT.md) | Findings, lifecycle responsibilities, replacement hypothesis, and what existing work already supplies. |
| [Proposed amendments](DOCUMENT_AMENDMENTS.md) | Suggested ruling text, exact documentation targets, migration obligations, and crosswalk to existing M/E work. Nothing in its edit map is silently applied. |
| [Coverage and sources](COVERAGE_AND_SOURCES.md) | Pinned evidence, inspection limits, and the reconciliation from the assessment baseline to this PR's base. |

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

These are acceptance stages to map into existing work after ratification, not
new dispatch codes or permission to bypass dependencies.

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

## Decisions still open

| Decision | Recommendation, not an owner answer |
| --- | --- |
| First proof consumer | A bounded mathematics product as the technical tracer, followed by a nontechnical expert's real workflow. Founder use alone is not usability proof. |
| Private activation | Permit explicit standing authorization within a declared scope and budget; offer preview/Keep. Routine private changes should not require founder approval. Existing authority is unchanged until the corresponding policy is approved and enforced. |
| Upstream adoption | Compatible maintenance under the installation's declared policy; meaningful method changes and conflicts surfaced; admitted work remains attributable to its effective release, subject to current revocation. |
| Execution home | Identify any existing `boring-v2` work, select one implementation home, and record incumbent maintenance/cutover ownership before starting a successor. Repository lookup failure does not prove absence. |

## Scope of the documentation PR

The pack records proposals and makes them discoverable from the documentation
index. Its separate correction to `V2-IMPLEMENTATION-SPEC.md` only propagates
the already-ratified RECONCILIATION §9a Thread/Session split into a stale
example and associated port wording. It does not choose the Thread storage
shape, alter milestones, or ratify the new creation program.

No code, dependency, schema, Factory policy, merge authority, infrastructure,
customer data, or production service is changed. Existing pending decisions
and the separate #1548 branch remain untouched. To adopt the new direction,
record the selected rulings and explicit supersessions in the existing
ratified documents, reconcile #1548, and amend DIRECTION once. Do not dispatch
from this pack merely because its documentation PR exists or is merged.
