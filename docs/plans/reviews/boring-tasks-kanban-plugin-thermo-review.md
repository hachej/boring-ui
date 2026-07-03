# Thermo review — boring-tasks Kanban plugin plan

Source plan: [`../boring-tasks-kanban-plugin-plan.md`](../boring-tasks-kanban-plugin-plan.md)

Reviewer: subagent `reviewer`

## Verdict

The plan is directionally correct, but the first draft had several implementation-risk gaps that could push the future PR into host-shell special-casing, premature adapter abstraction, or unsound drag/drop behavior. The plan was revised to address the blockers below.

## Findings and resolutions

### High — Slice 1 depended on unresolved app-left/explorer API

**Risk:** Implementation could stall or sneak task-specific wiring into `WorkspaceAgentFront` while waiting for PR #438.

**Resolution:** Added a hard precondition: do not start implementation until PR #438 lands and documents the plugin-owned app-left/explorer contribution API. The plan now explicitly blocks app-shell prop injection and task-specific host wiring.

### High — Adapter registry seam was underspecified

**Risk:** Routes could directly import the mock adapter, making later app-owned DB/auth adapters awkward and leaking core auth into a generic plugin.

**Resolution:** Added an injected server factory shape:

```ts
createBoringTasksServerPlugin({ adapters, resolveWorkspaceContext })
```

The playground/dev app injects the mock adapter; hosted apps inject their own adapters.

### High — Drag/drop scope exceeded the adapter contract

**Risk:** The original plan allowed within-column drag while the adapter contract only moved statuses, so ordering could not persist.

**Resolution:** Scoped v1 to cross-column status moves only. Within-column reorder is not persisted and must be disabled or snap back until an ordering contract exists.

### Medium-high — Workspace scoping was asserted but not specified

**Risk:** Mock or future adapter state could become global/cross-workspace.

**Resolution:** Added `BoringTaskAdapterContext` with `workspaceId`, `actorId`, and `requestId`, plus route tests proving workspace isolation.

### Medium — Adapter interface was too broad for Slice 1

**Risk:** Premature generic issue-tracker abstraction before real adapters exist.

**Resolution:** Reduced Slice 1 capabilities to optional mutations only (`move` for v1); listing is implied by `listTasks()`. Create/comment/assign/close are deferred until a real route/tool slice needs them.

### Medium — Fixed four-column schema could be too rigid

**Risk:** External workflows like Linear/Plane can have arbitrary states.

**Resolution:** Superseded by the final plan: columns are adapter-configured from the start via `getBoardConfig()`. Adapters that cannot safely move between native states must set `capabilities.move = false` or mark specific columns with `acceptsDrop: false`.

### Medium — Package skeleton missed canonical plugin files

**Risk:** Implementation could drift from repository plugin conventions.

**Resolution:** Updated the skeleton to include canonical app/internal plugin package files: README, tsup config, vitest config, and `src/front|server|shared`.

### Medium — Test commands omitted the new plugin package

**Risk:** Plugin could be untyped/untested while workspace tests pass.

**Resolution:** Added expected `@hachej/boring-tasks` typecheck/test gates.

### Low — Error contract was vague

**Resolution:** Added initial stable error codes.

## Residual risk

The plan is still blocked on PR #438 finalizing the app-left/explorer contribution API. That is intentional: any implementation before that API lands risks adding exactly the shell special-casing this plugin is supposed to avoid.


## Claude Code local review follow-up

A local Claude Code review on the PR branch found that this review artifact was stale after the plan moved from fixed columns/providers to adapter-configured columns/adapters. The stale wording was corrected, and the plan was clarified around opening surface choice, pagination, freshness/staleness, adapter selector acceptance, `number` semantics, and `adapterId` rationale.
