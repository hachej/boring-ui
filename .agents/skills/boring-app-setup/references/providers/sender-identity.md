# Provider reference — Sender identity

## When to use

Use this for `MAIL_FROM`, verified sender domains, and deliverability decisions.

## Default recommendation

Treat sender identity as a separate decision from mail transport.
A dedicated sender identity is optional but recommended for serious apps.

## What it controls

- `MAIL_FROM`
- sender trust / branding
- deliverability alignment with the app domain

## Need from the user

- sender domain
- sender address
- whether a dedicated sender should be used

## Traps to avoid

- don't assume provider credentials alone define `MAIL_FROM`
- don't bury sender identity inside generic deploy setup

## Deeper docs

- `../../manuals/dependencies/EXTERNAL_DEPENDENCY_MAP.md`
- `../../manuals/providers/PROVIDER_SNIPPETS.md`
- `mail-transport.md`
