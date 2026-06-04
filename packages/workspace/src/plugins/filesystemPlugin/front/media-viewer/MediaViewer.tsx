"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { ErrorState, Spinner } from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "../data/DataProvider"
import { cn } from "../../../../front/lib/utils"

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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <span>Loading preview...</span>
      </div>
    )
  }

  if (error || !objectUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="Failed to load preview" description={error ?? "Preview unavailable."} />
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Reload ${filename(path)}`}
            title="Reload preview"
          >
            <RefreshCw className="size-3.5" />
            <span>Reload</span>
          </button>
          <a
            href={objectUrl}
            download={filename(path)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Download
          </a>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {kind === "image" ? (
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
