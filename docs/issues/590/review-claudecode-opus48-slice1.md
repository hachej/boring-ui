I now have first-hand verification of every host seam plus two subagent confirmations. I have everything needed to write the review. Let me quickly sanity-check the one transactional concern I identified in `createAutomation` against the exact `mutate` flow — confirming in-memory state diverges from disk on a prompt-write failure.

The flow in `fileStore.ts:67-70` and `185-193` confirms it: `mutate` runs `fn(state)` (which sets `state.automations[id]` **then** awaits `writePromptFile`) before `writeAtomic(statePath)`. `state` is the cached `this.state` object that reads share. So a `writePromptFile` rejection leaves the automation in memory (visible to reads, and persisted by the next successful mutation) while the create call rejects.

Here is the review.

---

# Thermonuclear Implementation Review — Issue #590, Slice 1

## Verdict

**APPROVE for merge.** No blocking defects. Slice 1 delivers exactly its scoped surface (package shell, shared schemas/types/errors/constants, `AutomationStore` interface, `FileAutomationStore` under `.pi/automation`, CRUD + prompt + run-metadata routes, explicit workspace resolution, shared conformance suite). No scope creep — `schedule.ts` is an intentional empty stub, no scheduler/session-launch/Postgres code exists, and run routes are metadata-only.

I independently verified the four host seams the plan flagged as must-confirm, and all four match:
- **Server default-export contract** — host calls `default(entry.options, ctx)` with `ctx.workspaceRoot` populated (`pluginEntryResolver.ts:37,59-62,109`); plugin reads `ctx?.workspaceRoot` (`server/index.ts:33-41`). ✅
- **Route registration** — host does bare `app.register(routes)` with no prefix (`createWorkspaceAgentServer.ts:960-961`), so the plugin's self-prefixed `/api/boring-automation/...` paths land correctly and collision-safely. ✅
- **`request.workspaceContext`** — real decoration (`agent/.../middleware.ts:58-87`); plugin re-declares an *optional* local type and uses a decorated→header→default fallback, safe on both host paths. ✅
- **`x-boring-workspace-id`** — genuine repo convention; `"default"` fallback consistent everywhere. ✅

Front seam (`definePlugin`, panel `placement:"center"`/`source:"builtin"`, `icon`, `commands[{id,title,panelId}]`) validated against `frontFactory.ts` — zero mismatches, matches `ask-user` prior art.

Proof commands (`typecheck`, `test`) are consistent with what I read; nothing in the code contradicts a green run.

---

## Blocking findings

**None.** Nothing fails Slice 1 acceptance or breaks host composition.

The item closest to a blocker is a **plan-conformance deviation** (F1 below) that needs an explicit decision, not a code emergency. And the header-trust authorization gap (F2) is a hard gate for Slice 5b that must be recorded now.

---

## Non-blocking findings

### F1 — Storage layout diverges from the plan's explicit Slice-1 deliverable (decision required)
`plan.md:244-252` explicitly enumerates:
```
.pi/automation/
  automations.json
  runs.json          ← never produced
  prompts/<automation-id>.md
```
The implementation folds **both** automations and runs into a single `automations.json` (`fileStore.ts:16-19,172-174` — `StoredAutomationState = { automations, runs }`, `statePath()` → `automations.json`). There is no `runs.json`. Functionally this is arguably *better* (single-file atomic cross-entity writes), and acceptance ("persist automations and prompts under `.pi/automation/`") is met — but it contradicts a named deliverable and makes the filename misleading (it also holds runs).
**Fix (pick one):** (a) update `plan.md:244-252` to document a single combined `state.json`/`automations.json` and rename the file to something non-misleading like `store.json`; or (b) split runs into `runs.json` with its own atomic write. Recommend (a) + rename.

### F2 — Route context trusts `x-boring-workspace-id` without membership validation (gate for Slice 5b)
`workspaceCtxFromRequest` (`routes.ts:135-142`) reads the raw header directly. On the multi-tenant/full-app path, plugin `routeContributions` are siblings to the agent routes and do **not** inherit the agent's `workspaceContext`, and the full-app's membership check (`apps/full-app/.../boringMcp.ts:~383-396`) is not in this path. So once composed into the hosted app, an authenticated user could set the header to any workspace id and read/write that workspace's automations — agent/MCP routes validate membership; this plugin would not.
Not exploitable in Slice 1 (local only, single-tenant path forces `"default"`), but the plan's Slice 5b claim "Workspace/user scoping is enforced by route/store context" is **not yet true** at the route layer.
**Fix:** record an explicit Slice 5b gate — either validate header membership inside the plugin (inject a host-provided `resolveWorkspaceId(request)` verifier via `AutomationRoutesOptions`) or require the hosted composition to validate/normalize `x-boring-workspace-id` before it reaches plugin routes. Add a note to `plan.md` Open Questions/Gates.

### F3 — `FileAutomationStore` mutation is not atomic across in-memory state + prompt write
In `createAutomation` (`fileStore.ts:67-70`) the automation is inserted into `state.automations[id]` **before** `await writePromptFile(...)`, all inside `fn` which runs before `writeAtomic(statePath)` (`fileStore.ts:185-193`). `state` is the shared cached `this.state` object. If `writePromptFile` rejects: the create call rejects (correct), **but** the phantom automation remains in memory — visible to `listAutomations`/`getAutomation` immediately (reads share `this.state`), and persisted to disk by the *next* successful mutation (with no prompt file). `writeChain`'s `.catch()` keeps the chain alive, so the corruption survives.
**Fix:** make the in-memory mutation transactional. Simplest: write the prompt file first, then mutate in-memory only after it succeeds:
```ts
async createAutomation(ctx, input) {
  const automation = { /* …build… */ }
  automation.promptRef = promptRefForId(automation.id)
  await this.writePromptFile(automation.id, input.prompt ?? DEFAULT_PROMPT)  // outside mutate
  await this.mutate((state) => { state.automations[automation.id] = clone(automation) })
  return clone(automation)
}
```
(Mirrors how `updatePrompt` already writes the file outside `mutate`.) Alternatively snapshot/rollback `state` on `fn` failure inside `mutate`.

### F4 — Run PATCH route doesn't verify the run belongs to the `:id` automation
`routes.ts:123-132`: the handler parses `:id` (line 125, result discarded) and `:runId`, then calls `store.updateRun(ctx, runId, …)` with no check that the run's `automationId === id`. So `PATCH /automations/AAA/runs/<run-of-BBB>` succeeds (same-workspace only). The create route *does* enforce this (`routes.ts:113-115`); PATCH is inconsistent. Low severity (workspace-scoped), but it's a route-integrity gap.
**Fix:** after loading, assert `run.automationId === id` (needs a `getRun`, or fetch via `listRuns`), or drop the redundant `:id` parse and document that run ids are globally unique within a workspace. Also remove the dead `parseParams(IdParamsSchema, …)` on line 125 (superseded by `RunIdParamsSchema` on line 126).

### F5 — `matchesWorkspace` is permissive; conformance suite under-specifies isolation
`matchesWorkspace` (`fileStore.ts:223-225`) returns true when **either** side's `workspaceId` is undefined — so a `{}` ctx matches every stored automation, and a stored-undefined automation matches every ctx. Fine for the local single-workspace store (routes always inject a default), but it's a footgun a `PostgresAutomationStore` must **not** copy. The shared conformance suite (`automationStoreConformance.ts:83-96`) only asserts cross-workspace *automations* return null; it never covers: undefined-ctx behavior, run cross-workspace isolation (`updateRun`/`listRuns`), or the null-clearing patch path (`deleteNullableRunField`). Since this suite is the contract every store must satisfy, the isolation guarantee is loosely pinned.
**Fix:** tighten the suite — add cases for run-level workspace scoping, and add a null-clear round-trip (`updateRun(..., { sessionId: null })` → field absent). Decide and document whether an undefined ctx workspace is a valid "match-all" contract or should be rejected; encode that decision as a test so Postgres can't silently diverge.

### F6 — No test exercises the plugin factory / default export / store wiring
Tests cover routes (via raw Fastify) and the store directly, but `createBoringAutomationServerPlugin`, `defaultBoringAutomationServerPlugin`, and `createDefaultStore` (including its throw-when-no-`workspaceRoot` path, `server/index.ts:28-30`) are never invoked in tests. This is the actual host-integration seam. Typecheck covers shape, but the `ctx.workspaceRoot` forwarding and the guard are unverified at runtime.
**Fix:** add a small server-index test: `defaultBoringAutomationServerPlugin({}, { workspaceRoot: tmp })` returns a plugin whose `routes` registers on a Fastify instance and serves `GET /api/boring-automation/automations`; and assert `createDefaultStore(undefined)` throws.

### F7 — Route-prefix convention deviates from repo `/api/v1/...`
`BORING_AUTOMATION_ROUTE_PREFIX = "/api/boring-automation"` (`constants.ts:3`) omits the `/api/v1/` version segment used by agent routes (`/api/v1/tree`, `/api/v1/files`, …) and legacy ask-user (`/api/v1/questions/commands`). The plan's own example (`plan.md:61`, `/api/v1/automation/runs/run-now`) also implies a `v1`. Harmless today, but inconsistent and forecloses easy versioning.
**Fix:** change prefix to `/api/v1/boring-automation` (or `/api/v1/automation`) and reconcile with `plan.md:61`. One-line constant change; tests reference the constant so they follow.

### F8 — Dead/unused error codes and prompt-not-found semantics
`PROMPT_NOT_FOUND`, `INVALID_STATE`, `STORE_ERROR` (`error-codes.ts:4-7`) are never thrown. In particular `getPrompt` (`fileStore.ts:104-113`) silently returns `""` on `ENOENT` rather than surfacing `PROMPT_NOT_FOUND`, so a deleted prompt file for an existing automation is indistinguishable from an empty prompt.
**Fix:** either delete the unused codes for now (add them back with their slice), or wire `PROMPT_NOT_FOUND` where intended. If empty-on-missing is the deliberate contract (it's reasonable), add a one-line comment at `fileStore.ts:110` stating so, and drop the unused codes.

### F9 — `createRun` object-literal ordering is a latent footgun
`fileStore.ts:133-140` spreads `...input` **after** the server-authoritative fields (`id`, `workspaceId`, `status`, `createdAt`, `updatedAt`). Safe today because `AutomationRunCreate` structurally cannot carry those keys and the route uses `.strict()`. But if a future field is added to `AutomationRunCreate` (e.g. `workspaceId`), the spread would silently clobber the automation-derived value.
**Fix:** invert — spread `...input` first, then override with authoritative fields:
```ts
run = { ...input, id: randomUUID(), workspaceId: automation.workspaceId,
        status: input.status ?? "queued", createdAt: now, updatedAt: now }
```

### F10 — Minor hygiene (batch)
- `package.json:3` version `0.1.71` for a brand-new Slice-1 plugin looks copied from a template; reset to `0.0.0`/`0.1.0`.
- `@hachej/boring-ui-kit` (`package.json:56`) is a dependency but unused in Slice 1 source (front imports only `lucide-react` + `boring-workspace/plugin`). Fine if Slice 2 needs it; otherwise drop until then.
- `vitest.config.ts:15` runs **all** tests under `jsdom`, including pure-Node store/route tests. Harmless but unnecessary overhead; acceptable to leave.
- `load()` (`fileStore.ts:200-205`) casts parsed JSON to `Partial<StoredAutomationState>` without validating entry shapes; a hand-corrupted file yields untyped records at runtime. Acceptable for a local file store — note only.

---

## Scope check

No scope creep. `schedule.ts` is an empty documented stub (`schedule.ts:1-4`); no `scheduler.ts`/`sessionLauncher.ts`/`postgresStore.ts`; run routes create/patch/list **metadata only** with no execution or session launch; front is a placeholder panel. All consistent with Slice 1's "Delivers" and the "Do not add …" constraint (`plan.md:37`).
