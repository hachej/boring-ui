I now have a complete, verified picture. Here is the review.

---

# Thermo-nuclear review — Issue #590 Slice 2 UI (`plugins/boring-automation/src/front/**`)

## Verdict: 🟡 REQUEST CHANGES

Solid, tasteful, well-tested slice. State model is deliberate, the prompt-before-metadata write ordering with refresh-on-partial-failure is genuinely thoughtful, and the component decomposition is clean. It does **not** ship GREEN because it silently drops two pieces of the workspace plugin contract (`onAuthError`, `apiTimeout`) that every sibling plugin honors, plus a scatter of smaller a11y/code-judo/taste items. No crash-class or data-corruption blockers.

**Gates:** `tsc --noEmit` clean · `vitest run src/front` → 2 files / 9 tests pass.

---

## Blockers (fix before merge)

**B1 — API boundary: `onAuthError` and `apiTimeout` are dropped on the floor.**
`AutomationRuntimeContext.tsx:10` builds the client from only `apiBaseUrl` + `authHeaders`:
```ts
createAutomationClient({ apiBaseUrl, headers: authHeaders })
```
`PluginProviderProps` (workspace/dist `plugin.d.ts:53`) also provides `onAuthError?: (statusCode) => void` and `apiTimeout?: number`. The canonical plugin — filesystem's `FetchClient` — wires both and calls `this.onAuthError?.(res.status)` on the auth path. This client's `request()` (`client.ts:32`) has no auth-error hook and no timeout: a mid-session token expiry (401/403) surfaces as a generic red `Notice` and the panel stays wedged with **no re-auth trigger**, and a hung route spins forever. This is a real contract divergence, not a style nit. Thread `onAuthError`/`apiTimeout` through `AutomationClientOptions` and honor them in `request()` (call `onAuthError(response.status)` on 401/403; `AbortSignal.timeout(apiTimeout)` merged with the caller signal).

---

## Code-judo findings (strong recommendations)

**J1 — `setDetails` boilerplate is repeated ~7× (biggest maintainability debt).** `AutomationPanel.tsx` open-codes the same 4-field detail literal (`prompt/promptLoading/runs/runsLoading` with `?? current[...]` fallbacks) in `loadPrompt`, `loadRuns`, `refreshAutomationAndPrompt`, and both `saveDraft` branches. Every one is a place to fat-finger a field. Collapse to one helper:
```ts
const patchDetail = (id: string, patch: Partial<AutomationDetailState>) =>
  setDetails(cur => ({ ...cur, [id]: { prompt: "", promptLoading: false, runs: [], runsLoading: false, ...cur[id], ...patch } }))
```
That deletes ~50 lines and removes the whole class of copy-paste field bugs. This is the single highest-leverage change in the diff.

**J2 — generation-counter machinery is duplicated three ways.** `promptRequestGeneration` and `runRequestGeneration` implement the identical bump/compare/guard dance inline in `loadPrompt`, `loadRuns`, and `refreshAutomationAndPrompt`. A tiny `nextGen(ref, id)` + `isCurrent(ref, id, gen)` pair (or a `useLatestRequest` hook) would make the staleness contract stated once instead of re-derived at each call site.

**J3 — `formatDuration(ms, run?)` takes both the field and its owner.** `RunHistory.tsx:42` calls `formatDuration(run.durationMs, run)`. Passing a value *and* the object it came from is an awkward signature; `formatDuration(run)` reading `durationMs` internally is cleaner and unambiguous about precedence.

**J4 — `useAutomationClient` fabricates a client on missing provider** (`AutomationRuntimeContext.tsx:16`): `return client ?? createAutomationClient()` builds a fresh no-base-URL client on *every render* and silently degrades instead of failing loud. Prefer a thrown "provider missing" error, or at least a stable module-level singleton, so a wiring mistake is visible rather than issuing relative-path fetches.

---

## Non-blocking findings

**Accessibility**
- **A1 — Cron validation error is not programmatically associated.** `AutomationForm.tsx:139` hardcodes `aria-describedby="automation-cron-description"` and the cron `FieldError` (line 142) carries no `id`. `FieldError` is a dumb `<p>` (verified — `packages/ui/src/field.tsx:16`), so it self-associates nothing. Title/model/timezone correctly swap `describedby` to the error id on submit; cron does not — SR users hear the example but never the error. Make it consistent.
- **A2 — Inline delete confirm uses `role="alertdialog"` without focus management** (`AutomationCard.tsx:60`): focus isn't moved into it and it isn't trapped. Either move focus to the confirm button on open or drop the dialog role for something honest.
- **A3 — `aria-live="polite"` wraps the entire scroll region** (`AutomationPanel.tsx:305`). Announcing the whole list on any mutation is noisy; the per-`Notice` `role="alert"/"status"` already covers the important transitions. Consider narrowing or removing.

**State / races**
- **S1 — Refresh-while-editing silently discards unsaved form input.** `selectedAutomation` is derived from `automations` (`AutomationPanel.tsx:52`); clicking **Refresh** (or any `setAutomations` replacing objects) mid-edit changes its identity → `AutomationForm`'s `useEffect([automation, prompt])` (line 90) resets the draft, wiping in-progress metadata edits. Papercut, user-triggered, but real. A dirty-guard or keying the form on id (not object identity) would fix it.

**Visual taste / tokens**
- **V1 — Off-token accent-opacity inconsistency.** Header uses the deliberate `oklch(from var(--accent) l c h/0.14)` (`AutomationPanel.tsx:286`) because the `/opacity` shorthand is unreliable on `var()` colors — yet `format.ts:46` uses `bg-[color:var(--accent)]/12`. Pick one; if the shorthand truly renders, simplify the header, otherwise fix `statusTone`.
- **V2 — Raw `emerald-*` palette for enabled dot + succeeded badge** (`AutomationCard.tsx:46`, `format.ts:44`) vs. `.impeccable.md` "Tokenized, never ad-hoc." Destructive correctly uses the token; success/enabled hardcode emerald. Consider a semantic success token.

**Scope** — correctly bounded: runs are read-only, `RunHistory` states "Future execution slices will write sessions here," `openRun` only hands off to the shell. No scope creep. ✅

---

## Residual visual proof needed (not verifiable from source)
1. **Contrast:** `text-emerald-700 on bg-emerald-500/10` (light) and `text-[color:var(--accent)] on bg-[color:var(--accent)]/12` running badge — verify WCAG AA-large against the actual palette in **both** themes.
2. **Confirm the `/12` accent-opacity modifier actually renders** a translucent fill (V1) — screenshot the "running" badge.
3. **Responsive:** the `lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]` two-pane collapse to single column below `lg`, and the `sm:`-gated "Updated …" timestamp (`AutomationCard.tsx:51`) — screenshot at ~360px, ~768px, ~1280px.
4. **Dark-first sign-off** of card/aside surface separation (`bg-card/60` vs `/80` on the `l-0.012` background) — the ramp is subtle by design; confirm the borders carry the separation as intended.

**Bottom line:** clear the `onAuthError`/`apiTimeout` contract gap (B1) and the cron-error association (A1); apply J1/J2 to kill the boilerplate; the rest are polish. Strong slice otherwise.
