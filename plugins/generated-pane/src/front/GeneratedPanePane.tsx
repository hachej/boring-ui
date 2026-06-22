import { useEffect, useState } from "react"
import { EmptyState, Toolbar, ToolbarGroup, Badge } from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { parseGeneratedPaneSpec, type GeneratedPaneSpec } from "../shared"
import { GeneratedPaneRenderer, type GeneratedPaneProfile } from "./catalog"

export interface GeneratedPanePaneParams {
  path?: string
  spec?: GeneratedPaneSpec
}

interface LoadedPaneFile {
  spec: unknown
  error?: string
  loading: boolean
}

export function GeneratedPanePane({ params, profile }: PaneProps<GeneratedPanePaneParams> & { profile?: GeneratedPaneProfile }) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const [loadedFile, setLoadedFile] = useState<LoadedPaneFile>({ spec: null, loading: false })

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
      .then((text) => setLoadedFile({ spec: JSON.parse(text), loading: false }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setLoadedFile({ spec: null, loading: false, error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [apiBaseUrl, params?.path, params?.spec, workspaceId])

  if (loadedFile.loading) return <PaneState title="Loading generated pane" description={params?.path} />
  if (loadedFile.error) return <PaneState title="Could not load generated pane" description={loadedFile.error} />

  const parsed = parseGeneratedPaneSpec(params?.spec ?? loadedFile.spec)
  if (!parsed.spec) return <PaneState title="Invalid generated pane spec" description={parsed.errors.slice(0, 5).join(" • ")} />

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b border-border px-3 py-2">
        <ToolbarGroup>
          <Badge variant="secondary">Generated Pane</Badge>
          {parsed.spec.profile ? <Badge variant="outline">{parsed.spec.profile}</Badge> : null}
        </ToolbarGroup>
      </Toolbar>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {parsed.spec.title ? <h1 className="mb-1 text-2xl font-semibold tracking-tight">{parsed.spec.title}</h1> : null}
        {parsed.spec.description ? <p className="mb-4 text-sm text-muted-foreground">{parsed.spec.description}</p> : null}
        <GeneratedPaneRenderer spec={parsed.spec} profile={profile} />
      </div>
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
