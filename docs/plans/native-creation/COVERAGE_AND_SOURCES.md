# Coverage, sources, and PR-base reconciliation

> September 7, 2026. Evidence for a **proposed, non-dispatchable** reassessment.
> Document inspection, directory inventory, source inspection, and executed
> runtime conformance are different kinds of evidence. This review does not
> substitute one for another.

## Scope actually completed

The original assessment used
`hachej/boring-ui@4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6`. It retrieved the
complete immediate `docs/` tree: 13 top-level files and 12 directories. It read
the governing documents and selected contracts identified below, with some
parts consulted from earlier reads in the same review conversation.

**It did not read every file under the recursive `docs/` tree.** Bulk tree and
large JSON responses were truncated; a full local checkout/archive was not
available. Large raw transcript imports, archived issue/plan material, and
binary proof assets were not exhaustively read. No total recursive-file count
or all-files-read percentage is asserted. Source-adjacent package documents
were sampled rather than exhaustively audited.

No project tests, live user journey, migration, Factory dispatch, benchmark,
security test, or image-based UI review were executed by that assessment.
Source inspection is not production conformance. Dated architecture findings
are not proof that an old defect remains live. Research summaries are not
primary-source validation of their scientific claims.

The exported reassessment, amendment handoff, and source register were used to
prepare this repository-ready synthesis. This pack preserves the findings,
proposal boundaries, and evidence limits; it is not a verbatim import of those
reports. No new empirical claim is earned by publishing the documentation.

## What changed between assessment and PR base

The connected GitHub read resolved `main` to
`aaa713a19cd4a4236a27f96b5c3eb77261a15ebb`. The
[base comparison](https://github.com/hachej/boring-ui/compare/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6...aaa713a19cd4a4236a27f96b5c3eb77261a15ebb)
reports two commits and one added file:
`docs/plans/agent-interview-intake-plan.md`, added through merged #1559.
The assessed existing files are unchanged across that comparison.

For PR preparation, `AGENTS.md`, `docs/README.md`, the full v2 implementation
specification, the new intake proposal, and `scripts/check-strategy-docs.sh`
were fetched at the PR base. The intake proposal was read in full. It provides
relevant typed-brief/confirmation/provenance design input and explicitly leaves
execution, reports, and revision outside its proposed scope. Its stated Seneca
production behavior and model-specific lessons were not independently tested.

#1548 was re-read through PR metadata: it remains open/draft at
`cb6b476aefb8d8fb3b1395a72a006264f5326d8d`, with ten changed Markdown files and
explicitly unbuilt E0–E6 runtime milestones. Its independent-review claims
belong to that PR, not this one. This proposal neither changes its branch nor
inherits its review or production evidence.

A connected lookup that did not expose `hachej/boring-v2` establishes an
access/coordination limitation only, not absence of private or local work.
Default-branch search can lag: discovery of the Seat migration was followed by
a pinned file fetch. A missing search result for `ViewDescriptor` is not used
as proof that all equivalent behavior is absent.

## Immediate inventory treatment

| Area | Inspection level |
| --- | --- |
| `README.md` | Full file; entry point, precedence, and intended documentation ownership. |
| `DECISIONS.md` | Relevant D26–D32 and process sections, not all historical decisions. |
| `PROJECT_ENVIRONMENT_MODEL.md` | Definitions and authority model, approximately lines 1–260. |
| `WORKSPACE_BRIDGE_V1.md` | Operation, attention, runtime, and authorization contract. |
| `credits-launch-plan.md` | Launch choices, implementation, and early limitations; not current commercial strategy verification. |
| Other immediate Markdown files | Inventoried, not deeply re-audited: agent-development map, vertical-deploy guide, fixes, performance, Tailwind isolation, workspace contract, credits UX, launch demo. |
| `direction/`, `roadmap/`, `vision/` | Relevant canonical readings and prior review context; no full-subtree or runtime-verification claim. |
| `plans/` | Governing long-term pack, shell index, Seats plan, and separate draft evolution material sampled in depth; archives/transcript inbox not exhausted. |
| `factory/`, `procedures/` | Factory vision, September 7 delivery procedure, and separately located policy checked; not every procedure. |
| `research/` | Self-improvement tree inventoried; README and delta read. Other chapters and external sources not independently validated. |
| `web/`, `visual/` | Indexes read; linked guides/diagrams not exhaustively audited. |
| `assets/`, `proof/` | Inventoried; no visual assessment of binary assets. |
| `issues/` | Historical references only, not a recursive issue-folder review. |
| New `plans/agent-interview-intake-plan.md` | Full read at PR base; a proposal and reported tenant implementation, not an executed proof in this review. |

## Source register

The labels below are local to this repository pack. Normal links are pinned to
the original assessment baseline. A document's location under `ratified/` does
not override later explicit supersession or turn plans into implementation.

| Label | Source | What was inspected and what it supports |
| --- | --- | --- |
| S01 | [Documentation index](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/README.md) | Full file; precedence, cold-start route, package/program ownership. Re-fetched unchanged at PR base. |
| S02 | [Ratified vision](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/long-term/ratified/VISION.md) | Full file in chunks; R-a successor/port strategy, evidence-ready amendment, Product deferral, optimization framing and non-goals. |
| S03 | [V2 implementation specification](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md) | Full file; M0–M8, layer responsibilities, stale Thread example and session-port wording. Re-fetched unchanged at PR base. |
| S04 | [Architecture plan](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md) | Approximately first 230 lines; dated authority/record/recovery findings and older ordering graph, not fresh verification of historical defects. |
| S05 | [Reconciliation](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/long-term/ratified/RECONCILIATION.md) | Later sections freshly read, earlier sections from prior readings; §9a Thread root with 0..n Sessions, optional Experiences, staffing, multi-author presentation and explicit non-changes. |
| S06 | [Decisions](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/DECISIONS.md) | Relevant D26–D32, overlapping reads; static fleets/publication restrictions, gateway, sandbox/lease separation, additive signup. |
| S07 | [Port Handbook](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/long-term/ratified/V2-PORT-HANDBOOK.md) | Approximately first 210 lines; semantic operations/Views, renderer prohibition and deferred Product/Customization. |
| S08 | [Plugin contract](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/packages/workspace/docs/PLUGIN_SYSTEM.md) | Approximately first 210 lines; separate front/server lifecycle, revision meaning, trusted local generated code, hosted-tier limits. Relevant front/server source contracts were also inspected in the original review. |
| S09 | [WorkspaceBridge](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/WORKSPACE_BRIDGE_V1.md) | Registered operations, domain checks, identity, session-bound attention and runtime authorization. |
| S10 | [Seats plan](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/workspace-agent-seats.md) | Approximately first 210 lines; enrollment scope and explicit release/activation exclusions. |
| S11 | [Seat migration](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/packages/core/drizzle/0026_workspace_agent_seats.sql) | Full source; durable identity/enrollment schema. Migration was not executed. |
| S12 | [Shell pack index](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/plans/multiagent-shell/README.md) | Full file; shell design, fixture/proof limits, durability/attribution dependencies. |
| S13 | [Risk-based delivery](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/procedures/boring-loop.md) | Full file; September 7 policy and explicitly incomplete broader automation rollout. |
| S14 | [Factory policy](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/.agents/factory/policy.yaml) | Full config; old allowlist/300-line predicate. Live enforcement not tested. |
| S15 | [Factory vision](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/factory/VISION.md) | Full file; internal engineering conventions and amended human boundaries. |
| S16 | [Self-improvement synthesis](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/research/recursive-self-improvement/README.md) and [delta](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/research/recursive-self-improvement/05-delta.md) | Both read; evaluation/measurement agenda and explicit source caveats. External numerical/novelty claims are not reasserted here. |
| S17 | [Workspace Evolution PR #1548](https://github.com/hachej/boring-ui/pull/1548) and [pinned plan](https://github.com/hachej/boring-ui/blob/cb6b476aefb8d8fb3b1395a72a006264f5326d8d/docs/plans/workspace-evolution/README.md) | Separate draft branch; lifecycle design context, scope, proof levels and explicitly unbuilt runtime milestones. Current metadata rechecked for this PR. |
| S18 | [Credits launch plan](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/credits-launch-plan.md) | Launch choices and early limitations; payment correctness is not generalized pricing strategy. |
| S19 | [Interview intake](https://github.com/hachej/boring-ui/blob/aaa713a19cd4a4236a27f96b5c3eb77261a15ebb/docs/plans/agent-interview-intake-plan.md) | Full PR-base read; typed briefs/confirmation/frozen provenance and explicit exclusions; production/provider claims not independently tested. |

Sequencing context also comes from the original reading of
[DIRECTION](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/direction/DIRECTION.md)
and the [roadmap index](https://github.com/hachej/boring-ui/blob/4a08466fd2ccd53ed720e217d1c91d5bf67cb8e6/docs/roadmap/README.md).
Their authority is retained; this pack does not schedule work.

## Verification boundary for adoption

The PR receipt records the actual text/patch checks and hosted-check status for
its revision. No application behavior changes, so no application test result
or runtime proof is asserted. Independent architecture/standards review and
owner decisions for proposed changes must not be inferred from author review,
this source register, another PR's review, or a green Markdown check.

Before dispatch, use a complete checkout to reconcile current types and plans,
repeat relevant link/strategy checks, choose the actual implementation home,
and obtain the required reviews. Revalidate any load-bearing upstream-runtime,
scientific, economic, security, or deployment claim against primary evidence.
