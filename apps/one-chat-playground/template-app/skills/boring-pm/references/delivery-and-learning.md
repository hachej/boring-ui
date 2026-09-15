# 08 — Get the product into the user's hands

## Source-backed principle

GOV.UK recommends combining performance data with user research and evaluating complete journeys, including task completion and elapsed time [S17](sources.md#s17). Boring UI provides a chat-and-workbench framework; its public documentation assigns production operation to the consuming application [S19](sources.md#s19). Boring PM's delivery checklist below is a proposed operating contract.

## Boring PM application

Define the handoff while choosing the first slice: what the user will open, what input they will supply, what result they will inspect, and what action completes the task. Work backward to the smallest integrated implementation that supports that loop.

Track three distinct levels of completion:

| Level | Necessary evidence |
| --- | --- |
| Specified | Requirements and examples are clear enough to guide the agreed next build |
| Implemented | Real code executes the relevant successful and unsuccessful paths |
| Delivered | Intended user has access, completes the task, and can retain or recover the result |

Shipping a preview may count as delivery of an explicitly scoped prototype. It must not be described as a production service if its operation, access, data handling, or recovery is still provisional.

## Build and verify one outcome

Convert the slice into tasks that each name an observable result and a check. Include actual persistence and external interfaces when the outcome depends on them. A mock is useful during development but does not prove the real integration.

Keep spec changes linked to their evidence and decision. If a technical limitation changes user-visible behavior, update the spec and acceptance examples rather than hiding it in code.

Run the highest-value verification for the real task, including relevant interruptions and errors. Record environment, revision, result, and proof. Report blocked checks plainly. Avoid expanding validation into unrelated work once the agreed risks are covered.

## Handover and adoption

Provide a working entry point, verified access for the intended user, a representative input, short first-task instructions, known limitations, and an operating owner. Decide what happens after restart, data loss, failed integrations, and a user correction. The application owner is responsible for deployment-specific configuration and backup arrangements.

Ask the expert to perform their task on a realistic case. Capture what they did, where they needed help, and whether the output was usable. Feed a substantive mismatch back into the relevant rule or requirement.

## Learn after delivery

Measure the agreed outcome with a clear denominator and observation window. Include failed and abandoned attempts rather than reporting only successes. Compare with a baseline when comparable data exists, and acknowledge differences in workload or participants. A short pilot gives local evidence, not guaranteed sustained impact.

Choose a follow-up action: improve the slice, support another variant, investigate an assumption, or retire the experiment. Use [acceptance and launch](../assets/templates/09-acceptance-and-launch.md).
