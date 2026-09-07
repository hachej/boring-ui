# [Objectives Plugin] Proof of work

## Scope and revisions

- Issue / Bead / PR: #1382 / `wt-391-forward-5m2v.1` / https://github.com/hachej/boring-ui/pull/1382
- Original branch head: `9fcadae0719e5677f458eff99094391714fb777b`
- Current main and merge base: `d19b04d357ea7d2caae20a44a657edb3ee4c582e`
- Candidate before this proof-only commit: `c3419ccb94b204872de41f9f3ed866bbc47a59ad`
- Branch integration: merge commit `384a89eed01f4c3521fefe1d7ba015d17ff06eb0`; no history rewrite or force push.

## What changed

The existing plugin adds a thin Objective record, restart-durable file store, `objective.v1` read/write bridge operations, four agent tools, and a workbench surface. Delivery repairs replaced forbidden `Buffer.byteLength` calls in shared/plugin code with portable `TextEncoder` UTF-8 sizing while preserving byte-limit assertions. A revision-bound Playwright runner now captures the same deterministic Objective journey at base and candidate revisions.

The plugin is not registered in app composition, does not publish/release anything, and does not alter the ratified architecture. The owner-ratified durable Objective primitive decision remains a protected architecture boundary and requires an exact-SHA merge decision.

## Automated verification

Dedicated sandbox `bebdb362-7eb7-41f0-8580-4fb3596a5202`, exact snapshot `c3419ccb94b204872de41f9f3ed866bbc47a59ad`, Node/pnpm environment provisioned by the Factory:

- `pnpm install --frozen-lockfile` — PASS.
- `pnpm --filter @hachej/boring-objectives typecheck` — PASS.
- `pnpm --filter @hachej/boring-objectives test` — PASS, 8 files / 71 tests.
- `pnpm --filter @hachej/boring-objectives build` — PASS, ESM and declarations.
- `pnpm audit:imports` — PASS, no forbidden imports.
- Runtime Refactor P8 exact workflow commands: `pnpm lint:invariants && pnpm check:golden-path` — PASS; all seven P8 assertions passed, including no uncovered `Buffer` references in `src/shared/**`.

No assertion was removed, skipped, or weakened. The portable UTF-8 regression tests include ASCII, BMP, and astral Unicode cases and retain the 24 KiB boundary.

## UI evidence

Scenario command:

```sh
node docs/issues/1382/run-ui-proof.mjs <revision> <label> .handoff/objectives-ui-proof
```

Both runs use fixture record `obj-11111111-1111-4111-8111-111111111111`, viewport 1280×720, and the same local isolated Vite/Playwright harness.

- Before `d19b04d357ea7d2caae20a44a657edb3ee4c582e`: PASS; asserts Objective surface absence, clicks **Probe Objective surface**, and observes `No Objective panel registered.`
- Candidate `c3419ccb94b204872de41f9f3ed866bbc47a59ad`: PASS; asserts `2 / 10`, clicks **Apply server update**, triggers the pane's real visibility refresh path, observes `7 / 10`, and verifies the constraint text.
- Factory sandbox generated labeled WebM clips and JSON assertion reports. Final-revision owner-accessible copies are generated after the final proof-only revision is fixed and linked from the Bead handoff.
- Mobile omitted: this is an unregistered fixed workbench pane and acceptance requested one deterministic viewport; residual responsive-layout coverage is limited to component tests.

## CI audit trail

All PR conversation comments, review records, and inline review comments were read on 2026-09-07; each surface was empty. The PR body records the earlier four-round Sol xhigh audit and owner architecture ruling, but no linked independent Factory review receipt existed before this delivery lane.

- Runs `32645716828` and `32961886253`: Runtime Refactor P8 failed on `Buffer.byteLength` in `plugins/objectives/src/shared/schema.ts`; fixed by `45dd7a00e4ffa4c48b8de1791dc911c958de35dd` with portable UTF-8 tests.
- Runs `34149136876` / `34149136997`: merge-conflicted lockfile omitted `lucide-react@1.31.0(react@19.2.8)`, causing frozen-install fan-out failures; fixed by the regenerated lockfile in `45dd7a00e`.
- Run `34149669987`: full CI PASS at `45dd7a00e`; workflow invariants PASS in `34149669918`.
- Run `34151333259`: workflow invariants PASS at `c3419ccb9`, including Runtime Refactor P8.
- Run `34151333132`: every check except UI Review passed. UI Review failed because unrelated `workspace-command-palette` Bombadil replay reported `reproduction and original test diverged`; the failed job was re-run. Final status is recorded in the Bead handoff rather than guessed here.

## Abstraction inspection record

Governing documents read at the candidate revision:

- `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md`
- `docs/plans/long-term/ratified/RECONCILIATION.md`
- `docs/procedures/coding-invariants.md`

Seams and callers inspected:

- package exports: `plugins/objectives/package.json`, front/server/shared barrels;
- producer: `FileObjectiveStore` → `createObjectiveBridgeHandlers` / `createObjectiveTools` → `createObjectivesServerPlugin`;
- consumer: `ObjectivePane` → `createObjectivesClient` → `objective.v1.get`;
- real non-plugin composition caller: `evals/factory/lib/harness.ts`, plus objective understanding/tool-selection/evidence/approval evals;
- supported platform contracts only: `@hachej/boring-workspace`, `/plugin`, `/server`, and `@hachej/boring-ui-kit`; no package-private deep import.

Review round 2 (`70bc7fef-85fe-4d85-b9da-c6bff40a1560`, Sol xhigh) requested changes at `2d2e521027d485fb6052ee0a28013188ec0fb943`. Dispositions in `adaaa98c2f40b63ca91a954f4a5e4dd323add489` and its proof follow-up:

- fail closed on malformed/unrecognized durable state and refuse mutation when invalid records would otherwise be dropped;
- reject `clientRequestId` reuse with different normalized creation input;
- paginate bridge/tool list responses at at most 20 records and make the front client follow cursors;
- register every Objective failure in Agent's canonical error enum and carry stable codes through path/config/store/tool/bridge seams;
- remove contradictory “Goal primitive” text from model- and user-facing descriptions;
- re-run all exact-SHA proof because any fix invalidates the parent evidence.

The final independent exact-SHA standards/spec, thermo, and full abstraction verdict is recorded in the Bead handoff. The gate is not self-approved by this document.

## Risk classification

- Route: **protected owner merge decision**.
- Matched trigger: durable Objective primitive / architecture decision (shared contracts/semantic ownership), explicitly owner-classified as protected.
- Package production additions + deletions: **10** additions / **0** deletions under `packages/**` production source: ten canonical `OBJECTIVE_*` error-code entries in `packages/agent/src/shared/error-codes.ts`.
- Numerical exclusions: `packages/agent/docs/ERROR_CODES.md` and `packages/agent/src/shared/__tests__/error-codes.test.ts` are docs/tests; plugin production code, plugin tests, evals, docs, `.beads/issues.jsonl`, package manifests, and `pnpm-lock.yaml` are outside `packages/**` production-source count. They remain in semantic review.
- The 10-line package count is below the >500 size trigger, but semantic architecture protection still controls the route.
- Other triggers: no auth/permissions/tenant/secrets, billing/spend, migration/deletion, release/publish, shared design-system, global navigation, or automation-authority change.
- Automatic MERGE-READY is forbidden because the protected architecture trigger controls even though package production count is zero.

## Integration, rollback, and residuals

- `origin/main` fetched and confirmed at `d19b04d357ea7d2caae20a44a657edb3ee4c582e`; it equals the candidate merge base.
- GitHub reports the PR conflict-free; final checks and current-main equality are re-read at handoff.
- Rollback before merge: reject the candidate. After authorized merge: revert the PR merge commit. No migration or release exists; plugin remains unregistered.
- Known implementation residuals retained from prior review: narrow pre-lock-lock-path symlink swap window, release read-then-unlink window, and a documented single-live-writer/restart-overlap contract rather than arbitrary N-writer serializability.
