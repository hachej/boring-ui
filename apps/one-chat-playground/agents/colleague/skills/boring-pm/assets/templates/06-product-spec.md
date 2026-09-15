# Product specification — [name]

Version/date: TBD. Owner: TBD. Intended use: prototype / pilot / production build. Status: draft / ready for named slice / superseded.

## 1. Problem, people, and outcome

Link to brief, supporting evidence, chosen opportunity, and outcome measure. Include baseline and proposed target separately. State missing perspectives. Reference the relevant profile revisions and distinguish the interviewee, product users, builder, and operator.

## 2. Scope

Define the first user, situation, input, task, and useful output. List inclusions, exclusions, manual steps, assumptions, and dependencies. Reference the selected option, alternatives, fit rationale, and reconsideration trigger.

## 3. End-to-end journey

| Step | Actor | Intent/trigger | Input | Observable result | State | Failure/recovery |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## 4. Functional requirement FR-001

- Name:
- Behavior statement:
- User value/rationale:
- Opportunity, evidence, decision, and rule IDs:
- Profile fact IDs where user fit motivates the behavior:
- Priority and release slice:
- Preconditions, trigger, and inputs:
- Required result and state transition:
- Error, cancellation, interruption, and retry behavior:
- Permission context:
- Dependencies:
- Acceptance IDs:

Repeat as needed. Avoid combining independent behaviors into an untestable paragraph.

## 5. Data and interfaces

| Entity/interface | Fields and semantics | Source/identity | Read/write owner | Validation | History/retention | Error behavior |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD |

Identify actual external interfaces, version assumptions, and availability. Define important rule tables and state transitions or link the domain model.

## 6. Access and human control

| Actor | Resource and context | View | Edit | Execute | Approve/export | Enforcement |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD |

Explain human review, uncertainty, explanations, correction, and recovery where relevant. Project data sharing is a separate decision from publishing this reusable knowledge base.

## 7. Nonfunctional requirement NFR-001

| Area | Workload/context | Measurable target or unresolved value | Verification method | Basis/owner |
| --- | --- | --- | --- | --- |
| Performance | Dataset/concurrency/network | TBD | Measured task/request | TBD |
| Reliability/recovery | Failure/restart scenario | TBD | Recovery exercise | TBD |
| Accessibility | User tasks, selected WCAG scope/level | TBD | Relevant automated and manual checks | TBD |
| Data protection | Data, actors, boundaries | TBD | Relevant access/data handling checks | TBD |
| Agent output quality | Representative cases and failure categories | TBD | Reviewed case evaluation | TBD |
| Operating effort/cost | Usage period and workload | TBD | Measurement or labeled estimate | TBD |

Use only relevant rows. Do not claim broad conformance from a small checklist.

## 8. Acceptance

| ID | Requirement | Given | When | Then | Verification type | Result/proof |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | FR-001 | TBD | TBD | TBD | test/demo/inspection/analysis | not_run |

Include the main success path and consequential failure/boundary paths. Specify a representative user task with the intended level of technical experience and permitted help. Cover the onboarding, review, and recovery behaviors required by the selected fit decisions; keep results unrun until exercised.

## 9. Outcome and delivery

Define completion events, exclusions, observation window, baseline/target, and guardrails. Identify the entry point, hosting/access choice, first-task input, operating owner, and user trial. Link the acceptance-and-launch record.

## 10. Unknowns and change history

| Unknown | Blocks which behavior? | Resolution step | Owner | Due/trigger |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD |

Record the selected build boundary and basis for readiness. Keep version, change, evidence/decision, and affected requirement IDs in the change history.
