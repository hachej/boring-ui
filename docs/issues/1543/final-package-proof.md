# Plugin Exports — final package proof

Implementation revision audited: `725d7568acdaa9f355bbabf956fdc467a5cf72fc`
Base/current main: `68dcb7db8822f721c6b45d0731e01a46fa364f28`
PR: https://github.com/hachej/boring-ui/pull/1543
Bead: `wt-391-forward-civu.2` (lineage: `wt-391-forward-clu5.2`)

This durable receipt records the exact-revision verification completed before this
proof-only file was committed. The handoff comment records the final descendant
SHA and its final-SHA re-verification/re-review.

## Exact-SHA sandbox proof

Sandbox `17000ae0-153b-435a-b2a6-9ac8680cc339` verified its checkout was
`725d7568acdaa9f355bbabf956fdc467a5cf72fc`.

- `CI=true pnpm install --frozen-lockfile` — PASS.
- `pnpm --filter @hachej/boring-ui-cli... --workspace-concurrency=4 run build` — PASS, including generated singleton metadata parity and CLI build.
- `pnpm --filter @hachej/boring-core... --workspace-concurrency=4 run build` — PASS.
- `pnpm --dir packages/cli exec vitest run --project cli src/__tests__/pluginFrontRuntime.test.ts src/__tests__/runtimePluginBrowser.integration.test.ts` — PASS; the selected CLI project ran the real Chromium integration file, 2/2.
- `pnpm --dir packages/workspace exec vitest run src/server/pluginImports/importServerModule.test.ts` — PASS, 5/5.
- `pnpm --filter @hachej/boring-ui-cli typecheck` — PASS.
- `pnpm --filter @hachej/boring-workspace typecheck` — PASS.
- `pnpm lint:invariants` — PASS.
- `pnpm audit:imports` — PASS.
- `git diff --check && git diff --exit-code` — PASS; sandbox remained clean.

GitHub reported PR head `725d7568acdaa9f355bbabf956fdc467a5cf72fc`,
OPEN/MERGEABLE/CLEAN, with all required exact-head checks successful, including
Typecheck, Unit Tests Changed, Unit Tests, Invariants, bundle checks, E2E, UI
Review, and PR Fast Summary. `origin/main` was an ancestor of the head.

## Independent review

Reviewer session `f8e16b02-c9d4-4067-a956-f222e68c39de`, model
`openai-codex/gpt-5.6-sol`, brief digest
`sha256:088d469be1f9d3adf79ab7055669638c1fdd447ce59dddc180738ee4b376eea2`,
reviewed exact SHA `725d7568acdaa9f355bbabf956fdc467a5cf72fc` read-only.

- Standards/spec: PASS; no material findings.
- Thermo: PASS.
- Cross-package abstraction: PASS.

The reviewer inspected `@hachej/boring-workspace` root, `/plugin`, and `/events`
public producers; CLI generated metadata, generator, runtime shim, and host
registry; and real ask-user, tasks, browser, deck, and live-transcription
callers. It audited 137 real plugin value imports with zero metadata misses and
found exact generated parity (root 148/148, plugin 18/18, events 16/16). No
private import, dependency cycle, duplicated authority, encapsulation leak, or
substitution break was found. Loader evaluation failures propagate without
native re-execution.

## Risk and classification

The complete PR changes 416 added/deleted production lines under `packages/`
when tests and the test harness are excluded (`packages/cli/package.json`,
generator, runtime implementation, and generated metadata). The numerical
protected-boundary trigger is not met (≤500); final routing still remains the
Orchestrator's responsibility under the rollout's retained gates. UI video is N/A for this
proof slice: it changes module identity/loading semantics and diagnostics, not
visible appearance; the real Chromium hot-load/reload assertions are the
runtime evidence.

Residual risk: ordinary CI does not run the focused Chromium file; its 2/2 result
comes from the exact-SHA sandbox. No blocker or major review finding remains.
