# Workspace Plugin Structure

Last updated: 2026-05-01

Workspace plugins use a small, predictable folder shape. The goal is
ownership clarity, not ceremony: plugin domain behavior stays in the plugin,
and workspace core stays a generic host.

See `INTERFACES.md` for the package-level contracts these plugins contribute
to.

## Standard Layout

Start from `packages/workspace/templates/plugin/` when creating a new plugin,
then delete the files the plugin does not need.

```txt
<plugin>/
  index.tsx              # client plugin factory and public exports
  constants.ts           # plugin id, catalog ids, surface kinds
  types.ts               # public plugin-owned types
  panels.tsx             # panel definitions
  catalogs.ts            # catalog outputs/config helpers
  surfaceResolver.ts     # openSurface target -> panel resolution
  bindings.tsx           # React side-effect bindings, if needed
  events.ts              # plugin-keyed event names/payloads, if needed
  data/                  # plugin-owned client data API/hooks/cache
  server/
    index.ts             # server plugin factory and public exports
    tools.ts             # agent tools, if needed
    routes.ts            # server routes, if needed
    types.ts
  __tests__/
```

Use only the files a plugin actually needs. Large component families may live
in subfolders such as `file-tree/`, `code-editor/`, or `empty-file-panel/`.

## Ownership Rules

- `index.tsx` composes and exports; large behavior belongs in focused files.
- Domain search belongs in `catalogs.ts`.
- Domain open behavior belongs in `surfaceResolver.ts`.
- Domain event names live in `events.ts` and must be keyed by plugin id.
- Plugin data clients/hooks live in `data/`, not `front/data`.
- Server prompts/tools/routes live under `server/`, not mixed with client code.
- Workspace core may host registries, providers, event transport, and bridge
  dispatch only. It must not hardcode plugin panel ids or plugin domain rules.
- Catalog selection and plugin-owned routing should prefer `openSurface`.
  `openPanel` remains available for explicit app-level panel opens.

## Current Plugins

- `packages/workspace/src/plugins/filesystemPlugin`
- `packages/workspace/src/plugins/dataCatalogPlugin`
- `apps/boring-macro-v2/src/plugins/macro`
- `apps/workspace-playground/src/plugins/playgroundDataCatalog`

## Invariants

Run:

```sh
pnpm --filter @boring/workspace run lint:plugin-invariants
```

The scan rejects:

- `filePatterns`, `fileFallback`, `PanelRegistry.resolve`, and file-handler
  routing metadata in source.
- `front/data` imports or path references in source.
- `@boring/agent` imports from `workspace/src/shared/plugins`.
- `front`/`server` imports from production `workspace/src/shared/plugins`.
- Plugin-domain imports from production `workspace/src/front/chrome`, `events`,
  and `hooks`.
- Legacy plugin file names such as `catalog.ts`, `surfaceTargets.ts`,
  root-level `client.ts`, or root-level `server.ts`.
