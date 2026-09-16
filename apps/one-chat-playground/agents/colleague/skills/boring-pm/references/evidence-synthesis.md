# 04 — Turn notes into traceable product inputs

## Source-backed principle

Opportunity solution trees connect outcomes, opportunities, alternatives, and assumption tests [S07](sources.md#s07). NASA's requirements guidance calls for traceability to stakeholder expectations and scrutiny of assumptions [S13](sources.md#s13). Boring PM adapts those ideas into a compact evidence chain appropriate for a small software product.

## Boring PM application

Give each record a stable ID. The identifier is a reference, not a statement of confidence.

| Prefix | Record | Example purpose |
| --- | --- | --- |
| E | Evidence | A timestamped observation or reported case |
| O | Opportunity | A need inferred from evidence |
| R | Domain rule | Behavior or constraint asserted in the domain |
| A | Assumption | Something that must be true but is not established |
| D | Decision | A chosen course and its rationale |
| FR / NFR | Requirement | Functional behavior / quality constraint |
| AC | Acceptance check | Observable condition to verify |
| EXP | Experiment | Planned or executed uncertainty-reduction activity |

For each evidence item preserve origin, date, participant role, locator, case context, and label. Confidence should include a reason; it is not an invented probability.

| Label | Meaning | Limit |
| --- | --- | --- |
| `observed` | Directly inspected behavior or artifact | Applies to the inspected case and conditions |
| `reported` | A person says something occurred or is true | Account has not been independently confirmed |
| `inferred` | An interpretation derived from other evidence | Must retain its supporting references |
| `assumed` | Provisional input chosen for progress | Needs a test or an explicit decision to carry the risk |
| `unknown` | Relevant information is unavailable | Cannot support a confident conclusion |

## Synthesize without erasing uncertainty

Cluster notes around tasks, decisions, and difficulties. Write an opportunity as a need in context, then link the evidence that suggests it. Keep solution ideas in a separate field. Include counterevidence, alternative explanations, and affected user segments.

Next create a decision record for what to address first. A requirement may originate in an observed need, a user decision, or a necessary implementation constraint; name which. Trace supporting evidence through the chosen opportunity and decision rather than citing a research article as proof that a customer needs the feature.

Resolve contradictions by comparing context, recency, definitions, and source authority for that specific claim. If still unresolved, preserve the competing accounts and limit the product slice accordingly.

## Review and change

Play back a short synthesis with the expert. Record corrections as new evidence or revisions with provenance. If an underlying rule changes, inspect the requirements, checks, and implementation decisions that reference it. Never silently replace old IDs or mark a belief `observed` because the expert agrees with your wording.

Use [evidence](../assets/templates/02-evidence.md) and [decisions](../assets/templates/11-decisions.md). Project evidence belongs in the project's designated workspace; public method sources remain in this repository.
