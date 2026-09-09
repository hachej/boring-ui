# PR #1571 proof of work

## Scope and revision

- Bead / PR: `factory-plugin-z4hs.1` / <https://github.com/hachej/boring-ui/pull/1571>
- Current-main integration base: `c248adba89e5514d0c60bf436ae8c8bcf707609b`
- Verified implementation candidate: `dea5caf9530e49582734a5924a4f950a8198b251`
- Change: retain Nodemailer `9.1.1` in `packages/core/package.json` and its lockfile resolution; merge current `origin/main` without rewriting history.
- UI evidence: N/A — no UI production code changes relative to current main.

## Automated verification

All local commands ran in disposable sandbox `86f5c6c9-e111-434a-b0a8-4a6c2c0cad21`, whose `git rev-parse HEAD` was `dea5caf9530e49582734a5924a4f950a8198b251`.

- `pnpm install --frozen-lockfile` — PASS; lockfile resolved Nodemailer `9.1.1`.
- request-ledger Vitest file, serial, repeated 20 times — PASS 20/20. The earlier CI SQLite `database is locked` failure did not reproduce; no unrelated ledger patch was made.
- `pnpm --dir packages/core exec vitest run src/server/mail/__tests__/transport.test.ts --no-file-parallelism` — PASS, 21/21.
- `pnpm --dir packages/core run typecheck` — PASS.
- `pnpm typecheck` — PASS across the workspace.
- `pnpm lint:invariants` — PASS.
- `pnpm audit:imports` — PASS.
- GitHub Actions run [34333868615](https://github.com/hachej/boring-ui/actions/runs/34333868615) — changed unit tests, typecheck, invariants, lint, E2E, and bundle gates passed at the candidate revision; final status is recorded in the revision-bound PR comment.

A broad sandbox `pnpm test` was also attempted. It exposed unrelated current-main/environment failures in plugin-cli temp settings and core tests sharing a pre-existing Postgres schema (`accounts.issuer` mismatch and test-env projection). These are not in the PR diff and were not patched without causal evidence. The CI-equivalent changed-package unit job passed at the same candidate SHA.

## Boundary inspection

- Provider: external `nodemailer`, loaded only by `packages/core/src/server/mail/transport.ts` through its documented package export.
- Core seam: `MailTransport.send(RenderedEmail)` exported by `packages/core/src/server/mail/index.ts` and `packages/core/src/server/index.ts`.
- Real callers inspected: `packages/core/src/server/auth/createAuth.ts`, `packages/core/src/server/auth/postSignupHook.ts`, and `packages/core/src/server/routes/invites.ts`.
- No signature, export, package ownership, dependency direction, permissions, or lifecycle behavior changed.

## Risk classification

Automatic-eligible routine dependency maintenance under `docs/procedures/boring-loop.md`.

- Protected triggers matched: none.
- Package production additions + deletions relative to current main: **2** (one manifest line replaced).
- Exclusions from the numerical trigger: `pnpm-lock.yaml` (generated lockfile), `.beads/issues.jsonl` (task ledger), and `docs/issues/1571/**` (proof/docs).
- No auth, billing, permissions, secrets, migration, public API/MCP contract, package-boundary, shared design-system, release-policy, or deletion-heavy change.

## Integration and rollback

The branch merged `origin/main` at `c248adba89e5514d0c60bf436ae8c8bcf707609b` into the candidate without force-push. Before admission, refresh `origin/main`; if it moved, revalidate the new combination. Rollback is a normal revert of the dependency bump/delivery commits; no data or migration rollback is required.

## Review and final receipts

Independent exact-SHA standards/spec, thermo, and package-abstraction verdicts are recorded in the final PR proof comment and Bead handoff so they can name the immutable reviewed SHA without self-referential file content.
