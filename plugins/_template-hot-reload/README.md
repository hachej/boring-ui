# Hot-reloadable user plugin template (no in-repo files)

There's nothing to copy here. Hot-reloadable user plugins live under
`<workspace>/.pi/extensions/<name>/` (not under `plugins/*`). Use the CLI:

```sh
# From inside the workspace root:
npx @hachej/boring-ui-cli scaffold-plugin <kebab-name>

# Or, if you have it installed locally:
boring-ui scaffold-plugin <kebab-name>
```

The scaffold writes three files into `<workspace>/.pi/extensions/<name>/`:

```
.pi/extensions/<name>/
├── package.json        # boring.front + boring.server + pi.systemPrompt
├── front/index.tsx     # definePlugin({ id, label, panels, commands, ... })
└── server/index.ts     # defineServerPlugin({ id, agentTools, systemPrompt })
                        #   — front-only plugins delete this AND the
                        #     `boring.server` line in package.json
```

After editing, bash `boring-ui verify-plugin` to validate, then ask the
user to run `/reload` (which triggers `POST /api/v1/agent/reload`).

## Why no in-repo files

The canonical source files (`front-canonical.tsx`, `server-canonical.ts`,
`package-canonical.json`) live in the `@hachej/boring-pi` package at
`packages/pi/references/workspace/templates/`. That's the single source
of truth — the scaffold CLI reads from there with substitution. Keeping
a parallel copy in `plugins/_template-hot-reload/` would just create
drift.

## When to use which template

| Want to … | Use |
|---|---|
| Build a plugin a user can install locally without a build step | `boring-ui scaffold-plugin` (this README) |
| Build a plugin you want to publish as an npm package (consumed via `defaultPluginPackages`) | `plugins/_template-full/` |

See `packages/pi/skills/boring-plugin-authoring/SKILL.md` (the "Choosing
a layout" section) for the full comparison.
