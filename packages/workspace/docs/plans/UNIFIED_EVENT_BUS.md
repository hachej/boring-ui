# Unified event bus for workspace + agent

**Status:** revision 2 — incorporating Codex + Gemini review
**Owners:** workspace
**Last updated:** 2026-04-28

## Review summary (2026-04-28)

Codex and Gemini reviewed revision 1 independently. Convergent feedback
(both reviewers raised) is taken as binding for revision 2; divergent
feedback is called out inline at the relevant step / question.

**Binding changes (both reviewers agreed):**

- **`write`-vs-create ambiguity** in step 3. The agent's `op: 'write'`
  fires for both new files and overwrites. Mapping it to `file:created`
  causes false-positive "new file" effects. → Split into a separate
  `file:changed` event for content-only mutations, and require an
  explicit `existsBefore` (or upstream signal) before emitting
  `file:created`.
- **State vs transitions** in step 5. A pure edge-triggered bus loses
  state for components that mount after the event. → Bus events are
  *transitions only*, never state. Components query initial state on
  mount (`getPanels()`, `getActivePanelId()`, `isSavingPath(p)`) and
  then subscribe for updates. `getSnapshot()` and friends survive as
  small read APIs.
- **`emit` stays synchronous.** No `await Promise.all(listeners)`. Slow
  consumers fire-and-forget their own async work.
- **Question Q4 (replay-on-subscribe) is settled:** no replay in the
  bus. State queries handle late-mount cases. (Open question removed.)
- **Question Q2 (sync vs async) is settled:** sync only. (Open
  question removed.)
- **Stronger correlation typing:** `toolCallId` is required when
  `cause === 'agent'`. Encode this as a discriminated union on `cause`
  rather than a flat optional.

**Significant additions:**

- New event: **`file:error`** — broadcasts a failed file op so toasts
  / status surfaces don't each re-implement the try/catch (Gemini).
- New events: **`agent:run:start`** / **`agent:run:end`** — let UI
  group a flurry of agent-driven file ops into a single progress
  indicator (Gemini).
- New event: **`panel:closing`** — pre-close hook so consumers can
  cancel queries / flush saves before teardown (Codex).
- **Cascading directory operations** (Gemini). A rename of
  `src/hooks/` → `src/utils/` is a single FS operation but every open
  editor inside that subtree needs to update. Two viable shapes; the
  plan picks fan-out (see below).
- **Saving badge keys off panelId, not path** (Codex). Rename-during-
  save would break a path-keyed badge.
- **Step 2 shim hardened:** explicit per-name translators (no
  `as never` / `as object` casts), `onAny` bridge filters to `file:*`
  prefix only, and the legacy export gets a deprecation warning for one
  release before removal.

**Most important still-open question:** Q7 (where the agent SSE
adapter lives). Gemini argues it must be a global non-UI singleton so
agent file events don't drop while the chat panel is unmounted. Codex
argues it should live in `@boring/agent` to avoid a workspace import
loop. These don't conflict — see the "Where the SSE adapter lives"
section below for the resolved shape.

The rest of this document is the original plan with edits inline.

## Problem

We have at least four disjoint pubsub-shaped mechanisms today, each
reinventing emit/subscribe with subtly different semantics:

1. **`packages/workspace/src/data/fileEvents.ts`** — module-level set of
   listeners. Mutations `useMoveFile` / `useDeleteFile` / `useCreateDir`
   emit `moved | deleted | created`. `DockviewShell` listens and updates
   open panels in place (rename-in-place + tab close on delete). User-
   originated changes only.
2. **`packages/agent/src/front/hooks/useFileChangeStream.ts`** —
   translates the agent's SSE `data-file-changed` chunks (`op: 'write' |
   'edit' | 'unlink' | 'rename' | 'mkdir'`, `path`, `oldPath`,
   `toolCallId`, `timestamp`) into react-query cache invalidations.
   **Does not feed `fileEvents`**, so an agent-driven rename leaves any
   open editor pane stale (the same bug we just fixed for the tree).
3. **`packages/workspace/src/toast/index.tsx`** — module-level set of
   listeners for UI notifications.
4. **Dockview** — `onDidAddPanel` / `onDidRemovePanel` /
   `onDidActivePanelChange` emitted by the dockview library; consumed
   inside `SurfaceShell` to push snapshots through `onChange`.

Plus near-future asks that are clearly events:

- **Tab saving badge** — the editor needs to tell the dock tab "save
  started / save finished" so the tab title can render a spinner.
- **DB query lifecycle** — the chart canvas / data explorer fires
  long-running queries; closing a pane should cancel them, slow queries
  should drive a status indicator.
- **Selection + navigation** — agent `select(...)` flows already exist
  via `WorkspaceBridge.select()` but the dispatch path is bespoke.

Each net-new event becomes another module-level Set of listeners, or
another callback prop threaded down through three layers. We're paying
the cost twice and the user has hit the inconsistency once already
(agent moves file → tab stays stale).

## Goal

A single typed event bus, owned by `@boring/workspace`, used by:

- mutation hooks in `data/hooks.ts`
- the agent SSE stream translator in `useFileChangeStream`
- the editor / pane lifecycle (save start/end, dirty/clean)
- pane lifecycle (opened/closed/active/title-changed)
- DB / query lifecycle
- any future cross-cutting signal

…with one ergonomic API:

```ts
events.on('file:moved', ({ from, to, cause }) => { … })
events.emit('file:moved', { from: 'a', to: 'b', cause: 'user' })
events.onAny((name, payload) => log(name, payload))
const unsub = events.on('editor:save:start', …)
unsub()
```

Subscribers don't care whether the event came from the user clicking in
the tree, the agent calling a tool, or an external sync stream — they
just see one typed payload.

## Design

### Primitive: `createEventBus<TMap>()`

```ts
// packages/workspace/src/events/bus.ts (new)

export interface EventBus<TMap extends Record<string, unknown>> {
  on<K extends keyof TMap>(name: K, fn: (payload: TMap[K]) => void): () => void
  once<K extends keyof TMap>(name: K, fn: (payload: TMap[K]) => void): () => void
  off<K extends keyof TMap>(name: K, fn: (payload: TMap[K]) => void): void
  emit<K extends keyof TMap>(name: K, payload: TMap[K]): void
  onAny(fn: <K extends keyof TMap>(name: K, payload: TMap[K]) => void): () => void
}

export function createEventBus<TMap extends Record<string, unknown>>(): EventBus<TMap>
```

Implementation is ~50 lines of plain JS:
- `Map<keyof TMap, Set<Listener>>` for typed subscribers
- one `Set<AnyListener>` for `onAny`
- `emit` snapshots both before iterating (safe to subscribe/unsubscribe
  during dispatch — same invariant `fileEvents.ts` already has)
- a thrown listener never takes down the chain (try/catch around each
  call), but the error is forwarded to a single `_lastError` slot so
  tests can assert (and we eventually surface to logs)

No runtime deps. No async/promise semantics on emit — listeners that
need to do async work fire-and-forget their own promise.

### The event map

One file owns the canonical map. `Origin` is a discriminated union — we
get static guarantees that agent-originated events carry a
`toolCallId`, and that user-originated events can carry a
`correlationId` (e.g. for routing toasts back to the action that fired
them).

```ts
// packages/workspace/src/events/types.ts

export type Origin =
  | { cause: 'user'; correlationId?: string }
  | { cause: 'agent'; toolCallId: string; runId?: string }
  | { cause: 'sync' }
  | { cause: 'system' }

/** Common envelope on every event payload. */
export type EventMeta = Origin & { ts: number }

export interface WorkspaceEventMap {
  // ── filesystem ───────────────────────────────────────────────────
  'file:moved':    EventMeta & { from: string; to: string; isDir?: boolean }
  'file:deleted':  EventMeta & { path: string; isDir?: boolean }
  'file:created':  EventMeta & { path: string; kind: 'file' | 'dir' }
  'file:changed': EventMeta & { path: string }     // overwrite / content edit
  'file:error':    EventMeta & { op: 'move' | 'delete' | 'create' | 'write'; path: string; error: string }

  // ── panel lifecycle ──────────────────────────────────────────────
  'panel:opened':       { id: string; component: string; params?: Record<string, unknown> }
  'panel:closing':      { id: string }   // pre-close hook (cancel queries, flush save)
  'panel:closed':       { id: string }
  'panel:active':       { id: string | null }
  'panel:title':        { id: string; title: string }

  // ── editor lifecycle (drives the saving badge) ───────────────────
  // Keyed by panelId, NOT path: rename mid-save would orphan a
  // path-keyed badge. Subscribers map panelId→path on their own when
  // they need the path.
  'editor:dirty':       { panelId: string }
  'editor:clean':       { panelId: string }
  'editor:save:start':  { panelId: string }
  'editor:save:end':    { panelId: string; ok: boolean; error?: string }

  // ── data / query lifecycle ───────────────────────────────────────
  'query:start':        { id: string; ownerPanelId?: string; sql?: string; source?: string }
  'query:end':          { id: string; ownerPanelId?: string; ok: boolean; rows?: number; ms: number }
  'query:error':        { id: string; ownerPanelId?: string; error: string }
  'query:cancel':       { id: string }

  // ── agent run lifecycle ─────────────────────────────────────────
  // Lets UI group a flurry of agent-driven file ops into a single
  // progress indicator / undo grouping.
  'agent:run:start':    { runId: string; sessionId?: string }
  'agent:run:end':      { runId: string; ok: boolean }

  // future: 'tree:expanded', 'selection:changed', 'workspace:switched', …
}
```

**Cascading directory operations.** A directory rename is a single FS
op; the bus emits **one** `file:moved` with `isDir: true`, then the
emitter (mutation hook or SSE bridge) also emits one `file:moved` per
*known-open* descendant path. The DockviewShell listener already does
prefix matching on `params.path`, so a single `isDir` event PLUS the
fan-out lets both prefix-aware consumers (a tree breadcrumb) and
naive consumers (an open editor tab) get the right answer. Tree
subscribers MUST use prefix-matching to update their state for
unopened descendants — those don't get fan-out events.

Adding a new event = adding a key to the map. The bus is
parametric so consumers in agent/full-app can extend with their own
TMap if needed (rare; default is the workspace map).

### `cause` is load-bearing (now a discriminated union)

The `Origin` discriminated union lets every consumer make local UX
decisions while staying type-safe:

- file tree drag → `{ cause: 'user', correlationId? }` → toast "Moved"
- agent tool call → `{ cause: 'agent', toolCallId, runId? }` → no toast
  (agent's own chat message is the source of truth) but the open pane
  rename-syncs and the event traces back to the exact tool call
- external file watcher → `{ cause: 'sync' }` → silent rename
- programmatic boot-time → `{ cause: 'system' }`

Encoding `toolCallId` as required-when-`cause==='agent'` (vs an
optional field) catches the "agent emit forgot to attach the
toolCallId" bug at compile time. Reviewer-driven change.

### Where it lives

- **Bus instance:** module singleton at
  `packages/workspace/src/events/index.ts`. Same shape and lifetime
  semantics as the existing toast and `fileEvents` singletons.
- **Importable from:** `@boring/workspace` (both runtime export and the
  `WorkspaceEventMap` type).
- **Mounted automatically:** nothing to mount — module side-effects
  only. Listeners are React-friendly (use in `useEffect` with the
  unsub return value).

### Convenience hook

```ts
// packages/workspace/src/events/useEvent.ts
export function useEvent<K extends keyof WorkspaceEventMap>(
  name: K,
  handler: (payload: WorkspaceEventMap[K]) => void,
): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => events.on(name, (p) => ref.current(p)), [name])
}
```

So the React side reads `useEvent('file:moved', ({ from, to }) => …)`
without needing to think about cleanup.

## Migration

Each step keeps the test suite green and is independently shippable.

### Step 1 — Add the bus, no consumers yet

- New files: `packages/workspace/src/events/bus.ts`, `events/types.ts`,
  `events/index.ts`, `events/useEvent.ts`.
- Tests: `events/__tests__/bus.test.ts` covers on/once/off/emit/onAny,
  unsubscribe-during-dispatch, listener-throws-doesn't-stop-chain,
  type-only assertion that `WorkspaceEventMap` keys are exhaustive
  (compile-time test via a `satisfies` block).
- Public API: `import { events, useEvent } from '@boring/workspace'`.
- No behavior change yet.

### Step 2 — Re-point `fileEvents.ts` to the bus

`fileEvents.ts` becomes a deprecation shim with **explicit
per-name translators** (no `as never` / `as object` casts that defeat
the type system the bus is trying to introduce — reviewer-driven
change):

```ts
// packages/workspace/src/data/fileEvents.ts — kept for one release
import { events } from '../events'

let warnedSubscribe = false

export type FileEvent =
  | { type: 'moved'; from: string; to: string }
  | { type: 'deleted'; path: string }
  | { type: 'created'; path: string; kind: 'file' | 'dir' }

export function emitFileEvent(e: FileEvent): void {
  const meta = { cause: 'user' as const, ts: Date.now() }
  if (e.type === 'moved')   events.emit('file:moved',   { ...meta, from: e.from, to: e.to })
  if (e.type === 'deleted') events.emit('file:deleted', { ...meta, path: e.path })
  if (e.type === 'created') events.emit('file:created', { ...meta, path: e.path, kind: e.kind })
}

export function subscribeFileEvents(fn: (e: FileEvent) => void): () => void {
  if (!warnedSubscribe && process.env.NODE_ENV !== 'production') {
    console.warn('[workspace] subscribeFileEvents is deprecated. Use `events.on("file:moved", …)` from @boring/workspace.')
    warnedSubscribe = true
  }
  // Subscribe explicitly to file:* names — onAny would receive
  // unrelated events (panel:*, editor:*) and re-fire them as the
  // legacy union, which is wrong.
  const unsubs = [
    events.on('file:moved',   (p) => fn({ type: 'moved',   from: p.from, to: p.to })),
    events.on('file:deleted', (p) => fn({ type: 'deleted', path: p.path })),
    events.on('file:created', (p) => fn({ type: 'created', path: p.path, kind: p.kind })),
  ]
  return () => unsubs.forEach((u) => u())
}
```

Existing callers keep working; new callers use `events.on(...)`. After
one or two PRs migrating consumers, delete `fileEvents.ts`.

`DockviewShell`'s subscriber gets rewritten in this step:

```ts
useEvent('file:moved', ({ from, to, isDir }) => {
  // For isDir=true, also handle prefix-rewrite for any open child
  // panels — but those panels also receive their own file:moved
  // fan-out events (see the event map for details), so the prefix
  // pass is only needed when the listener wants to update non-open
  // breadcrumbs / labels.
})
useEvent('file:deleted', ({ path, isDir }) => { /* close panel or any panel under prefix */ })
```

> **Release-gate this with step 3.** Reviewer flag (Codex): if step 2
> ships alone, the user→pane sync improves but the agent→pane bug
> stays. Treat 2+3 as one PR.

### Step 3 — Wire the agent SSE stream

> **Reviewer-driven changes**:
> - `op: 'write'` is *not* unconditionally a `file:created` — overwrites
>   are common and would generate false "new file" effects. Use the SSE
>   schema's existing signal (the server-side workspace knows whether
>   the path existed before the write) to disambiguate. If the schema
>   doesn't carry that today, **add an `existsBefore: boolean` field to
>   the SSE payload as a precondition for step 3** — without it,
>   step 3 ships with a known false-positive bug.
> - The translator must run regardless of which UI components are
>   mounted. Putting it inside `useFileChangeStream` (a React hook tied
>   to ChatPanel) means agent file events drop while the chat panel is
>   unmounted but the agent run is still in flight (Gemini). → Move to
>   a long-lived consumer of the SSE stream that's installed when the
>   agent client is created, not when ChatPanel mounts. See "Where the
>   SSE adapter lives" below.

```ts
const meta = (toolCallId: string, runId?: string) =>
  ({ cause: 'agent', toolCallId, runId, ts: Date.now() }) as const

if (op === 'rename' && oldPath) {
  events.emit('file:moved', { ...meta(toolCallId, runId), from: oldPath, to: path })
} else if (op === 'unlink') {
  events.emit('file:deleted', { ...meta(toolCallId, runId), path })
} else if (op === 'mkdir') {
  events.emit('file:created', { ...meta(toolCallId, runId), path, kind: 'dir' })
} else if (op === 'write') {
  if (existsBefore) events.emit('file:changed', { ...meta(toolCallId, runId), path })
  else              events.emit('file:created', { ...meta(toolCallId, runId), path, kind: 'file' })
} else if (op === 'edit') {
  events.emit('file:changed', { ...meta(toolCallId, runId), path })
}
```

Now an agent-driven rename updates the open editor tab the same way a
user-driven rename does. Existing react-query invalidations stay — they
pre-warm caches; the bus drives UI state.

Regression tests:
1. Render a `DockviewShell` with a `file:foo.ts` panel open, fire a
   synthetic `data-file-changed` SSE chunk through the SSE adapter,
   assert the tab title and `params.path` updated.
2. Fire a `write` chunk for a path that existed before → expect
   `file:changed`, NOT `file:created`. (Current code path would emit
   `file:created` and is the bug we're fixing.)
3. Unmount ChatPanel mid-run, fire a `data-file-changed` chunk via the
   long-lived adapter, assert the bus still sees the event.

### Where the SSE adapter lives

Codex flagged this as the highest-impact open question. Resolved shape:

- **The adapter lives in `@boring/agent`** (translator from SSE schema
  to `events` calls). Reason: the SSE schema is owned by the agent
  package; coupling the translator to the schema avoids a cycle.
- **It does not depend on a React tree.** It hooks into the long-lived
  agent client (the same object the ChatPanel uses), so unmounting
  ChatPanel doesn't drop events. Pseudocode:

  ```ts
  // packages/agent/src/front/eventsBridge.ts
  import { events } from '@boring/workspace'
  export function attachFileEventsBridge(client: AgentClient): () => void {
    return client.onStreamChunk((chunk) => {
      if (chunk.type !== 'data-file-changed') return
      // …translate to events.emit(...) as in step 3 above
    })
  }
  ```
- **The host wires it once at app boot**, e.g. in the WorkspaceProvider
  or app entry point. We do not import `@boring/agent` from
  `@boring/workspace` — the dependency stays one-way (agent → workspace).

### Step 4 — Editor lifecycle + tab saving badge

> **Reviewer-driven change** (Codex): keyed off `panelId`, not `path`.
> A rename mid-save would orphan a path-keyed badge — the editor's save
> still completes, but the tab (now showing the new path) never sees
> the matching `editor:save:end` because the path it's watching is
> stale.

`MarkdownEditorPane` (and `CodeEditorPane`) — already receive a
`panelId` from dockview:

```ts
// inside the debounced save flow
events.emit('editor:save:start', { panelId })
try {
  await writeFile({ path, content })
  events.emit('editor:save:end', { panelId, ok: true })
} catch (err) {
  events.emit('editor:save:end', { panelId, ok: false, error: String(err) })
}
```

The custom `ShadcnTab` already receives the panel's `id`, so the badge
hook keys off it directly:

```tsx
function useIsSaving(panelId: string) {
  const [saving, setSaving] = useState(false)
  useEvent('editor:save:start', (p) => p.panelId === panelId && setSaving(true))
  useEvent('editor:save:end',   (p) => p.panelId === panelId && setSaving(false))
  return saving
}
```

The tab renders a small `<Loader2 className="animate-spin" />` next to
the dirty dot when `useIsSaving(panel.id)` is true.

Late-mount handling: a tab that mounts during an in-flight save
correctly shows "not saving" until the next transition. This is
intentional — the alternative (replay-on-subscribe) makes the bus a
state manager. If the user hits a real "I cmd+tabbed away mid-save and
came back to a stale display" complaint, fix it by querying the
editor pane's own `isSaving()` getter on tab mount, not by adding
replay to the bus.

### Step 5 — Pane lifecycle (events for transitions, queries for state)

> **Reviewer-driven change** (both reviewers): a pure event stream
> loses state for late mounters. Don't replace `getSnapshot`; augment
> it with transition events.

DockviewShell emits transitions:

```ts
api.onDidAddPanel((p)          => events.emit('panel:opened', { id: p.id, component: …, params: p.params }))
api.onWillRemovePanel?.((p)    => events.emit('panel:closing', { id: p.id }))
api.onDidRemovePanel((p)       => events.emit('panel:closed', { id: p.id }))
api.onDidActivePanelChange((p) => events.emit('panel:active', { id: p?.id ?? null }))
```

State stays queryable via the existing `SurfaceShellApi.getSnapshot()`
plus a new `useDockviewApi().getPanels()` (already exposed). Hosts that
want a derived `openTabs[]` either:

1. Read once from `getSnapshot()` on mount, then patch with bus events
   (recommended pattern for new code).
2. Keep the `onChange` callback as a back-compat wrapper that
   internally subscribes to the bus and re-derives the snapshot. We
   keep `onChange` for one release after step 5 lands.

`panel:closing` is the new pre-close hook. Consumers (e.g. data
explorer with in-flight queries) listen and call `events.emit('query:cancel', …)`
before the tab is gone, so they aren't racing teardown.

### Step 6 — Query lifecycle

> **Reviewer-driven change**: payloads carry `ownerPanelId` so a
> closed pane can cancel its in-flight queries without each consumer
> reinventing query→pane bookkeeping.

DataExplorer / chart canvas adapters emit on each query they fire,
attaching `ownerPanelId`. UI gates a "Cancel" button on `query:start`
state. A central `panel:closing` listener iterates active queries and
fires `query:cancel` for any whose `ownerPanelId` matches.

`query:error` is a separate event from `query:end ok:false` so simple
"slow query toast" subscribers can subscribe to one channel and not
have to inspect `ok` flags.

### Step 7 — Drop the deprecation shim

After the in-tree consumers are migrated AND the deprecation warning
has shipped in at least one release, delete `fileEvents.ts`. External
consumers see a clean import error pointing to the bus.

> **Reviewer note** (Codex): if `@boring/workspace` is consumed as a
> non-major version by external repos, ship the deprecation warning
> for one release before removal — don't slip the removal into a minor.

## Use cases proven by this design

- **Rename open file** — already shipped via `fileEvents`; migrating
  this consumer is the canary. (No behavior change for users.)
- **Agent renames open file** — fixed by step 3.
- **Tab saving badge** — step 4 is exactly the right shape.
- **Cancel queries when pane closes** — step 6, falls out of
  `panel:closed` + `query:cancel`.
- **Toast for user-driven file ops, silent for agent** — `cause` field;
  `useEvent('file:moved', e => e.cause === 'user' && toast.success(…))`.
- **Future "recent files" panel** — subscribes to `panel:opened` once,
  no glue code.

## Non-goals

- **Server-side persistence.** This bus is in-process. Replay across
  page reloads, durability, undo/redo are out of scope. The agent's SSE
  stream is still authoritative for cross-process events.
- **Cross-window sync.** No `BroadcastChannel` integration in v1. If we
  need it we can add an adapter that mirrors a subset of events.
- **Replace dockview's own emitter.** We adapt to it, not replace it —
  step 5 just adds a translator.
- **Replace toasts.** `toast.success(…)` keeps its own module. Toasts
  are UI state, not domain events. (They could subscribe to the bus and
  auto-toast; we keep that optional.)

## Open questions

Resolved by review (2026-04-28):

- ~~Q2 (async listeners):~~ **Settled — sync only.** Both reviewers
  flagged async-emit as a trap (deadlocks, render stalls).
- ~~Q4 (replay-on-subscribe):~~ **Settled — no replay.** Bus emits
  transitions; state lives in the owning component, queryable on
  mount.
- ~~Q7 (where the SSE adapter lives):~~ **Settled — in
  `@boring/agent`,** as a long-lived stream subscriber (not a React
  hook). See "Where the SSE adapter lives" above.

Resolved by user (2026-04-28):

- ~~Q1 (single bus vs typed channels):~~ **Single bus.** One `events`
  instance, one `WorkspaceEventMap`. Re-evaluate at 30+ events.
- ~~Q2 (naming convention):~~ **Colon namespacing.** `file:moved`,
  `panel:opened`, `editor:save:start`. Matches cmdk + vscode; enables
  prefix filtering (`file:*`).
- ~~Q3 (`cause: 'system'`):~~ **Keep.** Boot-time reconciliation /
  migration scripts have semantically distinct origins from external
  sync sources. Cheap to remove later if unused.
- ~~Q6 (cascading directory rename fan-out):~~ **Listener does prefix
  rewrite.** The emitter fires ONE `file:moved` with `isDir: true`.
  Each listener (DockviewShell, etc.) iterates its own state and
  rewrites paths starting with `from + '/'`. Emitter stays dumb;
  listeners are smart. (Pseudocode below.)

  ```ts
  useEvent('file:moved', ({ from, to, isDir }) => {
    if (isDir) {
      for (const p of api.panels) {
        const path = (p.params as { path?: string } | undefined)?.path
        if (path?.startsWith(from + '/')) {
          const newPath = to + path.slice(from.length)
          p.api.updateParameters({ ...(p.params as object), path: newPath })
          p.api.setTitle(newPath.split('/').pop() ?? newPath)
        }
      }
    } else {
      // existing single-file path
    }
  })
  ```

Still open (low-priority):

- **Idempotency / debouncing.** No debouncing in the bus; consumers
  debounce themselves. Reaffirmed by step 4 (save-start/end are
  discrete; we don't need to debounce `editor:dirty`).
- **Test ergonomics.** Ship `events._reset()` as a test helper (mirror
  of `_resetFileEventListeners`) plus a documented vitest pattern. No
  need for a `withTestBus()` factory yet.

## Migration risk

Low. Each step is additive; the deprecation shim in step 2 means we
never have a state where a consumer is broken. The only tricky bit is
making sure `cause` is set everywhere — easiest enforced by typing
`cause` as required (no default), so a missing field is a TS error at
the emit site.

## Acceptance criteria

- One typed bus instance accessible as `events` from `@boring/workspace`.
  Discriminated `Origin` union enforced by TS.
- All four legacy mechanisms (`fileEvents`, agent SSE, dockview events,
  any new editor lifecycle) emit through it.
- Agent-driven file rename updates an open editor pane in place
  (regression test in `dock.test.tsx`, parallel to the user-driven
  case).
- Agent overwrite (`op: 'write'` with `existsBefore: true`) emits
  `file:changed`, not `file:created`. Regression test.
- ChatPanel can unmount and remount mid-agent-run without losing file
  events. Regression test against the new long-lived SSE adapter.
- Tab title shows a saving spinner during debounced save, keyed off
  `panelId`. Rename-mid-save still clears the badge.
- Directory rename updates every open editor whose path was under the
  old prefix. Regression test.
- `panel:closing` fires before `panel:closed` and gives consumers a
  chance to flush. Regression test.
- No `fileEvents.ts` in the tree after step 7 + one-release deprecation
  window.
- No regressions on the workspace test suite (currently 760 passing,
  excluding the 16 pre-existing CommandPalette flakes).
