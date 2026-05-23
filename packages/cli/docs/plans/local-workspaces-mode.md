# Local Workspaces Mode Plan

## Goal

Add a second CLI mode for users who want a persistent local boring-ui hub with multiple folder-backed workspaces.

Today the CLI behaves like an editor launcher:

```bash
boring-ui
boring-ui .
boring-ui ~/projects/foo
```

It should keep doing that. This remains the fast single-folder mode.

New mode:

```bash
boring-ui workspaces
```

Starts a local multi-workspace app where each workspace maps to one local folder. The workspace registry is stored in a user-local config file, not a database.

## Naming rationale

Surveyed common CLI conventions:

- VS Code / Cursor / Zed / JetBrains / Windsurf open folders directly:
  - `code .`
  - `cursor .`
  - `zed ~/project`
  - `idea ~/project`
  - `windsurf /path/to/project`
- Zed describes this as opening a directory as a workspace and uses flags like `--new` / `--reuse`.
- GitHub CLI uses resource nouns for managed entities:
  - `gh codespace create`
  - `gh codespace code`
- Claude Code uses session words for history (`--continue`, `--resume`), not applicable here.

Decision: use **folder arguments** for single-folder mode and **`workspaces`** as the resource noun for the local hub.

Avoid:

- `global` — sounds like global npm install/config, not a UI mode.
- `home` — friendly but less explicit.
- `hub` — product-y and vague.

## CLI shape

### Folder mode

```bash
boring-ui
boring-ui .
boring-ui ~/projects/foo
boring-ui --port 5200 ~/projects/foo
```

Behavior:

- Workspace root is the provided folder, defaulting to `process.cwd()`.
- App name is the folder basename unless overridden.
- Single workspace only.
- No workspace switcher required.
- Equivalent mental model to `code .` or `zed .`.

### Workspaces mode

```bash
boring-ui workspaces
boring-ui workspaces add ~/projects/foo
boring-ui workspaces list
boring-ui workspaces remove foo
boring-ui workspaces rename foo "Foo App"
```

Behavior:

- Starts a local multi-workspace app.
- UI includes a workspace switcher.
- Each workspace maps to one local folder.
- Adding/removing a workspace only edits the registry; it never deletes project files.
- Registry lives in user-local config.

## Config file

Path:

```txt
~/.boring-ui/workspaces.yaml
```

Initial shape:

```yaml
version: 1
workspaces:
  - id: boring-ui-v2
    name: boring-ui-v2
    path: /home/ubuntu/projects/boring-ui-v2
    createdAt: 2026-05-08T00:00:00.000Z
    updatedAt: 2026-05-08T00:00:00.000Z
```

Rules:

- `id` is stable and URL-safe.
- Generate ids as `<basename-slug>-<path-hash>` where `path-hash` is a short hash of the resolved absolute real path. This avoids collisions for folders with the same basename.
- `name` is display-only and editable.
- `path` is absolute.
- Missing file means empty registry.
- Invalid path entries are shown as unavailable, not removed automatically.
- Use atomic writes for registry updates.

## App behavior

### Folder mode app title

- App title = basename of workspace root.
- Example: `boring-ui ~/projects/foo` → `foo`.

### Workspaces mode app title

- App title = `Boring UI`.
- Active workspace title = workspace `name`.

### Workspace switching

On switch:

- Frontend stores the active workspace id in app shell state.
- `WorkspaceAgentFront` is remounted with `key={activeWorkspace.id}` and workspace-scoped storage keys.
- Frontend sends workspace id on API requests.
- Server resolves workspace id → local folder path from registry.
- Agent/session/file APIs use that folder as workspace root.

Decision: remount on workspace switch. Do not mutate a mounted workspace in-place. Remounting is simpler, prevents stale panels from showing files from the previous folder, and lets existing per-workspace layout/session keys restore the right state.

The implementation can mirror core multi-workspace UX, but should not require core auth/db.

## Current CLI vs workspace playground

The CLI does **not** run `apps/workspace-playground`.

Current split:

- `apps/workspace-playground` is a development fixture for `@hachej/boring-workspace`.
  - It runs Vite from the app source.
  - It seeds `apps/workspace-playground/workspace` from fixtures.
  - It mounts a playground-only data catalog plugin.
  - It is useful for package development and demos.
- `packages/cli` owns its own entrypoint in `packages/cli/src/index.ts`.
  - It calls `createWorkspaceAgentServer()` directly.
  - It serves its own prebuilt frontend from `packages/cli/public`.
  - It exposes `/api/v1/workspace/meta` itself.
  - It uses `process.cwd()` or `BORING_AGENT_WORKSPACE_ROOT` as the single folder-mode root.

Implication: `boring-ui workspaces` should be implemented in the CLI package, not by repurposing workspace-playground. Shared UI/server seams should move into `@hachej/boring-workspace` only when they are reusable outside the CLI.

## Session ownership

Do not store sessions in `~/.boring-ui/workspaces.yaml`.

Current workspace-playground session flow:

- Frontend uses `WorkspaceAgentFront` with `useSessions={useAgentSessions}`.
- `useAgentSessions` calls the agent session API:
  - `GET /api/v1/agent/sessions`
  - `POST /api/v1/agent/sessions`
  - `DELETE /api/v1/agent/sessions/:id`
- Browser localStorage only remembers the active session id per workspace key.
- Server-side session data is owned by the harness session store.
- The current Pi harness stores sessions under:

```txt
~/.pi/agent/sessions/--<sanitized-workspace-root>--/
```

For `boring-ui workspaces`, switching workspaces changes the resolved local folder/root; the harness/session layer remains responsible for listing, creating, loading, and deleting sessions for that root.

Do not rely only on the current path sanitization for multi-workspace mode. Sanitized paths can theoretically collide (for example, separators and literal dashes can collapse to the same string). Before shipping implementation, verify that session storage is scoped by the registry id/path hash. If the current harness only namespaces by sanitized cwd, add a required session namespace seam so the harness session directory includes the registry id/path hash, e.g.:

```txt
~/.pi/agent/sessions/local-workspace-<workspace-id>/
```

This is a release requirement for `boring-ui workspaces`, not an optional cleanup. The registry still does **not** store session data. It only provides the stable workspace id/name/path that the harness can use as a namespace.

The `~/.boring-ui/workspaces.yaml` registry only stores folder mappings and display metadata.

## Server design

Introduce a small local registry module in `packages/cli/src/`:

```ts
interface LocalWorkspaceRegistry {
  list(): Promise<LocalWorkspace[]>
  add(path: string, opts?: { name?: string }): Promise<LocalWorkspace>
  remove(id: string): Promise<void>
  rename(id: string, name: string): Promise<LocalWorkspace>
  get(id: string): Promise<LocalWorkspace | null>
}
```

For `boring-ui workspaces`, use **one server process** with **per-request workspace dispatch**. Do not start one server/process/port per workspace.

Do not use `createWorkspaceAgentServer()` as-is for workspaces mode. That factory is the single-folder convenience path: it creates one bridge, one `workspaceRoot`, and then calls the single-root agent app factory.

Instead, build a CLI workspaces server on the lower-level route seams and reusable helpers that support request-scoped workspaces:

- `registerAgentRoutes()` from `@hachej/boring-agent/server`
  - use `getWorkspaceId(request)` to extract the opaque registry id
  - use `getWorkspaceRoot(workspaceId, request)` to resolve id → registered absolute path
  - use `getSessionNamespace(ctx)` to force collision-proof session storage keyed by registry id/hash
  - use `getPi(ctx)` for per-workspace `.agents/skills` and other Pi adapter resource paths
  - use `getExtraTools(ctx)` to add workspace UI tools for that workspace
- local CLI helpers for safe `x-boring-workspace-id` parsing and `workspaceId -> WorkspaceBridge` caching
- `uiRoutes()` from `@hachej/boring-workspace/server`
  - use `getBridge(request)` to resolve the per-workspace UI bridge
- CLI-local registry routes for `/api/v1/local-workspaces`

Sketch:

```ts
const bridges = new Map<string, WorkspaceBridge>()

async function getWorkspaceEntryFromRequest(request: FastifyRequest) {
  const workspaceId = resolveWorkspaceIdFromRequest(request) // local CLI helper
  const entry = await registry.get(workspaceId)
  if (!entry) throw new WorkspaceUnavailableError('unknown workspace')
  if (!entry.available) throw new WorkspaceUnavailableError('workspace folder unavailable')
  return entry
}

await app.register(registerAgentRoutes, {
  mode: 'direct', // CLI local mode only
  getWorkspaceId: async (request) => (await getWorkspaceEntryFromRequest(request)).id,
  getWorkspaceRoot: async (workspaceId) => {
    const entry = await registry.get(workspaceId)
    if (!entry || !entry.available) throw new WorkspaceUnavailableError(workspaceId)
    return entry.path
  },
  getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
  // Usually omit getPi here. Pi package/plugin management is resolved from
  // ~/.pi/agent/settings.json + <workspaceRoot>/.pi/settings.json. Only pass
  // this hook for host-owned, non-user-managed resource overrides.
  getExtraTools: async ({ workspaceId, workspaceRoot }) =>
    createWorkspaceUiTools(bridges.get(workspaceId), { workspaceRoot }),
})

await app.register(uiRoutes, {
  getBridge: async (request) => bridges.get((await getWorkspaceEntryFromRequest(request)).id),
})
```

Server responsibilities:

- Read `x-boring-workspace-id` from requests in workspaces mode.
- Look up that id in `~/.boring-ui/workspaces.yaml`.
- Resolve only registered absolute paths.
- Let `registerAgentRoutes` lazily create/cache runtime bindings per workspace id/root.
- Lazily create/cache one UI bridge per workspace id.
- Use the same workspace id for agent runtime/session scoping and UI bridge scoping.
- Always pass a namespace equivalent to `getSessionNamespace: ({ workspaceId }) => 'local-workspace-' + workspaceId` in workspaces mode.
- Do not add a Boring plugin registry. User-installed plugins/packages are Pi's responsibility and resolve from `~/.pi/agent/settings.json` plus `<workspaceRoot>/.pi/settings.json`.
- Ensure all workspace-aware transports carry the selected workspace id, including normal JSON fetches, UI bridge requests, media/raw file requests, and file-event SSE. If an existing SSE endpoint takes `workspaceId` as a query parameter instead of a header, keep it opaque and resolve it through the same registry path.
- Dispose idle workspace bindings later if needed; not required for first version.

Security invariant: the server must never treat `x-boring-workspace-id` as a path. It is only an opaque registry id. All file, agent, session, and UI bridge routes must resolve id → registry entry → validated path before touching the filesystem.

## Top bar and workspace management UX

Use the existing workspace top-bar pattern rather than inventing a CLI-only header.

### What already exists

- `packages/workspace/src/front/layout/TopBar.tsx`
  - Package-neutral top bar shell.
  - Already supports `topBarLeft`, `topBarRight`, app title, session title, command palette, and new chat.
  - This is the correct base chrome for both folder mode and workspaces mode.
- `packages/core/src/app/front/CoreWorkspaceAgentFront.tsx`
  - Shows how core composes `WorkspaceAgentFront` with a top bar.
  - Defaults `topBarLeft` to `<WorkspaceSwitcher />` and `topBarRight` to `<UserMenu />`.
  - This is the UX reference, not the direct dependency target for CLI.
- `packages/core/src/front/components/WorkspaceSwitcher.tsx`
  - Good interaction model: app badge/title, current workspace, dropdown list, create action, settings action.
  - But it is core-bound today: uses React Router, `WorkspaceAuthProvider`, `/api/v1/workspaces`, toast behavior, and core workspace types.

### What to reuse directly

Reuse directly:

- `WorkspaceAgentFront` from `@hachej/boring-workspace/app/front`.
- `TopBar` behavior through `WorkspaceAgentFront`'s existing `topBarLeft` / `topBarRight` props.
- UI primitives from `@hachej/boring-ui-kit`:
  - `DropdownMenu`
  - `Dialog`
  - `Button`
  - `Input`
  - `Label`
  - toast if needed
- Visual/interaction pattern from core `WorkspaceSwitcher`.

Do **not** import core's `WorkspaceSwitcher` into the CLI app as-is. It would pull in core assumptions that do not apply to local CLI:

- auth/user context
- core workspace API shape
- React Router routes like `/workspace/:id/settings`
- server-backed create/delete semantics
- settings pages that include cloud/runtime/auth concepts

### Component to create/extract

Create a package-neutral local switcher in the workspace package:

```txt
packages/workspace/src/app/front/LocalWorkspaceSwitcher.tsx
```

Do not defer this to a CLI-only component unless implementation proves it needs CLI-only dependencies. The intended component has no Node/core/CLI imports and should be reusable by any local-folder workspace host.

Suggested API:

```ts
interface LocalWorkspaceSummary {
  id: string
  name: string
  path: string
  available: boolean
}

interface LocalWorkspaceSwitcherProps {
  appTitle: string // "Boring UI"
  workspaces: LocalWorkspaceSummary[]
  activeWorkspaceId: string | null
  onSwitchWorkspace(id: string): void
  onAddWorkspace(): void
  onRenameWorkspace(id: string): void
  onRemoveWorkspace(id: string): void
}
```

This component should mimic core's `WorkspaceSwitcher` layout:

- left badge with app initial (`B`)
- `Boring UI / <workspace name>` label
- chevron dropdown
- current workspace checkmark
- unavailable folder badge/state
- actions at bottom:
  - Add local folder
  - Rename workspace
  - Remove from registry

### Top bar ownership

Top bar state should be owned by the app shell, not individual panels.

Folder mode:

`folderWorkspaceId` should be a stable id derived from the resolved folder root, for example `<basename-slug>-<path-hash>`. This keeps browser layout/session active-id storage stable even if the user launches the same folder from different shells.

```tsx
<WorkspaceAgentFront
  workspaceId={folderWorkspaceId}
  appTitle={folderName}
  topBarLeft={undefined} // use default app/session title block
/>
```

Workspaces mode:

```tsx
<WorkspaceAgentFront
  key={activeWorkspace.id}
  appTitle="Boring UI"
  workspaceId={activeWorkspace.id}
  requestHeaders={{ 'x-boring-workspace-id': activeWorkspace.id }}
  authHeaders={{ 'x-boring-workspace-id': activeWorkspace.id }}
  topBarLeft={
    <LocalWorkspaceSwitcher
      appTitle="Boring UI"
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace.id}
      onSwitchWorkspace={setActiveWorkspaceId}
      onAddWorkspace={openAddFolderDialog}
      onRenameWorkspace={openRenameDialog}
      onRemoveWorkspace={removeFromRegistry}
    />
  }
/>
```

Use both header props intentionally:

- `requestHeaders` routes agent/chat/session calls.
- `authHeaders` routes workspace data/file/UI bridge calls through providers that use auth-style headers.

If the app/front API is later consolidated to a single workspace-routing header prop, update this plan and the core composition together.

The top bar should not read `~/.boring-ui/workspaces.yaml` directly. It receives state/actions from the CLI app shell. The CLI app shell talks to local registry HTTP endpoints.

### Local registry API for top bar

Add CLI-local endpoints:

```txt
GET    /api/v1/local-workspaces
POST   /api/v1/local-workspaces
PUT    /api/v1/local-workspaces/:id
DELETE /api/v1/local-workspaces/:id
```

Response shape:

```ts
interface LocalWorkspacesResponse {
  workspaces: LocalWorkspaceSummary[]
}
```

Unavailable folder handling:

- Keep entry in registry.
- `available: false` in API response.
- Switcher shows it disabled or warns before switching.
- Removing unavailable workspace only removes the registry entry.

Empty registry first-run UX:

- `boring-ui workspaces` starts the app even when the registry is empty.
- Top bar shows `Boring UI` with no active workspace.
- Main content shows an empty state with one primary CTA: `Add local folder`.
- Do not silently add the current directory in workspaces mode; explicit registration keeps the local hub predictable.

Registry freshness:

- Registry HTTP handlers should read the YAML file from disk for each mutation/list request or use an invalidated cache keyed by file mtime.
- The frontend should refetch local workspaces on window focus and on a short interval (for example 2–5 seconds) so `boring-ui workspaces add ...` in another terminal appears in a running hub.
- A file watcher/SSE update channel can be added later, but polling/focus refetch is enough for v1.

### Settings entry

For local workspaces mode, do **not** route to core `WorkspaceSettingsPage` initially.

Start with top-bar dropdown actions only:

- Add local folder
- Rename display name
- Remove from registry

A dedicated local settings page can come later if needed.

## Safety

- Never delete user folders from `workspaces remove`.
- Never interpret client-provided workspace ids as paths. `x-boring-workspace-id` is only a registry lookup key.
- Registry writes must be atomic.
- Validate paths before registering:
  - expand `~`
  - resolve to absolute path
  - require existing directory unless `--allow-missing` is explicitly added later
- Do not store secrets in `~/.boring-ui/workspaces.yaml`.

## Migration / compatibility

- Existing `boring-ui` behavior remains unchanged.
- Existing env vars still work:
  - `PORT`
  - `HOST`
  - `BORING_AGENT_WORKSPACE_ROOT` for folder mode
- `BORING_AGENT_WORKSPACE_ROOT` should not override individual registry entries in workspaces mode. If set, print a warning and ignore it while running `boring-ui workspaces`.
- CLI runtime mode is local only. Do not expose/store per-workspace runtime mode in the registry.

## Tests

Unit:

- registry reads missing file as empty
- add/list/remove/rename round-trip
- duplicate path dedupes or errors predictably
- ids are stable and URL-safe
- atomic write preserves valid YAML

CLI:

- `boring-ui .` starts folder mode with cwd basename
- `boring-ui /tmp/foo` starts folder mode with `foo`
- `boring-ui workspaces list` prints registered folders
- `boring-ui workspaces add /tmp/foo` updates registry
- `boring-ui workspaces remove foo` removes registry entry only

Server:

- workspaces mode resolves requests by workspace id
- unknown workspace id returns stable 404/validation error
- unavailable folder is reported without crashing server
- forged `x-boring-workspace-id` values are never treated as paths
- file-event SSE query `workspaceId` values are never treated as paths
- two same-basename folders get distinct ids and distinct session namespaces
- session store/harness path includes the registry id/path hash, or an equivalent collision-proof namespace

E2E/smoke:

- start `boring-ui workspaces`
- add two local folders
- switch between them
- file tree contents change per workspace
- chat/file APIs operate against the selected folder
- file-event SSE reconnects on switch and reports events only for the selected workspace
- image/PDF/raw file viewers fetch content from the selected workspace

## Decisions

- Global workspaces app title: `Boring UI`.
- Folder mode stays implicit only:
  - `boring-ui .`
  - `boring-ui ~/project`
  - no documented `boring-ui open` alias.
- Registry path: `~/.boring-ui/workspaces.yaml`.
- CLI runtime mode is local only; no per-workspace runtime mode in registry.
- Missing folders stay in the registry and render as unavailable; never auto-remove.
- Session ownership stays with the existing harness/session system. The registry only tracks local workspace folders and display metadata.
- Workspaces mode uses one server process with per-request workspace dispatch and lazy per-workspace runtime bindings.
- Workspace switches remount `WorkspaceAgentFront` with `key={activeWorkspace.id}`.
- Local workspace switcher lives in `packages/workspace/src/app/front/LocalWorkspaceSwitcher.tsx`.
- Empty registry starts the hub and shows an Add local folder CTA.
- Running hubs observe registry changes via refetch-on-focus plus short polling for v1.
