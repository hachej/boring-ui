# Thermo-Nuclear Review — Multi-Project Left Bar Plan

Reviewed: `docs/plans/multi-project-left-bar.md`
Method: review → fix → independent re-review loop until clean.
**Current verdict (round 3): PLAN TEXT UPDATED, IMPLEMENTATION NOT CLEAN.** Round 2 was clean, but #377/#385 product review found a missing no-takeover/background-load invariant; see Round 3.

---

## Loop history

### Round 0 (self-review)
Flagged 10 issues; headline: "isolated mode" sold as a security boundary, cross-project skills listing contradicting its own mode, contracts described as prose, status dot with no data source, `window.prompt`, unenforceable PR1 "no visible change".

### Round 1 (independent reviewer, verified against code) — NOT CLEAN, 5 blockers
1. **False foundation:** "session listing is cheap host-side readdir" is wrong for the endpoint used — `GET /api/v1/agent/pi-chat/sessions` boots the runtime binding (`registerAgentRoutes.ts:966-978` → `:852-858` → `getOrCreateRuntimeBinding`). The no-boot `getSessionStoreForRequest`/`PiSessionStore` path (`:860-871`) exists but isn't wired to that route. Expanding N projects would boot N runtimes.
2. **Plan↔draft divergence:** the plan claimed the open-session event was typed, but the draft still shipped an ad-hoc `CustomEvent`.
3. **Infeasible nav-state hand-off:** `WorkspaceAgentFront` / the workspace package has no `react-router`, so it can't read router location state — yet §5.1 "preferred" it while Open Q3 questioned it (contradiction).
4. **`window.prompt`** still in the draft despite the plan saying "reuse the Dialog".
5. **Fake status dot** (`status: 'running'` for the current workspace) still in the draft despite the plan saying "no dot".
Plus risks: invented `routeStatus` value `switching`; the full-page `WorkspaceLoadingPage` still paints inside routed children unless suppressed; two `UserMenu` mount points.

### Round 2 (independent re-review) — CLEAN
All five blockers and both risks verified resolved at the code level:
- §0 Prerequisites retracts the "cheap" claim with exact, verified citations and makes a **no-boot session-list route (P0)** a PR0 prerequisite gating PR2; the draft `fetchSessions` carries an honest WIP comment.
- Ad-hoc `CustomEvent` deleted; same-project open is a documented no-op pending the typed `workspaceEvents.openSession` (PR2 deliverable, acceptance-gated).
- Nav-state removed; §5.1 commits to synchronous `writeActiveSessionId` + `navigate` (race-free; helper verified sync at `activeSessionStorage.ts:31-39`).
- `window.prompt` deleted; `onNewProject` omitted until `CreateWorkspaceDialog` (PR2).
- `status: undefined` for all projects; no dot in v1.
- §5.2 uses only real `routeStatus` values and a real seam (`loadingFallback` already threaded through `CoreWorkspaceAgentFront`→`WorkspaceRoute`); §7.3 specifies the `CoreFront` `topBarAccountSlot` change as PR2.

---

## Residual nits (non-blocking — address during implementation)
- **N1 (§7.4):** the drafted `WorkspaceProjectsShell` is a pre-contract sketch (still calls the booting route, by design, gated). Honestly labeled; rebuilt in PR2. No action beyond PR2.
- **N2 (response shape):** `workspacesQueryFn` expects `{ workspaces: [...] }`; the sessions fetch maps a bare array (matches the live route `piChat.ts:134`). Both correct today — keep the **P0 route returning a bare array** (or update the draft) so the contract stays consistent. → PR0 acceptance.
- **N3 (§6 LRU):** the cap (last 12 expanded projects) is specified with a required test in §6 + PR2 acceptance, but the sketch's `projectSessions` map is still unbounded. Ensure the PR2 test actually asserts eviction.

---

## Round 2 bottom line (superseded by Round 3)
Direction was approved after Round 2. Round 3 below supersedes that verdict for the background-open behavior: #385 must now satisfy the stricter no-takeover invariant before it can be considered complete.

---

## Round 3 (#377 / #385 implementation review) — NOT CLEAN

Triggered by product review of PR #385 against issue #377.

### Blocker B6 — §5.2 accepted a reload-feeling content takeover
The prior clean verdict accepted a "minimal content-pane loader" during cross-project opens. That is not strong enough for #377. In the actual #385 implementation, cross-project session open writes the target active session and navigates, but the routed workspace detail fetch can still replace the workspace page with a spinner while the target workspace loads. This violates the product contract: **workspace loading must happen in the background; opening a session from another project must not blank/reload the page.**

Required plan fix now applied in rev 4:

- §5.2 is renamed/reframed as **Background boot — no route/content takeover**.
- Cross-project open now explicitly requires retaining the previous matched workspace shell/content while the target workspace is loading.
- Persistent shell remains the preferred architecture.
- If the rail is still per-workspace, an acceptable repair is a last-matched-workspace retention seam with distinct `routeWorkspaceId` and `renderedWorkspaceId`.
- Plain full-page or full-content spinner takeover is explicitly rejected.

### Blocker B7 — §11.3 option B normalized the flash it was supposed to remove
The previous §11.3 allowed "feed the per-workspace rail" while accepting remount/flash. That contradicts #377's no-reload/background-load requirement.

Required plan fix now applied in rev 4:

- Option B is only acceptable if paired with §5.2 last-matched workspace retention.
- A bare per-workspace remount/flash is rejected.

### Updated acceptance impact
PR2/#385 is not complete unless tests prove:

- expanding/browsing project sessions does not boot target runtimes;
- clicking a session in another project writes the target active-session key and starts navigation;
- while the target route is loading/mismatched, the previous workspace shell/content remains mounted and the app-left project/session tree remains visible;
- split/open-in-new-pane remains same-project only;
- single-project mode keeps its existing loading behavior.

### Thermo verdict after plan update
The **plan text is now structurally aligned** with #377, but the implementation must still be repaired and reviewed against the new §5.2 acceptance. Do not call #385 finished solely because CI is green; CI did not cover the no-takeover product invariant before this update.

---

## Round 4 (#385 scope decision) — PLAN UPDATED FOR MOUNTED WORKSPACE CACHE

Product decision: do the full multi-workspace mounted-content work in #385 instead of deferring it.

### Decision
#385 should implement the persistent multi-project shell plus a bounded mounted-workspace cache.

This supersedes the weaker "last matched only" repair. The last-matched behavior becomes the minimum behavior naturally provided by the cache, but the intended architecture is now:

- persistent multi-project shell / nav outside keyed workspace content;
- workspace content rendered through a small LRU cache;
- default max mounted workspaces = 3 (`current + two recent`);
- expanding/browsing a project never mounts that workspace;
- only successful route/open actions add to the mounted cache;
- inactive mounted workspaces are hidden/inert and do not own focus, global shortcuts, overlays, or cross-project split/drop targets;
- runtime boot remains lazy, not "mount all workspaces in background".

### Why this is better
- It satisfies #377 more completely: switching back to a recent project can be instant, not merely non-blank.
- It makes the project/session tree truly persistent rather than per-workspace chrome pretending to be global.
- It gives a clear cap and inactive contract, avoiding the unbounded-memory and many-live-streams failure mode.
- It keeps split panes correctly scoped to one workspace while still allowing multiple workspace contents to exist in memory.

### New implementation/review blockers
#385 is not complete until tests prove:

1. Project/session expansion uses no-boot session snapshots and does **not** mount/provision target workspace content.
2. Cross-project session open writes target active-session id, navigates, and keeps existing visible workspace mounted while target route is pending.
3. Once a target is matched, it enters the mounted cache and becomes visible; switching back to a cached workspace avoids a full remount where possible.
4. Mounted cache is bounded and evicts least-recent inactive entries.
5. Inactive mounted entries are hidden/inert enough to avoid focus/keyboard/overlay/drag ownership.
6. Split/open-in-new-pane affordances remain same-project only.
7. Single-project mode is unchanged and does not instantiate the multi-workspace cache.

### Current verdict
Plan direction is stronger and aligned with the product ask. Implementation still required in #385; green CI before this work does not mean #385 is done.

---

## Round 5 (mounted cache hardening) — PLAN UPDATED

Thermo review found three blockers in the Round 4 mounted-cache plan:

1. **Workspace store isolation.** Multiple mounted `WorkspaceProvider` instances are unsafe if selectors/store binding remain module-singleton. #385 must make store access provider-scoped or otherwise multi-provider-safe before enabling the cache.
2. **Cached-target open-session handoff.** `writeActiveSessionId` only solves first mount. If target workspace B is already mounted but inactive, opening B/session-2 must also deliver a live typed `workspaceEvents.openSession` event to B so it switches without remount.
3. **Inactive workspace global side effects.** DOM hiding alone is insufficient. Shortcuts, UI-command bus subscribers, document title/theme, overlays/toasts, drag/drop, bridge clients, plugin hot reload, file events, and expensive streams need a visible/active-workspace signal or workspace-targeted filtering.

Plan updates applied:

- Added a store-isolation prerequisite and acceptance test.
- Expanded §5.1 so the typed `openSession` event applies to any mounted target, not only same-project no-op navigation.
- Added a visibility/active-workspace signal requirement.
- Made inactive workspace contract concrete for shortcuts, overlays/toasts, document title/theme, UI commands, focus, drag/drop, and stream policy.
- Copied all of this into the main PR2/#385 acceptance list, including single-project mode not instantiating the cache.

Current verdict: plan is intentionally more ambitious, but now names the load-bearing implementation risks instead of hiding them. #385 should not implement mounted caching until these prerequisites/tests are in place.
