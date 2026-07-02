# BI dashboard playground

This folder contains plugin-local playground helpers. The repo-level `workspace-playground` stays generic; BI dashboard is loaded explicitly when needed.

## Browser playground

Run the plugin in the existing workspace playground using the fixture in `../example`. The demo workspace includes `.pi/extensions/bi-dashboard`, which loads the front plugin as a workspace-local extension. For live query data, use the eval runner or another host that loads `@hachej/boring-data-bridge` as a trusted server plugin:

```bash
pnpm --filter @hachej/boring-data-bridge build
pnpm --filter @hachej/boring-bi-dashboard build
BORING_EXTERNAL_PLUGINS=1 \
BORING_AGENT_WORKSPACE_ROOT="$PWD/plugins/bi-dashboard/example" \
pnpm --filter workspace-playground dev
```

## Eval playground

Run the dashboard authoring eval through the plugin-local runner:

```bash
pnpm --filter @hachej/boring-bi-dashboard playground:eval
```

The runner seeds a temp workspace from `../example` and loads `@hachej/boring-data-bridge` plus `@hachej/boring-bi-dashboard` explicitly.
