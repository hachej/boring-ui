# [Objectives Plugin] Proof of work

## Scope and exact revisions

- Delivery surface / epic / final Bead: [PR #1382](https://github.com/hachej/boring-ui/pull/1382) / `pr-1382-objectives-plugin` / `wt-391-forward-5m2v.7`; lineage originates at `wt-391-forward-clu5.12` and continues through handoffs `.1`–`.6`.
- Authoritative fetched `origin/main`, PR base, and merge-base: `68dcb7db8822f721c6b45d0731e01a46fa364f28`. It is an ancestor of the candidate, so no merge was needed.
- Final code SHA: `422b2b12ce266ee8c829264050ad718fb8a0a7d9`.
- This proof, its show-me, media, and presentation are a docs/evidence tail after that immutable code SHA. The exact artifact SHA is recorded in the PR proof comment and Bead handoff because a commit cannot truthfully embed its own hash.
- Historical recordings remain intact; `before-wt7-*` and `final-wt7-*` are new names and overwrite nothing.

## What changed

`ObjectivePane` now stores the displayed Objective together with the `objectiveId` that loaded it and renders the record only while that target still matches. In the exact combined schedule A→B, foreground B pending, newer background B failing, then late foreground B success, A is hidden immediately, the B failure clears loading and shows an error, and the superseded foreground response remains ignored. The existing same-target behavior remains: a background failure preserves the current record and adds a warning.

The durable Objective primitive, stale-lock critical section, bridge/host ownership, exports, contracts, and authority are unchanged by this final fix. The plugin remains unregistered and unpublished.

## Exact-SHA sandbox verification

Factory sandbox `7e700735-d415-49da-9295-45f87282020f` verified `git rev-parse HEAD` and `.factory-sha` as exact `422b2b12ce266ee8c829264050ad718fb8a0a7d9`:

- `CI=true pnpm install --frozen-lockfile` — PASS; existing missing-prebuilt-bin warnings only.
- `pnpm --filter @hachej/boring-objectives typecheck` — PASS.
- `pnpm --filter @hachej/boring-objectives test` — PASS, **8 files / 98 tests**.
- `pnpm --filter @hachej/boring-objectives build` — PASS, ESM plus declarations.
- `pnpm audit:imports` — PASS.
- Runtime Refactor P8: `pnpm lint:invariants` and `pnpm check:golden-path` — PASS without skips or weakened assertions.
- `git merge-base 68dcb7db... HEAD` and `git merge-base --is-ancestor 68dcb7db... HEAD` — PASS; exact merge-base `68dcb7db8822f721c6b45d0731e01a46fa364f28`.
- Focused UI state command with `-t 'never retains|keeps the loaded objective'` — PASS, **2 passed / 3 skipped**.
- Bead-local `git diff --check ab3cfabf7..422b2b12c` — PASS. A base-to-head check reports only four pre-existing trailing-space lines in `docs/issues/1382/plan.md`, unchanged by `.7`.

## Deterministic UI evidence

Runner: `node docs/issues/1382/run-ui-proof.mjs <revision> <label> <output-dir>`. Both runs use fixture `obj-11111111-1111-4111-8111-111111111111`, viewport 1280×720, and the same interaction.

- Base `68dcb7db8822f721c6b45d0731e01a46fa364f28`: surface absent → **Probe Objective surface** → `No Objective panel registered.` PASS. [Video](../../../assets/objectives-plugin-final/before-wt7-68dcb7db8822.webm) · [JSON](../../../assets/objectives-plugin-final/before-wt7-68dcb7db8822.json).
- Candidate `422b2b12ce266ee8c829264050ad718fb8a0a7d9`: `2 / 10` → **Apply server update** → visibility refresh → `7 / 10`, constraint visible. PASS. [Video](../../../assets/objectives-plugin-final/final-wt7-422b2b12ce26.webm) · [JSON](../../../assets/objectives-plugin-final/final-wt7-422b2b12ce26.json).
- Both journeys passed in the exact-SHA sandbox and were repeated with the identical runner for durable publication. JSON media paths are repository-relative and contain no workspace absolute path.
- The exact combined A→B interleaving is deterministic component proof in the 98-test package suite; the video demonstrates the existing user journey rather than fabricating that scheduler-only edge case.
- Harness scope: archived ObjectivePane source with Workspace shim and fixture fetch. Durable store/tool/real WorkspaceBridge seams are package-test proof. Mobile is omitted because the plugin is unregistered and targets a fixed workbench pane.

## GitHub CI and integration

- Exact code-head CI: [34179524364](https://github.com/hachej/boring-ui/actions/runs/34179524364) initially failed only in unrelated `boring-factory` supervision pagination timing (expected 2 ask-user calls, observed 4); failed-job rerun requested. The final artifact-head CI must supersede this non-Objectives failure.
- Exact code-head Workflow Invariants: [34179524420](https://github.com/hachej/boring-ui/actions/runs/34179524420) — SUCCESS, including Runtime Refactor P8, Strategy Docs, and Action Pins.
- The final docs/artifact-tail check URLs and conclusions are recorded in the revision-bound PR proof comment and Bead handoff after that immutable SHA exists.

## Independent review and package abstraction

The final exact-artifact review record is attached to the PR proof comment and Bead handoff with reviewer session, model, mandate digest, SHA, and verdict.

Required outcomes before handoff (the external exact-SHA receipt records the actual verdicts):
- Standards/spec: **PASS required**.
- Thermo: **PASS required**.
- Evidence correctness/accessibility: **PASS required**.
- Package abstraction: **PASS required**.

Abstraction scope includes objectives front/server/shared exports; `ObjectiveStore` / `FileObjectiveStore`; tools; `objective.v1`; ObjectivePane; WorkspaceBridge composition; factory/eval and app callers; and Agent/Workspace special-case absence. Objective vocabulary, persistence, locking, stable errors, and pane state remain plugin-owned; Workspace remains generic host/bridge composition. This fix changes no public export or contract, introduces no deep import, cycle, platform special-case, authority widening, or provider substitution change.

## Risk, counts, rollback, and owner path

- Base-to-code: **8,413 additions + 25 deletions = 8,438 changed lines across 74 files**.
- `packages/**` production additions + deletions: **0**.
- Numerical exclusions: plugin production outside `packages/**`, tests, evals, docs, Bead ledger, manifests, lockfile, media, and presentation. All remain in semantic review scope.
- Protected trigger: durable Objective primitive / architecture semantic decision. Absent: auth/permissions/tenant/secrets, money, destructive migration/deletion, release/publish, shared design/global navigation, and automation-authority changes.
- Route: protected exact-SHA owner merge decision; never automatic. Waiver: none.
- Accepted residuals: sidecar-owner crash may require operator removal; fail-closed bounded waits; pre-lock path TOCTOU; no arbitrary N-writer guarantee beyond the documented single-live-writer/restart-overlap contract.
- Rollback before merge: reject PR #1382. After an authorized merge: revert the PR merge commit. No migration, registration, release, deletion, or persisted-data rewrite requires reversal.
- Owner click-through: open the [presentation](../../../assets/objectives-plugin-final/pr-1382-presentation.html); watch base then candidate; verify absent→Probe and `2 / 10`→Apply update→`7 / 10` plus constraint; inspect the target-bound display and exact combined-interleaving regression; inspect the guarded stale-lock flow; approve only the exact final PR head while required checks and independent review remain current.
