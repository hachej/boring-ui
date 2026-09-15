# 03 — Extract the expert's decision model

## Source-backed principle

Militello and Hutton's Applied Cognitive Task Analysis uses a task diagram, knowledge audit, and simulation interview to uncover cognitive demands and organize them for design [S04](sources.md#s04). This is especially relevant when an expert can perform a task more easily than they can explain it. The following is a Boring PM adaptation, not the full ACTA protocol or a claim of trained ACTA practice.

## Boring PM application

First identify the few points where judgment changes the outcome. For one such point, reconstruct the available information and the actual choice. Avoid asking the expert to describe their entire mental model in the abstract.

Create a decision record:

| Field | Capture |
| --- | --- |
| Decision | Choice that changes the next action |
| Context | Situation in which the decision applies |
| Inputs and cues | Information the expert used, including what was absent |
| Interpretation | What the signals meant to them |
| Alternatives | Other plausible explanations or actions considered |
| Criterion | Why they chose one action; quantitative only if supported |
| Exception | A situation in which the ordinary rule should change |
| Uncertainty | Missing knowledge, confidence, and escalation conditions |
| Consequence | What happens if the decision is wrong |
| Evidence | Case and source locator supporting this account |

Use contrasting cases: ask why similar inputs produced different outcomes. Change one condition in a hypothetical scenario and ask what would change, clearly labeling the result as hypothetical. Ask which detail a novice might overlook and what would prompt a second opinion.

## Translate judgment into product behavior

| What the expert reveals | Candidate product response — confirm before selection |
| --- | --- |
| A reliable rule with observable inputs | Deterministic calculation with boundary checks |
| A useful but fallible heuristic | Suggestion with rationale and a correction path |
| A crucial missing input | An explicit incomplete state and a request for that input |
| A context-dependent exception | A rule variant with its context made visible |
| A judgment that remains uncertain | Human review, evidence display, and deferred action |
| Several legitimate approaches | User-selectable policy, with provenance and scope |

Do not convert every heuristic into an autonomous action. Whether automation is appropriate depends on error consequences, available inputs, and the user's intended control.

## Recover the domain model

Define the nouns used in the case, their relationships, state transitions, units, and ownership. Distinguish an event (“review completed”) from an entity (“review record”) and a rule (“a missing baseline prevents comparison”). Write one positive and one challenging example for important rules. Keep conflicting interpretations as separate candidate rules until resolved.

## Exit and failure patterns

For the first product slice, another person should understand the decisions, inputs, and failure paths well enough to challenge the proposed behavior. “Use the expert's intuition,” an unexplained confidence score, or a magic threshold is still an unresolved requirement. Use [the domain model](../assets/templates/03-domain-model.md).
