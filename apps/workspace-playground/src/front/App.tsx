import { useCallback, useEffect, useMemo, useState } from "react"
import { ChatPanel, useSessions as useAgentSessions } from "@hachej/boring-agent"
import { WorkspaceAgentFront } from "@hachej/boring-workspace/app/front"
import { askUserPlugin } from "../../../../packages/workspace/src/plugins/askUserPlugin/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { playgroundDataCatalogPlugin } from "../plugins/playgroundDataCatalog/front"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

interface WorkspaceMeta {
  projectName?: string
}

export function WorkspaceShell() {
  const showcase = useMemo(isShowcaseRoute, [])
  const [projectName, setProjectName] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(showcase)

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
    (sessionId: string) => {
      if (showcase) seedShowcase(sessionId)
    },
    [showcase],
  )

  useEffect(() => {
    if (showcase) return
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
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaLoaded(true)
      })
    return () => { cancelled = true }
  }, [showcase])

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  return (
    <WorkspaceAgentFront
      chatPanel={ChatPanel}
      workspaceId={showcase ? "playground" : projectName}
      plugins={[playgroundDataCatalogPlugin, askUserPlugin]}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={`boring-ui-v2:layout:${showcase ? "playground" : projectName}`}
      appTitle={showcase ? "Boring" : projectName}
      defaultSessionTitle={showcase ? "New session" : projectName}
      useSessions={showcase ? undefined : useAgentSessions}
      sessions={sessions}
      activeSessionId={showcase ? SHOWCASE_SESSION_ID : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      chatParams={{ thinkingControl: true }}
    />
  )
}
