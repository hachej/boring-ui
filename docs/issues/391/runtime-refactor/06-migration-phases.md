# 06 — Migration phases

## Rule

Dependency inversion happens before package extraction. Otherwise we create an agent↔bash import cycle.

Each phase must preserve existing workspace behavior unless that phase explicitly changes a documented invariant.

## Phase 0 — ADR, naming lock, invariant update

Deliverables:

- ADR: `@hachej/boring-agent` becomes runtime-free; `@hachej/boring-bash` owns files/bash/file UI.
- Update `docs/DECISIONS.md` §7 and `packages/agent/docs/runtime.md`.
- Lock package name: `@hachej/boring-bash`.
- Decide v1 namespace semantics: preserve one `/workspace` namespace or formally supersede current invariant.
- State that old monolithic plan is superseded by this plan pack.

Exit criteria:

- ADR accepted;
- plan pack reviewed;
- issue #391 points to plan pack.

## Phase 1 — Agent dependency inversion and pure mode

Deliverables:

- `createAgentApp()` / `registerAgentRoutes()` receive runtime/features by injection.
- Remove static value imports from agent server composition to built-in mode resolution where needed for pure mode.
- Define destination for mode resolution: type-only `RuntimeModeAdapter` contracts may stay in agent during migration, but `resolveMode()` and concrete mode adapters move to boring-bash/host composition after compatibility shims.
- Add package invariant test: no agent value import from boring-bash.
- Add `runtime: none` / `features: []` path.
- Separate `sessionStorageRoot` from workspace roots.
- Audit pi-coding-agent cwd/resource assumptions.
- Add external hook and operational event seams if route composition changes.

Exit criteria:

- pure agent starts with no workspace/sandbox/cwd/file routes/bash tools;
- existing direct/local/vercel modes still work through host composition.

## Phase 2 — Create `@hachej/boring-bash`

Deliverables:

- package skeleton and exports;
- type-only shared contracts;
- provider capability model;
- mode/provider mapping docs;
- move concrete provider implementations (direct, bwrap, vercel-sandbox, remote-worker client) to `boring-bash/providers`;
- provisioning ownership docs: agent owns engine/types over injected adapters; boring-bash owns requirement normalizer and provider adapters;
- remote-worker split docs: protocol/shared types, client/provider adapter, optional server package path;
- compatibility strategy: type-only old-path exports are allowed where safe; moved boring-bash values must not be re-exported from agent/workspace if doing so creates package cycles. Use host/composition shims or clear import migrations instead.

Do not move providers until Phase 1 injection is complete.

Exit criteria:

- package builds;
- no import cycle;
- current apps still compile after import migration or through safe host-level shims.

## Phase 3 — Move server routes and tools

Deliverables:

- move file/tree/search/fs-events/stat/dir routes to `boring-bash/server`;
- move filesystem tools to `boring-bash/agent`;
- move or explicitly assign `bash`, `execute_isolated_code`, and upload tools;
- preserve readiness tags and `disableDefaultFileTools`;
- replace hardwired registration with `createBashAgentFeature()`.

Exit criteria:

- workspace playground still opens file tree/editor;
- read/write/edit/find/grep/ls/bash work when boring-bash enabled;
- pure mode still has none of those routes/tools.

## Phase 4 — Move filesystem front plugin

Deliverables:

- move filesystem front plugin to `boring-bash/plugin`;
- preserve panel ids and `workspace.open.path` resolver;
- preserve file panel binding and agent file bridge/session changes;
- add `FileTreeDataProvider` boundary;
- add document-authority override seam.

Exit criteria:

- `exec_ui openFile` still opens files;
- file tree can consume provider boundary;
- active document coordinator can intercept writes.

## Phase 5 — Extend provisioning/readiness

Deliverables:

- `BashRequirement` normalizer lives outside agent and feeds `provisionWorkspaceRuntime()` through host/core/CLI composition;
- re-point callers in core full-app, workspace server, and CLI/workspaces-mode composition;
- import-free requirement validation;
- per-requirement readiness metadata;
- `optional_failed` as compatible derived/display state;
- health checks;
- SDK archive support;
- managed service requirements;
- secret status/grant model;
- remote-worker capability handshake;
- two-phase bootstrap/onSession reconciliation.

Exit criteria:

- existing provisioning fingerprint skip still works;
- tools gate on existing readiness keys;
- plugin SDK provisioned and gated until ready;
- remote-worker fail-closes when required hardening unavailable.

## Phase 6 — Plugin and child-app integration

Prerequisite: consume resolved child-app/workspace-kind context from `docs/plans/shared-child-app-platform.md`; do not define a competing child-app registry here.

Deliverables:

- introduce the `AgentRegistry` data structure so child-app defaults can declare agent sets; full route/session migration follows in Phase 7;
- import-free plugin manifest validation for `boring.requires` and `bash`;
- runtime plugin context exposes available features;
- hosted plugin remote-mode fail-closed behavior;
- child-app/workspace-kind policy input consumed from shared child-app platform;
- Macro child-app requirements can be scoped;
- full-app reload/plugin runtime remains multi-tenant.

Exit criteria:

- Macro requirements do not leak into generic workspace;
- hosted iframe plugin stays constrained;
- runtime plugin RPC still works;
- full-app reload resolves per workspace/agent/plugin runtime.

## Phase 7 — Multi-agent routing/session/search

Deliverables:

- implement `agentId` scoped routes or request-scope equivalent against the Phase 6 `AgentRegistry`;
- binding scope key includes `agentId`;
- `sessionNamespace` includes `agentId`;
- session root layout preserves durable host session root;
- per-agent catalog and readiness;
- session index/search scoped by workspace+agent;
- external hook target resolution.

Exit criteria:

- same workspace/same session id/two agents do not collide;
- deep links can open target agent session;
- pure/headless and bash-enabled agents coexist in one deployed app.

## Phase 8 — Cleanup and deprecation

Deliverables:

- remove remaining safe type-only/host-level compatibility exports after downstream migration window;
- update package docs;
- create migration notes for app authors;
- convert remaining plan tasks into beads/issues.

Exit criteria:

- no code imports old moved paths;
- docs reflect new package ownership;
- issue #391 can close or split remaining follow-ups.
