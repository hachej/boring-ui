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
