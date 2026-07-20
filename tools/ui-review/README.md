# UI Review Tools

Private repository tooling for deterministic, scenario-driven UI review and
bounded improvement handoff. It is not product runtime code and is not
published.

## Review specs

A registered review spec supplies everything app-specific: target app root and
lifecycle, local route/readiness, isolated fixture, viewports, known checkpoints,
hard gates, optional Bombadil exploration, critic context, and owner spot checks.
The core accepts only exact registered spec ids—never arbitrary URLs, module
paths, configs, or commands from the CLI.

The registry includes:

- `workspace-command-palette`, which reviews the real workbench with known and
  explored states.
- `workspace-component-baselines`, which replaces the retired Storybook suite
  with six target-owned component fixtures and authoritative, bounded
  Playwright pixel baselines.

Both target `apps/workspace-playground`, but neither is part of the framework
identity. New specs can target `agent-playground`, `workspace-playground`,
`full-app`, or future `apps/*` roots without changing core contracts. A
checkpoint may opt into named viewports and a checked-in visual baseline; the
generic driver enforces both declarations.

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
