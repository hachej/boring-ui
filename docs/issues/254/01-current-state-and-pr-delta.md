# 01 — Current state and PR delta

## Current plugin system

### Front plugin API

Current front plugins use:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"
```

Supported front outputs:

- panels;
- commands;
- left tabs;
- catalogs;
- surface resolvers;
- providers/bindings for static composition.

Hot-loaded runtime fronts:

- load via `/api/v1/agent-plugins/events` SSE;
- dynamic import with revision/cache-bust;
- atomically replace plugin-owned panels/commands/catalogs/resolvers;
- preserve prior working UI if import/register fails;
- do not dynamically mount providers/bindings.

### Server plugin API

Internal trusted server plugins use:

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"
```

They can contribute:

- `routes`;
- `agentTools`;
- `systemPrompt`;
- `piPackages`;
- `extensionPaths`;
- `skills`;
- `provisioning`.

These are boot-composed. Server route/tool changes require restart.

### Runtime discovery

Runtime plugin discovery currently scans:

```txt
<workspace>/.pi/extensions/
~/.pi/agent/extensions/
app/default plugin package dirs
additional plugin dirs
```

`BoringPluginAssetManager` owns:

- manifest scan/validation;
- signatures/revisions;
- load/unload/error events;
- plugin list/error routes;
- dynamic Pi snapshot from `package.json#pi`.

It must **not** own executable backend handler tables.

### Existing jiti behavior

Already implemented:

- `pluginEntryResolver.ts` uses `createJiti(import.meta.url, { moduleCache: false })` for dir-source `boring.server` entries with `hotReload: true`.
- `rebuildServerPlugins.ts` re-resolves those entries on `/reload`.

Important limitation:

```txt
current: jiti import -> validate -> diagnostics only
needed:  jiti import -> capture handlers -> atomic registry swap -> gateway dispatch
```

## PR #157 — File records data access

Adds:

- `GET /api/v1/files/records`;
- JSON array / NDJSON / CSV reader;
- bounded pagination/search;
- `readFileRecords()` front helper;
- runtime singleton export.

Value:

- plugin UIs can read file-backed tabular data without bundling huge JSON;
- avoids premature generic DB/RPC system.

Limitations:

- read-only;
- no SQL/DuckDB/SQLite/parquet;
- no structured filters/facets/sorts.

## PR #158 — WorkspaceLink

Adds:

- `WorkspaceLink`;
- `workspaceLinkCommand()`;
- `workspaceLinkHref()`;
- open file/surface/panel/expand targets.

Value:

- plugin UIs can navigate the workspace through `postUiCommand`;
- avoids backend route hacks for UI control.

## PR #159 — Runtime plugin self-test

Adds:

- `boring-ui test-plugin <name>`;
- Playwright reload/render smoke test;
- browser errors, console errors, failed requests;
- deterministic panel/error/fallback DOM markers.

Value:

- agents can verify plugin UI without human eyeballs;
- should become post-install smoke check for `boring-ui-plugin install` / `boring-ui plugin install`.

## Combined PR result

After #157/#158/#159, runtime plugins can:

```txt
scaffold -> verify -> /reload -> read file records -> navigate workspace -> self-test UI
```

Still missing:

- Pi-style install/list/remove/update;
- runtime backend gateway;
- source provenance/gating;
- unified reload coordinator;
- backend health/self-test integration.
