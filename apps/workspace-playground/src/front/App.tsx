import { useCallback, useEffect, useMemo, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { FileTreePane, WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { definePlugin, type WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"
import { diagramPlugin } from "@hachej/boring-diagram/front"
import { createTasksPlugin } from "@hachej/boring-tasks/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function isFullPageRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/full-page" || window.location.pathname === "/full-page/"
}

function isMultiFilesystemPlaygroundRoute(): boolean {
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PLAYGROUND_MULTI_FS === "1"
}

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
  nativeSessionStartEnabled?: boolean
}

const playgroundDeckWidgets: DeckWidgetDefinition[] = [
  {
    name: "PlaygroundBadge",
    display: "inline",
    render: ({ attrs }) => (
      <span className="inline-flex rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
        {attrs.text ?? "badge"}
      </span>
    ),
  },
]

const playgroundDeckPlugin = createDeckPlugin({
  widgets: playgroundDeckWidgets,
  theme: {
    className: "workspace-playground-deck",
    slideClassName: "workspace-playground-deck-slide",
  },
})

function MultiFilesystemFileTreeSource(props: WorkspaceSourceProps) {
  return (
    <FileTreePane
      {...props}
      params={{
        ...(props.params as Record<string, unknown> | undefined),
        chromeless: false,
        roots: [
          {
            filesystem: "user",
            label: "Workspace",
            rootDir: ".",
            access: "readwrite",
            searchPlaceholder: "Search workspace files...",
          },
          {
            filesystem: "company_context",
            label: "Company",
            rootDir: "/",
            access: "readonly",
            searchPlaceholder: "Filter company files...",
          },
        ],
      } as Parameters<typeof FileTreePane>[0]["params"]}
    />
  )
}

const multiFilesystemPlaygroundPlugin = definePlugin({
  id: "workspace-playground-multi-fs",
  label: "Workspace playground multi-filesystem fixtures",
  workspaceSources: [
    {
      id: "files",
      label: "Files",
      source: "app",
      component: MultiFilesystemFileTreeSource,
    },
  ],
})

const askUserPlugin = createAskUserPlugin({ appLeftInbox: true })
const tasksPlugin = createTasksPlugin()
const workspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin]
const multiFilesystemWorkspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin, multiFilesystemPlaygroundPlugin]
const externalPluginsEnabled = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_BORING_EXTERNAL_PLUGINS === "1"

function resetPlaygroundStorageIfRequested(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  if (params.get("fresh") !== "1") return
  const prefixes = [
    "boring-ui-v2:layout:playground",
    "boring-workspace:",
    "boring-agent:",
  ]
  for (const key of Object.keys(window.localStorage)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key)
    }
  }
  params.delete("fresh")
  const nextSearch = params.toString()
  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`)
}

function WorkspaceFullPageShell() {
  const parsed = parseFullPagePanelLocation(window.location.search)

  if (!parsed.componentId || parsed.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground">
          <div className="font-medium">Invalid full-page panel route</div>
          <div className="mt-1 text-muted-foreground">
            {parsed.error?.message ?? "Missing full-page panel component."}
          </div>
        </div>
      </div>
    )
  }

  return (
    <WorkspaceProvider
      apiBaseUrl=""
      plugins={workspacePlugins}
      persistenceEnabled
      manageDocumentTitle={false}
      workspaceId="playground-full-page"
      fullPageBasePath="/full-page"
    >
      <WorkspaceFullPagePanel componentId={parsed.componentId} params={parsed.params} />
    </WorkspaceProvider>
  )
}

export function WorkspaceShell() {
  resetPlaygroundStorageIfRequested()
  const showcase = useMemo(isShowcaseRoute, [])
  const fullPage = useMemo(isFullPageRoute, [])
  const multiFilesystem = useMemo(isMultiFilesystemPlaygroundRoute, [])
  const activeWorkspacePlugins = multiFilesystem ? multiFilesystemWorkspacePlugins : workspacePlugins
  const [projectName, setProjectName] = useState("Workspace")
  const [workspaceId, setWorkspaceId] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(showcase || fullPage)
  const [nativeSessionStartEnabled, setNativeSessionStartEnabled] = useState(false)

  const sessions = useMemo(
    () =>
      showcase
        ? [
            {
              id: SHOWCASE_SESSION_ID,
              title: "Showcase conversation",
              updatedAt: Date.now(),
            },
          ]
        : undefined,
    [showcase],
  )
  const handleActiveSessionIdChange = useCallback(
    (sessionId: string | null) => {
      if (showcase && sessionId) seedShowcase(sessionId)
    },
    [showcase],
  )

  useEffect(() => {
    if (showcase || fullPage) return
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => res.ok ? await res.json() as WorkspaceMeta : null)
      .then((meta) => {
        if (cancelled) return
        const next = meta?.projectName?.trim()
        const nextWorkspaceId = meta?.workspaceId?.trim() || next
        if (next) {
          setProjectName(next)
        }
        if (nextWorkspaceId) {
          setWorkspaceId(nextWorkspaceId)
        }
        setNativeSessionStartEnabled(meta?.nativeSessionStartEnabled === true)
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaLoaded(true)
      })
    return () => { cancelled = true }
  }, [showcase, fullPage])

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  if (fullPage) {
    return <WorkspaceFullPageShell />
  }

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  return (
    <WorkspaceAgentFront
      workspaceId={showcase ? "playground" : workspaceId}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={showcase ? "boring-ui-v2:layout:playground" : `boring-ui-v2:layout:playground:${multiFilesystem ? "multi-fs:" : ""}${workspaceId}`}
      appTitle={showcase ? "Boring" : projectName}
      workspaceLabel={showcase ? undefined : projectName}
      workspaceLayout={multiFilesystem ? "classic" : "plugin-tabs"}
      defaultSessionTitle="New chat"
      externalPlugins={externalPluginsEnabled}
      frontPluginHotReload={externalPluginsEnabled ? "vite" : undefined}
      fullPageBasePath="/full-page"
      provisionWorkspace={!showcase}
      nativeSessionStartEnabled={nativeSessionStartEnabled}
      sessions={sessions}
      activeSessionId={showcase ? SHOWCASE_SESSION_ID : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      plugins={activeWorkspacePlugins}
      chatParams={{ thinkingControl: true }}
    />
  )
}
