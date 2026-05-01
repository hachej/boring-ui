# Command palette: generic command + search registry

> **⚠️ SUPERSEDED by [`PLUGIN_MODEL.md`](./PLUGIN_MODEL.md) (2026-04-28).**
> The palette becomes ONE consumer of the wider plugin model, not a
> top-level concern. The catalog/command/panel/agent-tool/etc.
> abstractions all live as contributions inside a `Plugin`. Read
> `PLUGIN_MODEL.md` for the canonical design; this doc is kept for
> historical reference of the palette-first iterations.
>
> **2026-04-30 update:** references below to `src/data`, `front/data`, or
> `createFilesCatalog` as a core export are historical. Filesystem catalogs
> now live under `src/plugins/filesystemPlugin`; the palette searches generic
> catalog outputs, and "files" are only the filesystem plugin's catalog.

**Status:** SUPERSEDED — review v3 (factory pattern + shell auto-registration locked in)
**Owners:** workspace
**Last updated:** 2026-04-28

## v3 lock-ins (supersede earlier sections where they conflict)

After codex + gemini reviews and three rounds of grilling, the final
shape is:

1. **Catalogs are composed via factories, not auto-magic defaults.**
   `@boring/workspace` exports `createFilesCatalog`,
   `createSessionsCatalog`, etc. Hosts pass them through
   `<WorkspaceProvider catalogs={[…]}>`. There is no `onOpenFile`
   prop on WorkspaceProvider, no slot config, no auto-mount of
   built-ins from a host-passed shape. Each factory takes
   `onSelect` (the host-specific intent) plus optional overrides
   (`paletteLimit`, `paletteIcon`, `label`, `order`).

   ```tsx
   <WorkspaceProvider catalogs={[
     createFilesCatalog({
       onSelect: (row) => surface.openPanel({
         id: row.id, component: "code-editor", params: { path: row.id },
       }),
     }),
     // host's own domain catalogs:
     createReportsCatalog({ … }),
   ]}>
   ```

2. **Components like `<ChatCenteredShell />` AUTO-REGISTER their own
   catalogs and commands internally** (no new shell props). When the
   shell receives `sessions` + `onSwitchSession`, it calls
   `useCatalogRegistry().register(createSessionsCatalog({sessions,
   onSelect: onSwitchSession}))` internally. When mounted, it
   registers `toggleDrawer` / `toggleWorkbench` / `newChat` via
   `useCommandRegistry()`.

   Sessions "just work" from the shell; the host wires nothing
   extra at the catalog level.

3. **Late-wins-on-id is the universal override.** A host that wants
   different palette limit / icon / behavior for ANY catalog
   (including a shell-auto-registered one) registers a catalog with
   the same `id` on `WorkspaceProvider`. The registry's
   late-wins-on-id rule replaces the inner registration. Same
   mechanism works for built-in catalogs, shell-internal catalogs,
   and any future contribution.

   ```tsx
   <WorkspaceProvider catalogs={[
     createSessionsCatalog({
       sessions, onSelect: customSwitcher,
       paletteLimit: 20,        // override default 5
       paletteIcon: <CustomIcon />,
     }),
   ]}>
     <ChatCenteredShell sessions={sessions} onSwitchSession={customSwitcher} />
   </WorkspaceProvider>
   // Shell tries to register id:"sessions"; host's wins.
   ```

4. **Factories ARE the public API for advanced composition.** Both
   user decisions from grilling rounds — "auto-register" and
   "exported factories" — are the same thing under this shape:
   factories are exported, hosts use them, late-wins-on-id is the
   override.

5. **Recent dropped from v2 stays dropped.** Typed Recent entries
   ({kind, id, title, lastOpenedAt}); legacy `string[]` and
   `"cmd:foo"` entries dropped on migration; ⌘Enter / async
   onSelect deferred; commands stay `>`-only.

The detailed sections below describe the full design; where they
mention `onOpenFile`, "auto-mount built-ins", "default Files
catalog", or any other shape that conflicts with the lock-ins above,
the lock-ins win.



## What changed in v2

Codex caught several P0 baseline errors in v1; gemini added concrete UX
gaps; user picked: 5-row default per catalog, single Enter action, typed
Recent entries.

Substantive corrections from v1:

1. **Baseline was wrong about Files.** v1 implied the palette runs
   `useFileSearch` today. It doesn't —
   `packages/workspace/src/components/CommandPalette.tsx:36-37` exposes
   a sync `fileSearchFn?: (q: string) => string[]` prop, and
   `packages/workspace/src/WorkspaceProvider.tsx:377` mounts
   `<CommandPalette />` with no props. **Files search is not wired in
   the default runtime today.** That's a freebie this plan delivers,
   not a regression to manage.
2. **`ExplorerAdapter` reuse is NOT verbatim.** v1 implied identity;
   `ExplorerRow.leading` is `Badge` (mono code chip), not a ReactNode
   icon. The cmd-palette wants icons. v2 adds an explicit
   `CatalogConfig.paletteIcon?: ReactNode` separate from the row's
   badge so the same adapter feeds both surfaces with their own visual
   language.
3. **`withCommandPalette={false}` override doesn't exist on
   `WorkspaceProvider` today.** v1 referenced it as if it did. v2
   adds it as part of Phase 1 (BEFORE dropping the shell prop).
4. **"No breaking changes" was false.** Dropping `CommandPaletteProps`
   and the shell's `withCommandPalette` prop ARE public API breaks.
   v2 calls them out + lists what consumers need to do.
5. **Phase 1 omitted shell work.** v1 listed `ChatCenteredShell.tsx`
   line removals in the dead-code section but Phase 1 steps didn't
   include the shell. v2 adds shell migration to Phase 1.
6. **Registry reactivity unspecified.** Current `CommandRegistry` is
   a mutable Map with no subscribe. Late
   `registry.register/unregister` won't trigger React re-renders. v2
   moves to a useSyncExternalStore-backed registry with explicit
   subscribe semantics.
7. **File-open ownership.** The provider can't call into the chat
   shell's `openArtifact` ref. v2: hosts register the FilesCatalog
   with their OWN `onSelect`. WorkspaceProvider supplies a
   sane-default Files adapter; the host overrides `onSelect` for
   non-default file-open behavior (chat shell's surface, IDE's
   dockview, …).
8. **Recent stored command IDs but opened as paths.** Real bug,
   currently exists at
   `packages/workspace/src/components/CommandPalette.tsx:128-134`
   (`addToRecent("cmd:" + id)`) +
   `packages/workspace/src/components/CommandPalette.tsx:230-236`
   (Recent group renders all recents through `handleFileSelect`).
   v2 fixes this in Phase 1 alongside the typed-recent migration.
9. **`pg_trgm` mentions deleted.** Workspace package plan should not
   leak DB index choices for hypothetical future SessionsCatalog
   backends.

User decisions (collected via grilling):

- **paletteLimit default = 5 per catalog.** Files goes from 50 → 5
  (regression accepted in favor of spotlight-style multi-catalog
  layout).
- **Single action per row.** `CatalogConfig.onSelect(row)` is the only
  intent. ⌘Enter / right-arrow deferred until real demand.
- **Typed Recent entries now.** Recent localStorage migrates from
  `string[]` of paths to `Array<{ kind: "file" | "session" | …, id:
  string, lastOpenedAt: number }>` in Phase 1.

## Problem

The workspace package ships a `<CommandPalette />` (⌘K) that today is
three result paths bolted together — and the Files path doesn't even
run by default:

1. **Recent (Files only)** — `localStorage`-backed list rendered when
   the search box is empty
   (`packages/workspace/src/components/CommandPalette.tsx:34-43`).
2. **Files (synchronous, prop-driven, currently dead in default
   runtime)** —
   `packages/workspace/src/components/CommandPalette.tsx:36`
   exposes `fileSearchFn?: (q: string) => string[]`. Provider mounts
   the palette with no props
   (`packages/workspace/src/WorkspaceProvider.tsx:377`), so file results
   never appear unless a host wraps another `<CommandPalette />` with
   the prop wired (no host does today).
3. **Commands (active when user types `>`)** — three default commands
   from `WorkspaceProvider`
   (`packages/workspace/src/WorkspaceProvider.tsx:292-323`) plus
   3-N more registered ad-hoc by `ChatCenteredShell` in a
   `useEffect` (`packages/workspace/src/components/chat/ChatCenteredShell.tsx:400-431`).
   The session-row loop is the giveaway — those aren't really
   commands, they're search results.

Plus an actual bug: Recent stores command IDs as
`addToRecent("cmd:" + id)`
(`packages/workspace/src/components/CommandPalette.tsx:128-134`) but
the Recent group renders every entry as if it were a file path
(`packages/workspace/src/components/CommandPalette.tsx:230-236`).
Selecting a recent command currently fires `onOpenFile?.("cmd:foo")`,
which means recently-run commands silently break.

The shape stops scaling the moment a child app wants to:

- Surface its **sessions** alongside files (e.g. `Sessions: "Workspace
  demo"`, `Sessions: "Plan review"`)
- Surface its **workspaces / members** for jump-to navigation
- Plug an arbitrary catalog into the palette (the same catalog that
  already powers `<DataExplorer />`'s data surface, see
  `packages/workspace/src/components/DataExplorer/types.ts`)

Doing any of those today means **forking `CommandPalette.tsx`** or
threading bespoke props down. Both are non-starters once we have more
than two child apps.

Adjacent observation: `@boring/workspace` already defines
`ExplorerAdapter` — an async, AbortSignal-aware, filterable, paginated
search interface used by the data catalog UI. That IS the search
engine the palette wants. We should not be inventing a second one.

## Goal

A single command palette where any consumer (workspace, child app, or
even another `@boring/*` package) can register either:

- **Commands** — discrete actions with `id`, `title`, optional
  `shortcut`, optional `when` predicate, `run()` callback. (Already
  exists; scope here is to formalize the registration shape so the
  shell stops registering imperatively.)
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

One adapter per entity, two presentations, zero duplicated search
logic.

## Non-goals

- Replacing the file-tree's own search. The file tree still goes
  through `useFileSearch` directly and renders its own UX; we just
  register the same backend as a catalog so the palette can also
  surface file results. (No double network calls — react-query caches
  by `[base, "search", q, limit]`.)
- Adding a SessionsCatalog, WorkspacesCatalog, etc. in this PR. The
  scope is the registry mechanism + migrating the existing Files /
  Recent / Commands paths onto it. Future PRs add new catalogs as
  ~30-line additions.
- Server-side coordination. Each catalog backend is its own HTTP
  route with its own indexing strategy; the palette doesn't care.
  Backend-specific concerns (postgres indexing, full-text search
  configuration) are explicitly out of this frontend-package plan.
- Persistent favorites / pinned items. Out of scope; revisit in a
  follow-up.
- Cross-catalog ranking. Each catalog's results are sorted within its
  group; no inter-group score is attempted.

## Design

### The catalog interface

Reuse `ExplorerAdapter` verbatim from
`packages/workspace/src/components/DataExplorer/types.ts:68-72`:

```ts
export type ExplorerAdapter = {
  search(args: SearchArgs): Promise<SearchResult>
  fetchFacets?(args: FacetsArgs): Promise<Facets>
}
```

The cmd-palette doesn't use `fetchFacets` (no facet popover at this
size) and ignores `group` / `filters` in `SearchArgs`. `SearchResult`
provides `items: ExplorerRow[]` which renders 1:1 to a
`<CommandItem>` per row.

### `ExplorerRow.leading` semantics

`ExplorerRow.leading` is a `Badge` (
`packages/workspace/src/components/DataExplorer/types.ts:10-14`,
`{ code: string, tooltip?: string }`) — a mono text chip, NOT a
ReactNode icon. `<DataExplorer />` renders it via the `<Chip>`
component
(`packages/workspace/src/components/DataExplorer/DataExplorer.tsx:498-507`).

For the palette we want lucide icons, not text chips. The
`CatalogConfig` exposes a SEPARATE `paletteIcon?: ReactNode` and the
palette renderer ignores `row.leading` entirely. That keeps the
adapter signature unchanged (no new field on `ExplorerRow`) while
giving each surface its own visual language.

### `CatalogConfig`

```ts
export type CatalogConfig = {
  /** Stable id, used for keys + debugging. */
  id: string
  /** Group heading in the palette ("Files", "Sessions", "Members"). */
  label: string
  /**
   * Top-N rows shown in the cmd-palette inline. Defaults to 5
   * (per-spotlight-style: keep palette tight, room for multiple groups).
   * Hosts can override per-catalog.
   */
  paletteLimit?: number
  /**
   * Optional priority for ordering palette groups (lower = earlier).
   * Defaults to 100. Built-in: Commands group (when in `>` mode) is
   * always rendered first, followed by Recent (when query is empty),
   * followed by catalogs sorted by `order`.
   */
  order?: number
  /**
   * Lucide-style icon rendered ahead of every row. Replaces the
   * adapter's `row.leading` Badge for palette presentation; the
   * data-explorer surface continues to render `row.leading` as a
   * mono text chip.
   */
  paletteIcon?: ReactNode
  /**
   * Single canonical action when the user picks a row. Fires on Enter
   * / click. The palette closes itself + records a typed Recent entry
   * automatically — catalogs only handle the side-effect.
   */
  onSelect: (row: ExplorerRow) => void
  /**
   * The "kind" written into the typed Recent entry on select. Must
   * match the catalog id's domain (e.g. "file" for FilesCatalog,
   * "session" for SessionsCatalog) so the Recent group can route
   * each entry to the right catalog's onSelect on re-pick.
   */
  recentKind: string
  /** The actual search engine. */
  adapter: ExplorerAdapter
}
```

Note what's absent vs v1: no `searchEmpty` flag (premature — Recent
is its own thing), no `defaultIcon` (replaced by `paletteIcon` to
disambiguate from the badge concept), no second action.

### Reactivity-safe registry

Current `CommandRegistry` is a mutable Map
(`packages/workspace/src/registry/CommandRegistry.ts:4`) with no
subscribe API. If a host registers a catalog late (e.g. chat shell
adds a SessionsCatalog after `props.sessions` arrives), an
already-rendered palette won't update.

Phase 1 introduces `CatalogRegistry` as a useSyncExternalStore-friendly
store:

```ts
export class CatalogRegistry {
  private catalogs = new Map<string, CatalogConfig>()
  private listeners = new Set<() => void>()

  register(cfg: CatalogConfig) {
    this.catalogs.set(cfg.id, cfg)
    this.emit()
  }
  unregister(id: string) {
    this.catalogs.delete(id)
    this.emit()
  }
  list(): CatalogConfig[] {
    return Array.from(this.catalogs.values()).sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100),
    )
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    for (const fn of this.listeners) fn()
  }
}
```

`useCatalogs()` is implemented via `useSyncExternalStore(reg.subscribe,
reg.list, reg.list)`, so any palette already mounted re-renders when
register/unregister fires. We retrofit the same pattern onto
`CommandRegistry` (also currently mutation-without-subscribe) as part
of this PR — small change, fixes a latent bug where late
`registerCommand` calls in the chat shell race with palette open.

### Catalog merge semantics

`WorkspaceProvider` accepts:

```ts
interface WorkspaceProviderProps {
  // … existing props …
  catalogs?: CatalogConfig[]
  /** Drop the built-in defaults (currently just FilesCatalog). */
  withDefaultCatalogs?: boolean // default true
  /** Hosts that want to suppress the palette entirely. */
  withCommandPalette?: boolean // default true (currently always true)
}
```

The provider's effective catalog list is:

1. Built-in defaults (FilesCatalog) — only when `withDefaultCatalogs`
   is `true` AND the host has supplied an `onOpenFile` (or whatever
   shape we settle on for default file-open; see "File-open
   ownership" below).
2. Host-passed `catalogs` prop.
3. Catalogs registered imperatively via
   `useCatalogRegistry().register(cfg)`.

By id: later wins on collision. Hosts can override the default
FilesCatalog by registering their own `id: "files"` catalog.

### File-open ownership

Codex flagged this. The provider can't dispatch into the chat shell's
`openArtifact` ref or the IDE's dockview API. So the provider doesn't
own file-open behavior — it just supplies the search adapter. Two
shapes:

- **Hosts that use `<DataProvider>` and want a sane default**: pass
  `onOpenFile?: (path: string) => void` to `WorkspaceProvider`. The
  provider builds the FilesCatalog with that callback wired into
  `onSelect`. Apps that don't pass `onOpenFile` get no FilesCatalog
  by default.
- **Hosts with custom file-open semantics** (chat shell): register
  their own FilesCatalog via `catalogs={[customFilesCatalog]}` (or
  via the registry), with `onSelect` that calls
  `surface.openPanel(...)` or whatever they need. They get the
  built-in adapter via a small helper:

  ```ts
  import { createFileSearchAdapter } from "@boring/workspace"

  const filesCatalog: CatalogConfig = {
    id: "files",
    label: "Files",
    order: 10,
    paletteIcon: <FileIcon className="size-4" />,
    recentKind: "file",
    adapter: createFileSearchAdapter(client),
    onSelect: (row) => surface.openPanel({ id: row.id, component: "code-editor", params: { path: row.id } }),
  }
  ```

`createFileSearchAdapter(client: DataClient)` is a thin pure factory
(no React) that takes a `DataClient` instance and returns the
adapter:

```ts
export function createFileSearchAdapter(client: DataClient): ExplorerAdapter {
  return {
    async search({ query, limit, signal }) {
      if (!query) return { items: [], total: 0, hasMore: false }
      const paths = await client.search(query, limit, { signal })
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

Note: this requires teaching `FetchClient.search` to accept an
AbortSignal
(`packages/workspace/src/data/fetchClient.ts:125-128` — currently
no signal arg). That's part of Phase 1's scope; ~5 lines.

### Recent migration

Current shape:

```ts
// localStorage["boring-ui-v2:command-palette:recent"] = ["foo.ts", "cmd:workspace.toggleSidebar", ...]
```

New shape:

```ts
type RecentEntry = {
  kind: string         // matches CatalogConfig.recentKind
  id: string           // catalog row id (file path, session id, …)
  title: string        // for display when the entry's catalog is unloaded
  subtitle?: string
  lastOpenedAt: number
}
// localStorage["boring-ui-v2:command-palette:recent:v2"] = RecentEntry[]
```

Migration runs once on palette mount: read the old key, transform each
entry. `"cmd:foo"` → `{ kind: "command", id: "foo", title: ..., ...}`
(or simply DROPPED — see open question below). Plain strings →
`{ kind: "file", id: <path>, title: basename(path), subtitle:
dirname(path), lastOpenedAt: Date.now() }`. Old key deleted after
migration.

The Recent group renders each entry through the catalog matching
`entry.kind`. If the catalog isn't registered (e.g. user has a recent
session but the SessionsCatalog isn't loaded in this app), the entry
renders read-only (with the saved `title` / `subtitle`) and clicking
does nothing visible — better than firing the wrong handler.

### Palette body shape

```tsx
<CommandList>
  <CommandEmpty>
    {isCommandMode ? "No matching commands" : "No results"}
  </CommandEmpty>
  {!isCommandMode && !searchQuery && recentEntries.length > 0 && (
    <RecentGroup entries={recentEntries} catalogs={catalogs} />
  )}
  {!isCommandMode && catalogs.map((c) => (
    <CatalogGroup key={c.id} catalog={c} query={searchQuery} />
  ))}
  {isCommandMode && commandResults.length > 0 && (
    <CommandsGroup commands={commandResults} … />
  )}
</CommandList>
```

`<CatalogGroup>`:

1. Calls `catalog.adapter.search(...)` debounced 300ms via a SHARED
   palette-level debounce (one debounced query → all catalogs
   receive the same stable string). Avoids 10 catalogs × independent
   timers.
2. Skips the call when `searchQuery === ""` (catalogs have no
   "default" results; Recent fills that role).
3. Each catalog gets its own AbortController, cancelled on every
   query change.
4. Wraps each call in a try/catch so a 500 from one catalog renders
   a small inline error chip in that group — the rest of the palette
   keeps working.
5. Renders `<CommandGroup heading={catalog.label}>` with up to
   `catalog.paletteLimit ?? 5` `<CommandItem>`s.
6. Wraps `catalog.onSelect(row)` so the palette closes + writes a
   typed Recent entry; catalogs never have to remember either step.
7. Returns `null` when results are empty so empty groups don't
   render.

Async-arrival ordering: groups render in their declared `order`
priority regardless of which adapter resolves first. Slow Files +
fast Sessions = Sessions slot reserves space (renders an empty
group + a "loading" line for the first 250ms of a query) so the
Files results don't push Sessions down when they arrive. Layout is
stable from the first render.

### `CommandEmpty`

Becomes `"No results"` (catalog-agnostic) when in search mode, and
`"No matching commands"` when in `>` mode. Distinct strings keep the
empty-state honest about which mode the user is in.

### Test plan

Phase 1 ships with:

- **Unit: `CatalogRegistry`** — register/unregister/list ordering,
  subscribe fires on mutation, useSyncExternalStore re-renders the
  consumer.
- **Unit: `createFileSearchAdapter`** — empty query short-circuits,
  populated query maps `paths` to `ExplorerRow`s, AbortSignal
  threading.
- **Unit: typed Recent migration** — old `string[]` shape →
  `RecentEntry[]`; `"cmd:..."` entries handled per the user
  decision below.
- **Integration: `<CommandPalette />` end-to-end against
  `<WorkspaceProvider catalogs={[stubCatalog]}>` (jsdom)** — open
  palette, type query, assert one stub-catalog group renders top-5
  rows, Enter on a row fires `onSelect` AND the palette closes.
  Open palette again → first row of Recent is the just-selected
  entry, with the right `kind`.
- **Integration: register-while-open** — open palette, register a
  new catalog, palette re-renders with the new group.
- **Integration: error per group** — stub catalog rejects;
  palette still renders other groups + an error chip in the failing
  group.
- **Integration: keyboard nav across async-loaded groups** — ↑/↓
  through groups while one's still loading; aria-selected stays
  correct, scroll-into-view doesn't jump.
- **Regression: recents type-mix bug** — populate localStorage with
  the legacy `["cmd:foo", "src/a.ts"]` shape, mount palette,
  assert `"cmd:foo"` does NOT trigger the file open path on click.
- **E2E in workspace-playground** — register a stub second catalog
  in the playground, ⌘K, type, assert two `<CommandGroup>` headings
  appear with disjoint rows. Existing cmd-palette tests
  (Escape/click-outside/effects) keep passing.

## Code simplifications enabled by this pattern

After the registry lands several adjacent things either get smaller,
get more declarative, or just stop being broken. The accounting below
is grounded in actual current code (codex caught v1 inventing
`useFileSearch` in the palette — there's no such thing today).

1. **`<CommandPalette />` body collapses to one loop + one commands
   group.** Today
   (`packages/workspace/src/components/CommandPalette.tsx:200-232`)
   has three hardcoded result blocks (`recentFiles`, `fileResults`,
   `commandResults`), each with its own group rendering. After: one
   `catalogs.map(c => <CatalogGroup catalog={c} query={searchQuery}
   />)` plus a single commands group when in `>` mode.

2. **Palette props go from 2 to 0.** Today's
   `CommandPaletteProps = { fileSearchFn, onOpenFile }`
   (`packages/workspace/src/components/CommandPalette.tsx:36-39`)
   exists only because the host had to thread the file-search
   callback AND the file-open callback in, but
   `WorkspaceProvider` mounts the palette with no props
   (`packages/workspace/src/WorkspaceProvider.tsx:377`) — the props
   are EFFECTIVELY DEAD in the default runtime. With catalogs they
   move into the FilesCatalog config. Palette becomes prop-less.

3. **`ChatCenteredShell`'s imperative `useEffect` block becomes
   declarative.** Today
   (`packages/workspace/src/components/chat/ChatCenteredShell.tsx:400-431`)
   re-registers commands on every render. The 3 toggle/new-chat
   actions stay as commands but become declarative — the shell
   accepts a `commands?: CommandConfig[]` shape mirroring the
   `catalogs?:` prop on the provider. The "Switch to: <session
   title>" loop becomes a `SessionsCatalog` (in-memory adapter
   filtering `props.sessions`) — Phase 1 includes this migration.

4. **`withCommandPalette` no-op shell prop drops.** Today
   (`packages/workspace/src/components/chat/ChatCenteredShell.tsx:77,
   197-205, 591-603`) the prop exists but is a runtime no-op (one
   palette is mounted by the provider, not the shell). Phase 1 adds
   `withCommandPalette` to `WorkspaceProvider` (where it actually
   has somewhere to control), then drops the shell prop.

5. **Recent type-mix bug gets fixed.** Today
   (`packages/workspace/src/components/CommandPalette.tsx:128-134`)
   stores `"cmd:" + id` for command recents but
   (`packages/workspace/src/components/CommandPalette.tsx:230-236`)
   renders every recent through `handleFileSelect`, calling
   `onOpenFile?.("cmd:foo")`. The typed-Recent migration in this
   PR removes the bug as a side-effect: typed entries route per
   `kind`.

6. **Test infra converges.** Catalog adapters become the unit of
   test for both surfaces. A SessionsCatalog tested in isolation
   against a mock adapter automatically tests the data path for
   both the data-pane explorer view and the cmd-palette inline view.

## Dead code that comes out

Not aspirational cleanup; each is gated on Phase 1 landing.

| File | Net | What |
|---|---|---|
| `packages/workspace/src/components/CommandPalette.tsx` | ~–80 | The dual `fileSearchFn` / `onOpenFile` props (lines 36-39, 64-65), the `fileResults` `useMemo` (140-147), `handleFileSelect` (158-168), the standalone Files `<CommandGroup>` (211-220). Consolidated into the catalog loop. |
| `packages/workspace/src/components/CommandPalette.tsx` (`FilePathLabel`) | –12 | `FilePathLabel` (239-251) is a perfect candidate for deletion. Its filename / dir split becomes `title` / `subtitle` on FilesCatalog rows; the row renderer uses `<DataExplorer />`-style "title bold + subtitle muted" baked in. |
| `packages/workspace/src/components/CommandPalette.tsx` (`CommandPaletteProps`) | –4 + breaking | Props type goes to `{}`; export removed. **Breaking change for any external consumer that imports `CommandPaletteProps`.** |
| `packages/workspace/src/components/chat/ChatCenteredShell.tsx` (imperative useEffect) | ~–30 | Lines 400-431. Replaced with one declarative `commands={[…]}` + `catalogs={[…]}` prop on the shell (or threaded via the `WorkspaceProvider` it sits under). |
| `packages/workspace/src/components/chat/ChatCenteredShell.tsx` (`withCommandPalette`) | –6 + breaking | Lines 77, 197-205, 591-603 (the no-op JSX comment block). **Breaking change for any external consumer that passes `withCommandPalette={false}` on the shell.** |
| `packages/workspace/src/components/CommandPalette.tsx` (loadRecent/saveRecent + RECENT_STORAGE_KEY constants 27-50) | rewritten | Stays in the file as the typed-Recent v2 implementation, but the v1 `string[]` shape is retired with a one-shot migration. |

**Files only changed (not deleted):**

- `packages/workspace/src/WorkspaceProvider.tsx` — gains
  `catalogs?: CatalogConfig[]`, `withCommandPalette?: boolean`,
  `withDefaultCatalogs?: boolean`, `onOpenFile?: (path: string) =>
  void`. ~+15 lines.
- `packages/workspace/src/registry/RegistryProvider.tsx` — adds
  `catalogRegistry` to the context. ~+8 lines.
- `packages/workspace/src/registry/CatalogRegistry.ts` (new, ~40
  lines) — sibling of `CommandRegistry`, with subscribe semantics.
  `CommandRegistry` retrofitted with the same subscribe pattern
  (~+20 lines).
- `packages/workspace/src/registry/index.ts` — re-exports
  `useCatalogs`, `useCatalogRegistry`, `CatalogRegistry`,
  `CatalogConfig`.
- `packages/workspace/src/data/fetchClient.ts` — `search` accepts
  `{ signal?: AbortSignal }`. ~+5 lines.
- `packages/workspace/src/components/CommandPalette.tsx` — net
  ~–80 lines after removals + ~+50 for `<CatalogGroup>` (parallel
  fetch + AbortSignal + render) + `<RecentGroup>` (typed routing).

**Net package size:** ~–60 lines of net source (well, minus
roughly +30 for new types and tests), simpler public surface, no
silently-broken Files path, no recent-type-mix bug. Two breaking
changes, both flagged.

## Migration / rollout

**Breaking changes shipped in Phase 1** (call them out in the
release notes; bump the workspace package's minor):

1. `CommandPaletteProps` export removed
   (`packages/workspace/src/index.ts:88`). External code that imports
   the type must remove the import. The component is now prop-less.
2. `ChatCenteredShellProps.withCommandPalette` removed
   (`packages/workspace/src/components/chat/ChatCenteredShell.tsx:77`).
   External code that disables the shell-level palette must move the
   flag onto `WorkspaceProvider` instead:
   `<WorkspaceProvider withCommandPalette={false}>`.
3. `localStorage["boring-ui-v2:command-palette:recent"]` keyspace
   migrates to `:recent:v2` with typed entries. Migration runs once
   on palette mount; old key deleted. Pre-migration recents from
   external builds will be lost if they don't follow the legacy
   shape — acceptable.

**Phase 1 (this PR) — the work, in order:**

1. Add `CatalogRegistry` + `useCatalogs` + `useCatalogRegistry`
   (subscribe-aware).
2. Retrofit `CommandRegistry` with `subscribe` so late
   `registerCommand` calls trigger palette re-render.
3. Add `withCommandPalette?` + `catalogs?` + `withDefaultCatalogs?` +
   `onOpenFile?` to `WorkspaceProvider`.
4. Teach `FetchClient.search` to accept an AbortSignal.
5. Add `createFileSearchAdapter(client)`.
6. Refactor `<CommandPalette />` to consume catalogs + render
   `<CatalogGroup>` / `<RecentGroup>`. Drop `fileSearchFn` /
   `onOpenFile` props + `FilePathLabel` + the Files `<CommandGroup>`
   block.
7. Run typed-Recent migration on palette mount.
8. Migrate `ChatCenteredShell`'s imperative `useEffect` to
   declarative `commands={[…]}` + `catalogs={[sessionsCatalog]}` on
   the shell (or threaded through the provider). Drop
   `withCommandPalette` prop.
9. Tests above.

**Phase 2 (separate PR per catalog):**

- `SessionsCatalog` for hosts with persistent sessions (full-app /
  similar). Backend: an `/api/v1/sessions/search` route — frontend
  package plan stays silent on the indexing strategy; backend's
  problem.
- `WorkspacesCatalog` (small N, in-memory filter is fine).
- Whichever catalog the consuming app needs next.

## Open questions

1. **What should the typed-Recent migration do with legacy
   `"cmd:foo"` entries?**
   Options: (a) DROP them — fewer surprises, no broken handlers; (b)
   convert to `{ kind: "command", id: "foo", title: ?, lastOpenedAt:
   <now> }` — preserves history but the title is missing in
   localStorage so we'd need a lookup at mount time. **Recommend
   (a):** drop them. Recents are ephemeral; the bug they expose
   (commands re-fired through file-open path) is more important than
   preserving stale entries.

2. **Should hosts that don't pass `onOpenFile` get NO FilesCatalog,
   or get a FilesCatalog whose `onSelect` is a no-op (search but
   can't open)?**
   Search-without-open feels like a footgun (user clicks → nothing
   happens). **Recommend: no FilesCatalog by default unless
   `onOpenFile` is supplied.** Hosts with custom file-open logic
   register their own. Documented + defaulted.

3. **Should `CatalogConfig.onSelect` be allowed to be async?**
   Codex flagged. The palette wants to close + record Recent
   immediately, before the host's side-effect resolves. **Recommend:
   `onSelect` returns `void` synchronously; if a host needs async
   work, fire-and-forget inside the callback.** Palette doesn't
   block on it.

4. **Should the catalog set be scoped per provider or per shell?**
   Per provider. Consistent with `commandRegistry` today. Multiple
   shells under one provider share. If we ever need per-shell
   scoping it can be a sibling provider — out of scope here.

5. **Should we expose the imperative registry mutation pattern for
   non-React-tree consumers (e.g. server-side code)?**
   Defer. The chat shell scenario v1 worried about turns out to be
   pure-React (registering catalogs in response to props). Premature
   to design a non-React API. Revisit if a real consumer shows up.

## Acceptance

- `WorkspaceProvider` accepts `catalogs?: CatalogConfig[]` and
  exposes them via `useCatalogs()` (subscribe-aware).
- `<CommandPalette />` renders one group per registered catalog
  with matching results (top 5 default, debounced palette-wide,
  AbortSignal-aware, error-isolated per group).
- Files keep working when a host supplies `onOpenFile` — and works
  for the FIRST TIME in the default runtime (today the Files path is
  dead).
- Adding a second catalog is a 30-line addition: write the
  `ExplorerAdapter`, write the `CatalogConfig`, pass it through
  `<WorkspaceProvider catalogs={[…]}>`. No `<CommandPalette />`
  changes needed.
- Recent entries are typed; selecting a "recent command" no longer
  fires the file-open path.
- `ChatCenteredShell` no longer registers commands imperatively in
  `useEffect`; the registration is declarative.
- Two flagged breaking changes (CommandPaletteProps export,
  withCommandPalette shell prop) are documented in the release
  notes.
- Tests in §Test plan all pass.

## Reference

- Existing palette:
  `packages/workspace/src/components/CommandPalette.tsx`
- Existing adapter shape:
  `packages/workspace/src/components/DataExplorer/types.ts`
- Existing command registry:
  `packages/workspace/src/registry/CommandRegistry.ts`
- File search HTTP route (one shared backend with the LLM tool, just
  landed at commit `12098fd`):
  `packages/agent/src/server/http/routes/search.ts`
- Workspace provider's current palette mount point:
  `packages/workspace/src/WorkspaceProvider.tsx:377`
- Chat shell's imperative command useEffect to remove:
  `packages/workspace/src/components/chat/ChatCenteredShell.tsx:400-431`
