import { useCallback, useMemo } from "react"
import { ChatPanel } from "@boring/agent"
import { WorkspaceAgentFront } from "@boring/workspace/app/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { playgroundDataCatalogPlugin } from "../plugins/playgroundDataCatalog"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

export function WorkspaceShell() {
  const showcase = useMemo(isShowcaseRoute, [])
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

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  return (
    <WorkspaceAgentFront
      chatPanel={ChatPanel}
      workspaceId="playground"
      plugins={[playgroundDataCatalogPlugin]}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey="boring-ui-v2:layout:playground"
      appTitle="Boring"
      sessions={sessions}
      activeSessionId={showcase ? SHOWCASE_SESSION_ID : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      chatParams={{ thinkingControl: true }}
    />
  )
}
