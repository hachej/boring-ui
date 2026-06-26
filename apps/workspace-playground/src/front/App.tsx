import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { askUserPlugin } from "@hachej/boring-ask-user/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { standaloneTestPlugin } from "./standaloneTestPlugin"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

/** ?projects=1 (multi) | ?projects=single (single-workspace degrade). */
export function projectsPreviewMode(): "multi" | "single" | null {
  if (typeof window === "undefined") return null
  const value = new URLSearchParams(window.location.search).get("projects")
  if (value === "single") return "single"
  if (value === "1" || value === "multi") return "multi"
  return null
}

function isFullPageRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/full-page" || window.location.pathname === "/full-page/"
}

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
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

const workspacePlugins = [askUserPlugin, playgroundDeckPlugin, standaloneTestPlugin]
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
  const [projectName, setProjectName] = useState("Workspace")
  const [workspaceId, setWorkspaceId] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(showcase || fullPage)

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

  const openStandalonePrototype = useCallback(async () => {
    await fetch("/api/v1/ui/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "openPanel",
        params: {
          id: "standalone-test",
          component: "standalone-test.main",
          title: "Standalone Test",
          params: { message: "auto-open prototype", count: 1, color: "bg-blue-50" },
        },
      }),
    })
  }, [])
  const standaloneAutoOpenedRef = useRef(false)

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
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaLoaded(true)
      })
    return () => { cancelled = true }
  }, [showcase, fullPage])

  useEffect(() => {
    if (showcase || fullPage || !metaLoaded || standaloneAutoOpenedRef.current) return
    standaloneAutoOpenedRef.current = true
    const timer = window.setTimeout(() => { void openStandalonePrototype() }, 1000)
    return () => window.clearTimeout(timer)
  }, [fullPage, metaLoaded, openStandalonePrototype, showcase])

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
      debug={false}
      providerStorageKey={showcase ? "boring-ui-v2:layout:playground" : `boring-ui-v2:layout:playground:${workspaceId}`}
      appTitle={showcase ? "Boring" : projectName}
      workspaceLabel={showcase ? undefined : projectName}
      defaultSessionTitle={showcase ? "New session" : projectName}
      defaultNavOpen={false}
      defaultSurfaceOpen
      defaultWorkbenchLeftOpen
      externalPlugins={externalPluginsEnabled}
      frontPluginHotReload={externalPluginsEnabled ? "vite" : undefined}
      fullPageBasePath="/full-page"
      provisionWorkspace={!showcase}
      sessions={sessions}
      activeSessionId={showcase ? SHOWCASE_SESSION_ID : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      plugins={workspacePlugins}
      chatParams={{ thinkingControl: true }}
    />
  )
}
