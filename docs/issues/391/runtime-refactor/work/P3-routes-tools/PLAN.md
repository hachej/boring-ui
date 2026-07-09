# P3-routes-tools — Plan

> Phase: Phase 3 — Move server routes and tools (bash track) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — seams to reuse (`disableDefaultFileTools`, `buildHarnessAgentTools`, `buildFilesystemAgentTools`, `buildUploadAgentTools`, readiness tags); zero agent→bash value imports.
- [02-boring-bash-environment.md](../../architecture/02-boring-bash-environment.md) — layered exports (`/server`, `/agent`); "Tools to move or consciously assign"; one-namespace / source-of-truth rules.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — Route-family scope: file/git routes are workspace/environment-scoped, deliberately outside the locked `/api/v1/agents/:agentId/...` family, so they keep their existing paths.

## Design context
Phase 3 moves the file/tree/search/fs-events/stat/dir/git routes into `boring-bash/server` and the filesystem/`bash`/`execute_isolated_code`/upload tools into `boring-bash/agent`. This is a **code move under behavior-freeze**: tool names, schemas, prompt snippets, error codes, readiness tags, the `(filesystem, path)` addressing, `assertNotFilesystemPathSpoof`, and readonly `rejectMutation` from #416 are preserved verbatim.

`boring-bash` has two consumption modes. Workspace-family hosts consume it as one internal plugin through the existing plugin pipeline: the manifest-declared server entry returns `defineServerPlugin({ agentTools, routes, systemPrompt, piPackages, provisioning })`, where `agentTools` and `systemPrompt` come from `createBashAgentFeature()` and `routes` adapts `registerBashRoutes`. Direct/headless composers that do not use the workspace plugin pipeline use library mode: import `createBashAgentFeature()` and `registerBashRoutes`, spread/mount the tools/readiness and append the bundle's `systemPromptFragment` explicitly. `packages/agent` never constructs the bundle nor mounts bash routes. This is the second composition cutover (P2 = runtime-mode, P3 = routes/tools) — API-breaking for in-repo composers, migrated per-consumer, external wire paths byte-identical.

**Amendment (2026-07-08):** `createBashAgentFeature()` is an environment
bundle factory despite the legacy "Feature" name. It creates the residue bundle
for resolved bash/filesystem environments: tools, readiness gates, and prompt
fragment. It is not a core `AgentFeature` abstraction. After E1, its internals
derive from `AttachedEnvironmentRuntime[]` / `ResolvedEnvironment[]` facts,
not from runtime-mode labels, while the public bundle shape stays stable.

Tool and renderer resolution follows the owner-ratified source order: environment bundle (the boring-bash bundle in this phase) -> plugins in manifest order -> host config. A duplicate tool name or renderer id is a typed error unless the later source declares `overrides: true`; there is no warning-only replacement. Implement this by extending the existing `mergeTools({ checkReadiness })` seam, not by adding a second catalog.

## Verified current repo reality (pre-P3)
- `packages/boring-bash/src/agent/index.ts` is currently a stub `export {};`; `packages/boring-bash/package.json` currently exports only `.`, `./shared`, and `./server`; `packages/boring-bash/tsup.config.ts` currently builds only `index`, `shared/index`, and `server/index`. P3 owns adding the `./agent` entry.
- `packages/agent/src/server/createAgentApp.ts` still imports `buildFilesystemAgentTools`/`buildHarnessAgentTools` at lines 14-15, `fileRoutes`/`fsEventsRoutes`/`treeRoutes`/`searchRoutes`/`gitRoutes` at lines 18-20 and 30-31, exposes `disableDefaultFileTools` at line 54, builds harness/file tools at lines 184 and 190, and registers file-like routes at lines 238-250.
- `packages/agent/src/server/registerAgentRoutes.ts` still imports `buildFilesystemAgentTools`/`buildHarnessAgentTools`/`buildUploadAgentTools` at lines 24-26, imports file-like routes at lines 28-30 and 40-41, builds tools at lines 594/601/602, and registers file-like routes at lines 933-947.
- `packages/agent/src/server/http/routes/fileRecords.ts` is **not** a standalone Fastify route; it is the parser/result helper used by `fileRoutes`, whose `/api/v1/files/records` handler lives in `packages/agent/src/server/http/routes/file.ts`. Move `fileRecords.ts` together with `file.ts`.
- `packages/agent/src/server/http/routes/sessionChanges.ts` is a session-scoped change-feed route backed by `packages/agent/src/server/http/sessionChangesTracker.ts` and registered by both server shapes. It is not a file route. P3 keeps it in agent unless a future, explicitly planned bead moves the session-change feed with its session owner.
- `packages/agent/src/server/index.ts` currently value-exports the file route (`fileRoutes`) and provider/mode values that P2 deletes or repoints. P3 must delete only the moved route/tool exports it owns and must not recreate any old-path re-export.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` already resolves `defaultPluginPackages` and directory plugin entries through `pluginEntryResolver`, then `bootstrapServer` collects `agentTools`, `routeContributions`, Pi packages, and provisioning. Core/full-app follows the same workspace server plugin model. CLI folder mode enters `createWorkspaceAgentServer`; CLI workspaces mode currently calls `registerAgentRoutes` directly and does not register workspace `routeContributions`, so it must either move onto that plugin pipeline or use library-mode bash wiring.

## Deliverables
- move file/tree/search/fs-events/stat/dir routes to `boring-bash/server` — preserving the `(filesystem, path)` addressing **[landed for routes/tools wiring via #429/#454: `filesystem` param, spoof guard, readonly enforcement — this phase moves the code, not the behavior]**;
- move filesystem tools to `boring-bash/agent`; move or explicitly assign `bash`, `execute_isolated_code`, and upload tools;
- preserve readiness tags and `disableDefaultFileTools`;
- replace hardwired registration with the boring-bash server plugin for workspace-family hosts — `defineServerPlugin({ agentTools, routes, systemPrompt, piPackages, provisioning })` composed from the `createBashAgentFeature()` environment-bundle factory + `registerBashRoutes`. Keep the public library-mode exports (`createBashAgentFeature()` returning `{ tools, readinessRequirements, systemPromptFragment }`, plus `registerBashRoutes`) for direct/headless composers. There is no `features` config member.
- enforce the deterministic tool/renderer source-order law through the existing merge/readiness seam.
- E1 (which depends on P2 **and** P3) may later re-implement the bundle's **internals** over environment attachments **without changing its public `{ tools, readinessRequirements, systemPromptFragment }` signature**.

## Exit criteria
- workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled;
- pure mode still has none of those routes/tools;
- company_context no-leak conformance still green.

**Amendment (2026-07-06):**
- **UI/agent parity** (475 watch-list): after the route/tool move, both surfaces still resolve visibility through the SINGLE `getFilesystemBindings` decision path — grep-gate that no second "what can this user see" path exists.
- `@hachej/boring-bash` is npm-published (cohort-versioned, external governance consumer): moved routes/tools land as **ADDITIVE** export entries (`./agent`; P4's `./plugin` likewise) in the same cohort bump as any governance-consumed `/server` change (see `../../INDEX.md` rule 6 amendment). The `bindingResolver` composition point stays name-reserved only — P3 must not implement it with governance as its lone consumer (see `../../architecture/02-boring-bash-environment.md`).
