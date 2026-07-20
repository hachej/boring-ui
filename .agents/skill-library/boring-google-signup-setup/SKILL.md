---
name: boring-google-signup-setup
description: Teach a boring-ui child app how to enable Google signup with @hachej/boring-core. Use when the user asks for Google auth, Google OAuth, social signup, or how to turn on Google sign-in/sign-up in a child app.
---

# Boring Google Signup Setup

> This skill is the child-app setup contract for the plan in `docs/plans/archive/google-signup-child-app-plan.md`.
> Use it to teach or verify the shipped child-app setup shape for Google signup.

## Goal

When using this skill, default to giving the user a short manual **to-do list** for the Google-side setup plus the exact app config/env changes they must make.

Do **not** imply that normal Google Sign-In web OAuth client creation is cleanly supported by `gcloud`/Terraform here. Treat Google-side client creation as a manual Console task unless the user explicitly asks for a brittle browser-automation workaround.

Turn on Google signup/signin for a child app with:

1. Google OAuth credentials
2. the existing better-auth core envs: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGINS`
3. two Google env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
4. one feature flag: `features.google_oauth = true`
5. no auth-page fork unless the app wants custom branding

## Assumed child-app contract

Core auth already runs on better-auth. Google is one provider inside that existing core auth stack, not a second auth system.

Core exposes Google signup when all of these are true:

- `GOOGLE_CLIENT_ID` is set
- `GOOGLE_CLIENT_SECRET` is set
- `features.google_oauth = true` in `boring.app.toml`

If any one is missing, the app still boots and the Google button stays hidden.

There is no `GOOGLE_OAUTH` env flag in this first pass.

## Why this setup is simple

This feature is intentionally narrow:

- Google is enabled by one app-level TOML flag plus credentials
- stock core auth pages gain the button automatically
- invite signup stays on the existing email-only path
- branded child apps reuse `GoogleAuthButton`

That keeps the first pass easy to teach and hard to break.

## Quick path

### 1. Create Google OAuth credentials

This step is currently a **manual Google Cloud Console to-do**, not a normal `gcloud` automation step for this skill.

In Google Cloud Console:

- create/select a project
- enable Google Identity / OAuth consent screen
- create an OAuth client ID for **Web application**
- add redirect URIs:
  - local: `http://localhost:3000/auth/callback/google`
  - prod: `https://<your-domain>/auth/callback/google`

Copy:
- client ID
- client secret

### 2. Set child-app env vars

```bash
BETTER_AUTH_SECRET=<32-byte random hex>
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Notes:

- `BETTER_AUTH_SECRET` is still required because Google uses the same better-auth session/callback flow as email auth.
- `BETTER_AUTH_URL` must match the deployed app origin that owns `/auth/callback/google`.
- `CORS_ORIGINS` must include every browser origin that can start auth.

For production, use the real deployed origin, for example:

```bash
BETTER_AUTH_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
```

### 3. Enable the feature in `boring.app.toml` (create it if missing)

```toml
[features]
google_oauth = true
```

`boring.app.toml` is optional. If the child app does not already have one, create it at the repo root and add the `[features]` block above.

Rule:
- env vars provide credentials
- TOML expresses app intent
- both are required
- missing credentials should disable Google cleanly, not break app boot
- do not invent a separate `GOOGLE_OAUTH` env flag

### 4. Boot the app

```bash
pnpm dev
```

Expected result:
- `/auth/signin` shows **Continue with Google**
- `/auth/signup` shows **Continue with Google** for normal signup flow
- `/auth/signup?invite_token=...` stays email-only in this first pass
- email/password still works

## Default child-app path

If the child app uses the stock core auth pages, nothing else is needed.

That is the whole point of this setup: **do not fork the auth pages just to add Google**. Core already wires Google through better-auth and shows the button automatically when the contract above is satisfied.

## Branded child-app path

If the child app already overrides core auth pages, reuse core's exported Google auth primitive instead of calling Better Auth directly everywhere. Ship the specific `GoogleAuthButton`; do not promise or build a generic provider picker for this first pass.

Usage shape:

```tsx
import { GoogleAuthButton } from '@hachej/boring-core/front'

export function MySignInPage() {
  return (
    <div>
      <GoogleAuthButton />
      {/* app-specific email form */}
    </div>
  )
}
```

Rule: child apps should consume core's auth helper, not rebuild `signIn.social({ provider: 'google' })` in every app.

If the app does nothing special with auth pages, it should keep using the stock core pages.

## What to print to the user

Default output shape for this skill:

1. **Google Console to-do list**
   - create/select project
   - configure consent screen
   - create Web application OAuth client
   - add local + production redirect URIs
   - copy client ID + client secret
2. **Child-app config to-do list**
   - set `GOOGLE_CLIENT_ID`
   - set `GOOGLE_CLIENT_SECRET`
   - set `BETTER_AUTH_URL`
   - set `CORS_ORIGINS`
   - set `features.google_oauth = true`
3. **Verification to-do list**
   - check `/auth/signin`
   - check `/auth/signup`
   - check invite signup stays email-only
   - test one negative case by removing one required setting

Only go beyond that if the user asks for deeper implementation help.

## Verify locally

### Browser checks

- open `/auth/signin`
- confirm the Google button is visible
- click it
- confirm browser redirects to Google
- finish login
- confirm you land back in the app authenticated
- open `/auth/signup`
- confirm the Google button is visible there too
- open `/auth/signup?invite_token=test`
- confirm the page stays email-only in this first pass

### Negative checks

Temporarily remove one setting and restart:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `features.google_oauth`

Expected result: button disappears cleanly; email auth still works.

## Deploy checks

For production verify all of these match exactly:

- `BETTER_AUTH_URL=https://your-real-domain`
- `CORS_ORIGINS=https://your-real-domain`
- Google redirect URI is `https://your-real-domain/auth/callback/google`
- browser origin matches `BETTER_AUTH_URL`

If callback/origin values drift, Google auth usually fails with redirect mismatch symptoms.

## Troubleshooting

### Button not showing

Check first:

- `GOOGLE_CLIENT_ID` present
- `GOOGLE_CLIENT_SECRET` present
- `google_oauth = true` in TOML
- `boring.app.toml` exists in the app root if you expect that flag to load
- app restarted after config change

### Redirect mismatch

Usually one of these is wrong:

- `BETTER_AUTH_URL`
- `CORS_ORIGINS`
- Google Cloud redirect URI
- deployed hostname/protocol

All of them must agree exactly.

### App uses custom auth pages and still has no Google button

The app is probably bypassing core's default auth UI. Import `GoogleAuthButton` into the override instead of expecting it to appear automatically.

## Scope boundaries

This skill is for **web Google signup/signin in child apps**.

Not in scope:

- Google One Tap
- native mobile token flows
- generic multi-provider architecture or provider-picker UI
- invite-token carry through OAuth redirects
- billing / tenant-specific auth policy

## References

- `docs/plans/archive/google-signup-child-app-plan.md`
- `packages/core/docs/README.md`
- `packages/core/src/server/auth/createAuth.ts`
- `packages/core/src/front/auth/SignInPage.tsx`
- `packages/core/src/front/auth/SignUpPage.tsx`
