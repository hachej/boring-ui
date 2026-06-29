"use client"

import { useCallback, useEffect, useState } from "react"
import { MarkdownEditor } from "../../plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor"
import { DataProvider as WorkspaceFilesProvider } from "../../plugins/filesystemPlugin/front/data"

export interface PublicMarkdownReviewAppProps {
  token: string
  /** Base URL for share routes. Defaults to `/share/<token>`. */
  shareBaseUrl?: string
  /** Idle delay before writing changed Markdown back to the share endpoint. */
  autosaveDelayMs?: number
}

interface PublicShareMeta {
  entryPath?: string
  editable?: boolean
  downloads?: {
    portableMarkdown?: string
    bundleZip?: string
  }
}

export function PublicMarkdownReviewApp({
  token,
  shareBaseUrl = `/share/${encodeURIComponent(token)}`,
  autosaveDelayMs = 900,
}: PublicMarkdownReviewAppProps) {
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [entryPath, setEntryPath] = useState("review.md")
  const [downloads, setDownloads] = useState<PublicShareMeta["downloads"]>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`${shareBaseUrl}/meta`).then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return await res.json() as PublicShareMeta
      }),
      fetch(`${shareBaseUrl}/raw`).then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return await res.text()
      }),
    ])
      .then(([meta, text]) => {
        if (cancelled) return
        setEntryPath(meta.entryPath ?? "review.md")
        setDownloads(meta.downloads ?? {})
        setContent(text)
        setSavedContent(text)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [shareBaseUrl])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${shareBaseUrl}/raw`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content }).toString(),
        redirect: "manual",
      })
      if (res.status !== 303 && !res.ok) throw new Error(await res.text())
      setSavedContent(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save document")
    } finally {
      setSaving(false)
    }
  }, [content, shareBaseUrl])

  const dirty = content !== savedContent

  useEffect(() => {
    if (loading || !dirty || saving) return
    const timer = window.setTimeout(() => {
      void save()
    }, autosaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [autosaveDelayMs, dirty, loading, save, saving])

  const portableMarkdownHref = downloads?.portableMarkdown ?? `${shareBaseUrl}/portable.md`
  const bundleZipHref = downloads?.bundleZip ?? `${shareBaseUrl}/bundle.zip`

  return (
    <WorkspaceFilesProvider apiBaseUrl={shareBaseUrl} fileEvents={false}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Public Markdown review</div>
            <div className="text-xs text-muted-foreground">Constrained share editor</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {saving ? <span className="text-muted-foreground">Saving…</span> : dirty ? <span className="text-amber-600">Unsaved changes</span> : <span className="text-muted-foreground">Saved</span>}
            <a className="rounded-md border border-border px-3 py-1.5" href={bundleZipHref}>Download ZIP</a>
            <a className="rounded-md border border-border px-3 py-1.5" href={portableMarkdownHref}>Portable MD</a>
            <button className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" onClick={save} disabled={saving || loading || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </header>
        {error ? <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading document…</div>
        ) : (
          <div className="mx-auto max-w-5xl p-4">
            <div style={{ height: "calc(100vh - 96px)" }}>
              <MarkdownEditor content={content} onChange={setContent} documentPath={entryPath} className="h-full overflow-hidden rounded-xl border border-border" />
            </div>
          </div>
        )}
      </div>
    </WorkspaceFilesProvider>
  )
}
