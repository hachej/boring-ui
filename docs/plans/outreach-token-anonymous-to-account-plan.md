# Outreach token anonymous-to-account plan

## Goal

Cold outreach recipients open a personalized URL, enter the app immediately, try a scoped demo/output/workspace without contacting us, then self-convert into a normal logged-in account without losing the workspace/session they already used.

```txt
/o/<token>  ->  anonymous lead session cookie  ->  provisioned workspace/output
            ->  "Save / continue" signup      ->  same user/workspace becomes permanent
```

## Non-goals

- Do not auto-login recipients as the creator/sender.
- Do not put Better Auth session tokens or API keys in URLs.
- Do not require recipient email at outreach-link creation time.
- Do not make workspace routes token-aware. Token handling lives only in the outreach entry flow.
- Do not scatter `if anonymous` checks across app code.
- Do not manually write Better Auth tables unless phase-0 discovery proves there is no supported API and an isolated adapter is approved.

## Product behavior

1. Admin creates an **outreach experience**: what demo/template/output to provision and what anonymous capabilities apply.
2. Admin creates one or more **outreach links** for that experience.
3. Recipient opens `/o/<rawToken>`.
4. Server validates the token, creates/resumes an **outreach lead instance**, provisions the experience idempotently, creates a normal auth session cookie, and redirects to a clean internal path.
5. Recipient uses the app under anonymous capability limits.
6. High-intent actions show `Save this workspace` / `Continue`.
7. Recipient signs up in-app. The current anonymous user is claimed rather than replaced, so workspace membership, UI state, chat history, and runtime handles stay attached.

If `/o/<token>` is opened while a normal non-anonymous user is already signed in, MVP shows an interstitial:

```txt
You're signed in as <email>.
[Attach this demo to my account] [Open as new anonymous demo]
```

MVP default: **attach to current account only after explicit click**. No silent merging. The backend returns a short-lived signed `consume_intent` that references the hashed link id/action choices; the frontend never stores or reposts the raw outreach token. `Open as new anonymous demo` signs out/current-session-isolates only after confirmation, then POSTs the signed intent. This prevents accidental cross-account mutation and token leakage through frontend state.

## Core architecture

Use four explicit concepts:

```txt
OutreachExperience  = provisioning spec + default target + anonymous capability profile
OutreachLink        = token, expiry, revocation, campaign, experience_id
OutreachLead        = one anonymous/user lead instance created from a link
AuthIdentityAdapter = only boundary allowed to create/claim Better Auth identities/sessions
```

The public consume route stays boring:

```txt
validate/reserve token intent atomically
  -> create/resume lead identity without holding the link lock
  -> provision experience idempotently outside the link lock
  -> attach durable provision result atomically
  -> create session via AuthIdentityAdapter
  -> redirect to stored internal target path
```

Workspace routes continue to see a normal authenticated `req.user`; they do not learn about raw URL tokens.

## Auth namespace rules

Current Better Auth schema has globally unique `users.email`. Treat auth identity as **global**, not app-scoped.

Rules:
- Synthetic anonymous emails must be globally unique.
- Claim email uniqueness is global.
- The same real email cannot claim two separate users; if a user already exists, use an explicit merge/attach flow later, not MVP.
- `outreach_leads.app_id` scopes product access and auditing, not Better Auth uniqueness.
- `claimed_email` is audit/denormalized display history; canonical email remains `users.email` after claim.

## Data model

Add tables in `packages/core/src/server/db/schema.ts` + Drizzle migration.

### `outreach_experiences`

```txt
id uuid pk
app_id text not null
name text not null
provisioning_mode text not null -- clone_per_lead | shared_readonly | existing_workspace_viewer
template_workspace_id uuid null references workspaces(id)
default_target_path text not null default '/'
anonymous_capability_profile text not null default 'trial'
config jsonb not null default '{}'
created_by uuid null references users(id)
created_at timestamp not null default now()
updated_at timestamp not null default now()
```

Rules:
- Store/service methods always take `appId` and validate referenced workspaces/users belong to the same app.
- `default_target_path` must be an internal absolute path. Reject full URLs and protocol-relative URLs.

### `outreach_links`

```txt
id uuid pk
app_id text not null
experience_id uuid not null references outreach_experiences(id)
campaign_id text null
token_hash text unique not null
recipient_hint text null -- optional label, not auth identity
expires_at timestamp not null
revoked_at timestamp null
max_leads integer null
lead_count integer not null default 0
first_opened_at timestamp null
last_opened_at timestamp null
created_by uuid null references users(id)
created_at timestamp not null default now()
```

Rules:
- Store only token hash, never raw token.
- A link does **not** own a single `lead_user_id`. Forwarded/reopened-link behavior is policy, not schema accident.

### `outreach_leads`

```txt
id uuid pk
app_id text not null
outreach_link_id uuid not null references outreach_links(id)
user_id uuid not null unique references users(id)
provisioned_workspace_id uuid null references workspaces(id)
provisioned_target_path text null
provision_result jsonb not null default '{}'
provisioning_status text not null -- pending | provisioning | provisioned | failed
provisioning_error_code text null
provisioning_attempted_at timestamp null
provisioning_completed_at timestamp null
resume_nonce_hash text null
status text not null -- anonymous | claimed | blocked
claimed_at timestamp null
claimed_email text null
created_at timestamp not null default now()
updated_at timestamp not null default now()
```

Indexes/constraints:
- index `(outreach_link_id, status)` for resume/list.
- unique `user_id`.
- for `clone_per_lead`, `provisioned_workspace_id` should be unique when non-null.
- `provisioned_target_path` must be set with `provisioned_workspace_id`; redirects after retry/resume use stored result, not recomputed incidental state.
- optional unique idempotency key inside the provisioner if cloning uses additional resource tables.

Resume policy:
- If browser already has an authenticated anonymous lead session for this link, resume that lead.
- If no session exists and the link allows more leads, create a new lead.
- If a single-recipient link is already claimed or exhausted, show an expired/already-claimed page instead of sharing identity.

Because current Better Auth `users.email` is `NOT NULL UNIQUE`, anonymous lead users may need a synthetic internal email:

```txt
lead+<uuid>@anonymous.invalid
```

This is an implementation detail only. Public serializers must hide it.

## Canonical boundaries

### `OutreachService`

Owns token consumption and claim orchestration.

```txt
packages/core/src/server/outreach/
  service.ts       # consumeOutreachToken, claimOutreachLead
  tokens.ts        # generateRawToken, hashToken
  routes.ts        # /o/:token + /api/v1/outreach/*
  policy.ts        # AnonymousCapabilityPolicy
  serializers.ts   # public user/session shaping for anonymous leads
```

Avoid an anemic store abstraction unless existing core patterns require it. Prefer service functions that receive `db`, `AuthIdentityAdapter`, and provisioner dependencies.

### `ExperienceProvisioner`

Single home for demo/workspace provisioning. The consume route must not directly clone workspaces or mutate membership.

```ts
interface ExperienceProvisioner {
  provisionLeadExperience(input: {
    appId: string
    experienceId: string
    leadId: string
    userId: string
  }): Promise<{ workspaceId: string; targetPath: string }>
}
```

Provisioning contract:
- Idempotent by `leadId`.
- Safe under concurrent calls.
- Uses `outreach_leads.provisioning_status` or a DB-level idempotency key/lock to ensure one clone/resource set per lead.
- On failure, records stable error code and allows explicit retry.

Modes:
- `clone_per_lead`: safest default; each lead gets isolated mutable workspace.
- `shared_readonly`: cheap demo, no mutation.
- `existing_workspace_viewer`: explicit viewer-only access to an existing workspace.

### `AuthIdentityAdapter`

Only layer allowed to talk to Better Auth internals/APIs for outreach identity work.

```ts
interface AuthIdentityAdapter {
  createAnonymousUser(input: { appId: string; name?: string }): Promise<{ userId: string }>
  createSessionCookie(input: { userId: string; headers: Headers }): Promise<string[]>
  claimAnonymousUserWithPassword(input: {
    userId: string
    email: string
    password: string
    name?: string
  }): Promise<void>
}
```

Phase 0 must prove each method has a supported Better Auth API. If not, manual DB writes require:
- a single adapter implementation,
- contract tests against Better Auth session/account behavior,
- no direct `users`/`accounts`/`sessions` writes outside the adapter.

### `AnonymousCapabilityPolicy`

Server-side policy, phase 1, not frontend polish.

Phase 0 must identify the existing canonical authorization/capability hook. Phase 1 wires anonymous policy there. If no hook exists, create one central enforcement point before exposing outreach links.

```ts
interface AnonymousCapabilityPolicy {
  decide(ctx: {
    userId: string
    workspaceId?: string
    action: 'agent.run' | 'export' | 'invite' | 'deploy' | 'share' | string
  }): Promise<Decision>
}
```

UI mirrors policy for nicer CTAs, but routes/tools enforce it centrally. Selected-route checks are not enough for MVP unless the selected routes are the only capability entry points proven by Phase 0.

### Public user serialization

One canonical serializer hides synthetic emails and exposes anonymous state:

```ts
toPublicUser(user, leadState) -> {
  id,
  email: leadState?.status === 'anonymous' ? null : user.email,
  name: leadState?.status === 'anonymous' ? 'Anonymous lead' : user.name,
  isAnonymousLead: leadState?.status === 'anonymous',
}
```

All session/user APIs used by the frontend must flow through this boundary. Do not rely on individual screens hiding `.anonymous.invalid`.

## Routes

### `POST /api/v1/outreach/experiences`

Auth required. Admin/owner-only in MVP.

Creates provisioning spec. Validates app/workspace boundaries.

### `POST /api/v1/outreach-links`

Auth required. Admin/owner-only in MVP.

Body:

```ts
{
  experienceId: string
  campaignId?: string
  ttlHours?: number
  maxLeads?: number
  recipientHint?: string
}
```

Response:

```ts
{ url: string, expiresAt: string }
```

Security:
- Rate-limit.
- Redact raw token from logs.
- Return raw token only once.

### `GET /o/:token`

Public. Framework/access logs must mask this path before route-handler logging can expose it.

Do **not** hold the outreach link DB lock while provisioning or creating auth cookies.

Flow:

1. Atomic token reservation transaction:
   - hash token;
   - lock matching `outreach_links` row joined to `outreach_experiences` by `appId`;
   - check expired/revoked/max leads;
   - if normal user already signed in, create short-lived signed `consume_intent` and return interstitial state;
   - reserve a lead slot / existing lead id only; do not call Better Auth while holding this lock;
   - update link timestamps/counts.
2. Lead identity step outside the link lock:
   - if resuming an authenticated anonymous lead, reuse it;
   - otherwise create anonymous user through `AuthIdentityAdapter`, then insert/update `outreach_leads` in a short transaction;
   - if identity creation succeeds but lead insert fails, mark the synthetic user for cleanup or retry via stable orphan-cleanup job; Phase 0 must choose supported same-DB transaction vs resumable cleanup design.
3. Provision outside the link lock:
   - call `ExperienceProvisioner.provisionLeadExperience` keyed by `leadId`;
   - provisioner handles concurrent calls via lead status/idempotency lock.
4. Atomic attach transaction:
   - set `provisioned_workspace_id`, `provisioned_target_path`, `provision_result`, `provisioning_status='provisioned'`, completed timestamp;
   - if already provisioned by a concurrent request, reuse the stored provision result.
5. Create Better Auth session cookie through `AuthIdentityAdapter`.
6. Redirect to stored sanitized `provisioned_target_path`.

Failure:
- stable public error page for expired/revoked/exhausted/already-claimed;
- provisioning failure records code and can show retry/support copy without exposing internals.

### `POST /api/v1/outreach/claim`

Auth required; current user must be an anonymous lead.

MVP supports email/password claim:

```ts
{ email: string; password: string; name?: string }
```

Behavior:

1. Validate current user is anonymous lead.
2. Validate email globally unused.
3. Validate password with existing password-strength policy.
4. Claim same `user_id` through `AuthIdentityAdapter`.
5. Mark `outreach_leads.status='claimed'` and set `claimed_email/claimed_at`.
6. Send/trigger verification if enabled.
7. Keep current session alive.

Google/OAuth claim is phase 2 unless Better Auth exposes a clean account-linking path for the current anonymous user. Do not hack OAuth callback control flow in MVP.

## Frontend UX

Minimal changes:

1. Expose `isAnonymousLead` through canonical session/user serialization or a small `/api/v1/outreach/me` endpoint.
2. Add a `Save this workspace` CTA in app chrome when current user is anonymous.
3. Add `ClaimAccountModal` under core front auth components.
4. For gated actions, frontend asks server capability/permission state and shows claim CTA when denied for anonymous status.
5. Add signed-in interstitial for `/o/:token` opened by an existing normal user.

Keep the normal workspace shell unchanged. Anonymous users are normal authenticated users from workspace's perspective, with capability limits enforced centrally server-side.

## Security rules

- Raw token appears only once: creation response and recipient URL.
- Hash token at rest with HMAC using a dedicated secret or `BETTER_AUTH_SECRET`.
- Mask `/o/:token` in framework/access logs before handlers run.
- Redirect only to internal paths returned by `ExperienceProvisioner` and validated by shared helper.
- Short default TTL, e.g. 14-30 days for outreach; make revocation easy.
- Anonymous capability limits enforced server-side at canonical authorization/capability boundary.
- Add rate limits for create, consume, and claim.
- Add audit telemetry: created/opened/claimed/revoked, no raw token, no synthetic email.

## Implementation phases

### Phase 0 — discovery spike

- Confirm Better Auth APIs for creating a session for existing `userId`, creating an anonymous/synthetic user, and linking password credentials to an existing user.
- Decide the anonymous user + lead creation atomicity model: same DB transaction if possible, otherwise resumable two-step with orphan cleanup. Backend MVP cannot start until this is explicit.
- Confirm account row shape and generated schema constraints.
- Confirm auth namespace: global email uniqueness remains the rule.
- Identify existing capability/permission extension point for anonymous limits. If none exists, specify the new central hook before implementation.
- Decide first MVP provisioning mode: prefer `clone_per_lead` unless cost forces `shared_readonly`.
- Specify signed-in-existing-user interstitial continuation: short-lived signed consume intent plus POST action endpoint; no raw token in frontend state.

Deliverable: technical note approving or rejecting `AuthIdentityAdapter` internals and capability hook before product code.

### Phase 1 — backend foundation

- Add schema/migration/tests for experiences, links, leads, including provisioning status/idempotency constraints.
- Implement token generation/hash helper.
- Implement `AuthIdentityAdapter` with contract tests.
- Implement `ExperienceProvisioner` for chosen MVP mode with concurrency/idempotency tests.
- Implement server-side `AnonymousCapabilityPolicy` at the canonical authorization/capability hook.
- Implement create-link and consume-token routes with reservation/provision/attach phases.
- Tests: expiry, revoked, max leads, forwarded link does not share claimed identity, concurrent opens do not clone twice, durable stored provision target is reused after retry, signed-in interstitial does not repost raw token, no raw token stored/returned, redirect sanitization, global email uniqueness assumptions, app boundary validation, masked public user serialization, cookie set.

### Phase 2 — claim MVP

- Implement email/password claim route through `AuthIdentityAdapter`.
- Reuse existing password-strength validation.
- Send/trigger verification using existing mail policy.
- Tests: email collision, weak password, successful claim preserves user id/workspace membership/session, synthetic email never appears in public session response.

### Phase 3 — frontend

- Surface anonymous status.
- Add Save/Continue CTA and claim modal.
- Add claim-required UX for denied actions.
- Add existing-signed-in interstitial.
- Tests: anonymous sees CTA, claim success keeps current workspace, normal users do not see CTA, signed-in token open does not silently attach.

### Phase 4 — operations/polish

- Admin revoke/list basic route or CLI utility.
- Campaign/open/claim telemetry.
- Post-deploy smoke: create experience/link, consume link, claim account.
- Optional OAuth linking after clean API path is proven.

## Test plan

Backend:

```bash
pnpm --filter @hachej/boring-core run test -- outreach
pnpm --filter @hachej/boring-core run typecheck
```

Full app smoke:

```bash
pnpm --filter full-app run typecheck
pnpm --filter full-app run e2e:smoke
```

Security/concurrency regression cases:

- `/o/<valid>?next=https://evil.test` does not redirect externally.
- Expired/revoked token cannot create session.
- Forwarded token cannot resume another browser's claimed identity.
- Concurrent opens for same lead do not clone/provision twice.
- Token cannot grant access outside scoped app/workspace experience.
- Raw token not returned by list APIs and not stored in DB.
- Synthetic email not visible in session/user APIs.
- Claim cannot overwrite an existing real user email.
- Existing signed-in user opening token gets interstitial, not silent merge.

## Biggest risks / open questions

1. **Better Auth identity/session APIs.** Phase 0 decides if this is clean. No auth-table hacks outside `AuthIdentityAdapter`.
2. **Provisioning cost/concurrency.** Per-lead cloned workspace is safest but must be idempotent and may be expensive.
3. **Anonymous capability enforcement.** Must be server-side and centralized before links are exposed.
4. **Synthetic email leakage.** Must be solved at canonical serialization boundary.
5. **OAuth claim.** Defer until a clean account-linking path is proven.
