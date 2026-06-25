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
