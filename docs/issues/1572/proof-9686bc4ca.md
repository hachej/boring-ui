# [Production Deps Group Retry] Proof of work

## Scope and revisions

- Issue / Bead / PR: `factory-plugin-rvrw.2` / [PR #1572](https://github.com/hachej/boring-ui/pull/1572)
- Current-main base: `6b540ec3e421db6b66c36ec8f3d301a3a51bcf92`
- Reviewed product/evidence head: `9686bc4caafe3777cc680405e1f76f2235234487`
- The base is an ancestor of the reviewed head; local HEAD and the PR branch matched after fetching both refs.
- This proof and `show-me-9686bc4ca.md` may be carried by a later docs-only artifact commit; no product or dependency state changes after the reviewed SHA.

## Final diff and risk route

`git diff origin/main...9686bc4ca` contains only `.beads/issues.jsonl` and three files under `docs/issues/1572/`. Direct comparison of all workspace `package.json` files, `pnpm-lock.yaml`, and `packages/cli/vite.config.ts` is empty. There are no changed paths under `packages/`, `apps/`, `plugins/`, `src/`, or `.github/`.

- Package production additions + deletions: **0**.
- Dependency/lockfile delta: **0**.
- Protected-boundary matches: **none** — no product direction, public/MCP contract, package ownership, security/authority, money/irreversibility, shared design language, or automation-policy change.
- Classification: **automatic-eligible docs/Factory-metadata-only final diff**.
- UI evidence: N/A; there is no UI behavior or appearance delta.

## Dropped packages

All nine original production bumps were dropped: TypeScript 7.0.2, Mermaid 11.17.2, streamdown 2.6.0, lucide-react 1.39.0, Vite 8.2.2, motion 13.1.1, @vercel/sandbox 3.2.1, ai 7.0.90, and @earendil-works/pi-ai 0.84.4. Exact isolated evidence is tabulated in [`show-me-9686bc4ca.md`](show-me-9686bc4ca.md). Dependabot may reopen each package individually.

## GitHub verification

- [CI run 34399996416](https://github.com/hachej/boring-ui/actions/runs/34399996416) — SUCCESS at exact `9686bc4ca`: lint, typecheck, changed unit tests, invariants, Runtime Refactor P8, and PR Fast Summary pass; product-heavy jobs skip because the final diff has no product/dependency change.
- [Workflow Invariants run 34399996424](https://github.com/hachej/boring-ui/actions/runs/34399996424) — SUCCESS at exact `9686bc4ca`.
- GitHub read-back: `MERGEABLE` / `CLEAN`; zero issue comments, zero submitted reviews, and zero inline review comments before the terminal Factory receipt.

The complete branch run inventory contained 78 runs: 15 historical failures and 27 cancellations. Material failure families were inspected and dispositioned:

1. Initial grouped heads (`940999930`, `c067d120e`, `ccf45be5`) fanned out after frozen install/config mismatch; root pi-ai override/lock synchronization restored installability.
2. TypeScript 7 caused the tsup/rollup-plugin-dts `useCaseSensitiveFileNames` crash; the bump was dropped.
3. Multiple CLI budget reds isolated Mermaid, streamdown, lucide-react, Vite, motion, sandbox SDK, AI SDK, and pi-ai bumps; all were dropped rather than raising budgets or retaining source accommodations.
4. `34c03eecc` Runtime P8 caught a lucide manifest/lock mismatch; synchronization fixed it.
5. `7610a240b` also contained nondeterministic changed-unit failures; later exact runs passed without a product-source fix, while the deterministic CLI budget failure led to dropping the bump.
6. At `851868da0`, Runtime P8, E2E, and UI Review failed before repository tests on the same Google Chrome apt repository `Hash Sum mismatch`; PR Fast Summary only aggregated E2E. Exact-final runs passed, including Runtime P8.

No current failed or pending required check remains.

## Controlled-environment proof

Prior exact-SHA sandbox `270d85d8-cc15-4b29-95f1-012a56264e9c` verified both `.factory-sha` and `git rev-parse HEAD` as `9686bc4caafe3777cc680405e1f76f2235234487`; `CI=true pnpm install --frozen-lockfile`, `pnpm audit:imports`, and `pnpm lint:invariants` passed; release receipt was successful. Full typecheck and workspace/core budgets also passed in predecessor product-identical sandboxes as recorded in the `factory-plugin-rvrw.1` handoff. The later docs-only artifact SHA receives docs/diff validation only because it does not alter that tested product state.

## Independent review

Epic retry review lineage (3 of 4 rounds used):

1. `36dced126` — request changes; session `59d8144d-b89b-4efe-bef4-e2e47fd3f153`, `openai-codex/gpt-5.6-sol`, digest `sha256:3e5aae4054cc73da210e234b3ad45e460ed585431eb750af5f609efb94a6763b`; stale owner evidence corrected.
2. `f4d7db344` — request changes; session `bf34d601-1779-400f-bd5b-faab9471857e`, `openai-codex/gpt-5.6-sol`, digest `sha256:16a4ff914d76d1e23d1e88bbda658163de1c4eb8ce098f5915d1d7e9038ef1f1`; TypeScript evidence reference corrected.
3. `9686bc4ca` — **APPROVE**; session `8354e1ef-c5f7-4b8d-aac7-d5e6c0915309`, `openai-codex/gpt-5.6-sol`, digest `sha256:eda5df03b50b3b6947b54a0a5e11566c3decdd0122d4c8e6cbe17afad1148681`; no material findings, standards/spec PASS, thermo PASS.

Abstraction review: **PASS** at exact `9686bc4ca`. The reviewer verified that manifests, lockfile, and CLI config match main and that no package dependency, export, import, ownership, public seam, real caller, or production-source delta remains.

## Rollback and residual risk

- Roll back only with new revert commits; never rewrite or force-push.
- There is no dependency/product change to roll back in the final state. Reverting the docs/metadata retry commits only removes audit evidence.
- Residual: historical fix-forward commits remain in branch history, but base-to-head content and GitHub's combined PR diff are the reviewed surfaces.
- No waiver.
