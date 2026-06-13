# Pierre Trees file-tree migration plan

## Status

Planning spike. Do not replace the current workspace file tree until the spike proves parity for selection, reveal, context menu actions, file mutations, and large repositories.

## Context

`@hachej/boring-workspace` currently renders the filesystem tree with `react-arborist`:

- `packages/workspace/src/plugins/filesystemPlugin/front/file-tree/FileTree.tsx`
- `packages/workspace/src/plugins/filesystemPlugin/front/file-tree/FileTreeView.tsx`
- `packages/workspace/src/plugins/filesystemPlugin/front/file-tree/treeModel.ts`

The current implementation is directory-lazy: it fetches `GET /api/v1/tree?path=...` for the root, then fetches child directories on expansion and merges them into nested React state.

Pierre Trees (`@pierre/trees`) uses a path-first model. Its large-tree path is to collect canonical paths outside the render loop, optionally prepare them with `prepareFileTreeInput(...)` / `preparePresortedFileTreeInput(...)`, and pass that prepared input into `useFileTree(...)`.

Reference implementations studied:

- Pierre docs: `https://trees.software/docs#handle-large-trees-efficiently`
- Pierre monorepo `diffshub`: streams path deltas into a tree with `model.batch(...)` and resets with `model.resetPaths(...)` when the source identity changes.
- `CarterMcAlister/linear-code-review`: builds `paths` from GitHub PR changed files, prepares them with `prepareFileTreeInput(paths, { flattenEmptyDirectories: true })`, passes `preparedInput` into `useFileTree`, and refreshes with `model.resetPaths(paths, { preparedInput })`.

## Decision summary

Do a feature-flagged spike first. The likely long-term architecture is:

1. Server/workspace layer exposes an indexed canonical path list for the tree.
2. Client prepares/presorts paths for Pierre Trees.
3. Filesystem events update the live model with `add`, `remove`, `move`, or `batch` instead of rebuilding nested React state.
4. Keep current `/api/v1/tree?path=...` during the spike as fallback and for compatibility.

## Goals

- Replace the low-level `react-arborist` renderer with `@pierre/trees/react` only after proving parity.
- Improve large-repo behavior by avoiding repeated nested-tree shaping in React render paths.
- Preserve current workspace semantics:
  - click file opens editor through the workspace bridge
  - reveal active file opens/selects the right tree row
  - background and row context menu actions work
  - create file/folder, rename, delete, drag/drop move work
  - server search and left-pane search behavior remain acceptable
  - ignored names (`node_modules`, `.git`, `dist`, etc.) remain hidden by default

## Non-goals

- Do not change file read/write/move/delete route semantics.
- Do not remove the existing tree implementation in the spike.
- Do not introduce a database-backed file index yet.
- Do not rely on undocumented Pierre internals for lazy directory loading.

## Proposed phases

### Phase 0 — dependency and adapter spike

Add `@pierre/trees` to `@hachej/boring-workspace` and create a temporary feature-flagged tree implementation.

Suggested flag:

```ts
BORING_WORKSPACE_TREE_IMPL=trees
```

Implementation shape:

- keep `FileTreeView` as the workbench integration owner
- add a new internal renderer, for example `PierreFileTree.tsx`
- convert current loaded `FileEntry[]` / expanded directory cache into a flat `paths: string[]`
- initialize Pierre with `prepareFileTreeInput(paths, { flattenEmptyDirectories: true })`
- keep current tree as default

Verification:

- workspace playground renders files
- file click opens editor
- active-file reveal works for already-loaded paths
- no regressions when flag is absent

### Phase 1 — full path-list endpoint

Add a workspace route that can return canonical tree paths for the selected workspace.

Candidate route:

```txt
GET /api/v1/tree-index?path=.&limit=...
```

Candidate response:

```ts
interface TreeIndexResponse {
  paths: string[]
  truncated?: boolean
  limit?: number
}
```

Rules:

- path validation stays in the `Workspace` adapter
- server applies the same ignore defaults used by the current tree UI unless explicitly overridden
- paths are normalized to forward-slash workspace-relative paths
- response should be sorted server-side when cheap, so the client can use `preparePresortedFileTreeInput(paths)` later

Important: do **not** JSON-roundtrip `FileTreePreparedInput` at first. It includes an internal symbol marker. Safer first version: server returns JSON paths; client calls Pierre prepare helper.

Verification:

- unit-test path normalization and ignore behavior
- route test covers nested files, ignored dirs, and limit/truncation
- playground loads from `tree-index` when feature flag is enabled

### Phase 2 — model-driven mutation updates

Once the tree owns a full path list, stop rebuilding all tree input on every local change. Use Pierre model methods:

```ts
model.add(path)
model.remove(path, { recursive: true })
model.move(from, to)
model.batch(operations)
model.setGitStatus(statuses)
model.resetPaths(paths, { preparedInput })
```

Map existing filesystem events:

- `filesystemEvents.created` -> `model.add(path)`
- `filesystemEvents.deleted` -> `model.remove(path, { recursive: kind === "dir" })`
- `filesystemEvents.moved` -> `model.move(from, to)`

Keep a conservative fallback: when an event cannot be represented safely, refetch the path list and `resetPaths(...)`.

Verification:

- agent-created file appears without collapsing the tree
- renamed file updates selection and editor path correctly
- deleted expanded folder removes descendants
- move via drag/drop and move via agent event converge on same tree state

### Phase 3 — parity for actions and UX

Port current UI behaviors onto Pierre APIs.

Required parity:

- selected path is controlled by workspace active file
- reveal command scrolls/focuses path with `model.scrollToPath(...)` / `model.getItem(path)?.select()`
- context menu supports New file, New folder, Rename, Delete, Copy path, Copy Git URL
- inline rename uses Pierre `renaming` when it can satisfy current UX; otherwise keep our controlled dialog/input path around the model
- drag/drop invokes existing `moveFile` mutation and rejects invalid drops
- pending paths show row decoration/spinner equivalent
- empty state and no-match state remain clear

Verification:

- existing file-tree tests updated or duplicated for Pierre mode
- Playwright smoke in `workspace-playground` covers open, create, rename, delete, move/reveal when practical

### Phase 4 — performance hardening

Measure before deleting `react-arborist`.

Scenarios:

- small fixture workspace
- medium app repo
- large repo with thousands of files
- broad search
- agent writes many files in a nested folder

Knobs to tune:

- `preparePresortedFileTreeInput(...)`
- `initialVisibleRowCount`
- `overscan`
- `density`
- server-side path sorting and ignore filtering

Success threshold:

- first usable tree render is no worse on small repos
- large repo tree avoids UI jank from nested tree rebuilding
- mutation updates are O(delta) where possible

### Phase 5 — cleanup and default switch

Only after parity and measurements:

- make Pierre tree default
- remove `react-arborist` and `react-dnd-html5-backend` only if no other package uses them
- delete old renderer code in a separate cleanup PR
- update public exports if `FileTree` props change
- update docs and migration notes

## Risks

| Risk | Mitigation |
| --- | --- |
| Pierre Trees is beta | Isolate behind internal adapter; avoid leaking Pierre-specific types into public workspace API until stable. |
| Full path scan can be expensive | Add limit/truncation, ignore defaults, cancellation/timeout, and later incremental indexing if needed. |
| Current lazy expansion behavior disappears | Feature flag first; full index route can coexist with current lazy route. |
| JSON prepared input mismatch | Return paths over HTTP and prepare client-side first. Consider SSR/preload only after proving payload contract. |
| Context menu/rename UX differs | Keep `FileTreeView` as action owner; use Pierre only for row model/rendering until parity is proven. |
| Tests depend on current DOM | Update tests around user-visible roles/labels, not implementation classes. |

## Acceptance criteria for implementation issue

- Feature flag can switch between current tree and Pierre tree.
- Current default remains unchanged until parity is proven.
- New tree can render a full workspace path list and open files through bridge.
- Tree index route has tests for normalization, ignored paths, and limits.
- Create/rename/delete/move/reveal behaviors have unit or integration coverage.
- Performance notes compare current tree vs Pierre tree on at least one large repo.

## Open questions

1. Should the tree-index endpoint live in `@hachej/boring-agent/server` routes or `@hachej/boring-workspace/app/server` composition?
2. Should ignore defaults be server-owned, client-owned, or shared config?
3. Do we need separate modes for changed-files trees vs full workspace trees?
4. Should Git status be included in the first tree-index response or layered as a separate signal?
5. What max path count should trigger truncation or search-only fallback?
