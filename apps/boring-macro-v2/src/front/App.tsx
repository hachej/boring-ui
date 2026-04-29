import {
  WorkspaceProvider,
  ChatCenteredShell,
  EmptyPane,
  definePanel,
  type PanelConfig,
} from "@boring/workspace"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "@boring/workspace/testing"
import { makeMacroClientPlugin, macroChatSuggestions } from "../plugin"
import { openSeriesPane } from "./macroSeriesUi"

const sessionsStore = createLocalStorageSessions({ storageKey: "boring-macro:sessions" })

const emptyPanel = definePanel({
  id: "empty",
  title: "Welcome",
  component: EmptyPane,
  placement: "center",
  source: "app",
}) as PanelConfig

function Shell() {
  const { sessions, activeId } = useLocalStorageSessions(sessionsStore)

  return (
    <ChatCenteredShell
      appTitle="boring.macro"
      sessions={sessions}
      activeSessionId={activeId}
      onSwitchSession={sessionsStore.switchTo}
      onCreateSession={sessionsStore.create}
      onDeleteSession={sessionsStore.remove}
      chatSuggestions={macroChatSuggestions}
      emptyTitle="What macro question are we tackling?"
      emptyDescription="Search FRED, plot a series, derive a transform, or draft a briefing deck."
      storageKey="boring-macro:shell"
    />
  )
}

const macroPlugin = makeMacroClientPlugin((row) => openSeriesPane(row.id))

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        plugins={[macroPlugin]}
        panels={[emptyPanel]}
        apiBaseUrl=""
        apiTimeout={10000}
        persistenceEnabled
        storageKey="boring-macro:layout"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
