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

## External / human-gated (not code)
- Merge **boring-ui #294** (metering foundation) — everything here stacks on it.
- Lemon Squeezy: account **KYC + payout bank** (long pole), create the **packs** in the
  dashboard (test mode), add the **webhook** (event `order_created`, signing secret).
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
| `BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS` | no (default never) | `0`/unset = never; else a positive integer. |
| `BORING_CREDITS_RESERVATION_EUR` | no | Per-run hold. **Unset ⇒ computed worst-case run** (see limitations). An explicit value below the worst case **throws** unless `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1`. |
| `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION` | no | `1` accepts a per-run hold below the worst-case run (soft stop; launch-blocking debt). |
| `BORING_CREDITS_MIN_BALANCE_EUR` | no (default 0.05) | Floor kept available **after** a run's hold. |
| `BORING_CREDITS_MARGIN` | no (default 1.3) | Pricing margin; must be ≥ 1. |
| `BORING_CREDITS_RATES` | recommended | `regex=inEur:outEur;…` per-MTok rates (e.g. `infomaniak=0.5:1.5`). Matched against `provider/id`. Non-positive/malformed entries throw. |
| `BORING_CREDITS_MAX_CONTEXT_TOKENS` / `_MAX_OUTPUT_TOKENS` / `_MAX_CALLS_PER_RUN` | no (200k/16k/4) | Worst-case-run inputs for hold sizing. |
| `BORING_CREDITS_LS_WEBHOOK_SECRET` | for purchases | LS webhook signing secret (raw-body HMAC). |
| `BORING_CREDITS_LS_STORE_ID` | **required if webhook secret set** | Webhook ignores orders from other stores. |
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
2. **Hold sizing includes built-in expensive defaults.** `maxEffectiveRate` covers Claude
   Opus (15/75) from the built-in table even if you only serve Infomaniak, so the default
   hold can exceed the €2 starter grant (a startup warning fires). **Action for launch:** set
   `BORING_CREDITS_RATES` for your served models and tune `MAX_CONTEXT_TOKENS`/
   `MAX_CALLS_PER_RUN` (or set `RESERVATION_EUR`) so the hold ≤ the starter grant.
3. **Durable settlement under a sustained DB outage.** If usage write *and* the fallback
   charge both fail and stay failed past the reservation TTL, that one run can free up (the
   hold blocks the user until then; failures are logged for reconcile). A persistent
   settlement-retry queue is a follow-up. **Related:** a reservation whose run outlives
   `BORING_CREDITS_RESERVATION_TTL_SECONDS` (default 2h) is expired and freed, so a stuck/
   abandoned run's hold doesn't leak — keep the TTL comfortably above any real run's max
   runtime so an in-flight run's hold isn't released early. (Per-message usage is debited as
   it arrives regardless of the hold.)
4. **Single-store purchase key.** The purchase PK is `order_id`; cross-store/mode collisions
   are prevented by the per-store/mode webhook secret + config validation. A composite
   `store:mode:order_id` key would harden a future multi-tenant DB.
