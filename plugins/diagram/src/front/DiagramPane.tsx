import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Excalidraw, exportToBlob, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import { ModelSelect, type AvailableModel, type ModelSelection } from "@hachej/boring-agent/front"
import { Toolbar, ToolbarGroup } from "@hachej/boring-ui-kit"
import { renderTargetFor, saveTargetFor, titleForPath } from "../shared"

type ExcalidrawElements = Parameters<typeof serializeAsJSON>[0]
type ExcalidrawAppState = Parameters<typeof serializeAsJSON>[1]
type ExcalidrawFiles = Parameters<typeof serializeAsJSON>[2]

type ExcalidrawAPI = {
  updateScene: (scene: { elements?: ExcalidrawElements; appState?: ExcalidrawAppState }) => void
  addFiles: (files: ExcalidrawFiles[keyof ExcalidrawFiles][]) => void
  resetScene: () => void
  getSceneElements: () => ExcalidrawElements
  getAppState: () => ExcalidrawAppState
  getFiles: () => ExcalidrawFiles
  history: { clear: () => void }
}

interface DiagramPaneParams {
  path?: string
  filesystem?: string
  mode?: string
}

interface SaveRequest {
  token: number
  target: string
  json: string
}

interface LoadedScene {
  elements: ExcalidrawElements
  appState: ExcalidrawAppState
  files: ExcalidrawFiles
}

type FileAccess = "readonly" | "readwrite"
type ViewMode = "diagram" | "image"

type RenderModelsResponse = {
  models?: AvailableModel[]
  defaultModel?: ModelSelection
  authConfigured?: boolean
  authHint?: string
}

type RenderResponse = {
  ok?: boolean
  path?: string
  model?: string
  error?: string | { code?: string; message?: string }
}

type PromptCatalogItem = {
  id: string
  label: string
  prompt: string
  updatedAt: string
}

type RenderMetadata = {
  schemaVersion?: number
  kind?: string
  sourcePath?: string
  outputPath?: string
  prompt?: { text?: string }
  model?: { provider?: string; id?: string }
  generatedAt?: string
  response?: { id?: string; mimeType?: string; usage?: unknown }
}

type FsChangeEvent = {
  change?: {
    op?: "write" | "unlink" | "rename" | "mkdir"
    path?: string
    oldPath?: string
    mtimeMs?: number
  }
}

class WorkspaceFileReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\/+/, "")
}

function workspacePathsEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right)
}

function SaveIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
    </svg>
  )
}

const DEFAULT_RENDER_PROMPT = "Make this sketch into a polished diagram illustration."
const PROMPT_CATALOG_STORAGE_KEY = "boring-diagram:render-prompts:v1"
const MAX_PROMPT_CATALOG_ITEMS = 20

function readPromptCatalog(): PromptCatalogItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(PROMPT_CATALOG_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): PromptCatalogItem[] => {
      if (!item || typeof item.prompt !== "string" || !item.prompt.trim()) return []
      return [{
        id: typeof item.id === "string" && item.id ? item.id : newPromptCatalogId(),
        label: typeof item.label === "string" && item.label ? item.label : promptCatalogLabel(item.prompt),
        prompt: item.prompt,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      }]
    }).slice(0, MAX_PROMPT_CATALOG_ITEMS)
  } catch {
    return []
  }
}

function writePromptCatalog(items: PromptCatalogItem[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PROMPT_CATALOG_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_PROMPT_CATALOG_ITEMS)))
  } catch {
    // Prompt catalog persistence is best-effort and must never make a completed render look failed.
  }
}

function promptCatalogLabel(prompt: string): string {
  const oneLine = prompt.trim().replace(/\s+/g, " ")
  return oneLine.length > 48 ? `${oneLine.slice(0, 45)}…` : oneLine || "Untitled prompt"
}

function upsertPromptCatalogItem(items: PromptCatalogItem[], prompt: string): PromptCatalogItem[] {
  const trimmed = prompt.trim()
  if (!trimmed) return items
  const now = new Date().toISOString()
  const existing = items.find((item) => item.prompt.trim() === trimmed)
  const nextItem: PromptCatalogItem = existing
    ? { ...existing, label: promptCatalogLabel(trimmed), updatedAt: now }
    : { id: newPromptCatalogId(), label: promptCatalogLabel(trimmed), prompt: trimmed, updatedAt: now }
  return [nextItem, ...items.filter((item) => item.id !== nextItem.id && item.prompt.trim() !== trimmed)].slice(0, MAX_PROMPT_CATALOG_ITEMS)
}

function newPromptCatalogId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image blob"))
    reader.readAsDataURL(blob)
  })
  return dataUrl.replace(/^data:[^;]+;base64,/, "")
}

function renderModelKey(model: Pick<ModelSelection, "provider" | "id">): string {
  return `${model.provider}:${model.id}`
}

function sceneToJson(path: string, elements: ExcalidrawElements, appState: ExcalidrawAppState, files: ExcalidrawFiles): string {
  return serializeAsJSON(
    elements,
    { ...appState, name: titleForPath(path) },
    files,
    "local",
  )
}

async function loadSceneFromText(text: string): Promise<LoadedScene> {
  if (!text.trim()) return { elements: [], appState: {}, files: {} }
  const parsed = JSON.parse(text) as Partial<LoadedScene>
  return {
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState && typeof parsed.appState === "object" ? parsed.appState : {},
    files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
  }
}

function metadataPathForRender(outputPath: string): string {
  return outputPath.replace(/\.png$/i, ".json")
}

async function loadSceneFromBytes(bytes: Uint8Array, mimeType: string): Promise<LoadedScene> {
  if (bytes.byteLength === 0) return { elements: [], appState: {}, files: {} }
  const scene = await loadFromBlob(new Blob([bytesToArrayBuffer(bytes)], { type: mimeType }), null, null)
  return {
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  }
}

export function DiagramPane({ params }: PaneProps<DiagramPaneParams>) {
  const path = params?.path ?? ""
  const rawFilesystem = typeof params?.filesystem === "string" && params.filesystem ? params.filesystem : undefined
  const filesystem = rawFilesystem && rawFilesystem !== "user" ? rawFilesystem : undefined
  const viewOnly = params?.mode === "view"
  const title = useMemo(() => titleForPath(path), [path])
  const saveTarget = useMemo(() => saveTargetFor(path), [path])
  const renderTarget = useMemo(() => renderTargetFor(path), [path])
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const excalidrawApiRef = useRef<ExcalidrawAPI | null>(null)
  const tokenRef = useRef(0)
  const loadedRef = useRef(false)
  const savingRef = useRef(false)
  const readOnlyRef = useRef(false)
  const queuedSaveRef = useRef<SaveRequest | null>(null)
  const lastJsonRef = useRef("")
  const latestSceneRef = useRef<LoadedScene | null>(null)
  const pendingAutosaveRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const suppressAutosaveUntilRef = useRef(0)
  const targetMtimeRef = useRef<Record<string, number | undefined>>({})
  const observedMissingTargetsRef = useRef<Set<string>>(new Set())
  const saveWorkspaceFileRef = useRef<(request: SaveRequest) => Promise<void>>(async () => {})
  const flushPendingSaveRef = useRef<() => Promise<void>>(async () => {})
  const saveIdleResolversRef = useRef<Array<() => void>>([])
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [editorReady, setEditorReady] = useState(false)
  const [status, setStatus] = useState("Loading editor…")
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("diagram")
  const [renderDrawerOpen, setRenderDrawerOpen] = useState(false)
  const [renderPrompt, setRenderPrompt] = useState(DEFAULT_RENDER_PROMPT)
  const [promptCatalog, setPromptCatalog] = useState<PromptCatalogItem[]>(() => readPromptCatalog())
  const [renderModels, setRenderModels] = useState<AvailableModel[]>([])
  const [selectedRenderModel, setSelectedRenderModel] = useState<ModelSelection | null>(null)
  const [renderAuthHint, setRenderAuthHint] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null)
  const [renderVersion, setRenderVersion] = useState(0)
  const [renderStale, setRenderStale] = useState(false)
  const [renderMetadata, setRenderMetadata] = useState<RenderMetadata | null>(null)
  const [renderMetadataError, setRenderMetadataError] = useState<string | null>(null)
  const [renderMetadataOpen, setRenderMetadataOpen] = useState(false)

  const loadKey = useMemo(() => [path, filesystem ?? "user", viewOnly ? "view" : "edit", String(refreshNonce)].join("\0"), [filesystem, path, refreshNonce, viewOnly])
  const freshEditorForLoadKeyRef = useRef<string | null>(null)

  const requestHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {}
    if (workspaceId) headers["x-boring-workspace-id"] = String(workspaceId)
    return headers
  }, [workspaceId])

  useEffect(() => {
    setViewMode("diagram")
    setRenderOutputPath(null)
    setRenderVersion(0)
    setRenderStale(false)
    setRenderMetadata(null)
    setRenderMetadataError(null)
    setRenderMetadataOpen(false)
  }, [loadKey])

  const fileQuery = useCallback((target: string): string => {
    const query = new URLSearchParams({ path: target })
    if (filesystem) query.set("filesystem", filesystem)
    return query.toString()
  }, [filesystem])

  const readTextFile = useCallback(async (target: string): Promise<{ content: string; mtimeMs?: number; access?: FileAccess }> => {
    const response = await fetch(`${apiBaseUrl}/api/v1/files?${fileQuery(target)}`, {
      credentials: "include",
      headers: requestHeaders,
    })
    if (!response.ok) throw new WorkspaceFileReadError(`Failed to load ${target}: ${response.status}`, response.status)
    const result = await response.json()
    return {
      content: typeof result.content === "string" ? result.content : "",
      mtimeMs: typeof result.mtimeMs === "number" ? result.mtimeMs : undefined,
      access: result.access === "readonly" || result.access === "readwrite" ? result.access : undefined,
    }
  }, [apiBaseUrl, fileQuery, requestHeaders])

  useEffect(() => {
    if (!renderTarget) return
    let cancelled = false
    void fetch(`${apiBaseUrl}/api/v1/files/raw?${fileQuery(renderTarget)}`, {
      credentials: "include",
      headers: requestHeaders,
    }).then((response) => {
      if (cancelled || !response.ok) return
      setRenderOutputPath(renderTarget)
      setRenderVersion(Date.now())
      setRenderStale(false)
    }).catch(() => {
      // Existing render discovery is best-effort; a missing image should keep the Image tab empty.
    })
    return () => { cancelled = true }
  }, [apiBaseUrl, fileQuery, renderTarget, requestHeaders])

  const rememberTargetMtimeIfPresent = useCallback(async (target: string) => {
    try {
      const result = await readTextFile(target)
      targetMtimeRef.current[target] = result.mtimeMs
    } catch (err) {
      targetMtimeRef.current[target] = undefined
      if (err instanceof WorkspaceFileReadError && err.status === 404) observedMissingTargetsRef.current.add(target)
    }
  }, [readTextFile])

  const applyScene = useCallback((scene: LoadedScene, target: string) => {
    const api = excalidrawApiRef.current
    if (!api) return
    suppressAutosaveUntilRef.current = Date.now() + 1000
    api.resetScene()
    api.updateScene({ elements: scene.elements, appState: scene.appState })
    const files = Object.values(scene.files)
    if (files.length > 0) api.addFiles(files)
    api.history.clear()
    latestSceneRef.current = scene
    lastJsonRef.current = sceneToJson(target, scene.elements, scene.appState, scene.files)
  }, [])

  const loadWorkspaceFile = useCallback(async () => {
    if (!editorReady) return
    const api = excalidrawApiRef.current
    if (!api) return
    await flushPendingSaveRef.current()
    if (freshEditorForLoadKeyRef.current === null) {
      freshEditorForLoadKeyRef.current = loadKey
    } else if (freshEditorForLoadKeyRef.current !== loadKey) {
      freshEditorForLoadKeyRef.current = loadKey
      excalidrawApiRef.current = null
      setEditorReady(false)
      setEditorEpoch((value) => value + 1)
      return
    }
    const token = ++tokenRef.current
    loadedRef.current = false
    readOnlyRef.current = false
    queuedSaveRef.current = null
    lastJsonRef.current = ""
    latestSceneRef.current = null
    pendingAutosaveRef.current = false
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    targetMtimeRef.current = {}
    observedMissingTargetsRef.current = new Set()
    setReadOnly(false)
    setError(null)

    try {
      if (!path) {
        const existing = await readTextFile(saveTarget).catch((err: unknown) => {
          if (err instanceof WorkspaceFileReadError && err.status === 404) {
            observedMissingTargetsRef.current.add(saveTarget)
            return null
          }
          throw err
        })
        if (token !== tokenRef.current) return
        if (existing) {
          const scene = await loadSceneFromText(existing.content)
          targetMtimeRef.current[saveTarget] = existing.mtimeMs
          applyScene(scene, saveTarget)
          const isReadonly = viewOnly || existing.access === "readonly"
          readOnlyRef.current = isReadonly
          setReadOnly(isReadonly)
          loadedRef.current = true
          setStatus(isReadonly ? `Loaded ${saveTarget} read-only` : `Loaded ${saveTarget}`)
          return
        }
        api.resetScene()
        api.history.clear()
        latestSceneRef.current = { elements: [], appState: {}, files: {} }
        lastJsonRef.current = sceneToJson(saveTarget, [], {}, {})
        readOnlyRef.current = viewOnly
        setReadOnly(viewOnly)
        loadedRef.current = true
        setStatus(viewOnly ? "New drawing — read-only" : `New drawing — saves to ${saveTarget}`)
        return
      }

      setStatus(`Loading ${title}…`)
      let scene: LoadedScene
      let createInitialSidecar = false
      let loadedAccess: FileAccess | undefined
      if (path.toLowerCase().endsWith(".excalidraw")) {
        const result = await readTextFile(path)
        if (token !== tokenRef.current) return
        targetMtimeRef.current[saveTarget] = result.mtimeMs
        loadedAccess = result.access
        scene = await loadSceneFromText(result.content)
      } else {
        const sidecar = await readTextFile(saveTarget).catch((err: unknown) => {
          if (err instanceof WorkspaceFileReadError && err.status === 404) {
            observedMissingTargetsRef.current.add(saveTarget)
            return null
          }
          throw err
        })
        if (token !== tokenRef.current) return
        if (sidecar) {
          targetMtimeRef.current[saveTarget] = sidecar.mtimeMs
          loadedAccess = sidecar.access
          try {
            scene = await loadSceneFromText(sidecar.content)
            setStatus(`Loaded ${saveTarget} sidecar for ${path}`)
          } catch (sidecarErr) {
            if (filesystem) throw sidecarErr
            const response = await fetch(`${apiBaseUrl}/api/v1/files/raw?${fileQuery(path)}`, {
              credentials: "include",
              headers: requestHeaders,
            })
            if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`)
            const buffer = await response.arrayBuffer()
            if (token !== tokenRef.current) return
            loadedAccess = "readonly"
            scene = await loadSceneFromBytes(new Uint8Array(buffer), response.headers.get("content-type") ?? "image/png")
            setStatus(`Loaded embedded PNG from ${path}; ${saveTarget} sidecar is invalid and was not overwritten`)
          }
        } else {
          if (filesystem) {
            const source = await readTextFile(path).catch(() => null)
            loadedAccess = source?.access
            throw new Error(`Opening ${path} from filesystem ${filesystem} requires an existing ${saveTarget} sidecar; binary PNG import is only supported for workspace files.`)
          }
          const response = await fetch(`${apiBaseUrl}/api/v1/files/raw?${fileQuery(path)}`, {
            credentials: "include",
            headers: requestHeaders,
          })
          if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`)
          const buffer = await response.arrayBuffer()
          if (token !== tokenRef.current) return
          await rememberTargetMtimeIfPresent(saveTarget)
          createInitialSidecar = true
          scene = await loadSceneFromBytes(new Uint8Array(buffer), response.headers.get("content-type") ?? "image/png")
        }
      }

      if (token !== tokenRef.current) return
      applyScene(scene, saveTarget)
      const isReadonly = viewOnly || loadedAccess === "readonly"
      readOnlyRef.current = isReadonly
      setReadOnly(isReadonly)
      loadedRef.current = true
      if (createInitialSidecar && !isReadonly) {
        await saveWorkspaceFileRef.current({ token, target: saveTarget, json: lastJsonRef.current })
      }
      setStatus(isReadonly
        ? `Loaded ${path} read-only`
        : path === saveTarget ? `Loaded ${path}` : `Loaded ${path} — edits save to ${saveTarget}`)
    } catch (err) {
      if (token !== tokenRef.current) return
      loadedRef.current = false
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus("Load failed — saving disabled")
    }
  }, [apiBaseUrl, applyScene, editorReady, fileQuery, loadKey, path, readTextFile, rememberTargetMtimeIfPresent, requestHeaders, saveTarget, title, viewOnly])

  const saveWorkspaceFile = useCallback(async (request: SaveRequest) => {
    if (request.token !== tokenRef.current || !loadedRef.current || readOnlyRef.current) return
    if (savingRef.current) {
      queuedSaveRef.current = request
      setStatus(`Save queued for ${request.target}…`)
      await new Promise<void>((resolve) => saveIdleResolversRef.current.push(resolve))
      return
    }

    savingRef.current = true
    setStatus(`Saving ${request.target}…`)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        path: request.target,
        content: request.json,
        createDirs: true,
      }
      if (filesystem) body.filesystem = filesystem
      const expectedMtimeMs = targetMtimeRef.current[request.target]
      if (typeof expectedMtimeMs === "number") body.expectedMtimeMs = expectedMtimeMs
      if (typeof expectedMtimeMs !== "number" && observedMissingTargetsRef.current.has(request.target)) {
        await readTextFile(request.target).then(
          () => { throw new Error(`${request.target} now exists. Reload before saving again.`) },
          (err: unknown) => {
            if (err instanceof WorkspaceFileReadError && err.status === 404) return
            throw err
          },
        )
      }

      const response = await fetch(`${apiBaseUrl}/api/v1/files`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...requestHeaders },
        body: JSON.stringify(body),
      })
      if (response.status === 409) throw new Error("Save conflict: file changed on disk. Reload before saving again.")
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to save ${request.target}: ${response.status}${text ? ` ${text}` : ""}`)
      }
      const result = await response.json().catch(() => null)
      if (request.token !== tokenRef.current) return
      targetMtimeRef.current[request.target] = typeof result?.mtimeMs === "number" ? result.mtimeMs : undefined
      observedMissingTargetsRef.current.delete(request.target)
      setStatus(`Saved ${request.target}`)
    } catch (err) {
      if (request.token !== tokenRef.current) return
      loadedRef.current = false
      queuedSaveRef.current = null
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus("Save disabled — reload required")
    } finally {
      savingRef.current = false
      const queued = queuedSaveRef.current
      queuedSaveRef.current = null
      if (queued && queued.token === tokenRef.current && loadedRef.current) {
        await saveWorkspaceFile(queued)
      }
      if (!savingRef.current && !queuedSaveRef.current) {
        const resolvers = saveIdleResolversRef.current.splice(0)
        for (const resolve of resolvers) resolve()
      }
    }
  }, [apiBaseUrl, filesystem, requestHeaders])
  saveWorkspaceFileRef.current = saveWorkspaceFile

  const requestSave = useCallback(() => {
    const api = excalidrawApiRef.current
    if (readOnlyRef.current) {
      setStatus("Read-only — saving disabled")
      return
    }
    if (!api || !loadedRef.current) {
      setError("Refusing to save before the workspace file has loaded successfully")
      setStatus("Save unavailable")
      return
    }
    const scene = { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() }
    latestSceneRef.current = scene
    const json = sceneToJson(saveTarget, scene.elements, scene.appState, scene.files)
    lastJsonRef.current = json
    pendingAutosaveRef.current = false
    void saveWorkspaceFile({ token: tokenRef.current, target: saveTarget, json })
  }, [saveTarget, saveWorkspaceFile])

  const loadRenderModels = useCallback(async () => {
    const response = await fetch(`${apiBaseUrl}/api/v1/plugins/diagram/render/models`, {
      credentials: "include",
      headers: requestHeaders,
    })
    if (!response.ok) throw new Error(`Failed to load render models: ${response.status}`)
    const result = await response.json() as RenderModelsResponse
    const models = Array.isArray(result.models) ? result.models : []
    setRenderModels(models)
    setRenderAuthHint(result.authHint ?? null)
    const firstAvailable = models.find((model) => model.available)
    const defaultModel = result.defaultModel
    const preferred = defaultModel && models.some((model) => renderModelKey(model) === renderModelKey(defaultModel))
      ? defaultModel
      : firstAvailable ? { provider: firstAvailable.provider, id: firstAvailable.id } : null
    setSelectedRenderModel((current) => current && models.some((model) => renderModelKey(model) === renderModelKey(current)) ? current : preferred)
  }, [apiBaseUrl, requestHeaders])

  const saveCurrentPromptToCatalog = useCallback(() => {
    const nextCatalog = upsertPromptCatalogItem(promptCatalog, renderPrompt)
    setPromptCatalog(nextCatalog)
    writePromptCatalog(nextCatalog)
  }, [promptCatalog, renderPrompt])

  const requestRender = useCallback(async () => {
    const api = excalidrawApiRef.current
    if (!api || !loadedRef.current) {
      setError("Refusing to render before the workspace file has loaded successfully")
      setStatus("Render unavailable")
      return
    }
    if (filesystem) {
      setError("Render is only supported for default workspace files right now")
      setStatus("Render unavailable")
      return
    }
    const prompt = renderPrompt.trim()
    if (!prompt) {
      setError("Enter a render prompt")
      setStatus("Render prompt required")
      return
    }
    setRendering(true)
    setError(null)
    setStatus("Rendering image…")
    try {
      await flushPendingSaveRef.current()
      if (!loadedRef.current) throw new Error("Save failed before render. Reload or resolve the save conflict before rendering.")
      const scene = { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() }
      latestSceneRef.current = scene
      const exportAppState = { ...scene.appState, exportWithDarkMode: false, viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff" }
      const blob = await exportToBlob({
        elements: scene.elements.filter((element) => !(element as { isDeleted?: boolean }).isDeleted) as never,
        appState: exportAppState,
        files: scene.files,
        mimeType: "image/png",
        exportPadding: 32,
      })
      const sketchPngBase64 = await blobToBase64(blob)
      const response = await fetch(`${apiBaseUrl}/api/v1/plugins/diagram/render`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...requestHeaders },
        body: JSON.stringify({
          path,
          prompt,
          model: selectedRenderModel ? renderModelKey(selectedRenderModel) : undefined,
          sketchPngBase64,
          mimeType: "image/png",
        }),
      })
      const result = await response.json().catch(() => ({})) as RenderResponse
      const responseError = typeof result.error === "string" ? result.error : result.error?.message
      if (!response.ok || !result.path) throw new Error(responseError || `Render failed: ${response.status}`)
      setRenderOutputPath(result.path)
      setRenderVersion(Date.now())
      setRenderStale(false)
      setViewMode("image")
      const nextCatalog = upsertPromptCatalogItem(promptCatalog, prompt)
      setPromptCatalog(nextCatalog)
      writePromptCatalog(nextCatalog)
      setStatus(`Rendered ${result.path}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus("Render failed")
    } finally {
      setRendering(false)
    }
  }, [apiBaseUrl, filesystem, path, promptCatalog, renderPrompt, requestHeaders, selectedRenderModel])

  const scheduleSave = useCallback((elements: ExcalidrawElements, appState: ExcalidrawAppState, files: ExcalidrawFiles) => {
    if (Date.now() < suppressAutosaveUntilRef.current) return
    latestSceneRef.current = { elements, appState, files }
    if (readOnlyRef.current || !loadedRef.current) return
    let json: string
    try {
      json = sceneToJson(saveTarget, elements, appState, files)
    } catch (err) {
      loadedRef.current = false
      setError(err instanceof Error ? err.message : String(err))
      setStatus("Editor error — saving disabled")
      return
    }
    if (json === lastJsonRef.current) return
    if (renderOutputPath) setRenderStale(true)
    pendingAutosaveRef.current = true
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (!loadedRef.current) return
      pendingAutosaveRef.current = false
      lastJsonRef.current = json
      void saveWorkspaceFile({ token: tokenRef.current, target: saveTarget, json })
    }, 900)
  }, [renderOutputPath, saveTarget, saveWorkspaceFile])

  useEffect(() => {
    void loadWorkspaceFile()
  }, [loadWorkspaceFile, refreshNonce])

  useEffect(() => {
    if (!renderDrawerOpen) return
    void loadRenderModels().catch((err: unknown) => {
      setRenderModels([])
      setRenderAuthHint(err instanceof Error ? err.message : String(err))
    })
  }, [loadRenderModels, renderDrawerOpen])

  useEffect(() => {
    if (!renderOutputPath) {
      setRenderMetadata(null)
      setRenderMetadataError(null)
      return
    }
    let cancelled = false
    const metadataPath = metadataPathForRender(renderOutputPath)
    void readTextFile(metadataPath)
      .then((result) => {
        if (cancelled) return
        setRenderMetadata(JSON.parse(result.content) as RenderMetadata)
        setRenderMetadataError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setRenderMetadata(null)
        setRenderMetadataError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [readTextFile, renderOutputPath, renderVersion])

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const query = new URLSearchParams()
    if (workspaceId) query.set("workspaceId", String(workspaceId))
    const eventsUrl = `${apiBaseUrl}/api/v1/fs/events${query.toString() ? `?${query.toString()}` : ""}`
    const source = new EventSource(eventsUrl, { withCredentials: true })

    const shouldReloadForChange = (payload: FsChangeEvent): boolean => {
      const change = payload.change
      if (!change || change.op === "mkdir") return false
      const changedPath = change.path
      const oldPath = change.oldPath
      const matchesOpenPath = workspacePathsEqual(changedPath, path) || workspacePathsEqual(oldPath, path)
      const matchesSaveTarget = workspacePathsEqual(changedPath, saveTarget) || workspacePathsEqual(oldPath, saveTarget)
      if (!matchesOpenPath && !matchesSaveTarget) return false
      if (savingRef.current || pendingAutosaveRef.current) return false
      const knownMtime = targetMtimeRef.current[saveTarget]
      if (change.op === "write" && typeof knownMtime === "number" && change.mtimeMs === knownMtime) return false
      return true
    }

    const reloadFromExternalChange = (label: string) => {
      setStatus(`${label} — reloading…`)
      setRefreshNonce((value) => value + 1)
    }

    source.addEventListener("change", (event) => {
      try {
        const payload = JSON.parse(event.data) as FsChangeEvent
        if (shouldReloadForChange(payload)) reloadFromExternalChange("External file change detected")
      } catch {
        // Ignore malformed event payloads; the next valid event can still reload.
      }
    })
    source.addEventListener("resync-required", () => reloadFromExternalChange("File watcher resync required"))
    source.addEventListener("unsupported", () => source.close())
    return () => source.close()
  }, [apiBaseUrl, path, saveTarget, workspaceId])

  flushPendingSaveRef.current = async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!readOnlyRef.current && pendingAutosaveRef.current && loadedRef.current) {
      const api = excalidrawApiRef.current
      const scene = api
        ? { elements: api.getSceneElements(), appState: api.getAppState(), files: api.getFiles() }
        : latestSceneRef.current
      if (scene) {
        const json = sceneToJson(saveTarget, scene.elements, scene.appState, scene.files)
        pendingAutosaveRef.current = false
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json
          await saveWorkspaceFile({ token: tokenRef.current, target: saveTarget, json })
        }
      }
    }
    if (savingRef.current || queuedSaveRef.current) {
      await new Promise<void>((resolve) => saveIdleResolversRef.current.push(resolve))
    }
  }

  useEffect(() => {
    return () => { void flushPendingSaveRef.current() }
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="shrink-0 border-b border-border px-3 py-2">
        <ToolbarGroup>
          <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded px-2 py-1 ${viewMode === "diagram" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setViewMode("diagram")
                setRenderDrawerOpen(false)
              }}
            >
              Diagram
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${viewMode === "image" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setViewMode("image")
                setRenderDrawerOpen(true)
              }}
            >
              Image{renderStale ? " *" : ""}
            </button>
          </div>
        </ToolbarGroup>
        <ToolbarGroup>
          <span className="max-w-[42vw] truncate text-xs text-muted-foreground" title={error ? `${status} — ${error}` : status}>
            {status}{readOnly ? " — read-only" : ""}{renderStale ? " — render stale" : ""}{error ? ` — ${error}` : ""}
          </span>
        </ToolbarGroup>
        <ToolbarGroup className="ml-auto gap-1">
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={readOnly}
            onClick={requestSave}
            aria-label={readOnly ? "Read-only" : "Save now"}
            title={readOnly ? "Read-only" : "Save now"}
          >
            <SaveIcon />
          </button>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            type="button"
            aria-label="Reload"
            title="Reload"
            onClick={() => {
              void (async () => {
                await flushPendingSaveRef.current()
                setRefreshNonce((value) => value + 1)
              })()
            }}
          >
            <ReloadIcon />
          </button>
        </ToolbarGroup>
      </Toolbar>
      {viewMode === "image" ? (
        <div className="shrink-0 border-b border-border bg-background/95 text-sm shadow-sm">
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-expanded={renderDrawerOpen}
            onClick={() => setRenderDrawerOpen((value) => !value)}
          >
            <span>Image render controls{renderStale ? " — stale" : ""}</span>
            <ChevronIcon open={renderDrawerOpen} />
          </button>
          {renderDrawerOpen ? (
            <>
              <div className="flex flex-col gap-2 px-3 pb-3 md:flex-row md:items-end">
            <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
              Prompt
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <select
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring disabled:opacity-60"
                  value=""
                  disabled={promptCatalog.length === 0}
                  aria-label="Prompt catalog"
                  onChange={(event) => {
                    const item = promptCatalog.find((candidate) => candidate.id === event.target.value)
                    if (item) setRenderPrompt(item.prompt)
                  }}
                >
                  <option value="">{promptCatalog.length === 0 ? "No saved prompts" : "Saved prompts…"}</option>
                  {promptCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <button
                  type="button"
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!renderPrompt.trim()}
                  onClick={saveCurrentPromptToCatalog}
                >
                  Save prompt
                </button>
              </div>
              <textarea
                className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                placeholder="Make this sketch into a polished product architecture illustration…"
                value={renderPrompt}
                onChange={(event) => setRenderPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault()
                    void requestRender()
                  }
                }}
              />
            </label>
            <div className="w-full text-xs font-medium text-muted-foreground md:w-72">
              Model
              <div className="mt-1">
                <ModelSelect
                  value={selectedRenderModel}
                  onChange={setSelectedRenderModel}
                  options={renderModels}
                  disabled={rendering || renderModels.length === 0}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={rendering || !renderPrompt.trim() || !selectedRenderModel}
                onClick={() => void requestRender()}
              >
                {rendering ? "Rendering…" : "Render"}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setRenderDrawerOpen(false)}
              >
                Cancel
              </button>
            </div>
              </div>
              {renderAuthHint ? <div className="px-3 pb-3 text-xs text-amber-600">{renderAuthHint}</div> : null}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="relative min-h-0 min-w-0 flex-1 bg-white text-black">
        <div className={viewMode === "diagram" ? "h-full" : "hidden h-full"}>
          <Excalidraw
            key={editorEpoch}
            excalidrawAPI={(api: unknown) => {
              excalidrawApiRef.current = api as ExcalidrawAPI
              setEditorReady(true)
            }}
            onChange={scheduleSave}
            viewModeEnabled={readOnly}
            UIOptions={{
              canvasActions: {
                loadScene: true,
                saveToActiveFile: false,
                export: { saveFileToDisk: true },
              },
            }}
          />
        </div>
        {viewMode === "image" ? (
          <div className="flex h-full min-h-0 flex-col bg-muted/20 text-foreground">
            {renderOutputPath ? (
              <>
                <div className="shrink-0 border-b border-border bg-background/95 text-sm shadow-sm">
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    aria-expanded={renderMetadataOpen}
                    onClick={() => setRenderMetadataOpen((value) => !value)}
                  >
                    <span className="min-w-0 truncate">
                      Render metadata
                      {renderMetadata?.model?.provider ? ` — ${renderMetadata.model.provider}:${renderMetadata.model.id ?? ""}` : ""}
                      {renderMetadata?.generatedAt ? ` — ${new Date(renderMetadata.generatedAt).toLocaleString()}` : ""}
                      {!renderMetadata && renderMetadataError ? " — unavailable" : ""}
                    </span>
                    <ChevronIcon open={renderMetadataOpen} />
                  </button>
                  {renderMetadataOpen ? (
                    <div className="space-y-3 px-3 pb-3 text-sm text-foreground">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Metadata file: {metadataPathForRender(renderOutputPath)}</span>
                        <span>Output: {renderMetadata?.outputPath || renderOutputPath}</span>
                      </div>
                      {renderMetadata ? (
                        <>
                          <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</div>
                            <div className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs leading-relaxed">{renderMetadata.prompt?.text || "—"}</div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                            <div>
                              <div className="font-medium text-muted-foreground">Model</div>
                              <div className="mt-0.5 break-words">{renderMetadata.model?.provider ? `${renderMetadata.model.provider}:${renderMetadata.model.id ?? ""}` : "—"}</div>
                            </div>
                            <div>
                              <div className="font-medium text-muted-foreground">Generated</div>
                              <div className="mt-0.5 break-words">{renderMetadata.generatedAt ? new Date(renderMetadata.generatedAt).toLocaleString() : "—"}</div>
                            </div>
                            <div>
                              <div className="font-medium text-muted-foreground">Source</div>
                              <div className="mt-0.5 break-words">{renderMetadata.sourcePath || "—"}</div>
                            </div>
                            <div>
                              <div className="font-medium text-muted-foreground">Output</div>
                              <div className="mt-0.5 break-words">{renderMetadata.outputPath || renderOutputPath}</div>
                            </div>
                          </div>
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw JSON</summary>
                            <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">{JSON.stringify(renderMetadata, null, 2)}</pre>
                          </details>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">{renderMetadataError ? `Metadata unavailable: ${renderMetadataError}` : "Loading metadata…"}</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
                  <img
                    className="max-h-full max-w-full rounded-lg border border-border bg-white object-contain shadow-sm"
                    src={`${apiBaseUrl}/api/v1/files/raw?${fileQuery(renderOutputPath)}&renderVersion=${renderVersion}`}
                    alt={`Rendered ${renderOutputPath}`}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                <div>No rendered image yet.</div>
                <div>Use Render to create {renderTarget} from the current diagram.</div>
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                  onClick={() => {
                    setViewMode("image")
                    setRenderDrawerOpen(true)
                  }}
                >
                  Open render prompt
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
