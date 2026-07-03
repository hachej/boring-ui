# @hachej/boring-ui-plugin-cli

Plugin authoring CLI for the boring-ui workspace runtime. The binary is
`boring-ui-plugin`; it is also bundled into `@hachej/boring-ui-cli` and reached
as `boring-ui plugin <subcommand>`.

It scaffolds, verifies, tests, and manages boring-ui plugins, and exports the
plugin-source resolution helpers the CLI uses to discover plugins.

## Two kinds of plugin

| | `create` | `scaffold` |
|--|----------|------------|
| Output | npm-package plugin under `plugins/<name>/` (copied from `templates/plugin/`) | workspace runtime plugin under `<workspace>/.pi/extensions/<name>/` |
| Build | has a build step (`tsup`), `workspace:*` deps | no build step, hot-reloadable via `/reload` |
| Use for | app/internal publishable plugins | per-workspace plugins authored from inside the running UI |

## Commands

```
boring-ui-plugin status [--json]
boring-ui-plugin create <name> [--path <dir>]
boring-ui-plugin scaffold <name> [workspace]
boring-ui-plugin verify [name] [workspace]
boring-ui-plugin test <name> [--url <url>] [--workspace <id>] [--panel-id <id>] [--timeout-ms <ms>] [--json]
boring-ui-plugin install [-l|--local|--global] [--workspace <dir>] <source>
boring-ui-plugin list   [--local|--global|--all] [--workspace <dir>] [--json]
boring-ui-plugin remove [-l|--local|--global] [--workspace <dir>] <id-or-source>
```

- **status** — reports whether workspace-local plugin roots are enabled (driven
  by `BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS`) and the resolved
  `.pi/extensions` dir.
- **verify** — validates plugin manifests on disk *without* a running server
  (manifest validity + `boring.front` / `boring.server` / `pi.extensions` file
  existence). It does not execute plugin code, so syntax errors only surface on
  a real `/reload`. Prints hints for known errors and exits non-zero on failure.
- **test** — drives a self-test against a running workspace server (default URL
  inferred, override with `--url`) to catch panel render / front-import
  failures that don't appear in the `/reload` banner.
- **install / list / remove** — manage plugin *sources* in two scopes: `local`
  (`<workspace>/.pi`, default) and `global` (`~/.pi/agent`). Sources can be a
  local path, a git URL, or an npm spec. Dependencies are **not** installed for
  you — run your package manager in the plugin folder, then `/reload` in the UI.

Run `boring-ui-plugin` with no command for usage.

## Plugin manifest

Plugins are declared in `package.json` via two fields (`src/manifest.ts`):

- `boring` — workspace/UI discovery: `front` (browser entry default-exporting a
  `BoringFrontFactory`), `server` (backend entry), labels.
- `pi` — agent/Pi runtime contributions: `extensions`, `skills`, prompt
  fragments, Pi packages, and slash commands.

## Programmatic API

The package exports its building blocks for embedding hosts (e.g. the CLI):
`runBoringUiPluginCli`, `createPlugin`, `scaffoldPlugin`, `verifyPlugin`,
`runPluginSelfTest`, `installPluginSource` / `listPluginSources` /
`removePluginSource`, and source-scope helpers
(`resolvePluginSourceScopePaths`, `readPluginSourceRecords`) via the
`./plugin-sources` subpath. See `src/index.ts` for the full surface.

## Templates

`templates/plugin/` is the canonical npm-package plugin shape copied by
`create`; its [README](./templates/plugin/README.md) documents the front /
server / shared layout and invariants. `templates/*-canonical.*` are the
single-file canonical sources used by `scaffold`.

## Docs

- [`docs/README.md`](./docs/README.md) — architecture and internals.

## License

MIT
