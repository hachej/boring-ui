"use client"

import {
  Button,
  EmptyState,
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
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  activateAppVersion,
  AppRunnerApiError,
  fetchAppLogs,
  fetchAppVersions,
  fetchApps,
  rollbackApp,
} from "./apiClient"
import type { AppRunnerLogsResponse, AppRunnerRecordWithLinks, AppRunnerVersionWithPreview } from "../shared/types"

const LOG_LINES_SHOWN = 20
const ERROR_LINES_SHOWN = 10

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
    // Serving tokens and their path-scoped cookies are deliberately short-lived.
    // Refreshing the signed document URL renews browser authority before expiry.
    const renewal = window.setInterval(loadApps, 120_000)
    return () => window.clearInterval(renewal)
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
            description="Ask the agent to publish an app from apps/<name>/ with publish_app."
          />
        </PaneBody>
      </Pane>
    )
  }

  return (
    <Pane className="flex h-full flex-col">
      <PaneHeader className="flex flex-wrap items-center justify-between gap-2">
        <PaneTitle>Apps</PaneTitle>
        <div className="flex items-center gap-2">
          {apps && apps.length > 0 && (
            <Select value={selectedApp} onValueChange={setSelectedApp}>
              <SelectTrigger size="sm" aria-label="Select app">
                <SelectValue placeholder="Select an app" />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.appName} value={app.appName}>
                    {app.appName} ({app.kind}, v{app.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
      </PaneHeader>
      <PaneBody className="flex flex-1 flex-col p-0">
        {actionError && <Notice tone="destructive" className="m-2">{actionError}</Notice>}
        {versionsError && <Notice tone="destructive" className="m-2">{versionsError}</Notice>}
        {currentApp && (
          <section data-testid="app-runner-metadata" className="shrink-0 border-b border-border/60 px-3 py-2 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><strong>Kind:</strong> {currentApp.kind}</span>
              <span><strong>Current:</strong> v{currentApp.version}</span>
              <span className="font-mono"><strong className="font-sans">SHA:</strong> {currentApp.sha ?? "not recorded"}</span>
            </div>
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
      </PaneBody>
    </Pane>
  )
}
