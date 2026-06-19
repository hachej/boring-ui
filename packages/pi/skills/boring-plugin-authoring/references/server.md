# Static server integration & app-default plugins

## Advanced static server integration (not hot-reloadable for .pi/extensions)

`boring.server: "server/index.ts"` is only for workspace server integrations
that the host composes at boot (for example through `defaultPluginPackages` or
explicit server plugins) and activates by restarting the process. `boring-ui-plugin verify`
checks that the declared file is safe and present, but `/reload`
does **not** import/register `.pi/extensions` server routes or agent tools.

Only use this path when the user/host explicitly wants boot-time server routes or
static `agentTools` and can restart:

```ts
// server/index.ts — static WorkspaceServerPlugin factory
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "my-plugin",
    routes: async (app) => {
      app.get("/my-plugin/status", async () => ({ ok: true, root: ctx.workspaceRoot }))
    },
  })
}
```

## App-default plugins (apps ship with these)

For plugins an app installs as npm deps (`@hachej/boring-ask-user` etc.),
declare in the workspace boot:

```ts
await createWorkspaceAgentServer({
  workspaceRoot,
  defaultPluginPackages: ["@hachej/boring-ask-user"],
})
```

The app's front-end (`apps/<app>/src/front/App.tsx`) usually does **not** also
list these in `WorkspaceProvider.plugins` — panel/command/catalog package fronts
arrive via SSE like `.pi/extensions/<name>/` plugin fronts. Exception: plugins
that register `providers` or `bindings` need static front composition for now
(import the plugin's front export and pass it in `plugins={[...]}`) because
dynamic provider/binding hot-load is intentionally unsupported. Server entries
from package plugins are boot-time/static: changing `boring.server` code requires
restarting the workspace process.
