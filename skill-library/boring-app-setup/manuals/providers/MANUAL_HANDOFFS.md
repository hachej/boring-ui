# Boring App Setup — Manual Handoffs

This file exists so the agent can separate **repo work** from **human/provider work**.

Use `PROVIDER_SNIPPETS.md` when you need a copy-paste command block for a specific provider.

## Human-owned tasks you should expect

### Domain

A human may need to:

- buy or assign the domain
- add DNS records
- connect the domain to Vercel or Fly
- verify final production URL

Agent should output:

- target domain
- expected canonical app URL
- exact env values derived from it:
  - `BETTER_AUTH_URL`
  - `CORS_ORIGINS`
- if the sender address follows the same domain, propose a `MAIL_FROM` value separately

### Database

A human may need to:

- create the Postgres database/project
- copy the connection string
- paste `DATABASE_URL` into the deploy platform

Agent should output:

- whether local dev can proceed without prod DB
- whether migrations are required before first boot
- exact command to run migrations

### Mail

A human may need to:

- create a Resend account or other provider account
- create API key / SMTP credentials
- verify sending domain
- choose `MAIL_FROM`
- optionally create a dedicated sender identity/address for production

Agent should output:

- recommended transport (`resend://` by default here)
- whether dev can use `console://`
- whether a dedicated sender identity is recommended for this app
- what flows depend on mail:
  - verify email
  - reset password
  - magic link
  - workspace invites

### Deploy platform

A human may need to:

- create the Vercel/Fly project
- connect repo or deploy locally
- set env vars/secrets
- trigger deploy

Agent should output:

- deploy target chosen
- runtime mode chosen
- exact env/secrets checklist
- smoke command to run after deploy

### Social OAuth, if requested

Treat as human/provider setup even when repo support exists.

A human may need to:

- create OAuth app in provider dashboard
- set callback URLs
- paste client ID/secret

Agent should first verify repo support before promising this path.

## Handoff format

When blocked on a human-owned step, output exactly this style:

```txt
Manual step needed: <area>
Why blocked: <one sentence>
You need to provide:
- ...
After that I will do next:
- ...
```

## Important

Do not hide manual work under vague language like “just deploy it” or “connect your providers.”
Be explicit.
