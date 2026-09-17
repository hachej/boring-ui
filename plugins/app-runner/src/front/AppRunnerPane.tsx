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
    if (!currentApp) return undefined
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
            description="Ask the agent to publish an app from the app/ folder with publish_app."
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
                    {app.appName} (v{app.version})
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
                  <li key={`err-${index}`} className="whitespace-pre-wrap text-destructive">{line}</li>
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
