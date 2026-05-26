# Google signup for any child app — plan

**Status:** review ready
**Scope:** `@hachej/boring-core` + child-app docs/skill
**Worktree:** `.worktrees/google-signup-child-app-auth`

## Executive summary

This plan keeps Google signup small.

We already use **better-auth** as the core auth provider. better-auth already knows how to do Google OAuth. So this is **not** a new auth system and **not** a custom Google integration from scratch.

This plan only does five things:

1. expose Google credentials in core config
2. gate Google with one app-level feature flag: `features.google_oauth = true`
3. wire `socialProviders.google` into the existing better-auth setup
4. add one reusable front-end primitive: `GoogleAuthButton`
5. mount the Google callback route in the same auth system

If a child app uses the stock `@hachej/boring-core` auth stack, Google should work **out of the box** once the app sets credentials and enables the feature.

## Core idea

`@hachej/boring-core` already owns auth.

Today that auth stack is:

- core config
- core auth routes
- better-auth session/cookie/user handling
- core stock auth pages

Google should be added as **one social provider inside the existing better-auth provider**, not as a second provider system.

That means:

- no separate auth architecture
- no custom token/session model
- no app-specific Google wiring in each child app
- no forked auth pages required for normal usage

## Goal

Make Google signup/signin a near-zero-code opt-in for any child app built on `@hachej/boring-core`.

A stock child app should only need:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `features.google_oauth = true`

Implementation note:

- `boring.app.toml` is optional today in this repo
- child apps that want Google and do not already have a `boring.app.toml` file will need to add one

Then core should provide:

- Google on stock sign-in
- Google on normal stock sign-up
- Google callback handling through the existing auth stack
- one reusable `GoogleAuthButton` for branded child apps

## Why this matters

Child apps should not need to fork core auth pages just to add one mainstream social provider.

The value of this feature is:

- child apps can enable Google with a tiny config delta
- core remains the canonical auth owner
- branded child apps can reuse one small primitive instead of re-learning better-auth
- we avoid auth drift across child apps

This should feel boring in a good way: obvious to enable, hard to misconfigure, and narrow in scope.

## User workflows

### Workflow A — stock child app

1. app operator sets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
2. app operator sets `features.google_oauth = true`
3. user visits `/auth/signin`
4. user sees **Continue with Google**
5. user signs in through Google and lands back in the app authenticated

### Workflow B — stock signup page

1. user visits `/auth/signup`
2. user sees **Continue with Google** and the existing email form
3. user can choose Google or email signup
4. existing email signup behavior stays unchanged

### Workflow C — invite signup

1. invited user lands on `/auth/signup?invite_token=...`
2. user sees the existing email signup flow only
3. user completes the existing invite-aware email signup path

This is an intentional first-pass simplification. We choose correctness over OAuth state-carry complexity.

### Workflow D — branded child app

1. child app overrides core auth pages
2. child app imports `GoogleAuthButton` from core
3. child app keeps its own branding/layout while reusing core OAuth behavior

## Non-goals for this first pass

- generic social-provider registry
- a second auth provider abstraction
- invite-token carry across OAuth redirects
- Google One Tap
- provider-specific landing-page config
- redesigning core auth override APIs
- adding more providers in the same change

## Locked decisions in this draft

These are the intentional simplifications this plan asks you to approve:

- **Google comes through better-auth.** No separate auth system.
- **No `GOOGLE_OAUTH` env flag.** First pass uses one app-level TOML flag plus credentials.
- **Invite signup stays email-only.** No OAuth invite-token carry in v1.
- **One shared front-end primitive only.** Ship `GoogleAuthButton`, not a generic provider UI.
- **Explicit Google callback route.** No generalized callback-routing refactor in this change.
- **Missing credentials disable Google cleanly.** App should still boot.

## Current state

### What already exists

- `packages/core/src/server/auth/createAuth.ts` already uses better-auth `socialProviders`
- the current better-auth wiring already supports GitHub in the same config shape
- `packages/core/src/server/config/loadConfig.ts` already handles provider-specific auth config
- core already owns auth routes, cookies, sessions, and stock auth pages
- child apps can already override auth pages through `<BoringApp authPages={...} />`

### What is missing

- no Google config surface in core
- no Google runtime/capability flag
- stock sign-in/sign-up pages are still email-only
- no shared Google auth button for child-app overrides
- callback routing/public-page handling is still GitHub-specific in places
- invite-aware social signup semantics are not defined
- docs still describe social auth as deferred / GitHub-specific

## Target child-app experience

```bash
# .env
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

```toml
# boring.app.toml
[features]
google_oauth = true
```

If the child app does not already have a `boring.app.toml`, create one with at least that `features` block.

Then the child app gets:

- Google button on core `SignInPage`
- Google button on core `SignUpPage` for normal signup flow
- better-auth Google callback flow handled by the existing core auth system
- optional reusable `GoogleAuthButton` for branded auth-page overrides

First-pass scope rule for robustness:

- if the signup page has an `invite_token`, keep that page email-only and hide the Google button
- invited users keep using the existing email signup path in v1
- social signup + invite-token state carry can come later if a real user needs it

## Proposed implementation

### 1. Config surface

Add Google alongside the existing GitHub shape.

**Server env:**

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

**TOML:**

- `features.google_oauth = true`

**Types to update:**

- `CoreConfig.auth.google?: { clientId: string; clientSecret: string }`
- `CoreConfig.features.googleOauth: boolean`
- `RuntimeConfig.features.googleOauth: boolean`
- `CoreCapabilities.features.googleOauth: boolean`
- `CoreCapabilities.auth.google: boolean`

**Rules:**

- `googleOauth` resolves `true` only when `features.google_oauth = true` and both credentials exist
- if the flag is on but credentials are missing, the app still boots; Google simply resolves off
- keep existing GitHub behavior unchanged in this pass
- do not introduce provider arrays or a generic provider model yet

### 2. better-auth wiring

In `createAuth()`:

- extend `socialProviders` to include `google` when `config.auth.google` exists
- keep existing GitHub handling intact
- do not add provider-specific custom logic beyond the minimum better-auth config needed for Google

Expected shape:

```ts
socialProviders: {
  ...(config.auth.github ? { github: {...} } : {}),
  ...(config.auth.google ? { google: {...} } : {}),
}
```

### 3. Front-end auth UX

Add one small shared helper in core front auth.

Shipped piece:

- `GoogleAuthButton`
- visibility driven by `useConfig()`
- internally calls `authClient.signIn.social({ provider: 'google', callbackURL: '/' })`
- optional `callbackURL` prop is acceptable for branded child apps; default stays `'/'`

Use it in:

- `packages/core/src/front/auth/SignInPage.tsx`
- `packages/core/src/front/auth/SignUpPage.tsx`

UX rules:

- show Google button above email form
- show divider like “or continue with email”
- hide button unless `features.googleOauth === true`
- on sign-up pages with `invite_token`, hide the Google button and keep the current email flow unchanged
- preserve current email/password flow exactly

### 4. Callback-route audit

Do not treat this as a button-only change.

Google support must also audit every place that currently assumes GitHub callback routing:

- route map / front utils
- `CoreFront` route registration
- any server-side auth-page allowlist/public-page handling
- the frontend-auth SPA shell allowlist in `createCoreWorkspaceAgentServer.ts`
- route tests for `/auth/callback/google`

Important implementation note:

- core's better-auth base path is `/auth`, not `/api/auth`
- that means `/auth/callback/google` is a real auth callback path in this app
- do not drop this route work based on better-auth defaults from other setups

Keep this simple in the first pass:

- add the explicit Google callback route everywhere needed
- do **not** generalize callback routing yet

### 5. Child-app override seam

For child apps with branded auth pages, expose a reusable surface instead of forcing every app to rediscover better-auth client calls.

Shipped seam:

- export `GoogleAuthButton` from `@hachej/boring-core/front`

Rule: do **not** redesign the whole auth-page override API for this.

### 6. Docs + skill

Create/update:

- core docs section for Google signup env + redirect URI setup
- child-app setup skill with exact steps
- required callback URL notes:
  - local: `http://localhost:3000/auth/callback/google`
  - prod: `https://<app-domain>/auth/callback/google`

## What exactly must be implemented

This feature is small. The implementation breaks into eight concrete pieces:

1. **Core config**
  - add `GOOGLE_CLIENT_ID`
  - add `GOOGLE_CLIENT_SECRET`
  - add `features.google_oauth = true`
  - teach `TomlAppConfig.features` to read `google_oauth`
2. **better-auth wiring**
  - extend the existing core auth setup so `socialProviders.google` is passed into better-auth
3. **Capabilities/runtime flags**
  - expose `features.googleOauth`
  - expose `core.auth.google`
  - update `buildRuntimeConfigPayload()` so the frontend actually receives `features.googleOauth`
4. **Reusable front-end primitive**
  - add `GoogleAuthButton`
  - have it call `authClient.signIn.social({ provider: 'google', callbackURL: '/' })`
5. **Stock auth pages**
  - use `GoogleAuthButton` on stock sign-in
  - use it on normal stock sign-up
  - hide it for invite-token signup
6. **Callback route**
  - add `/auth/callback/google`
  - make sure it is mounted and treated like a public auth callback route
  - update the frontend-auth SPA shell allowlist in `createCoreWorkspaceAgentServer.ts`
7. **Docs + skill**
  - update `CORE.md`
  - update the child-app setup skill
  - document `BETTER_AUTH_URL`, `CORS_ORIGINS`, and callback URLs
8. **Tests**
  - config tests
  - auth wiring tests
  - callback-route tests
  - button visible/hidden tests
  - existing email auth tests still passing

If these eight things land cleanly, the feature is done.

## File map

### Core server

- `packages/core/src/server/config/loadConfig.ts`
- `packages/core/src/server/config/schema.ts`
- `packages/core/src/shared/types.ts`
- `packages/core/src/server/app/capabilities.ts`
- `packages/core/src/server/auth/createAuth.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- config tests + auth tests

### Core front

- `packages/core/src/front/auth/SignInPage.tsx`
- `packages/core/src/front/auth/SignUpPage.tsx`
- `packages/core/src/front/auth/index.ts`
- `packages/core/src/front/utils.ts`
- `packages/core/src/front/CoreFront.tsx`
- maybe new helper file under `packages/core/src/front/auth/`
- front tests

### Docs / teaching

- `packages/core/docs/CORE.md`
- `.agents/skills/boring-google-signup-setup/SKILL.md`

## Implementation task groups

### Task group 1 — config + shared types

- add `auth.google` to core config
- add `features.googleOauth` to runtime/shared types
- add Google capability fields
- update `TomlAppConfig.features` for `google_oauth`
- update `buildRuntimeConfigPayload()` so the frontend receives `features.googleOauth`
- keep the activation rule simple: TOML flag + credentials

**Verify:** config tests cover enabled and disabled cases.

### Task group 2 — server auth wiring

- extend `createAuth()` with Google provider wiring
- update capabilities so Google reports as usable when enabled/configured

**Verify:** auth creation tests and capabilities tests.

### Task group 3 — callback-route audit

- add `/auth/callback/google` to route helpers
- mount that route in `CoreFront`
- update `createCoreWorkspaceAgentServer.ts` SPA-shell auth-page allowlist
- ensure auth callback routes are treated as public where needed

**Verify:** route tests for the mounted Google callback path.

### Task group 4 — front-end auth UX

- add `GoogleAuthButton`
- use it in stock sign-in page
- use it in stock sign-up page
- hide it for invite-token signup

**Verify:** auth-page tests for visible/hidden states and click behavior.

### Task group 5 — docs + child-app teaching

- update `CORE.md`
- update/add the child-app setup skill
- include local + prod callback URIs
- include `BETTER_AUTH_URL` and `CORS_ORIGINS` callouts in setup docs

**Verify:** docs match the actual shipped env names and exported front-end primitive.

## Acceptance criteria

### Product

- a child app can enable Google signup without forking core auth pages
- default sign-in page shows Google when enabled
- default sign-up page shows Google when enabled for normal signup flow
- default sign-up page stays email-only when `invite_token` is present
- Google button is absent when feature/credentials are missing
- custom child-app auth pages can import `GoogleAuthButton` from core

### Technical

- config validation covers Google env + flag resolution
- better-auth receives the Google provider config only when valid
- `/api/v1/config` exposes `features.googleOauth`
- `/api/v1/capabilities` exposes Google auth availability
- `core.auth.google` means the user can use Google auth right now, not just that some config exists
- `/auth/callback/google` is mounted and treated as a public auth callback route
- existing GitHub behavior keeps working

### Tests

1. `loadConfig` resolves `googleOauth` correctly when TOML flag + creds are present
2. `loadConfig` keeps `googleOauth=false` when creds are incomplete
3. `createAuth` includes Google provider when configured
4. `CoreFront` mounts `/auth/callback/google`
5. `SignInPage` renders Google button only when enabled
6. `SignUpPage` renders Google button only when enabled for normal signup flow
7. `SignUpPage` hides Google when `invite_token` is present
8. clicking Google calls `signIn.social({ provider: 'google' ... })`
9. existing email sign-in/sign-up tests still pass

## Dependencies / rollout order

1. **Config + types** → frontend/runtime/server all depend on this
2. **better-auth server wiring** → no useful UI without real provider wiring
3. **Callback-route audit** → keeps OAuth return path from becoming a hidden bug
4. **Front-end button/helper** → only after config + callback path exist
5. **Docs + child-app skill** → only after exported names and env contract are final

## Risks / watchouts

- **Docs drift:** repo docs still mention social auth as deferred / GitHub-specific in several places; do a focused doc sweep, not just one line edit
- **Callback mismatch:** Google will fail if `BETTER_AUTH_URL` is wrong; docs must be explicit
- **Invite flow complexity:** do not invent OAuth state-carry for invites in this first pass; hide Google on invite signup instead
- **Capability ambiguity:** define `core.auth.google` as “usable now” in this first pass, not just “configured somewhere”
- **Over-design risk:** do not build a generic provider framework yet
- **Redirect choice:** if `/` is not a safe post-login route for every child app, keep `GoogleAuthButton` small and add one optional `callbackURL` prop later instead of inventing a config tree now

## Review questions

Please review this draft against these decisions:

1. **Provider model:** approve treating Google as one better-auth social provider inside the existing core auth stack?
2. **Config shape:** approve TOML flag + credentials, with no separate `GOOGLE_OAUTH` env flag?
3. **Invite behavior:** approve hiding Google on invite-token signup instead of solving OAuth state carry now?
4. **Front-end seam:** approve shipping only `GoogleAuthButton` in v1?
5. **Routing scope:** approve adding an explicit Google callback path instead of generalizing callback routing now?
6. **Redirect default:** approve defaulting the Google button callback to `'/'` for the first pass?

If the answer to all six is yes, this plan is ready to implement.

## Nice-to-have later, not in this first pass

- generic `socialProviders` runtime type
- GitHub + Google unified provider list
- Google One Tap
- provider icons/theme slots
- provider-specific callback/landing route config