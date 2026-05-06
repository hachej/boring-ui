# Plugin Agent Layer Plan

Last updated: 2026-05-06
Status: **In progress** — macro plugin migrated; dataCatalogPlugin agent layer extracted; filesystemPlugin + explorerPlugin confirmed front-only

## Problem

The `server/` layer currently conflates two distinct concerns:

1. **Trusted host process code** — Node.js routes, database clients, config loaders.
   These run with full server privileges and should be in `server/`.

2. **Pi/sandbox runtime assets** — Agent tools, Python SDK packages, executable
   transforms, workspace seed templates, agent skills. These run inside the pi
   sandbox (isolated agent process) and have no business being stored under
   `server/`.

Example of the problem in `apps/boring-macro-v2/src/plugins/macro/server/` (before migration):

```
server/
  tools/macroTools.ts          ← agent runtime (not a server route)
  sdk/                         ← Python package installed into sandbox
  transforms/                  ← executable Python files run by agent
  workspace-template/          ← workspace seed files, agent-accessible
  config.ts                    ← actual server config (stays in server/)
  routes/macro.ts              ← actual server routes (stays in server/)
  services/clickhouse.ts       ← actual server services (stays in server/)
```

The mixing obscures the trust boundary and makes it hard to reason about what
has network/DB access vs what runs in the sandboxed agent.

## New 4-Layer Plugin Structure

```
plugin/
  front/            — React UI: panels, catalogs, bindings, surfaceResolver
  server/           — Trusted Node.js host ONLY: routes, DB clients, config
  agent/
    tools/          — Agent tool implementations (AgentTool[])
    sdk/            — Python SDK package installed into sandbox
    transforms/     — Executable/user-editable Python transforms
    workspace-template/ — Scaffold copied into workspaces
    skills/         — Agent skill .md files
    prompts/        — Pi prompt templates
  shared/           — Platform-neutral types, constants (no Node or React)
```

`server/` remains the integration point: `server/index.ts` composes the plugin
and references `agent/` assets via relative `import.meta.url` URLs passed to
`provisioning`. Agent tool implementations are imported directly into the server
plugin factory (since the server runs the agent tool executor). The separation
is structural/ownership clarity, not a runtime boundary for tool registration.

## Migration Steps

### Per-plugin checklist

- [ ] Move `server/tools/*.ts` → `agent/tools/`
- [ ] Move `server/sdk/` → `agent/sdk/`
- [ ] Move `server/transforms/` → `agent/transforms/`
- [ ] Move `server/workspace-template/` → `agent/workspace-template/`
- [ ] Move `server/skills/` → `agent/skills/` (if present)
- [ ] Update `server/index.ts` imports: `./tools/X` → `../agent/tools/X`
- [ ] Update `server/index.ts` `provisioning` URLs: `./sdk/...` → `../agent/sdk/...`
- [ ] Update any test files that imported from the old paths
- [ ] Update `.gitignore` artifact patterns (sdk/pycache etc.) to new paths
- [ ] Add `agent/` placeholders to plugin template

### Plugins

#### `apps/boring-macro-v2/src/plugins/macro` — DONE

Moved:
- `server/tools/macroTools.ts` → `agent/tools/macroTools.ts`
- `server/sdk/` → `agent/sdk/`
- `server/transforms/` → `agent/transforms/`
- `server/workspace-template/` → `agent/workspace-template/`

Updated:
- `server/index.ts` — import path and provisioning URLs updated
- `server/__tests__/macroTools.test.ts` — import path updated
- `agent/tools/macroTools.ts` — internal imports updated (config, services)
- `.gitignore` — artifact patterns updated to `agent/` paths; root-level junk
  dirs (`macro/sdk/`, `macro/transforms/`) noted and ignored

#### `packages/workspace/src/plugins/filesystemPlugin` — SKIP

Front-only plugin (no `server/` layer). No agent assets to migrate.

#### `packages/workspace/src/plugins/dataCatalogPlugin` — DONE

`server/index.ts` was a single file that conflated agent-side logic (tool factory,
skill prompt builder, search formatter) with the server plugin composition call
(`defineServerPlugin`). Split into two files:

- `agent/index.ts` — pure agent assets: `createDataCatalogAgentTool`,
  `createDataCatalogSkillPrompt`, `formatDataCatalogSearchResult`, and
  their option types. Zero dependencies on `server/plugins/bootstrapServer`.
- `server/index.ts` — thin composition layer: imports from `../agent`, wraps
  with `defineServerPlugin`, re-exports everything for backwards compatibility.
  Also introduces `DataCatalogAgentPluginOptions` as the canonical name; the old
  `DataCatalogServerPluginOptions` is aliased with `@deprecated` JSDoc.

The public workspace `server/index.ts` and the existing test file
(`server/__tests__/dataCatalogPlugin.test.ts`) required no import changes —
both import from the old path which still re-exports all the same symbols.

#### `packages/workspace/src/plugins/explorerPlugin` — SKIP

Front-only plugin. No `server/` layer. No agent assets to migrate.

## Invariant Scanner Updates

`packages/workspace/scripts/check-plugin-invariants.mjs` updated to:

1. **Reject** `server/sdk`, `server/transforms`, `server/workspace-template`
   paths inside plugin directories (they must live under `agent/`).
2. **Allow** `agent/` as a valid plugin layer (no cross-layer import violations
   flagged for it, and no "must live under front/server/shared/" error).

## Status Tracking

| Plugin | Moved | Imports Fixed | .gitignore | Done |
|--------|-------|---------------|------------|------|
| macro  |  yes  |      yes      |    yes     |  yes |
| filesystemPlugin | n/a — front-only | n/a | n/a | n/a |
| dataCatalogPlugin | yes (agent/index.ts) | yes (server re-exports) | n/a | yes |
| explorerPlugin | n/a — front-only | n/a | n/a | n/a |

## Open Questions

- Should `agent/tools/macroTools.ts` import from `../../server/config` (current
  approach) or should `ClickHouseConfig` be extracted to `shared/`? The current
  approach is pragmatic — tools are imported by the server plugin factory anyway,
  so the cross-reference is fine at runtime. Extracting to `shared/` would be
  cleaner long-term.

- Should the invariant scanner reject `agent/` → `server/` imports? Currently
  `agent/tools/macroTools.ts` imports `ClickHouseConfig` from `../../server/config`.
  This is allowed for now since the server plugin factory is the one calling
  into agent tools. If agent code should be truly isolated, move the config type
  to `shared/`.
