# Boring App Setup — External Dependency Map

Use this file to map every external dependency a child app really needs.

## Principle

Not every category needs an external SaaS.

Example: default auth here is **not** “buy Auth0/Clerk.”
Core runs auth itself. What auth needs externally is mostly:

- a database
- a mail transport provider for email flows
- optionally an OAuth provider if social login is required

## Dependency categories

### 1. Database

Usually required for a real shipped app.

What it powers:

- auth/session/account persistence
- workspaces/members/invites/settings
- any app-owned tables

Typical external dependency:

- managed Postgres

Decision fields:

```txt
db provider:
db owner:
db connection string source:
app-owned tables?: yes/no
```

### 2. Mail transport

Required if the app wants email-based auth flows in production.

What it powers:

- verify email
- forgot/reset password
- magic link
- workspace invites

Typical external dependency:

- Resend
- SMTP provider

Decision fields:

```txt
mail transport provider:
mail api key / smtp creds source:
```

### 3. Mail sender identity

**Optional but strongly recommended to treat separately.**

This is the sender/domain identity, not the transport itself.

What it powers:

- `MAIL_FROM`
- sender trust / deliverability
- branded transactional email identity

Typical external dependency:

- verified sender domain
- dedicated sender address such as `noreply@yourdomain.com`

Decision fields:

```txt
mail sender domain:
mail sender address:
dedicated sender?: yes/no
```

### 4. Auth

Default boring-ui auth does **not** require an external auth SaaS.

By default, auth stack is:

- core app
- database-backed auth state
- mail transport for email flows

Optional external auth dependencies:

- OAuth provider credentials, only if social login is required

Decision fields:

```txt
auth mode: email/password + magic-link by default
external auth SaaS?: usually no
social oauth provider?: optional
```

### 5. Domain / DNS

Needed for a real public app.

What it powers:

- final public URL
- auth origin values
- sender identity alignment

Typical external dependency:

- registrar / DNS host

Decision fields:

```txt
public app domain:
dns owner:
sender domain same as app domain?: yes/no
```

### 6. Deployment platform

Needed for hosted deploys.

Default framing in this bundle:

- generic hosted baseline → Vercel
- our custom always-on setup → Fly

Decision fields:

```txt
deploy platform:
platform owner:
```

### 7. Runtime execution provider

Needed when the app uses agent execution modes beyond plain local/direct.

Typical choices:

- `direct`
- `local`
- `vercel-sandbox`

This is related to deploy, but not identical to deploy platform.

Decision fields:

```txt
runtime mode:
remote sandbox provider?: if any
```

### 8. Model provider

Needed for actual agent responses.

Typical external dependency:

- Anthropic / OpenAI-compatible / other configured provider

Decision fields:

```txt
model provider:
model id:
api key owner:
```

### 9. Optional app-specific providers

Only if the child app itself needs them.

Examples:

- analytics
- billing
- search/indexing
- object storage
- third-party product APIs

Decision fields:

```txt
app-specific providers:
which features depend on them:
```

## Fast map template

```txt
External dependency map
- Database:
- Mail transport:
- Mail sender identity:
- Auth external deps:
- Domain/DNS:
- Deploy platform:
- Runtime execution provider:
- Model provider:
- App-specific providers:
```

## Rule

Always separate these three things:

1. **mail transport**
2. **mail sender identity**
3. **auth provider requirements**

They are related, but not the same dependency.
