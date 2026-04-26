import { WorkspaceProvider, ChatCenteredShell, CodeEditorPane, EmptyPane, type PanelConfig } from "@boring/workspace"
import { useSessions } from "./sessions"

const panels: PanelConfig[] = [
  { id: "code-editor", title: "Editor", component: CodeEditorPane as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "empty", title: "Welcome", component: EmptyPane as React.ComponentType<unknown>, placement: "center", source: "app" },
]

export function ChatApp() {
  const { sessions, activeId, switchTo, create, remove } = useSessions()
  return (
    <WorkspaceProvider panels={panels} apiBaseUrl="" persistenceEnabled={false} storageKey="boring-chat:layout">
      <ChatCenteredShell appTitle="Chat" sessions={sessions} activeSessionId={activeId}
        onSwitchSession={switchTo} onCreateSession={create} onDeleteSession={remove} />
    </WorkspaceProvider>
  )
}
