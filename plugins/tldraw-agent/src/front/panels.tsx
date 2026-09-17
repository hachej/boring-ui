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
import type { CanvasAction, CanvasCreateShape, PendingCanvasBatch, TldrawAgentParams } from "../shared"

export const TLDRAW_AGENT_PANEL_ID = "tldraw-agent-panel"
type Revision = { size: number; mtimeMs: number }

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
  if (ids.length < minimum) throw new Error(`action requires at least ${minimum} shape ids`)
  const missing = ids.filter((id) => !editor.getShape(id))
  if (missing.length) throw new Error(`missing shapes: ${missing.join(", ")}`)
  return ids
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
    const partial: TLShapePartial = { id, type: existing.type }
    if (action.shape.x !== undefined) partial.x = action.shape.x
    if (action.shape.y !== undefined) partial.y = action.shape.y
    const props: Record<string, unknown> = {}
    for (const key of ["w", "h", "color", "fill"] as const) if (action.shape[key] !== undefined) props[key] = action.shape[key]
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

function wasDefinitelyNotWritten(error: unknown): boolean {
  if (!(error instanceof WorkspacePluginClientRequestError)) return false
  const body = error.body as { written?: unknown } | undefined
  return body?.written === false
}

export async function applyCanvasBatch(options: {
  editor: Editor
  batch: PendingCanvasBatch
  commit: () => Promise<void>
  reload: () => Promise<void>
}): Promise<void> {
  const before = options.editor.store.getStoreSnapshot()
  try {
    options.editor.run(() => { for (const action of options.batch.actions) applyCanvasAction(options.editor, action) })
    await options.commit()
  } catch (error) {
    if (wasDefinitelyNotWritten(error)) options.editor.store.loadStoreSnapshot(before)
    else await options.reload()
    throw error
  }
}

export function TldrawAgentPanel({ params }: PaneProps<TldrawAgentParams>) {
  const client = useWorkspacePluginClient()
  const path = params.path ?? "canvas.tldraw"
  const filesystem = params.filesystem ?? "user"
  const editorRef = useRef<Editor | null>(null)
  const clientIdRef = useRef(createClientId())
  const revisionRef = useRef<Revision | undefined>(undefined)
  const suppressSaveRef = useRef(false)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const completedBatchIdsRef = useRef(new Set<string>())
  const [status, setStatus] = useState("Loading native tldraw file…")
  const [error, setError] = useState<string | null>(null)

  const loadFile = useCallback(async (editor: Editor) => {
    const query = new URLSearchParams({ path, filesystem })
    const payload = await client.getJson<{ json: string; revision: Revision }>(`/api/v1/plugins/tldraw-agent/file?${query}`)
    const parsed = parseTldrawJsonFile({ json: payload.json, schema: editor.store.schema })
    if (!parsed.ok) throw new Error(`Invalid native tldraw file: ${parsed.error.type}`)
    const snapshot = parsed.value.getStoreSnapshot()
    suppressSaveRef.current = true
    if (Object.keys(snapshot.store).length > 0) editor.store.loadStoreSnapshot(snapshot)
    suppressSaveRef.current = false
    revisionRef.current = payload.revision
    setStatus("Live · user and agent share this editor"); setError(null)
  }, [client, filesystem, path])

  const commit = useCallback(async (editor: Editor, id?: string) => {
    if (!revisionRef.current) throw new Error("canvas revision is not loaded")
    const body = {
      id, path, filesystem, clientId: clientIdRef.current,
      json: await serializeTldrawJson(editor), expectedRevision: revisionRef.current,
    }
    let payload: { revision: Revision }
    try {
      payload = await client.postJson<{ revision: Revision }>("/api/v1/plugins/tldraw-agent/commit", body)
    } catch (cause) {
      if (wasDefinitelyNotWritten(cause)) throw cause
      payload = await client.postJson<{ revision: Revision }>("/api/v1/plugins/tldraw-agent/commit", body)
    }
    revisionRef.current = payload.revision
    setStatus(id ? "Agent batch applied and saved" : "Saved"); setError(null)
  }, [client, filesystem, path])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    const connect = async (editor: Editor) => {
      try {
        await loadFile(editor)
        if (!active) return
        unlisten = editor.store.listen(() => {
          if (suppressSaveRef.current) return
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = window.setTimeout(() => { void commit(editor).catch((cause) => setError(cause instanceof Error ? cause.message : "Save failed")) }, 500)
        }, { scope: "document", source: "user" })
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Load failed") }
    }
    const wait = window.setInterval(() => {
      if (!editorRef.current) return
      window.clearInterval(wait); void connect(editorRef.current)
    }, 25)
    return () => { active = false; window.clearInterval(wait); unlisten?.(); if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [commit, loadFile])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const drain = async () => {
      const editor = editorRef.current
      if (!editor) return
      try {
        await client.postJson("/api/v1/plugins/tldraw-agent/connect", { path, filesystem, clientId: clientIdRef.current })
        const query = new URLSearchParams({ path, filesystem, clientId: clientIdRef.current })
        const payload = await client.getJson<{ batches?: PendingCanvasBatch[] }>(`/api/v1/plugins/tldraw-agent/actions?${query}`)
        for (const batch of payload.batches ?? []) {
          if (!active) return
          if (completedBatchIdsRef.current.has(batch.id)) continue
          suppressSaveRef.current = true
          try {
            await applyCanvasBatch({
              editor,
              batch,
              commit: async () => commit(editor, batch.id),
              reload: async () => loadFile(editor),
            })
            completedBatchIdsRef.current.add(batch.id)
            editor.zoomToFit({ animation: { duration: 180 } })
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Agent edit failed")
          } finally { suppressSaveRef.current = false }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Canvas connection failed")
      } finally {
        if (active) timer = window.setTimeout(() => { void drain() }, 300)
      }
    }
    void drain()
    return () => { active = false; if (timer) window.clearTimeout(timer) }
  }, [client, commit, filesystem, loadFile, path])

  return (
    <div className="relative h-full min-h-[420px] min-w-[560px] overflow-hidden bg-background text-foreground" data-testid="tldraw-agent-panel">
      <Tldraw onMount={(editor) => { editorRef.current = editor }} />
      <div className="pointer-events-none absolute left-3 top-3 z-[300] rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
        <div className="max-w-72 truncate text-xs font-medium">{path}</div>
        <div className={`mt-0.5 text-[11px] ${error ? "text-destructive" : "text-muted-foreground"}`} role="status">{error ?? status}</div>
      </div>
    </div>
  )
}
