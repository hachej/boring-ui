# boring-tasks Kanban plugin plan

## Status

Planning PR. No implementation in this slice.

This plan depends on the plugin app-left/explorer contribution work in PR #438 (`feat(workspace): add inbox shell plugin architecture`). **Do not start implementation slice 1 until #438 lands and documents the public plugin-owned app-left/explorer contribution API.** If #438 changes the final API names, keep the architecture below and update names during implementation.

## Problem

boring-ui needs a task surface that is not tied to one tracker. The same Kanban board should be able to display and move tasks from:

- boring-ui-native Postgres tasks;
- GitHub Issues;
- Linear;
- Kata;
- Plane;
- a custom API or static/dev task list.

The first user-visible requirement is intentionally small:

- a standard task card with a number, title, and description;
- a Kanban board;
- drag-and-drop between columns.

## Goal

Create a dedicated plugin package, `boring-tasks`, that owns a universal task-board UI and talks to task sources through provider adapters.

The first implementation slice should prove the plugin and UI shape with a mock/in-memory provider. Persistence and external providers come later.

## Non-goals

- No full Jira/Linear clone in the first slice.
- No boring-ui database migration in the first slice.
- No GitHub, Linear, Kata, or Plane credentials in the first slice.
- No task-specific branches in `WorkspaceAgentFront`.
- No runtime-generated plugin route registration; this is an app/internal trusted plugin when backend providers are needed.
- No attempt to make every provider support every mutation. Read-only providers are valid.

## Required architecture

### 1. Dedicated app/internal plugin

Create the package at:

```txt
plugins/boring-tasks/
  package.json
  src/shared/types.ts
  README.md
  tsup.config.ts
  vitest.config.ts
  src/front/index.tsx
  src/front/TaskKanbanBoard.tsx
  src/front/TaskKanbanColumn.tsx
  src/front/TaskCard.tsx
  src/front/taskBoardModel.ts
  src/front/useTaskBoardData.ts
  src/server/index.ts
  src/server/providers/mockProvider.ts
```

The plugin is app/internal because later providers need trusted server-side credentials and routes. A future runtime/generated frontend-only demo can consume the same shared model, but should not be the canonical hosted integration. Generate the package from the canonical app/internal plugin shape (`boring-ui-plugin create boring-tasks --path plugins`) rather than inventing a custom layout.

### 2. App-left/explorer contribution, not host special-casing

Use the app-left/explorer contribution model introduced by PR #438:

- `boring-tasks` contributes a `Tasks` app-left action.
- The action opens plugin-owned board content using the public #438 contribution API.
- No app-shell prop injection is allowed as a substitute for plugin registration.
- `WorkspaceAgentFront` remains generic and contains no `boring-tasks` or task-board branch.
- The board renders inside the `WorkspaceProvider`/plugin provider topology, matching the Inbox plugin precedent.

If #438 lands with a different output name than `appLeftActions`, adapt the name but preserve the ownership rule: the plugin registers the entry; the shell hosts it.

### 3. Standard task card contract

Define small normalized models in `src/shared/types.ts`. Columns are data, not code. A task carries a status tag/id, and the board configuration decides which status tags appear as columns and in what order.

```ts
export type BoringTaskStatusId = string;

export interface BoringTaskColumn {
  id: BoringTaskStatusId;
  title: string;
  description?: string;
  color?: string;
  order: number;
  acceptsDrop?: boolean;
}

export interface BoringTaskBoardConfig {
  providerId: string;
  columns: BoringTaskColumn[];
  defaultColumnId?: BoringTaskStatusId;
}

export interface BoringTaskCard {
  id: string;
  number: string;
  title: string;
  description?: string;
  statusId: BoringTaskStatusId;
  providerId: string;
  url?: string;
}

// Later slices may add non-required display metadata such as assignee, labels,
// and priority after a real provider needs them.
```

Keep the initial card UI constrained to:

```txt
[number]
[title]
[description]
```

Do not expose provider-native shapes to the frontend card component. Provider-native payloads may stay server-side or in an explicitly non-rendered debug field later.

### 4. Provider boundary

Define a backend provider interface. Keep it narrow until real providers require more. Providers are injected at boot; the generic plugin must not directly own hosted DB/auth/secret resolution:

```ts
export interface BoringTaskProviderContext {
  workspaceId: string;
  actorId?: string;
  requestId: string;
}

export interface BoringTasksServerPluginOptions {
  providers: BoringTaskProvider[];
  resolveWorkspaceContext(request: unknown): Promise<BoringTaskProviderContext>;
}

export function createBoringTasksServerPlugin(
  options: BoringTasksServerPluginOptions,
): WorkspaceServerPlugin;

export interface BoringTaskProvider {
  id: string;
  label: string;
  capabilities: {
    list: true;
    move: boolean;
  };
  getBoardConfig(ctx: BoringTaskProviderContext): Promise<BoringTaskBoardConfig>;
  listTasks(ctx: BoringTaskProviderContext): Promise<BoringTaskCard[]>;
  moveTask?(ctx: BoringTaskProviderContext, input: {
    taskId: string;
    statusId: BoringTaskStatusId;
  }): Promise<BoringTaskCard>;
}
```

Provider rules:

- Providers expose their available status tags/columns through `getBoardConfig()`.
- The playground/dev app injects `createMockTaskProvider()`; hosted apps inject DB or external providers.
- Providers declare `capabilities.move`; the UI disables drag for providers that cannot move tasks.
- Providers may normalize native statuses (`GitHub labels`, `Linear states`, `Kata status/claim`, custom DB enum) into stable `statusId` values, but the UI must not hardcode a global status enum.
- Provider failures revert optimistic UI changes.
- Credentials and provider-native API clients stay on the server.
- Additional capabilities (`create`, `comment`, `assign`, `close`) are added only in the slice that introduces the corresponding route/tool.

### 5. Kanban implementation

Use `@dnd-kit` directly rather than a heavy Kanban framework:

```txt
@dnd-kit/core
@dnd-kit/sortable
@dnd-kit/utilities
```

Use shadcn-style layout primitives from `@hachej/boring-ui-kit` where possible. The Georgegriff React + dnd-kit + Tailwind + shadcn Kanban demo is a useful reference, not a dependency to vendor wholesale.

Board behavior:

1. Fetch provider board config and render its columns in `order`.
2. Group cards by `statusId`.
3. Provide a provider/status selector bar so the user can switch provider and, later, filter by status/tag.
4. Support cross-column status moves. Within-column reordering is not persisted in v1 and should be disabled or snap back.
5. Optimistically move the card.
6. Call the backend move route.
7. Revert and show a toast/inline error if the backend rejects.

### 6. Routes

First implementation slice needs only:

```txt
GET  /api/boring-tasks/providers
GET  /api/boring-tasks/providers/:providerId/board
GET  /api/boring-tasks/providers/:providerId/tasks
POST /api/boring-tasks/providers/:providerId/tasks/:taskId/move
```

Route responses should use stable error codes and typed JSON contracts. Initial codes:

- `BORING_TASK_PROVIDER_NOT_FOUND`
- `BORING_TASK_MOVE_UNSUPPORTED`
- `BORING_TASK_NOT_FOUND`
- `BORING_TASK_MOVE_FAILED`
- `BORING_TASK_WORKSPACE_REQUIRED`

Do not leak provider credentials or raw provider errors to the browser.

### 7. Workspace/provider context

Every request must resolve a `BoringTaskProviderContext` before touching provider state. Even the mock provider should be workspace-scoped so the first slice does not bake in a global task board assumption. Route tests must prove tasks and moves are isolated by workspace.

For hosted/core apps, later Postgres-backed tasks should use boring-core workspace membership and auth; the task plugin should not invent its own auth model.

## Implementation slices

### Slice 1 — UI and mock provider

- Add `plugins/boring-tasks` package.
- Add shared task card/status types.
- Add injected mock provider with sample cards, registered by workspace playground/dev app.
- Add server plugin routes for provider list, board config, task list, and move.
- Add front plugin app-left/explorer contribution named `Tasks`.
- Add a provider selector/status toolbar.
- Add `TaskKanbanBoard`, `TaskKanbanColumn`, and `TaskCard`.
- Implement drag/drop with optimistic move/revert.
- Register plugin in workspace playground for development.

Acceptance:

- `Tasks` appears through plugin-owned app-left/explorer contribution.
- Opening `Tasks` shows the columns returned by the selected provider's board config.
- Cards display number, title, and description.
- Cards can be dragged across columns.
- Within-column reorder is disabled or snaps back.
- Move calls the provider boundary, not local-only hardcoded mutation.
- No task-specific branches in `WorkspaceAgentFront`.

### Slice 2 — provider hardening

- Add provider capability display/read-only behavior.
- Keep create/comment/assign/close out of the provider contract unless this slice introduces those routes.
- Add status/column mapping helpers.
- Add empty/loading/error states.
- Add tests for provider routing, frontend grouping, and move/revert behavior.
- Add plugin README documenting provider contracts.

Acceptance:

- Read-only providers render but do not allow drag.
- Failed moves revert the card.
- Provider list/board/tasks/move routes have typed tests.

### Slice 3 — boring-ui-native Postgres provider

- Add Postgres schema for workspace tasks, comments, events, and labels.
- Add `custom-db` or `boring-db` provider.
- Use boring-core workspace/auth boundaries.
- Add agent tools: list, create, claim/move, comment, close.
- Add CLI/API design after the backend contract settles.

Acceptance:

- Hosted boring-ui can persist tasks in its own Postgres.
- The Kanban board uses the same provider interface as the mock provider.
- Agent tools use the same task service layer as routes.

### Slice 4 — external providers

Add providers one at a time:

1. GitHub Issues read-only, then status-label/close support.
2. Kata via backend adapter if needed.
3. Linear via API.
4. Plane/custom API.

Each external provider must document auth, status/column mapping, mutation support, and failure semantics. Columns are provider-supplied from the start. Providers that cannot safely move between native states should set `capabilities.move = false` or mark specific columns with `acceptsDrop: false`. Provider docs must state whether native status mapping is lossy and whether moves are safe.

## Testing plan

First implementation PR should include:

- unit tests for task grouping and status/column mapping;
- route tests for provider list/board/task list/move;
- component tests for card rendering and move callback;
- one workspace-playground e2e smoke test for opening the Tasks action and dragging a card if the test harness can make drag deterministic.

Relevant commands will likely be:

```bash
pnpm --filter @hachej/boring-tasks typecheck
pnpm --filter @hachej/boring-tasks test
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter workspace-playground test
```

Narrow these once the files exist.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Generic provider abstraction becomes too abstract | Keep v1 provider contract tiny: board config, list, and move only. Add methods only when a real provider needs them. |
| Board leaks provider-native concepts | Normalize at provider boundary; card receives only `BoringTaskCard`. |
| Host shell gets task-specific branches | Depend on #438 app-left/explorer plugin outputs; block implementation if this requires host special-casing. |
| Drag/drop library complexity spreads | Contain `@dnd-kit` usage inside `TaskKanbanBoard` and child components. |
| External provider credentials leak | All provider calls are server-side; browser sees only normalized task contracts. |
| Hosted auth bypass | Later DB provider must use boring-core workspace membership/auth, not a plugin-local permission model. |

## Open questions

1. Final app-left/explorer contribution API name and opening surface after PR #438 lands. This is a hard precondition for implementation, not a detail to discover mid-slice.
2. Whether `boring-tasks` should live as a publishable `plugins/boring-tasks` package or app-local plugin first. Default: publishable plugin package because multiple apps may want it.
3. Whether the Postgres provider belongs in `boring-tasks` or a child-app adapter package. Default: keep provider interface in `boring-tasks`, allow app-owned provider registration later if core auth coupling gets heavy.

## Definition of done for implementation slice 1

- Dedicated `boring-tasks` plugin package exists with its own typecheck/test target.
- App-left/explorer `Tasks` action is plugin-owned.
- Provider-configured Kanban board renders mock tasks.
- Task card includes number, title, description.
- Drag/drop move flows through injected provider boundary and supports revert on failure.
- Tests cover model, route, and front behavior.
- No host shell task special-casing.

## Thermo review

Plan review is recorded in [`reviews/boring-tasks-kanban-plugin-thermo-review.md`](reviews/boring-tasks-kanban-plugin-thermo-review.md). The review's blocker findings were incorporated into this plan before opening the PR.
