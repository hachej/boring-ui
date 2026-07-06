# Boring Tasks Generic Backend Move Plan

## Goal

Make task drag/drop mutations backend-mediated and generic:

```txt
Kanban UI -> generic boring-tasks API -> task source service -> source registry -> adapter.moveTask() -> native last mile
```

The route must not know about GitHub, Kata, Linear, or any future tracker. It only receives `sourceId`, `taskId`, and generic `statusId`.

## Non-goals

- No browser-held GitHub credentials.
- No direct frontend dependency on agent tool/runtime surfaces.
- No GitHub-specific behavior in Kanban components.
- No broad workspace architecture refactor.

## Route/API shape

Trusted `boring.server` routes in `@hachej/boring-tasks`:

```txt
GET  /api/boring-tasks/sources
POST /api/boring-tasks/sources/tasks/list
POST /api/boring-tasks/sources/tasks/move
```

Use exact route paths because runtime plugin routes do not support path params.

Bodies:

```ts
// list
{ sourceIds?: string[] }

// move
{ sourceId: string; taskId: string; statusId: string }
```

Responses reuse shared plugin contracts while preserving frontend compatibility:

```ts
BoringTaskSourceSummary[]
{ configs: Record<string, BoringTaskBoardConfig>; tasks: BoringTaskCard[] }
{ task: BoringTaskCard }
```

## Service boundary

Routes are deliberately thin:

```ts
listSources(ctx)
listTasks(ctx, { sourceIds })
moveTask(ctx, { sourceId, taskId, statusId })
```

They only validate JSON, construct request context, call the service, and serialize typed responses. Source-specific logic lives behind source implementations.

## Shared/front identity contract

The existing frontend model still says `adapterId`. For this PR, HTTP sources map one-to-one to frontend adapters:

```txt
source.id === frontAdapter.id === board.config.adapterId === card.adapterId
```

This avoids changing the whole board identity model in the same PR. A later cleanup can rename `adapterId` to `sourceId` once backend sources are first-class everywhere.

## Server source contract

Do not extend the frontend `BoringTaskAdapter` on the server. Use a server-specific source port with context:

```ts
interface BoringTaskSourceRuntime {
  summary(): BoringTaskSourceSummary
  getBoardConfig(ctx): Promise<BoringTaskBoardConfig>
  listTasks(ctx): Promise<BoringTaskCard[]>
  moveTask?(ctx, input): Promise<BoringTaskCard>
}
```

This keeps request/workspace/auth context on the backend side only.

## Frontend bridge

Add `createHttpTaskAdapter(sourceSummary)` as the only front bridge. It implements the current `BoringTaskAdapter` by calling the generic source routes. `TaskKanbanBoard` remains adapter-agnostic.

`TasksOverlay` should discover backend sources via `/api/boring-tasks/sources`. It should not hardcode GitHub. If discovery fails, it can keep the existing mock/direct public GitHub demo adapters as fallback.

## GitHub last mile

The GitHub source owns private status mapping config. Generic `BoringTaskColumn` remains UI-only.

Example private mapping:

```ts
{
  active: { addLabels: ["state:active"], removeStateLabels: true },
  ready: { addLabels: ["state:ready"], removeStateLabels: true },
  blocked: { addLabels: ["state:blocked"], removeStateLabels: true },
  queued: { addLabels: [], removeStateLabels: true },
  done: { close: true, removeStateLabels: true },
}
```

Use an injectable GitHub executor port around `gh` CLI today:

```ts
interface GitHubIssueExecutor {
  listIssues(input): Promise<GitHubIssue[]>
  moveIssueStatus(input): Promise<GitHubIssue>
}
```

Later the executor can swap to GitHub REST/GraphQL without changing UI, routes, or source service.

## Error behavior

- Unknown source: stable 404 response.
- Unsupported move: stable 400/409 response.
- Unknown status: stable 400 response.
- Native GitHub/CLI/auth failures: stable 500 response with safe message.
- Do not leak raw command args, tokens, or stderr containing secrets.

## Tests

Add focused tests for pure backend logic:

- service routes unknown source through stable response
- source registry capability enforcement
- GitHub status mapping: queued/active/ready/blocked/done
- move body validation
- HTTP adapter routes moves through `sourceId === adapter.id`

Run:

```bash
pnpm --filter @hachej/boring-tasks typecheck
pnpm --filter @hachej/boring-tasks test
pnpm --filter @hachej/boring-tasks build
```

## Risks

- `gh` CLI may be unauthenticated in a deployment. The route should return a clear error; hosted production can later use GitHub App credentials/API.
- Runtime plugin routes are exact only, so path-param style APIs must be represented as exact endpoints with JSON bodies.
- GitHub label mutation is not transactional across remove/add/close. The executor should re-read/return the final issue after mutation where feasible to avoid UI drift.
