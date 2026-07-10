I have the full history now. Key finding: **both optional refinements from pass2.md are already present in `plan.md`** — refinement #1 (error boundary) at line 127, refinement #2 (commit-point invariant) at line 47. So the "apply then review" precondition is satisfied in the file as it stands; nothing to edit. I verified all six requested checkpoints against the plan text and did an adversarial pass for new/residual issues.

---

# Final thermo-nuclear review — `docs/issues/590/plan.md`

**Precondition check:** Both pass-2 refinements are already in the file — the store↔HTTP error boundary (line 127) and the commit-point/orphan-recovery invariant (line 47). No edits needed.

## Verdict

**GREEN — ship-ready. No blockers.**

All four original structural blockers (B1–B4) and the adopted code-judo findings (J1, J3, J5) remain resolved, and the two precision refinements are now baked in. The plan is internally consistent, storage-neutral by construction, and honestly scopes hosted concerns behind Slice 0. Checkpoint-by-checkpoint:

| Checkpoint | Status | Anchor |
|---|---|---|
| Canonical editable Markdown | ✅ | Decision 5 (43–47); Stories (17); Acceptance (148); scoped away from hosted in Out of Scope (264) |
| Commit-point / recovery invariant | ✅ | Decision 5 (47) — `store.json` last = commit point; both partial-failure states named and tested; Test Seams (136); Acceptance (151) |
| Domain-error / HTTP boundary | ✅ | Known Seams (127) — stores throw domain errors only; route maps to HTTP; persistence carries no status codes |
| Ownership | ✅ | Single run writer / no public create-patch (Decision 6, 49–52; Slice 1, 208–209); transcripts stay in Pi session store (Decision 7); no core leakage (Decision 2) |
| Local-vs-hosted scoping | ✅ | Single-workspace by construction, no threaded `workspaceId` (Decision 4, 38–41); types carry no workspace field (85–114); verified-identity requirement (126); hosted deferred (41, 46, 160, 247, 263) |
| Deferred slices | ✅ | Slice 0→1→2, "Later execution and hosted" = `needs-replan-after-slice-0` (235–247); 5a/5b/5c merged; open questions all owned by Slice 0 (272–281) |

## Blockers

**None.** No structural blocker, ownership violation, speculative abstraction, storage-neutrality gap, or hosted/local boundary leak survives.

## Residual risks

Non-blocking; safe to ship as-is. Track for Slice 1 execution / doc hygiene.

1. **Type sketch vs. null-semantics prose (echo of B2).** The illustrative types (96–114) still use optional `?:` markers, while the footer (117) mandates explicit-`null`, storage-neutral patch semantics. The prose governs and enforcement is correctly deferred to when a second store exists, but when the schemas are formalized in Slice 1 the field types should be reconciled (e.g. `sessionId?: string | null`) so the code doesn't silently reintroduce absent-key semantics.

2. **Orphan cleanup has no named owner/trigger.** The commit-point invariant (47) calls an orphaned prompt file "eligible for cleanup," but no GC actor/schedule is specified. Acceptable at plan altitude — the failure state is tested and non-fatal (never a hard read failure) — but the actual reclamation mechanism is implicitly punted; worth an explicit owner when the executor/hosted slice is re-planned.

3. **Stale Loop Exit pointer.** Loop Exit (287) still cites `thermo-plan-code-quality-opus48.md` (the original *request-changes* pass) as "Thermo plan review," and the state remains gated on PR #592 reconciliation (285, 288). This is honest — the *code* isn't reconciled yet — but the pointer now understates the plan's status; it should reference the GREEN pass-2 / this final review. Documentation nit, not a plan-structure defect.

*(Note: `thermo-plan-code-quality-opus48-final.md` exists but is empty — treat this review as that file's content if it's meant to be persisted.)*
