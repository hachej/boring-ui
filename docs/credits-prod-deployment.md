# Credits / billing — production deployment checklist

Status: the credits + purchase system is implemented, unit-tested, and thermo-reviewed
(8 gpt-5.5 rounds → clean). It has been verified **locally** end-to-end EXCEPT the two
items flagged "UNPROVEN" below. This is the punch list to take it live.

## 0. Decide the provider
- [ ] Choose **Stripe** or **Lemon Squeezy** (configure exactly one — the app refuses both).
      Stripe is wired + tested; LS is also wired but its store is still under review.

## 1. Stripe setup (if Stripe)
- [ ] Use **live** keys (`sk_live_…`/`rk_live_…`) — prefer a **restricted key** (rk_) with
      only Checkout + Products/Prices write scopes. Store in the prod secrets vault, NOT env files.
- [ ] Set `BORING_CREDITS_STRIPE_TEST_MODE=0` (the app refuses test mode in production).
- [ ] Create **live** Products/Prices; set `BORING_CREDITS_STRIPE_VARIANTS="5:price_…,10:price_…,25:price_…"`
      (+ `BORING_CREDITS_STRIPE_DEFAULT_PACK`). Decide the real tiers/amounts.
- [ ] Register a **real webhook endpoint** in the Stripe Dashboard → `https://<domain>/api/credits/webhooks/stripe`
      for events `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `charge.refunded`, `charge.dispute.created`. Put its signing secret in
      `BORING_CREDITS_STRIPE_WEBHOOK_SECRET`. (The local `stripe listen` forwarder is dev-only.)
- [ ] Set `BORING_CREDITS_STRIPE_CURRENCY` to a **2-decimal** currency (e.g. CHF/EUR/USD).
      Non-2-decimal currencies (JPY/KWD/…) are rejected — the credit math assumes /100.
- [ ] Set `BORING_CREDITS_STRIPE_REDIRECT_URL=https://<domain>/` (required; success/cancel).
- [ ] (Optional) `BORING_CREDITS_STRIPE_ATTRIBUTION_SECRET` (+`_PREVIOUS`) for rotating the
      webhook secret without breaking in-flight checkouts. Defaults to the webhook secret.
- [ ] Stripe Dashboard → **Settings → Business → Public business name** = the brand
      ("Seneca AI") — the checkout merchant header is account-level, NOT settable via API.
- [ ] Replace the product **logo** with a stable hosted URL (the dev `:5180/logo.png` is
      ephemeral) — upload via Dashboard or point at the deployed `/logo.png`.

## 2. Credits economics (MUST validate before launch)
- [ ] **UNPROVEN: consumption.** Validate `BORING_CREDITS_RATES` (per-model EUR/MTok) against
      a REAL model run — confirm a turn debits a sane credit amount. All local tests used a
      dummy model, so the reserve/hold is proven but real token→credit pricing is not.
- [ ] Tune the per-run hold: `BORING_CREDITS_RESERVATION_EUR` (or the derived served
      worst-case), `BORING_CREDITS_MAX_CONTEXT_TOKENS/_OUTPUT_TOKENS/_CALLS_PER_RUN`.
- [ ] Set the **signup grant**: `BORING_CREDITS_SIGNUP_GRANT_EUR` (≥ the per-run hold, or new
      users can't run their first turn) + optional `_EXPIRES_DAYS`.
- [ ] Decide **currency vs. credit unit**: credits are internally EUR-valued
      (`CREDIT_MICROS_PER_EUR`), but Stripe may charge CHF/USD. Today 1 major unit ≈ 1
      credit-euro (no FX). Confirm this is acceptable or add an FX conversion.

## 3. App / infra
- [ ] Run DB migrations on the prod DB (`pnpm --filter full-app run migrate`); the credits/
      metering tables (migration 0011_usage_metering + grants/reservations) must exist.
- [ ] Real prod env: `DATABASE_URL`, `BETTER_AUTH_SECRET` (high-entropy), `BETTER_AUTH_URL`,
      `CORS_ORIGINS` (the prod origin), `WORKSPACE_SETTINGS_ENCRYPTION_KEY`, mail transport.
- [ ] Deploy with the production model provider configured (so runs actually execute + meter).
- [ ] `BORING_CREDITS_ENABLED=1` (it's the kill switch; `=0` disables consumption + purchase).

## 4. End-to-end verification on staging (the two UNPROVEN gaps)
- [ ] **Real card payment**: complete a real Stripe checkout (live or a staging test) → confirm
      `checkout.session.completed` hits the registered webhook → balance credited → "Credits added".
- [ ] **Real consumption**: run the agent → confirm credits decrement by a sensible amount →
      run to exhaustion → confirm the out-of-credits gate (402) + the Buy CTA.
- [ ] **Refund**: issue a Stripe refund → confirm credits are revoked (tombstone/idempotent).

## 5. Ops
- [ ] Monitor webhook 5xx (the handler fails LOUD on unattributable paid orders so they retry
      and surface) — alert on sustained `untrusted_attribution`/`underpaid_order`/`invalid_money_fields`.
- [ ] Reconciliation runbook for stuck/parked orders (Stripe Dashboard ↔ ledger).
- [ ] Before go-live: purge any test-mode grants from the prod DB (test purchases mint real
      spendable credits — the app refuses test mode in prod for this reason).
