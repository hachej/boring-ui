# Plugin Structure

Canonical quick reference for boring-ui plugin layouts. For the full current
contract, see [`PLUGIN_SYSTEM.md`](./PLUGIN_SYSTEM.md). For the historical
hosted/runtime architecture exploration, see the archived repo-level
[`docs/plans/archive/runtime-plugin-v2-hot-reload-plan.md`](../../../docs/plans/archive/runtime-plugin-v2-hot-reload-plan.md).

## Generated/runtime plugin

Use the workspace-local CLI from inside the agent/runtime workspace:

```bash
boring-ui-plugin scaffold <name>
boring-ui-plugin verify <name>
```

Default shape:

```txt
.pi/extensions/<name>/
  package.json          # boring.front and/or pi.*; no boring.server by default
  front/index.tsx       # default-export definePlugin({ ... })
  README.md
```

Generated plugins are hot-reloaded with `/reload` for front/Pi resources. They
should stay route-free: no `server/index.ts`, no Fastify routes, and no dynamic
backend registration.

## App/internal publishable package plugin

Run `boring-ui-plugin create <name> --path plugins` for the trusted package
shape composed by an app shell. The command uses
[`packages/plugin-cli/templates/plugin`](../../../packages/plugin-cli/templates/plugin/) as its reference:

```txt
plugins/<name>/
  package.json          # boring.front + optional boring.server
  src/front/index.ts    # definePlugin({ ... })
  src/server/index.ts   # defineServerPlugin({ ... }) when needed
  src/shared/*          # browser-safe shared constants/types
  tsup.config.ts
  vitest.config.ts
```

App/internal plugins may expose boot-time server contributions such as routes,
agent tools, system prompts, provisioning, and Pi resources. Server changes
require restarting the workspace process.

## Import boundaries

- Front plugin code imports from `@hachej/boring-workspace/plugin`.
- Trusted server plugin code imports from `@hachej/boring-workspace/server`.
- App shells use `@hachej/boring-workspace/app/front` and
  `@hachej/boring-workspace/app/server`.
- Runtime/generated plugins should avoid broad host/workspace internals and use
  documented primitives only.
