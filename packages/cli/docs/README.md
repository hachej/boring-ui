# boring-ui CLI — internal docs

The `@hachej/boring-ui-cli` package is the zero-config entry point and local
hub for the boring-ui stack. It boots a Fastify server that serves the prebuilt
React/Vite single-page app plus the agent and workspace API routes, pointed at
a real folder on disk. No database, no auth service — workspace state lives on
the filesystem and provider credentials live in Pi's auth store.

For user-facing commands and flags, see the package [README](../README.md).
This document covers how the CLI works internally.

## Entry point and dispatch

- `src/index.ts` — `bin` target. Resolves the bundled `public/` dir and calls
  `runCli`.
- `src/server/cli.ts` — `runCli` parses argv (`node:util` `parseArgs`,
  non-strict). Dispatch order:
  1. `plugin` → dynamically imports `@hachej/boring-ui-plugin-cli` and forwards
     the remaining argv to `runBoringUiPluginCli`.
  2. `agent validate <dir>` / `agent dev <dir>` → thin dispatch into the
     authored-agent command modules (`agentValidateCommand.ts`,
     `agentDevCommand.ts`) with Agent/workspace dependencies imported lazily;
     `validate` emits the A1 validation envelope and `dev` materializes the
     authored directory into the existing local Workspace+Agent lifecycle.
  3. `workspaces [add|list|remove|rename]` → `handleWorkspacesCommand`
     (registry CRUD), or starts **workspaces mode** when no subcommand.
  4. otherwise → **folder mode** (`startFolderMode`).

`pi-coding-agent` is imported lazily (only `checkAuth` in folder mode) to keep
help and registry commands lightweight.

## Two server modes

Both are built in `src/server/modeApps.ts`.

- **Folder mode** — `createFolderModeApp({ workspaceRoot, mode })`. One folder
  = one workspace (`workspaceId: "default"`). Wraps
  `@hachej/boring-workspace/app/server`'s `createWorkspaceAgentServer`.
- **Workspaces mode** — `createWorkspacesModeApp({ mode })`. A multi-workspace
  hub. Builds a bare Fastify app and registers the workspace runtime backend
  gateway, agent routes, and UI routes. Each workspace is resolved per-request
  from a workspace id (URL `/workspace/:id`, header), lazily booting its
  runtime. The browser switches workspaces via `WorkspaceSwitcherControl`.

### Runtime modes (sandbox)

`MODE_MAP` maps the CLI `--mode` value to the agent runtime mode:

| `--mode` | runtime mode | meaning |
|----------|--------------|---------|
| `local` (default) | `direct` | no sandbox, full network — boots instantly |
| `local-sandbox` | `local` | bwrap-isolated, no network (Linux + bubblewrap only) |

Default is `local`/`direct` on every platform for folder/workspaces mode;
bwrap isolation is opt-in because per-workspace first-boot provisioning is
slow.

Authored-agent `agent dev` is intentionally stricter: it defaults to
`local-sandbox`, rejects the top-level `--mode` flag, and allows direct host
execution only with `--allow-direct`. It uses `BORING_AGENT_WORKSPACE_ROOT` (or
cwd when unset) as the explicit local workspace root. Bare `agent dev`, missing
prompt text, or supplying both `--prompt` and `--serve` fail with
`AUTHORED_AGENT_DEV_USAGE_INVALID` before workspace/runtime side effects.

## Local workspace registry

`src/server/localWorkspaces.ts` implements `createLocalWorkspaceRegistry`. It is
a YAML file (default `~/.boring-ui/workspaces.yaml`, overridable via
`BORING_UI_WORKSPACES_PATH`), parsed/serialized by hand (no YAML dependency).
Each entry has a stable id (`<slug-of-basename>-<sha1[:8] of path>`), name,
path, and timestamps; `available` is computed at read time by stat-ing the
path. Writes are atomic (temp file + rename). This is the source of truth for
workspaces mode and the `boring-ui workspaces` subcommands.

## Plugin discovery

`src/server/pluginDiscovery.ts` resolves the plugin source roots the workspace
asset manager scans, in this order:

1. **CLI-bundled defaults** — packages shipped inside the CLI's own
   `node_modules` (currently `@hachej/boring-ask-user` and
   `@hachej/boring-diagram`), resolved from the CLI package root regardless
   of cwd. The front side mirrors these as static imports in `src/front/App.tsx`
   — keep the two lists in sync.
2. **Global Pi roots** — `~/.pi/agent/extensions/*`, plus `git`/`npm` source
   dirs under `~/.pi/agent`.
3. **Workspace-local Pi roots** — `<workspace>/.pi/extensions/*`, plus
   `git`/`npm` dirs under `<workspace>/.pi`.
4. Package sources recorded by the plugin-cli source manifests
   (`readPluginSourceRecords`).

These Pi-shaped roots (global `~/.pi/agent/extensions`, workspace
`<workspace>/.pi/extensions`) are the canonical, current plugin locations — the
CLI deliberately does **not** invent a separate `~/.boring-ui/` plugin root.
`~/.boring-ui/` is reserved for CLI app state (the workspaces registry);
`<workspace>/.boring-agent/` is runtime-owned internal state.

When folder/`local`-style modes run, the CLI sets
`BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS=1` so the plugin-cli treats
`<workspace>/.pi/extensions` as a live scaffold/reload target (see
`provisionCliWorkspaceRuntime` in `modeApps.ts`).

## Runtime plugin front loading

The CLI loads plugin browser code from trusted local Pi extension roots through
a CLI-owned runtime module host (`src/server/pluginFrontRuntime.ts`, browser
side in `src/front/runtimePluginDiagnostics.tsx`). Each mode exposes
diagnostics endpoints used by `boring-ui-plugin test` and the in-UI diagnostics:

- `GET  /api/v1/runtime-plugin-diagnostics`
- `POST /api/v1/agent-plugins/:id/front-error`
- `GET  /api/v1/workspace/meta` (advertises
  `runtimePluginFrontLoadingEnabled`, trust labels, diagnostics flags)

Front import failures (`source: plugin-front` / `PLUGIN_FRONT_ERROR`) surface
only in these diagnostics, not in the `/reload` banner — relevant when iterating
on a plugin.

## Static asset serving

`registerStatic` lives in `src/server/staticAssets.ts`. It checks that
`public/index.html` exists (else it errors and tells you to run
`pnpm build:full`), registers `@fastify/compress` (br/gzip) before
`@fastify/static`, sets immutable cache headers on content-hashed `/assets/*`
and `max-age=0` elsewhere, and falls back to `index.html` for non-`/api/`
routes (SPA routing). `cli.ts` imports it for folder/workspaces startup and
re-exports it from the server package subpath for compatibility with existing
embedding/tests.

## Authored-agent commands

A1 commands are additive and not production deployment:

- `agent validate <dir> [--json]` compiles `agent.json` + `instructions.md`,
  validates the Decision 26 agent type ID grammar, and reports declared tool,
  capability, skill, and MCP refs. It does not resolve refs, materialize
  runtime behavior, print prompt contents, or advertise compiler digests as
  runtime provenance.
- `agent dev <dir> --prompt <text>` performs validate → materialize → existing
  Workspace+Agent one-shot dispatch, then closes the app once.
- `agent dev <dir> --serve` performs validate → materialize → server startup
  without an automatic turn.
- Tool refs resolve only through an explicit trusted per-agent CLI catalog
  adapter. Capability, skill, and MCP refs are rejected as unsupported in v1
  materialization.
- The command creates no `AgentDeployment`, deployment/default resolver,
  composition/resolved digest, AgentHost/request-scope authority, domain route,
  or second Workspace/Sandbox composer.

## A1 packed conformance smoke

After building Agent and CLI, this repository includes a reproducible pack
consumer smoke:

```bash
BORING_A1_PACK_TMPDIR=$HOME/.cache/boring-a1-pack-smoke node scripts/a1-pack-consumer-smoke.mjs
```

It packs `@hachej/boring-agent`, `@hachej/boring-workspace` (needed by CLI dev),
and `@hachej/boring-ui-cli`, installs them into a temporary consumer, proves the
server value import positive, proves the server `MaterializedAgentSourceV1` type
import with `tsc`, and proves shared/front behavior/type imports fail with
`tsc`. It then runs installed-bin `boring-ui agent validate` against the
packaged example and installed-bin `boring-ui agent dev --prompt` as a
fail-closed smoke for the missing trusted catalog. The smoke removes only its
own generated work root in a `finally` block after asserting the path is under
the configured temp base and has the expected generated prefix. Set
`BORING_A1_PACK_RETAIN_DEBUG=1` to keep that one generated work root for
debugging. Set `BORING_A1_PACK_SELF_TEST_SETUP_FAILURE=1` to intentionally fail
immediately after `mkdtempSync` and prove the same cleanup path removes the
exact generated root. The full dev one-shot success path is covered by the CLI
integration harness because the published bin intentionally has no ambient test
catalog or fake model provider.

## Build

- `build` (`tsup`) — server/bin bundles to `dist/`.
- `build:front` (`vite build`) — the SPA.
- `build:full` (`scripts/build-full.mjs`) — front + server, required before
  running from source. The published package ships prebuilt `dist/` + `public/`.

## Key abstractions

- `src/server/modeApps.ts` owns `createFolderModeApp`,
  `createWorkspacesModeApp`, and `provisionCliWorkspaceRuntime` — the Fastify
  app builders and runtime wiring used by CLI modes.
- `src/server/staticAssets.ts` owns `registerStatic`.
- `createLocalWorkspaceRegistry` — the YAML-backed workspace store.
- `resolveCliBoringPluginDirs` / `resolveCliDefaultPluginPackagePaths` — plugin
  root resolution.

## Supported server API

The supported package subpath for embedding is `@hachej/boring-ui-cli/server`.
It exposes:

- `runCli(options)`
- `RunCliOptions`
- `RunCliAgentDevOptions`
- `AgentDevTrustedToolCatalogAdapter`
- compatibility exports that predate the server subpath narrowing:
  `createBoringUiCliRuntimePlugin`, `createFolderModeApp`,
  `createWorkspacesModeApp`, `provisionCliWorkspaceRuntime`,
  `resolveBoringUiPluginCliPackageRoot`, `resolveBoringUiCliPackageRoot`, and
  `registerStatic`

It does not publicly re-export internal authored-agent dispatchers such as
`handleAgentCommand`.

## Notable decisions

- **No database.** Workspace state is the filesystem; the registry is a YAML
  file. Provider auth is Pi's `~/.pi/agent/auth.json`, not a CLI flag.
- **Direct mode by default** for ordinary folder/workspaces startup; authored-agent dev is sandbox-default and direct only with `--allow-direct`.
- **Auth check is skipped in workspaces-mode startup** to avoid blocking the
  event loop on the first workspace open; the browser surfaces provider state
  via the agent models API instead.
- **Pi roots, not a new plugin root.** See plugin discovery above.

## Historical plans

`docs/plans/archive/` holds the original design plans (local workspaces mode,
local plugin roots, native plugin front-loading, ask-user runtime). They are
historical — verify against code before trusting any detail.
