All fixes verified, proof independently reproduced. Here is the review.

---

# Second-Pass Thermonuclear Review — Issue #590, Slice 1 (post-fix)

## Verdict

**APPROVE for merge.** All ten prior findings (F1–F10) are resolved or explicitly recorded as gates. The fixes are correct, introduce no regressions, and add no scope creep. I independently re-ran the proof: `typecheck` clean, `test` green — **4 files, 16 tests passed**, exactly matching the claimed proof.

Host-seam contracts re-verified against current source (fixes did not drift them):
- **Server default export** — `defaultBoringAutomationServerPlugin(options, ctx)` reads `ctx?.workspaceRoot`; matches host factory signature `(options: unknown, ctx: PluginResolveContext)` where `ctx.workspaceRoot: string` (`pluginEntryResolver.ts:36,59-62,109-113`). ✅
- **`routes`** — `WorkspaceServerPlugin.routes?: FastifyPluginAsync` (`defineServerPlugin.ts:51`); plugin's self-prefixed `/api/v1/boring-automation/...` async routes conform. ✅
- **Front `definePlugin`** — `panels[{id,component,label,icon,placement,source}]` + `commands[{id,title,panelId}]` all valid fields of `DefinePluginConfig` / `BoringFrontPanelRegistration` / `BoringFrontPanelCommandRegistration` (`frontFactory.ts:11-23,37-45,150-167`). ✅

## Blocking findings

**None.** Nothing fails Slice 1 acceptance or breaks host composition.

## Prior findings — disposition

| ID | Status | Evidence |
|----|--------|----------|
| **F1** storage layout / plan mismatch | **Fixed** | `statePath()` → `store.json` (`fileStore.ts:173`); plan reconciled (`plan.md:248-251`), tests assert `store.json` (`fileStore.test.ts:46`). No stale `automations.json`/`runs.json` refs. |
| **F2** header-trust authz gap (Slice 5b gate) | **Recorded** (not code) | Gate captured in `plan.md:421` (Open Questions #5) and Slice 5a acceptance `plan.md:328`. Correct — this is a future-slice gate, not a Slice-1 defect. |
| **F3** non-atomic in-memory + prompt write | **Fixed** | Prompt file now written *before* in-memory mutation (`fileStore.ts:67-70`); `mutate` callback is fully synchronous, so no phantom automation can be observed by reads. |
| **F4** run PATCH ownership not checked | **Fixed** | `routes.ts:127` verifies run via `listRuns(ctx, id).find(...)` before update; regression test added (`routes.test.ts:103-138`, asserts 404). |
| **F5** conformance under-specifies isolation | **Fixed (substantially)** | Suite now covers cross-workspace `updateRun`/`listRuns` (`automationStoreConformance.ts:100-109`) and null-clearing round-trip (`:112-134`). |
| **F6** no factory/default-export test | **Fixed** | New `serverPlugin.test.ts` exercises `defaultBoringAutomationServerPlugin({},{workspaceRoot})` end-to-end over Fastify and asserts the `createDefaultStore` throw. |
| **F7** route prefix missing `/api/v1` | **Fixed** | `BORING_AUTOMATION_ROUTE_PREFIX = "/api/v1/boring-automation"` (`constants.ts:3`). |
| **F8** dead error codes | **Fixed** | `error-codes.ts` trimmed to the 3 used codes; no `PROMPT_NOT_FOUND`/`INVALID_STATE`/`STORE_ERROR` remain anywhere. |
| **F9** `createRun` spread ordering footgun | **Fixed** | `...input` spread first, authoritative fields override after (`fileStore.ts:133-140`). |
| **F10** hygiene | **Partial** | `@hachej/boring-ui-kit` dependency removed. Version still `0.1.71` (see N1). |

## Non-blocking findings (residual — all cosmetic, none gate merge)

**N1 — `package.json:3` version `0.1.71`.** Still a template-copied version for a Slice-1 skeleton. Cosmetic; publish flow may overwrite it. *Fix (optional):* reset to `0.1.0`.

**N2 — `plan.md:61` route example not reconciled with the chosen prefix.** The plan still names `POST /api/v1/automation/runs/run-now` while the implemented constant is `/api/v1/boring-automation`. Harmless (that route is a future slice), but the `automation` vs `boring-automation` segment will confuse Slice 3/4. *Fix (optional):* update `plan.md:61` to `/api/v1/boring-automation/...`.

**N3 — `getPrompt` empty-on-ENOENT is an undocumented contract.** `fileStore.ts:110` returns `""` when the prompt file is missing for an existing automation, making a deleted prompt file indistinguishable from an empty prompt. This is a reasonable MVP contract, but nothing states it (F8's `PROMPT_NOT_FOUND` was removed rather than wired). *Fix (optional):* one-line comment at `fileStore.ts:110` declaring "missing prompt file ⇒ empty body by design."

**N4 — `matchesWorkspace` undefined-ctx match-all remains untested.** `fileStore.ts:223-225` still treats an undefined ctx workspace as "match everything." F5's suite additions cover cross-workspace isolation but not this branch, so a `PostgresAutomationStore` could silently diverge on it. Not exploitable in Slice 1 (routes always inject a `"default"` workspace via `workspaceCtxFromRequest`). *Fix (optional):* add a conformance case pinning undefined-ctx behavior before Slice 5a builds the second store.

**N5 — new orphan-file tradeoff from the F3 fix (net improvement).** Writing the prompt file before the state mutation means a failed `store.json` write can leave an orphan `prompts/<uuid>.md` with no automation record. This is strictly better than the old phantom-in-memory automation and is harmless (fresh UUID, unreferenced). No action needed — noting only so it isn't rediscovered as a regression.

## Scope check

No scope creep. `schedule.ts` remains an empty documented stub (`schedule.ts:1-4`); no `scheduler.ts` / `sessionLauncher.ts` / `postgresStore.ts` exist; no `setInterval`/`setTimeout`; run routes are metadata-only (create/patch/list, no execution or session launch); front is a placeholder panel deferring to Slice 2. All consistent with Slice 1's "Delivers" and the "Do not add …" constraint (`plan.md:37`).

## Exact fixes

None required for merge. The five residuals (N1–N4) are one-line cosmetic edits that can ride along with Slice 2 or be batched later; N5 needs no change.
