"use client"

import { useEffect, useState } from "react"
import { PublicMarkdownReviewApp } from "./PublicMarkdownReviewApp"

export interface PublicShareAppProps {
  token: string
  /** Base URL for share routes. Defaults to `/share/<token>`. */
  shareBaseUrl?: string
}

interface PublicShareMeta {
  kind?: string
  appId?: string
}

export function PublicShareApp({ token, shareBaseUrl = `/share/${encodeURIComponent(token)}` }: PublicShareAppProps) {
  const [meta, setMeta] = useState<PublicShareMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${shareBaseUrl}/meta`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return await res.json() as PublicShareMeta
      })
      .then((nextMeta) => {
        if (cancelled) return
        setMeta(nextMeta)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load share")
      })
    return () => { cancelled = true }
  }, [shareBaseUrl])

  if (error) {
    return <div className="min-h-screen bg-background p-6 text-sm text-destructive">{error}</div>
  }
  if (!meta) {
    return <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Loading share…</div>
  }

  const appId = meta.appId ?? meta.kind
  if (appId === "markdown-review") {
    return <PublicMarkdownReviewApp token={token} shareBaseUrl={shareBaseUrl} />
  }

  return <div className="min-h-screen bg-background p-6 text-sm text-destructive">Unsupported public share app: {appId ?? "unknown"}</div>
}
