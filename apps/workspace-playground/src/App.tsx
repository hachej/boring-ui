import { useEffect, useMemo } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  CodeEditorPane,
  EmptyPane,
  defaultEditorPanels,
  definePanel,
  type PanelConfig,
} from "@boring/workspace"
import { createMockSessions, useMockSessions } from "@boring/workspace/testing"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

// ----- Panel registry -----

type PlaygroundPanelConfig = PanelConfig<any>

const panels: PlaygroundPanelConfig[] = [
  ...defaultEditorPanels,
  definePanel<{ path: string }>({
    id: "csv-viewer",
    title: "CSV",
    component: CodeEditorPane,
    placement: "center",
    source: "app",
  }),
  definePanel({
    id: "empty",
    title: "Welcome",
    component: EmptyPane,
    placement: "center",
    source: "app",
  }),
]

const MODEL_STORAGE_KEY = "boring-agent:composer:model"
const INFOMANIAK_TOOL_MODEL = {
  provider: "infomaniak",
  id: "Qwen/Qwen3.5-122B-A10B-FP8",
}

function preferInfomaniakDefaultModel(): void {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY)
    if (!raw || raw.includes("anthropic") || raw.includes("moonshotai/Kimi-K2.6")) {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(INFOMANIAK_TOOL_MODEL))
    }
  } catch { /* storage unavailable */ }
}

const sessionsStore = createMockSessions()

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function Shell() {
  preferInfomaniakDefaultModel()
  const { sessions, activeId } = useMockSessions(sessionsStore)
  const showcase = useMemo(isShowcaseRoute, [])

  useEffect(() => {
    if (!showcase) return
    seedShowcase()
    if (sessionsStore.getState().activeId !== SHOWCASE_SESSION_ID) {
      sessionsStore.switchTo(SHOWCASE_SESSION_ID)
    }
  }, [showcase])

  const sessionList = useMemo(() => {
    if (!showcase) return sessions
    if (sessions.some((s) => s.id === SHOWCASE_SESSION_ID)) return sessions
    return [
      { id: SHOWCASE_SESSION_ID, title: "Showcase conversation", updatedAt: Date.now() },
      ...sessions,
    ]
  }, [showcase, sessions])

  const debugMode = new URLSearchParams(globalThis.location?.search).get('debug') === '1'

  return (
    <ChatCenteredShell
      appTitle="Boring"
      sessions={sessionList}
      activeSessionId={activeId}
      onSwitchSession={sessionsStore.switchTo}
      onCreateSession={sessionsStore.create}
      onDeleteSession={sessionsStore.remove}
      thinkingControl
      debug={debugMode}
    />
  )
}

export function WorkspaceShell() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled
        storageKey="boring-ui-v2:layout:playground"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
