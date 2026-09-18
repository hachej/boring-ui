"use client"

import {
  Button,
  Collapsible,
  CollapsibleContent,
  EmptyState,
  IconButton,
  Notice,
  Pane,
  PaneBody,
  PaneHeader,
  PaneTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@hachej/boring-ui-kit"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { Bug, Check, Copy } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  activateAppVersion,
  AppRunnerApiError,
  fetchAppLogs,
  fetchAppVersions,
  fetchApps,
  rollbackApp,
} from "./apiClient"
import { copyTextToClipboard } from "./clipboard"
import type { AppRunnerLogsResponse, AppRunnerRecordWithLinks, AppRunnerVersionWithPreview } from "../shared/types"

const LOG_LINES_SHOWN = 20
const ERROR_LINES_SHOWN = 10
const DEBUG_VISIBLE_STORAGE_KEY = "boring:app-runner:debug-visible"
const REDACTED_TOKEN = "•••"

/**
 * The serving URL carries a short-lived signed authorization token in its
 * path (`/t/<token>/...`) — see `signedServingUrl` in `appRunnerClient.ts`.
 * Displaying it in full lets anyone who sees a screenshot or shared screen
 * use that token until it expires (~3 minutes, but still a live credential).
 * This only redacts the *displayed text*; the token still necessarily
 * appears in the DOM via the iframe's `src` attribute, since the browser
 * must send it to load the app. That's an unavoidable property of using a
 * signed URL for iframe auth, not something this masking can or should hide
 * — see `.artifacts/HOST-RUN.md` for the full note. Masking only reduces
 * shoulder-surfing/screenshot leakage of the debug panel's own text.
 */
function maskSignedAppUrl(rawUrl: string): string {
  return rawUrl.replace(/\/t\/[^/]+\//, `/t/${REDACTED_TOKEN}/`)
}

function CopySignedUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(url)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }, [url])

  return (
    <IconButton
      aria-label="Copy credentialed app URL"
      title="Copy the full app URL, including its signed access token"
      data-testid="app-runner-copy-url"
      variant="ghost"
      onClick={handleCopy}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  )
}

export interface AppRunnerPaneParams {
  appName?: string
}

function formatLogError(error: AppRunnerLogsResponse["errors"][number]): string {
  return [error.created_at, error.path, error.message].filter(Boolean).join(" · ")
}

function errorMessage(error: unknown): string {
  if (error instanceof AppRunnerApiError) return error.message
  return error instanceof Error ? error.message : "Something went wrong."
}

function readDebugVisible(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(DEBUG_VISIBLE_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function writeDebugVisible(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (value) window.localStorage.setItem(DEBUG_VISIBLE_STORAGE_KEY, "1")
    else window.localStorage.removeItem(DEBUG_VISIBLE_STORAGE_KEY)
  } catch {
    // Best-effort preference only.
  }
}

export function AppRunnerPane({ params }: PaneProps<AppRunnerPaneParams>) {
  const [apps, setApps] = useState<AppRunnerRecordWithLinks[] | null>(null)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [selectedApp, setSelectedApp] = useState<string | undefined>(params?.appName)

  const [versions, setVersions] = useState<AppRunnerVersionWithPreview[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined)
  const [actionPending, setActionPending] = useState<"rollback" | "activate" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [logs, setLogs] = useState<AppRunnerLogsResponse | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [debugVisible, setDebugVisible] = useState<boolean>(readDebugVisible)

  useEffect(() => {
    writeDebugVisible(debugVisible)
  }, [debugVisible])

  const loadApps = useCallback(async () => {
    setAppsError(null)
    try {
      const response = await fetchApps()
      setApps(response.apps)
      setSelectedApp((current) => current ?? params?.appName ?? response.apps[0]?.appName)
    } catch (error) {
      setAppsError(errorMessage(error))
    }
  }, [params?.appName])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  useEffect(() => {
    if (params?.appName) setSelectedApp(params.appName)
  }, [params?.appName])

  const loadVersions = useCallback(async (appName: string) => {
    setVersionsError(null)
    setVersions(null)
    try {
      const response = await fetchAppVersions(appName)
      setVersions(response.versions)
      setSelectedVersion(response.versions.find((entry) => entry.current)?.version ?? response.versions[0]?.version)
    } catch (error) {
      setVersionsError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    // Signed path prefixes are deliberately short-lived. Refresh both current
    // and preview URLs before expiry; sandboxed iframes do not use cookies.
    const renewal = window.setInterval(() => {
      loadApps()
      if (selectedApp) loadVersions(selectedApp)
    }, 120_000)
    return () => window.clearInterval(renewal)
  }, [loadApps, loadVersions, selectedApp])

  const loadLogs = useCallback(async (appName: string) => {
    setLogsError(null)
    try {
      setLogs(await fetchAppLogs(appName))
    } catch (error) {
      setLogs(null)
      setLogsError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    if (selectedApp) {
      loadVersions(selectedApp)
      loadLogs(selectedApp)
    }
  }, [selectedApp, loadVersions, loadLogs])

  const currentApp = useMemo(() => apps?.find((app) => app.appName === selectedApp), [apps, selectedApp])
  const activeVersion = useMemo(() => versions?.find((entry) => entry.version === selectedVersion), [versions, selectedVersion])
  const isCurrentVersionSelected = activeVersion?.current ?? true

  const iframeSrc = useMemo(() => {
    if (!currentApp || currentApp.kind !== "app") return undefined
    if (!activeVersion || isCurrentVersionSelected) return currentApp.appUrl
    return activeVersion.previewUrl
  }, [activeVersion, currentApp, isCurrentVersionSelected])

  const handleRollback = useCallback(async () => {
    if (!selectedApp) return
    setActionPending("rollback")
    setActionError(null)
    try {
      await rollbackApp(selectedApp)
      await loadVersions(selectedApp)
      await loadLogs(selectedApp)
      await loadApps()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setActionPending(null)
    }
  }, [selectedApp, loadVersions, loadApps])

  const handleActivate = useCallback(async () => {
    if (!selectedApp || selectedVersion === undefined) return
    setActionPending("activate")
    setActionError(null)
    try {
      await activateAppVersion(selectedApp, selectedVersion)
      await loadVersions(selectedApp)
      await loadLogs(selectedApp)
      await loadApps()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setActionPending(null)
    }
  }, [selectedApp, selectedVersion, loadVersions, loadLogs, loadApps])

  const recentErrors = useMemo(() => (logs?.errors ?? []).slice(-ERROR_LINES_SHOWN), [logs])
  const recentLines = useMemo(() => (logs?.lines ?? []).slice(-LOG_LINES_SHOWN), [logs])
  const mountedToolNames = useMemo(() => currentApp?.toolManifest?.tools.map((tool) => tool.name) ?? [], [currentApp])

  if (appsError) {
    return (
      <Pane>
        <PaneHeader>
          <PaneTitle>Apps</PaneTitle>
        </PaneHeader>
        <PaneBody>
          <Notice tone="destructive">{appsError}</Notice>
        </PaneBody>
      </Pane>
    )
  }

  if (apps && apps.length === 0) {
    return (
      <Pane>
        <PaneHeader>
          <PaneTitle>Apps</PaneTitle>
        </PaneHeader>
        <PaneBody>
          <EmptyState
            title="No apps published yet"
            description="Ask the agent to publish an app from apps/<name>/ with app (action publish)."
          />
        </PaneBody>
      </Pane>
    )
  }

  return (
    <Pane className="flex h-full flex-col">
      <PaneHeader className="flex flex-wrap items-center justify-between gap-2">
        <PaneTitle>{currentApp?.appName ?? "Apps"}</PaneTitle>
        <div className="flex items-center gap-2">
          {apps && apps.length > 0 && (
            <Select value={selectedApp} onValueChange={setSelectedApp}>
              <SelectTrigger size="sm" aria-label="Select app">
                <SelectValue placeholder="Select an app" />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.appName} value={app.appName}>
                    {app.appName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <IconButton
            aria-label={debugVisible ? "Hide app debug details" : "Show app debug details"}
            aria-pressed={debugVisible}
            data-testid="app-runner-debug-toggle"
            variant={debugVisible ? "secondary" : "ghost"}
            onClick={() => setDebugVisible((current) => !current)}
          >
            <Bug className="size-4" />
          </IconButton>
        </div>
      </PaneHeader>
      <PaneBody className="flex flex-1 flex-col p-0">
        <Collapsible open={debugVisible}>
          <CollapsibleContent data-testid="app-runner-debug" className="shrink-0 border-b border-border/60">
            <div className="flex flex-wrap items-center gap-2 p-2">
              {versions && versions.length > 0 && (
                <Select
                  value={selectedVersion !== undefined ? String(selectedVersion) : undefined}
                  onValueChange={(value) => setSelectedVersion(Number(value))}
                >
                  <SelectTrigger size="sm" aria-label="Select version">
                    <SelectValue placeholder="Version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((entry) => (
                      <SelectItem key={entry.version} value={String(entry.version)}>
                        v{entry.version}{entry.current ? " (current)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedApp || actionPending !== null}
                onClick={handleRollback}
              >
                {actionPending === "rollback" ? <Spinner className="size-4" /> : "Rollback"}
              </Button>
              <Button
                size="sm"
                disabled={!selectedApp || selectedVersion === undefined || isCurrentVersionSelected || actionPending !== null}
                onClick={handleActivate}
              >
                {actionPending === "activate" ? <Spinner className="size-4" /> : "Activate version"}
              </Button>
            </div>
            {actionError && <Notice tone="destructive" className="mx-2 mb-2">{actionError}</Notice>}
            {versionsError && <Notice tone="destructive" className="mx-2 mb-2">{versionsError}</Notice>}
            {currentApp && (
              <section data-testid="app-runner-metadata" className="px-3 py-2 text-xs">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span><strong>Kind:</strong> {currentApp.kind}</span>
                  <span><strong>Current:</strong> v{currentApp.version}</span>
                  <span className="font-mono"><strong className="font-sans">SHA:</strong> {currentApp.sha ?? "not recorded"}</span>
                  <span className="flex items-center gap-1 break-all">
                    <strong>URL:</strong> <span data-testid="app-runner-masked-url">{maskSignedAppUrl(currentApp.appUrl)}</span>
                    <CopySignedUrlButton url={currentApp.appUrl} />
                  </span>
                </div>
                {mountedToolNames.length > 0 && (
                  <div className="mt-1">
                    <strong>Mounted tools:</strong> {mountedToolNames.join(", ")}
                  </div>
                )}
                {(currentApp.toolProvenance?.length ?? 0) > 0 && (
                  <ul aria-label="Mounted tool provenance" className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {currentApp.toolProvenance!.map((provenance, index) => (
                      <li key={`${provenance.address}:${provenance.version}:${index}`}>
                        {provenance.kind} {provenance.address} · v{provenance.version} · {provenance.sha.slice(0, 12)}
                      </li>
                    ))}
                  </ul>
                )}
                {versions && versions.length > 0 && (
                  <ul aria-label="Published versions" className="mt-2 flex flex-wrap gap-2">
                    {versions.map((entry) => (
                      <li key={entry.version}>
                        <button
                          type="button"
                          className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
                          aria-current={entry.current ? "true" : undefined}
                          onClick={() => setSelectedVersion(entry.version)}
                        >
                          v{entry.version} · {entry.kind} · {entry.sha?.slice(0, 8) ?? "no sha"}{entry.current ? " · current" : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {selectedApp && (
              <section
                data-testid="app-runner-logs"
                className="max-h-48 shrink-0 overflow-auto border-t border-border/60 px-3 py-2 font-mono text-xs"
              >
                <div className="mb-1 font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recent logs
                </div>
                {logsError && <div className="text-destructive">{logsError}</div>}
                {!logsError && logs && recentErrors.length === 0 && recentLines.length === 0 && (
                  <div className="text-muted-foreground">No log output yet.</div>
                )}
                {recentErrors.length > 0 && (
                  <ul className="mb-1 space-y-0.5">
                    {recentErrors.map((line, index) => (
                      <li key={`err-${index}`} className="whitespace-pre-wrap text-destructive">{formatLogError(line)}</li>
                    ))}
                  </ul>
                )}
                {recentLines.length > 0 && (
                  <ul className="space-y-0.5">
                    {recentLines.map((line, index) => (
                      <li key={`line-${index}`} className="whitespace-pre-wrap text-foreground/80">{line}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </CollapsibleContent>
        </Collapsible>
        {!apps && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {iframeSrc && (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            title={selectedApp ? `${selectedApp} preview` : "App preview"}
            sandbox="allow-scripts allow-forms"
            className="min-h-0 w-full flex-1 border-0"
          />
        )}
      </PaneBody>
    </Pane>
  )
}
