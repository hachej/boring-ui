# TODO-P3 — Move file/bash server routes + tools into `@hachej/boring-bash`

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 3 deliverables/exit (routes/tools code-move, behavior-freeze; `createBashAgentFeature()` returns a plain `{ tools, readinessRequirements }` bundle the host **spreads into `createAgent()`'s `tools`** — there is no `features` config member and no `AgentFeature` contract).
- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — layered exports (`/server`, `/agent`); "Tools to move or consciously assign"; one-namespace / source-of-truth rules.
- `docs/issues/391/runtime-refactor/00-global-isa.md` — seams to reuse (`disableDefaultFileTools`, `buildHarnessAgentTools`, `buildFilesystemAgentTools`, `buildUploadAgentTools`, readiness tags); zero agent→bash value imports.
- `docs/issues/391/runtime-refactor/todos/TODO-03-routes-tools-ui.md` — v1 beads BBA-030..033 (superseded here for the routes/tools slice; UI is TODO-P4).

### Depends on

- **Phase 1** injection: `createAgent()` accepts an injected `runtime` adapter and an extra `tools: AgentTool[]` (06 Phase 1) — **no `features` member, no `AgentFeature` abstraction**. `createBashAgentFeature()` returns a plain `{ tools, readinessRequirements }` bundle the host **spreads into `tools`**, it is not registered as a feature.
- **Phase 2** (`TODO-P2-bash-package-providers.md`): providers + `/providers` subpath moved; `resolveMode()` in host/boring-bash composition.

### Already landed via #416 (behavior-freeze — move code, do not change behavior)

- The `(filesystem, path)` addressing already ships **inside the tools/bundle**, not as a separate route:
  - `packages/agent/src/server/runtime/mode.ts` — `RuntimeBundle.filesystemBindings: RuntimeFilesystemBinding[]`; `RuntimeFilesystemBindingOperations` (read/list/find/grep/stat/write?/delete?/move?/mkdir?/`rejectMutation`); `RuntimeFilesystemBinding.access: 'readonly'|'readwrite'`.
  - `packages/agent/src/server/tools/filesystem/index.ts` — `withFilesystemParameter()` (injects `filesystem` enum `['user', ...boundIds]`), `withFilesystemRouting()`, `assertNotFilesystemPathSpoof()` (rejects `:/` and `/<fs>` prefixes → "use the filesystem parameter"), `executeBoundFilesystemTool()` (routes non-`user` filesystems to bound ops; `write`/`edit` call `operations.rejectMutation`). **Preserve every one of these behaviors exactly.**
- `packages/boring-bash/src/server/*` readonly/management projection operations + `runtimeBindingManager` + `companyContextFixtureProvider` (`COMPANY_CONTEXT_SENTINEL = "FORBIDDEN_FINANCE_SECRET_123"`) + `readonlyProjectionConformance`. The company_context **no-leak** conformance/leak tests (`packages/boring-bash/src/server/__tests__/readonlyCompanyContext*.test.ts`) must stay green.

### Current route + tool inventory in `packages/agent` (Phase 3 move targets)

HTTP routes (registered from `createAgentApp.ts` and `registerAgentRoutes.ts`; note there is **no** `filesystems.ts` — filesystem selection is a tool/bundle param, not a route):
- `packages/agent/src/server/http/routes/file.ts` (`fileRoutes`) — read/write/stat/dir.
- `packages/agent/src/server/http/routes/tree.ts` (`treeRoutes`).
- `packages/agent/src/server/http/routes/search.ts` (`searchRoutes`).
- `packages/agent/src/server/http/routes/fsEvents.ts` (`fsEventsRoutes`).
- `packages/agent/src/server/http/routes/git.ts` (`gitRoutes`, `GitRouteOptions`).
- `packages/agent/src/server/http/routes/fileRecords.ts`; `sessionChanges.ts` (`sessionChangesRoutes` — file-change feed; verify coupling before moving, may stay if it depends on session core).
- Backing search: `packages/agent/src/server/runtime/createServerFileSearch.ts` (+ `__tests__`).

Agent tools:
- `packages/agent/src/server/tools/filesystem/index.ts` → `buildFilesystemAgentTools()` (`read`, `write`, `edit`, `find`, `grep`, `ls`; readiness tag `workspace-fs`) + `filesystem/remoteWorkspaceTools.ts` + `operations/bound.ts` (`boundFs`) + `operations/remoteWorkspace.ts`.
- `packages/agent/src/server/tools/harness/index.ts` → `buildHarnessAgentTools()` (`bash` w/ readiness `sandbox-exec` + runtime tags `runtime-dependencies`/`runtime:python`/`runtime:node`; `execute_isolated_code` gated on `sandbox.capabilities.includes('isolated-code')`) + `harness/bashToolOptions.ts` + `operations/remoteSandbox.ts`.
- `packages/agent/src/server/tools/upload/index.ts` → `buildUploadAgentTools()` (`upload_file`; readiness `workspace-fs`; `MAX_UPLOAD_BYTES`).

Registration/consumption call sites (grep-verified):
- `packages/agent/src/server/createAgentApp.ts` — imports route+tool builders; `disableDefaultFileTools?: boolean` at L54; tools composed at L184 (`buildHarnessAgentTools`) and L190 (`...(opts.disableDefaultFileTools ? [] : buildFilesystemAgentTools(runtimeBundle))`).
- `packages/agent/src/server/registerAgentRoutes.ts` — tool builders at L594/601/602 (`buildHarnessAgentTools`, `buildFilesystemAgentTools`, `buildUploadAgentTools`).

## Goal / exit criteria

File/tree/search/fs-events/stat/dir (+ git/status) routes and file/bash/`execute_isolated_code`/upload tools live in `@hachej/boring-bash` (`/server`, `/agent`). Tools are contributed via `createBashAgentFeature()` — which returns a **plain boring-bash-local bundle `{ tools, readinessRequirements }`** (NOT a core `AgentFeature` contract; there is no `features` config member) — that host composition **spreads into the `createAgent()` config `tools`**; routes are mounted by **host composition** (cli/workspace/full-app — the same call sites that construct the bundle) next to the agent routes. Neither `packages/agent` nor the bundle ever imports `registerBashRoutes` — that would break the zero agent→bash value-import invariant (the bundle carries tools + readiness only, never routes; the agent package never mounts bash routes). Behavior frozen. Exit (06 Phase 3):

- workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled.
- pure mode (`createAgent({ runtime: 'none' })`) registers none of these routes/tools.
- company_context no-leak conformance still green.
- `(filesystem, path)` addressing + readonly enforcement identical to #416.

### This phase is the host-composition cutover (API-breaking for in-repo composers)

P3 is the **second** of the two named composition cutovers (P2 = runtime-mode; **P3 = routes/tools**), where composition breaks and gets rewired again. P1 held an end-to-end compatibility promise ("all current HTTP consumers unchanged"), but **P2 already broke composition first** (`TODO-P2` "This phase is the runtime-mode composition cutover" — `resolveMode` injection + the pure-only agent bin). P3 then breaks it a second time: moving tools/routes out of `packages/agent` and into host-mounted `createBashAgentFeature()` + `registerBashRoutes()` is an **API-breaking change for every in-repo composer** — each host must now construct the bash bundle and mount bash routes itself (the agent package no longer does it implicitly). **The first composition break was at P2, not here.** External HTTP *callers* still see byte-identical route paths and behavior; the break is in the **composition API**, not the wire surface.

P3 therefore **enumerates and migrates EVERY in-repo composition consumer**, each in its own PR (no big-bang), and re-verifies behavior parity after each migration:

- `packages/cli/src/server/modeApps.ts` — construct + spread `createBashAgentFeature()`; mount `registerBashRoutes`. (Also already owns the bash dev-server bin composition moved from the agent bin in P2 — see fix 6.)
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` — same construct + spread + mount.
- `apps/full-app` composition — same construct + spread + mount.
- `apps/agent-playground` e2e wiring — repoint its backend/dev-server composition to the host-mounted bundle + routes.
- `packages/agent` bin — already pure-only as of P2 (fix 6); confirm it composes `runtime: 'none'` and mounts no bash routes (nothing to migrate here beyond the P2 change).

**Exit re-verifies parity post-migration:** after each consumer is migrated, its previously-green behavior (workspace playground file tree/editor + read/write/edit/find/grep/ls/bash; company_context no-leak; e2e specs) must pass unchanged. A consumer is "done" only when its migration PR is merged AND its parity checks are re-run green post-cutover.

## Non-negotiables

- Behavior-freeze: this is a **code move**, not a behavior change. Preserve tool names, schemas, prompt snippets, error codes, readiness tags (`workspace-fs`, `sandbox-exec`, `runtime-dependencies`, `runtime:<id>`), stale-read/write stamps, renderer output.
- Preserve `disableDefaultFileTools` semantics exactly (hides the six filesystem tools).
- Preserve the `(filesystem, path)` param, `assertNotFilesystemPathSpoof` guard, and readonly `rejectMutation` from #416 verbatim.
- Zero agent→bash value imports. Pi file tools keep flowing through pi factories + Operations adapters (`@mariozechner/pi-coding-agent` + `operations/bound.ts`); do not bypass those wrappers.
- One source of truth: routes/tree/search/watch/bash cwd/git/status/upload all resolve from the same root (reuse `getRuntimeBundleStorageRoot()`; do not invent a second resolver).
- Type-only import of agent contracts (`RuntimeBundle`, `AgentTool`, `Workspace`, `Sandbox`, readiness types) into boring-bash is allowed; value imports are not.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree. Do not commit.
- Do not change tool schemas / add features / "improve" behavior beyond stale-write parity already present.
- Do not move the filesystem front plugin (TODO-P4 owns it).
- Do not re-shape #416 shared contracts or projection ops.

## Beads

### BBP3-010 — Add `/agent` subpath + `createBashAgentFeature()` skeleton [size S]

- **Files touch/create:** replace stub `packages/boring-bash/src/agent/index.ts` (currently `export {}`) with real exports; `packages/boring-bash/package.json` (add `"./agent"` export); `packages/boring-bash/tsup.config.ts` (add entry); `packages/boring-bash/scripts/check-invariants.mjs` (`requiredExports` += `"./agent"`).
- **Notes:** Define `createBashAgentFeature()` returning a plain boring-bash-local bundle `{ tools: AgentTool[]; readinessRequirements: string[] }` — **NOT** an `AgentFeature` core contract (there is no such abstraction). The bundle contributes tools + readiness gates + prompt snippets **only** — NOT routes. Routes are mounted by host composition (the BBP3-015 call sites), never by `packages/agent`; the bundle carries no route metadata. Import `AgentTool`/`RuntimeBundle` **type-only** from `@hachej/boring-agent/server`. No behavior yet — wiring lands in BBP3-013/014.
- **Tests:** export-map test imports `/agent`; invariants green.
- **Acceptance:** `/agent` subpath resolves; feature factory type exists.

### BBP3-011 — Move filesystem tools to `boring-bash/agent` [size L]

- **Files move:**
  - `packages/agent/src/server/tools/filesystem/index.ts` → `packages/boring-bash/src/agent/tools/filesystem/index.ts` (+ `__tests__/filesystem.test.ts`).
  - `packages/agent/src/server/tools/filesystem/remoteWorkspaceTools.ts` → `packages/boring-bash/src/agent/tools/filesystem/remoteWorkspaceTools.ts`.
  - `packages/agent/src/server/tools/operations/bound.ts` → `packages/boring-bash/src/agent/tools/operations/bound.ts` (+ `__tests__/bound.test.ts`).
  - `packages/agent/src/server/tools/operations/remoteWorkspace.ts` → `packages/boring-bash/src/agent/tools/operations/remoteWorkspace.ts` (+ tests).
- **Notes:** Keep `withFilesystemParameter`/`withFilesystemRouting`/`assertNotFilesystemPathSpoof`/`executeBoundFilesystemTool`/`adaptPiTool` verbatim. Keep readiness tag `workspace-fs`. Preserve `disableDefaultFileTools` by keeping the six-tool set behind `createBashAgentFeature()` so a host omitting the feature = pure mode with no file tools. Tools must fail with a stable error when boring-bash is absent/not ready.
- **Tests:** moved tests pass under boring-bash; tool names/schemas unchanged; `disableDefaultFileTools` hides the same six tools; spoof-guard + readonly-rejection tests pass (these guard the #416 behavior).
- **Acceptance:** six filesystem tools owned by boring-bash; pure agents have none; behavior identical.

### BBP3-012 — Move bash + `execute_isolated_code` tools [size M]

- **Files move:** `packages/agent/src/server/tools/harness/index.ts` → `packages/boring-bash/src/agent/tools/harness/index.ts`; `harness/bashToolOptions.ts` → same dir; `operations/remoteSandbox.ts` → `packages/boring-bash/src/agent/tools/operations/remoteSandbox.ts` (+ their `__tests__/*`).
- **Notes:** Preserve `bash` readiness `sandbox-exec`; runtime-requirement detection (`runtime:python`/`runtime:node`/`runtime-dependencies`) and secret redaction verbatim. Keep `execute_isolated_code` gated on `bundle.sandbox.capabilities.includes('isolated-code')`. Shell cwd stays `bundle.workspace.root` (same model-visible view). Pure mode → no bash/isolated-code (achieved by omitting the feature).
- **Tests:** moved `harness.test.ts` passes; pure mode has no bash; readiness/redaction behavior preserved.
- **Acceptance:** bash power owned by boring-bash, policy/readiness-gated, source-of-truth consistent.

### BBP3-013 — Move upload/artifact tool + decide ownership [size S]

- **Files move:** `packages/agent/src/server/tools/upload/index.ts` → `packages/boring-bash/src/agent/tools/upload/index.ts` (+ `__tests__/upload.test.ts`).
- **Notes:** `upload_file` is file-view-bound (uses `getRuntimeBundleStorageRoot`) → belongs in boring-bash. Keep readiness `workspace-fs`, `MAX_UPLOAD_BYTES`, stable errors. Pure mode has no workspace-bound upload tool unless host supplies a non-bash artifact feature.
- **Tests:** upload works in coding workspace; pure mode lacks it; large/binary/missing/permission-denied return stable errors.
- **Acceptance:** artifact tool moved; no hidden workspace assumption leaks into pure agents.

### BBP3-014 — Move file/tree/search/fs-events/git routes to `boring-bash/server` [size L]

- **Files move:**
  - `packages/agent/src/server/http/routes/file.ts` → `packages/boring-bash/src/server/routes/file.ts` (+ `__tests__/file.test.ts`).
  - `tree.ts` → `boring-bash/src/server/routes/tree.ts` (+ `__tests__/tree.test.ts`).
  - `search.ts` → `boring-bash/src/server/routes/search.ts` (+ `__tests__/search.test.ts`); `runtime/createServerFileSearch.ts` → `boring-bash/src/server/createServerFileSearch.ts` (+ tests).
  - `fsEvents.ts` → `boring-bash/src/server/routes/fsEvents.ts` (+ `__tests__/fsEvents.test.ts`).
  - `git.ts` → `boring-bash/src/server/routes/git.ts` (+ `__tests__/git.test.ts`); carry `GitRouteOptions` + git source-root logic.
  - `fileRecords.ts` → `boring-bash/src/server/routes/fileRecords.ts`. **Verify** `sessionChanges.ts` coupling: if it depends on session-core (not fs), leave it in agent and note; else move.
- **Files touch:** `packages/boring-bash/src/server/index.ts` (export a `registerBashRoutes(app, { runtime })` composing the above; keep Fastify types injected, not a hard Fastify dep if avoidable — mirror current signatures). `registerBashRoutes` is imported and mounted by **host composition only** (the BBP3-015 call sites: `packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `apps/full-app` composition) — never from `packages/agent/src/server/*` **and never from `packages/agent/src/bin/boring-agent.ts`** (the agent bin is part of `packages/agent` and **may NOT import boring-bash** — zero agent→bash value imports, bin included), and NOT contributed through `createBashAgentFeature()`. The `packages/agent` bin is **already pure-only as of Phase 2 (`TODO-P2` BBP2-005)** — the bash-enabled bin composition moved to `packages/cli` in P2 (same PR that moved `resolveMode`), because the agent bin cannot resolve a mode/provider without importing boring-bash. **P3 does not move the bin**; it only updates the already-CLI-owned bash dev-server entry to spread `createBashAgentFeature()` + mount `registerBashRoutes` now that tools/routes have moved. `/api/v1/files/*` + git route paths stay byte-identical — no aliases, no path changes. **Rationale (so a reviewer does not flag it):** file/git routes are workspace/environment-scoped, deliberately OUTSIDE the locked `/api/v1/agents/:agentId/...` agent-session family (`08` "Route-family scope") — files belong to environments, not agents — so they keep their existing paths and are never re-prefixed with an `agentId`.
- **Notes:** Routes receive `Workspace`/bundle, not raw paths (already true). Preserve stable error codes + adapter-owned path validation. Pure mode registers none of these.
- **Tests:** moved route tests pass; read/write/list/search/git parity; git root == file route root == bash cwd; pure mode registers none.
- **Acceptance:** file-like + git-like HTTP surfaces are boring-bash-owned when enabled, absent in pure mode.

### BBP3-015 — Wire `createBashAgentFeature()` into `createAgent()` composition [size M]

- **Files touch:** `packages/agent/src/server/createAgentApp.ts` (remove L14/15 tool-builder imports + L18-31 route imports for moved routes). **`packages/agent` (`createAgentApp` and `registerAgentRoutes`) NEVER constructs `createBashAgentFeature()` and NEVER calls `registerBashRoutes` / mounts bash routes.** It only **receives already-supplied `tools`/`readinessRequirements` on its own options** and forwards them straight into the `createAgent()` config it builds — there is no `features` param, and it never imports boring-bash (value or type). After this bead `packages/agent` has **zero boring-bash imports**; `disableDefaultFileTools` is honored purely by which `tools` the host chose to supply. Same rule for `packages/agent/src/server/registerAgentRoutes.ts` (drop L24-41 imports and rework L594/601/602 tool composition to consume host-supplied tools/readiness — it constructs nothing bash-related and mounts no bash routes). **Host/composition packages are the EXCLUSIVE call sites for `createBashAgentFeature()` and `registerBashRoutes()`** (`packages/cli/src/server/modeApps.ts` — **which already owns the bash-enabled dev-server bin composition, moved here from the agent bin in Phase 2 (`TODO-P2` BBP2-005); P3 only updates it to consume the moved tools/routes**, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `apps/full-app` composition): each host constructs `createBashAgentFeature()`, **spreads its `tools` into the `createAgent()` config (via the `createAgentApp`/`registerAgentRoutes` options that forward into it) and passes its `readinessRequirements` as gates**, **and mounts `registerBashRoutes` on its own Fastify app next to the agent routes** (one-line mount per host, same PR). The `packages/agent` bin is NOT a bash host — it composes a pure agent only and does not import boring-bash.
- **Notes:** This is where the Phase-1 injection seam is consumed. If the injected `tools`/runtime seam is not yet threaded through `createAgentApp`/`registerAgentRoutes`, STOP and report the Phase-1 gap rather than hardwiring. `disableDefaultFileTools`: host spreads the bash bundle with filesystem tools suppressed (bundle option) so the six tools drop while bash/routes remain — preserve exact current semantics.
- **Tests:** `pnpm --filter @hachej/boring-agent run test` green; a pure-mode composition (`runtime: 'none'`, no bash feature) exposes no file routes/tools; a bash-enabled composition exposes all.
- **Acceptance:** every `createBashAgentFeature()` and `registerBashRoutes()` call lives exclusively in host packages (cli / workspace server composition / full-app) — `packages/agent` constructs neither; tools are spread into `createAgent().tools` by the host via the plain `createBashAgentFeature()` bundle; routes are mounted by host composition; hardwired registration removed; pure vs bash split verified.

### BBP3-016 — Route + tool source-of-truth regression tests [size M]

- **Files create:** `packages/boring-bash/src/server/__tests__/sourceOfTruth.test.ts` (route write ↔ bash read; bash write ↔ file route read/search; git/status root == file API root == bash cwd) and a `disableDefaultFileTools` parity test.
- **Notes:** Reuse `getRuntimeBundleStorageRoot`; do not add a second resolver. Do not duplicate provider-level assertions from Phase 2.
- **Tests:** as above; company_context no-leak conformance (`readonlyCompanyContext*.test.ts`) still green post-move.
- **Acceptance:** moved routes/tools cannot regress into host-tree-vs-remote-bash split brain; readonly projection stays leak-free.

### BBP3-017 — Extend invariants for the routes/tools boundary [size S]

- **Files touch:** `packages/boring-bash/scripts/check-invariants.mjs` (`requiredExports` += `"./agent"`; keep agent→bash value-import scan). Verify `packages/agent/src/server/index.ts` no longer value-exports moved tool builders (`buildFilesystemAgentTools`/`buildHarnessAgentTools`/`buildUploadAgentTools`) — migrate those importers or host-shim; add a static assertion if practical.
- **Tests:** `pnpm lint:invariants` (root) green; `pnpm audit:imports` green.
- **Acceptance:** boundary guarded; no agent→bash value import; no cycle.

## Verification — exact commands verified against package.json scripts

```bash
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run check:invariants

pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm --filter @hachej/boring-agent run check:isolation

pnpm lint:invariants     # root: agent + boring-bash + workspace-plugin
pnpm audit:imports
pnpm typecheck

# Manual behavior proof (workspace playground): open file tree + editor, run read/write/edit/find/grep/ls/bash.
# See run-workspace-playground recipe; rebuild dist first.
```

## Review gates

- Phase 1 (`createAgent()` with injected `tools`/runtime — no `features` param) + Phase 2 (providers moved) confirmed present, else STOP+report.
- Behavior-freeze verified: tool names/schemas/prompt snippets/readiness tags/error codes unchanged; renderer snapshots unchanged.
- `disableDefaultFileTools` parity test passes; pure mode has zero file routes/tools.
- `(filesystem, path)` param + spoof guard + readonly `rejectMutation` preserved verbatim; company_context no-leak conformance green.
- Single source-of-truth regression tests pass; no second storage-root resolver introduced.
- `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports.
