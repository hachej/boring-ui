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

### Configured values (current policy)
- **Signup grant**: `BORING_CREDITS_SIGNUP_GRANT_EUR=0` → no free credits; users must buy
  before their first run (the out-of-credits gate + Buy CTA fires on the first prompt).
- **Margin**: `BORING_CREDITS_MARGIN=1.1` → 10% over raw provider cost.
- **Rates** (`BORING_CREDITS_RATES`, raw provider CHF/MTok — margin applied on top):
  verified Infomaniak AI prices (excl. VAT, source: infomaniak.com/en/hosting/ai-services/prices):
  | model | in CHF/MTok | out CHF/MTok |
  | --- | --- | --- |
  | Qwen3.5-122B (served) | 0.40 | 3.20 |
  | Kimi-K2 | 0.60 | 3.00 |
  | Apertus-70B | 0.70 | 2.50 |
  | Ministral-3-14B | 0.30 | 0.40 |
  | gemma-4-31B | 0.20 | 0.40 |
  | Nemotron-3-Nano | 0.05 | 0.20 |
  | Mistral-Small-4 | 0.20 | 0.75 |
  ```
  BORING_CREDITS_RATES="Qwen3.5-122B=0.40:3.20;Kimi-K2=0.60:3.00;Apertus=0.70:2.50;Ministral=0.30:0.40;gemma-4=0.20:0.40;Nemotron=0.05:0.20;Mistral-Small=0.20:0.75"
  ```
### Ad-hoc free credits (hand-picked testers)
No automatic signup grant — instead grant credits manually to selected high-potential
testers. Insert one row into `boring_credit_grants` (idempotent per `(user_id, reason)`,
so use a unique/dated reason; `amount_micros = CHF × 1_000_000`):
```sql
-- e.g. 10 CHF of free credits for a beta tester
INSERT INTO boring_credit_grants (user_id, amount_micros, reason)
VALUES ('<auth_user_id>', 10000000, 'manual:beta-tester:2026-06');
```
The balance picks it up immediately (grants − spend). Use a fresh `reason` to top the
same user up again. Do NOT set `expires_at` (an expiring grant after partial spend turns a
trial into debt — the service rejects expiring grants for this reason).

- **Currency alignment**: Stripe charges CHF and Infomaniak bills CHF, so we treat
  1 credit-unit = 1 CHF (no FX). The `_EUR` suffix in var names is cosmetic — keep ALL
  values (grant, rates, packs) in CHF and the books stay consistent. If you ever charge a
  currency ≠ the provider's billing currency, add an explicit FX step instead.

- [ ] **UNPROVEN: consumption.** Validate `BORING_CREDITS_RATES` against a REAL model run —
      confirm a turn debits a sane credit amount. Local tests used a dummy model, so the
      reserve/hold is proven but real token→credit pricing is not.
- [ ] Tune the per-run hold: `BORING_CREDITS_RESERVATION_EUR` (or the derived served
      worst-case), `BORING_CREDITS_MAX_CONTEXT_TOKENS/_OUTPUT_TOKENS/_CALLS_PER_RUN`.
- [ ] **Signup grant is 0** (`BORING_CREDITS_SIGNUP_GRANT_EUR=0`) — confirm the first-run
      out-of-credits gate (402) + Buy CTA is the intended new-user experience.

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

## 6. Go-live runbook — app.senecaapp.ai (Fly app `boring-full-app`, LIVE Stripe)
Prod currently runs an OLD consumption-only build: all purchase routes 404
(`/api/credits/{checkout,webhooks/stripe,webhooks/lemonsqueezy}`) and it still hands out the
legacy default signup grant. Setting env alone does NOTHING until the new build ships. Run in order:

**1. Ship the build that contains the Stripe provider + grant=0 + Infomaniak rates (PR #294):**
```bash
gh pr merge 294 --squash         # then deploy the merged main:
flyctl deploy -a boring-full-app  # release_command runs migrate.js → creates purchase tables
```

**2. LIVE Stripe catalog — ALREADY CREATED (account: Sumeo Solutions Sàrl, CH/CHF, charges+payouts enabled):**
- Product `prod_UhuqgFEy62sh0q` "Seneca AI Credits" (image → `https://app.senecaapp.ai/logo.png`)
- LIVE one-time CHF prices:
  - 5 CHF  → `price_1TicyDIKOzu3eMXHeKajQcTf`
  - 10 CHF → `price_1TicyDIKOzu3eMXHzcDolLt3`
  - 25 CHF → `price_1TicyDIKOzu3eMXHmFf8nL8v`
  - (a 4th `price_1TicyCIKOzu3eMXHNNPUzyzI` is custom/pay-what-you-want — UNUSED by the fixed-pack config)
- **Dashboard-only TODO:** Settings → Payments → disable "Adaptive Pricing"; set **Public business name = "Seneca AI"** (currently "Sumeo Solutions Sàrl" — this is the merchant header at checkout, not API-settable).

**3. LIVE webhook — ALREADY CREATED:** `we_1TidMgIKOzu3eMXHolmHkhy2` → `https://app.senecaapp.ai/api/credits/webhooks/stripe`,
events `checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded, charge.dispute.created`.
Signing secret stored in Vault as needed for the `_WEBHOOK_SECRET` fly secret.

**4. Set prod secrets (triggers a redeploy):**
```bash
flyctl secrets set -a boring-full-app \
  BORING_CREDITS_ENABLED=1 \
  BORING_CREDITS_SIGNUP_GRANT_EUR=0 \
  BORING_CREDITS_MARGIN=1.1 \
  BORING_CREDITS_RATES="Qwen3.5-122B=0.40:3.20;Kimi-K2=0.60:3.00;Apertus=0.70:2.50;Ministral=0.30:0.40;gemma-4=0.20:0.40;Nemotron=0.05:0.20;Mistral-Small=0.20:0.75" \
  BORING_CREDITS_STRIPE_SECRET_KEY="<vault: secret/shared/senecaapp/stripe live_sk>" \
  BORING_CREDITS_STRIPE_WEBHOOK_SECRET="<whsec from webhook we_1TidMg...>" \
  BORING_CREDITS_STRIPE_VARIANTS="5:price_1TicyDIKOzu3eMXHeKajQcTf;10:price_1TicyDIKOzu3eMXHzcDolLt3;25:price_1TicyDIKOzu3eMXHmFf8nL8v" \
  BORING_CREDITS_STRIPE_DEFAULT_PACK=10 \
  BORING_CREDITS_STRIPE_CURRENCY=CHF \
  BORING_CREDITS_STRIPE_TEST_MODE=0 \
  BORING_CREDITS_STRIPE_REDIRECT_URL="https://app.senecaapp.ai/" \
  BORING_CREDITS_STRIPE_ATTRIBUTION_SECRET="$(openssl rand -hex 32)"
```
`sk_live_` with `TEST_MODE=0` is enforced (key↔mode mismatch fails boot); the webhook also drops
events whose `livemode` ≠ expected. `_ATTRIBUTION_SECRET` is optional but recommended (signs the
user↔pack binding carried through checkout).

**5. Verify on prod:**
```bash
# purchase routes now exist (bad-sig 400, NOT 404):
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.senecaapp.ai/api/credits/webhooks/stripe -d '{}'
# authed balance → "checkoutEnabled":true and "grantedMicros":0 for a fresh account
```
Then in the browser: new account → first prompt hits 402 + Buy CTA → `+` → pick pack → LIVE card →
balance credits → run burns it down. Issue a refund → credits revoked.

**Note:** existing accounts created under the old build keep their legacy ~4.45 grant; grant=0 only
affects NEW signups. Zero out old test grants in the prod DB if you want a clean slate.
