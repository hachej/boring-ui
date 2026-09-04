# Issue #1127 — grounding references

Version-controlled research evidence backing the **External Channels** execution
plan (`docs/issues/1127/plan-whatsapp.md`, PR #1211) — specifically the WhatsApp
consumer's identity model (§6.6, §7.5, slice 1c) and its billing note (§7.6).

Provenance: authored during the #1127 / PR #1211 grounding pass (2026-08-11) from
the WhatsApp auth/billing and getnao/nao research and checked in here as durable
evidence (not left in scratchpad). Primary-source claims are transcribed as found. Anything unverifiable is
flagged `[UNVERIFIED]`; notably, OTP templates operating outside the 24-hour
window and the ~2,000/day fresh-number limit still require primary Meta
citations before the Phase-2 identity path is built.

Scope: these references ground the **WhatsApp consumer**, not the generic channel
mechanism (§6). Auth flows, OTP templates, and Swiss billing are all
WhatsApp-consumer-specific.

| File | What it grounds |
| --- | --- |
| [`whatsapp-auth-billing-research.md`](whatsapp-auth-billing-research.md) | WhatsApp auth hypotheses (including the **unverified, load-bearing** claim that authentication templates bypass the 24h window and the **unverified** ~2,000/day ramp figure) and billing context (Stripe Checkout, Swiss QR-bill formatting, 8.1% VAT, UID). Grounds §6.6, §7.5–§7.6, and slice 1c subject to those gates. |
| [`getnao-auth-study.md`](getnao-auth-study.md) | better-auth validation (nao runs `^1.6.3` with the internal-id + `account(providerId→userId)` linked-identity model and `accountLinking.enabled`), nao's linking-code pattern (plan Flow A), and the single-use-verification-token warning. Grounds §6.6 two-flow model and slice 1c. |
| [`betterauth-spike-report.md`](betterauth-spike-report.md) | Recovered result record for the better-auth 1.6.26 phone-identity composition spike. The original harness was not committed; Phase 2 must reproduce and automate all five flows before implementation. |
