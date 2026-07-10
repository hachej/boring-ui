I've completed a close comparison of the revised `plan.md` against the first-pass review (`thermo-plan-code-quality-opus48.md`), checking each structural blocker and code-judo finding, and verifying the user's canonical-Markdown requirement survived the revision.

---

# Thermo-nuclear second-pass review — `docs/issues/590/plan.md`

## Verdict

**GREEN.**

The revision addresses all four structural blockers (B1–B4), the code-judo findings (J1, J3, J5), and the slice-count/hosted-precision problems, while correctly *not* adopting the one first-pass recommendation (J2) that conflicted with the explicit user requirement. The canonical-editable-Markdown requirement is preserved, and the atomicity hole that made J2 attractive is resolved a different way — by mandating documented, tested recovery instead of pretending two writes are atomic. This is the honest resolution.

I am not rubber-stamping: the remaining items below are genuine, but none rise to a blocker. GREEN is conditioned on nothing — the two refinements are optional polish.

## Addressed findings

| Prior finding | Status | Where in revised plan |
|---|---|---|
| **B1** — conformance suite + store abstraction mandated in Slice 1 | ✅ Fixed | Flag/Abstraction (73–77) explicitly defers cross-store conformance until "a real second store exists"; Slice 1 tests "the concrete `FileAutomationStore` behavior" only (76, 200–201). A thin DI interface is retained — defensible, matches `ask-user` prior art. |
| **B2** — null-means-delete-key semantics unrepresentable in SQL | ✅ Fixed | Types footer (117): "nullable persisted fields use explicit `null` consistently rather than JSON-only 'missing property means cleared' behavior." Storage-neutral by construction. |
| **B3** — run rows publicly writable (POST/PATCH runs) | ✅ Fixed | Decision 6 (49–52): "must not expose generic create/patch run-history endpoints"; Slice 1 delivers "read-only run-history route; no public run create/patch routes" (208–209); Acceptance (149). |
| **B4** — `workspaceId` optional-but-required, `ctx` threaded everywhere | ✅ Fixed | Decision 4 (40): "Store calls do not thread `workspaceId`; the host selects the workspace/store before calling plugin logic." `Automation` type carries no `workspaceId` field (85–94). Slice 1: "no per-call workspace context in the local store" (210). |
| **J1** — collapse to concrete single-workspace store, delete `ctx` | ✅ Fixed | Same as B4; scoping is a construction-time / hosted concern (41). |
| **J2** — fold prompt into record, `.md` as export | ⚠️ Correctly *not* adopted | J2 conflicts with the user requirement. Plan keeps Markdown canonical (Decision 5, 43–47) and instead neutralizes the atomicity hole J2 flagged by requiring documented/tested orphan-recovery (47, 135, 150). Right call. |
| **J3** — two run snapshots, not four | ✅ Fixed | Decision 8 (58–62): only `promptSnapshot`/`modelSnapshot`; "Cron/timezone remain automation configuration, not duplicated on every run." `AutomationRun` type has no cron/timezone snapshot (96–114). |
| **J5** — delete `schedule.ts` stub + pre-listed front tree | ✅ Fixed | Slice 1: "no empty `schedule.ts` or future implementation scaffolding" (210); Acceptance "No … empty future seam file ships" (151); Slice 1 delivers only a "placeholder panel/command" (201), UI decomposition pushed to Slice 2 (218–226). |
| **Slice simplification** — 10 slices, 5a/5b/5c premature | ✅ Fixed | Now Slice 0 → 1 → 2, with "Later execution and hosted slices" marked `needs-replan-after-slice-0` (234–246). 5a/5b/5c merged. |
| **Ownership** — transcripts / run writer | ✅ Held | Decision 7 (54–56) transcripts stay in Pi session store; Decision 6 single writer. |
| **Hosted/local boundary** — raw header trust | ✅ Strengthened | Known Seams (126): "raw `x-boring-workspace-id` is insufficient authorization; hosted composition must provide verified identity." Stronger than the first-pass ask. |

**User requirement preserved:** "CLI prompts are canonical editable Markdown" is intact — Decision 5 (43–46), User Stories (17), Acceptance (147), and correctly scoped away from hosted in Out of Scope (263). The plan honored the requirement *over* the first-pass J2 recommendation, which is the correct precedence.

## Remaining blockers

**None.** No structural blocker, ownership violation, speculative abstraction, slice-count inflation, storage-neutrality gap, or hosted/local boundary leak survives.

## Exact required edits

Neither is a merge blocker; both are precision refinements. Ship-as-is is acceptable.

1. **(Optional, from prior edit #9 — J4) Name the store↔HTTP error boundary.** The revised plan dropped the old error-code decision entirely, which *defuses* the "store carries HTTP 404/400 status" concern by omission rather than by statement. To close it explicitly, add one line to Decision 6 or Known Seams: *"The store throws domain errors; the route layer maps them to HTTP status. Persistence code carries no HTTP status codes."*

2. **(Optional — atomicity/recovery precision) State the commit-point invariant.** Decision 5 (47) mandates documented/tested recovery but leaves the write-ordering invariant implicit. Since two resources (`.md` prompt + `store.json` metadata) are non-atomic by requirement, name which write commits and what each partial-failure state means, e.g.: *"`store.json` is written last as the commit point. A prompt file with no store entry is a recoverable orphan (GC'd); a store entry whose prompt file is missing surfaces as an empty-body automation and is repairable — never a hard read failure. Both states are tested."* This turns "document recovery behavior" into a checkable invariant and removes the last ambiguity a strict reviewer can raise on atomicity.

One consistency note (not an edit): Loop Exit (282–288) still correctly flags that the **implementation** (PR #592) must be reconciled to this revised plan — public run-mutation routes, per-call workspace context, absent-key patch semantics, and empty scaffolding must be removed from the code before merge. The plan is green; the code is not yet, and the plan says so honestly.
