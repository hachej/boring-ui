# Plugin paths

## When to use

Use this when the child app needs custom panels, tools, tabs, catalogs, surface resolvers, providers, or trusted plugin-owned server logic.

## Default recommendation

For a shipped child app, default to a packaged app/internal plugin.
For fast local iteration, default to a runtime/generated plugin.

## Decision table

| Want | Use | How to start |
|---|---|---|
| fast local runtime plugin with `/reload` | runtime/generated plugin | `boring-ui scaffold-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"` |
| validate runtime/generated plugin | runtime/generated plugin | `boring-ui verify-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"` |
| shipped trusted repo-level plugin | app/internal packaged plugin | `boring-ui plugin create <name> --path plugins` |
| shipped trusted app-local plugin | app/internal plugin | copy the app-local shape from `apps/workspace-playground/src/plugins/playgroundDataCatalog/` |

## Layout rule

- `.pi/extensions/<name>/` → runtime/generated plugin
- `plugins/<name>/` → packaged repo-level plugin built from the CLI template
- `apps/<app>/src/plugins/<name>/` → app-local direct-source plugin shaped like `apps/workspace-playground/src/plugins/playgroundDataCatalog/`

## Traps to avoid

- don't use `.pi/extensions` as the default shipped-app path
- don't use `boring-ui plugin create ...` as the app-local `src/plugins/*` path without first verifying the generated shape matches the app-local direct-source pattern
- don't invent a third plugin layout
- don't choose packaged plugin flow when the user only wants fast workspace iteration

## Deeper docs

- `../manuals/plugins/PLUGIN_PATHS.md`
- `packages/pi/skills/boring-plugin-authoring/SKILL.md`
- `packages/cli/templates/plugin/README.md`
- `packages/cli/README.md`
