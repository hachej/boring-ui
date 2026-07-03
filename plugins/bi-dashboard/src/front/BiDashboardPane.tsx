import { useEffect, useMemo, useState } from "react"
import { Braces, Check, Database, ExternalLink, LayoutDashboard, RefreshCcw, SlidersHorizontal } from "lucide-react"
import {
  Card,
  CardContent,
  EmptyState,
  IconButton,
  Textarea,
  Toolbar,
  ToolbarGroup,
} from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { GeneratedPaneRenderer } from "@hachej/boring-generated-pane/front"
import { parseDashboardSpec } from "../shared"
import type { BslDashboardSpec } from "../shared"
import { sampleBiDashboardSpec } from "./sampleSpec"
import { useDashboardQueryData, type DashboardQueryResult } from "./dashboardData"
import { BiDashboardRenderProvider } from "./renderContext"
import { biDashboardGeneratedPaneProfile } from "./profile"

export interface BiDashboardPaneParams {
  path?: string
  spec?: BslDashboardSpec
}

interface LoadedDashboardFile {
  spec: unknown
  error?: string
  loading: boolean
}

export function BiDashboardPane({ params }: PaneProps<BiDashboardPaneParams>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const [loadedFile, setLoadedFile] = useState<LoadedDashboardFile>({ spec: null, loading: false })
  const [controllerValues, setControllerValues] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [showJsonEditor, setShowJsonEditor] = useState(false)
  const [editedSpec, setEditedSpec] = useState<unknown | null>(null)
  const [jsonDraft, setJsonDraft] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    if (!params?.path || params.spec) {
      setLoadedFile({ spec: null, loading: false })
      return
    }

    const controller = new AbortController()
    setLoadedFile({ spec: null, loading: true })
    void fetch(`${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`, {
      signal: controller.signal,
      credentials: "include",
      headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load ${params.path}: HTTP ${response.status}`)
        return await response.text()
      })
      .then((text) => {
        try {
          setLoadedFile({ spec: JSON.parse(text), loading: false })
        } catch (error) {
          setLoadedFile({
            spec: null,
            loading: false,
            error: error instanceof Error ? error.message : "Dashboard file is not valid JSON",
          })
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setLoadedFile({
          spec: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => controller.abort()
  }, [apiBaseUrl, params?.path, params?.spec, refreshKey, workspaceId])

  const sourceSpec = loadedFile.loading || loadedFile.error ? null : (params?.spec ?? loadedFile.spec ?? sampleBiDashboardSpec)
  const rawSpec = editedSpec ?? sourceSpec

  useEffect(() => {
    setEditedSpec(null)
    setJsonDraft("")
    setJsonError(null)
  }, [params?.path, params?.spec, sourceSpec])

  const parsed = useMemo(() => rawSpec ? parseDashboardSpec(rawSpec) : { spec: null, errors: [] }, [rawSpec])
  const parsedSpec = parsed.spec ?? null
  const queryData = useDashboardQueryData(parsedSpec, apiBaseUrl, workspaceId ?? undefined, refreshKey, jsonQueryIdsForDashboard(parsedSpec))

  if (loadedFile.loading) {
    return <PaneState title="Loading BI dashboard" description={params?.path} />
  }

  if (loadedFile.error) {
    return <PaneState title="Could not load BI dashboard" description={loadedFile.error} />
  }

  const openJsonEditor = () => {
    setJsonDraft(JSON.stringify(rawSpec ?? {}, null, 2))
    setJsonError(null)
    setShowJsonEditor(true)
  }

  const applyJsonDraft = () => {
    try {
      const next = JSON.parse(jsonDraft)
      const nextParsed = parseDashboardSpec(next)
      if (!nextParsed.spec) {
        setJsonError(nextParsed.errors.slice(0, 8).join(" • "))
        return
      }
      setEditedSpec(next)
      setJsonError(null)
      setShowJsonEditor(false)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!parsedSpec && !showJsonEditor) {
    return <PaneState title="Invalid BI dashboard spec" description={parsed.errors.slice(0, 5).join(" • ")} />
  }

  const spec = parsedSpec

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b border-border bg-background/95 px-3 py-2">
        <ToolbarGroup>
          <span className="text-xs font-medium text-muted-foreground">BI dashboard</span>
        </ToolbarGroup>
        <ToolbarGroup className="ml-auto">
          {showJsonEditor ? (
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={applyJsonDraft}
              aria-label="Apply JSON and return to dashboard"
              title="Apply JSON and return to dashboard"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => showJsonEditor ? setShowJsonEditor(false) : openJsonEditor()}
            aria-label={showJsonEditor ? "Show dashboard" : "Show dashboard JSON"}
            title={showJsonEditor ? "Show dashboard" : "Show dashboard JSON"}
          >
            {showJsonEditor ? <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Braces className="h-3.5 w-3.5" strokeWidth={1.75} />}
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            disabled={loadedFile.loading || showJsonEditor}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loadedFile.loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </IconButton>
          {params?.path ? (
            <IconButton
              asChild
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open raw dashboard in new tab"
              title="Open raw dashboard in new tab"
            >
              <a href={`${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </IconButton>
          ) : null}
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background p-4">
        {showJsonEditor ? (
          <DashboardJsonEditor draft={jsonDraft} setDraft={setJsonDraft} error={jsonError} onApply={applyJsonDraft} />
        ) : spec ? (
          <>
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">{spec.title}</h1>
          {spec.description ? <p className="mt-1 text-sm text-muted-foreground">{spec.description}</p> : null}
        </div>

        <div className="min-w-0 space-y-4">
          <DashboardFiltersBar spec={spec} queryData={queryData} controllerValues={controllerValues} setControllerValues={setControllerValues} />
          <BiDashboardRenderProvider value={{ apiBaseUrl, workspaceId: workspaceId ?? undefined, spec, refreshKey, queryData, controllerValues, setControllerValues }}>
            <GeneratedPaneRenderer spec={spec} profile={biDashboardGeneratedPaneProfile} />
          </BiDashboardRenderProvider>
          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground marker:hidden">
              <Database className="h-4 w-4" /> Query manifest
              <span className="ml-auto text-xs text-muted-foreground">debug</span>
            </summary>
            <div className="border-t border-border px-4 py-3">
              <p className="mb-3 text-sm text-muted-foreground">
                The agent should generate this neutral BI dashboard contract; the plugin maps it to data-bridge and Perspective runtime calls.
              </p>
              <pre className="max-h-[420px] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {JSON.stringify({ queries: spec.queries }, null, 2)}
              </pre>
            </div>
          </details>
        </div>
          </>
        ) : (
          <PaneState title="Invalid BI dashboard spec" description={parsed.errors.slice(0, 5).join(" • ")} />
        )}
      </div>
    </div>
  )
}

function DashboardJsonEditor({
  draft,
  setDraft,
  error,
  onApply,
}: {
  draft: string
  setDraft: (value: string) => void
  error: string | null
  onApply: () => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard JSON</h1>
          <p className="text-sm text-muted-foreground">Debug/edit the dashboard spec locally, then click the check icon to apply and return to the dashboard.</p>
        </div>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <Check className="h-3.5 w-3.5" /> Apply JSON
        </button>
      </div>
      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        className="min-h-[70vh] flex-1 resize-none overflow-auto font-mono text-xs leading-relaxed"
      />
    </div>
  )
}

function PaneState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
      <EmptyState title={title} description={description} />
    </div>
  )
}

function jsonQueryIdsForDashboard(spec: BslDashboardSpec | null): string[] {
  if (!spec) return []
  const ids = new Set<string>()
  for (const element of Object.values(spec.elements)) {
    if (element.type === "BSLMetric") ids.add(String(element.props.queryId))
    if (element.type === "BSLChart") ids.add(String(element.props.queryId))
    if (element.type === "BSLFilter") {
      for (const queryId of element.props.targetQueries) ids.add(String(queryId))
    }
  }
  return [...ids]
}

function DashboardFiltersBar({
  spec,
  queryData,
  controllerValues,
  setControllerValues,
}: {
  spec: BslDashboardSpec
  queryData: Record<string, DashboardQueryResult>
  controllerValues: Record<string, string>
  setControllerValues: (updater: (previous: Record<string, string>) => Record<string, string>) => void
}) {
  const filters = Object.values(spec.elements).filter((element) => element.type === "BSLFilter")
  if (filters.length === 0) return null
  return (
    <Card className="min-w-0 border-primary/20 bg-card/95 shadow-sm">
      <CardContent className="flex min-w-0 flex-wrap items-end gap-3 p-3">
        <div className="mr-1 flex min-w-[140px] items-center gap-2 pb-2 text-sm font-medium text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Controls
        </div>
        {filters.map((element) => {
          const props = element.props
          const id = String(props.id)
          const field = String(props.field)
          const targets = props.targetQueries as string[]
          const options = [...new Set(targets.flatMap((queryId) => queryData[queryId]?.rows.map((row) => row[field]).filter((value) => value != null).map(String) ?? []))].sort((a, b) => a.localeCompare(b))
          return (
            <label key={id} className="min-w-[180px] flex-1 text-xs font-medium text-muted-foreground sm:max-w-[260px]">
              <span className="mb-1 block truncate">{String(props.label ?? props.field)}</span>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm font-normal text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring/40"
                value={controllerValues[id] ?? "__all"}
                onChange={(event) => setControllerValues((previous) => ({ ...previous, [id]: event.target.value }))}
              >
                <option value="__all">All {field}</option>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )
        })}
      </CardContent>
    </Card>
  )
}
