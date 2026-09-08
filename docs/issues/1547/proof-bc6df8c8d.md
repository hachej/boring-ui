# [Invite Idempotency] Proof of work

## Revision and route

- Issue / Bead / PR: #1547 / `wt-391-forward-rvzi.2` / https://github.com/hachej/boring-ui/pull/1547
- Base / reviewed code head: `d19b04d357ea7d2caae20a44a657edb3ee4c582e` / `bc6df8c8db035e8a8fbc38de30bfe3fe384de829`
- Current-main integration: `origin/main` at the base SHA is merged into the reviewed code head.
- Classification: **protected owner route**. Triggers: authentication/authorization and tenant isolation; schema/migration; public Core server contract (`IdempotencyKeyStore.claim` and `IdempotencyClaim`).
- Package production additions + deletions: **198** = 150 additions + 48 deletions under `packages/core`.
- Counted: migration SQL and production `.ts` in auth, schema, middleware, routes, public barrels, and shared errors.
- Excluded from the numerical trigger: 37+11 E2E; 333+77 unit/integration test lines; 30 docs; 7 generated Drizzle journal lines; 9+1 test/build config lines. The size trigger (>500) does not match.
- No UI production file changes occur in the base-to-head diff. Front-end changes are test setup/timing only, so Playwright before/after proof is not applicable.

## Exact-SHA automated verification

Sandbox `29c0b98e-6f14-44d2-b4b8-910bc5c5b805`; `git rev-parse HEAD` and `.factory-sha` both read `bc6df8c8db035e8a8fbc38de30bfe3fe384de829`; clean `pnpm install --frozen-lockfile`; isolated PostgreSQL database; `NODE_ENV=test`; empty `NODE_PATH`.

- `pnpm --filter @hachej/boring-core test` — PASS, 124/124 files and 1,523/1,523 tests.
- `pnpm --filter @hachej/boring-core exec vitest run src/server/routes/__tests__/idempotency.test.ts src/server/middleware/__tests__/idempotency.postgres.test.ts --maxWorkers=1` — PASS, 16/16.
- `pnpm --filter @hachej/boring-core exec vitest run e2e/v7-platform.test.ts --maxWorkers=1` — PASS, 17/17.
- `pnpm --filter @hachej/boring-core run typecheck` — PASS.
- `pnpm --filter @hachej/boring-core... --workspace-concurrency=4 run build` — PASS, dependency closure and Core build assertions.
- `pnpm lint:invariants` — PASS, including agent, Bash, Sandbox, Workspace plugin, alignment, and skill-digest checks.
- An initial sandbox invocation used a passwordless TCP PostgreSQL URL and failed authentication (`28P01`); correcting only the isolated database credentials produced the complete green run above. It was an environment setup error, not a code failure.

## Independent review

- Reviewer session: `b0caaf10-01bf-40d1-b1ca-e96b29b393ce`
- Model: `openai-codex/gpt-5.6-sol`
- Target: exact code SHA `bc6df8c8db035e8a8fbc38de30bfe3fe384de829`
- Brief digest: `sha256:b2f4003c9ef7b1b834e0416649fdbaff60d54f8605cb65f908838700a64b938e`
- Verdict: **approve; no material findings**
- Thermo: **PASS**

### Abstraction review: PASS

- Base / head: `d19b04d357ea7d2caae20a44a657edb3ee4c582e` / `bc6df8c8db035e8a8fbc38de30bfe3fe384de829`
- Packages / seams / callers inspected: `@hachej/boring-core/server`; `IdempotencyKeyStore`, middleware, Drizzle adapter, invite routes; `createCoreWorkspaceAgentServer`; E2E and PostgreSQL consumers.
- Ownership / dependency direction: identity, authorization, invite persistence, and idempotency remain Core-owned. No private cross-package import, cycle, front/server inversion, or duplicate authority path was introduced. Test aliases resolve declared public package seams to source only.
- Evidence: complete diff and merge topology, `git diff --check`, Core package/focused/E2E tests, typecheck, dependency-closure build, and invariants.
- Findings / disposition: none.

## GitHub and integration proof

- Current code-head runs: CI `34145602272` PASS and Workflow Invariants `34145602232` PASS.
- Earlier run `33969101191` at `308934b83f` failed changed Core E2E because its adapter had not implemented atomic `claim`; fixed by `4ff283b563c67302058868905f8cc0866b7a0efe`, after which CI passed.
- Earlier UI Review run `34139219517` at `0048e05082` failed because the unrelated command-palette fixture reproduction diverged; later exact-head CI is green. The PR has no UI production diff and does not claim that run as feature proof.
- PR head and check state must be read back again after the docs-only artifact commit. The reviewed code SHA remains the code candidate; the artifact commit changes only `.beads` and `docs/issues/1547/**`.

## Risk, rollback, and known gaps

- Residual: an old server may perform an invite effect before writing its legacy receipt. Drain old in-flight invite requests before deployment.
- Residual: a crash or failed response persistence can leave a permanent unresolved claim; reconcile it by inspecting invite/mail outcome rather than retrying blindly.
- Rollback: revert the feature commits and deploy old code only with an authorized database/deployment plan. Migration 0028 is additive/nullable and may remain in place during code rollback; dropping the column or restoring NOT NULL is destructive and is not part of routine rollback.
- Waiver: none.
