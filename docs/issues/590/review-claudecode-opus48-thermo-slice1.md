I now have a complete picture: source, tests (17 passing), typecheck (clean), the plan, and the canonical seams (`WorkspaceServerPlugin`, sibling `tasks`/`ask-user` plugins, agent middleware). Here is the audit.

---

# Thermo-Nuclear Code Quality Audit — PR #592 / Issue #590 Slice 1 (`boring-automation`)

## Verdict

**APPROVE with required nits.** This is a genuinely clean, disciplined Slice-1 landing. The plugin is self-contained, mirrors the canonical `defineServerPlugin` / default-export-`ctx.workspaceRoot` shape used by sibling `tasks`/`ask-user` plugins, honors every gate in `plan.md` (no hidden timer, no execution, no session launch, empty `schedule.ts` stub), and ships a reusable store-conformance suite as promised. `pnpm --filter @hachej/boring-automation test` → **17/17 green**; `typecheck` → **clean**. File sizes are healthy (largest is `fileStore.ts` at 296 lines; nothing is a god-file). The plan's architectural claims are grounded in reality — I verified `WorkspaceServerPlugin` has no `dispose`/lifecycle hook (`defineServerPlugin.ts:28-54`), so the "no plugin-owned background timer" decision is correct, not hand-waving.

There are **no correctness bugs that break Slice-1 scope**. The one thing I'd insist on fixing *in this PR* is a fail-open default that is being frozen into the shared conformance contract — cheap now, expensive after `PostgresAutomationStore` inherits it.

## Blocking findings

None that break Slice-1 behavior. One item (BF-1) is "borderline / fix-before-merge" because this PR is where the multi-implementation contract calcifies.

**BF-1 (elevated) — Fail-open workspace scoping is being baked into the reusable store contract.**
`matchesWorkspace` returns `true` whenever `ctx.workspaceId` is falsy (`fileStore.ts:225-228`), and the conformance suite explicitly asserts this as intended: *"treats undefined workspace context as an explicit unscoped store access"* reads another workspace's automation and run through an empty `{}` ctx (`automationStoreConformance.ts:112-131`). Today it's unreachable via HTTP because `workspaceCtxFromRequest` always falls back to `"default"` (`routes.ts:145`). But the conformance suite is, per the plan, *"the shared store conformance suite reused by every implementation"* — so the future `PostgresAutomationStore` will be **required by the test contract** to return cross-tenant rows when `workspaceId` is absent. That is a fail-open multi-tenant read locked in at the exact moment the contract is authored. Fix now: make empty ctx **fail closed** (return `[]` / `null` / throw), and invert that conformance test to assert isolation. This is a one-line store change plus a test flip while there is exactly one implementation; after Slice 5a it is a security-relevant contract migration.

## Non-blocking findings

**NBF-1 — Run-patch field list is triplicated; adding one field touches four sites.**
`AutomationRunPatch` (`types.ts:76-87`), `AutomationRunPatchSchema` (`schema.ts:50-61`), `setRunField` (`fileStore.ts:243-257`), and `deleteNullableRunField` (`fileStore.ts:259-272`) each hand-enumerate the same ~10 fields. Adding `costUsd` (Slice 6 is literally about token/cost fields) means editing all four, and forgetting `deleteNullableRunField` fails silently (the `default: break` swallows it — no error, the null-clear just no-ops). This is the single biggest spaghetti-growth vector in the diff. See Code-judo CJ-1.

**NBF-2 — Run snapshots are client-authored, not server-captured.**
`POST /automations/:id/runs` trusts `promptSnapshot`/`modelSnapshot`/`cronSnapshot`/`timezoneSnapshot` straight from the request body (`routes.ts:109-121`); `createRun` stores them verbatim (`fileStore.ts:135-142`). The plan's headline guarantee — *"changing the automation prompt later does not rewrite prior run history because each run stores snapshots"* — only holds if the snapshot is captured server-side from the automation at run-creation. Nothing currently binds the snapshot to the automation's real state. Acceptable for metadata-only Slice 1, but leave a `// TODO(Slice 3): capture snapshots server-side from the automation` at the createRun route or the guarantee is illusory once execution lands.

**NBF-3 — Cache diverges from disk on write failure.**
`mutate` mutates the shared in-memory `state` object in place *before* `writeAtomic` resolves (`fileStore.ts:187-195`). If the disk write throws, the cache is now ahead of the persisted file and every subsequent read serves the un-persisted mutation (the cache is never invalidated on failure). Low severity for local single-process CLI; worth a comment, and worth remembering before this store shape is reused anywhere durable.

**NBF-4 — `PATCH …/runs/:runId` does an O(runs) scan + full clone just to authorize, then re-loads.**
The route calls `listRuns(ctx, id)` (loads state, filters, `.map(clone)` of every run) only to check the run belongs to that automation, then calls `updateRun` which re-loads and re-validates workspace (`routes.ts:123-136`). Two passes + N clones for a one-row update. Correct, just wasteful and missing a seam — see CJ-2.

**NBF-5 — `String(value)` / `Number(value)` coercions are dead defense.**
In `setRunField` (`fileStore.ts:243-257`) every value is already type-validated by `AutomationRunPatchSchema` at the route and by the typed `AutomationRunPatch` for direct store callers. The coercions imply an untrusted `unknown` that the types say can't occur, and they'd silently mask a real type violation (`Number(garbage)` → `NaN` persisted). Drop them with CJ-1.

**NBF-6 — Local structural re-declaration of `workspaceContext`.**
`WorkspaceRequest = FastifyRequest & { workspaceContext?: { workspaceId?: string } }` (`routes.ts:25-27`) duplicates the canonical `WorkspaceContext` (`middleware.ts:21-24`, where it's a *required* `workspaceId: string`). This is defensible — the agent's `declare module 'fastify'` augmentation is a different package and can't be relied on cross-package — but there's no shared exported type for plugins to reuse, so the contract drifts by hand. Additionally, once composed under agent middleware (which *always* populates `workspaceContext`), the `x-boring-workspace-id` header branch (`routes.ts:142-144`) becomes dead. Fine for now; note it so it isn't mistaken for load-bearing later.

**NBF-7 — No cron/timezone semantic validation.**
`cron` and `timezone` are `nonEmptyString` only (`schema.ts:14-15`), so `"not a cron"` / `"Mars/Phobos"` persist happily. Plan-consistent (validation is deferred), but it means the store can hold un-runnable automations before Slice 4 ever looks at them. Flagging for traceability, not action.

**NBF-8 — Test hygiene: shared fixed tmp path.**
`appWithStore`'s default store points at a fixed `${tmpdir()}/boring-automation-unused` (`routes.test.ts:10`). Only used by the fs-free `workspaceCtxFromRequest` block today, but it's a latent cross-test-contamination footgun the moment someone reuses the default in an fs assertion. Prefer a per-test `mkdtemp` like `TempStore` already does.

## Code-judo opportunities

**CJ-1 — Collapse `applyRunPatch` + `setRunField` + `deleteNullableRunField` (~45 lines → ~10).** Replace the three hand-rolled switches with one typed key list. This kills NBF-1 and NBF-5 at once and makes Slice 6's new fields a one-line edit:
```ts
const NULLABLE_RUN_FIELDS = [
  "sessionId","scheduledFor","startedAt","completedAt",
  "durationMs","inputTokens","outputTokens","totalTokens","error",
] as const

function applyRunPatch(run: AutomationRun, patch: AutomationRunPatch): AutomationRun {
  const next: AutomationRun = { ...run, updatedAt: nowIso() }
  for (const [key, value] of Object.entries(patch) as [keyof AutomationRunPatch, unknown][]) {
    if (value === undefined) continue
    if (value === null) delete (next as Record<string, unknown>)[key]
    else (next as Record<string, unknown>)[key] = value
  }
  return next
}
```
(Values are already schema/type-validated upstream, so the per-field coercion buys nothing.)

**CJ-2 — Add `getRun(ctx, automationId, runId)` to the store contract.** It removes the double-scan in NBF-4, gives the route a single authoritative "belongs to this automation + this workspace" check, and drops naturally into the conformance suite so every implementation gets it for free. The route's `listRuns(...).find(...)` becomes one call.

**CJ-3 — Stop persisting `promptRef`; derive it.** `promptRef` is *always* `prompts/${id}.md` — it's already re-derived by `promptRefForId` (`fileStore.ts:221-223`) and pinned on update (`fileStore.ts:85`). Storing a fully-derivable field is denormalization that can only ever drift. Either drop it from stored state and compute on read, or keep it but delete the redundant re-pinning. Minor, but it's free spaghetti removal.

**CJ-4 — Consider hoisting the request→ctx resolver.** `workspaceCtxFromRequest` (`routes.ts:139-146`) and the `tasks` plugin's `workspaceIdFromRequest` (`tasks/src/server/index.ts:7-12`) are the same idea implemented twice with different fallback policy. Not for this PR, but the second plugin to reinvent header/`workspaceContext`/default resolution is the signal that a tiny shared `@hachej/boring-workspace/server` helper is warranted before a third appears.

## Approval bar

| Gate | Status |
|---|---|
| Proof commands pass (`test`, `typecheck`) | ✅ 17/17, clean |
| Scope matches plan (shell + file store + CRUD, **no** execution/scheduler/session) | ✅ faithful; `schedule.ts` correctly an empty stub |
| Canonical layer usage (`defineServerPlugin`, default-export ctx, header resolution) | ✅ matches sibling `tasks`/`ask-user` |
| Abstraction quality (`AutomationStore` + shared conformance) | ✅ clean seam, right altitude |
| File sizes / spaghetti | ✅ no god-files; one localized DRY hotspot (NBF-1) |
| Type/boundary cleanliness | 🟡 fail-open scoping (BF-1), local `workspaceContext` re-decl (NBF-6) |
| Maintainability | 🟡 four-site field duplication (NBF-1/CJ-1) |

**Bar to merge:** Fix **BF-1** (flip the fail-open conformance contract to fail-closed while there's one implementation) and land **CJ-1** (it's the cheapest durable maintainability win in the diff and directly de-risks Slice 6). Everything else is genuinely non-blocking and can ride as follow-ups. Absent BF-1, this is a merge-ready, well-gated slice — the kind of restraint (stubbing `schedule.ts`, refusing to hide a timer in route registration, authoring the conformance suite up front) that most Slice-1 PRs skip.

One thing I did **not** do: verify the plugin actually composes into any app — it is intentionally wired nowhere yet (`grep boring-automation apps/` → empty), which is plan-correct for Slice 1 but means none of this has run inside a real workspace. First integration is where NBF-6's header-vs-`workspaceContext` resolution and BF-1's default actually get exercised, so keep them on the radar for the Slice-2 composition PR.
