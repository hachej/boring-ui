# 05 — Implementation ticket split

Do not implement this as one giant PR.

## Ticket 1 — Taxonomy docs + manifest/source metadata

Goal: make the data model explicit.

Allowed files/modules:

- plugin docs/skills;
- manifest validation/types;
- source metadata types;
- Pi package source collector naming/design.

Tasks:

- document internal vs external vs remote-deferred;
- keep one `boring.server` manifest field and document its source-dependent semantics;
- add package source metadata type proposal;
- ensure scanner can preserve Pi package source metadata in load result;
- decide package export names.

Non-goals:

- no gateway;
- no install command;
- no runtime backend execution.

Acceptance:

- docs no longer say runtime plugins are absolutely route-free;
- docs say raw Fastify is still forbidden for external runtime plugins;
- manifest has clear `boring.server` semantics: internal/app raw Fastify at boot, external CLI/local constrained runtime backend through gateway.

## Ticket 2 — Reload coordinator extraction

Goal: code-judo before new behavior.

Allowed files/modules:

- `createWorkspaceAgentServer.ts` only to remove inline orchestration and call coordinator;
- new `workspacePluginReload.ts`;
- reload tests.

Tasks:

- extract existing reload flow unchanged;
- make `/api/v1/agent/reload` and `/api/boring.reload` share coordinator closure;
- preserve existing diagnostics/restart warnings exactly.

Non-goals:

- no runtime backend;
- no source install;
- no behavior change.

Acceptance:

- existing tests pass;
- new tests prove both reload endpoints share same behavior;
- `createWorkspaceAgentServer.ts` gets smaller or at least does not grow.

## Ticket 3 — Shared jiti import helper

Goal: reuse existing jiti behavior cleanly.

Allowed files/modules:

- new `server/pluginImports/importServerModule.ts`;
- `pluginEntryResolver.ts`;
- tests for jiti/native import behavior.

Tasks:

- extract `createJiti(..., { moduleCache: false })` helper;
- keep fallback warning behavior;
- make existing `boring.server` diagnostic import use helper.

Non-goals:

- no gateway;
- no install command.

Acceptance:

- source edits are visible with hotReload true;
- native import fallback behavior unchanged;
- no duplicated jiti helper remains.

## Ticket 4 — Runtime backend API + exact router capture

Goal: define runtime backend plugin authoring boundary.

Allowed files/modules:

- `server/runtimeBackend/defineRuntimeServerPlugin.ts`;
- `server/runtimeBackend/routerCapture.ts`;
- package export for `runtime-server`.

Tasks:

- add `defineRuntimeServerPlugin`;
- reject runtime module identity/id fields;
- exact-match route capture;
- unsafe path and duplicate route validation;
- build/export tests.

Non-goals:

- no Fastify gateway yet;
- no jiti loader yet.

Acceptance:

- external module can import `@hachej/boring-workspace/runtime-server`;
- subpath import does not pull app/server orchestration;
- exact router tests pass.

## Ticket 5 — Runtime backend loader + registry

Goal: turn jiti import into captured handler state.

Allowed files/modules:

- `runtimeServerLoader.ts`;
- `runtimeBackendRegistry.ts`;
- `runtimeBackendResponse.ts`;
- `runtimeBackendHealth.ts`.

Tasks:

- load external `boring.server` runtime backend with shared jiti helper;
- capture handler table;
- atomic replace;
- failed load preserves previous table;
- dispose on replace/unload/close;
- stable error codes.

Non-goals:

- no install command;
- no bwrap worker;
- no route params.

Acceptance:

- syntax error keeps old backend live;
- dispose invariants tested;
- concurrent reload serialization tested.

## Ticket 6 — Gateway + reload integration

Goal: expose runtime backend handlers through stable gateway.

Allowed files/modules:

- `runtimeBackendGateway.ts`;
- `workspacePluginReload.ts`;
- app/server route registration wiring.

Tasks:

- register `ALL /api/v1/plugins/:pluginId/*` once;
- dispatch to runtime backend registry;
- enforce workspace scoping in workspaces mode;
- wire registry reload into coordinator;
- add host health endpoint under `/api/v1/agent-plugins/:pluginId/health`.

Non-goals:

- no install command;
- no remote sandbox;
- no permission prompts.

Acceptance:

- backend handler responds after `/reload`;
- source edit + `/reload` changes response without restart;
- wrong workspace gateway call rejected;
- host health path does not conflict with plugin-owned `/health`.

## Ticket 7 — Pi package-source install/list/remove/update

Goal: make external boring plugin package install first-class without creating a boring-only registry.

Allowed files/modules:

- CLI command parser;
- Pi package source manager/facade;
- package source collector;
- install tests.

Tasks:

- add `boring-ui-plugin install/list/remove`, plus optional `boring-ui plugin ...` facade/reuse;
- npm/git/local source parsing;
- global default scope;
- `-l/--local` workspace scope;
- Pi package source settings/roots;
- boring discovery scans Pi package roots for `package.json#boring`;
- Pi resource loading can consume `package.json#pi` and no-op when absent;
- security warning;
- verify/test hook where possible.

Non-goals:

- no hosted permission grants;
- no bwrap worker;
- no marketplace UI.

Acceptance:

- npm/git/local install works globally;
- local install works workspace-only;
- workspace-local shadows global;
- list shows scope/source/id;
- remove respects scope;
- no `.pi/boring-plugin-sources.json` or copied local source tree is created.

## Ticket 8 — Self-test backend extension

Goal: extend PR #159 self-test to backend health.

Tasks:

- support backend health declaration;
- call plugin-owned gateway `/health` if declared;
- include backend status in output;
- record last self-test in health aggregator.

Acceptance:

- `test-plugin` reports front and backend separately;
- backend failure does not falsely mark front import as failed.

## Deferred tickets

- bwrap/local-sandbox worker/proxy;
- hosted/cloud external plugins;
- permission grants/marketplace policy;
- dynamic provider/binding hot mount;
- route params/wildcards;
- rich workspace facade for backend handlers.
