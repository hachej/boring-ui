# getnao / nao auth study

Grounding evidence for the identity model (plan §6.6 two-flow model, slice 1c).
External validation for better-auth's internal-user plus linked social/credential
account shape and nao's messaging linking-code UX. The later composition spike
clarified that phone identity itself lives on the `user` row and is **not** an
`account` provider; see [`betterauth-spike-report.md`](betterauth-spike-report.md).
Produced during the #1127 / PR #1211 grounding pass (2026-08-11).

---

## 1. nao runs the same stack we extend — better-auth validation

nao (`getnao` / nao) authenticates on **better-auth** (`^1.6.3`), the same
library boring-core already mounts (`createAuth.ts`). Observed:

- **Internal-id user model with linked accounts.** better-auth's
  `user` + `account(providerId → userId)` tables support one internal user with
  linked credential/social accounts (Google, GitHub, email/password).
- **`accountLinking.enabled`.** nao enables better-auth account linking for its
  supported social/OAuth providers.

Takeaway: the internal-user/social-account shape is proven, but it does **not**
make phone “provider #4.” The 1.6.26 spike found that phone is stored directly
on the user row; phone↔email attachment therefore needs the manual orchestration
specified in plan §6.6.

---

## 2. nao's linking-code pattern (plan Flow A)

nao links an external messaging identity to an existing web account via a
**short, regenerable linking code**:

1. Authenticated web user requests a linking code (short, human-typable,
   regenerable — a new one invalidates the old).
2. User opens the messaging channel and sends `/login <code>` (or equivalent).
3. Backend resolves the code → `userId`, then records the messaging identity
   against that authenticated user through application-owned linking logic.

This is the plan's **Flow 2a** (web-first → link WhatsApp). It is the right UX
shape for connecting a messaging identity to an existing account, but better-
auth `accountLinking` alone does not attach a phone.

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
- **Therefore a WhatsApp-first web-session flow must use a short-lived,
  single-use out-of-band challenge**, not nao's reusable linking code and not
  stock email magic-link semantics. The 1.6.26 spike found unsafe side effects
  when stock magic-link was treated as phone proof; see the recovered report.

The plan therefore keeps linking and session establishment distinct: Flow 2a
may use a regenerable code to link an identity, while phone-proof web access
requires a purpose-built, single-use challenge/session-mint flow.

---

## 4. How these findings land in the plan

| Finding | Lands in |
| --- | --- |
| better-auth `^1.6.3`, internal-id + linked social/credential accounts, `accountLinking.enabled` | §6.6 social-side validation, slice 1c |
| Linking-code UX (`/login <code>`), with application-owned phone attachment | §6.6 Flow 2a, slice 1c |
| Reusable-code warning for session establishment | §6.6 custom OOB challenge, §7.5, slice 1c |
