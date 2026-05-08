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

export function rawFileUrlFor(base: string, path: string): string {
  return apiUrl(base, `/api/v1/files/raw?path=${encodeURIComponent(path)}`)
}

function previewAssetUrl(base: string, sourcePath: string, assetUrl: string): string {
  const resolvedPath = resolveHtmlPreviewAssetPath(sourcePath, assetUrl)
  if (!resolvedPath) return assetUrl

  const { suffix } = splitUrlSuffix(assetUrl.trim())
  const hashIndex = suffix.indexOf("#")
  const hash = hashIndex === -1 ? "" : suffix.slice(hashIndex)
  return `${rawFileUrlFor(base, resolvedPath)}${hash}`
}

export function rewriteCssAssetUrls(css: string, sourcePath: string, base: string): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, quote: string, url: string) => {
      return `url(${quote}${previewAssetUrl(base, sourcePath, url)}${quote})`
    })
    .replace(/@import\s+(url\(\s*)?(["'])([^"']+)\2\s*\)?/gi, (match, urlPrefix: string | undefined, quote: string, url: string) => {
      const rewritten = previewAssetUrl(base, sourcePath, url)
      if (urlPrefix) return `@import ${urlPrefix}${quote}${rewritten}${quote})`
      return match.replace(`${quote}${url}${quote}`, `${quote}${rewritten}${quote}`)
    })
}

function rewriteSrcSet(value: string, sourcePath: string, base: string): string {
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim()
      const [url, ...descriptor] = trimmed.split(/\s+/)
      if (!url) return entry
      return [previewAssetUrl(base, sourcePath, url), ...descriptor].join(" ")
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
  signal: AbortSignal
}): Promise<string> {
  const { html, path, apiBaseUrl, headers, signal } = options
  const doc = new DOMParser().parseFromString(html, "text/html")

  await Promise.all(
    Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(async (link) => {
      const href = link.getAttribute("href")
      if (!href) return
      const stylesheetPath = resolveHtmlPreviewAssetPath(path, href)
      if (!stylesheetPath) return

      try {
        const css = await fetchText(rawFileUrlFor(apiBaseUrl, stylesheetPath), headers, signal)
        const style = doc.createElement("style")
        style.setAttribute("data-boring-html-viewer-href", href)
        style.textContent = rewriteCssAssetUrls(css, stylesheetPath, apiBaseUrl)
        link.replaceWith(style)
      } catch {
        link.setAttribute("href", previewAssetUrl(apiBaseUrl, path, href))
      }
    }),
  )

  for (const style of Array.from(doc.querySelectorAll<HTMLStyleElement>("style"))) {
    if (style.hasAttribute("data-boring-html-viewer-href")) continue
    style.textContent = rewriteCssAssetUrls(style.textContent ?? "", path, apiBaseUrl)
  }

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const style = element.getAttribute("style")
    if (style) element.setAttribute("style", rewriteCssAssetUrls(style, path, apiBaseUrl))
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
      if (value) element.setAttribute(attribute, previewAssetUrl(apiBaseUrl, path, value))
    }
  }

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[srcset]"))) {
    const srcset = element.getAttribute("srcset")
    if (srcset) element.setAttribute("srcset", rewriteSrcSet(srcset, path, apiBaseUrl))
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export function HtmlViewer({ path, className }: HtmlViewerProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const rawUrl = useMemo(
    () => rawFileUrlFor(apiBaseUrl, path),
    [apiBaseUrl, path],
  )

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
          signal: controller.signal,
        }))
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Failed to load HTML preview")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [apiBaseUrl, path, rawUrl, workspaceRequestId])

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
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  )
}
