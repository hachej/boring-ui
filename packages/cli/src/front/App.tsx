import * as React from "react"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

// Read-only, for backward compatibility with legacy deep links. The workspace
// UI now hosts multiple chat panes at once, so a single ?session= in the URL no
// longer describes the layout — it is consumed once on load to select a session
// (captured into initialSessionId, then stripped from the URL). We never write it back.
export function chatSessionIdFromCliUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get(CHAT_SESSION_QUERY_PARAM)
  return raw?.trim() || null
}

export function cliWorkspacePath(workspaceId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}`
}

function syncCliWorkspaceUrl(workspaceId: string): void {
  const nextPath = cliWorkspacePath(workspaceId)
  if (`${window.location.pathname}${window.location.search}` === nextPath) return
  window.history.replaceState(null, "", nextPath)
}

// Drop a legacy ?session= param from the address bar without touching the path.
// Restoration is owned by WorkspaceAgentFront's persisted chat-pane state; the
// param is honored once (as the initial active session) and then removed so it
// can never go stale or race a hard refresh.
function stripChatSessionParamFromUrl(): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has(CHAT_SESSION_QUERY_PARAM)) return
  params.delete(CHAT_SESSION_QUERY_PARAM)
  const query = params.toString()
  const nextPath = `${window.location.pathname}${query ? `?${query}` : ""}`
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
  // Captured once from a legacy ?session=<id> deep link to seed the initial
  // active session, scoped to the workspace that link pointed at. After this
  // point restoration is driven by WorkspaceAgentFront's persisted chat-pane
  // state, so we never write this back into the URL.
  const [initialSessionId] = useState<string | null>(() => chatSessionIdFromCliUrl(window.location.search))
  const [initialSessionWorkspaceId] = useState<string | null>(() => workspaceIdFromCliUrl(window.location.pathname))
  const [metaLoaded, setMetaLoaded] = useState(false)
  // Tracks whether at least one local-workspaces fetch has *succeeded*. Used to
  // tell "the registry is genuinely empty" (show the add-a-workspace screen)
  // apart from "the first fetch hasn't landed / failed" (keep showing loading
  // and retry) so a transient error never strands the page on the empty state.
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)
  const [runtimePluginFrontLoadingEnabled, setRuntimePluginFrontLoadingEnabled] = useState(false)

  const refreshWorkspacesRef = useRef<(() => void) | null>(null)

  const refreshWorkspaces = useCallback(() => {
    void fetch("/api/v1/local-workspaces")
      .then(async (res) => {
        // A failed fetch (transient 5xx during cold start, network blip, ...) is
        // NOT an authoritative "no workspaces" answer. Throwing here routes it to
        // the catch below, which preserves the current list and schedules a retry
        // instead of latching the empty "No local workspaces" dead-end screen.
        if (!res.ok) throw new Error(`local-workspaces ${res.status}`)
        return await res.json() as { workspaces: LocalWorkspace[] }
      })
      .then((data) => {
        const next = data.workspaces ?? []
        setWorkspacesLoaded(true)
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
      .catch(() => {
        // Leave the existing workspace list untouched and retry shortly so a
        // transient failure can't strand the page on the empty-state screen.
        window.setTimeout(() => refreshWorkspacesRef.current?.(), 1500)
      })
  }, [])

  refreshWorkspacesRef.current = refreshWorkspaces

  const createLocalWorkspace = useCallback(() => {
    const rawPath = window.prompt("Path for the local workspace folder to create or add")
    const path = rawPath?.trim()
    if (!path) return
    const rawName = window.prompt("Workspace name", path.split(/[\\/]+/).filter(Boolean).at(-1) ?? "Workspace")
    const name = rawName?.trim() || undefined
    void fetch("/api/v1/local-workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, name, createIfMissing: true }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({})) as { workspace?: LocalWorkspace; error?: string }
        if (!res.ok || !data.workspace) throw new Error(data.error || `local-workspaces ${res.status}`)
        setWorkspacesLoaded(true)
        setWorkspaces((current) => current.some((workspace) => workspace.id === data.workspace!.id) ? current : [...current, data.workspace!])
        window.localStorage.setItem("boring-ui:local-workspace-id", data.workspace.id)
        setActiveWorkspaceId(data.workspace.id)
        syncCliWorkspaceUrl(data.workspace.id)
        refreshWorkspaces()
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : "Unable to create workspace")
      })
  }, [refreshWorkspaces])

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

  // A legacy deep link may still carry ?session=. We honor it once via
  // initialSessionId, then immediately drop it from the address bar so the URL
  // stays clean and never re-applies a stale session on a later refresh.
  useEffect(() => {
    stripChatSessionParamFromUrl()
  }, [])

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

  // While the targeted workspace is still cold-starting (selected but not yet available),
  // poll the workspace list so it self-heals once initialization finishes — without
  // requiring a manual refresh/focus or a workspace switch. If it never becomes available
  // (e.g. a stale link to a deleted workspace), give up after a bounded number of attempts
  // and fall back to an available workspace instead of polling forever.
  const coldStartAttemptsRef = useRef(0)
  useEffect(() => {
    if (!workspacesMode || !activeWorkspaceId) return
    const ready = workspaces.some((workspace) => workspace.id === activeWorkspaceId && workspace.available)
    if (ready) {
      coldStartAttemptsRef.current = 0
      return
    }
    const timer = window.setInterval(() => {
      coldStartAttemptsRef.current += 1
      if (coldStartAttemptsRef.current > 10) {
        window.clearInterval(timer)
        setActiveWorkspaceId((current) => {
          const fallback = workspaces.find((workspace) => workspace.available)
          if (!fallback) return current
          window.localStorage.setItem("boring-ui:local-workspace-id", fallback.id)
          return fallback.id
        })
        return
      }
      refreshWorkspaces()
    }, 1500)
    return () => window.clearInterval(timer)
  }, [workspacesMode, activeWorkspaceId, workspaces, refreshWorkspaces])

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
      // A URL-targeted workspace that isn't available yet is cold-starting, not missing —
      // show a loading state while the poll above resolves it instead of an error screen.
      if (activeWorkspaceId) {
        return (
          <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
            <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <h1 className="text-lg font-semibold">Loading workspace…</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Preparing <code>{activeWorkspaceId}</code>. This can take a moment on first load.
              </p>
            </div>
          </div>
        )
      }
      // The workspace registry list hasn't successfully loaded yet (first fetch
      // still in flight or transiently failed and retrying). Show a neutral
      // loading state instead of the "No local workspaces" empty state, which
      // would otherwise flash — and previously latch — on a transient error even
      // though the API does return workspaces.
      if (!workspacesLoaded && workspaces.length === 0) {
        return (
          <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
            <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <h1 className="text-lg font-semibold">Loading workspaces…</h1>
            </div>
          </div>
        )
      }
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
                : "Create or add a local workspace folder from this screen."}
            </p>
            <button
              type="button"
              onClick={createLocalWorkspace}
              className="mt-4 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Create or add local folder
            </button>
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
        activeSessionId={
          initialSessionId && activeWorkspace.id === initialSessionWorkspaceId
            ? initialSessionId
            : undefined
        }
        chatParams={{ thinkingControl: true }}
        frontPluginHotReload={runtimePluginFrontLoadingEnabled ? "vite" : false}
        topBarRight={<CliVersionBadge version={cliVersion} />}
        topBarLeft={
          <WorkspaceSwitcherControl
            appTitle="Boring UI"
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace.id}
            createLabel="Create or add local folder"
            createDescription="Create the folder if it does not exist"
            settingsDescription={activeWorkspace.path}
            onCreateWorkspace={createLocalWorkspace}
            onSelectWorkspace={(workspaceId) => {
              window.localStorage.setItem("boring-ui:local-workspace-id", workspaceId)
              setActiveWorkspaceId(workspaceId)
            }}
            getWorkspaceHref={(workspaceId) => cliWorkspacePath(workspaceId)}
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
      activeSessionId={initialSessionId ?? undefined}
      chatParams={{ thinkingControl: true }}
      frontPluginHotReload={runtimePluginFrontLoadingEnabled ? "vite" : false}
      topBarRight={<CliVersionBadge version={cliVersion} />}
    />
  )
}
