# Credits + Purchase Launch Plan (boring-ui full-app)

## Goal
Ship, for the `apps/full-app` launch: metered AI credit consumption, a free starter grant
on signup, and the ability to buy more credits via Lemon Squeezy (Merchant of Record,
prepaid packs). LLM calls go directly to an EU provider (Infomaniak), priced from token
usage with a margin.

## Decisions (locked)
- **Credit unit:** 1 credit = €0.000001 (balance reads in euros; €10 pack ⇒ €10 of credits).
- **Starter grant:** €2 on signup (`reason = 'signup_grant'`, idempotent per user).
- **Packs:** €10 / €25 / €50, prepaid, one-time (no subscriptions for launch).
- **Payments:** Lemon Squeezy, Merchant of Record (handles EU VAT). Hosted checkout.
  Webhook `order_created` ⇒ `grantOnce(reason='purchase:<order-id>')` (idempotent on retry,
  additive across purchases).
- **Pricing:** Infomaniak returns tokens (not cost). Bill = token rate (€/MTok in+out) ×
  margin, in code config (not DB). The charged amount per run is already persisted in the
  `boring_usage_ledger` (immutable audit).
- **Module home:** generic `credits` module in `@hachej/boring-core` (promoted from the
  macro demo adapter); `apps/full-app` wires it in one call.

## Production launch gates (enforced at startup)
- **`BORING_CREDITS_LS_TEST_MODE=0` in production.** Test-mode checkouts are non-charging but
  still mint spendable credits (the balance isn't mode-scoped), so `NODE_ENV=production` +
  test mode throws at startup. Purge any test-mode credit grants before live cutover.
- **Webhook requires server-side checkout.** The webhook only credits orders carrying a
  server-signed attribution token (`custom_data.uat`), which only a server-created checkout
  mints. So `BORING_CREDITS_LS_WEBHOOK_SECRET` set without checkout config
  (`BORING_CREDITS_LS_API_KEY` + store id + variants) **throws at startup** — otherwise real
  orders would 500 forever as `untrusted_attribution` (paid, never credited).
- **No `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1` in production.** The soft-stop override
  is rejected in prod; the per-run hold must cover at least the **served** worst-case run
  (raise `RESERVATION_EUR`/grant, or restrict served models). The override only matters for a
  hold below the *served* worst case — the default (served-rate) hold needs no override and
  boots cleanly in prod (it only warns about the unmatched/misrouted-model debt window).

## External / human-gated (not code)
- Merge **boring-ui #294** (metering foundation) — everything here stacks on it.
- Lemon Squeezy: account **KYC + payout bank** (long pole), create the **packs** in the
  dashboard (test mode; variant ids are positive integers), add the **webhook** subscribed
  to **both `order_created` AND `order_refunded`** (signing secret). Without `order_refunded`
  the refund-revoke path never fires and refunded credits stay spendable.
- Secrets in Vault: `secret/shared/lemonsqueezy` → `test_api_key` (present), `webhook_secret`
  (to add); Infomaniak API key.
- Test key confirmed: store "boring-ui" (id 406592), key `ovh`, **test mode**.

## Phases & tasks

### Phase 1 — boring-core `credits` module (no live deps, unit-testable)
1. `credits/pricing.ts` — model token-rate table (Infomaniak + Kimi/Claude fallbacks) ×
   margin; `usageToCredits(usage, model, config)` → { tokens, providerCostMicros,
   billedCreditMicros }. Mirrors the macro pricing. **+ tests**
2. `credits/lemonSqueezy.ts` — `verifyLemonSqueezySignature` (HMAC-SHA256, timing-safe),
   `parseLemonSqueezyOrder`, `handleLemonSqueezyWebhook(rawBody, sig, opts)` →
   verify → parse → `grantOnce('purchase:<order-id>')`. **+ tests**
3. `credits/creditsService.ts` — policy over `PostgresMeteringStore`: signup grant,
   reserve/record/settle/release, balance shaping (EUR). Promoted from macro
   `DemoCreditService`. **+ tests (pg)**
4. `credits/meteringSink.ts` — `createCreditsMeteringSink(service)` → `AgentMeteringSink`
   (fail-closed reserve, returns reservationId). **+ tests**
5. `credits/routes.ts` + `index.ts` — `createCreditsModule(opts)` → { meteringSink,
   registerRoutes(app), grantSignupCredits(userId) }. Routes: `GET /api/credits/balance`,
   `POST /api/credits/webhooks/lemonsqueezy` (raw body), optional `POST /api/credits/checkout`.

### Phase 2 — Infomaniak provider
6. Verify the existing boring-agent Infomaniak provider config; document the env
   (`BORING_AGENT_INFOMANIAK_*`); add Infomaniak model rates to `credits/pricing.ts`.

### Phase 3 — full-app wiring
7. `apps/full-app/src/server`: build `createCreditsModule` over `app.db`, pass
   `metering` into `createCoreWorkspaceAgentServer`, register credits routes, wire the
   signup grant into the post-signup hook. Env/Vault for LS + Infomaniak.

### Phase 4 — frontend
8. Balance badge + "Buy credits" CTA (LS checkout overlay/URL with `user_id` custom data);
   402 / low-balance UX.

### Phase 5 — validation
9. Unit tests + typecheck + build green. LS **test-mode** end-to-end once packs + webhook
   exist (gated). Deploy.

## Execution note
Phases 1–2 and the code of 3 are buildable now on `feat/native-pi-metering`; the live LS
end-to-end (5) and #294 merge are the gates. Build, unit-test, and stage so it lights up
when the test packs + webhook secret land.

## Environment contract (`apps/full-app`)
All money config is **fail-closed**: a provided-but-invalid value throws at startup
(`readCreditsConfig`), never silently falls back.

| Env var | Required | Meaning |
|---|---|---|
| `BORING_CREDITS_ENABLED` | no (default on) | `0` disables consumption + purchase routes entirely. |
| `BORING_CREDITS_SIGNUP_GRANT_EUR` | no (default 2) | Free starter grant, EUR. |
| `BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS` | no (default never) | `0`/unset = never (the only supported value). A positive integer **throws at startup**: an expiring grant drops from `grantedMicros` on expiry while spent usage debits stay, turning a partly-spent trial into debt. Re-enable only once usage is allocated/capped against the promo balance. |
| `BORING_CREDITS_RESERVATION_EUR` | no | Per-run hold. **Unset ⇒ computed SERVED worst-case run** (see limitations). An explicit value below the **served** worst case **throws** unless `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1`; below the *effective* worst case only warns. |
| `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION` | no | `1` accepts a per-run hold below the **served** worst-case run (soft stop; launch-blocking debt). Forbidden in production. Not needed for the served-rate default. |
| `BORING_CREDITS_MIN_BALANCE_EUR` | no (default 0.05) | Floor kept available **after** a run's hold. |
| `BORING_CREDITS_MARGIN` | no (default 1.3) | Pricing margin; must be ≥ 1. |
| `BORING_CREDITS_RATES` | recommended | `regex=inEur:outEur;…` per-MTok rates (e.g. `infomaniak=0.5:1.5`). Matched against `provider/id`. Non-positive/malformed entries throw. |
| `BORING_CREDITS_MAX_CONTEXT_TOKENS` / `_MAX_OUTPUT_TOKENS` / `_MAX_CALLS_PER_RUN` | no (200k/16k/4) | Worst-case-run inputs for hold sizing. |
| `BORING_CREDITS_MAX_RUN_SECONDS` | no (default 1800) | Declared max wall-clock runtime of a single run. Startup **throws** unless `RESERVATION_TTL_SECONDS ≥ this + 300s` slack — so the stale-reservation sweep can't charge-on-expire a still-alive run (overcharge). |
| `BORING_CREDITS_RESERVATION_TTL_SECONDS` | no (default 7200) | How long a per-run hold survives before the sweep settles/expires it. Must exceed `MAX_RUN_SECONDS + 300s`. |
| `BORING_CREDITS_LS_WEBHOOK_SECRET` | for purchases | LS webhook signing secret (raw-body HMAC). |
| `BORING_CREDITS_LS_STORE_ID` | **required if webhook secret set** | Webhook ignores orders from other stores. |
| `BORING_CREDITS_LS_CREDIT_ONLY_STORE` | no (default 1) | `1` = the store sells only credit packs ⇒ an unknown-variant paid order on our store is a pack misconfig (retryable 500). `0` = a mixed store ⇒ such an order is a different product and is 200-ignored (no infinite retry/alert on legitimate non-credit sales). |
| `BORING_CREDITS_LS_TEST_MODE` | **required if LS configured** | Exactly `0` (live) or `1` (test). |
| `BORING_CREDITS_LS_VARIANTS` | for purchases | `creditEur:variantId,…` — pack value (EUR, drives crediting) → LS variant id (**positive integer**). Duplicate pack/variant ids throw. |
| `BORING_CREDITS_LS_API_KEY` / `_LS_DEFAULT_PACK` / `_LS_REDIRECT_URL` | for checkout | Server-side checkout creation. |
| `VITE_CREDITS_BUY_ENABLED` | no | Front fallback for the Buy button (server `checkoutEnabled` takes precedence). |

Money-safety invariants enforced in code: fixed per-variant crediting (no order-amount
fallback); net-paid ≥ pack value (underpayment rejected); discounts disabled + checkout
locked to the selected variant; per-order global idempotency with full-identity conflict
detection; refund reconciliation by order id with store/mode matching; unknown models
fail closed at the highest effective rate.

## Known limitations (accepted for launch, documented)
1. **Per-run hard stop is not per-call.** The hold bounds a run's overdraft (sized for
   `MAX_CALLS_PER_RUN` worst-case calls); a run exceeding that budget can overshoot, bounded,
   and the user's *next* run is then refused. True per-call enforcement needs a Pi-runtime
   abort hook (the metering coordinator is an observer) — a deliberate follow-up.
2. **Hold sizing: served vs effective.** The per-run hold defaults to the SERVED-rate worst
   case (`maxServedRate` — configured rates + conservative floor, excluding the built-in
   Opus default), so it's proportional to the models you serve and a small starter grant
   stays usable. Two thresholds at startup:
   - Below the **served** worst case → **throws** (the hold can't even hold a normal run).
     Only reachable with an explicit too-low `BORING_CREDITS_RESERVATION_EUR`; set
     `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1` to accept it deliberately (forbidden in
     production).
   - Served ≤ hold < **effective** worst case (the default, since an UNMATCHED model bills at
     `maxEffectiveRate` incl. Opus) → **warns only**. A misrouted/unknown expensive model
     creates recoverable single-run debt (bounded; next run refused), not a hard stop. This is
     the accepted launch posture; the recommended served-rate default boots cleanly with no
     override. **Action for a hard stop on unknown models:** raise `RESERVATION_EUR`/the
     starter grant to cover the effective worst case, or restrict served models.
3. **Durable settlement under a sustained DB outage (narrowed).** `expireStaleReservations`
   **charges-on-expire** a reservation that either has **positive billed usage** (`billedTotal
   > 0` — the run executed real billable work but its finalization never settled) OR carries a
   durable **`charge_on_expire` marker** (the coordinator decided the run must be charged the
   fallback hold — a started/successful run with no billable usage — and set the marker BEFORE
   attempting the charge, so a charge write that then fails transiently is still recovered by
   the sweep). It **frees** reservations that are neither billed nor marked (only zero-token
   rows, or nothing at all — a genuine pre-execution/non-billable abandon, so we don't
   over-charge a user who closed the tab). The residual free-run window is therefore only a run
   whose terminal **marker write itself** failed (and stayed failed past TTL) — i.e. a DB outage
   spanning the decision point, when nothing durable can be written anyway. The complete fix (an
   external out-of-DB settlement-intent log + retry worker) is a tracked follow-up. The "TTL
   above any real run's max runtime" mitigation is now **enforced**, not folklore: startup
   throws unless
   `BORING_CREDITS_RESERVATION_TTL_SECONDS ≥ BORING_CREDITS_MAX_RUN_SECONDS + 300s`, so the sweep
   can't charge-on-expire a still-alive long run (which would overcharge it: the hold top-up plus
   the run's later usage). Alert on logged fallback failures. (Per-message usage is debited as it
   arrives regardless of the hold.)
4. **Purchase key is namespaced by store+mode** at the route layer
   (`ls:<store>:<test|live>:<orderId>`), so a Lemon Squeezy order id reused across test/live
   or stores (or test data sharing a prod DB) can't collide. The DB column is still a plain
   text PK holding that composite value (the raw id is the suffix + an audit column).
5. **Refund vs in-flight admission = recoverable debt, not free credits.** A run admitted
   just before a refund commits runs on credits the refund removes; its usage posts and the
   refund debit drives the balance negative (surfaced as `debtMicros`, blocking the next run).
   This is recoverable debt, not free usage. A run never admitted *after* refund processing
   starts (per-user advisory lock).
6. **A refund with a missing/zero `refunded_amount`** is treated as a full refund (merchant-
   safe; LS always sends the amount). Customer-fairness reconciliation is operator-side.

## Accepted structural debt (tracked, not blocking — money paths are correct & tested)
- Extract a focused `PostgresCreditPurchaseStore` (purchase/refund lifecycle) and a
  `LemonSqueezyCreditPolicy` (one normalized validated-order decision) out of
  `PostgresMeteringStore`/`routes`. The logic is correct and covered by 130+ tests; this is
  an auditability refactor.
- Consolidate the webhook's store/mode/currency/variant predicates (`isOurStoreOrder`,
  `isRefundForOurStore`, `isCreditVariant`, `isCreditOrder`, `isUnverifiedCreditOrder`) into one
  pure `classifyLemonSqueezyOrder(order, policy) → 'credit' | 'foreign' | 'unknown_variant' |
  'incomplete_identity'` with a direct decision-table test. Behaviour is correct and covered by
  the webhook tests today; this is an auditability refactor (the overlapping booleans encode one
  money-critical decision tree).
- Promote `usage_ledger.reservationId` from JSON metadata to a first-class nullable column
  (the expiry fallback relies on the metadata tag today).
- **Signup grant is issued lazily on first balance/reserve, not at account creation.**
  `getBalance`/`reserveRun` call `grantSignupCredits(userId)` (idempotent per user), so any
  pre-existing account also receives the configured starter grant the first time it loads the
  balance badge — acceptable for a fresh launch (no prior users) and a single non-expiring
  grant per user (the expiring-grant config is now rejected at startup, so this can't create
  debt). Follow-up: wire the grant into the auth post-signup hook (`createPostSignupHook`
  already exists) and a one-time backfill policy, then remove the lazy grant from the
  read/admission paths so issuance is tied to account creation.
