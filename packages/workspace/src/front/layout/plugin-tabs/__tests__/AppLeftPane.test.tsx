import { useEffect } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"

vi.mock("../../../lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

import { AppLeftPane } from "../AppLeftPane"

const sessions = [
  { id: "s1", title: "First session" },
  { id: "s2", title: "Second session" },
]

function renderPane() {
  return render(
    <WorkspaceAttentionProvider>
      <AppLeftPane
        appTitle="Test"
        sessions={sessions}
        activeSessionId="s1"
        openSessionIds={["s1"]}
        pinnedSessionIds={[]}
        onCreateSession={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onSwitchSession={vi.fn()}
        onOpenSessionAsPane={vi.fn()}
        onToggleSessionPinned={vi.fn()}
      />
    </WorkspaceAttentionProvider>,
  )
}

describe("AppLeftPane", () => {
  it("shows working state beside session names", () => {
    renderPane()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
  })

  it("calls onSwitchSession when reselecting the active session", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByText("First session"))
    expect(onSwitchSession).toHaveBeenCalledWith("s1")
  })

  it("keeps the status badge area clickable for switching sessions", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge?.closest('[data-boring-workspace-part="app-session-row"]') as Element)
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
  })

  it("uses live active-project sessions instead of stale previews and preserves rename metadata", () => {
    const onRenameSession = vi.fn().mockResolvedValue(undefined)
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          layoutMode="multi-project"
          activeProjectId="project-a"
          sessions={[{ id: "native-1", title: "Live adopted native", nativeSessionId: "native-1", hasAssistantReply: true }]}
          activeSessionId="native-1"
          openSessionIds={["native-1"]}
          pinnedSessionIds={[]}
          projects={[
            { id: "project-a", name: "Project Alpha", sessions: [{ id: "stale-1", title: "Stale preview" }] },
            { id: "project-b", name: "Project Beta", sessions: [{ id: "preview-b", title: "Beta preview" }] },
          ]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
          onRenameSession={onRenameSession}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Live adopted native")).toBeInTheDocument()
    expect(screen.queryByText("Stale preview")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expand Project Beta" }))
    expect(screen.getByText("Beta preview")).toBeInTheDocument()
    expect(screen.queryByLabelText("Open Beta preview in new chat pane")).not.toBeInTheDocument()
    fireEvent.pointerDown(screen.getByLabelText("More options for Beta preview"), { button: 0, ctrlKey: false })
    expect(screen.getByText("Copy session ID")).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.pointerDown(screen.getByLabelText("More options for Live adopted native"), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByText("Rename"))
    const input = screen.getByLabelText("Rename session")
    fireEvent.change(input, { target: { value: "Renamed" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onRenameSession).toHaveBeenCalledWith("native-1", "Renamed")
  })

  it("shows question state beside session names", () => {
    function BlockSession() {
      const { addBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({
          id: "ask:s2",
          reason: "ask-user.question",
          sessionId: "s2",
          sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
        })
      }, [addBlocker])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession />
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const badge = document.querySelector('[data-boring-badge="question"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
    expect(screen.getByText("question")).toBeInTheDocument()
  })
})
