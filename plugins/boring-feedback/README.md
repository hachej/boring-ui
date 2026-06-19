# @hachej/boring-feedback

Installable boring-ui feedback intake plugin.

## What It Provides

- Feedback panel registered as `boring-feedback.panel`.
- `/feedback` Pi slash command.
- Bundled `boring-feedback` skill under `skills/boring-feedback`.

The plugin captures the entry point. The skill owns the workflow: draft,
safe context enrichment, redaction preview, grill choice, GitHub issue or
Project backlog routing, and scheduled triage handoff.

## Install Shape

Add the package to an app's `boring.defaultPluginPackages`, or install it as a
Pi plugin package through the CLI/plugin settings path. The plugin metadata is
declared in `package.json#boring` and `package.json#pi`.

## Development

```sh
pnpm --filter @hachej/boring-feedback typecheck
pnpm --filter @hachej/boring-feedback test
```
