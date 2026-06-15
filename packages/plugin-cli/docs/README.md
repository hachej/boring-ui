# boring-ui plugin CLI — internal docs

`@hachej/boring-ui-plugin-cli` is the plugin authoring toolkit for the boring-ui
workspace runtime. It is a slim, dependency-light package: the `boring-ui-plugin`
binary, a programmatic API, and the canonical plugin templates. The host CLI
(`@hachej/boring-ui-cli`) bundles it and reaches it as `boring-ui plugin …`, and
also imports its source-resolution helpers directly.

For commands and flags, see the package [README](../README.md). This document
covers internals.

## Layout

```
src/
  bin.ts                  #!/usr/bin/env node → runBoringUiPluginCli
  index.ts                argv dispatch + command handlers + public exports
  manifest.ts             package.json plugin manifest shape + validator
  server/
    index.ts              re-exports; status/workspace-root helpers
    createPlugin.ts       create  → copies templates/plugin/ into plugins/<name>/
    scaffoldPlugin.ts     scaffold → writes .pi/extensions/<name>/ from canonical templates
    verifyPlugin.ts       verify  → static manifest + file-existence checks
    testPlugin.ts         test    → self-test against a running workspace server
    pluginSources.ts      install/list/remove + scope-path resolution
templates/
  plugin/                 canonical npm-package plugin (copied by create)
  *-canonical.{ts,tsx,json}  single-file canonical sources (used by scaffold)
```

## Dispatch

`runBoringUiPluginCli(argv)` (`src/index.ts`) filters positionals from flags,
detects `--json`, and routes the first positional to a handler:
`status | create | scaffold | verify | test | install | list | remove`. Unknown
or missing commands print usage. The binary catches errors and exits non-zero.

## Two plugin kinds

- **`create`** (`createPlugin.ts`) — copies `templates/plugin/` into
  `<repo-or-cwd>/plugins/<name>/` (override parent with `--path`). Produces a
  buildable npm package named `@hachej/boring-<name>` with `workspace:*` deps,
  a nested exports map, and `tsup`/`vitest` config. Template placeholders
  (`@hachej/boring-plugin-template`) are rewritten to the package name.
- **`scaffold`** (`scaffoldPlugin.ts`) — writes a hot-reloadable runtime plugin
  into `<workspace>/.pi/extensions/<name>/` from the `*-canonical.*` template
  files. Refuses to run unless workspace-local plugin roots are enabled
  (`workspaceLocalPluginRootsEnabled()`), so it never writes into a runtime that
  won't load it. This is the path agents use from inside the running UI.

## Manifest (`manifest.ts`)

The canonical plugin shape is declared in the plugin's `package.json`:

- **`boring`** — workspace/UI discovery: `front` (browser entry that
  default-exports a `BoringFrontFactory`), `server` (backend entry), and labels.
- **`pi`** — agent/Pi runtime contributions: `extensions`, `skills`, prompt
  fragments, Pi package sources, and slash commands (`name` without leading
  slash + `description`).

`manifest.ts` exports the validator (`isValidBoringPluginId`, manifest
validation result types) that both `verify` and the workspace asset manager run,
so on-disk checks match runtime loading.

## Verify vs. test

- **`verify`** (`verifyPlugin.ts`) is fully static — no jiti, no Vite, no
  running server. It runs the manifest validator plus existence checks for
  `boring.front` / `boring.server` / `pi.extensions`, and reads any
  `.boring-signature.json`. It cannot catch syntax errors in front/Pi modules
  (those need a real `/reload`) nor confirm `boring.server` activation (that
  needs static composition + restart). Emits hints and exits non-zero on errors.
- **`test`** (`testPlugin.ts`) drives a self-test against a *running* workspace
  server. It infers the URL (override `--url`), targets a workspace
  (`x-boring-workspace-id` header) and a panel (`<pluginId>.panel` by default,
  override `--panel-id`), and reports the pane state
  (`ready | loading | error | missing | timeout | no-browser-connected`). This
  is how front-import failures (`PLUGIN_FRONT_ERROR`, source `plugin-front`)
  are caught — they do not appear in the `/reload` banner.

## Plugin sources (`pluginSources.ts`)

`install` / `list` / `remove` manage plugin *source records* in two scopes,
resolved by `resolvePluginSourceScopePaths`:

| scope | base dir | env override |
|-------|----------|--------------|
| `local` (default) | `<workspace>/.pi` | `BORING_AGENT_WORKSPACE_ROOT` for workspace root |
| `global` | `~/.pi/agent` | `BORING_UI_PLUGIN_GLOBAL_ROOT` |

Each scope has `extensions/`, `git/`, `npm/` subdirs and a `settings.json`.
Source kinds are `local` (a path), `git` (URL, optional ref), and `npm` (spec).
Git/npm sources are fetched into the scope's `git`/`npm` dir; dependencies are
**not** installed — the CLI prints hints to run a package manager in the folder.
Because plugins run as trusted local code, install warns to review third-party
sources first.

These helpers are exported via the `./plugin-sources` subpath and consumed by
`@hachej/boring-ui-cli`'s `pluginDiscovery.ts` to build the discovery roots
(global + workspace `.pi/extensions`, plus recorded package sources).

## Notable decisions

- **Static-first verification.** `verify` never executes plugin code; `test`
  covers the dynamic gaps against a live server. Agents are expected to run
  `verify` → `/reload` → `plugin_diagnostics` + `test` in a loop.
- **Pi-shaped roots.** Local = `<workspace>/.pi`, global = `~/.pi/agent` — the
  same roots the agent runtime and host CLI use; no separate boring-ui root.
- **No dependency installs.** Source management never runs a package manager; it
  records/copies sources and tells the user what to run.
- **Slim by design.** Runtime deps are minimal so the host CLI can bundle it
  without bloat.
