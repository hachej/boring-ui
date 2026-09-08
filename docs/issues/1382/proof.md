# [Objectives Plugin] Proof of work

## Scope and exact revisions

- Issue / epic / terminal delivery Bead / PR: [#1382](https://github.com/hachej/boring-ui/issues/1382) / `pr-1382-objectives-plugin` / `wt-391-forward-5m2v.6` / [PR #1382](https://github.com/hachej/boring-ui/pull/1382).
- Authoritative remote `main`, actual comparison base, and merge-base: `68dcb7db8822f721c6b45d0731e01a46fa364f28`. `git fetch origin main`, `git ls-remote origin refs/heads/main`, and `git rev-parse origin/main` all returned this SHA; it is an ancestor of the candidate, so no new merge was required.
- Reviewed code SHA: `20c13de549a5871c09622bc93b66a77871510f20`.
- Post-race WebM/JSON evidence SHA: `ddf4093e320fd3deb948147853a7f09f3e024c45`.
- Final docs/presentation SHA is literal-named in the revision-bound PR proof comment, PR `## Handover`, and terminal Bead handoff after publication. A Git commit cannot truthfully embed its own not-yet-computed hash; this document binds its own content to the immutable reviewed-code and evidence SHAs above rather than fabricating one.
- Historical proof/media remain intact. The new `before-postrace-*` and `final-postrace-*` files are distinct and do not overwrite prior captures.

## What changed

The owner-ratified thin plugin supplies a restart-durable Objective record, four agent tools, `objective.v1` bridge operations, and a rehydrating workbench pane. Hardening now validates complete persisted records, emits plugin-owned path-free failures, and serializes stale-lock reclaimer election plus the final token/revision/commit/release critical section. Two reclaimers cannot both enter, and a stale-yet-live holder cannot commit or release across a successful reclaimer.

The plugin remains unregistered in app composition. It publishes nothing, creates no migration, and changes no production source under `packages/**`.

## Exact-SHA automated verification

Factory sandbox `9ff0b3a4-4ff5-4d1b-9d64-1bf79bcf4d9d` verified both `git rev-parse HEAD` and `.factory-sha` as exact reviewed code `20c13de549a5871c09622bc93b66a77871510f20` and produced:

- `CI=true pnpm install --frozen-lockfile` — PASS; only existing missing-prebuilt-bin warnings.
- `pnpm --filter @hachej/boring-objectives typecheck` — PASS.
- `pnpm --filter @hachej/boring-objectives test` — PASS, **8 files / 96 tests**.
- `pnpm --filter @hachej/boring-objectives build` — PASS, ESM plus declarations.
- `pnpm audit:imports` — PASS.
- Runtime Refactor P8 exact commands `pnpm lint:invariants` and `pnpm check:golden-path` — PASS with no skips or weakened assertions.
- `git cat-file -t 68dcb7db...`, `git merge-base HEAD 68dcb7db...`, and `git merge-base --is-ancestor 68dcb7db... HEAD` — PASS; authoritative current main exists, is the exact merge-base, and is an ancestor.
- Affected race command `pnpm --filter @hachej/boring-objectives exec vitest run src/server/__tests__/objectiveStore.test.ts -t 'reclaim|stale|release'` — PASS, **10 passed / 34 skipped** in the focused file.

The full suite's boundary coverage includes complete-record byte limits; corrupt/duplicate state; idempotency conflict; pagination; path containment; stable error/cause handling; real tool and WorkspaceBridge seams; atomic commit durability; two-reclaimer/two-writer election; stale live-holder commit exclusion; and guarded release.

## UI evidence

Deterministic existing runner, same fixture/viewport/interaction for base and candidate:

```sh
node docs/issues/1382/run-ui-proof.mjs <revision> <label> <output-dir>
```

- Fixture: `obj-11111111-1111-4111-8111-111111111111`; viewport: 1280×720.
- Base `68dcb7db8822f721c6b45d0731e01a46fa364f28`: Objective surface absent; click **Probe Objective surface**; `No Objective panel registered.` — PASS. [New video](../../../assets/objectives-plugin-final/before-postrace-68dcb7db8822.webm) · [new JSON](../../../assets/objectives-plugin-final/before-postrace-68dcb7db8822.json).
- Final code `20c13de549a5871c09622bc93b66a77871510f20`: initial `2 / 10`; click **Apply server update**; actual ObjectivePane visibility refresh reaches `7 / 10`; constraint visible — PASS. [New video](../../../assets/objectives-plugin-final/final-postrace-20c13de549a5.webm) · [new JSON](../../../assets/objectives-plugin-final/final-postrace-20c13de549a5.json).
- Both runs passed first in exact-SHA sandbox `9ff0b3a4-...`, then were repeated with the identical runner to publish durable assets. The JSON paths were normalized to repository-relative paths; scans contain no workspace absolute path.
- Scope honesty: this is the required archived-revision component harness with Workspace shim and deterministic fixture fetch. It proves ObjectivePane interaction/refresh, not an end-to-end durable-store browser route. Store/tool/real WorkspaceBridge seams are covered by the 96-test package suite.
- Mobile omitted: the plugin is unregistered and targets a fixed workbench pane; residual responsive coverage is component-level.

## GitHub CI and integration

Exact reviewed-code SHA `20c13de549a5871c09622bc93b66a77871510f20` is green:

- [CI run 34171982714](https://github.com/hachej/boring-ui/actions/runs/34171982714) — SUCCESS: Detect Changes, Lint, Typecheck, Invariants, bundle budgets, E2E, UI Review, Reference Images and Remote Worker Smoke; `Unit Tests Changed` reported `None` and the full matrix was workflow-skipped.
- [Workflow Invariants run 34171982711](https://github.com/hachej/boring-ui/actions/runs/34171982711) — SUCCESS: Runtime Refactor P8, Strategy Docs, and Action Pins.
- Exact final docs/artifact-head required-check URLs and conclusions are recorded after the immutable head exists in the PR proof comment and Bead handoff. Earlier failures/cancellations and their fix-forward dispositions remain preserved in prior handoffs and the presentation review history.

## Independent review and explicit package-abstraction PASS

Final code review at exact `20c13de549a5871c09622bc93b66a77871510f20`: Boring Reviewer session `c1d006fb-643c-4aa8-a783-9f75d2749ac6`, model `openai-codex/gpt-5.6-sol`, brief digest `sha256:fa690275b998394e313486cf6a47138587997b14671921d81ad4e10a7794011f`, verdict **APPROVE** with no material findings.

- Standards/spec: **PASS**.
- Thermo: **PASS**.
- Package abstraction: **PASS**.
- Supported exports and real callers inspected: objectives front/server/shared exports; `ObjectiveStore` / `FileObjectiveStore`; tools; `objective.v1` handlers/client; `ObjectivePane`; WorkspaceBridge registry/composition; factory harness/eval callers; app composition.
- Ownership/direction: schema, persistence, locking, vocabulary, and stable errors remain plugin-owned. Workspace remains generic host/bridge composition. Agent/app gain no Objective special-case, deep import, private-store dependency, cycle, renderer leak, or authority widening.
- Substitution/durability: injected `ObjectiveStore` remains substitutable; default factory retains workspace-root containment; browser mutation authority is unchanged; guarded election/commit/release satisfies the advertised single-live-writer/restart-overlap durability contract.
- Earlier two review rounds found adjacent stale-holder commit and release schedules; both were fixed forward and re-proved. The final round is clean.
- A terminal independent review additionally checks this exact final docs/artifact SHA for evidence correctness/accessibility, standards/spec, thermo applicability, and reconfirms the full package-abstraction PASS; provenance is recorded in the PR proof comment and Bead handoff.

## Risk route, counts, triggers, and exclusions

- Base-to-reviewed-code `20c13de54`: **7,978 additions + 19 deletions = 7,997 changed lines across 64 files**.
- `packages/**` production additions + deletions: **0**; the base-to-code `packages` diff is empty.
- Final docs/artifact-only churn is reported from the exact published head in the PR proof comment and handoff; it does not alter production risk.
- Numerical exclusions from the package threshold: plugin production (outside `packages/**`), tests, evals, docs, Bead ledger, manifests, lockfile, WebM/JSON, and self-contained presentation. Exclusions are numerical only; all remain in semantic review scope.
- Matched protected trigger: durable Objective primitive / architecture semantic decision. This controls the route despite 0 package production lines.
- Absent triggers: authentication, permissions, tenant isolation, secrets, billing/spend, destructive migration/deletion, release/publish, shared design-system/global navigation, and automation-authority change.
- Route: **protected exact-SHA owner merge decision; never automatic**.

## Residuals, rollback, and owner click-through

- Waiver: none. Open blocker/major review findings: none.
- Accepted residuals: crash while owning the non-recursively-reclaimable sidecar may require operator removal; uncertainty fails closed and caller waits remain bounded; existing pre-lock path TOCTOU; no arbitrary N-writer guarantee beyond the documented single-live-writer/restart-overlap contract.
- Rollback before merge: reject PR #1382. After authorized merge: revert the PR merge commit (or the Objective plugin commit range). No migration, registration, release, deletion, or persisted-data rewrite needs reversal.
- Owner click-through: open the [self-contained presentation](../../../assets/objectives-plugin-final/pr-1382-presentation.html); inspect the guarded stale-lock flow; watch the new base video then new final video; verify absent → probe on base and `2 / 10` → click update → `7 / 10` plus visible constraint on final; inspect the complete-record/stable-error/stale-reclaimer diffs; approve only the exact final PR head named in `## Owner Review` while required checks remain green.
