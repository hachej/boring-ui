# PR #1431 retained 5/5 evidence

Exact scenario command executed five times consecutively:

```sh
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-agent-sidebar --critic=fixture
```

Each invocation ran synchronously in the foreground with a distinct `UI_REVIEW_OUTPUT_DIR`. The transcript records both Playwright's scenario duration and `/usr/bin/time` wall time for the complete command, including dependency builds.

| Run | Playwright duration | Full command wall time | Result | Hard gates | Readiness diagnostics |
| --- | ---: | ---: | --- | ---: | --- |
| 1 | 1.1m | 856.52s | PASS | 312/312 | 24/24 `retryUsed=false` |
| 2 | 1.2m | 836.65s | PASS | 312/312 | 24/24 `retryUsed=false` |
| 3 | 1.2m | 804.32s | PASS | 312/312 | 24/24 `retryUsed=false` |
| 4 | 1.2m | 837.12s | PASS | 312/312 | 24/24 `retryUsed=false` |
| 5 | 1.1m | 774.79s | PASS | 312/312 | 24/24 `retryUsed=false` |

## Retained files

Every `run-0N/` directory contains:

- `output.log` — raw foreground transcript, including exact invocation, `1 passed`, and wall timing.
- `hard-gates.json` — complete 312-result hard-gate report.
- `report.md` — generated run summary.
- `manifest.json` — generated 24-state manifest.

## Key excerpts

- Run 1: `1 passed (1.1m)`; `real 856.52`.
- Run 2: `1 passed (1.2m)`; `real 836.65`.
- Run 3: `1 passed (1.2m)`; `real 804.32`.
- Run 4: `1 passed (1.2m)`; `real 837.12`.
- Run 5: `1 passed (1.1m)`; `real 774.79`.
- Each `hard-gates.json` has 312 results, zero failures, 24 `readiness-retry` results with `retryUsed=false;firstError=none`, and zero `retryUsed=true` results.

The generated manifests share candidate revision `65f32725057e5583a064c8807b352087eda15bd8`. Their tree hashes differ because the worktree already contained an actively written, untracked `sol-1431-loop.log`; the tracked source diff under test did not change between runs.

## SHA-256

| Run | `output.log` | `hard-gates.json` |
| --- | --- | --- |
| 1 | `12828bb1c7a4a14dff42d4f6551d56d5db2d4289aaeabffd035a594d2ae0f54f` | `75ea182d4190714bbcbf63fe60228ee302306139554e336da6f89578a908a684` |
| 2 | `9fd445a1f5ad3a2432f84dc0f915143eed8370b1c9170a218fb7f95e9598d51b` | `daabe6de2cabcebd60675b72f118809a693991991c01ad03ea95440a32f4972f` |
| 3 | `e7f3ab0d8cf7a0c122e2d60bc811d51db68118749cba15d09dcfb667e8b13b1f` | `9512c879eaa7ddbe248c2f1997195ce7d4769c396a46730c4b9d010f39c6f769` |
| 4 | `811d2f14c1c8caeffed61adbda84b678d0b82de846372f0e0b4a99ad519df0b4` | `93b2e39380ca9ffd7819fb6bd1d5953332a6b8fec6c8091ef0c1c311e3bb7c7d` |
| 5 | `3af751f7690255227d930bf1c16ebf9df329aaadb2b4cd237d7445660ec0fbcd` | `45a82a717284e36bdf5940908c2255439528a04ab9da3664ef48c2b212c1f5fd` |
