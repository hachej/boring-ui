import { useCallback, useState, type FormEvent } from "react"
import { Input, Toolbar, ToolbarButton, ToolbarGroup } from "@hachej/boring-ui-kit"

const RECENT_URLS_STORAGE_KEY = "boring-url-pane:recent-urls:v1"
const MAX_RECENT_URLS = 8

type FrameState = "idle" | "loading" | "ready" | "error"

function readRecentUrls(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENT_URLS_STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT_URLS)
      : []
  } catch {
    return []
  }
}

function writeRecentUrls(urls: string[]): void {
  try {
    globalThis.localStorage?.setItem(RECENT_URLS_STORAGE_KEY, JSON.stringify(urls))
  } catch {
    // Recent URL persistence is best-effort.
  }
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null

  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null
  } catch {
    return null
  }
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

export function UrlPane() {
  const [address, setAddress] = useState("")
  const [url, setUrl] = useState("")
  const [recentUrls, setRecentUrls] = useState(readRecentUrls)
  const [frameKey, setFrameKey] = useState(0)
  const [frameState, setFrameState] = useState<FrameState>("idle")
  const [addressError, setAddressError] = useState(false)

  const navigate = useCallback((nextAddress: string) => {
    const normalized = normalizeUrl(nextAddress)
    if (!normalized) {
      setAddressError(true)
      return
    }

    const nextRecentUrls = [normalized, ...recentUrls.filter((recentUrl) => recentUrl !== normalized)].slice(0, MAX_RECENT_URLS)
    setAddress(normalized)
    setAddressError(false)
    setUrl(normalized)
    setRecentUrls(nextRecentUrls)
    setFrameState("loading")
    setFrameKey((current) => current + 1)
    writeRecentUrls(nextRecentUrls)
  }, [recentUrls])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate(address)
  }

  function refresh() {
    if (!url) return
    setFrameState("loading")
    setFrameKey((current) => current + 1)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="shrink-0 border-b border-border/70 p-2" aria-label="URL navigation">
        <form className="flex min-w-48 flex-1 items-center gap-1" onSubmit={handleSubmit}>
          <Input
            aria-label="Address"
            aria-invalid={addressError}
            className="h-8"
            inputMode="url"
            placeholder="Enter a URL"
            spellCheck={false}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(false)
            }}
          />
          <button type="submit" className="sr-only">Navigate</button>
        </form>
        <ToolbarGroup>
          <select
            aria-label="Recent URLs"
            className="h-8 max-w-40 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            disabled={recentUrls.length === 0}
            value=""
            onChange={(event) => navigate(event.target.value)}
          >
            <option value="">Recent URLs</option>
            {recentUrls.map((recentUrl) => (
              <option key={recentUrl} value={recentUrl}>{recentUrl}</option>
            ))}
          </select>
          <ToolbarButton type="button" aria-label="Refresh" disabled={!url} onClick={refresh}>
            <RefreshIcon />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>

      <div className="relative min-h-0 min-w-0 flex-1">
        {!url ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Enter a URL above to open it in this pane.
          </div>
        ) : (
          <iframe
            key={frameKey}
            className="h-full w-full border-0 bg-background"
            src={url}
            title={`URL viewer: ${url}`}
            onLoad={() => setFrameState("ready")}
            onErrorCapture={() => setFrameState("error")}
          />
        )}

        {frameState === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground" role="status">
            Loading…
          </div>
        ) : null}

        {frameState === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6 text-center" role="alert">
            <div className="max-w-md space-y-2">
              <p className="text-sm font-medium text-foreground">This page could not be loaded in the pane.</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The site may be unreachable or may block framing with its security headers. Check the address or open a different URL.
              </p>
            </div>
          </div>
        ) : null}

        {addressError ? (
          <div className="absolute left-2 top-2 rounded-md border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive" role="alert">
            Enter a valid HTTP or HTTPS URL.
          </div>
        ) : null}
      </div>
    </div>
  )
}
