# Provider reference — Vercel

## When to use

Use this for the generic hosted baseline.

## Default recommendation

Default generic hosted path:

- Vercel
- managed Postgres
- mail transport provider

## Best fit

Use this when you want the cleanest hosted baseline and are comfortable with the Vercel-oriented deploy path.

## Need from the user

- domain
- Vercel project/team ownership
- env-var owner
- intended runtime mode

## Traps to avoid

- don't confuse Vercel deploy platform with the app's logical runtime mode choice
- don't rely on local runtime-plugin assumptions for shipped remote apps

## Deeper docs

- `../../manuals/providers/PROVIDER_SNIPPETS.md`
- `../../manuals/providers/MANUAL_HANDOFFS.md`
- `../runtime-and-provisioning.md`
