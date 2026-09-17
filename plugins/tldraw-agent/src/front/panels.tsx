import { useCallback, useEffect, useRef, useState } from "react"
import type { PaneProps } from "@hachej/boring-workspace"
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
import type { CanvasAction, CanvasShapeInput, PendingCanvasBatch, TldrawAgentParams } from "../shared"

export const TLDRAW_AGENT_PANEL_ID = "tldraw-agent-panel"

function idFor(value: string): TLShapeId { return createShapeId(value) }

function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `tldraw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function shapePartial(shape: CanvasShapeInput & { props?: Record<string, unknown> }, index: number): TLShapePartial {
  const props = shape.props ?? {}
  const id = idFor((shape.id ?? `agent-${Date.now()}-${index}`).replace(/^shape:/, ""))
  const x = Number.isFinite(shape.x) ? Number(shape.x) : 100 + index * 240
  const y = Number.isFinite(shape.y) ? Number(shape.y) : 120
  const text = shape.text ?? (typeof props.text === "string" ? props.text : "")
  const color = shape.color ?? (typeof props.color === "string" ? props.color as CanvasShapeInput["color"] : "black")
  if (shape.type === "text") {
    return { id, type: "text", x, y, props: { richText: toRichText(text), color, w: shape.w ?? (Number(props.w) || 240), autoSize: false } }
  }
  return {
    id, type: "geo", x, y,
    props: {
      geo: shape.type === "ellipse" || shape.type === "diamond" || shape.type === "rectangle"
        ? shape.type
        : props.geo === "ellipse" || props.geo === "diamond" ? props.geo : "rectangle",
      w: shape.w ?? (Number(props.w) || 220), h: shape.h ?? (Number(props.h) || 96),
      richText: toRichText(text), color, fill: shape.fill ?? (props.fill === "none" ? "none" : "semi"),
    },
  }
}

function applyAction(editor: Editor, action: CanvasAction) {
  if (action.type === "clear") return editor.deleteShapes([...editor.getCurrentPageShapeIds()])
  if (action.type === "delete") return editor.deleteShapes((action.ids ?? []).map(idFor))
  if (action.type === "create") return editor.createShapes((action.shapes ?? (action.shape ? [action.shape] : [])).map(shapePartial))
  if (action.type === "update") {
    for (const [index, shape] of (action.shapes ?? (action.shape ? [action.shape] : [])).entries()) {
      if (!shape.id || !editor.getShape(idFor(shape.id))) continue
      const partial = shapePartial(shape, index)
      editor.updateShape(partial)
    }
    return editor
  }
  const ids = (action.ids ?? []).map(idFor).filter((id) => editor.getShape(id))
  if (action.type === "align" && ids.length > 1) {
    const operation = action.axis === "y"
      ? action.alignment === "start" ? "top" : action.alignment === "end" ? "bottom" : "center-vertical"
      : action.alignment === "start" ? "left" : action.alignment === "end" ? "right" : "center-horizontal"
    return editor.alignShapes(ids, operation)
  }
  if (action.type === "distribute" && ids.length > 2) return editor.distributeShapes(ids, action.axis === "y" ? "vertical" : "horizontal")
  return editor
}

export function TldrawAgentPanel({ params }: PaneProps<TldrawAgentParams>) {
  const path = params.path ?? "canvas.tldraw"
  const editorRef = useRef<Editor | null>(null)
  const clientIdRef = useRef(createClientId())
  const mtimeRef = useRef<number | undefined>(undefined)
  const suppressSaveRef = useRef(false)
  const processingRef = useRef(new Set<string>())
  const saveTimerRef = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState("Loading native tldraw file…")
  const [error, setError] = useState<string | null>(null)

  const commit = useCallback(async (editor: Editor, id?: string) => {
    const json = await serializeTldrawJson(editor)
    const response = await fetch("/api/v1/plugins/tldraw-agent/commit", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, path, json, expectedMtimeMs: mtimeRef.current }),
    })
    const payload = await response.json() as { mtimeMs?: number; error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? `Save failed (${response.status})`)
    mtimeRef.current = payload.mtimeMs
    setStatus(id ? "Agent batch applied and saved" : "Saved")
    setError(null)
  }, [path])

  const loadFile = useCallback(async (editor: Editor) => {
    const response = await fetch(`/api/v1/plugins/tldraw-agent/file?path=${encodeURIComponent(path)}`)
    const payload = await response.json() as { json?: string; mtimeMs?: number; error?: { message?: string } }
    if (!response.ok || !payload.json) throw new Error(payload.error?.message ?? `Load failed (${response.status})`)
    const parsed = parseTldrawJsonFile({ json: payload.json, schema: editor.store.schema })
    if (!parsed.ok) throw new Error(`Invalid native tldraw file: ${parsed.error.type}`)
    const snapshot = parsed.value.getStoreSnapshot()
    suppressSaveRef.current = true
    // A newly-created native file has a valid schema but no records. Keep the
    // editor's initialized document/page records in that case so SDK actions
    // have a live current page to target.
    if (Object.keys(snapshot.store).length > 0) editor.store.loadStoreSnapshot(snapshot)
    suppressSaveRef.current = false
    mtimeRef.current = payload.mtimeMs
    setStatus("Live · user and agent share this editor")
    setError(null)
  }, [path])

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
      window.clearInterval(wait)
      void connect(editorRef.current)
    }, 25)
    return () => { active = false; window.clearInterval(wait); unlisten?.(); if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [commit, loadFile])

  useEffect(() => {
    let active = true
    const poll = async () => {
      const editor = editorRef.current
      if (!editor) return
      try {
        await fetch("/api/v1/plugins/tldraw-agent/connect", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, clientId: clientIdRef.current }),
        })
        const response = await fetch(`/api/v1/plugins/tldraw-agent/actions?path=${encodeURIComponent(path)}&clientId=${encodeURIComponent(clientIdRef.current)}`)
        const payload = await response.json() as { batches?: PendingCanvasBatch[] }
        for (const batch of payload.batches ?? []) {
          if (!active || processingRef.current.has(batch.id)) continue
          processingRef.current.add(batch.id)
          suppressSaveRef.current = true
          try {
            editor.run(() => { for (const action of batch.actions) applyAction(editor, action) })
            await commit(editor, batch.id)
            editor.zoomToFit({ animation: { duration: 180 } })
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent edit failed") }
          finally { suppressSaveRef.current = false; processingRef.current.delete(batch.id) }
        }
      } catch { /* transient polling failure is surfaced by load/save paths */ }
    }
    void poll()
    const interval = window.setInterval(poll, 300)
    return () => { active = false; window.clearInterval(interval) }
  }, [commit, path])

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
