import { useCallback, useEffect, useRef, useState } from "react"
import { useWorkspacePluginClient, WorkspacePluginClientRequestError, type PaneProps } from "@hachej/boring-workspace"
import {
  createShapeId,
  parseTldrawJsonFile,
  serializeTldrawJson,
  Tldraw,
  toRichText,
  type Editor,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw"
import "tldraw/tldraw.css"
import { normalizeTldrawResourcePath, type CanvasAction, type CanvasCreateShape, type PendingCanvasBatch, type TldrawAgentParams } from "../shared"

export const TLDRAW_AGENT_PANEL_ID = "tldraw-agent-panel"
type Revision = { size: number; mtimeMs: number; sha256: string }

export function createSerializedSaveQueue(options: {
  snapshot: () => Promise<string>
  commit: (json: string, generation: number) => Promise<void>
}) {
  let dirtyGeneration = 0
  let savedGeneration = 0
  let running: Promise<void> | null = null
  let pending: { generation: number; json: string } | null = null
  return {
    markDirty() { dirtyGeneration += 1; return dirtyGeneration },
    hasDirty() { return dirtyGeneration > savedGeneration || pending !== null },
    currentGeneration() { return dirtyGeneration },
    pendingGeneration() { return pending?.generation },
    reconcileToLoadedState(generation = dirtyGeneration) {
      if (pending && pending.generation <= generation) pending = null
      savedGeneration = Math.max(savedGeneration, generation)
    },
    discardFailedGeneration(generation: number) {
      if (pending?.generation === generation) pending = null
      savedGeneration = Math.max(savedGeneration, generation)
    },
    flush() {
      if (running) return running
      const loop = (async () => {
        while (savedGeneration < dirtyGeneration || pending) {
          if (!pending) pending = { generation: dirtyGeneration, json: await options.snapshot() }
          await options.commit(pending.json, pending.generation)
          savedGeneration = pending.generation
          pending = null
        }
      })()
      running = loop.finally(() => { running = null })
      return running
    },
  }
}

export async function reconcileFailedSave(
  queue: ReturnType<typeof createSerializedSaveQueue>,
  failedGeneration: number,
  reload: (applySnapshot: boolean) => Promise<void>,
): Promise<boolean> {
  const hadNewerLocalEdits = queue.currentGeneration() > failedGeneration
  // A conflict revision is accepted only together with its durable snapshot.
  // We deliberately enter conflict recovery by discarding unsaved local
  // generations rather than rebasing stale editor state over external edits.
  await reload(true)
  queue.discardFailedGeneration(failedGeneration)
  queue.reconcileToLoadedState(queue.currentGeneration())
  return hadNewerLocalEdits
}

export function createCanvasReadinessGate() {
  let ready = false
  return {
    isReady: () => ready,
    markReady: () => { ready = true },
    reset: () => { ready = false },
  }
}

function idFor(value: string): TLShapeId { return createShapeId(value.replace(/^shape:/, "")) }
function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `tldraw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createShapePartial(shape: CanvasCreateShape): TLShapePartial {
  const id = idFor(shape.id)
  if (shape.type === "text") {
    return { id, type: "text", x: shape.x, y: shape.y, props: { richText: toRichText(shape.text ?? ""), color: shape.color ?? "black", w: shape.w ?? 240, autoSize: false } }
  }
  return {
    id, type: "geo", x: shape.x, y: shape.y,
    props: { geo: shape.type, w: shape.w ?? 220, h: shape.h ?? 96, richText: toRichText(shape.text ?? ""), color: shape.color ?? "black", fill: shape.fill ?? "semi" },
  }
}

function existingIds(editor: Editor, values: string[], minimum: number): TLShapeId[] {
  const ids = values.map(idFor)
  if (new Set(ids).size !== ids.length) throw new Error("action requires unique canonical shape ids")
  if (ids.length < minimum) throw new Error(`action requires at least ${minimum} shape ids`)
  const missing = ids.filter((id) => !editor.getShape(id))
  if (missing.length) throw new Error(`missing shapes: ${missing.join(", ")}`)
  return ids
}

export function loadCanvasStoreSnapshot(editor: Editor, snapshot: ReturnType<Editor["store"]["getStoreSnapshot"]>): void {
  editor.store.mergeRemoteChanges(() => { editor.loadSnapshot(snapshot) })
  editor.clearHistory()
}

export function applyCanvasAction(editor: Editor, action: CanvasAction): void {
  if (action.type === "clear") { editor.deleteShapes([...editor.getCurrentPageShapeIds()]); return }
  if (action.type === "delete") { editor.deleteShapes(existingIds(editor, action.ids, 1)); return }
  if (action.type === "create") {
    const id = idFor(action.shape.id)
    if (editor.getShape(id)) throw new Error(`shape already exists: ${action.shape.id}`)
    editor.createShape(createShapePartial(action.shape)); return
  }
  if (action.type === "update") {
    const id = existingIds(editor, [action.shape.id], 1)[0]!
    const existing = editor.getShape(id)!
    if (action.shape.target !== existing.type) throw new Error(`shape type mismatch for ${action.shape.id}`)
    if (!Object.keys(action.shape).some((key) => key !== "id" && key !== "target")) throw new Error("update requires at least one mutable property")
    const partial: TLShapePartial = { id, type: existing.type }
    if (action.shape.x !== undefined) partial.x = action.shape.x
    if (action.shape.y !== undefined) partial.y = action.shape.y
    const props: Record<string, unknown> = {}
    if (action.shape.w !== undefined) props.w = action.shape.w
    if (action.shape.color !== undefined) props.color = action.shape.color
    if (action.shape.target === "geo") {
      if (action.shape.h !== undefined) props.h = action.shape.h
      if (action.shape.fill !== undefined) props.fill = action.shape.fill
    }
    if (action.shape.text !== undefined) props.richText = toRichText(action.shape.text)
    if (Object.keys(props).length) partial.props = props
    editor.updateShape(partial); return
  }
  const ids = existingIds(editor, action.ids, action.type === "align" ? 2 : 3)
  if (action.type === "align") {
    const operation = action.axis === "y"
      ? action.alignment === "start" ? "top" : action.alignment === "end" ? "bottom" : "center-vertical"
      : action.alignment === "start" ? "left" : action.alignment === "end" ? "right" : "center-horizontal"
    editor.alignShapes(ids, operation); return
  }
  editor.distributeShapes(ids, action.axis === "y" ? "vertical" : "horizontal")
}

export async function flushPendingSaveOnClose(
  queue: { flush(): Promise<void> } | null,
  timer: number | null | undefined,
  releaseLease: () => void = () => {},
  renewLease?: () => Promise<void>,
  renewalIntervalMs = 1_000,
): Promise<void> {
  if (timer) window.clearTimeout(timer)
  let renewal: Promise<void> | null = null
  const renew = () => {
    if (!renewLease || renewal) return
    const running = renewLease().catch(() => {})
    renewal = running
    void running.finally(() => { if (renewal === running) renewal = null })
  }
  renew()
  const renewalTimer = renewLease ? window.setInterval(renew, renewalIntervalMs) : undefined
  try {
    await queue?.flush()
  } finally {
    if (renewalTimer !== undefined) window.clearInterval(renewalTimer)
    await renewal
    releaseLease()
  }
}

export async function refreshCanvasForLeaseGeneration(options: {
  editor: Editor
  previousGeneration: number | undefined
  nextGeneration: number
  settlePreviousGeneration?: () => Promise<void>
  reload: () => Promise<void>
  reconcileLoadedState?: () => void
}): Promise<boolean> {
  if (options.previousGeneration === options.nextGeneration) return false
  setCanvasOwnership(options.editor, false)
  try { await options.settlePreviousGeneration?.() } catch { /* the old fencing token may already be invalid */ }
  await options.reload()
  options.reconcileLoadedState?.()
  return true
}

function writeOutcome(error: unknown): false | true | "unknown" | undefined {
  if (!(error instanceof WorkspacePluginClientRequestError)) return undefined
  const body = error.body as { written?: unknown } | undefined
  if (body?.written === false || body?.written === true) return body.written
  if (body?.written === null || body?.written === "unknown") return "unknown"
  return undefined
}

function wasDefinitelyNotWritten(error: unknown): boolean { return writeOutcome(error) === false }

export async function postCanvasSnapshot(
  client: { postJson(path: string, body: unknown): Promise<unknown> },
  body: unknown,
): Promise<{ revision: Revision }> {
  try {
    return await client.postJson("/api/v1/plugins/tldraw-agent/commit", body) as { revision: Revision }
  } catch (cause) {
    if (wasDefinitelyNotWritten(cause)) throw cause
    return client.postJson("/api/v1/plugins/tldraw-agent/commit", body) as Promise<{ revision: Revision }>
  }
}

export function setCanvasOwnership(editor: Editor, owned: boolean): void {
  editor.updateInstanceState({ isReadonly: !owned }, { history: "ignore" })
}

export function createCanvasLeaseGuard(editor: Editor, onExpired?: () => void) {
  let timer: number | undefined
  let active = false
  const revoke = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    active = false
    setCanvasOwnership(editor, false)
  }
  return {
    grant(leaseMs: number) {
      if (timer !== undefined) window.clearTimeout(timer)
      active = true
      setCanvasOwnership(editor, true)
      timer = window.setTimeout(() => { revoke(); onExpired?.() }, leaseMs)
    },
    isActive: () => active,
    holdForClose() {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    },
    revoke,
  }
}

function restoreCanvasStoreSnapshot(
  editor: Editor,
  snapshot: ReturnType<Editor["store"]["getStoreSnapshot"]>,
): void {
  // Batch actions are remote changes and never enter the user's undo stack.
  // Restore the exact pre-batch records as another remote change; unlike
  // loadCanvasStoreSnapshot this intentionally preserves prior user history.
  editor.store.mergeRemoteChanges(() => { editor.loadSnapshot(snapshot) })
}

export async function applyCanvasBatch(options: {
  editor: Editor
  batch: PendingCanvasBatch
  commit: () => Promise<void>
  reload: () => Promise<void>
}): Promise<void> {
  const preBatchSnapshot = options.editor.store.getStoreSnapshot()
  const rollbackRemote = () => { restoreCanvasStoreSnapshot(options.editor, preBatchSnapshot) }
  try {
    try {
      options.editor.store.mergeRemoteChanges(() => {
        options.editor.run(() => { for (const action of options.batch.actions) applyCanvasAction(options.editor, action) })
      })
    } catch (error) {
      rollbackRemote()
      throw error
    }
    try {
      await options.commit()
    } catch (error) {
      if (wasDefinitelyNotWritten(error)) rollbackRemote()
      else {
        try { await options.reload() }
        catch { rollbackRemote() }
      }
      throw error
    }
  } finally {
    // Ownership is controlled by the lease lifecycle in the panel. This
    // helper never changes editor writability on its own.
  }
}

export function batchCommitRequestId(batchId: string, leaseGeneration: number): string {
  return `batch:${batchId}:lease:${leaseGeneration}`
}

export function TldrawAgentPanel({ params }: PaneProps<TldrawAgentParams>) {
  const client = useWorkspacePluginClient()
  const path = normalizeTldrawResourcePath(params.path ?? "canvas.tldraw")
  const filesystem = params.filesystem ?? "user"
  const editorRef = useRef<Editor | null>(null)
  const clientIdRef = useRef(createClientId())
  const revisionRef = useRef<Revision | undefined>(undefined)
  const leaseGenerationRef = useRef<number | undefined>(undefined)
  const loadedLeaseGenerationRef = useRef<number | undefined>(undefined)
  const leaseGuardRef = useRef<ReturnType<typeof createCanvasLeaseGuard> | undefined>(undefined)
  const saveQueueRef = useRef<ReturnType<typeof createSerializedSaveQueue> | null>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const completedBatchIdsRef = useRef(new Set<string>())
  const readinessRef = useRef(createCanvasReadinessGate())
  const [status, setStatus] = useState("Loading native tldraw file…")
  const [error, setError] = useState<string | null>(null)

  const loadFile = useCallback(async (editor: Editor, applySnapshot = true) => {
    const query = new URLSearchParams({ path, filesystem })
    const payload = await client.getJson<{ json: string; revision: Revision }>(`/api/v1/plugins/tldraw-agent/file?${query}`)
    const parsed = parseTldrawJsonFile({ json: payload.json, schema: editor.store.schema })
    if (!parsed.ok) throw new Error(`Invalid native tldraw file: ${parsed.error.type}`)
    if (applySnapshot) loadCanvasStoreSnapshot(editor, parsed.value.getStoreSnapshot())
    revisionRef.current = payload.revision
    setStatus("Live · user and agent share this editor"); setError(null)
  }, [client, filesystem, path])

  const commitSnapshot = useCallback(async (json: string, requestId: string, batchId?: string) => {
    if (!revisionRef.current) throw new Error("canvas revision is not loaded")
    if (!leaseGenerationRef.current) throw new Error("canvas owner lease is not active")
    const body = {
      requestId, batchId, path, filesystem, clientId: clientIdRef.current,
      leaseGeneration: leaseGenerationRef.current,
      json, expectedRevision: revisionRef.current,
    }
    const payload = await postCanvasSnapshot(client, body)
    revisionRef.current = payload.revision
    setStatus(batchId ? "Agent batch applied and saved" : "Saved"); setError(null)
  }, [client, filesystem, path])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    const connect = async (editor: Editor) => {
      readinessRef.current.reset()
      editor.updateInstanceState({ isReadonly: true }, { history: "ignore" })
      try {
        await loadFile(editor)
        if (!active) return
        saveQueueRef.current = createSerializedSaveQueue({
          snapshot: () => serializeTldrawJson(editor),
          commit: (json, generation) => commitSnapshot(json, `${clientIdRef.current}:manual:${generation}`),
        })
        unlisten = editor.store.listen(() => {
          const queue = saveQueueRef.current
          queue?.markDirty()
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = window.setTimeout(() => {
            void queue?.flush().catch(async (cause) => {
              const failedGeneration = queue.pendingGeneration()
              if (failedGeneration !== undefined) {
                try {
                  const discardedNewerEdits = await reconcileFailedSave(queue, failedGeneration, (applySnapshot) => loadFile(editor, applySnapshot))
                  if (discardedNewerEdits) setError("Save conflict: durable external changes were loaded; unsaved local edits were discarded.")
                  else setError(cause instanceof Error ? cause.message : "Save failed")
                } catch { setError(cause instanceof Error ? cause.message : "Save failed") }
              } else setError(cause instanceof Error ? cause.message : "Save failed")
            })
          }, 500)
        }, { scope: "document", source: "user" })
        readinessRef.current.markReady()
        // Loading alone does not grant edit authority. The ownership heartbeat
        // below is the sole transition out of read-only mode.
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Load failed") }
    }
    const wait = window.setInterval(() => {
      if (!editorRef.current) return
      window.clearInterval(wait); void connect(editorRef.current)
    }, 25)
    return () => {
      active = false; window.clearInterval(wait); unlisten?.()
      // Pane close is a persistence barrier. Stop the local expiry timer but
      // retain the generation and writability until the exact pending save has
      // settled; only then release editor ownership. React cannot await an
      // effect cleanup, so the ordering lives inside this async barrier.
      leaseGuardRef.current?.holdForClose()
      void flushPendingSaveOnClose(
        saveQueueRef.current,
        saveTimerRef.current,
        () => {
          leaseGuardRef.current?.revoke()
          leaseGenerationRef.current = undefined
        },
        async () => {
          const generation = leaseGenerationRef.current
          if (!generation) throw new Error("canvas owner lease is not active")
          const connection = await client.postJson<{ ok: boolean; leaseGeneration?: number; leaseMs?: number }>("/api/v1/plugins/tldraw-agent/connect", { path, filesystem, clientId: clientIdRef.current })
          if (!connection.ok || connection.leaseGeneration !== generation) throw new Error("canvas owner lease changed during close")
          leaseGuardRef.current?.grant(connection.leaseMs ?? 5_000)
        },
      ).catch(() => {})
    }
  }, [commitSnapshot, loadFile])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const drain = async () => {
      const editor = editorRef.current
      if (!editor || !readinessRef.current.isReady()) {
        if (active) timer = window.setTimeout(() => { void drain() }, 300)
        return
      }
      try {
        const connection = await client.postJson<{ ok: boolean; leaseGeneration?: number; leaseMs?: number }>("/api/v1/plugins/tldraw-agent/connect", { path, filesystem, clientId: clientIdRef.current })
        if (!active) return
        leaseGuardRef.current ??= createCanvasLeaseGuard(editor, () => {
          leaseGenerationRef.current = undefined
          setStatus("Read-only · canvas lease expired")
        })
        if (!connection.ok || !connection.leaseGeneration) {
          leaseGenerationRef.current = undefined
          leaseGuardRef.current.revoke()
          setStatus("Read-only · another tab owns this canvas")
          return
        }
        const leaseGeneration = connection.leaseGeneration
        await refreshCanvasForLeaseGeneration({
          editor,
          previousGeneration: loadedLeaseGenerationRef.current,
          nextGeneration: connection.leaseGeneration,
          settlePreviousGeneration: () => saveQueueRef.current?.flush() ?? Promise.resolve(),
          reload: () => loadFile(editor),
          reconcileLoadedState: () => saveQueueRef.current?.reconcileToLoadedState(),
        })
        if (!active) return
        loadedLeaseGenerationRef.current = connection.leaseGeneration
        const query = new URLSearchParams({ path, filesystem, clientId: clientIdRef.current, leaseGeneration: String(connection.leaseGeneration) })
        const payload = await client.getJson<{ batches?: PendingCanvasBatch[]; leaseValid?: boolean }>(`/api/v1/plugins/tldraw-agent/actions?${query}`)
        if (!payload.leaseValid) {
          leaseGenerationRef.current = undefined
          leaseGuardRef.current.revoke()
          setStatus("Read-only · canvas lease expired")
          return
        }
        leaseGenerationRef.current = connection.leaseGeneration
        leaseGuardRef.current.grant(connection.leaseMs ?? 5_000)
        setStatus("Live · user and agent share this editor")
        for (const batch of payload.batches ?? []) {
          if (!active) return
          if (completedBatchIdsRef.current.has(batch.id)) continue
          await saveQueueRef.current?.flush()
          try {
            // The lease may have expired while the preceding save drained.
            if (!leaseGuardRef.current?.isActive() || leaseGenerationRef.current !== connection.leaseGeneration) {
              setStatus("Read-only · canvas lease expired")
              return
            }
            // SDK mutations are synchronous and require writability. Relock
            // before serialization/commit crosses its first async boundary.
            setCanvasOwnership(editor, true)
            await applyCanvasBatch({
              editor,
              batch,
              commit: async () => {
                setCanvasOwnership(editor, false)
                return commitSnapshot(await serializeTldrawJson(editor), batchCommitRequestId(batch.id, leaseGeneration), batch.id)
              },
              reload: async () => loadFile(editor),
            })
            completedBatchIdsRef.current.add(batch.id)
            editor.zoomToFit({ animation: { duration: 180 } })
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Agent edit failed")
          } finally {
            setCanvasOwnership(editor, false)
            if (saveQueueRef.current?.hasDirty()) void saveQueueRef.current.flush().catch((cause) => setError(cause instanceof Error ? cause.message : "Save failed"))
          }
        }
      } catch (cause) {
        if (active) {
          leaseGenerationRef.current = undefined
          leaseGuardRef.current?.revoke()
          setError(cause instanceof Error ? cause.message : "Canvas connection failed")
        }
      } finally {
        if (active) timer = window.setTimeout(() => { void drain() }, 300)
      }
    }
    void drain()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
      // The load/save lifecycle cleanup owns the ordered flush-then-revoke
      // barrier. Revoking here would invalidate its final commit.
    }
  }, [client, commitSnapshot, filesystem, loadFile, path])

  return (
    <div className="relative h-full min-h-[420px] min-w-[560px] overflow-hidden bg-background text-foreground" data-testid="tldraw-agent-panel">
      <Tldraw onMount={(editor) => {
        editor.updateInstanceState({ isReadonly: true }, { history: "ignore" })
        editorRef.current = editor
      }} />
      <div className="pointer-events-none absolute left-3 top-3 z-[300] rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
        <div className="max-w-72 truncate text-xs font-medium">{path}</div>
        <div className={`mt-0.5 text-[11px] ${error ? "text-destructive" : "text-muted-foreground"}`} role="status">{error ?? status}</div>
      </div>
    </div>
  )
}
