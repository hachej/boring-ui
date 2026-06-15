# Credits UX completion plan (public-launch) — reviewed & corrected

Five user-facing gaps after the money backend converged. Revised per three gpt-5.5
thermo reviews (pi design, codex design, pi layering) — all "needs-changes" on v1;
this is the corrected spec. **Hard rule: the agent package (`@hachej/boring-agent`)
must never gain a credits/billing concept; `@hachej/boring-core/front` (app shell) stays
billing-agnostic; the credits feature lives in `@hachej/boring-core/{server,app/front}`;
`apps/full-app` is the only place that wires credits into the agent + shell.**

Already shipped (`ff05cec8`): top-bar badge; settings "Billing & credits" panel
(via a generic `billing` slot on `UserSettingsPage`); actionable `CreditExhaustedError`;
shared `useCreditBalance` hook (poll + focus + `credits:refresh` event + `buy()`).

Implementation order (synergy + risk): #5 packs (server) → #4 history (server+front) →
#1 CTA → #2 refresh → #3 landing (confirms via #4 history).

---

## 1. [HIGH] Inline PAYMENT_REQUIRED CTA — generic in agent, wired by full-app

**Agent (`@hachej/boring-agent/front`) — generic only:**
- `routeErrorCode(body): ErrorCode | undefined` beside `routeErrorMessage` in
  `remotePiSession.ts` (validate against the shared `ErrorCode` enum).
- `PiChatRuntimeNotice.errorCode?: ErrorCode` (piChatReducer.ts) — **no `buy-credits`**.
- **Single normalization point:** route POST prompt/follow-up rejections into the SAME
  runtime-notice path as stream errors (don't create a second error path). Confirm the
  catch site (composerPolicy/queue controller → PiChatPanel) and emit a notice with
  stable id `run-rejected` carrying `errorCode`. Clear it when a later run is admitted.
- Generic render prop on `PiChatPanel` (threaded via `CoreWorkspaceAgentFront`/chatParams):
  `renderNoticeAction?: (notice: PiChatRuntimeNotice) => ReactNode`. `RuntimeNotices.tsx`
  renders it next to the notice text. Keyboard-reachable; ARIA via existing notice region.

**full-app:** passes `renderNoticeAction` that, when
`notice.errorCode === ErrorCode.PAYMENT_REQUIRED && checkoutEnabled`, renders a
"Buy credits" button calling `useCreditBalance().buy()` (disabled while `buying`; inline
error text on failure). Dependency direction: full-app → agent/front and → core/app/front;
agent imports neither.

**Tests:** routeErrorCode (extract/validate/undefined-on-junk); reducer notice carries
errorCode for a rejected POST and is cleared on next admit; RuntimeNotices renders the
host action node; full-app maps PAYMENT_REQUIRED→button only when checkoutEnabled.

## 2. [HIGH] Refresh after a run — generic callback + retry burst (billing is async)

**Critical:** `agent-end` is published BEFORE the metering observer settles the credit
write, so a single immediate refetch can read a stale balance; queued follow-ups also
keep the UI busy across multiple turn-ends. So:
- **Agent:** generic `onTurnComplete?: () => void` on `PiChatPanel`, fired once per turn
  settling (on agent-end, not just busy→idle), threaded via `CoreWorkspaceAgentFront`.
  No credits concept; no global DOM event as the cross-package API.
- **Credits hook:** add `refreshWithRetry()` — immediate refetch + a short backoff burst
  (e.g. 0/1/2/4/8s, ~15s total) so it catches the async settle; **dedupe** concurrent
  refreshes (ignore overlapping bursts). Track `lastUpdatedAt` + an `updating` flag so
  the UI can show a subtle "Updating…" and not present a stale balance as fresh.
- **full-app:** wires `onTurnComplete` → `refreshWithRetry()`.

The existing `CREDITS_REFRESH_EVENT` stays an INTERNAL credits mechanism (used by #3),
NOT the agent↔credits API.

**Tests:** onTurnComplete fires once per turn-settle, not on mount/idle-idle; hook
refreshWithRetry refetches with backoff and dedupes; updating/lastUpdatedAt surface.

## 3. [MED] Post-purchase landing — confirm server-side, never trust the URL

Lives in `apps/full-app` (or a `useCheckoutReturnHandler` in `core/app/front`) — **never
`core/front`**.
- Checkout stays **new-tab** (`window.open`, preserves app state). LS redirects the new
  tab to a neutral marker `?checkout=return` (set `BORING_CREDITS_LS_REDIRECT_URL`).
- The return handler shows **"Checking payment…"**, then CONFIRMS via the authenticated
  server: poll `GET /api/credits/history` for a recent `purchase` entry (the #4 endpoint)
  / balance increase, with backoff over ~30–60s. Copy: "Credits added." on confirm;
  "Payment is still processing — credits usually appear within a minute." on timeout;
  "We couldn't confirm your purchase — refresh or contact support." after the window.
  Handle `?checkout=cancelled` and popup-blocked. **Never** say "received" from the param.
- Cross-tab: the return page broadcasts (`BroadcastChannel('credits')` / storage event)
  so the original app tab's `useCreditBalance` refreshes. Strip the query param via
  `history.replaceState` after handling starts.

**Tests:** `?checkout=return` → checking→confirmed (history shows purchase) vs.
→processing (no purchase) vs. timeout; param stripped; cancelled path; spoofed param with
no server purchase never shows success.

## 4. [MED] Purchase / usage history — server-authoritative, sanitized, scoped

**`@hachej/boring-core/server`:**
- `CreditLedgerEntry` (credits types): `{ id, kind: 'grant'|'purchase'|'usage'|'refund'|'fallback',
  amountMicros, createdAt, description }`. **Sign convention:** `amountMicros` positive =
  credit added (grant/purchase), negative = consumed/removed (usage/refund). `kind` is a
  stable enum.
- `listLedger(userId, limit)` on the store interface + `PostgresMeteringStore` impl:
  UNION ALL over `creditGrants` (+purchase rows) and `usageLedger`, **scoped to userId**,
  ordered `created_at desc`, **limit clamped server-side to 1..50**. No agent/run/session
  internals; the metering store stays generic ledger-shaped.
- `GET /api/credits/history?limit=N` (credits routes): auth-gated (same `getUserId`),
  clamps limit, returns `{ entries: CreditLedgerEntry[] }`. **Descriptions are generic
  and sanitized** ("Signup grant", "Credit purchase", "Agent usage", "Refund",
  "Usage reconciliation") — NO prompt text, repo paths, model/provider, session, or LS
  order/customer ids.

**`@hachej/boring-core/app/front`:** `useCreditHistory` hook + a "Recent activity"
section in `CreditsSettingsPanel` (lazy-fetch on expand; loading / empty
("No credit activity yet.") / error states; signed amounts via `formatCreditMicros`).

**Tests:** store listLedger merges/orders/caps/scopes; route auth + clamp + sanitized
shape; front renders rows + empty/error.

## 5. [LOW] Pack picker — server display contract, settings-only

**`@hachej/boring-core/server`:**
- `CreditPack`: `{ id, creditMicros, priceMinor, currency, label, isDefault }` —
  server-authored display contract (NEVER infer price from id; NEVER expose LS variant
  ids). Derived from the configured checkout `variants` + `creditMicrosByVariant`
  (priceMinor from the pack's EUR value × 100, currency from config, label e.g. "€25",
  isDefault = configured default pack), in server config order.
- Balance response gains `packs?: CreditPack[]` (only when checkout enabled). Checkout
  route already accepts `{ pack }` (validated server-side).

**`@hachej/boring-core/app/front`:** `CreditPackPicker` (radio-group semantics) in
`CreditsSettingsPanel`; selecting a pack calls `buy({ pack })`; confirm shows the price
("Buy €25"). Badge stays a one-click default. If packs absent but checkout enabled, fall
back to the default CTA; if checkout disabled, hide the picker.

**Tests:** balance route exposes packs from config (no variant ids); picker renders +
sends chosen pack; default fallback.

---

## Cross-cutting acceptance criteria (all items)
- **States:** explicit loading / empty / error / checkout-disabled / pending / stale for
  every surface (badge, panel, history, picker, landing).
- **Double-click:** every checkout CTA disabled+guarded while a request is in flight
  (`useCreditBalance.buy()` already guards via `buyingRef`); surface checkout errors.
- **Accessibility:** notice CTAs keyboard-reachable; error notices not color-only; ARIA
  live for the landing toast; pack picker as an accessible radio group; focus management
  on landing return.
- **Currency/i18n:** server supplies currency + priceMinor; client formats with
  `Intl.NumberFormat`; don't mix "€10" and "credits" ambiguously.
- **Balance staleness:** `lastUpdatedAt` + "Updating…" after a run; on refresh failure
  keep the last value but don't present it as fresh.
- **No money-path change:** all five are read/display/UX; the history endpoint is
  read-only; crediting/idempotency/fail-closed billing untouched.
- **Layering (enforced):** agent stays credits-agnostic (generic errorCode + generic
  callbacks only); core/front never imports app/front or detects checkout; credits server
  module stays generic; full-app does the concrete wiring. Build core before full-app
  typechecks (separate dist entries).
