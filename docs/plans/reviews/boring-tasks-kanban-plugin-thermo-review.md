# Thermo review — boring-tasks Kanban plugin plan

Source plan: [`../boring-tasks-kanban-plugin-plan.md`](../boring-tasks-kanban-plugin-plan.md)

Reviewer: subagent `reviewer`

## Verdict

The plan is directionally correct, but the first draft had several implementation-risk gaps that could push the future PR into host-shell special-casing, premature provider abstraction, or unsound drag/drop behavior. The plan was revised to address the blockers below.

## Findings and resolutions

### High — Slice 1 depended on unresolved app-left/explorer API

**Risk:** Implementation could stall or sneak task-specific wiring into `WorkspaceAgentFront` while waiting for PR #438.

**Resolution:** Added a hard precondition: do not start implementation until PR #438 lands and documents the plugin-owned app-left/explorer contribution API. The plan now explicitly blocks app-shell prop injection and task-specific host wiring.

### High — Provider registry seam was underspecified

**Risk:** Routes could directly import the mock provider, making later app-owned DB/auth providers awkward and leaking core auth into a generic plugin.

**Resolution:** Added an injected server factory shape:

```ts
createBoringTasksServerPlugin({ providers, resolveWorkspaceContext })
```

The playground/dev app injects the mock provider; hosted apps inject their own providers.

### High — Drag/drop scope exceeded the provider contract

**Risk:** The original plan allowed within-column drag while the provider contract only moved statuses, so ordering could not persist.

**Resolution:** Scoped v1 to cross-column status moves only. Within-column reorder is not persisted and must be disabled or snap back until an ordering contract exists.

### Medium-high — Workspace scoping was asserted but not specified

**Risk:** Mock or future provider state could become global/cross-workspace.

**Resolution:** Added `BoringTaskProviderContext` with `workspaceId`, `actorId`, and `requestId`, plus route tests proving workspace isolation.

### Medium — Provider interface was too broad for Slice 1

**Risk:** Premature generic issue-tracker abstraction before real providers exist.

**Resolution:** Reduced Slice 1 capabilities to `list` and `move` only. Create/comment/assign/close are deferred until a real route/tool slice needs them.

### Medium — Fixed four-column schema could be too rigid

**Risk:** External workflows like Linear/Plane can have arbitrary states.

**Resolution:** Documented the four statuses as the intentionally fixed v1 board schema. Providers that cannot safely map native states must be read-only until configurable columns exist.

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
