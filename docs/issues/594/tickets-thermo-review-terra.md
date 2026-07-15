# Thermo review — #609–#614 against #594

**VERDICT: NOT READY**

## Blocking findings

1. **Blocker — #609 acceptance is insufficient to preserve native Pi interoperability.** `docs/issues/594/plan.md` requires append-only writes of the latest `session_info`, effective-transcript resolution for wrapper-linked sessions, concurrent-append safety, cache invalidation, and direct/wrapper test coverage. Ticket #609 only says that direct and wrapper-linked transcripts “preserve the renamed title” (`GitHub issue #609`), leaving the persistence algorithm and stale-list behavior unspecified. Implementers can satisfy the ticket with Boring-only metadata or a transcript rewrite, violating the plan.

2. **Blocker — #609 does not assign the complete shared-service vertical slice.** The plan’s Slice 1 explicitly includes `SessionStore.rename`, the server application-service method with stable error mapping, authenticated HTTP rename route, and `usePiSessions.rename` optimistic rollback/refresh (`docs/issues/594/plan.md`, “Slices” / “Test Seams”). #609’s acceptance only names an unspecified shared service and route. It does not require the store/service/transport/hook seams or stable 404/validation behavior, so #610 and #612 have no reliable contract to consume.

3. **Blocker — #611 omits the security and response contract needed by Tasks.** The plan requires a *scoped, bounded bulk* seam that maps requested IDs, omits unauthorized IDs, and does not cold-instantiate Pi; it also requires a hosted nonlocal-owner fallback/affinity rule (`docs/issues/594/plan.md`, “Live task activity” and Test Seam 8). #611 lists state labels but no requested-ID authorization/omission, bounded request/response, no-cold-start invariant, or concrete affinity fallback. This permits a leaking or per-session implementation and leaves #613 unable to safely distinguish absent/unauthorized from idle.

4. **Blocker — #612 lacks the required binding-store and route contract.** The plan mandates `TaskSessionBindingStore` with `list/link/unlink`, exact authenticated POST routes, caller workspace identity ignored, an in-process per-store write queue plus atomic temp-file rename, and a shared conformance suite including concurrent link+unlink (`docs/issues/594/plan.md`, “Task binding persistence” / “Task plugin routes”). #612 says only “concurrent file writes do not lose records”; it neither establishes the interface/routes nor assigns idempotency and concurrent link+unlink conformance. #614 consequently has no stable DB-neutral contract to implement.

5. **Blocker — #612 does not define the create-and-link transaction/failure behavior.** The vertical flow requires a normally shaped native Pi session with task-prefix title, explicit binding, then opening the chat; link must authorize the session before persistence, and unavailable targets must remain unlinkable (`docs/issues/594/plan.md`, “Task-card session disclosure” / “Task binding persistence”). Ticket #612 names these outcomes individually but not the ordering or cleanup/retry behavior when creation, binding, or opening fails. Different implementations will create orphan sessions, dangling bindings, or open unbound chats.

6. **Blocker — dependency boundaries create avoidable churn and leave the planned Slice 3 incomplete.** #612 is marked blocked by #610 (`GitHub issue #612`), even though the plan says binding CRUD can proceed independently and Slice 3 is blocked by Slice 1 for title rename and Slice 2 for authoritative activity (`docs/issues/594/plan.md`, “Slice 3”). Conversely #612 owns the task-card disclosure but excludes the required working indicators, moving them to #613. The graph serializes independent binding work behind the agent tool while leaving disclosure/component APIs likely to be reworked when #613 adds polling/activity state.

7. **Blocker — #613 does not cover the plan’s interaction and failure states for activity.** The plan requires active sessions sorted first, active-count indicator navigation (open direct or chooser), bounded interval plus refresh after binding/**opening** actions, inline loading/retry without collapsing cards, and text/reduced-motion accessible working state (`docs/issues/594/plan.md`, “Live task activity” / “Task-card session disclosure”). #613 only asserts priority roll-up and polling generally. It leaves no acceptance owner for indicator navigation, failure UX, loading state, ordering integration, or the required closed-pane transition coverage.

8. **Blocker — #614 does not require hosted authorization wiring or an end-to-end durable proof.** The plan requires core composition injection while Tasks remains DB-neutral, workspace-keyed records, the same route-level authorization policy, Postgres unique-index transaction/upsert semantics, and restart **plus sandbox replacement** integration evidence (`docs/issues/594/plan.md`, “Task binding persistence” / “Slice 4”). #614 names conformance, uniqueness, and survival but does not require the authorization/service wiring or transaction/upsert behavior; a store-only implementation could pass unit conformance yet be unused by hosted composition or permit cross-workspace records.

## Residual risks

- The ticket bodies contain no explicit test/proof assignments from the plan’s required coverage, so cross-package regressions and local Pi compatibility can be declared complete without executable evidence.
- Exact endpoint/service interfaces are absent from tickets, increasing parallel implementation drift across agent, workspace, Tasks, and hosted-core packages.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Eight concrete blocking findings cite docs/issues/594/plan.md and GitHub issues #609–#614, with severity and affected contract areas."
    }
  ],
  "changedFiles": [
    "docs/issues/594/tickets-thermo-review-terra.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "for n in 609 610 611 612 613 614; do gh issue view $n --json number,title,body,labels,state; done",
      "result": "passed",
      "summary": "Retrieved all six open ticket bodies for comparison against the plan."
    }
  ],
  "validationOutput": [
    "Review completed against docs/issues/594/plan.md; no code or tests changed.",
    "VERDICT: NOT READY"
  ],
  "residualRisks": [
    "Required test/proof ownership is not assigned in the ticket set.",
    "Unspecified cross-package contracts risk implementation churn."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review artifact only; no implementation edits.",
  "reviewFindings": [
    "blocker: GitHub issue #609 / docs/issues/594/plan.md - native Pi rename persistence and full service seams are under-specified.",
    "blocker: GitHub issue #611 / docs/issues/594/plan.md - bulk activity authorization, bounds, and hosted affinity contract are absent.",
    "blocker: GitHub issue #612 / docs/issues/594/plan.md - binding store, routes, conformance, and create-link failure contract are absent.",
    "blocker: GitHub issues #612-#613 / docs/issues/594/plan.md - dependency and UI ownership split causes churn.",
    "blocker: GitHub issue #614 / docs/issues/594/plan.md - hosted authorization/composition and transaction contract are incomplete."
  ],
  "manualNotes": "Review-only task. Output written to the required authoritative path."
}
```