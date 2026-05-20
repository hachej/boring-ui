# Hot-reloadable user plugin template (no in-repo files)

There's nothing to copy here. Hot-reloadable user plugins live under
`<workspace>/.pi/extensions/<name>/` (not under `plugins/*`). Use the CLI:

```sh
# From inside the workspace root:
npx @hachej/boring-ui-cli scaffold-plugin <kebab-name>

# Or, if you have it installed locally:
boring-ui scaffold-plugin <kebab-name>
```

The default scaffold writes front/Pi metadata only:

```
.pi/extensions/<name>/
├── .gitignore
├── package.json        # boring.front + pi.systemPrompt
└── front/index.tsx     # definePlugin({ id, label, panels, commands, ... })
```

It does **not** create `server/index.ts` or `package.json#boring.server`.
Hot-reloadable agent behavior belongs in Pi resources (`pi.extensions`,
`pi.skills`, `pi.prompts`, `pi.systemPrompt`). Server plugin integration via
`boring.server` is static/boot-time only: add it deliberately, compose the
package from the app server, and restart the workspace process after edits.

After editing, run `boring-ui verify-plugin` to validate, then ask the user to
run `/reload` (which triggers the agent reload path for front/Pi resources).

## Why no in-repo files

The canonical scaffold source files (`front-canonical.tsx` and
`package-canonical.json`) live in the CLI package at `packages/cli/templates/`.
That's the single source of truth — the scaffold CLI reads from there with
substitution. Keeping a parallel copy in `plugins/_template-hot-reload/` would
just create drift.

## When to use which template

| Want to … | Use |
|---|---|
| Build a plugin a user can install locally without a build step | `boring-ui scaffold-plugin` (this README) |
| Build a plugin you want to publish as an npm package (consumed via `defaultPluginPackages`) | `plugins/_template-full/` |

See `packages/pi/skills/boring-plugin-authoring/SKILL.md` (the "Choosing a
layout" section) for the full comparison.
