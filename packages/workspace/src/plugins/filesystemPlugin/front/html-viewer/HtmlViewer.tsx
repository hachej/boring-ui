"use client"

import { useEffect, useMemo, useState } from "react"
import { ErrorState, Spinner } from "@hachej/boring-ui-kit"
import { cn } from "../../../../front/lib/utils"
import { useApiBaseUrl, useWorkspaceRequestId } from "../data/DataProvider"

export interface HtmlViewerProps {
  path: string
  className?: string
}

function apiUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "")
  return `${normalizedBase}${path}`
}

function filename(path: string): string {
  return path.split("/").pop() ?? path
}

export function HtmlViewer({ path, className }: HtmlViewerProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const rawUrl = useMemo(
    () => apiUrl(apiBaseUrl, `/api/v1/files/raw?path=${encodeURIComponent(path)}`),
    [apiBaseUrl, path],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setHtml(null)

    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId

    void fetch(rawUrl, {
      credentials: "include",
      headers,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setHtml(await res.text())
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Failed to load HTML preview")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [rawUrl, workspaceRequestId])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="No file selected" description="Choose an HTML file from the file tree." />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <span>Loading HTML preview...</span>
      </div>
    )
  }

  if (error || html === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState title="Failed to load HTML preview" description={error ?? "Preview unavailable."} />
      </div>
    )
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={path}>
          {filename(path)}
        </div>
        <a
          href={rawUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Open raw
        </a>
      </div>
      <iframe
        srcDoc={html}
        title={filename(path)}
        sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  )
}
