# boring.macro full Fly deploy

This is the core-authenticated boring.macro app for `https://boring-macro.fly.dev`.

Use the script from the monorepo root:

```bash
export FLY_API_TOKEN=$(vault kv get -field=token secret/agent/flyio)
pnpm --filter @boring/macro-full deploy:fly
```

Why the script exists:

- Fly app must be `boring-macro`.
- Docker build context must be the monorepo root (`.`), because the Dockerfile copies `packages/*`, `apps/boring-macro-v2`, and `apps/boring-macro-v2-full`.
- Fly resolves `dockerfile = "Dockerfile"` relative to `apps/boring-macro-v2-full/fly.toml`, while the deploy script passes the monorepo root as build context.
- Release migrations run through `apps/boring-macro-v2-full/dist/server/migrate.js` before the machine starts.

Do not deploy this by running bare `fly deploy` from `apps/full-app` or `apps/boring-macro-v2-full`.
