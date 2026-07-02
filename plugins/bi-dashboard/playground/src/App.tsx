import { useEffect, useState } from "react"
import { WorkspaceAgentFront } from "@hachej/boring-workspace/app/front"
import { biDashboardPlugin } from "../../src/front"

const PLAYGROUND_WORKSPACE_ID = "default"

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
}

function resetPlaygroundStorageIfRequested(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  if (params.get("fresh") !== "1") return
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("boring-ui-v2:layout:bi-dashboard-playground") || key.startsWith("boring-workspace:") || key.startsWith("boring-agent:")) {
      window.localStorage.removeItem(key)
    }
  }
  params.delete("fresh")
  const nextSearch = params.toString()
  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`)
}

export function PlaygroundApp() {
  resetPlaygroundStorageIfRequested()
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => res.ok ? await res.json() as WorkspaceMeta : { projectName: "BI Dashboard", workspaceId: "default" })
      .then((next) => {
        if (!cancelled) setMeta(next)
      })
      .catch(() => {
        if (!cancelled) setMeta({ projectName: "BI Dashboard", workspaceId: "default" })
      })
    return () => { cancelled = true }
  }, [])

  if (!meta) return <div className="h-screen w-screen bg-background" />

  return (
    <WorkspaceAgentFront
      workspaceId={PLAYGROUND_WORKSPACE_ID}
      apiBaseUrl=""
      appTitle={meta.projectName ?? "BI Dashboard"}
      workspaceLabel={meta.projectName ?? "BI Dashboard"}
      workspaceLayout="plugin-tabs"
      defaultSessionTitle="BI dashboard test"
      providerStorageKey="boring-ui-v2:layout:bi-dashboard-playground"
      persistenceEnabled
      provisionWorkspace
      externalPlugins={false}
      plugins={[biDashboardPlugin]}
      chatParams={{ thinkingControl: true }}
    />
  )
}
