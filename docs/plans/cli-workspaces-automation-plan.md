# CLI workspaces-mode automation plan

## Problem Statement

`@hachej/boring-automation` is shipped by `@hachej/boring-ui-cli` and works in single-folder CLI mode, but the local workspaces hub deliberately excludes it. The hub serves multiple workspace roots through one Fastify process; the automation plugin's fixed HTTP route prefix and fixed file store cannot be registered once per workspace without an explicit request-to-workspace dispatch seam.

The user wants Automations available for the local `boring-ui-v2` project in the systemd-managed workspaces hub, without losing the hub or risking cross-workspace runs.

## Solution

Add a CLI-owned, request-scoped automation adapter for workspaces mode. It registers the automation HTTP prefix once, resolves the target local workspace using the established hub workspace-id resolver, and creates/selects that workspace's file-backed automation store and agent dispatcher. Then expose the existing automation front plugin in workspaces mode.

Do not change the automation plugin's public route contract or add a background scheduler.

## User Stories / Scenarios

1. In the hub, selecting `boring-ui-v2` shows the Automations tab.
2. Creating/listing prompts and automations affects only `<selected-workspace>/.pi/automation`.
3. Manual **Run now** uses the selected workspace's agent runtime and records its resulting Pi session/run in that workspace's store.
4. Requests with a missing, unavailable, or unknown workspace id fail before touching an automation store.
5. The local due endpoint requires an explicit workspace selection and runs only that workspace's due automations; it never sweeps all hub workspaces.
6. Folder mode remains behaviorally unchanged.

## Decisions

- Reuse `automationRoutes`, `FileAutomationStore`, and `ManualRunExecutor`; do not fork plugin route behavior into the CLI.
- Register one hub route set with per-request store/actor/dispatcher resolution rather than mounting duplicate plugin routes per workspace.
- Capture the existing trusted `onWorkspaceAgentDispatcher` callback from `registerAgentRoutes`; wrap it only after `requireWorkspace` has validated the request-selected workspace and use the local CLI actor for that workspace.
- File stores live at `<workspaceRoot>/.pi/automation`, as they do in folder mode.
- Extend the automation route seam with a request-scoped due-run resolver. Today `storeForRequest` intentionally disables `DueRunService`, because it has no request-scoped store/executor factory; a hub must create it after resolving the selected workspace.
- Preserve the existing loopback-only guard on `POST /api/v1/boring-automation/due`; additionally require the normal hub workspace selector.
- No autonomous timer or cross-workspace scheduler sweep. A cron caller must send the target workspace id.

## Flag / Abstraction

- Needed?: No runtime feature flag. The existing `workspacesMode` composition boundary is the rollout seam.
- Path: CLI workspaces-mode automation adapter, consumed only when the hub is running.
- Rollback: remove the automation front composition and adapter from a patch release; existing per-workspace automation files remain inert and untouched.

## Test Seams

- Highest public seam: `createWorkspacesModeApp` via Fastify injection with `x-boring-workspace-id`.
- Existing prior art: folder-mode automation coverage in `packages/cli/src/__tests__/folderModeRuntimePlugins.test.ts`; request-scoped stores in `plugins/boring-automation/src/server/index.ts`.
- Avoid testing: real provider/model execution and system cron. Stub the workspace dispatcher and assert actor/store selection.

## Acceptance

- Workspaces-mode plugin list includes `boring-automation` and its front target serves.
- Automation CRUD for workspace A is absent from workspace B and is persisted under only workspace A's `.pi/automation` root.
- A manual run resolves the dispatcher for workspace A, never B.
- Due requests without a workspace selector fail; a loopback request for A evaluates only A.
- Existing folder-mode automation tests remain green.
- The CLI front no longer hides `boringAutomationPlugin` when `workspacesMode` is true.

## Proof

- Exact command: `pnpm --filter @hachej/boring-ui-cli test`
- Exact command: `pnpm --filter @hachej/boring-ui-cli typecheck`
- Screenshot/demo: hub on port 5213, select `boring-ui-v2`, verify the Automations tab; create a draft and verify `.pi/automation` exists only in that workspace.
- Manual steps: send an authenticated/local hub request with the workspace header to list/create/run an automation, then repeat with another workspace and verify isolation.
- Waiver: no live scheduled/provider execution is required for this slice; dispatcher behavior is exercised with a deterministic test double.

## Slices

### Slice: Request-scoped hub automation adapter

**Delivers:** A single registered automation route surface that resolves workspace store and manual dispatcher per request, plus explicit-target due behavior.

**Blocked by:** None. `registerAgentRoutes` already exposes `onWorkspaceAgentDispatcher`; the CLI hub can capture it and guard it with `requireWorkspace` before use.

**Proof:** Fastify workspaces-mode integration tests cover A/B store isolation, missing-selector rejection, dispatcher selection, and due targeting.

**Review budget:** Exceeds a trivial change but inside one focused PR; it changes local execution routing and needs security/spec review.

### Slice: Hub front composition and release rollout

**Delivers:** Automations tab visible in workspaces mode; package/release proof and systemd hub rollout after the implementation PR lands.

**Blocked by:** Request-scoped adapter slice.

**Proof:** CLI front composition test plus local 5213 screenshot/manual proof after release.

**Review budget:** Inside a focused follow-up or may be combined with Slice 1 if the diff remains small.

## Wide Refactor Strategy

Not a wide mechanical refactor. Keep the adapter at the CLI hub boundary; do not migrate the automation plugin's existing folder/full-app paths.

## Out of Scope

- Background scheduler, all-workspace due sweep, missed-run backfill.
- Hosted/Postgres automation changes.
- Authentication model changes beyond existing local CLI policy.
- Changing existing automation API paths or automation file format.

## Open Questions

1. Should the hub's loopback cron invoke the due route with `x-boring-workspace-id`, or should a dedicated query parameter be documented for non-browser callers? Default proposal: support the existing header/query workspace selector consistently.
