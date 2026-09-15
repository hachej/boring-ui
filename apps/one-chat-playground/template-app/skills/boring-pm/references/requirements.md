# 06 — Write requirements that can guide a build

## Source-backed principle

NASA's checklist emphasizes clear, singular, verifiable requirements, consistent terms, explicit assumptions, and tracked unresolved values [S12](sources.md#s12). Example Mapping separates rules, examples, and unanswered questions [S14](sources.md#s14). Gherkin describes scenarios using context, an event, and an observable outcome [S15](sources.md#s15).

## Boring PM application

Use a product spec for required behavior and a linked implementation spec for the Boring UI design. The user has already selected Boring UI as a constraint; that does not mean framework components should replace a description of the user's task.

Every selected requirement needs an ID, necessity/rationale, evidence or decision basis, precise behavior, priority, dependencies, and acceptance checks. Add permissions and failure handling when applicable. Keep explanatory prose outside the normative behavior statement.

An effective form is:

> When [trigger] under [conditions], the system shall [one observable behavior] so that [user result, recorded separately as rationale].

Treat compound behaviors as separate requirements or clearly identified subrequirements. Terms such as fast, intuitive, secure, scalable, and accurate need context and a verification method. Do not invent numeric thresholds; record a proposed value or a named unresolved decision.

## Build examples with the expert

For each consequential rule, capture an ordinary example and a case that could reveal a mistake. Consider equality boundaries, missing/stale inputs, invalid states, repeated submissions, interrupted operations, conflicting edits, and unauthorized access where relevant. Unknown expected behavior is an open question, not a passing test.

Example — fictional review tool:

```gherkin
Scenario: An incomplete comparison stays unresolved
  Given a review item has no approved baseline
  When the reviewer opens its comparison
  Then the item is identified as needing a baseline
  And no change percentage is presented as a valid result
```

This is an acceptance specification. It becomes an executable test only after implementation of matching steps and assertions, and it becomes evidence only after execution.

## Cover the whole software contract

| Area | Specify for the selected slice |
| --- | --- |
| Workflow | Triggers, supported states, transitions, completion, cancellation |
| Data | Entities, field meaning, units, source, identity, history, retention |
| Interfaces | Inputs/outputs, errors, version assumptions, real dependencies |
| Permissions | Actor, action, resource, context, and enforcement point |
| Quality | Relevant workload, target, measurement method, tolerated failure |
| Human control | Review, explanation, correction, undo, escalation |
| Operations | Hosting/access, restart/recovery, support owner, export |
| Measurement | Outcome definition, event source, baseline, target, review point |

Accessibility is a requirement to specify and test; choosing a component library does not establish conformance. Select the relevant WCAG target and checks using W3C's guidance [S18](sources.md#s18).

## Readiness review

Can the expert predict what the system will do on the examples? Can an engineer identify required behavior without inventing a domain decision? Can a reviewer determine whether it worked? Resolve blockers for the current slice and track deferred questions with an owner. Use [the product spec](../assets/templates/06-product-spec.md) and [Boring UI spec](../assets/templates/07-boring-ui-spec.md).
