---
name: boring-plugin-authoring
description: Create, extend, update, or install boring-ui workspace plugins — authoring new hot-reloadable user plugins and app-default plugins (React panels, file visualizers, surface resolvers, static server integrations, Pi/agent contributions), and installing existing or published plugins from npm/git/local sources. Use when the user asks to build, extend, configure, modify, add, or install a boring-ui plugin.
---

# Boring Plugin Authoring

## Triage — pick the path before doing anything

| Situation | Path |
|---|---|
| User wants to **add a plugin that already exists** (published npm package, git repo, local package) | Install it — do NOT scaffold. See `references/install.md`. |
| User wants a **new plugin** | Author it — scaffold first, then customize (the workflow below). |
| User wants to **extend/compose an existing plugin** in a new one | Author it (scaffold), then compose — see `references/pi-extensions.md`. |

If the new-plugin request is broad or underspecified ("make me a plugin", "build a
dashboard plugin"), ask for the missing product details **before scaffolding or editing**.
Do not silently invent the domain, data source, navigation behavior, or visual direction.
If the `ask_user` tool is installed, prefer it (structured form, with a final free-text
`remarks` `textarea`); otherwise ask in chat plus a final "Anything else / remarks?". Ask
only for decisions that affect implementation: purpose and target user; data source or
sample data; whether it needs a persistent left tab, a slash command, a file
opener/surface resolver, or some combination; main panels/views; visual tone; must-have
interactions or constraints.

## Routing table — read the reference BEFORE writing code

| Task type | Read first |
|---|---|
| Install an existing/published plugin | `references/install.md` |
| `definePlugin` surface, `package.json` shape, plugin-local deps, canonical front, design defaults | `references/api.md` |
| Slash commands / Ctrl+K commands that open a panel | `references/patterns-commands.md` |
| Clickable links that open files/surfaces/panels (`WorkspaceLink`) | `references/patterns-links.md` |
| Choosing a nav surface (panel vs left tab vs resolver); file visualizers/readers | `references/patterns-visualizers.md` |
| Hot-reloadable agent tools (Pi extensions); extending/composing an existing plugin | `references/pi-extensions.md` |
| Static boot-time server routes (`boring.server`); app-default package plugins | `references/server.md` |

## Authoring workflow — always scaffold first

Don't write plugin files from scratch. The CLI scaffold produces a known-correct
`package.json` + `front/index.tsx` skeleton under `.pi/extensions/<name>/`.
**Run it, then read the generated files, then customize.** This guarantees the file
layout, API surface (`definePlugin`, `registerPanel`, etc.), and import paths are correct
— the parts agents most often invent or get wrong. **Do NOT rewrite scaffolded files from
scratch** — edit them in place.

The workspace agent puts the provisioned Node bin directory on `PATH`, provides the
`boring-ui-plugin` command, and exports `BORING_AGENT_WORKSPACE_ROOT`. Use
`$BORING_AGENT_WORKSPACE_ROOT` instead of host paths such as `/home/...`; in sandboxed
modes the runtime-visible workspace is `/workspace`. Outside the agent workspace without
that binary, use `npx @hachej/boring-ui-plugin-cli scaffold <kebab-name> <workspace-root>`.

**Default to workspace-local.** Never ask the user to choose. Always scaffold into
`.pi/extensions/<name>/`; only use `~/.pi/agent/extensions/` when the user explicitly asks
for a global plugin. Hot-reloadable agent behavior belongs in
`pi.extensions` / `pi.skills` / `pi.systemPrompt`. The scaffold does not create
`server/index.ts`: `boring.server` is advanced boot-time/static integration, not activated
by `/reload` for `.pi/extensions` user plugins (see `references/server.md`).

Steps:

1. Run `boring-ui-plugin status --json` via the bash tool and **stop** if
   `workspaceLocalPluginRoots` is `false` — this runtime does not support local plugin
   roots; explain that and do not scaffold a hot-reloadable plugin.
2. Run the scaffold via the bash tool. Always target the current workspace root; the
   second arg prevents writing into a parent repo if your shell cwd drifts:
   ```sh
   boring-ui-plugin scaffold <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
   ```
   If the scaffold says the plugin already exists, read the existing files directly and
   skip this step. The scaffold writes:
   - `.pi/extensions/<name>/package.json` — manifest with `boring.front` and `pi.systemPrompt`
   - `.pi/extensions/<name>/front/index.tsx` — `definePlugin` config registering one panel + command + left tab
   - `.pi/extensions/<name>/.gitignore` — ignores runtime verifier/signature sidecars
3. Read the generated files with the read tool.
4. Edit them in place with the edit tool — do **NOT** rewrite from scratch. (Read the
   relevant routing-table reference before writing code.)
5. If you add package dependencies, add them to this plugin's own `package.json` and
   install inside the plugin directory (e.g.
   `cd "$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<kebab-name>" && npm install <dep>`) —
   never from the workspace root.
6. Run `boring-ui-plugin verify <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"`. If it reports
   missing dependencies, install them in `.pi/extensions/<kebab-name>/` and re-run until `OK`.
7. If the workspace UI is open, run `boring-ui-plugin test <kebab-name>` (add
   `--workspace <id>` in workspaces mode and `--panel-id <id>` if the main panel is not
   `<kebab-name>.panel`). Fix render failures and re-run until `OK`. If it reports
   `NO_BROWSER_CONNECTED`, ask the user to open the workspace UI and rerun.
8. Tell the user to run `/reload` for front/Pi asset changes. If you added `boring.server`,
   `/reload` is not enough: the workspace process must be statically composed with that
   package and restarted.

### Mandatory verification loop (after every `/reload`)

`/reload` is driven by the user, not the agent and not Vite HMR. After **each** `/reload`:

1. Call the `plugin_diagnostics` tool to check for plugin/skill load errors. `/reload`
   surfaces silent load failures (bad `SKILL.md`, extension import errors, missing
   `pi.skills`/`pi.extensions` paths) there.
2. **Also re-run `boring-ui-plugin test <name>`.** Front import/render failures do not
   always show up the same way — they surface only as a diagnostic with source
   `"plugin-front"` / a `PLUGIN_FRONT_ERROR`. A clean `plugin_diagnostics` alone does not
   prove the front loaded.
3. Read the reported errors, fix them, ask the user to `/reload` again, and **iterate
   until both `plugin_diagnostics` and `boring-ui-plugin test` come back clean.**

If the user reports a page reload, `Invalid hook call`, or `resolveDispatcher() is null`
after editing a plugin, suspect host Vite config first: `.pi/extensions` files must be
excluded from React Refresh and ignored by Vite HMR so the `/reload` bridge owns runtime
plugin updates.

## File layout (do not put files elsewhere)

User-added plugins live under `<workspace>/.pi/extensions/<name>/`. Discovery roots:

- Workspace-local boring/Pi plugins: `$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<name>/`
- Global Pi plugins: `~/.pi/agent/extensions/` (only when explicitly requested)

```
.pi/extensions/<name>/
├── package.json          # manifest (boring.front, pi.systemPrompt, pi.extensions)
├── front/index.tsx       # front factory (boring.front)
└── agent/index.ts        # OPTIONAL — Pi extension, declared in pi.extensions
```

For `.pi/extensions/<name>/` plugins (the hot-reload path this skill teaches), do **NOT**:

- Put files at the package root (`index.ts`, `index.js`, `index.tsx` at the same level as
  `package.json`).
- Create `src/`, `dist/`, `lib/`, `build/` subdirectories — there is no compile step; the
  dev server transforms `.tsx` on the fly via Vite.
- Run `npm init`, `tsc`, or any build command inside the plugin dir. The scaffold's
  `package.json` already has `private: true` and no scripts.
- Run dependency installs from the workspace root. If a plugin needs a package, install it
  inside `.pi/extensions/<name>/` so the dependency is plugin-local.
- Create a `tsconfig.json` inside the plugin dir.
- Create a `README.md` unless the user asks for one.

> These rules apply to the hot-reload layout under `.pi/extensions/<name>/`. Full
> npm-package plugins (for publishing — e.g. `@hachej/boring-ask-user`) live under
> `plugins/<name>/` and DO use `src/` + `tsup` + `dist/`; repo contributors use
> `boring-ui-plugin create <name> --path plugins` instead of `scaffold`. Author/test
> global plugins workspace-local first. Only use `.pi/extensions` when
> `boring-ui-plugin status --json` reports `workspaceLocalPluginRoots: true`.

## Minimal canonical `definePlugin`

```tsx
import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from my-plugin</div>
}

export default definePlugin({
  id: "my-plugin",            // contribution namespace; matching package name is recommended
  label: "My Plugin",
  panels: [
    { id: "my-plugin.panel", label: "My Plugin", component: MyPane },
  ],
  commands: [
    { id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" },
  ],
  // Optional only for persistent sidebar navigation:
  // leftTabs: [{ id: "my-plugin.tab", title: "My Plugin", panelId: "my-plugin.panel" }],
})
```

Do NOT use `defineFrontPlugin` or `createPlugin` (they don't exist). For the full
`definePlugin` field table, `package.json` shape, plugin-local deps, and design-system
defaults, read `references/api.md`.

## More detail

When the routing-table references don't cover your case, read:

- [Plugin authoring reference](../../references/workspace/plugins.md) — full package shape, conventions, hot-reload internals.
- [Panel/front API reference](../../references/workspace/panels.md) — `PaneProps`, parameter updates, left tabs, layout API.
- [Agent/UI bridge reference](../../references/workspace/bridge.md) — UI bridge commands and state.
