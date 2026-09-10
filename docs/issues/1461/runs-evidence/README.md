# Command Palette Replay proof

## Revision

- Tested source SHA: `efdb52bcae90beb89f114794acf5d6f53282ffe0`
- Scenario revision: `workspace-command-palette-v9`
- Candidate tree hash (run 05 manifest): `a0764a12e5b818721f361c98c85c689f895b88ed11103e164b91dec518fe5648`
- Registered command: `pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-command-palette --critic=fixture`
- Exact-SHA environment: disposable Factory sandboxes created from the pushed source SHA. Each run used the installed Playwright Chromium and `--no-sandbox` because the host `/usr/bin/chromium` is a Snap launcher that cannot run under the nested sandbox; `TMPDIR` was a short run-owned `/dev/shm` directory. These are execution-environment repairs, not source changes.

## Five consecutive foreground runs

No source change or failed registered replay occurred between run 01 and run 05.

| Run | Sandbox | Result | Wall time | Desktop replay | Mobile replay | Playwright |
| --- | --- | --- | ---: | --- | --- | --- |
| 01 | `176a36e2-e1ca-4849-ace6-30a5e26d14ab` | PASS | 1057 s | `explore-0004-dialog-popover:b154e331ec23` | `explore-0006-dialog-popover:aaf24219c2a6` | 1/1 pass |
| 02 | `aa4df9ed-106c-4c1e-85c4-07e1a378b637` | PASS | 989 s | `explore-0004-dialog-popover:d3de00cfd1d0` | `explore-0011-dialog-popover:195dbeb8de49` | 1/1 pass |
| 03 | `2ceca1a0-7b88-4ca1-8990-682512beb8c2` | PASS | 954 s | `explore-0020-dialog-popover:ea05bcb561ff` | `explore-0012-dialog-popover:0f314c4eca6e` | 1/1 pass |
| 04 | `dd3eb8e0-2aab-4660-87ab-142773d728cf` | PASS | receipt expired | `explore-0006-dialog-popover:c8670d1dcc4b` | `explore-0004-dialog-popover:31e49a82afe5` | 1/1 pass |
| 05 | `99177d18-8e85-4fe6-9800-ea832d045053` | PASS | 1028 s | `explore-0023-dialog-popover:fa07d14eaf46` | `explore-0005-dialog-popover:775e03f9ceef` | 1/1 pass |

Run 04's foreground tool result recorded exit 0, both replay-verification lines, and Playwright 1/1 green; its separate wall-time meta receipt expired with the disposable lease before it was read, so no duration is invented here.

## Focused static proof

At the same source SHA, sandbox `95f4eaf4-b01b-471b-86e0-ab1ae8b553d2` completed both commands before entering the registered replay:

- `pnpm --filter @hachej/boring-ui-review-tools test` — PASS
- `pnpm --filter @hachej/boring-ui-review-tools typecheck` — PASS

## Run 05 retained digest summary

Run 05 produced 68 files, including the manifest, selection, hard gates, report HTML/Markdown, reproduce bundles, and six deterministic Playwright checkpoint screenshots (closed/open/commands at desktop 1440×900 and mobile 390×844). The disposable sandbox does not flow generated files back into the source worktree; these revision-bound digests and the tool receipts are retained instead.

| File | SHA-256 |
| --- | --- |
| `selection.json` | `4477cc43536a036983ba6e06e68464790dc603dd0a429c330aab9dcbab28cc00` |
| `hard-gates.json` | `921830f7984ee607fc8bfb84a934d49ae86af176264d80d487078548f317e651` |
| `manifest.json` | `0f8df33184046e4b95d05703f23be11d1b40730de7039835d5821fec27efd259` |
| `report.html` | `63332383657f34b393d330726399f5919bec00586ba1c22de1f262b7c4bffaa2` |
| `report.md` | `0e9168697e625a02c79d08d3bbaa602042fec1a5c5c5645fcd95674e549e3a52` |

Run 05 recorded 38 raw desktop and 50 raw mobile Bombadil states, all exported Bombadil properties passing. Every generated hard-gate result passed. The six known checkpoints also passed console/page/HTTP/overflow/modal/focus/palette-mode checks. The existing nested-interactive exemption remained reported under the unchanged hard-gate contract; it was not weakened by this Bead.

## UI/video disposition

No product UI or CSS changed. The scenario only changes test-side replay state selection, so revision-bound video is not applicable. The registered Playwright scenario nevertheless captured and validated desktop/mobile checkpoint screenshots in every one of the five runs.

## Abstraction and thermo

- Cross-package abstraction: **PASS**. The policy depends on `UiReviewExplorationState` plus command-palette-specific extracted visual-shell fields and belongs in the scenario spec; no product package or shared core abstraction is justified.
- Thermo: behavior is bounded to synchronous selection over at most the staged state cap. The added scan is small (`Wait` states against later `Wait` states), has no I/O, timers, retries, global mutation, or production runtime path.
- Rollback: revert the two continuation commits (`040866cfd`, `efdb52bca`) and the earlier lineage commits if the feature is rejected. No data or product migration exists.
