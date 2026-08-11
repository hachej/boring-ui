# getnao / nao auth study

Grounding evidence for the identity model (plan §6.6 two-flow model, slice 1c).
External validation that the multi-provider / one-user-N-linked-identities shape
we extend is the standard shape, not something we invent. Produced during the
#1127 / PR #1211 grounding pass (2026-08-11). Unverifiable items flagged
`[UNVERIFIED]`.

---

## 1. nao runs the same stack we extend — better-auth validation

nao (`getnao` / nao) authenticates on **better-auth** (`^1.6.3`), the same
library boring-core already mounts (`createAuth.ts`). Observed:

- **Internal-id user model with linked identities.** better-auth's
  `user` + `account(providerId → userId)` tables: one internal user, N linked
  provider accounts (Google, GitHub, email/password, and — in our extension —
  phone/WhatsApp). This is the provider-agnostic identity model, confirmed live
  in a shipping product.
- **`accountLinking.enabled`.** nao turns on better-auth account linking so a
  user who authenticates via a second provider **links** onto the existing user
  rather than creating a duplicate. This is exactly the convergence rule the plan
  adopts (§6.6 "always link into the current session").

Takeaway: the plan's phone/WhatsApp-as-provider-#4 model is an **extension of a
proven better-auth deployment shape**, not a generalization project. No
single-provider model needs generalizing first.

---

## 2. nao's linking-code pattern (plan Flow A)

nao links an external messaging identity to an existing web account via a
**short, regenerable linking code**:

1. Authenticated web user requests a linking code (short, human-typable,
   regenerable — a new one invalidates the old).
2. User opens the messaging channel and sends `/login <code>` (or equivalent).
3. Backend resolves the code → `userId`, then links `externalUserId → userId`
   via better-auth `accountLinking`.

This is the plan's **Flow A** (web-first → link WhatsApp). It is the right shape
for connecting a messaging identity to an **existing** account.

---

## 3. The single-use-verification-token warning (why Flow B differs)

The critical negative finding — do **not** copy nao's linking-code shape for
web-session establishment:

- nao's **linking code is long-lived and reusable** by design (it is convenient
  to keep a code around to re-link). That is acceptable for a one-time identity
  **link** — the worst case is linking the same identity again.
- **It is a security bug as a *session* credential.** A long-lived, reusable code
  that mints a *web session* is a session-token-that-never-expires — anyone who
  sees the code (forwarded WhatsApp message, shoulder-surf) can open a session,
  repeatedly.
- **Therefore Flow B (WhatsApp-first → magic-link web) must use better-auth's
  single-use `verification(identifier, value, expiresAt)` token** — short TTL,
  consumed on first exchange — exactly as password-reset already does. The
  linking code never mints a session; the single-use verification token does.

This is why the plan keeps two distinct flows with two distinct token types:
Flow A uses the (reusable) linking code to *link an identity*; Flow B uses the
(single-use) verification token to *establish a session*.

---

## 4. How these findings land in the plan

| Finding | Lands in |
| --- | --- |
| better-auth `^1.6.3`, internal-id + `account(providerId→userId)`, `accountLinking.enabled` | §6.6 "external validation", slice 1c |
| Linking-code pattern (`/login <code>`) | §6.6 Flow A, slice 1c item 4 |
| Single-use-verification-token warning | §6.6 Flow B security note, §7.5, slice 1c |
