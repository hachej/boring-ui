# Command palette: generic command + search registry

**Status:** draft for review
**Owners:** workspace
**Last updated:** 2026-04-28

## Problem

The workspace package ships a `<CommandPalette />` (⌘K) that today is two
hardcoded result paths bolted together:

1. **Files** — `useFileSearch(query)` from `packages/workspace/src/data/hooks.ts`,
   debounced 300ms, hits `GET /api/v1/files/search` (now landed via
   `searchRoutes`, sharing the agent's `find_files` backend).
2. **Commands** — when the user types `>`, results come from
   `useCommandRegistry().getActiveCommands()` (3 commands registered by
   `WorkspaceProvider` + 3–4 more registered ad-hoc by `ChatCenteredShell`
   in a `useEffect`).

Plus a few constants:

- Recent files from `localStorage` (a separate non-pluggable list).
- Pre-merged into a single `<CommandList>` with three implicit groups.

This shape works while there is exactly one thing to search (files) and a
fixed handful of commands. It breaks the moment a child app wants to:

- Surface its **sessions** alongside files (e.g. `Sessions: "Workspace
  demo"`, `Sessions: "Plan review"`)
- Surface its **workspaces / members** for jump-to navigation
- Plug an arbitrary catalog (the same catalog already powers
  `<DataExplorer />`'s left-pane data surface, see
  `packages/workspace/src/components/DataExplorer/types.ts`) into the
  palette

Doing any of those today means **forking `CommandPalette.tsx`** or
threading bespoke props down. Both are non-starters once we have more
than two child apps.

Adjacent observation: `@boring/workspace` already defines
`ExplorerAdapter` — an async, AbortSignal-aware, filterable, paginated
search interface used by the data catalog UI. That IS the search engine
the palette wants. We should not be inventing a second one.

## Goal

A single command palette where any consumer (workspace, child app, or
even another `@boring/*` package) can register either:

- **Commands** — discrete actions with `id`, `title`, optional
  `shortcut`, optional `when` predicate, `run()` callback. (Already
  exists; scope here is to formalize ownership.)
- **Search catalogs** — async, query-driven result lists with the
  `ExplorerAdapter` shape that `<DataExplorer />` already consumes.
  Each catalog renders its own group in the palette
  (`<CommandGroup heading="Sessions">`, `<CommandGroup heading="Files">`,
  …).

Two presentations of the same engine:

| Surface | Scope | Use case |
|---|---|---|
| `<DataExplorer />` pane | One catalog at a time, full-screen, with facets | Browse sessions / data / members in detail |
| `<CommandPalette />` (⌘K) | Top-N from EVERY registered catalog, plus commands | Spotlight-style jump-to-anything |

One adapter per entity, two presentations, zero duplicated search logic.

## Non-goals

- Replacing the file-tree's own search. The file tree still goes through
  `useFileSearch` directly and renders its own UX; we just register the
  same backend as a catalog so the palette can also surface file
  results. (No double network calls — react-query caches by `[base,
  "search", q, limit]`.)
- Adding a SessionsProvider, WorkspacesProvider, etc. in this PR. The
  scope is the registry mechanism + migrating the existing Files path
  onto it as the reference adapter. Future PRs add new catalogs as
  ~30-line additions.
- Server-side coordination. Each catalog backend is its own HTTP route
  with its own indexing strategy. The palette doesn't care; it composes
  whatever adapters the host registered.
- Persistent favorites / pinned items. Recent files stays
  `localStorage`-backed for now (see open question below).

## Design

### The catalog interface

Reuse `ExplorerAdapter` verbatim from
`packages/workspace/src/components/DataExplorer/types.ts`:

```ts
export type ExplorerAdapter = {
  search(args: SearchArgs): Promise<SearchResult>
  fetchFacets?(args: FacetsArgs): Promise<Facets>
}

export type SearchArgs = {
  query: string
  filters: Record<string, string[]>
  group?: { key: string; value: string }
  limit: number
  offset: number
  signal?: AbortSignal
}

export type SearchResult = {
  items: ExplorerRow[]
  total: number
  hasMore: boolean
}

export type ExplorerRow = {
  id: string
  title: string
  subtitle?: string
  group?: string
  leading?: Badge
  trailing?: Badge[]
  meta?: string
}
```

The cmd-palette doesn't use `fetchFacets` (no facet popover at this
size), but the rest fits exactly: `title` → primary line,
`subtitle` → secondary, `leading` → icon chip,
`meta` → trailing right-aligned text.

### The catalog registration

A new shape on `CatalogConfig`, registered through `WorkspaceProvider`:

```ts
export type CatalogConfig = {
  /** Stable id, used for keys + debugging. */
  id: string
  /** Group heading in the palette ("Files", "Sessions", "Members"). */
  label: string
  /** Top-N rows shown in the cmd-palette inline. Defaults to 5. */
  paletteLimit?: number
  /** Whether the catalog runs against the empty query (e.g. "recent"
   *  catalogs). Defaults to false — most catalogs sit silent until the
   *  user types. */
  searchEmpty?: boolean
  /** Optional priority for ordering palette groups (lower = earlier).
   *  Defaults to 100. Files = 10, Commands = 0 (always first). */
  order?: number
  /** Optional fixed leading icon for every row in this catalog (saves
   *  callers from setting `leading` on each `ExplorerRow`). */
  defaultIcon?: ReactNode
  /** What happens when the user picks a row. */
  onSelect: (row: ExplorerRow) => void
  /** The actual search engine. */
  adapter: ExplorerAdapter
}

export interface WorkspaceProviderProps {
  // … existing props …
  catalogs?: CatalogConfig[]
}
```

WorkspaceProvider stores them in a context next to the existing
`commandRegistry`:

```ts
<RegistryProvider
  panelRegistry={panelRegistry}
  commandRegistry={commandRegistry}
  catalogRegistry={catalogRegistry}
>
```

A `useCatalogs()` hook returns the list (memoized). Late-mount catalogs
(e.g. `ChatCenteredShell` registering its session catalog after a
session list arrives) use `useEffect` + `catalogRegistry.register(cfg)`
/ `unregister(id)`.

### CommandPalette consumes the registry

The palette body becomes:

```tsx
<CommandList>
  <CommandEmpty>{/* … */}</CommandEmpty>
  {!isCommandMode && recentFiles.length > 0 && !searchQuery && (
    <RecentGroup … />
  )}
  {!isCommandMode && catalogs.map((c) => (
    <CatalogGroup key={c.id} catalog={c} query={searchQuery} />
  ))}
  {isCommandMode && commandResults.length > 0 && (
    <CommandsGroup commands={commandResults} … />
  )}
</CommandList>
```

`<CatalogGroup>` is a thin wrapper that:

1. Calls `catalog.adapter.search(...)` debounced 300ms, with an
   AbortController canceled on every keystroke.
2. Skips the call entirely if `searchQuery === "" && !catalog.searchEmpty`.
3. Renders `<CommandGroup heading={catalog.label}>` with up to
   `catalog.paletteLimit` (default 5) `<CommandItem>`s — one per
   `ExplorerRow`, wired with an icon (`row.leading ??
   catalog.defaultIcon`), the title/subtitle, optional meta, and
   `onSelect={() => catalog.onSelect(row)}`.
4. Returns `null` if results are empty (don't render an empty group).

All catalogs run in parallel on every keystroke. The 300ms debounce +
AbortSignal cancellation keeps in-flight requests bounded to one per
catalog; the slowest catalog doesn't block the fastest.

### Migrating the existing Files path

Today's Files path (`useFileSearch` → `<CommandGroup heading="Files">`)
becomes a catalog like any other:

```ts
const filesCatalog: CatalogConfig = {
  id: "files",
  label: "Files",
  order: 10,
  defaultIcon: <FileIcon className="size-4" />,
  onSelect: (row) => onOpenFile(row.id),
  adapter: createFileSearchAdapter(),
}
```

`createFileSearchAdapter()` is a 20-line factory that wraps the existing
`fetchClient.search(query, limit)` into the `ExplorerAdapter` shape:

```ts
function createFileSearchAdapter(): ExplorerAdapter {
  const client = useDataClient() // OR threaded explicitly
  return {
    async search({ query, limit, signal }) {
      if (!query) return { items: [], total: 0, hasMore: false }
      const paths = await client.search(query, limit, signal)
      return {
        items: paths.map((p) => ({
          id: p,
          title: basename(p),
          subtitle: dirname(p),
        })),
        total: paths.length,
        hasMore: false,
      }
    },
  }
}
```

WorkspaceProvider wires it as part of its default `catalogs` list (so
files keep working with zero opt-in). Hosts can override or extend.

### Recent files

Stays in the palette as today (a `<CommandGroup heading="Recent">`
rendered before any catalog when the search box is empty). The
mechanism IS a kind of catalog, but it's localStorage-only and
file-specific — generalizing it ("recent everything") earns its keep
later, not now. See open question below.

### Commands stay separate

Commands aren't a search catalog — they're a flat registry filtered by
substring match. They get their own dedicated group, rendered when the
user types `>`. No change to today's behavior; the work here is purely
adding catalogs alongside.

### Test plan

- **Catalog registry unit tests** — register, unregister, `useCatalogs`
  returns the right list, ordering by `order` is stable.
- **`<CatalogGroup>` rendering tests** — empty query renders nothing
  (unless `searchEmpty`), populated query renders rows, AbortSignal
  fires on rapid query changes.
- **Files migration regression** — existing `useFileSearch` integration
  tests + `searchRoute.integration.test.ts` keep passing; add a
  cmd-palette e2e that asserts file results render via the catalog
  path (not the legacy direct hook).
- **Multi-catalog e2e** — register a stub second catalog in the
  playground, ⌘K, type a query, assert two `<CommandGroup>` headings
  render with disjoint rows.

## Code simplifications enabled by this pattern

Once the registry is in place several adjacent things either get
smaller, get more declarative, or just become possible without ad-hoc
plumbing. Calling them out so they're addressed in the same PR rather
than left as drift.

1. **`<CommandPalette />` body collapses to one loop + one
   commands group.** Today the body has three hardcoded result
   blocks (`recentFiles`, `fileResults`, `commandResults`), each with
   its own group rendering. After: one `catalogs.map(c =>
   <CatalogGroup catalog={c} query={searchQuery} />)` plus a
   single commands group when in `>` mode.

   File diff for `packages/workspace/src/components/CommandPalette.tsx`
   should net out around –40 lines for the body, –6 lines for the
   `useMemo`'d `fileResults` block, and –5 lines for
   `handleFileSelect` (moves into the FilesCatalog's `onSelect`).

2. **`<CommandPalette />` props go from 2 to 0.** Today's
   `CommandPaletteProps = { fileSearchFn, onOpenFile }`; both are
   needed only because the host had to thread the file-search backend
   AND the file-open callback in. With catalogs, both move into the
   FilesCatalog config registered on `WorkspaceProvider`. The
   palette becomes prop-less — it reads everything from context.

3. **`ChatCenteredShell`'s imperative `useEffect` command
   registrations become declarative.** Today the shell does:

   ```tsx
   useEffect(() => {
     commandRegistry.registerCommand({ id: "chat-shell.toggleSessions", … })
     commandRegistry.registerCommand({ id: "chat-shell.toggleWorkbench", … })
     commandRegistry.registerCommand({ id: "chat-shell.newChat", … })
     for (const s of sessions) {
       commandRegistry.registerCommand({ id: `chat-shell.session.${s.id}`, … })
     }
   }, [commandRegistry, toggleDrawer, toggleSurface, onCreateSession, onSwitchSession, sessions])
   ```

   The session loop is the giveaway — those aren't really commands,
   they're a *catalog*. After:

   - The 3 toggle/new-chat actions stay as commands (one-shot, no
     query) but move from `useEffect` into the shell's
     `WorkspaceProvider catalogs` setup so registration is keyed by
     identity, not effect order.
   - The "Switch to: <session title>" loop becomes a
     `SessionsCatalog` — the shell registers a catalog with an
     in-memory `ExplorerAdapter` that filters `props.sessions` by
     query. No more N command rows materialized into the registry on
     every session-list change.

   Net: –30 lines in `ChatCenteredShell.tsx`, no more "registry
   churn" on every session change, and the same surface area now
   responds to user typing (you can search for a session by name
   instead of scrolling the list).

4. **No more `withCommandPalette` no-op prop.** Today
   `ChatCenteredShellProps.withCommandPalette` is preserved for
   back-compat as a runtime no-op (`{void withCommandPalette}` in
   the JSX) — see commit 9eebe87. Once the palette is fully driven
   by catalog/command registries on `WorkspaceProvider`, the
   shell-level prop has nothing to control. Drop it. (Hosts that
   need to suppress the palette set `<WorkspaceProvider
   withCommandPalette={false}>` — already the documented
   override.)

5. **One file-search backend, one unified UX path.** The legacy
   `fileSearchFn?: (query: string) => string[]` prop on the palette
   was a SYNCHRONOUS callback — it predates the async
   `useFileSearch` hook + `/api/v1/files/search` HTTP route. After
   the registry refactor, the FilesCatalog wraps the (async)
   `fetchClient.search` directly via `ExplorerAdapter`, dropping the
   sync vs async asymmetry. Same backend the LLM's `find_files`
   tool already uses (just landed in commit 12098fd).

6. **`<DataExplorer />` and `<CommandPalette />` test infrastructure
   converges.** Catalog adapters become the unit of test for both
   surfaces. A SessionsCatalog tested in isolation against a mock
   adapter is automatically testing the data path for both the
   data-pane explorer view and the cmd-palette inline view.

## Dead code that comes out

These are the concrete deletions enabled by Phase 1, not aspirational
cleanup. Each is gated on the registry landing.

| File | Lines | What |
|---|---|---|
| `packages/workspace/src/components/CommandPalette.tsx` | ~–80 | The dual `fileSearchFn` / `onOpenFile` props, the `fileResults` `useMemo`, the `handleFileSelect` callback, the standalone "Files" `<CommandGroup>` block. All consolidated into the catalog loop. |
| `packages/workspace/src/components/CommandPalette.tsx` (`CommandPaletteProps`) | –4 | The exported type currently has both fields and is referenced by `ChatCenteredShell`'s now-unused `withCommandPalette` plumbing. Type narrows to `{}` and the `Props` export can drop entirely. |
| `packages/workspace/src/components/chat/ChatCenteredShell.tsx` | ~–30 | The `useEffect` block that imperatively registers chat-shell commands + the per-session `commandRegistry.registerCommand` loop (lines ~390–425 in current shape). Replaced with one declarative `catalogs={[…]}` + `commands={[…]}` registration on `<WorkspaceProvider>` (or a sibling `<ChatShellWorkspace>` helper). |
| `packages/workspace/src/components/chat/ChatCenteredShell.tsx` (`withCommandPalette` prop) | –6 | Prop, default value, type field, the `{void withCommandPalette}` JSX expression, and its doc comment. |
| `packages/workspace/src/components/CommandPalette.tsx` (loadRecent/saveRecent) | 0 | KEEP for now — Recent stays a localStorage catalog in v1. Earmarked for removal in a future PR if/when "recent across catalogs" replaces it. |

**Files only changed (not deleted):**

- `packages/workspace/src/WorkspaceProvider.tsx` — gains
  `catalogs?: CatalogConfig[]` prop + threads to `RegistryProvider`
  (~+10 lines).
- `packages/workspace/src/registry/RegistryProvider.tsx` — adds
  `catalogRegistry` to the context (~+8 lines).
- `packages/workspace/src/registry/CatalogRegistry.ts` (new, ~30
  lines) — sibling of `CommandRegistry`, same shape (`register`,
  `unregister`, `getCatalogs`).
- `packages/workspace/src/registry/index.ts` — re-exports
  `useCatalogs` + `CatalogRegistry` + types.
- `packages/workspace/src/components/CommandPalette.tsx` — net
  ~–40 lines after the simplifications above + new `<CatalogGroup>`
  helper (~+30 lines for parallel-fetch + AbortSignal + render).

**Net package size:** ~–50 lines of net source, fewer props on the
public surface, and a new public type (`CatalogConfig` +
re-exported `ExplorerAdapter`) — already exported, just newly load
bearing.

## Migration / rollout

Phase 1 (this PR):
1. Add `catalogRegistry` + `useCatalogs()`.
2. Add `<CatalogGroup>`.
3. Refactor `<CommandPalette>` to consume catalogs.
4. Migrate Files → built-in catalog.
5. Tests above.

Phase 2 (separate PR per catalog):
- `SessionsProvider` (LIKE-search on session titles, pg_trgm index).
- `WorkspacesProvider` (small N, in-memory filter is fine).
- Whichever catalog the consuming app needs next.

No breaking changes for hosts in Phase 1: the default `catalogs`
includes Files, so existing apps keep working with zero changes. Hosts
that want additional catalogs add them via `<WorkspaceProvider catalogs={...}>`.

## Open questions

1. **Should "Recent" be a generic catalog?** Today: `localStorage`-only,
   file-specific. Generalizing to "recent across catalogs" needs each
   catalog to expose a `getRecent()` method (and means recent rows go
   stale when the underlying entity is deleted). Recommend deferring
   until the second catalog ships.

2. **Where does the catalog registry live for non-React-tree
   consumers?** Today the `commandRegistry` is reachable both via the
   React context AND via direct mutation on the registry instance
   (`useCommandRegistry().registerCommand(...)`). Catalogs should
   probably follow the same pattern so server-side / background code
   can mutate the catalog set. Decision: yes, same pattern.

3. **Should catalogs be allowed to register commands too?** A
   `SessionsCatalog` might want to also register a "Delete session"
   command that's contextual on the focused row. Currently commands and
   catalogs are separate; a row's `onSelect` could enqueue commands but
   not register them. Recommend keeping them separate in v1; revisit if
   the use case actually shows up.

4. **Cancellation semantics across catalogs.** A user typing fast
   issues a flurry of searches; each catalog cancels its previous via
   AbortSignal, but if catalog A is slow and catalog B is fast, B's
   results render first. Acceptable — cmdk's CommandList re-orders
   visually as items mount. No special coordination needed.

5. **Caching.** Each catalog can wrap its adapter in react-query if it
   wants. The registry doesn't impose caching; that's a per-catalog
   concern. (Files already use react-query via `useFileSearch`.)

## Out of scope (future work)

- Cross-catalog ranking ("which result is the BEST match for the
  query?"). Today each catalog's results are sorted within its group;
  no cross-group ranking is attempted. Adding it requires either a
  shared scoring function or a server-side aggregator — both bigger
  changes than this PR.
- Keyboard groups (e.g. "press ⌘1 for Files, ⌘2 for Sessions"). cmdk
  already handles ↑↓ / Enter; we don't need group-level shortcuts yet.
- Persisting facet filters across cmd-palette opens. The palette is
  ephemeral by design; facets live in `<DataExplorer />`.

## Acceptance

- `WorkspaceProvider` accepts `catalogs?: CatalogConfig[]` and exposes
  them via a `useCatalogs()` hook.
- `<CommandPalette />` renders one group per registered catalog with
  matching results (top N, debounced, AbortSignal-aware).
- Files keep working with zero opt-in (default catalog).
- Adding a second catalog is a 30-line addition: write the
  `ExplorerAdapter`, write the `CatalogConfig`, pass it through
  `<WorkspaceProvider catalogs={[…]}>`. No `<CommandPalette />` changes
  needed.
- Tests in the test plan all pass.

## Reference

- Existing palette: `packages/workspace/src/components/CommandPalette.tsx`
- Existing adapter shape:
  `packages/workspace/src/components/DataExplorer/types.ts`
- Existing command registry:
  `packages/workspace/src/registry/CommandRegistry.ts`
- File search HTTP route (one shared backend with the LLM tool, just
  landed): `packages/agent/src/server/http/routes/search.ts`
