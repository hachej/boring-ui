# Boring App Setup — Execution Playbook

Use this when actively building a new app from an idea.

## Default operating mode

**Autonomous by default, explicit at every boundary.**

That means:

- do not stop for trivial choices when the skill already defines a default
- do stop for provider/account/domain steps that require a human
- tell the user exactly what was done, what is next, and what still needs manual action

## Phase loop

### Phase 0 — intake

If the child app sounds sophisticated, classify it with `../manuals/app-shape/APP_ARCHETYPES.md` immediately.

Collect or infer:

- app slug
- product name
- one-line promise
- base app
- deploy target
- runtime mode
- auth expectations
- whether custom plugins are required
- provider ownership for domain/db/mail/deploy

Output a short launch pack before coding.
Then write a short implementation shape using `../manuals/app-shape/IMPLEMENTATION_SHAPE.md`.

### Phase 1 — scaffold

1. copy from the chosen reference app
2. exclude `.env`, `node_modules`, `dist`, `.vercel`, test output dirs
3. rename package/app identity files
4. keep the stock core server entrypoints unless plugin-loading requirements force the lower-level server APIs
5. if Vercel + manifest plugin discovery are both in scope, replace the stock Vercel entry with the lower-level handler path too

Verification:

- app directory exists
- package.json reflects the new app
- no copied secrets

### Phase 2 — identity

Update:

- `package.json#name`
- `README.md`
- `index.html`
- `src/front/main.tsx`
- `boring.app.toml`

Verification:

- title is consistent everywhere
- `appId` and branding are set

### Phase 3 — providers + env

Update `.env.example` and deployment config.
Use `../manuals/providers/PROVIDER_SNIPPETS.md` as the source of truth for copy-paste provider commands.

Verification:

- env template names the required secrets
- runtime mode matches deploy target
- auth/mail/domain-sensitive vars are explicit

### Phase 4 — architecture choices

Before deeper implementation:

1. decide ownership with `../manuals/architecture/OWNERSHIP_RULES.md`
2. decide bridge vs route vs file-path with `../manuals/architecture/TRANSPORT_DECISION_MATRIX.md`
3. decide route composition with `../manuals/architecture/ROUTE_COMPOSITION.md`
4. decide whether provisioning is required with `../manuals/runtime/PROVISIONING_PATTERNS.md`
5. decide persistence ownership with `../manuals/data/PERSISTENCE_AND_MIGRATIONS.md`

### Phase 5 — plugin integration

If needed:

1. decide runtime vs app/internal plugin shape
2. prove UX in `apps/workspace-playground` if useful
3. harden into app/internal plugin for the shipped app
4. if using core manifest plugin discovery, switch server boot to pass `appPackageJsonPath`

Verification:

- plugin registration path is real, not hypothetical
- provider/binding plugins are statically composed if needed

### Phase 6 — local verification

Run the smallest relevant checks first.

Typical order:

```bash
pnpm --filter <slug> typecheck
pnpm --filter <slug> build
pnpm lint:invariants   # if plugin/server wiring changed
pnpm --filter <slug> dev
```

Verification:

- shell boots
- auth pages load
- workspace route loads
- plugin surfaces load if requested

### Phase 7 — deployment prep

Prepare:

- deployment framing chosen: generic hosted baseline vs our custom always-on setup
- Vercel envs / `vercel.json`
- or Fly envs / `fly.toml`
- migration path
- smoke command
- provider command block chosen from `../manuals/providers/PROVIDER_SNIPPETS.md`

Verification:

- deploy target config exists
- manual provider tasks are listed cleanly

### Phase 8 — post-deploy validation

Run smoke checks if deployment exists.

Minimum:

- `/health`
- auth on real origin
- cookies on real origin
- capabilities endpoint
- email flow if configured

## Completion bar

Do not say “done” until you can state:

1. what app was created
2. where identity lives
3. how plugins are wired
4. what env vars are required
5. what manual provider/domain steps remain
6. what local/deploy verification ran
7. acceptance by layer for sophisticated apps (`../manuals/verification/ACCEPTANCE_MATRIX.md`)
