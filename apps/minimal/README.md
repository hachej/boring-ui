# apps/minimal

Smallest v2 starter app for file browsing + editing.

Included:
- `@boring/core` front wrapper (`BoringApp`) and lightweight local core server
- `@boring/workspace` IDE layout with file tree + editors
- `@boring/agent` backend for file/tree routes

Not included:
- Chat panel
- Workspace members/invites UI
- Production auth/database wiring

## Run

```bash
pnpm --filter minimal dev
```

Sign in with:
- email: `dev@minimal.local`
- password: `dev`
