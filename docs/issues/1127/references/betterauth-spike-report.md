# better-auth 1.6.26 phone-identity spike — recovered report

**Run date:** 2026-08-11
**Recovery date:** 2026-09-04
**Scope:** Phase-2 identity research only; not required by the provisioned-binding pilot
**Source receipt:** [PR #1211 §6.6 identity-corrections comment](https://github.com/hachej/boring-ui/pull/1211#issuecomment-5252253841)

This is the durable report that the reviewed plan cited but PR #1211 omitted.
It records the observed outcomes preserved in the owner-authored receipt and the
r4.1 plan. The original scratch workspace and executable spike harness were not
committed, so this file is **not a reproducible test bundle**. Re-run these flows
against the exact deployed better-auth version before implementing Phase 2.

## Composition under test

- better-auth `1.6.26` (resolved from the then-declared `^1.6.3` range)
- real SQLite database
- `phoneNumber` plugin with `signUpOnVerification`
- email/password, social-provider linking, `changeEmail`, `setPassword`, and
  magic-link APIs as applicable to each flow

Version caveat: these observations describe `1.6.26`. In particular, do not
back-project magic-link session/account side effects onto exact `1.6.3`; pin and
re-test the deployed version.

## Observed flows

### Flow 1 — phone signup and placeholder collision

The happy path created one verified-phone user and session with the temporary
email supplied by `getTempEmail`; it created no `account` row and left email
unverified. A phone-only user therefore had no credential account and could not
use password login until enriched.

Pre-claiming the deterministic placeholder through ordinary email signup caused
later phone verification to fail with HTTP 500 / `SQLITE_CONSTRAINT_UNIQUE`; no
phone user was created. better-auth did not reserve that namespace. Phase 2 must
reserve the placeholder domain, normalize and validate E.164 input, and map a
collision to a stable recoverable error.

### Flow 2 — replace placeholder email

`updateUser` returned HTTP 400 `EMAIL_CAN_NOT_BE_UPDATED`. The supported path was
`changeEmail`. A no-verification replacement worked only while the old email was
unverified and `changeEmail.updateEmailWithoutVerification` was enabled.
better-auth may hide a collision behind a successful-looking response to avoid
account enumeration, so callers must re-read user state after the change.

### Flow 3 — phone/email composition

`link-social` with `{provider: "phone-number"}` returned HTTP 404
`PROVIDER_NOT_FOUND`. Phone identity lives on the `user` row rather than in an
`account` provider row, so `account.accountLinking` does not compose phone and
email.

The resulting design seam is manual orchestration: email-first users attach a
phone through authenticated OTP verification with `updatePhoneNumber=true`;
phone-first users add email/password through `changeEmail` plus server-only
`setPassword`. Social/OAuth linking remains a separate `accountLinking` concern.

### Flow 4 — collision and transfer are not merge

No user-merge API was present. Attaching a phone already owned by another user
returned HTTP 400 `PHONE_NUMBER_EXIST` and consumed the OTP. Detaching then
reattaching could transfer the number, but both user rows survived; it did not
merge users, workspaces, sessions, or domain records.

A real merge therefore remains custom transactional work with explicit survivor,
foreign-key, conflict, audit, and rollback rules. It is off the pilot path and
must be support-assisted rather than automatic.

### Flow 5 — stock magic-link is not phone proof

Delivering a stock email-keyed magic link over WhatsApp made token possession act
as proof of the email address. On the tested unverified phone-first user,
redemption changed email verification state, revoked prior sessions, and removed
the credential account. The stock magic-link flow must not be used as proof of
phone/WhatsApp possession. A phone-proof web session requires a separate
out-of-band challenge/session-mint design; stock magic links remain suitable only
after a real email is verified.

## Implementation gate

These findings size and constrain a possible Phase-2 identity slice. Before that
slice is dispatched, recreate the harness in-repo, pin the exact better-auth
version, and turn each outcome above into an automated regression. The v1 pilot
requires none of these flows because unknown senders fail closed and bindings are
provisioned.
