# UI Review Tools

Private repository tooling for deterministic, scenario-driven UI review and
bounded improvement handoff. It is not product runtime code and is not
published.

## Review specs

A registered review spec supplies its repository-owned target root and lifecycle,
local route/readiness, isolated fixture, viewports, known checkpoints, hard gates,
optional Bombadil exploration, critic context, and owner spot checks.
The core accepts only exact registered spec ids—never arbitrary URLs, module
paths, configs, or commands from the CLI.

The registry includes:

- `ask-user-inline`, which reviews pending, selected, and resolved inline question states at desktop and mobile widths.
- `automation-pane-popover`, which reviews the Automations pane and New
  automation editor at desktop and mobile widths through the private fixture host.
- `workspace-agent-sidebar`, which reviews the real addressed-Agent navigation,
  pinned provenance, responsive actions, expansion hierarchy, and unified Agent page.
- `workspace-command-palette`, which reviews the real workbench with known and
  explored states.
- `workspace-component-baselines`, which replaces the retired Storybook suite
  with six tool-owned component fixtures under
  `tools/ui-review/fixtures/workspace-components` and authoritative, bounded
  Playwright pixel baselines.

Behavior specs may target `agent-playground`, `workspace-playground`, `full-app`,
or future `apps/*` roots. Isolated component specs target private fixture hosts
under `tools/ui-review/fixtures/*`; review-only code never belongs in an app.
A checkpoint may opt into named viewports and a checked-in visual baseline; the
generic driver enforces both declarations.

## Reviewing frontend changes

Reviewer agents can reuse the tool directly. Select the registered spec covering
the changed component or behavior, run `review`, and treat `hard-gates.json` as
authoritative while using `report.html` and critic findings as advisory evidence.
Behavior specs exercise a real app; component specs exercise the private fixture
host. The component host builds its complete workspace dependency chain and
serves pinned local fonts, so required review does not depend on prior build order
or external font requests. Registered review servers bind only to loopback and
fail closed on port collisions. If
no registered spec covers the change, add or extend
a tool-owned fixture and review spec rather than adding review infrastructure to
product/app source.

## Commands

```bash
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-command-palette --critic=fixture
pnpm --filter @hachej/boring-ui-review-tools ui:review -- improve workspace-command-palette --critic=fixture
pnpm --filter @hachej/boring-ui-review-tools ui:review:components:ci
pnpm --filter @hachej/boring-ui-review-tools ui:review:components:update
pnpm --filter @hachej/boring-ui-review-tools ui:improve:validate -- <run-directory>
```

Live vision remains explicit credential-gated opt-in. Required CI uses the
fixture critic after complete passing hard gates.

## Temporary files

Every temp directory the tooling creates (isolation home/config/cache, Bombadil
raw output, replay bundles, test fixtures) lives inside one run-scoped parent
under the OS temp directory named `boring-ui-review-run.*`. That parent is
owned by the process that created it — normally `scripts/run-ui-review.mjs` —
and is removed when that process finishes, throws, or is killed with
`SIGINT`/`SIGTERM`/`SIGHUP`, so interrupted runs cannot leak inodes. Before a
signal-driven removal the orchestrator terminates its active child process
group (`pnpm` → Playwright → workers), because default-terminated Node processes
do not run `exit` handlers and could otherwise still write into the root during
cleanup. Cleanup never follows symlinks and refuses to remove any path outside
that parent.

The creator passes its run root to every spawned child through
`UI_REVIEW_TEMP_ROOT`. An inherited root is used as-is: children create their
subdirectories inside it but never remove it — not on exit, not on signal — so a
worker killed by its runner cannot leak anything and cannot race the owner's
cleanup. A malformed inherited value fails closed instead of being adopted.
When no root is inherited, creating one arms its removal on normal process
`exit`, which is safe in any host. Signal handling is opt-in, because cleaning
up on a signal means re-exiting the process with that signal's conventional code
— a decision only an entrypoint that owns its process may take. The CLI
entrypoints (`scripts/run-ui-review.mjs`, `scripts/explore-review-spec.ts`) call
`installUiReviewTempCleanupHandlers()`; importing the helper into a Playwright or
vitest worker never does.

Set `UI_REVIEW_KEEP_TMP=1` to retain the run directory for debugging.
`UI_REVIEW_ISOLATION_ROOT` still points the isolation tree at a caller-owned
path, which the tooling never removes. When `UI_REVIEW_OUTPUT_DIR` is unset the
report lands inside the run directory and is discarded with it; set it to keep
artifacts.
