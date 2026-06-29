import * as React from "react"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ChatPanel, useSessions as useAgentSessions } from "@hachej/boring-agent"
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

function shareTokenFromCliUrl(pathname: string): string | null {
  const match = pathname.match(/^\/share\/([^/?#]+)\/editor\/?$/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function PublicShareMarkdownEditor({ token }: { token: string }) {
  const [content, setContent] = useState<string>("")
  const [savedContent, setSavedContent] = useState<string>("")
  const [entryPath, setEntryPath] = useState<string>("review.md")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/share/${encodeURIComponent(token)}/meta`).then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return await res.json() as { entryPath?: string }
      }),
      fetch(`/share/${encodeURIComponent(token)}/raw`).then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return await res.text()
      }),
    ])
      .then(([meta, text]) => {
        if (cancelled) return
        setEntryPath(meta.entryPath ?? "review.md")
        setContent(text)
        setSavedContent(text)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [token])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/share/${encodeURIComponent(token)}/raw`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content }).toString(),
        redirect: "manual",
      })
      if (res.status !== 303 && !res.ok) throw new Error(await res.text())
      setSavedContent(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save document")
    } finally {
      setSaving(false)
    }
  }, [content, token])

  const dirty = content !== savedContent

  useEffect(() => {
    if (loading || !dirty || saving) return
    const timer = window.setTimeout(() => {
      void save()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [dirty, loading, save, saving])

  return (
    <WorkspaceSingleton.WorkspaceFilesProvider apiBaseUrl={`/share/${encodeURIComponent(token)}`}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Public Markdown review</div>
            <div className="text-xs text-muted-foreground">Rich editor POC · constrained share API</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {saving ? <span className="text-muted-foreground">Saving…</span> : dirty ? <span className="text-amber-600">Unsaved changes</span> : <span className="text-muted-foreground">Saved</span>}
            <a className="rounded-md border border-border px-3 py-1.5" href={`/share/${encodeURIComponent(token)}/bundle.zip`}>Download ZIP</a>
            <a className="rounded-md border border-border px-3 py-1.5" href={`/share/${encodeURIComponent(token)}/portable.md`}>Portable MD</a>
            <button className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" onClick={save} disabled={saving || loading || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </header>
        {error ? <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        {loading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading document…</div>
        ) : (
          <div className="mx-auto max-w-5xl p-4">
            <div style={{ height: "calc(100vh - 96px)" }}>
              <WorkspaceSingleton.MarkdownEditor content={content} onChange={setContent} documentPath={entryPath} className="h-full overflow-hidden rounded-xl border border-border" />
            </div>
          </div>
        )}
      </div>
    </WorkspaceSingleton.WorkspaceFilesProvider>
  )
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
  const shareToken = shareTokenFromCliUrl(window.location.pathname)
  if (shareToken) return <PublicShareMarkdownEditor token={shareToken} />

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

  const useUrlAgentSessions = useCallback((opts: Parameters<typeof useAgentSessions>[0]): ReturnType<typeof useAgentSessions> => {
    const nextOpts = {
      ...opts,
      initialActiveSessionId: urlSessionId ?? undefined,
    } as Parameters<typeof useAgentSessions>[0]
    return useAgentSessions(nextOpts)
  }, [urlSessionId])

  const handleActiveSessionIdChange = useCallback((sessionId: string | null) => {
    setUrlSessionId((current) => current === sessionId ? current : sessionId)
  }, [])

  const plugins = useMemo(() => [], [])
  const activeWorkspaceRequestHeaders = useMemo(
    () => activeWorkspaceId ? { "x-boring-workspace-id": activeWorkspaceId } : null,
    [activeWorkspaceId],
  )

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

    const requestHeaders = activeWorkspaceRequestHeaders ?? { "x-boring-workspace-id": activeWorkspace.id }

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
        useSessions={useUrlAgentSessions}
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
      chatPanel={ChatPanel}
      workspaceId={projectName}
      plugins={plugins}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={`boring-ui-v2:layout:${projectName}`}
      appTitle={projectName}
      defaultSessionTitle={projectName}
      useSessions={useUrlAgentSessions}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      chatParams={{ thinkingControl: true }}
      frontPluginHotReload={runtimePluginFrontLoadingEnabled ? "vite" : false}
      topBarRight={<CliVersionBadge version={cliVersion} />}
    />
  )
}
