import { useCallback, useEffect, useMemo, useState } from "react"
import { ChatPanel, useSessions as useAgentSessions } from "@hachej/boring-agent"
import { WorkspaceAgentFront } from "@hachej/boring-workspace/app/front"
import { WorkspaceSwitcherControl } from "./WorkspaceSwitcherControl"

interface WorkspaceMeta {
  projectName?: string
  workspacesMode?: boolean
  version?: string
}

interface LocalWorkspace {
  id: string
  name: string
  path: string
  available: boolean
}

export function workspaceIdFromCliUrl(pathname: string): string | null {
  const match = pathname.match(/^\/workspace\/([^/?#]+)/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function cliWorkspacePath(workspaceId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}`
}

function syncCliWorkspaceUrl(workspaceId: string): void {
  const nextPath = cliWorkspacePath(workspaceId)
  if (window.location.pathname === nextPath) return
  window.history.replaceState(null, "", nextPath)
}

function areWorkspacesEqual(a: LocalWorkspace[], b: LocalWorkspace[]): boolean {
  if (a.length !== b.length) return false
  return a.every((workspace, index) => {
    const other = b[index]
    return other
      && workspace.id === other.id
      && workspace.name === other.name
      && workspace.path === other.path
      && workspace.available === other.available
  })
}

export function CliVersionBadge({ version }: { version?: string | null }) {
  const label = version?.trim()
  if (!label) return null
  return (
    <span
      aria-label={`Boring UI CLI version ${label}`}
      title={`Boring UI CLI ${label}`}
      className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight text-muted-foreground"
    >
      v{label}
    </span>
  )
}

export function CliWorkspaceShell() {
  const [projectName, setProjectName] = useState("Workspace")
  const [workspacesMode, setWorkspacesMode] = useState(false)
  const [cliVersion, setCliVersion] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [metaLoaded, setMetaLoaded] = useState(false)

  const refreshWorkspaces = useCallback(() => {
    void fetch("/api/v1/local-workspaces")
      .then(async (res) => res.ok ? await res.json() as { workspaces: LocalWorkspace[] } : { workspaces: [] })
      .then((data) => {
        const next = data.workspaces ?? []
        setWorkspaces((current) => areWorkspacesEqual(current, next) ? current : next)
        setActiveWorkspaceId((current) => {
          const urlWorkspaceId = workspaceIdFromCliUrl(window.location.pathname)
          const stored = window.localStorage.getItem("boring-ui:local-workspace-id")
          const preferred = current ?? urlWorkspaceId ?? stored
          const availablePreferred = preferred ? next.find((workspace) => workspace.id === preferred && workspace.available) : null
          const selected = availablePreferred ?? next.find((workspace) => workspace.available) ?? null
          if (selected) window.localStorage.setItem("boring-ui:local-workspace-id", selected.id)
          return selected?.id ?? null
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => res.ok ? await res.json() as WorkspaceMeta : null)
      .then((meta) => {
        if (cancelled) return
        const next = meta?.projectName?.trim()
        if (next) {
          setProjectName(next)
          document.title = next
        }
        const version = meta?.version?.trim()
        if (version) setCliVersion(version)
        const isWorkspacesMode = meta?.workspacesMode === true
        setWorkspacesMode(isWorkspacesMode)
        if (isWorkspacesMode) refreshWorkspaces()
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaLoaded(true)
      })
    return () => { cancelled = true }
  }, [refreshWorkspaces])

  useEffect(() => {
    if (!workspacesMode) return
    const onFocus = () => refreshWorkspaces()
    const onPopState = () => {
      setActiveWorkspaceId(workspaceIdFromCliUrl(window.location.pathname))
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("popstate", onPopState)
    }
  }, [refreshWorkspaces, workspacesMode])

  useEffect(() => {
    if (!workspacesMode || !activeWorkspaceId) return
    syncCliWorkspaceUrl(activeWorkspaceId)
  }, [activeWorkspaceId, workspacesMode])

  const plugins = useMemo(() => [], [])

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  if (workspacesMode) {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId && workspace.available) ?? null
    if (!activeWorkspace) {
      const hasUnavailableWorkspaces = workspaces.length > 0
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
          <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">
              {hasUnavailableWorkspaces ? "No available local workspaces" : "No local workspaces"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasUnavailableWorkspaces
                ? "Registered workspace folders are missing or not directories. Restore one of the folders, then focus or refresh this page."
                : <>Add one with <code>boring-ui workspaces add /path/to/project</code>, then refresh this page.</>}
            </p>
          </div>
        </div>
      )
    }

    const requestHeaders = { "x-boring-workspace-id": activeWorkspace.id }

    return (
      <WorkspaceAgentFront
        key={activeWorkspace.id}
        chatPanel={ChatPanel}
        workspaceId={activeWorkspace.id}
        requestHeaders={requestHeaders}
        authHeaders={requestHeaders}
        plugins={plugins}
        apiBaseUrl=""
        persistenceEnabled
        providerStorageKey={`boring-ui-v2:layout:${activeWorkspace.id}`}
        appTitle="Boring UI"
        defaultSessionTitle={activeWorkspace.name}
        useSessions={useAgentSessions}
        chatParams={{ thinkingControl: true }}
        frontPluginHotReload={false}
        topBarRight={<CliVersionBadge version={cliVersion} />}
        topBarLeft={
          <WorkspaceSwitcherControl
            appTitle="Boring UI"
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace.id}
            createLabel="Add local folder"
            createDescription="Use `boring-ui workspaces add /path`"
            settingsDescription={activeWorkspace.path}
            onSelectWorkspace={(workspaceId) => {
              window.localStorage.setItem("boring-ui:local-workspace-id", workspaceId)
              setActiveWorkspaceId(workspaceId)
            }}
          />
        }
      />
    )
  }

  return (
    <WorkspaceAgentFront
      chatPanel={ChatPanel}
      workspaceId={projectName}
      plugins={plugins}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={`boring-ui-v2:layout:${projectName}`}
      appTitle={projectName}
      defaultSessionTitle={projectName}
      useSessions={useAgentSessions}
      chatParams={{ thinkingControl: true }}
      frontPluginHotReload={false}
      topBarRight={<CliVersionBadge version={cliVersion} />}
    />
  )
}
