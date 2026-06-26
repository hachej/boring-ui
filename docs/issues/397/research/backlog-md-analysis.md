# Backlog.md analysis for a Seneca/background-agent task layer

Scope: read-only analysis of `/tmp/backlog-md-E8dOkD/Backlog.md` as inspiration. No project files modified except this report.

## High-value evidence

### Product/workflow surface
- `README.md:19-21` positions Backlog.md as markdown-native and AI-ready; `README.md:63` says data is project-local in `backlog/`, `.backlog/`, or configured via `backlog.config.yml`, with Git optional via `--no-git`.
- `README.md:59-60`, `README.md:70`, `AGENTS.md:82-93`, `CLI-INSTRUCTIONS.md:25` establish the core agent nudge: agents should read `backlog instructions overview`; agents must use CLI/MCP/Web rather than editing task markdown directly.
- `README.md:118` explicitly recommends command surfaces over manual edits so metadata stays consistent; also calls out `modified_files`, comments, Implementation Notes, and Final Summary as agent-useful fields.
- `CLI-INSTRUCTIONS.md:39-55` shows task create API breadth: title, description, assignee, status, labels, priority, plan, acceptance criteria, Definition of Done, notes, dependencies, references, docs, parent tasks. `CLI-INSTRUCTIONS.md:168-180` covers drafts and dependencies.

### Data model and markdown format
- `src/types/index.ts:39-75` defines `Task`: id/title/status/assignee/reporter/dates/labels/milestone/dependencies/references/documentation/modifiedFiles plus description, implementationPlan, implementationNotes, comments, finalSummary, AC, DoD, parent/subtasks, priority, ordinal, source, onStatusChange.
- `src/types/index.ts:103-165` separates `TaskCreateInput` and `TaskUpdateInput`; update supports add/remove/check/uncheck list operations and append fields, not just replace-all.
- `backlog/tasks/back-470.1 - Core-task-comment-model-and-markdown-persistence.md` is a good canonical task file: YAML frontmatter, then sentinel-delimited sections (`<!-- SECTION:DESCRIPTION:BEGIN -->`, `<!-- AC:BEGIN -->`, `<!-- SECTION:PLAN:BEGIN -->`, etc.).
- `src/markdown/parser.ts:147-198` parses YAML frontmatter and structured body sections into the `Task` model. `src/markdown/serializer.ts:49-120` serializes frontmatter and updates only changed structured sections, preserving raw content where possible.
- `src/constants/index.ts:4-29` defines storage folders: `tasks`, `drafts`, `completed`, `archive/tasks`, `archive/drafts`, `milestones`, `docs`, `decisions`. `src/file-system/operations.ts:199-217` creates that tree.
- `src/file-system/operations.ts:289-343` writes task markdown with filename `<id> - <sanitized-title>.md` and normalizes IDs while preserving existing file identity on updates. `src/file-system/operations.ts:362-407` lists tasks by glob + parser; `:409-480` does the same for completed/archived.
- `src/file-system/operations.ts:234-286` uses a lockfile around create/promote/demote ID allocation. `src/core/backlog.ts:780-845` generates next IDs, including subtasks and optional zero-padding. This is worth copying conceptually for concurrent background agents.

### CLI/API/MCP/Web surfaces
- CLI: `src/cli.ts` is large, but public docs are clearer. `CLI-INSTRUCTIONS.md` documents stable commands: `init`, `task create/list/view/edit/archive`, `draft`, `milestone`, `doc`, `decision`, `search`, `board`, `browser`, `instructions`.
- MCP: `src/mcp/tools/tasks/index.ts:10-100` registers `task_create`, `task_list`, `task_search`, `task_edit`, `task_view`, `task_archive`, `task_complete`. `src/mcp/tools/tasks/handlers.ts:63-146` routes create/list through the same core model, validates, and formats tool results.
- MCP workflow resources: `src/mcp/workflow-guides.ts:32-66` defines `backlog://workflow/overview`, `task-creation`, `task-execution`, `task-finalization`; `src/mcp/resources/workflow/index.ts:5-24` exposes them as resources.
- MCP project discovery: `src/mcp/server.ts:116-260` supports MCP roots, upgrades from fallback/init-required to a discovered project, and registers full tools only after valid config. Good pattern for multi-workspace Seneca clients.
- Web UI/API: `src/server/index.ts:274-390` starts a local Bun server, exposes SPA routes and REST endpoints for tasks/docs/decisions/drafts/milestones/search/statistics; `:258-270` broadcasts WebSocket `tasks-updated`/`config-updated`; `:633-685` handles task list filters; `:687+` handles search. `README.md:126-151` describes browser kanban/CRUD.
- Agent instruction injection: `src/agent-instructions.ts:124-180` appends managed instruction blocks to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, replacing older Backlog-managed sections.

### Current boring-ui/Seneca integration constraints
- Agent tool contract is `packages/agent/src/shared/tool.ts:10-34`: `AgentTool` has `name`, `description`, JSON schema `parameters`, and `execute(params, ctx)` returning text content; ctx includes abort signal, toolCallId, onUpdate, sessionId.
- Supported custom tool paths: `packages/agent/docs/tools.md:40-88` says use `createAgentApp({ extraTools })`, trusted `defineServerPlugin({ agentTools })`, or hot-reloadable Pi resources. For a sovereign task layer, a trusted server plugin is the likely fit; runtime plugins cannot add durable server routes.
- Workspace plugin constraints: `packages/workspace/docs/README.md:17-30` and `PLUGIN_SYSTEM.md:43-56` distinguish trusted app/internal plugins from route-free `.pi/extensions`; plugin tools execute in host Node and bypass sandbox. Do not put untrusted task-storage code in runtime plugins.
- UI integration: `packages/workspace/docs/README.md:20-25` and `docs/WORKSPACE_CONTRACT.md:96-100` show agents/servers should use `UiBridge`/SSE or app-hosted routes for UI updates. A task pane should be a workspace front plugin/surface resolver, not an agent-package import.

## What to copy for Seneca
1. **Local-first, repo/workspace-local markdown store.** Keep tasks human-readable and portable. Store under a predictable folder such as `.seneca/tasks/` or `.pi/tasks/`, with config at root or task folder.
2. **Single canonical core service.** Backlog’s CLI, MCP, Web server, and TUI all route through a shared `Core`/`FileSystem` layer. Seneca should avoid separate implementations for background agents, CLI, web UI, and MCP.
3. **Structured markdown with raw-content preservation.** Frontmatter for queryable metadata; sentinel sections for plan/notes/final summary/AC/DoD/comments. This is agent-friendly and diff-friendly.
4. **Command-first mutation policy.** Explicitly tell agents not to edit task markdown directly; provide tools/CLI/API that preserve IDs, indexes, dates, and section order.
5. **Agent workflow guides as first-class resources.** Copy the idea of `instructions overview` plus task creation/execution/finalization resources. In boring-ui this can be Pi skill/resource text and/or trusted task tools.
6. **Concurrency locks for create/promote/demote.** Background agents will create tasks concurrently; copy the lock concept around ID allocation and file moves.
7. **Modified-files/references/docs fields.** Very useful for background agents: tasks can claim affected paths and later support search/impact review.
8. **Multiple surfaces over one store.** CLI for scripts, AgentTool/MCP-like tools for agents, REST routes for Web UI, and a workspace plugin pane.

## What to avoid or adapt
- **Avoid copying Backlog’s Bun-specific server/CLI wholesale.** Seneca/boring-ui is pnpm/Fastify/React/workspace-plugin oriented; integrate through trusted workspace server plugins and existing `AgentTool` contracts.
- **Do not depend on Backlog source APIs.** Backlog’s own `AGENTS.md:50-55` says only CLI/MCP/instruction surfaces are public. Treat code as inspiration, not a library.
- **Avoid excessive Git branch scanning as v1.** Backlog has cross-branch/remote ID logic (`src/core/backlog.ts:847-900`); sovereign local Seneca likely needs simpler per-workspace local persistence first. Add Git awareness later if needed.
- **Avoid runtime plugin server routes for task storage.** boring-ui runtime plugins are route-free and trusted only as local code (`PLUGIN_SYSTEM.md:43-56`); use app/internal plugin or app-shell composition.
- **Avoid manual markdown as the primary write path.** Keep markdown editable for recovery, but agents/UI should mutate through typed commands to prevent corrupting indexes/markers.

## Suggested Seneca shape
- Package/plugin: trusted internal `seneca-tasks` workspace server plugin with `agentTools` (`task_create`, `task_list`, `task_view`, `task_update`, `task_comment`, `task_complete/archive`, `task_search`) and Fastify routes (`/api/v1/tasks/*` or plugin-scoped route).
- Front UI: workspace front plugin panel/left tab for task list/kanban/detail; surface resolver for `openSurface({kind: 'task', target: id})`.
- Storage: local workspace folder; markdown files with YAML frontmatter and sentinel sections; lock around ID allocation; parser/serializer preserves unknown sections.
- Agent instructions: Pi skill/resource: “read task workflow overview; use task tools; one active task per background worker; write plan before implementation; update notes/final summary; do not edit task files directly.”
- Validation: unit tests for parser/serializer, create/update/list/search, lock/concurrent create, route/tool behavior, and a small workspace plugin smoke for opening a task panel.
