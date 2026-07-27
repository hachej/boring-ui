> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-01 — Agent core dependency inversion and pure mode

> **Supersession note (Decision 21, accepted 2026-07-11):**
> [Decision 21](../../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode)
> supersedes the public no-environment path this TODO describes. Every v1 run
> is authorized through a workspace and an approved runtime/environment;
> there is no v1 `runtime: 'none'` product mode.
>
> - **BBA-012, BBA-013, BBA-014** (pure composition seam, no-filesystem mode,
>   pi cwd audit for pure mode) are **SUPERSEDED — do not implement.** A true
>   no-environment consumer is post-v1 and must be named, with an explicit
>   contract, before its harness work is chosen; see decision 21's
>   reintroduction gate.
> - **BBA-015, BBA-016** (non-bash external hook ingestion and non-bash
>   operational command/event seams, written for #380 external harnesses) are
>   **RETIRED (owner ruling 2026-07-11) — do not implement.** Their only named
>   consumer was issue #380 ("Allow external harnesses to create
>   review/question hooks"), which is CLOSED; per decision 21's re-evaluate
>   clause there is no live consumer. Revive only if a live, named consumer
>   issue reappears, and then as environment-full composition — never a
>   pure-mode dependency.
>
> Historical content below is preserved for rationale; it is not current
> implementation authority.

## Purpose

Make `@hachej/boring-agent` usable without any filesystem, sandbox, cwd, or bash capability, while preserving existing coding workspace behavior through host-injected features.

## Beads / tasks

### BBA-010 — Inventory current agent runtime coupling

**Depends on:** BBA-000, BBA-001.

**Why:** We need a precise map before cutting dependencies. Known coupling points include `createAgentApp`, `registerAgentRoutes`, runtime modes, file/bash/upload tools, pi harness cwd, and plugin discovery cwd.

**Scope:**

- Inspect and document imports from agent server to runtime modes, workspaces, sandboxes, file routes/tools, upload tools, pi harness, plugin discovery.
- Include host composition call sites (`createCoreWorkspaceAgentServer`, workspace server/playground, CLI/workspaces mode, full-app) so dependency inversion does not strand one app path.
- Identify which imports can become injected interfaces.
- Identify compatibility paths required for current apps, and explicitly mark which old value imports must migrate rather than be re-exported from agent.

**Tests/proof:**

- Add a markdown table in implementation PR with file/path, current dependency, target owner.
- Include `rg` output in PR proof.

**Acceptance:** No runtime/file/bash dependency is unknown.

### BBA-011 — Add package import invariant test

**Depends on:** BBA-010.

**Why:** Prevent future regressions where agent imports boring-bash and recreates a package cycle.

**Scope:**

- Add a unit/static test that fails if `packages/agent/src/**` has value imports from `@hachej/boring-bash`.
- Provide a reusable import-graph/acyclicity helper that later TODOs can extend for workspace↔boring-bash and core/host composition once those packages/values exist; do not make BBA-011 depend on packages that have not been created yet.
- Allow type-only imports only if they do not create runtime value cycles and are explicitly documented.
- Mirror existing architectural invariant tests style.
- Verify agent shared code still obeys project invariants: no `node:*`, no `Buffer`, and no server-only Fastify values in shared/front exports.

**Tests/proof:**

- Run targeted invariant test.
- Include negative fixture or assertion proving value imports fail.

**Acceptance:** Import invariant catches forbidden agent→bash value imports.

### BBA-012 — Introduce injected runtime/feature composition seam

**Depends on:** BBA-010, BBA-011.

**Why:** Dependency inversion must happen before moving providers. Host/core/CLI should compose agent + optional boring-bash.

**Scope:**

- Refactor `createAgentApp` / `registerAgentRoutes` so pure path does not require static `resolveMode()` or runtime bundle.
- Preserve compatibility for current direct/local/vercel modes through host-injected adapter or shim.
- Reuse existing plugin/capability seams; do not create a second plugin registry.
- `AgentFeature` is a façade over existing tools/routes/systemPrompt/capability contributors.

**Unit tests:**

- Existing createAgentApp/registerAgentRoutes direct/local/vercel-sandbox tests still pass; remote-worker stays covered by mock/contract tests where available.
- New test: createAgentApp with `features: []` and no runtime adapter starts.
- Test that route registration does not request a runtime bundle in pure mode.
- Test the feature façade reuses existing tool/route/systemPrompt/capability contributors and does not create a second plugin registry.
- Test `sessionStorageRoot` is distinct from workspace roots and can point at host `BORING_AGENT_SESSION_ROOT`.

**E2E/smoke logging:**

- Script logs `mode=none`, `workspaceId`, `agentId`, route count, tool names, session root, and whether a runtime adapter was requested.
- Must prove no file routes and no bash tools.
- Must prove session root is host durable session storage (for example under `BORING_AGENT_SESSION_ROOT`) and not workspace/container home.

**Acceptance:** Agent server can be composed without runtime mode resolution.

### BBA-014 — Audit and fix pi-coding-agent cwd/resource assumptions

**Depends on:** BBA-012.

**Phase note:** This task must complete before BBA-013 exits; pure mode cannot ship until the harness has no ambient host file authority.

**Why:** Removing tools is not enough if the harness still receives `process.cwd()` or reads AGENTS.md/resources.

**Scope:**

- Audit `createPiCodingAgentHarness`, resource loading, system prompt building, session store, compaction, model-history ownership, and file tool assumptions.
- Decide:
  - pi supports no cwd/sealed root; or
  - pure mode uses a non-pi harness.
- Ensure pure mode skips or relocates boot-time plugin discovery that currently receives cwd.
- Preserve existing `AgentRuntimeCapabilities` semantics (`nativeFollowUp`, `aiSdkOwnsHistory`) and do not confuse them with feature grants or bash provider capabilities.

**Unit tests:**

- Harness construction spy asserts no host cwd/path in pure mode.
- Prompt snapshot has no cwd, workspace root, AGENTS.md, file-tool instructions, or workspace file hints.
- Compaction/continue tests run in pure mode without trying to read files or workspace instructions.
- If sealed root is used, test it contains no host files and cannot escape.

**E2E/smoke logging:**

- Log harness kind, cwd mode (`none` or `sealed`), session storage root.
- Fail if any path under repo root or `/home/ubuntu` appears in model-visible prompt or pure harness config.

**Acceptance:** Pure mode has no host file authority, not just no model-visible file tools.

### BBA-013 — Implement pure no-filesystem mode

**Depends on:** BBA-012, BBA-014.

**Why:** This is the core user-facing ability: headless agents with app-owned tools only.

**Scope:**

- Add `runtime: none` or equivalent host composition.
- Register only chat/session/model routes and explicitly configured non-bash tools/hooks.
- No Workspace, Sandbox, FileSearch, cwd, file routes, git routes, file tools, bash, isolated code, upload/runtime artifact tools.
- Skip boot-time workspace/plugin discovery that requires cwd unless the host explicitly configures a safe non-bash plugin source.
- Ensure session history/list storage uses `sessionStorageRoot`/`BORING_AGENT_SESSION_ROOT`, never workspace or sandbox storage.

**Unit tests:**

- Pure app route list excludes file/tree/search/git/fs-events/upload routes.
- Tool catalog excludes read/write/edit/find/grep/ls/bash/execute_isolated_code/upload.
- Creating a session succeeds with app-owned non-file tool.
- Session listing/deletion/history work from host durable session root without a workspace root.

**E2E/smoke logging:**

- Start pure agent test server.
- Log route list and tool catalog.
- Send a prompt using only an app-owned echo/status tool.
- Assert no workspace root, repo root, sandbox cwd, or `/workspace` path appears in model-visible prompt, tool catalog, or pure-mode route diagnostics.
- Log session root and assert it is the configured host durable root.

**Acceptance:** Pure agent is usable and has no filesystem authority.

### BBA-015 — Add non-bash external hook ingestion API

**Depends on:** BBA-013.

**Why:** #380 external harnesses need review/question/approval hooks independent of files/bash.

**Scope:**

- Define and implement `ExternalAgentHookRequest` ingestion.
- Include source harness/session ids, kind, body, redaction policy, callback auth ref, and optional idempotency key to avoid duplicate hook creation on retries.
- Authenticate caller, validate target workspace/agent/session, redact before history write, route to UI/HITL channel, audit attribution.
- Treat callback auth references as secret references only; never log callback tokens or raw secret values.

**Unit tests:**

- Auth reject.
- Unknown session/workspace reject with stable error code.
- Duplicate idempotency key does not create a second hook.
- Redaction applied before persistence.
- Callback secret refs are not serialized to model-visible history/logs.
- Hook routes without boring-bash enabled.

**E2E/smoke logging:**

- Script creates review hook against pure agent session.
- Logs hook id, idempotency key hash, source ids, redaction count/result, routed UI event id, and callback status without secrets.

**Acceptance:** External hooks work in pure agents with no boring-bash.

### BBA-016 — Add non-bash operational command/event seam

**Depends on:** BBA-013.

**Why:** Slash commands, reload, compaction/provider recovery, and session notices are agent/session concerns, not bash concerns.

**Scope:**

- Add optional command/event contributor API.
- Ensure `/reload` or slash-command composition can call into dynamic host context without requiring Workspace/Sandbox in pure mode.
- Store operational events in session history/event stream now, and expose enough metadata for later session-search indexing without requiring the search subsystem to exist yet.
- Keep stable error codes.

**Unit tests:**

- Operational command executes in pure mode.
- Provider recovery/compaction event records in session history or event stream without filesystem.
- Later search indexing can consume the event without changing its shape.

**E2E/smoke logging:**

- Trigger operational command; log command id, agent id, session id, event id, result/error code, and whether a workspace/runtime was requested.

**Acceptance:** Operational commands do not depend on boring-bash.
