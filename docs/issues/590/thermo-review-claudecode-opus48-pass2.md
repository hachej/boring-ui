Verified the seams. Now I have everything needed.

# Plan Review — `docs/issues/590/plan.md` (final revised)

## Verdict

**Slice 1 is ready to start; ship it.** The final plan applies all four minor edits requested by `thermo-review-claudecode-opus48.md` (edits #1–#3 fully, #4 in substance), and continues to satisfy every blocking finding (B1–B5) and recommended edit from `thermo-review-opus48.md`. All key seam claims re-verified against source. Later slices remain correctly gated behind Slice 0, not ready-to-code — as intended.

Edit-by-edit verification (against the claudecode review's four requests):

| Edit | Requested | Status |
|---|---|---|
| #1 Cite concrete workspace-resolution mechanism | before Slice 1 | ✅ Applied — `plan.md:171` now names `request.workspaceContext?.workspaceId`, the `x-boring-workspace-id` header, and "same default-workspace fallback policy as agent routes"; echoed in Slice 0 (`:227`) and Slice 1 (`:256`). Confirmed real: `packages/agent/src/server/http/middleware.ts`, `routes/piChat.ts`. |
| #2 Correct conformance-suite prior-art claim | before Slice 1 | ✅ Applied — `plan.md:180` now states "There is no reusable store-conformance factory today; `boring-automation` should author a new shared conformance suite in Slice 1." No false `testAskUserStore.ts` factory citation remains. |
| #3 Fix `openChatPane` naming | before Slice 2 | ✅ Applied — `plan.md:169` and `:276` treat `openDetachedChat(sessionId)` as the confirmed plugin-facing seam and `openChatPane` as internal/fallback. Verified: `workspaceShellCapabilities.ts:24` exposes `openDetachedChat`; `openChatPane` is absent from the plugin-facing interface. |
| #4 Name Slice 5a in the hard Slice 0 gate | before later slices | ⚠️ Substantively applied but incomplete at the exact flagged spot — see below. |

## Remaining blockers

**None.** No blocking finding survives. B1 (no lifecycle hook — confirmed: `defineServerPlugin.ts` exposes `routes`/`agentTools`/etc. but no `onStart`/`dispose`), B2 (`sessionLauncher.ts` removed from Slice 1, `plan.md:37`), B3 (hosted topology gated to Slice 0, `:226`), B4 (old Slice 4 split into 5a/5b/5c), and B5 (workspace scoping) are all addressed.

## Edits before Slice 1

**None required.** Edits #1 and #2 are applied. Slice 1 (`:237–264`) is storage + CRUD + conformance suite only, with `scheduler.ts`/`sessionLauncher.ts`/`postgresStore.ts` explicitly excluded (`:37`).

## Edits before later slices

1. **(Minor, non-blocking) Finish edit #4 at the flagged line.** `plan.md:235` still reads *"Review budget: inside; must complete before Slice 3/4."* — it does not name Slice 5a, which was the specific ask. The gate is enforced in substance elsewhere: Slice 5a's `Blocked by` is hard (`:330`, "Slice 0 hosted topology answer; migration ownership decision") and Loop Exit blockers name 5a (`:428`). Recommend updating `:235` to "before Slice 3, 4, and 5a" for consistency, since "Slice 3/4" is now stale (the hosted-DB work moved from Slice 4 to Slice 5a). Does not block any slice.
2. **(Pre-existing, already scoped) Slice 0 must resolve the real seam questions** before Slice 3/4/5a — headless session-launch API, scheduler trigger model, hosted topology, DB migration ownership. Already captured as gates (`:221–235`, `:413–422`); flagged only to keep them hard.

No other changes needed.
