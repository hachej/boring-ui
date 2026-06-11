import * as React from "react"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import { useCallback, useEffect, useMemo, useState } from "react"
import { askUserPlugin } from "@hachej/boring-ask-user/front"
import * as WorkspaceSingleton from "@hachej/boring-workspace"
import * as WorkspaceEventsSingleton from "@hachej/boring-workspace/events"
import * as WorkspacePluginSingleton from "@hachej/boring-workspace/plugin"
import { WorkspaceAgentFront } from "@hachej/boring-workspace/app/front"
import { WorkspaceSwitcherControl } from "./WorkspaceSwitcherControl"

declare global {
  var __BORING_RUNTIME_SINGLETONS__: Record<string, unknown> | undefined
}

globalThis.__BORING_RUNTIME_SINGLETONS__ = {
  ...globalThis.__BORING_RUNTIME_SINGLETONS__,
  react: React,
  "react-dom": ReactDom,
  "react-dom/client": ReactDomClient,
  "react/jsx-dev-runtime": ReactJsxDevRuntime,
  "react/jsx-runtime": ReactJsxRuntime,
  "@hachej/boring-workspace": WorkspaceSingleton,
  "@hachej/boring-workspace/events": WorkspaceEventsSingleton,
  "@hachej/boring-workspace/plugin": WorkspacePluginSingleton,
}

interface WorkspaceMeta {
  projectName?: string
  workspacesMode?: boolean
  version?: string
  runtimePluginFrontLoadingEnabled?: boolean
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

const CHAT_SESSION_QUERY_PARAM = "session"

export function chatSessionIdFromCliUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get(CHAT_SESSION_QUERY_PARAM)
  return raw?.trim() || null
}

export function cliWorkspacePath(workspaceId: string, sessionId?: string | null): string {
  const path = `/workspace/${encodeURIComponent(workspaceId)}`
  if (!sessionId) return path
  const params = new URLSearchParams()
  params.set(CHAT_SESSION_QUERY_PARAM, sessionId)
  return `${path}?${params.toString()}`
}

function syncCliWorkspaceUrl(workspaceId: string, sessionId?: string | null): void {
  const nextPath = cliWorkspacePath(workspaceId, sessionId)
  if (`${window.location.pathname}${window.location.search}` === nextPath) return
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
  const [urlSessionId, setUrlSessionId] = useState<string | null>(() => chatSessionIdFromCliUrl(window.location.search))
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [runtimePluginFrontLoadingEnabled, setRuntimePluginFrontLoadingEnabled] = useState(false)

  const refreshWorkspaces = useCallback(() => {
    void fetch("/api/v1/local-workspaces")
      .then(async (res) => res.ok ? await res.json() as { workspaces: LocalWorkspace[] } : { workspaces: [] })
      .then((data) => {
        const next = data.workspaces ?? []
        setWorkspaces((current) => areWorkspacesEqual(current, next) ? current : next)
        setActiveWorkspaceId((current) => {
          const urlWorkspaceId = workspaceIdFromCliUrl(window.location.pathname)
          const stored = window.localStorage.getItem("boring-ui:local-workspace-id")
          // An explicit /workspace/<id> in the URL is authoritative: keep targeting it
          // even while it is still cold-starting (absent from the list or available:false)
          // instead of silently redirecting to another workspace. A later refresh
          // (on focus) resolves it once the workspace finishes initializing. Falling back
          // here would latch a different workspace into `current` and permanently shadow
          // the URL id, forcing a manual switch to recover.
          if (urlWorkspaceId) {
            if (next.some((workspace) => workspace.id === urlWorkspaceId && workspace.available)) {
              window.localStorage.setItem("boring-ui:local-workspace-id", urlWorkspaceId)
            }
            return urlWorkspaceId
          }
          const preferred = current ?? stored
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
        const runtimePluginsEnabled = meta?.runtimePluginFrontLoadingEnabled === true
        setWorkspacesMode(isWorkspacesMode)
        setRuntimePluginFrontLoadingEnabled(runtimePluginsEnabled)
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
      setUrlSessionId(chatSessionIdFromCliUrl(window.location.search))
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
    syncCliWorkspaceUrl(activeWorkspaceId, urlSessionId)
  }, [activeWorkspaceId, urlSessionId, workspacesMode])

  const handleActiveSessionIdChange = useCallback((sessionId: string | null) => {
    setUrlSessionId((current) => current === sessionId ? current : sessionId)
  }, [])

  // CLI-default plugins are app code: statically imported, composed once.
  // Keep in sync with CLI_DEFAULT_PLUGIN_PACKAGES in server/pluginDiscovery.ts.
  const plugins = useMemo(() => [askUserPlugin], [])
  const activeWorkspaceRequestHeaders = useMemo(
    () => activeWorkspaceId ? { "x-boring-workspace-id": activeWorkspaceId } : null,
    [activeWorkspaceId],
  )

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  if (workspacesMode) {
    const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

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

    const requestHeaders = activeWorkspaceRequestHeaders ?? { "x-boring-workspace-id": activeWorkspace.id }

    return (
      <WorkspaceAgentFront
        key={activeWorkspace.id}
        workspaceId={activeWorkspace.id}
        workspaceLabel={activeWorkspace.name}
        requestHeaders={requestHeaders}
        authHeaders={requestHeaders}
        plugins={plugins}
        apiBaseUrl=""
        persistenceEnabled
        providerStorageKey={`boring-ui-v2:layout:${activeWorkspace.id}`}
        appTitle="Boring UI"
        defaultSessionTitle={activeWorkspace.name}
        activeSessionId={urlSessionId ?? undefined}
        onActiveSessionIdChange={handleActiveSessionIdChange}
        chatParams={{ thinkingControl: true }}
        frontPluginHotReload={runtimePluginFrontLoadingEnabled ? "vite" : false}
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
              setUrlSessionId(null)
              setActiveWorkspaceId(workspaceId)
            }}
          />
        }
      />
    )
  }

  return (
    <WorkspaceAgentFront
      workspaceId={projectName}
      plugins={plugins}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={`boring-ui-v2:layout:${projectName}`}
      appTitle={projectName}
      defaultSessionTitle={projectName}
      activeSessionId={urlSessionId ?? undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      chatParams={{ thinkingControl: true }}
      frontPluginHotReload={runtimePluginFrontLoadingEnabled ? "vite" : false}
      topBarRight={<CliVersionBadge version={cliVersion} />}
    />
  )
}
