> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-03 — Routes, tools, and file UI extraction

## Purpose

Move file/bash/upload server routes, agent tools, and filesystem UI into `@hachej/boring-bash` while preserving current user behavior and avoiding split brain.

This TODO file is self-contained for the routes/tools/UI area. The core invariant is: when boring-bash is active, file routes, file tree, search/watch, bash cwd, git/status, and model-visible paths must all refer to the same selected source of truth.

## Current ownership anchors to preserve during migration

- File/tree routes are currently under `packages/agent/src/server/http/routes/*` and registered through agent route composition.
- Git/status routes are currently agent-owned too and must not be forgotten when file routes move.
- Filesystem tools currently come from `buildFilesystemAgentTools()` and expose `read`, `write`, `edit`, `find`, `grep`, `ls`.
- Harness tools currently come from `buildHarnessAgentTools()` and include `bash` and `execute_isolated_code` when supported.
- Upload/runtime artifact tools currently come from `buildUploadAgentTools()` and are bound to the runtime/workspace file view.
- Filesystem UI currently lives under `packages/workspace/src/plugins/filesystemPlugin/front/*` and is exported through workspace surfaces/panels.

Do not create package cycles while preserving compatibility. In particular, `boring-bash/plugin` must not value-import workspace front internals if workspace also imports/registers the boring-bash plugin.

## Beads / tasks

### BBA-030 — Move file/tree/search/watch/git routes to boring-bash/server

**Phase:** Phase 3 — server routes/tools extraction.

**Depends on:** BBA-020, BBA-023.

**Scope:**

- Move file/tree/search/fs-events/stat/dir and git/status route registration out of agent.
- Include current git route helpers such as git route registration and git file URL/source-root logic in the ownership move or compatibility shim.
- Routes receive `Workspace`/boring-bash environment, not raw paths.
- Preserve `/api/v1/files/*` and git route compatibility or add aliases with explicit deprecation/migration notes.
- Preserve stable error codes and adapter-owned path validation.
- Add assertion that git root/source equals file route source equals bash cwd source for active boring-bash environments.
- Pure mode must register none of these routes.

**Unit tests:**

- Route handlers reject path escapes and symlink/special-file escapes according to adapter policy.
- Read/write/list/search/git behavior matches previous implementation in direct/local/vercel-compatible modes.
- Git/status route reads the same source of truth as file routes and bash.
- Pure mode does not register file/tree/search/fs-events/stat/dir/git routes.
- Route aliases, if added, return stable compatibility behavior and clear deprecation diagnostics.

**E2E/smoke logging:**

- Smoke script logs route list, workspace id, agent id, provider id, sourceOfTruth, runtime cwd, file path, git root, operation id, status code, stable error code, and elapsed time.
- Failure logs must include which root disagreed: file API root, search root, git root, or bash cwd.

**Acceptance:** All file-like and git-like HTTP surfaces are boring-bash-owned when enabled and absent in pure mode.

### BBA-037 — Add source-of-truth model and single-resolver invariant

**Phase:** Phase 3/4 boundary — must land before UI/tool behavior relies on moved routes.

**Depends on:** BBA-030, BBA-023.

**Scope:**

- Add explicit `sourceOfTruth: 'sandbox-primary' | 'storage-primary'` metadata per provider/runtime composition.
- Reuse existing `getRuntimeBundleStorageRoot()` and current git/file route decisions during migration; do not invent a second storage-root resolver.
- Ensure git/status, file routes, search/watch, bash cwd, upload/download, and UI file tree derive from the same selected source.
- Document sandbox-primary vs storage-primary behavior in provider diagnostics.
- In storage-primary mode, sandbox files are materialized projections/overlays and are not durable unless explicitly synced/exported.
- In sandbox-primary mode, host storage is control-plane/metadata unless explicitly synced/exported.

**Tests:**

- Direct/local/vercel/remote-worker mock source-of-truth assertions.
- Git/file/bash root equality where appropriate.
- Upload/download uses same root as file routes.
- Storage-primary materialized projection does not pretend sandbox files are durable unless synced.
- Sandbox-primary file API delegates to sandbox view rather than a stale host directory.

**E2E/smoke logging:**

- Smoke logs provider, sourceOfTruth, storage root, runtime cwd, git root, file API root, search root, upload root, and snapshot/projection id when applicable.

**Acceptance:** There is exactly one canonical resolver for the active file/bash view.

### BBA-031 — Move filesystem tools to boring-bash/agent

**Phase:** Phase 3 — agent tool extraction.

**Depends on:** BBA-030, BBA-037, BBA-012.

**Scope:**

- Move `read`, `write`, `edit`, `find`, `grep`, `ls` from `buildFilesystemAgentTools()`.
- Introduce `createBashAgentFeature()` as the host composition factory that contributes boring-bash tools, prompt snippets, readiness gates, and route feature metadata.
- Introduce or reuse `createBashEnvironment()` as the server-side environment factory consumed by routes/tools.
- Preserve pi factory/Operations-adapter invariant: Pi file tools flow through pi factories plus Operations adapters; do not bypass those wrappers casually.
- Preserve `disableDefaultFileTools` behavior exactly for the six filesystem tools.
- Preserve readiness tags: `workspace-fs`, `runtime-dependencies`, `runtime:<id>` as applicable.
- Add read-before-write/stale-write improvements where compatible, especially for `write`/`edit`; do not break existing tool schemas without an explicit migration.
- Tools must fail clearly with stable errors when boring-bash is absent, disabled, or not ready.

**Unit tests:**

- Tool names and schemas match previous behavior unless an explicit migration note says otherwise.
- `createBashAgentFeature()` registers the same tools that pure mode lacks.
- `disableDefaultFileTools` hides the same six-tool set before and after extraction.
- Tools fail clearly when boring-bash is not active or readiness gates are blocked.
- Stale write/read-before-write tests cover create, overwrite, concurrent edit, and file changed by bash.
- Tool renderer snapshots still render moved tools correctly.

**E2E/smoke logging:**

- Agent invokes read/write/edit/find/grep/ls; log tool call id, workspace id, agent id, session id, provider, sourceOfTruth, cwd, file stamp/hash, readiness requirement ids, result length/truncation, and stable error code on failure.

**Acceptance:** Existing coding agents keep the same file tool behavior; pure agents have no file tools.

### BBA-032 — Move bash and isolated-code ownership

**Phase:** Phase 3 — agent tool extraction.

**Depends on:** BBA-021, BBA-031, BBA-037.

**Scope:**

- Move or explicitly assign `bash` and `execute_isolated_code` from `buildHarnessAgentTools()`.
- Gate raw bash by policy; agents that only need predefined commands should not receive raw shell.
- Gate `execute_isolated_code` by sandbox/provider capability and readiness.
- Add predefined command tool support for safer agents (`git_diff`, `run_tests`, `verify_plugin`, etc.) without exposing arbitrary shell.
- Preserve timeout, abort, stdout/stderr truncation, and stable error semantics.
- Shell cwd must be the same model-visible cwd/file view established by BBA-037.

**Unit tests:**

- Pure mode has no bash/isolated code.
- Reviewer policy can expose predefined command without raw bash.
- Raw bash appears only when policy and provider capability both allow it.
- Timeout/abort behavior preserved, including process cleanup where provider supports it.
- Readiness tags `sandbox-exec`/runtime dependencies work.
- `execute_isolated_code` is absent or blocked with a stable diagnostic when provider cannot support it.

**E2E/smoke logging:**

- Run safe command; log command id, policy id, timeout, cwd, provider, sourceOfTruth, exit code, stdout/stderr truncation, abort/cleanup result.
- Verify raw bash absent for readonly reviewer and pure concierge agents.

**Acceptance:** Bash power is explicit, policy-scoped, readiness-gated, and source-of-truth consistent.

### BBA-033 — Assign upload/download/runtime artifact tools

**Phase:** Phase 3 — route/tool ownership decision and move.

**Depends on:** BBA-030, BBA-037.

**Scope:**

- Decide ownership with a concrete rule:
  - file-view-bound upload/download/runtime artifact tools move to boring-bash;
  - non-bash app-owned artifact services may stay in workspace/core but must not assume a filesystem.
- If moved, preserve route/tool compatibility and stable errors.
- Include download/file artifact API work (#220/#221).
- Upload/download must use the same source of truth as file routes, git/status, and bash.
- Pure mode has no workspace-bound upload tool unless host explicitly provides a non-bash artifact feature.

**Tests:**

- Upload works in coding workspace.
- Download uses same source of truth as file routes and bash.
- Pure mode has no workspace-bound upload tool by default.
- Non-bash artifact feature can be registered independently and does not import boring-bash.
- Large file, binary file, missing file, and permission-denied cases return stable errors.

**E2E/smoke logging:**

- Upload/download smoke logs artifact id, workspace id, agent id, provider, sourceOfTruth, file size, checksum/hash, route id, tool id, and stable error code.

**Acceptance:** Artifact movement is explicit and does not reintroduce hidden workspace assumptions into pure agents.

### BBA-034 — Move filesystem front plugin to boring-bash/plugin

**Phase:** Phase 4 — front plugin extraction.

**Depends on:** BBA-030, BBA-037.

**Scope:**

- Move `packages/workspace/src/plugins/filesystemPlugin/front/*` to boring-bash/plugin without introducing a workspace↔boring-bash package cycle.
- `boring-bash/plugin` must not value-import `@hachej/boring-workspace`; instead it receives a structural host adapter or lower neutral plugin SDK for frontFactory/bridge/registry/surface APIs.
- Workspace may import/register/re-export boring-bash plugin values only if boring-bash has no workspace value import, preserving one-way dependency.
- If old `@hachej/boring-workspace` barrel exports are kept, verify they are one-way workspace→boring-bash and do not create cycles; otherwise provide clear migration exports/diagnostics.
- Preserve panel ids, `workspace.open.path` resolver, file panel binding, agent file bridge, session-change integration, and existing user workflows.
- Workspace bridge remains workspace-owned; boring-bash plugin consumes bridge commands through the host adapter.
- Missing boring-bash capability should produce clear UI diagnostics rather than broken panels.

**Unit tests:**

- Surface resolver resolves same file paths as before.
- Panel ids unchanged.
- Workspace↔boring-bash acyclicity test passes for front/plugin imports.
- Missing boring-bash produces clear capability/panel diagnostics.
- Existing workspace barrel exports either remain cycle-free or fail with explicit migration diagnostics.

**E2E/smoke logging:**

- `exec_ui openFile` opens moved file panel; log command id, workspace id, agent id, panel id, file path, resolver id, bridge command id, and route/provider source.

**Acceptance:** File UI moves packages without changing user-visible behavior or introducing a package cycle.

### BBA-035 — Add FileTreeDataProvider boundary

**Phase:** Phase 4 — front plugin/data-provider boundary.

**Depends on:** BBA-034, BBA-037.

**Scope:**

- Introduce replaceable file tree data provider with tree, path-list/tree-index, and fs-event deltas.
- Keep current file tree as default provider.
- Make Pierre Trees evaluation possible without route rewrites.
- Provider must respect adapter path validation, source-of-truth metadata, hidden/denied files, symlink policy, and large-tree pagination.
- File tree UI can show agent-visible view vs user-visible view when those differ.

**Tests:**

- Default provider returns current tree shape.
- Path-list endpoint handles large trees with pagination/logging.
- Delta subscription updates UI.
- Hidden/denied files do not appear in agent-visible tree.
- Symlink/special-file handling matches adapter policy.

**E2E/smoke logging:**

- Tree smoke logs root, workspace id, agent id, provider, sourceOfTruth, node count, page size, hidden/denied count, delta count, and latency.

**Acceptance:** File tree rendering becomes replaceable without changing file route ownership again.

### BBA-036 — Add document-authority write/edit override

**Phase:** Phase 4 — collaboration/document safety.

**Depends on:** BBA-031, BBA-034, BBA-037.

**Scope:**

- Allow active document systems (TipTap/Yjs) to own writes for a file.
- `write`/`edit` tools route through document coordinator when active.
- Validate stale document version/hash and reject stale writes with stable errors.
- Do not bypass collaborative state, undo/redo assumptions, or live user edits.
- Raw file writes still work when no document authority is active.
- Document authority decisions should be visible in tool output/audit logs enough for debugging.

**Tests:**

- Active document intercepts edit.
- Stale version rejects.
- Raw file write works when no document authority active.
- Concurrent human and agent edits do not silently overwrite each other.
- Document coordinator failure returns stable diagnostic and does not corrupt file state.

**E2E/smoke logging:**

- Collaboration smoke logs document id, file path, version before/after, workspace id, agent id, session id, edit tool id, coordinator result, rejection reason, and resulting file/document hash.

**Acceptance:** Agent file tools respect live collaborative document authority.
