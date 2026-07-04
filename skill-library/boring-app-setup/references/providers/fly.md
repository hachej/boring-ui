# Provider reference — Fly

## When to use

Use this for our custom always-on setup.

## Default recommendation

Opinionated always-on path:

- Fly
- managed Postgres
- mail transport provider

## Best fit

Use this when the user wants our custom always-on deployment path rather than the generic hosted baseline.

## Need from the user

- Fly org/app ownership
- domain strategy
- runtime mode decision
- secret/env owner

## Traps to avoid

- don't describe Fly as the generic default
- don't inherit `apps/full-app` runtime settings blindly without checking mode intent

## Deeper docs

- `../../manuals/providers/PROVIDER_SNIPPETS.md`
- `../../manuals/providers/MANUAL_HANDOFFS.md`
- `../runtime-and-provisioning.md`
