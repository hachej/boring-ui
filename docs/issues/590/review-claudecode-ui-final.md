## Review: Issue #590 Slice 2 UI (plugins/boring-automation/src/front/**)

**Verdict: REQUEST CHANGES** — one spec-compliance blocker, functionality is otherwise solid.

### Proof (verified myself, not taken on faith)
- `pnpm --filter @hachej/boring-automation typecheck` → clean
- `pnpm --filter @hachej/boring-automation test` → **24/24 passed**, 6 files
- `pnpm --filter @hachej/boring-automation build` → tsup ESM+DTS build succeeds
- Config diffs (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/test/setup.ts`) are exactly what's needed to wire in the new `@hachej/boring-ui-kit` dependency + a `ResizeObserver` jsdom shim — no unrelated churn. `pnpm-lock.yaml` diff is just that one new workspace link. Scope is clean: nothing outside `plugins/boring-automation/**` touched.

### Blocker

1. **Ad-hoc color instead of design tokens (violates `.impeccable.md` "Tokenized, never ad-hoc" and the "one accent, three approved uses" rule).**
   - `format.ts:44` (`statusTone`, "succeeded") and `AutomationCard.tsx:46` (enabled dot) hardcode Tailwind `emerald-500`/`emerald-700 dark:emerald-300` instead of the existing `--success`/`--success-soft` tokens — which `packages/ui/src/notice.tsx` already uses correctly for `tone="success"` one file over in the same package tree. There's no reason to duplicate the semantic in raw palette classes.
   - `format.ts:46` (`statusTone`, "running") repurposes `var(--accent)` as a status-badge text color. `.impeccable.md` explicitly scopes accent to "the send button, the user-message tint, interactive focus rings... never for decoration" — a status pill is decoration in that sense.
   - Fix is mechanical: swap to `--success`/`--success-soft` for succeeded/enabled, and use a neutral/tokenized tone (or `--warning`) for "running" instead of `--accent`.

### Nonblockers (accessibility polish, worth doing but not merge-blocking)

- `AutomationCard.tsx:60` delete confirmation uses `role="alertdialog"` on an inline, non-modal row — no focus is moved into it and nothing traps focus, so the role overpromises modal behavior to AT users. A `role="region"`/plain labeled `div` would be more honest.
- `AutomationPanel.tsx:305` puts `aria-live="polite"` on the wrapper around *both* the automation list and the editor pane, which will announce more churn than intended (e.g. list re-renders) rather than just notices/status. Scoping the live region to the Notice area would be quieter and more correct per AT expectations.
- `AutomationForm.tsx:168-178` — the Markdown prompt field's `FieldDescription` isn't wired to the `Textarea` via `aria-describedby` (unlike the Cron field, which does this correctly at line 139). Screen-reader users won't hear the hint on focus.

### Everything else checked out clean

- **Routes**: front client only hits automation/prompt CRUD + read-only `GET .../runs`; no public run create/patch call sites — matches plan decision 6.
- **State/races**: `loadAutomations` uses `AbortController`; `loadPrompt`/`loadRuns` use per-automation-id generation counters that correctly discard stale responses (verified by the "ignores stale prompt loads" test, which I re-derived and confirms double-Edit-click doesn't race). `saveDraft` bumps the generation before writing, so a late in-flight prompt fetch can't clobber a fresh save.
- **Canonical prompt save/refetch**: `openEdit` always refetches the canonical Markdown from the server (never trusts a cache) before editing; save order is prompt-first, metadata-second, matching the plan's "prompt file is the commit-adjacent resource, store.json is the commit point" semantics.
- **Partial failure**: metadata-save failure after a successful prompt save is surfaced honestly (`"Prompt saved, but automation metadata was not saved..."`), followed by a best-effort refetch of true server state, with a distinct message if even that refetch fails. This is exactly the honest-reconciliation behavior the plan calls for, and it's under test.
- **Run history / chat opening**: `openRun` guards on `sessionId`, the button is also `disabled` when absent, and `shell.openDetachedChat` failures surface via an accessible `role="alert"` Notice. Matches `WorkspaceShellCapabilities.openDetachedChat` signature in `packages/workspace`.
- **Responsive**: single column below `lg`, two-pane above; progressive disclosure of the "Updated" timestamp on narrow widths (`hidden sm:block`) is reasonable.
- **Accessibility (positive)**: visible focus rings (`ring-2 ring-ring/40`) match the impeccable spec exactly, `motion-reduce:transition-none` is present on every hover/expand transition, `aria-expanded`/`aria-controls` correctly wired on the card toggle, disabled-state session buttons have accurate `aria-label`/`title`.
- **Tests**: cover loading/empty/error states, validation-before-submit, the prompt-before-metadata write order + partial-failure refresh + warning copy, edit-reentry canonical refetch with stale-response rejection, and run-history expand/disable/open/error-surfacing. Good alignment with the plan's listed test seams.
- **Scope**: this diff is Slice 2 only — cleanly replaces the Slice 1 placeholder panel, adds no server/store/schema changes, no scheduler/executor code. Nothing here overreaches into out-of-scope items from the plan.
