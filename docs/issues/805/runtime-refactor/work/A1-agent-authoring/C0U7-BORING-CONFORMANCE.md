# c0u.7 Boring conformance proof notes

Scope: Boring-repo A1.5 assets only. Seneca repo is intentionally not edited from this worktree.

## Added proof assets

- `packages/agent/examples/trusted-authored-agent/` — minimal authored directory with `agent.json`, `instructions.md`, and `tools/not-imported.mjs` sentinel.
- `packages/cli/src/__tests__/cli.integration.test.ts` — validates the example, materializes it through a trusted server allowlist, runs CLI dev one-shot through the capture harness, mutates authored instructions/tool refs, and proves captured prompt/catalog behavior changes while the authored executable sentinel is not imported.
- `scripts/a1-pack-consumer-smoke.mjs` — reproducible packed consumer smoke for Agent/CLI tarballs (plus Workspace because CLI dev imports its app-server seam), runtime value export checks, TypeScript server/shared/front type-boundary checks, installed-bin validate, and installed-bin dev fail-closed catalog smoke.

## Exact commands

```bash
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-ui-cli build
pnpm --filter @hachej/boring-ui-cli typecheck
pnpm --filter @hachej/boring-ui-cli test
pnpm --filter full-app typecheck
pnpm --filter full-app test
pnpm lint:invariants
pnpm check:golden-path
git diff --check
```

Additional A1.5 pack smoke after Agent/CLI builds:

```bash
BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke node scripts/a1-pack-consumer-smoke.mjs
```

## Recorded proof outcomes

Latest focused proof on this worktree:

- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-ui-cli exec vitest run src/__tests__/cli.integration.test.ts` — 43 tests passed; proves validate → materialize → dev one-shot, distinct captured composed prompt/tool identity/tool result changes, and no authored executable sentinel import.
- PASS `BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke BORING_A1_PACK_SELF_TEST_SETUP_FAILURE=1 node scripts/a1-pack-consumer-smoke.mjs` — generated `/home/ubuntu/.cache/boring-a1-pack-smoke/boring-a1-pack-consumer-2LmIsr`, intentionally failed immediately after `mkdtempSync`, removed that exact root in `finally`, and exited 0 after verifying the root no longer existed.
- PASS `BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke node scripts/a1-pack-consumer-smoke.mjs` — generated `/home/ubuntu/.cache/boring-a1-pack-smoke/boring-a1-pack-consumer-9mByD1`, built Workspace before pack, packed exact `0.1.89` cohort, passed TypeScript server type positive plus shared/front type/value negatives, installed-bin validate/dev fail-closed checks, removed that exact generated root in `finally`, and `find $HOME/.cache/boring-a1-pack-smoke -maxdepth 1 -type d -name 'boring-a1-pack-consumer-*'` returned no remaining generated roots.
- PASS `git diff --check` after review-fix edits.

Earlier exact c0u.7 command pass/fail record from this worktree:

- PASS `pnpm --filter @hachej/boring-agent build`
- PASS `pnpm --filter @hachej/boring-agent typecheck`
- PASS `pnpm --filter @hachej/boring-agent test`
- PASS `pnpm --filter @hachej/boring-ui-cli build`
- PASS `pnpm --filter @hachej/boring-ui-cli typecheck`
- BASELINE FAIL `pnpm --filter @hachej/boring-ui-cli test` only in `runtimePluginBrowser.integration.test.ts`; focused A1 CLI integration passes.
- PASS `pnpm --filter full-app typecheck`
- PASS earlier `pnpm --filter full-app test` before `/tmp` inode exhaustion; a later rerun failed only with `ENOSPC` while creating Vitest temp files.
- PASS `pnpm lint:invariants`
- PASS `pnpm check:golden-path`

Packed cohort smoke is pinned to exact package version `0.1.89` for:

- `@hachej/boring-agent`
- `@hachej/boring-workspace` (included because the CLI dev command imports its app-server seam)
- `@hachej/boring-ui-cli`

The smoke builds Workspace before packing, asserts required dist artifacts, asserts packed and installed package name/version, proves server runtime value import positive, proves server `MaterializedAgentSourceV1` type import with `tsc`, proves shared/front behavior/type imports fail with `tsc`, runs installed-bin validate, and runs installed-bin dev fail-closed on missing trusted catalog. It enters the cleanup `try/finally` immediately after `mkdtempSync`, removes only its own generated `workRoot` in `finally` after path/prefix self-checks, and supports `BORING_A1_PACK_SELF_TEST_SETUP_FAILURE=1` to prove setup-failure cleanup. Set `BORING_A1_PACK_RETAIN_DEBUG=1` to retain that one generated work root for debugging.

## Residual risks / baseline dispositions

- Full `pnpm --filter @hachej/boring-ui-cli test` has an unrelated baseline failure in `runtimePluginBrowser.integration.test.ts` (`page.evaluate` context destroyed / runtime plugin hot-load flake). The A1 CLI integration file passes focused.
- A later run hit `/tmp` inode/space exhaustion (`ERR_PNPM_ENOSPC`, then Vitest `ENOSPC`). The pack smoke now defaults generated temp data to `~/.cache/boring-a1-pack-smoke` (or explicit `BORING_A1_PACK_TMPDIR`) and sets subprocess `TMPDIR` there; every subprocess has a timeout.
- Owner authorized scoped deletion for this smoke. The script now deletes only its generated work root in `finally`, after checking it is under the temp base and named `boring-a1-pack-consumer-*`. No broad deletion or glob cleanup is performed. Use `BORING_A1_PACK_RETAIN_DEBUG=1` to keep that generated root.

## Decision 26 doc alignment

Boring Agent/CLI docs state:

- no `AgentDeployment`, deployment/default resolver, digest/CAS/publication state, AgentHost, domain routing, or second runtime composer is A1 runtime authority;
- tools resolve only from an explicit trusted per-agent host allowlist;
- capability/skill/MCP refs are unsupported by v1 materialization;
- `agent validate` reports structure/declared refs only;
- `agent dev` requires exactly `--prompt` or `--serve`, rejects top-level `--mode`, uses `BORING_AGENT_WORKSPACE_ROOT` as its explicit local workspace root when set, defaults sandboxed, and direct execution requires `--allow-direct`.

## Seneca companion documentation status

Seneca was not edited from this Boring worktree. The companion Seneca README/doc
alignment requested by c0u.7 has been implemented separately at Seneca commit
`38b64d8` in PR `hachej/seneca#16` and received final Sol clean review.

That companion replaces the stale follow-up list: Seneca now documents the same
A1 boundary as Boring docs — validate authored directories, materialize through
trusted server composition, use explicit per-agent tool allowlists, reject
unsupported capability/skill/MCP refs, avoid `AgentDeployment`/digest runtime
authority, and keep production domain/workspace-type routing and exact package
pins in later Seneca integration slices.

## Rollback

Before release, revert the example/docs/tests/script changes if A1.5 is withdrawn. After release, ship a corrective package cohort and restore the last-known-good authored directory/per-type binding; do not map non-default workspace types to compatibility agent `primary`.
