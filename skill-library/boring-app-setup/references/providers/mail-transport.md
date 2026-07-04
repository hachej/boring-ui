# Provider reference — Mail transport

## When to use

Use this for email delivery setup.

## Default recommendation

Use a real mail transport provider for production email flows.

## What it powers

- verify email
- forgot/reset password
- magic link
- workspace invites

## Need from the user

- transport choice
- API key or SMTP creds owner
- whether production email auth flows must work

## Traps to avoid

- don't merge transport choice with sender identity choice
- don't promise production email auth without a real transport

## Deeper docs

- `../../manuals/dependencies/EXTERNAL_DEPENDENCY_MAP.md`
- `../../manuals/providers/PROVIDER_SNIPPETS.md`
- `sender-identity.md`
