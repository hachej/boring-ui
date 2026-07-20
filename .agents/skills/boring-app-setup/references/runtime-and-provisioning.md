# Runtime and provisioning

## When to use

Use this when deciding deploy platform, runtime mode, workspace boot behavior, or environment shape.

## Default recommendation

Choose platform and runtime separately.

## Decision table

| Decision | Typical choices |
|---|---|
| deploy platform | Vercel, Fly |
| runtime mode | `direct`, `local`, `vercel-sandbox` |
| database | managed Postgres |
| mail delivery | mail transport provider |

## Platform framing

- Vercel = generic hosted baseline
- Fly = our custom always-on setup

## Traps to avoid

- don't assume Vercel automatically means the right runtime mode is chosen
- don't assume Fly should inherit `apps/full-app` runtime settings unchanged
- don't treat deploy platform and runtime mode as one decision

## Deeper docs

- `../manuals/runtime/PROVISIONING_PATTERNS.md`
- `providers/vercel.md`
- `providers/fly.md`
