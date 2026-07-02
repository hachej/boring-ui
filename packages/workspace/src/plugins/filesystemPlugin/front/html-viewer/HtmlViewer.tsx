"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ErrorState, IconButton, Spinner } from "@hachej/boring-ui-kit"
import { ExternalLink, RefreshCcw } from "lucide-react"
import { cn } from "../../../../front/lib/utils"
import { useApiBaseUrl, useWorkspaceRequestId } from "../data/DataProvider"
import { redactedFilesystemErrorMessage } from "../data/filesystemErrorRedaction"

export interface HtmlViewerProps {
  path: string
  filesystem?: string
  className?: string
}

function apiUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "")
  return `${normalizedBase}${path}`
}

function filename(path: string): string {
  return path.split("/").pop() ?? path
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : normalized.slice(0, index)
}

function splitUrlSuffix(url: string): { pathname: string; suffix: string } {
  const index = url.search(/[?#]/)
  if (index === -1) return { pathname: url, suffix: "" }
  return { pathname: url.slice(0, index), suffix: url.slice(index) }
}

function isExternalAssetUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.startsWith("//") ||
    url.startsWith("#") ||
    url.startsWith("/api/")
  )
}

export function resolveHtmlPreviewAssetPath(sourcePath: string, assetUrl: string): string | null {
  const trimmed = assetUrl.trim()
  if (!trimmed || isExternalAssetUrl(trimmed)) return null

  const { pathname } = splitUrlSuffix(trimmed)
  if (!pathname) return null

  const parts = pathname.startsWith("/")
    ? pathname.split("/")
    : [...dirname(sourcePath).split("/"), ...pathname.split("/")]

  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (normalized.length === 0) return null
      normalized.pop()
      continue
    }
    normalized.push(part)
  }

  return normalized.join("/")
}

export function rawFileUrlFor(base: string, path: string, workspaceRequestId?: string | null, filesystem?: string): string {
  const params = new URLSearchParams({ path })
  if (workspaceRequestId) params.set("workspaceId", workspaceRequestId)
  if (filesystem && filesystem !== "user") params.set("filesystem", filesystem)
  return apiUrl(base, `/api/v1/files/raw?${params.toString()}`)
}

function previewAssetUrl(base: string, sourcePath: string, assetUrl: string, workspaceRequestId?: string | null, filesystem?: string): string {
  const resolvedPath = resolveHtmlPreviewAssetPath(sourcePath, assetUrl)
  if (!resolvedPath) return assetUrl

  const { suffix } = splitUrlSuffix(assetUrl.trim())
  const hashIndex = suffix.indexOf("#")
  const hash = hashIndex === -1 ? "" : suffix.slice(hashIndex)
  return `${rawFileUrlFor(base, resolvedPath, workspaceRequestId, filesystem)}${hash}`
}

export function rewriteCssAssetUrls(css: string, sourcePath: string, base: string, workspaceRequestId?: string | null, filesystem?: string): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, quote: string, url: string) => {
      return `url(${quote}${previewAssetUrl(base, sourcePath, url, workspaceRequestId, filesystem)}${quote})`
    })
    .replace(/@import\s+(url\(\s*)?(["'])([^"']+)\2\s*\)?/gi, (match, urlPrefix: string | undefined, quote: string, url: string) => {
      const rewritten = previewAssetUrl(base, sourcePath, url, workspaceRequestId, filesystem)
      if (urlPrefix) return `@import ${urlPrefix}${quote}${rewritten}${quote})`
      return match.replace(`${quote}${url}${quote}`, `${quote}${rewritten}${quote}`)
    })
}

function rewriteSrcSet(value: string, sourcePath: string, base: string, workspaceRequestId?: string | null, filesystem?: string): string {
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim()
      const [url, ...descriptor] = trimmed.split(/\s+/)
      if (!url) return entry
      return [previewAssetUrl(base, sourcePath, url, workspaceRequestId, filesystem), ...descriptor].join(" ")
    })
    .join(", ")
}

async function fetchText(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    credentials: "include",
    headers,
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function prepareHtmlPreviewDocument(options: {
  html: string
  path: string
  apiBaseUrl: string
  headers: Record<string, string>
  workspaceRequestId?: string | null
  filesystem?: string
  signal: AbortSignal
}): Promise<string> {
  const { html, path, apiBaseUrl, headers, workspaceRequestId, filesystem, signal } = options
  const doc = new DOMParser().parseFromString(html, "text/html")

  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(async (link) => {
      const href = link.getAttribute("href")
      if (!href) return
      const stylesheetPath = resolveHtmlPreviewAssetPath(path, href)
      if (!stylesheetPath) return

      try {
        const css = await fetchText(rawFileUrlFor(apiBaseUrl, stylesheetPath, workspaceRequestId, filesystem), headers, signal)
        const style = doc.createElement("style")
        style.setAttribute("data-boring-html-viewer-href", href)
        style.textContent = rewriteCssAssetUrls(css, stylesheetPath, apiBaseUrl, workspaceRequestId, filesystem)
        link.replaceWith(style)
      } catch {
        link.setAttribute("href", previewAssetUrl(apiBaseUrl, path, href, workspaceRequestId, filesystem))
      }
    }),
  )

  for (const style of Array.from(doc.querySelectorAll<HTMLStyleElement>("style"))) {
    if (style.hasAttribute("data-boring-html-viewer-href")) continue
    style.textContent = rewriteCssAssetUrls(style.textContent ?? "", path, apiBaseUrl, workspaceRequestId, filesystem)
  }

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const style = element.getAttribute("style")
    if (style) element.setAttribute("style", rewriteCssAssetUrls(style, path, apiBaseUrl, workspaceRequestId, filesystem))
  }

  const assetAttributes = [
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["audio", "src"],
    ["track", "src"],
    ["iframe", "src"],
    ["script", "src"],
    ["object", "data"],
    ["embed", "src"],
    ["link", "href"],
  ] as const

  for (const [selector, attribute] of assetAttributes) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`${selector}[${attribute}]`))) {
      const value = element.getAttribute(attribute)
      if (value) element.setAttribute(attribute, previewAssetUrl(apiBaseUrl, path, value, workspaceRequestId, filesystem))
    }
  }

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[srcset]"))) {
    const srcset = element.getAttribute("srcset")
    if (srcset) element.setAttribute("srcset", rewriteSrcSet(srcset, path, apiBaseUrl, workspaceRequestId, filesystem))
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export function HtmlViewer({ path, filesystem, className }: HtmlViewerProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const rawUrl = useMemo(
    () => rawFileUrlFor(apiBaseUrl, path, workspaceRequestId, filesystem),
    [apiBaseUrl, path, workspaceRequestId, filesystem],
  )
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(() => {
    setReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setHtml(null)

    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId

    void fetchText(rawUrl, headers, controller.signal)
      .then(async (content) => {
        setHtml(await prepareHtmlPreviewDocument({
          html: content,
          path,
          apiBaseUrl,
          headers,
          workspaceRequestId,
          filesystem,
          signal: controller.signal,
        }))
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Failed to load HTML preview"
        const status = /^HTTP (403|404)$/.exec(message)?.[1]
        setError(status ? redactedFilesystemErrorMessage(filesystem, Number(status), message) : message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [apiBaseUrl, path, rawUrl, workspaceRequestId, filesystem, reloadKey])

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
      <div className="flex shrink-0 items-center justify-end gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={refresh}
            aria-label="Refresh preview"
            title="Refresh preview"
          >
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open raw in new tab"
            title="Open raw in new tab"
          >
            <a href={rawUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            </a>
          </IconButton>
        </div>
      </div>
      <iframe
        srcDoc={html}
        title={filename(path)}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  )
}
