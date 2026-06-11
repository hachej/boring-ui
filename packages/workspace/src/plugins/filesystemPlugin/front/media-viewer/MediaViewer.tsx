"use client"

import { useEffect, useMemo, useState } from "react"
import { Camera, Download, RefreshCw } from "lucide-react"
import { ErrorState, Spinner } from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "../data/DataProvider"
import { cn } from "../../../../front/lib/utils"
import { toast } from "../../../../front/toast"

export interface MediaViewerProps {
  path: string
  kind: "image" | "pdf"
  reloadKey?: number
  onReload?: () => void
  className?: string
}

function apiUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "")
  return `${normalizedBase}${path}`
}

function filename(path: string): string {
  return path.split("/").pop() ?? path
}

async function imageUrlToPngBlob(url: string): Promise<Blob> {
  const image = new Image()
  image.decoding = "async"
  image.src = url
  await image.decode()

  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not create screenshot canvas")
  ctx.drawImage(image, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not render image screenshot")
  return blob
}

export function MediaViewer({ path, kind, reloadKey = 0, onReload, className }: MediaViewerProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const rawUrl = useMemo(() => {
    const query = new URLSearchParams({ path })
    if (reloadKey > 0) query.set("reload", String(reloadKey))
    return apiUrl(apiBaseUrl, `/api/v1/files/raw?${query.toString()}`)
  }, [apiBaseUrl, path, reloadKey])

  async function handleScreenshot() {
    if (!objectUrl) return

    let blob: Blob
    try {
      blob = await imageUrlToPngBlob(objectUrl)
    } catch (error) {
      toast.error({
        title: "Screenshot failed",
        description: error instanceof Error ? error.message : "Image screenshot failed",
      })
      return
    }

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      toast.success({ title: "Screenshot copied to clipboard" })
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${filename(path).replace(/\.[^.]+$/, "")}-screenshot.png`
      a.click()
      URL.revokeObjectURL(url)
      toast.success({ title: "Screenshot downloaded" })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let nextObjectUrl: string | null = null
    setLoading(true)
    setError(null)
    setObjectUrl(null)

    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId

    void fetch(rawUrl, {
      credentials: "include",
      headers,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Failed to load preview")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => {
      controller.abort()
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [rawUrl, workspaceRequestId])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="No file selected" description="Choose an image or PDF from the file tree." />
      </div>
    )
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={path}>
          {filename(path)}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReload}
            disabled={!onReload}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label={`Reload ${filename(path)}`}
            title="Reload preview"
          >
            <RefreshCw className="size-3.5" />
          </button>
          {kind === "image" && objectUrl ? (
            <button
              type="button"
              onClick={handleScreenshot}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Copy screenshot of ${filename(path)}`}
              title="Copy screenshot"
            >
              <Camera className="size-3.5" />
            </button>
          ) : null}
          {objectUrl ? (
            <a
              href={objectUrl}
              download={filename(path)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Download ${filename(path)}`}
              title="Download"
            >
              <Download className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>Loading preview...</span>
          </div>
        ) : error || !objectUrl ? (
          <ErrorState title="Failed to load preview" description={error ?? "Preview unavailable."} />
        ) : kind === "image" ? (
          <img
            src={objectUrl}
            alt={filename(path)}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          />
        ) : (
          <iframe
            src={objectUrl}
            title={filename(path)}
            className="h-full min-h-[480px] w-full rounded-md border border-border bg-background"
          />
        )}
      </div>
    </div>
  )
}
