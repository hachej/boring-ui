# c0u.7 Boring conformance proof notes

Scope: Boring-repo A1.5 assets only. Seneca repo is intentionally not edited from this worktree.

## Added proof assets

- `packages/agent/examples/trusted-authored-agent/` — minimal authored directory with `agent.json`, `instructions.md`, and `tools/not-imported.mjs` sentinel.
- `packages/cli/src/__tests__/agentDev.integration.test.ts` — contains the A1 trusted example conformance: validates the example, materializes it through a trusted server allowlist, runs CLI dev one-shot through shared agent-dev capture support, mutates authored instructions/tool refs, and proves captured prompt/catalog behavior changes while the authored executable sentinel is not imported.
- `scripts/a1-pack-consumer-smoke.mjs` — reproducible packed consumer smoke for Agent/CLI tarballs (plus Workspace because CLI dev imports its app-server seam), runtime value export checks, TypeScript Agent/CLI server type-boundary checks, installed-bin validate, installed-bin dev fail-closed catalog smoke, and supported packed CLI server-seam successful tool-bearing one-shot smoke.

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

Post-merge proof on this worktree after merging latest A1.4a stabilization
(`f43d28c54`) into A1.5:

- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-agent build`
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-agent typecheck`
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-agent test` — full Agent suite green: 209 files passed, 3 skipped; 2025 tests passed, 6 skipped; type errors none.
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-ui-cli build`
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-ui-cli typecheck`
- BASELINE FAIL `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-ui-cli test` — only `runtimePluginBrowser.integration.test.ts` failed (`page.evaluate: Execution context was destroyed, most likely because of a navigation` during the built folder-mode hot-load test); 12 files / 120 tests passed, 1 file / 2 tests skipped. Focused A1 authored-agent split tests pass below.
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter @hachej/boring-ui-cli exec vitest run src/__tests__/agentDev.integration.test.ts src/__tests__/agentValidate.integration.test.ts src/__tests__/cli.integration.test.ts` — 3 files / 48 tests passed; A1 trusted example proof lives in `agentDev.integration.test.ts` and proves validate → materialize → dev one-shot, distinct captured composed prompt/tool identity/tool result changes, and no authored executable sentinel import.
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter full-app typecheck`
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm --filter full-app test` — 4 files / 45 tests passed.
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm lint:invariants`
- PASS `TMPDIR=$HOME/.cache/boring-a1-test-tmp pnpm check:golden-path`
- PASS `BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke BORING_A1_PACK_SELF_TEST_SETUP_FAILURE=1 node scripts/a1-pack-consumer-smoke.mjs` — generated `/home/ubuntu/.cache/boring-a1-pack-smoke/boring-a1-pack-consumer-DQVa4x`, intentionally failed at the first guarded statement immediately after `mkdtempSync`, removed that exact root in `finally`, and exited 0 after verifying the root no longer existed.
- PASS `BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke node scripts/a1-pack-consumer-smoke.mjs` — generated `/home/ubuntu/.cache/boring-a1-pack-smoke/boring-a1-pack-consumer-2jUyPW`, built Workspace before pack, packed exact `0.1.89` cohort, passed TypeScript Agent server type positive plus shared/front type/value negatives and CLI server-seam type positive, passed installed-bin validate/dev fail-closed checks, passed malicious packed CLI server-seam adapter diagnostic with injected adversarial markers and no leakage, passed supported packed CLI server-seam tool-bearing one-shot with captured prompt/tool identity/tool result, scanner self-proof, raw/ANSI-normalized stdout/stderr exact-marker scan, and no output leak of prompt/authored instruction marker/tool result/injected secret/path/generated-root/executable-sentinel markers. Scanner self-proof verifies safe prose/routes/URLs are accepted, raw OSC title/hyperlink payload markers are caught before stripping, and ANSI-obfuscated markers are caught after normalization. Removed that exact generated root in `finally`, and `find $HOME/.cache/boring-a1-pack-smoke -maxdepth 1 -type d -name 'boring-a1-pack-consumer-*'` returned no remaining generated roots.
- PASS `git diff --check` after merge and pack-smoke edits.

Packed cohort smoke is pinned to exact package version `0.1.89` for:

- `@hachej/boring-agent`
- `@hachej/boring-workspace` (included because the CLI dev command imports its app-server seam)
- `@hachej/boring-ui-cli`

The smoke builds Workspace before packing, asserts required dist artifacts, asserts packed and installed package name/version, proves Agent server runtime value import positive, proves Agent server `MaterializedAgentSourceV1` type import with `tsc`, proves the supported CLI server seam types with `tsc`, proves shared/front behavior/type imports fail with `tsc`, runs installed-bin validate, keeps installed-bin dev fail-closed on missing trusted catalog, and imports the supported packed `@hachej/boring-ui-cli/server` seam. For output secrecy, the smoke scans both raw and ANSI-normalized stdout/stderr for exact forbidden adversarial markers: prompt, authored instruction marker, tool result, injected secret/path markers (`/private/catalog-secret`, file URL, Windows drive, UNC), generated root markers (`repoRoot`, `workRoot`, `tempBase`), and authored executable sentinel markers. It also runs a malicious server-seam adapter whose thrown error contains the injected secret/path markers and verifies output uses the fixed catalog-adapter diagnostic without leaking them. The scanner self-proof verifies normal prose/routes/URLs are accepted, raw OSC title/hyperlink marker payloads are caught before stripping, and ANSI-obfuscated markers are caught after normalization. The authored executable sentinel would throw if imported. The smoke enters `try/finally` as the first control after `mkdtempSync`, removes only its own generated `workRoot` in `finally` after path/prefix self-checks, and supports `BORING_A1_PACK_SELF_TEST_SETUP_FAILURE=1` to prove first-guarded-statement setup-failure cleanup. Set `BORING_A1_PACK_RETAIN_DEBUG=1` to retain that one generated work root for debugging.

## Residual risks / baseline dispositions

- Full `pnpm --filter @hachej/boring-ui-cli test` remains a qualified baseline failure only in `runtimePluginBrowser.integration.test.ts` (`page.evaluate` context destroyed / runtime plugin hot-load flake). Focused A1 split tests pass.
- Earlier runs hit `/tmp` inode/space exhaustion (`ERR_PNPM_ENOSPC`, then Vitest `ENOSPC`). Latest post-merge runs use `TMPDIR=$HOME/.cache/boring-a1-test-tmp`. The pack smoke defaults generated temp data to `~/.cache/boring-a1-pack-smoke` (or explicit `BORING_A1_PACK_TMPDIR`) and sets subprocess `TMPDIR` there; every subprocess has a timeout.
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
alignment requested by c0u.7 has been implemented separately at Seneca commits `38b64d8..530953d` in PR
`hachej/seneca#16` and received final Sol clean review.

That companion replaces the stale follow-up list: Seneca now documents the same
A1 boundary as Boring docs — validate authored directories, materialize through
trusted server composition, use explicit per-agent tool allowlists, reject
unsupported capability/skill/MCP refs, avoid `AgentDeployment`/digest runtime
authority, and keep production domain/workspace-type routing and exact package
pins in later Seneca integration slices.

## Rollback

Before release, revert the example/docs/tests/script changes if A1.5 is withdrawn. After release, ship a corrective package cohort and restore the last-known-good authored directory/per-type binding; do not map non-default workspace types to compatibility agent `primary`.
