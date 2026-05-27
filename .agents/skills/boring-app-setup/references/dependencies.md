# Dependencies

## When to use

Use this when the user asks what providers, accounts, secrets, or external systems the child app needs.

## Default recommendation

Map every app across these categories:

- database
- mail transport
- mail sender identity
- auth external dependencies
- domain/DNS
- deploy platform
- runtime mode
- model provider
- app-specific providers

## Required vs optional

| Category | Default status | Notes |
|---|---|---|
| database | usually required | real full-app child apps need Postgres |
| mail transport | required for production email auth/invites | separate from sender identity |
| mail sender identity | optional but recommended | `MAIL_FROM`, sender domain, deliverability |
| external auth SaaS | usually not required | default auth is core + DB + mail |
| OAuth provider creds | optional | only if social login is required |
| domain/DNS | required for public production app | affects auth origin + mail alignment |
| deploy platform | required for hosted app | Vercel baseline, Fly opinionated setup |
| runtime mode | required | `direct`, `local`, or `vercel-sandbox` |
| model provider | required for agent responses | track provider + model + key owner |

## Important distinctions

- mail transport is not the same as sender identity
- default auth is not the same as “buy Auth0/Clerk”
- deploy platform is not the same as runtime mode

## Traps to avoid

- don't collapse DB, auth, and mail into one vague “backend setup” bucket
- don't assume social OAuth is part of the default path
- don't forget who owns each external account and secret

## Deeper docs

- `../manuals/dependencies/EXTERNAL_DEPENDENCY_MAP.md`
- `providers/postgres.md`
- `providers/mail-transport.md`
- `providers/sender-identity.md`
- `providers/vercel.md`
- `providers/fly.md`
- `providers/model-providers.md`
