# Issue #1127 — grounding references

Version-controlled research evidence backing the **External Channels** execution
plan (`docs/issues/1127/plan-whatsapp.md`, PR #1211) — specifically the WhatsApp
consumer's identity model (§6.6, §7.5, slice 1c) and its billing note (§7.6).

Provenance: authored during the #1127 / PR #1211 grounding pass (2026-08-11) from
the WhatsApp auth/billing and getnao/nao research and checked in here as durable
evidence (not left in scratchpad). Primary-source claims are transcribed as found;
anything unverifiable is flagged `[UNVERIFIED]` inside each file.

Scope: these references ground the **WhatsApp consumer**, not the generic channel
mechanism (§6). Auth flows, OTP templates, and Swiss billing are all
WhatsApp-consumer-specific.

| File | What it grounds |
| --- | --- |
| [`whatsapp-auth-billing-research.md`](whatsapp-auth-billing-research.md) | WhatsApp auth (OTP auth-templates skip the 24h window, 10-min copy-code TTL; SMS fallback during the WABA 2000/day ramp) and billing (Stripe Checkout at first payment for email+VAT; mandatory Swiss QR-bill via `swissqrbill`, 8.1% VAT, UID). Grounds §6.6 identity fallback, §7.5 security, §7.6 billing, and slice 1c. |
| [`getnao-auth-study.md`](getnao-auth-study.md) | better-auth validation (nao runs `^1.6.3` with the internal-id + `account(providerId→userId)` linked-identity model and `accountLinking.enabled`), nao's linking-code pattern (plan Flow A), and the single-use-verification-token warning (why Flow B must use the single-use `verification` token, not a reusable linking code). Grounds §6.6 two-flow model and slice 1c. |
