# Boring App Setup — Checklists

## Architecture/shape checklist

- [ ] app archetype chosen intentionally for serious child apps
- [ ] implementation shape written before deep implementation
- [ ] ownership choices named
- [ ] bridge vs route vs file-path choices named where relevant
- [ ] provisioning need confirmed or rejected explicitly

## New app creation checklist

- [ ] correct base app chosen
- [ ] new app directory created under `apps/`
- [ ] no `.env` copied from source app
- [ ] package name changed
- [ ] README changed
- [ ] browser title changed
- [ ] `CoreWorkspaceAgentFront` title changed
- [ ] `boring.app.toml` created or updated
- [ ] `.env.example` updated
- [ ] provider command block chosen from `../manuals/providers/PROVIDER_SNIPPETS.md`

## Plugin integration checklist

- [ ] plugin shape chosen intentionally
- [ ] runtime plugin vs app/internal plugin explicitly stated
- [ ] provider/binding caveat handled if relevant
- [ ] `appPackageJsonPath` passed for core manifest plugin discovery if needed
- [ ] custom Vercel entry used too if Vercel + manifest plugin discovery are both in scope
- [ ] plugin registration path verified

## Deploy readiness checklist

- [ ] deploy target chosen
- [ ] runtime mode matches deploy target
- [ ] `BETTER_AUTH_URL` defined from final domain
- [ ] `CORS_ORIGINS` matches final browser origin
- [ ] `MAIL_FROM` chosen
- [ ] `MAIL_TRANSPORT_URL` chosen
- [ ] migration path documented
- [ ] smoke command documented
- [ ] provider-specific deploy snippet captured

## Verification checklist

- [ ] `pnpm --filter <slug> typecheck`
- [ ] `pnpm --filter <slug> build`
- [ ] `pnpm lint:invariants` if relevant
- [ ] local app booted
- [ ] auth pages load
- [ ] workspace route loads
- [ ] plugin surfaces load if relevant
- [ ] post-deploy smoke planned or run
- [ ] advanced child apps summarized by layer using `../manuals/verification/ACCEPTANCE_MATRIX.md`
