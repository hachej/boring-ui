# WhatsApp auth + billing research

Grounding evidence for the WhatsApp consumer's identity model (plan §6.6, §7.5,
slice 1c) and its billing note (plan §7.6). Produced during the #1127 / PR #1211
grounding pass (2026-08-11) and checked in here as durable evidence rather than
left in scratchpad. Findings that could not be verified against a primary source
are flagged `[UNVERIFIED]` inline.

Scope note: this file grounds the **WhatsApp consumer**, not the generic channel
mechanism. Auth (OTP vs magic-link) is WhatsApp-consumer-specific; the generic
`isIdentityProvider` capability flag is what the mechanism exposes.

---

## 1. WhatsApp auth — OTP authentication templates do NOT need the 24h window

The single most important finding, because it removes a blocker the plan
previously assumed:

- Meta's **authentication-category message templates** (OTP / one-time-passcode
  templates) are a distinct template category from UTILITY and MARKETING. They
  are **business-initiated** and therefore do **not** depend on an open 24-hour
  customer-service window. A signup/login OTP can be sent to a number that has
  never messaged us.
- Auth templates support the **copy-code** and **one-tap** button types. The
  **copy-code** button is the low-friction default: the user taps "Copy code",
  the code is placed on the clipboard, they paste it back.
- Recommended **OTP TTL: 10 minutes** — matches better-auth's default magic-link
  / verification-token expiry, so the WhatsApp delivery adapter and the auth
  layer agree on lifetime without extra config.
- Consequence for the plan: the **channel-as-verifier** path (first inbound
  proves control of the number) remains the primary, zero-template signup path;
  the **OTP auth-template** path is the documented fallback that also works
  business-initiated (e.g. the "get login link / code on WhatsApp" reverse flow
  when the user is on the web login page and has not yet messaged us).

`[UNVERIFIED]` exact per-region auth-template pricing; treated as
conversation-billed like other template categories (see §3).

---

## 2. SMS fallback during WABA ramp

While the WhatsApp Business Account (WABA) quality tier ramps, per-number
messaging limits apply:

- A newly-verified number starts in a **low messaging tier** and is **capped at
  ~2,000 business-initiated conversations/day** until quality + volume raise the
  tier. User-initiated replies inside a service window do not count against this
  the same way, but business-initiated OTP/login sends do.
- **Mitigation: SMS fallback for the auth OTP/login path during the ramp.** If a
  WhatsApp auth send is throttled or the number is not yet on WhatsApp, fall back
  to an SMS OTP through a CH/EU-jurisdiction SMS provider. This keeps signup/login
  working while the WABA tier climbs, and is auth-path-only (never for agent
  conversation content, which stays WhatsApp-native).
- This is a **WhatsApp-consumer-specific** operational concern; it does not touch
  the generic channel mechanism.

---

## 3. Billing — Stripe Checkout at first payment, email + VAT, Swiss QR-bill

Billing enters the model at the **first payment** value moment (plan §6.6
progressive-email ladder makes email effectively required here).

- **Stripe Checkout at first payment.** Do not collect card details at signup.
  Trigger a **Stripe Checkout** session at the first payment moment; Checkout
  collects the email and billing details Stripe needs. This aligns with the
  progressive-email ladder — email becomes required exactly when billing does.
- **Email + VAT collected at Checkout.** Swiss/EU invoicing needs a billing
  email and, for business customers, a **VAT/UID number**. Stripe Tax /
  Checkout can collect and validate these.
- **Swiss QR-bill is mandatory for CH invoicing.** Swiss B2B invoices must carry
  a **QR-bill** (the standardized payment slip with the Swiss QR code). Use the
  **`swissqrbill`** library to generate it. The QR-bill embeds the creditor
  reference, IBAN (QR-IBAN), and amount.
- **Swiss VAT rate: 8.1%** (standard rate, 2024+). Invoices show the **UID**
  (Unternehmens-Identifikationsnummer, `CHE-###.###.###` formatted with the
  `MWST`/VAT suffix for VAT-registered entities).
- **Data path:** Stripe is a US processor. Card/billing PII flowing through
  Stripe Checkout is acceptable (it is payment data the customer knowingly enters
  into a payment form), and is **distinct from WhatsApp message content**, which
  stays CH/EU-side under the no-US-data-path posture (plan §2.4, §6.3). Keep the
  two data paths separate and say so in the privacy policy.

`[UNVERIFIED]` exact Stripe Tax coverage for every CH edge case; confirm QR-IBAN
vs standard-IBAN reference-type at implementation time.

---

## 4. How these findings land in the plan

| Finding | Lands in |
| --- | --- |
| OTP auth-templates skip the 24h window; 10-min TTL copy-code | §6.6 identity (fallback path), §7.5 security, slice 1c |
| SMS fallback during WABA ramp (2000/day cap) | §7.6 billing/ramp note, §7.2 policy |
| Stripe Checkout at first payment; email+VAT | §6.6 progressive-email ladder, §7.6 |
| Swiss QR-bill (`swissqrbill`), 8.1% VAT, UID | §7.6 billing note |
