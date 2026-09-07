# [Objectives Plugin] Proof of work

## Scope and exact revisions

- Issue / epic / delivery Bead / PR: [#1382](https://github.com/hachej/boring-ui/issues/1382) / `pr-1382-objectives-plugin` / `wt-391-forward-5m2v.4` / [PR #1382](https://github.com/hachej/boring-ui/pull/1382).
- Actual comparison base and current `origin/main`: `68dcb7db8822f721c6b45d0731e01a46fa364f28`.
- Reviewed code head: `5eea1451e322f4940478f28367c1cc6624951f30`.
- Integration candidate: current main is the merge-base and an ancestor of the reviewed code head; merge commits `384a89eed01f4c3521fefe1d7ba015d17ff06eb0` and `3f37b1679e1df704edd6b15a2387fe39c2824b62` integrated main without rewriting history.
- Artifact proof/media commit: `025125fae4b779e65edbd3f5be84297b4f1b1875`; owner presentation commit: `732de74e89db2553853cb5968bdd0d3651d881b5`. The final receipt commit that updates this literal lineage is recorded in the Bead handoff and PR proof comment; all commits after the reviewed code head are docs/media only and change no product code or contract.

## What changed

The plugin supplies a thin Objective record, restart-durable file store, four agent tools, `objective.v1` bridge operations, and a workbench pane. Final hardening validates the fully materialized create record against the unchanged 24 KiB UTF-8 limit and maps direct filesystem/path/lock failures to path-free plugin-owned stable errors while retaining raw diagnostics only in trusted `Error.cause`.

The plugin is not registered in app composition, publishes nothing, creates no migration, and adds no package production source. The durable Objective primitive remains an owner-protected architecture decision.

## Exact-SHA automated verification

Factory sandbox `f959fb64-6db6-428f-a571-5303c9a7030b` verified both `git rev-parse HEAD` and `.factory-sha` as `5eea1451e322f4940478f28367c1cc6624951f30` and produced:

- `CI=true pnpm install --frozen-lockfile` — PASS; only existing missing-prebuilt-bin warnings.
- `pnpm --filter @hachej/boring-objectives typecheck` — PASS.
- `pnpm --filter @hachej/boring-objectives test` — PASS, **8 files / 92 tests**.
- `pnpm --filter @hachej/boring-objectives build` — PASS, ESM plus declarations.
- `pnpm audit:imports` — PASS.
- Runtime Refactor P8 exact commands `pnpm lint:invariants` and `pnpm check:golden-path` — PASS, including no uncovered shared `node:*`, `Buffer`, or raw-path signatures.

No assertion was removed, skipped, or weakened. Boundary coverage includes complete-record byte limits; corrupt/duplicate durable state; idempotency conflicts; pagination; containment; lock/reclaim/commit failures; cause preservation; public diagnostic redaction; real tool and WorkspaceBridge seams; and failed-commit durability.

## UI evidence

Deterministic runner (same fixture, viewport, and interaction):

```sh
node docs/issues/1382/run-ui-proof.mjs <revision> <label> .handoff/objectives-ui-proof-final
```

- Fixture: `obj-11111111-1111-4111-8111-111111111111`; viewport: 1280×720.
- Base `68dcb7db8822f721c6b45d0731e01a46fa364f28`: Objective surface absent; click **Probe Objective surface**; status becomes `No Objective panel registered.` — PASS. [Video](../../../assets/objectives-plugin-final/before-68dcb7db8822.webm) · [JSON report](../../../assets/objectives-plugin-final/before-68dcb7db8822.json).
- Candidate `5eea1451e322f4940478f28367c1cc6624951f30`: initial `2 / 10`; click **Apply server update**; ObjectivePane's actual visibility-refresh handler reaches `7 / 10`; constraint visible — PASS. [Video](../../../assets/objectives-plugin-final/candidate-5eea1451e322.webm) · [JSON report](../../../assets/objectives-plugin-final/candidate-5eea1451e322.json).
- The same two runs passed in the exact-SHA Factory sandbox and were repeated locally to publish owner-accessible artifacts. Per the requested existing-runner scenario, this is a deterministic component harness using archived revision sources, a Workspace module shim, and fixture `fetch`; it proves ObjectivePane interaction/refresh rather than claiming an end-to-end durable-store browser path. Direct store/tool/real WorkspaceBridge registry coverage is supplied by the 92-test suite.
- Mobile omitted: the plugin is unregistered and this proof targets a fixed workbench pane; responsive residual is limited to component coverage.

## CI and integration audit

- Final reviewed-code [Workflow Invariants run 34163847781](https://github.com/hachej/boring-ui/actions/runs/34163847781) — SUCCESS, including Runtime Refactor P8, Strategy Docs, and Action Pins.
- Final reviewed-code [CI run 34163847711](https://github.com/hachej/boring-ui/actions/runs/34163847711) — all affected and broad jobs passed except an unrelated `workspace-command-palette` Bombadil replay divergence in UI Review; failed-job rerun requested. Final required-check disposition is recorded revision-bound in the Bead handoff/PR comment rather than represented as green before it is green.
- Earlier [CI run 34157346152](https://github.com/hachej/boring-ui/actions/runs/34157346152) and [Workflow Invariants 34157346157](https://github.com/hachej/boring-ui/actions/runs/34157346157) were fully green before the two server-contract fixes.
- Historical failures preserved: P8 shared `Buffer` findings in runs 32645716828/32961886253 and merged lockfile breakage in 34149136876/34149136997 were fixed by `45dd7a00e4ffa4c48b8de1791dc911c958de35dd`; later Bombadil replay divergence is outside Objectives paths and is not misreported as product proof.
- PR conversations, GitHub reviews, and inline review comments were audited; each remains empty. Independent Factory reviews below are the durable review source.

## Independent review and explicit abstraction PASS

**Abstraction review: PASS** at reviewed code SHA `5eea1451e322f4940478f28367c1cc6624951f30` (Boring Reviewer session `109e9597-bf15-4529-82eb-343c3f005bbc`, `openai-codex/gpt-5.6-sol`, digest `sha256:805fd4b098d2273c82c037d94d2d7b0e99bd87a38b38e600a4f094c0dbb98673`). Standards/spec and thermo also PASS with no material findings.

- Governing contracts inspected: `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md`, `docs/plans/long-term/ratified/RECONCILIATION.md`, and `docs/procedures/coding-invariants.md`.
- Public seams inspected: objectives front/server/shared exports; `ObjectiveStore`, `FileObjectiveStore`, `ObjectiveError`, tools, objective.v1 handlers/client; WorkspaceBridge registry/trusted handler/HTTP composition; `createWorkspaceAgentServer`; plugin composition; and `ObjectivePane`.
- Real callers inspected: `evals/factory/lib/harness.ts` and objective eval checks; Agent and Workspace production sources were searched for Objective special-cases.
- Ownership/direction: Objective vocabulary, persistence, path policy, and the canonical plugin-local `ObjectiveErrorCode` enum remain plugin-owned. Agent's platform `ErrorCode` intentionally contains no `OBJECTIVE_*` special-case; adding one would invert this ownership. Workspace owns generic composition and canonical bridge errors. Agent core contains no Objective special-case. Consumers use supported exports; no private/deep import, dependency reversal, cycle, concrete-layout leak, permission widening, or substitution break exists.
- Consumer proof: exact command set above plus real direct/tool/registry regressions. ENOENT, containment, mutual exclusion, timeout/reclamation, atomic replacement, and failed-commit durability remain intact.
- Earlier request-changes rounds and fixes are preserved in parent/code-fix Bead handoffs. Final artifact-only SHA receives a separate fresh review for standards, evidence accessibility/correctness, thermo applicability, and reconfirmation that docs/media do not invalidate this package-abstraction PASS.

## Risk route, counts, triggers, and exclusions

- Full base-to-reviewed-code diff: **5,465 additions + 19 deletions = 5,484 changed lines across 55 files** (`git diff --numstat 68dcb7db...5eea1451e`). Through owner-presentation commit `732de74e8`, the PR is **7,524 additions + 19 deletions = 7,543 changed lines across 61 files**; the increase is docs/media/artifact-only and does not alter production risk.
- `packages/**` production additions + deletions: **0**; the base-to-head `packages` diff is empty.
- Numerical exclusions from the package threshold: all plugin production code (outside `packages/**`), tests, evals, docs, `.beads/issues.jsonl`, manifests, lockfile, and generated/artifact media. Exclusion is numerical only; every area remains semantically reviewed.
- Matched protected trigger: durable Objective primitive / architecture semantic decision. This controls the route regardless of package production count.
- Absent triggers: no authentication, permissions, tenant isolation, secrets, billing/spend, destructive migration/deletion, release/publish, shared design-system/global navigation, or automation-authority change.
- Route: **protected owner merge decision; never automatic**.

## Gaps, risk triggers, rollback, and owner test

- Waiver: none. Proof gap: none once the final rerun and required checks are green; a failed/missing check blocks handoff as ready.
- Accepted residuals: narrow pre-lock lock-path symlink-swap window, release read-then-unlink window, and documented single-live-writer/restart-overlap contract rather than arbitrary N-writer serializability.
- Risk triggers to revisit: registering the plugin, changing public Objective vocabulary/bridge codes, widening browser mutations, moving Objective ownership into a platform package, multi-writer support, migration, release, or any `packages/**` production change.
- Rollback before merge: reject the candidate. After an authorized merge: revert PR #1382's merge commit. No migration, registration, release, or data rewrite needs reversal.
- Owner test: open the [presentation](../../../assets/objectives-plugin-final/pr-1382-presentation.html), inspect the Show me flow, watch base then candidate video, confirm `2 / 10` becomes `7 / 10`, then inspect stable-error and complete-record-limit diffs. Merge only the exact approved PR head after required checks remain green.
