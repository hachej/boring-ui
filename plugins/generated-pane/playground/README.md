# Generated pane playground

Run this plugin in the existing workspace playground without making it a default playground plugin. The demo workspace includes `.pi/extensions/generated-pane`, which loads the plugin as a workspace-local front extension:

```bash
pnpm --filter @hachej/boring-generated-pane build
BORING_EXTERNAL_PLUGINS=1 \
BORING_AGENT_WORKSPACE_ROOT="$PWD/plugins/generated-pane/example" \
pnpm --filter workspace-playground dev
```

Open `panes/project-status.pane.json` with the generated-pane panel.

## Eval playground

Run the authoring eval and validate that the agent wrote parseable `boring.generated-pane` JSON:

```bash
pnpm --filter @hachej/boring-generated-pane playground:eval
```
