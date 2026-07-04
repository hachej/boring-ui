# Boring App Setup — Plugin Paths

Use this file when the child app needs custom plugins.

## First question

What kind of plugin is this?

| Want | Use | Why |
|---|---|---|
| fast local/runtime plugin, hot reload, no trusted backend routes | `boring-ui-plugin scaffold <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"` | creates `.pi/extensions/<name>/` in the current workspace |
| verify a runtime/generated plugin | `boring-ui-plugin verify <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"` | checks manifest + file shape |
| shipped repo-level packaged plugin | `boring-ui-plugin create <name> --path plugins` | uses the publishable package template shape |
| shipped app-local direct-source plugin | copy `apps/workspace-playground/src/plugins/playgroundDataCatalog/` shape | matches the in-repo app-local pattern |
| package-plugin reference shape | `packages/plugin-cli/templates/plugin/README.md` | canonical template layout |

## Default rule

For a real shipped child app, default to a packaged app/internal plugin.
For fast local experimentation, default to a runtime/generated plugin.

## Runtime/generated plugin path

Use:

```bash
boring-ui-plugin scaffold <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
boring-ui-plugin verify <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

Canonical references:

- `packages/pi/skills/boring-plugin-authoring/SKILL.md`
- `packages/workspace/docs/PLUGIN_STRUCTURE.md`
- `packages/workspace/docs/PLUGIN_SYSTEM.md`

This path creates:

```txt
.pi/extensions/<name>/
```

Best for:

- local agent-authored plugins
- hot reload with `/reload`
- front/Pi resources
- non-trusted experimentation

Do **not** use this path when the app needs trusted backend routes as part of the shipped app package.

## App/internal plugin paths

### Repo-level packaged plugin

Use the plugin CLI package-template command:

```bash
boring-ui-plugin create <name> --path plugins
```

### App-local direct-source plugin

Use the in-repo direct-source pattern instead of the built CLI template:

- `apps/workspace-playground/src/plugins/playgroundDataCatalog/`

Canonical references:

- `packages/cli/README.md`
- `packages/plugin-cli/templates/plugin/README.md`
- `packages/workspace/docs/PLUGIN_STRUCTURE.md`
- `packages/core/docs/PLUGIN_INTEGRATION.md`
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/package.json`

Typical homes:

```txt
plugins/<name>/
apps/<app>/src/plugins/<name>/
```

Best for:

- shipped app features
- trusted server routes/tools
- app-owned domain logic
- statically composed production plugins

## Quick decision rule

If the user says "ship this with the app", choose packaged plugin.
If the user says "prototype this in the workspace", choose runtime/generated plugin.
