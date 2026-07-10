I have everything I need. The prior-art comparison is decisive: `ask-user` ships a concrete `FileAskUserStore` + interface but **no conformance suite and no `ctx`/workspace threading** — the plan's Slice 1 invents both. The plugin isn't composed into any app yet, so the entire route surface is test-only today. Here is the review.

---

# Thermo-nuclear code-quality review — `docs/issues/590/plan.md`

Scope: the **plan's** structure, not the implementation. I read the plan, issue #590, the cited prior art (`plugins/ask-user`), the `WorkspaceServerPlugin` contract, `workspaceShellCapabilities`, and the already-committed Slice-1 code as a reality-check on the plan's claims.

## Verdict

**Request changes.** The plan is disciplined about *sequencing* (spike-first, no hidden `setInterval`, transcripts stay in the session store, verified seam claims) but it fails its own bar on *structure*. Slice 1 front-loads the full complexity tax of hosted multi-tenancy — a two-implementation store abstraction, a cross-implementation conformance suite, a `ctx: {workspaceId?}` seam threaded through 12 methods, and per-entity workspace scoping — while **every hosted gate is explicitly deferred and un-decided** (Slice 0 topology, Slice 5a migration ownership). That is speculative generality: building the abstraction from one example and freezing its semantics before the second implementation's constraints exist. The cited prior art (`AskUserStore`) does none of this. Net: Slice 1 is roughly twice the concept count it needs to deliver a local file store.

Calibration — what's genuinely right, so this isn't read as reflexive: the no-lifecycle-hook constraint is real (verified: `WorkspaceServerPlugin` has no dispose/timer hook), the deterministic `run-now`/`run-due` route model instead of a route-registration timer is correct, `openDetachedChat(sessionId)` exists as claimed, and keeping run→session linkage by `sessionId` rather than duplicating transcripts is the right ownership call. Keep all of that.

## Structural blockers

**B1 — Conformance suite + store abstraction mandated in Slice 1 with a single implementation.** The plan makes "Shared store conformance suite authored in Slice 1 and reused by every implementation" (Flag/Abstraction) and "Shared store conformance tests exist from Slice 1" (Acceptance) hard requirements. But the only Slice-1 implementation is `FileAutomationStore`; the `PostgresAutomationStore` it's meant to certify is gated behind Slice 0 (topology) **and** Slice 5a (migration ownership), both undecided. A conformance suite with one implementation is that implementation's own test suite wearing a costume — it certifies nothing cross-cutting. Prior art disagrees with the plan: `ask-user` ships `FileAskUserStore` + a `MemoryAskUserStore` test double and **zero** conformance suite. Designing the shared contract from one example, then locking it, is the opposite of "no speculative layers."

**B2 — The store contract bakes in file-store object semantics that Postgres cannot honor; the abstraction is broken at birth.** `AutomationRunPatch` uses `null` to mean *delete the key*, and the Slice-1 conformance suite (`automationStoreConformance.ts:158-160`) asserts `.not.toHaveProperty("sessionId")` / `.not.toHaveProperty("error")` after a null patch. A SQL row returns `sessionId: null` — the property is present with a null value; it is never an *absent key*. So the very suite the plan makes canonical in Slice 1 is unsatisfiable by the `PostgresAutomationStore` it exists to validate, without read-time null-stripping contortions. The plan's "Proposed Types" invite this by shipping a JSON-blob patch shape as the shared contract. This is a concrete leaky-abstraction that will force a semantics change exactly when the second store lands — erasing the claimed reuse.

**B3 — Run rows are publicly writable over HTTP: canonical-ownership violation.** Slice 1 delivers "Run metadata routes only" and the code exposes `POST /automations/:id/runs` and `PATCH /automations/:id/runs/:runId` (`routes.ts:109,123`). But per the plan the run lifecycle — `queued→running→succeeded/failed`, timestamps, duration, `sessionId`, tokens — is owned by the **executor** (Slice 3). Exposing run create/mutate as public verbs creates a *second writer* for state that must have one canonical owner, lets any client forge run history, and ships write routes whose only legitimate producer doesn't exist until Slice 3 (so they're test-only surface today — the plugin isn't composed into any app yet). Slice 1 needs only `GET .../runs`.

**B4 — `workspaceId` is "optional" in the types but required at runtime — dishonest typing threaded everywhere.** `Automation.workspaceId?`, `AutomationStoreCtx.workspaceId?` (plan "Proposed Types"), yet `requireWorkspaceId` throws on absence and `matchesWorkspace` returns false for `undefined`. The route layer then injects a `"default"` constant (`constants.ts:6`), so the store's "fail closed on missing workspace" branch — which the conformance suite tests as a headline behavior — is **dead in local mode** and only matters for a hosted mode that hasn't been designed. The plan's own multi-paragraph hedge in "Proposed Types" about when `workspaceId` is/isn't a partition key is a symptom: the concept is half-in, half-out. `AskUserStore` threads no such param at all.

## Code-judo redesign opportunities

**J1 — Collapse Slice 1 to a concrete single-workspace store; delete the `ctx` seam.** A thin `AutomationStore` interface for dependency-injection is defensible (ask-user keeps one) — but the `AutomationStoreCtx` first-arg on all 12 methods and the per-entity `workspaceId` are not. `FileAutomationStore` is already single-workspace (one `.pi/automation/store.json` per tree). Introduce workspace scoping only in the hosted slice, as a **store-construction concern** (constructor arg or a decorator), never a param on every call. This deletes the ctx object, the fail-closed tests, and the workspace-scoping tests from Slice 1 — roughly 40% of the contract surface.

**J2 — Fold the prompt into the atomic record; kill the two-write split.** The plan elevates prompt storage to a first-class concept — `promptRef`, a separate `getPrompt/updatePrompt` method pair, a separate `prompts/<id>.md` tree — justified only by "CLI users edit markdown." The cost: `createAutomation` does `writePromptFile()` **then** `mutate(store.json)` as two non-atomic writes outside the `writeChain` serializer; a crash between them leaves an orphan file or metadata with no body. Judo: make the prompt body part of the automation record (single source of truth, single atomic write) and treat the on-disk `.md` as a *projection/export*, not canonical. This removes two contract methods, the `promptRef` indirection, and the atomicity hole — and makes the Postgres mapping the trivial "prompt = text column" the plan already wants, with no method pair.

**J3 — Two run snapshots, not four.** `promptSnapshot`/`modelSnapshot` determine what a run actually did — keep them. `cronSnapshot`/`timezoneSnapshot` are *scheduling* metadata with zero bearing on an executed run's output; snapshotting them per-run adds two required fields to every run, every create call, and every test, justified by nothing in the user stories. The stated rationale ("changing the prompt later doesn't rewrite history") is fully satisfied by prompt+model. If "which schedule fired this" matters, `scheduledFor` (already present) is the answer, not the cron string.

**J4 — Store must not carry HTTP status codes.** `AutomationStoreError` carries `status` (404/400) and `requireWorkspaceId` throws `INVALID_BODY, 400` from inside the persistence layer. That couples the store to HTTP semantics. The store should throw domain errors; the route maps them to status. Clean-boundaries nit, but it's in the plan's contract via the error-code decisions.

**J5 — Delete the `schedule.ts` stub and the pre-enumerated front tree.** `schedule.ts` ships as `export {}` — a speculative empty file for Slice 4 sitting in the Slice 1 package, while the plan simultaneously forbids `scheduler.ts` (Decision after "Initial package shape"). Empty seam files are precisely the speculative layer the bar rejects. Likewise "Initial package shape" hard-codes `AutomationPanel/AutomationCard/PromptEditor/RunsList` — Slice 2 work — as Slice 1 scaffolding. Let each slice choose its own decomposition; don't list files you won't write.

## Slice simplification

- **Ten slices, one ready, gate un-run.** Slices are 0,1,2,3,4,5a,5b,5c,6,7; only Slice 1 is `ready-for-agent`, and Slice 0 — which gates 3/4/5a — hasn't run. You cannot meaningfully spec hosted DB migration ownership (5a), hosted composition (5b), and multi-instance lease/advisory-lock strategy (5c) *before* Slice 0 decides topology and whether hosted is even Postgres. Pre-committing route shapes, store semantics, and a locking strategy now is false precision that Slice 0 will invalidate.
- **5a/5b/5c is one "Hosted" slice tri-sected prematurely.** All three share the same undecided topology gate; splitting them now buys nothing but three review budgets.
- **Recommended shape:** `Slice 0 (spike)` → `Slice 1 (local file store + read-mostly routes + UI-agnostic contract)` → `Slice 2 (UI)`, with everything from Slice 3 onward marked *"to be re-planned after Slice 0."* This also fixes the ordering smell where Slice 1 builds the hosted-facing abstraction *before* Slice 0 says whether hosted needs it.

## Required plan edits

1. **Strike** "Shared store conformance suite authored in Slice 1" (Flag/Abstraction) and the matching Acceptance line. Move the interface + conformance suite to the hosted slice, authored against the real Postgres constraints Slice 0 surfaces. *(B1)*
2. **Remove** `AutomationStoreCtx` and per-entity `workspaceId` from Slice 1 "Proposed Types." Add: workspace scoping is a hosted store-construction concern, not a per-call param. *(B4, J1)*
3. **Change** Slice 1 run routes to read-only (`GET .../runs`). Add: run rows are written only by the executor (Slice 3) through the store, never via public HTTP. *(B3)*
4. **Define** field-clear semantics so they're representable in SQL (nulls are values, not absent keys) — or drop nullable-clear from the Slice-1 contract entirely. *(B2)*
5. **Fold** the prompt body into the automation record as canonical; document `.md` as an export/projection; drop `promptRef` + `getPrompt/updatePrompt` from the core contract (or mark local-only). *(J2)*
6. **Reduce** run snapshots to `promptSnapshot` + `modelSnapshot`; delete `cronSnapshot`/`timezoneSnapshot`. *(J3)*
7. **Delete** `schedule.ts` from the Slice 1 tree and remove the pre-listed unbuilt front files from "Initial package shape." *(J5)*
8. **Collapse** Slices 4–5c and 6 into deferred, to-be-replanned stubs pending Slice 0; stop pre-speccing locking/migration/route shapes. *(Slice simplification)*
9. **Move** HTTP status out of store errors into route mapping in the error-code decision. *(J4)*

## Approval bar

I approve when the plan states that:

- **Slice 1** ships a concrete single-workspace `FileAutomationStore` (a thin DI interface is fine; **no** conformance suite, **no** `ctx`, **no** per-entity `workspaceId`), prompt folded into the record with the `.md` file as a projection, exactly two snapshot fields, and **read-only** run routes.
- The **store abstraction, conformance suite, and workspace scoping** appear only in the hosted slice, designed against the Postgres/topology constraints Slice 0 surfaces — with a patch/field-clear contract that is SQL-representable.
- Everything from **Slice 3 onward** is explicitly marked "re-plan after Slice 0"; 5a/5b/5c are merged into one hosted slice.
- The package contains **no empty seam files and no pre-listed unbuilt UI files.**

The through-line: earn each abstraction with a second caller. Right now the interface, the conformance suite, the `ctx`, the workspace column, and two of four snapshots are all paying rent for a hosted tenant that hasn't signed a lease.
