# Credits UX completion plan (public-launch UX)

Five remaining user-facing gaps after the metering/money backend converged. Goal: a
new user can see their balance, understand consumption, recover when out of credits,
buy more, and have the balance reflect reality — without a page reload.

Stack: Vite/React front in three layers — `@hachej/boring-core/front` (app shell:
auth, settings, routing in `CoreFront`), `@hachej/boring-core/app/front` (the
credits feature UI: badge, settings panel, `useCreditBalance` hook), and
`@hachej/boring-agent/front` (the Pi chat). `apps/full-app` composes them.

Already shipped (`ff05cec8`): top-bar balance badge; account-settings "Billing &
credits" panel; actionable `CreditExhaustedError` message; shared `useCreditBalance`
hook with poll + window-focus + a `credits:refresh` window event + server-side
checkout action.

---

## 1. [HIGH] Inline "Buy credits" CTA on the out-of-credits chat error

**Problem.** A run refused for credits throws 402 `{ error: { code: 'PAYMENT_REQUIRED', message } }`.
In `remotePiSession.ts:509` the response becomes `RemotePiSessionHttpError(status, message, body)`
but only the **message** is later surfaced; the `code` is dropped. The user sees a
plain error notice with no way to act from the chat.

**Approach.**
1. `RemotePiSessionHttpError` already carries `body`. Extract the canonical code from
   the body (`body.error.code`, validated against the agent `ErrorCode` enum) — add a
   helper `routeErrorCode(body): ErrorCode | undefined` next to `routeErrorMessage`.
2. When a prompt/follow-up POST rejects, dispatch a runtime notice that carries the
   code. Extend `PiChatRuntimeNotice` (piChatReducer.ts:37) with an optional
   `action?: { kind: 'buy-credits' }` (a closed union, not a free callback, so the
   reducer/state stays serializable and the renderer owns the wiring).
3. Map `code === PAYMENT_REQUIRED` → a notice `{ level: 'error', text, action: { kind: 'buy-credits' }, dismissible: true }`.
   The text is the server message (already actionable after `ff05cec8`).
4. `RuntimeNotices.tsx` renders the notice; when `action.kind === 'buy-credits'`, render
   a "Buy credits" button beside the text. The button calls the credits checkout. To
   avoid coupling the agent package to the credits feature, the chat exposes an
   `onBuyCredits?: () => void` (or `noticeActions?: { buyCredits?: () => void }`) prop
   threaded from full-app; full-app passes a handler that calls `useCreditBalance().buy()`.
   **Open question for review:** prop-threading through `CoreWorkspaceAgentFront` →
   `PiChatPanel` → `RuntimeNotices` vs. a neutral DOM event the credits layer listens
   for. Prop is explicit/testable; event is zero-plumbing but implicit. Leaning prop.

**Where the prompt rejection is caught.** `prompt()` rethrows after rollback
(remotePiSession.ts:223); the React caller (composerPolicy.submit → the chat
`onSubmitMessage`/queue controller) currently swallows/【shows】 it. Need to confirm the
exact catch site and route it into the reducer as a notice (today only stream
`protocol-error`/`error` events become notices, not POST rejections).

**Edge cases.** Don't duplicate the notice on retry (stable notice id, e.g.
`credit-exhausted`). Clear it when a later run is admitted (a successful submit removes
the notice). Only show the CTA when checkout is actually wired (the handler is a no-op /
absent otherwise — reuse `balance.checkoutEnabled`).

**Tests.** reducer: a payment-required notice carries the `buy-credits` action; a
generic error does not. RuntimeNotices: renders the button only for that action and
invokes the handler. routeErrorCode: extracts/validates the code, undefined on junk.

---

## 2. [HIGH] Refresh the balance immediately after a run

**Problem.** Badge/panel poll every 30s + on focus; after a run consumes credits the
shown balance is stale until then.

**Approach.** `useCreditBalance` already listens for the `credits:refresh` window event
(`CREDITS_REFRESH_EVENT`). Need a dispatcher on turn completion. `PiChatPanel` has
`prevStatusRef`; add an effect: when status transitions from a busy state to `idle`
(a run finished), fire the signal. To keep the agent package credits-agnostic, dispatch
a **neutral** event (e.g. `boring:agent-turn-complete`) and have `useCreditBalance`
listen to BOTH that and `credits:refresh`; OR expose an `onTurnComplete?` callback prop
that full-app wires to `dispatchEvent(new Event(CREDITS_REFRESH_EVENT))`.
**Open question for review:** neutral event (decoupled, implicit) vs. callback prop
(explicit, more plumbing). Leaning neutral event named generically, documented.

**Edge cases.** Debounce: only fire on busy→idle transitions, not every render. Don't
fire on initial mount (`prevStatusRef` starts 'idle'). A follow-up that goes
idle→submitted→idle fires once per completion — acceptable (each completion may bill).

**Tests.** A status transition busy→idle dispatches exactly one event; idle→idle and
mount do not. Hook: receiving the event triggers a refetch.

---

## 3. [MED] Post-purchase landing + auto-refresh

**Problem.** Checkout opens LS in a new tab; `BORING_CREDITS_LS_REDIRECT_URL` is unset;
on return there's no confirmation and no balance refresh.

**Approach.**
1. Set a sensible default redirect (full-app) back to the app with a marker query param,
   e.g. `…/?checkout=success` (configurable via `BORING_CREDITS_LS_REDIRECT_URL`).
2. On app load, detect `?checkout=success` (in full-app `main.tsx` or a tiny shell
   effect): fire `CREDITS_REFRESH_EVENT`, show a transient success toast/notice
   ("Payment received — credits added"), and strip the param from the URL
   (`history.replaceState`) so a reload doesn't re-trigger.
3. The balance is authoritative from the server (the webhook credited it); the refresh
   just pulls the new value. If the webhook hasn't landed yet (race), the success
   message is still correct ("payment received") and the next poll/refresh catches up —
   optionally retry the refresh a couple times over ~5s.

**Open question for review:** the checkout opens in a NEW TAB (`window.open`), so the
redirect lands in that tab, not the app tab. Options: (a) keep new-tab + the success
landing in that tab tells the user to return; (b) switch to same-tab redirect for
checkout so the return lands in the app. Same-tab is the cleaner post-purchase UX but
loses the app state during checkout (SPA reloads on return). Leaning: same-tab redirect
to `?checkout=success`, since the SPA rehydrates and the marker drives the toast+refresh.

**Tests.** A load with `?checkout=success` fires the refresh event, shows the toast, and
clears the param; a normal load does nothing.

---

## 4. [MED] Purchase / usage history

**Problem.** No spending breakdown or receipt list.

**Approach.**
1. **Backend:** a read-only `GET /api/credits/history?limit=N` returning the user's
   recent credit ledger — grants (signup + purchases) and usage debits — newest first,
   each `{ id, kind: 'grant'|'purchase'|'usage'|'refund'|'fallback', amountMicros,
   createdAt, description }`. New store method `listLedger(userId, limit)` querying
   `creditGrants` + `usageLedger` (+ purchase metadata), capped (e.g. 50) and indexed by
   `created_at`. Auth-gated (same `getUserId` as balance). Money-safe: read-only, no PII
   beyond the user's own rows.
2. **Frontend:** a collapsible "Recent activity" list in the `CreditsSettingsPanel`
   (lazy-fetch on expand), formatted with `formatCreditMicros` + relative dates.

**Open questions for review:** (a) merge grants+usage in one query (UNION + order +
limit) vs. two queries + merge in code; (b) how much usage detail (per-run vs.
per-message) — propose per-ledger-row, since that's what exists; (c) pagination — start
with a capped most-recent list (no paging) and note paging as follow-up.

**Tests.** store: `listLedger` returns merged, ordered, capped rows scoped to the user.
route: auth required; returns the shape; respects the limit. front: renders rows, empty
state.

---

## 5. [LOW] Pack picker (€10 / €25 / €50)

**Problem.** Checkout always uses the default pack; no chooser.

**Approach.**
1. Expose the available packs to the client. The balance endpoint already returns
   `checkoutEnabled`; add `packs?: Array<{ id: string; credits: number }>` (id = the
   EUR pack value; credits = micros) derived from the configured `checkout.variants` +
   `creditMicrosByVariant`. (Variant ids stay server-only; the client only sees pack
   ids.)
2. The settings panel renders the packs as selectable options; the badge keeps the
   single default-pack button. Selecting a pack passes `{ pack }` to
   `POST /api/credits/checkout` (already supported + validated server-side).

**Open question for review:** show the picker in the settings panel only (badge stays a
one-click default), or also a small dropdown on the badge? Leaning settings-only to keep
the top bar minimal.

**Tests.** balance route exposes packs from config; panel renders them and sends the
chosen pack to checkout.

---

## Cross-cutting

- **Layering:** the agent package must not import the credits feature. Items #1/#2 cross
  the agent↔credits boundary — resolve via a neutral event or a callback prop (flagged
  above for review).
- **Build order:** core changes require a core rebuild before full-app typechecks
  (separate dist entry points).
- **No money-path change:** all five are read/display/UX; crediting, idempotency, and
  fail-closed billing are untouched. The history endpoint is read-only.
- **Test coverage:** unit tests per item (reducer, hook, store, route, components); core
  + full-app typecheck + build green.
