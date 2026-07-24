import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import { WORKSPACE_ATTENTION_ACTION_EVENT, WorkspaceProvider, useWorkspaceAttention } from "../../../provider"
import { events } from "../../../events"
import { filesystemEvents } from "../../../../plugins/filesystemPlugin/shared/events"
import type { SurfaceShellApi } from "../../artifact-surface/SurfaceShell"
import { ChatPanelHost } from "../ChatPanelHost"
import type { WorkspaceChatPanelProps } from "../types"

function FakeChatPanel({ onData, onOpenArtifact, composerBlockers, onComposerStop, onComposerBlockerAction }: WorkspaceChatPanelProps) {
  return (
    <div>
      <div data-testid="blocker-count">{composerBlockers?.length ?? 0}</div>
      <button
        type="button"
        onClick={() =>
          onData?.({
            type: "data-file-changed",
            data: {
              op: "edit",
              path: "src/example.ts",
              toolCallId: "tool-1",
            },
          })
        }
      >
        emit data
      </button>
      <button
        type="button"
        onClick={() => onData?.({ type: "file-changed", seq: 7, changeType: "write", path: "/company/pi.ts", filesystem: "company_context" })}
      >
        emit pi file event
      </button>
      <button type="button" onClick={() => onOpenArtifact?.("src/example.ts")}>
        open artifact
      </button>
      <button type="button" onClick={() => onOpenArtifact?.("/company/hr/policy.md", { filesystem: "company_context" })}>
        open company artifact
      </button>
      <button type="button" onClick={() => onComposerStop?.()}>
        stop composer
      </button>
      <button type="button" onClick={() => composerBlockers?.[0] && onComposerBlockerAction?.(composerBlockers[0], "open")}>
        open blocker
      </button>
      <button type="button" onClick={() => composerBlockers?.[0] && onComposerBlockerAction?.(composerBlockers[0], "approve")}>
        custom blocker action
      </button>
    </div>
  )
}

function Blocker({ sessionId = "s1" }: { sessionId?: string }) {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({ id: `test:${sessionId}`, reason: "test", sessionId, label: "Blocked", surfaceKind: "questions", target: "q1", actions: [{ id: "open", label: "Open Questions" }, { id: "approve", label: "Approve" }] })
    return () => removeBlocker(`test:${sessionId}`)
  }, [addBlocker, removeBlocker, sessionId])
  return null
}

describe("ChatPanelHost", () => {
  beforeEach(() => {
    events._reset()
  })

  afterEach(() => {
    events._reset()
  })

  it("composes workspace file-change bridge with caller onData", () => {
    const onData = vi.fn()
    const changed = vi.fn()
    events.on(filesystemEvents.changed, changed)

    render(
      <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
        <ChatPanelHost sessionId="s1" onData={onData} />
      </WorkspaceProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "emit data" }))

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "src/example.ts",
        cause: "agent",
        toolCallId: "tool-1",
      }),
    )
    expect(onData).toHaveBeenCalledWith(
      expect.objectContaining({ type: "data-file-changed" }),
    )
  })

  it("maps Pi file-changed events into the workspace file-change bridge", () => {
    const changed = vi.fn()
    events.on(filesystemEvents.changed, changed)

    render(
      <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
        <ChatPanelHost sessionId="s1" />
      </WorkspaceProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "emit pi file event" }))

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/company/pi.ts",
        filesystem: "company_context",
        cause: "agent",
        toolCallId: "pi:7",
      }),
    )
  })

  it("passes generic session-scoped composer blockers to the chat implementation", async () => {
    render(
      <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
        <Blocker sessionId="s1" />
        <Blocker sessionId="other" />
        <ChatPanelHost sessionId="s1" />
      </WorkspaceProvider>,
    )

    expect(await screen.findByTestId("blocker-count")).toHaveTextContent("1")
  })

  it("emits a generic composer stop event", () => {
    const onStop = vi.fn()
    const observed = vi.fn()
    window.addEventListener("boring:workspace-composer-stop", observed)
    try {
      render(
        <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
          <ChatPanelHost sessionId="s1" onComposerStop={onStop} />
        </WorkspaceProvider>,
      )
      fireEvent.click(screen.getByRole("button", { name: "stop composer" }))
      expect(observed).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ sessionId: "s1", reason: "user-stop" }) }))
      expect(onStop).toHaveBeenCalled()
    } finally {
      window.removeEventListener("boring:workspace-composer-stop", observed)
    }
  })

  it("emits generic attention action events for plugin-defined blocker actions", () => {
    const observed = vi.fn()
    window.addEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, observed)
    try {
      render(
        <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
          <Blocker sessionId="s1" />
          <ChatPanelHost sessionId="s1" />
        </WorkspaceProvider>,
      )

      fireEvent.click(screen.getByRole("button", { name: "custom blocker action" }))

      expect(observed).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({
          blockerId: "test:s1",
          actionId: "approve",
          sessionId: "s1",
          blocker: expect.objectContaining({ reason: "test", target: "q1" }),
        }),
      }))
    } finally {
      window.removeEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, observed)
    }
  })

  it("opens blocker surfaces through the workbench", async () => {
    const openSurface = vi.fn()
    const surface: SurfaceShellApi = {
      openFile: vi.fn(),
      openSurface,
      openPanel: vi.fn(),
      closeWorkbenchLeftPane: vi.fn(),
      expandToFile: vi.fn(),
      getSnapshot: () => ({ openTabs: [], activeTab: null }),
    }
    render(
      <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
        <Blocker sessionId="s1" />
        <ChatPanelHost sessionId="s1" surfaceDispatch={{ surface: () => surface, isWorkbenchOpen: () => true, openWorkbench: vi.fn(), shouldOpenSurface: () => true }} />
      </WorkspaceProvider>,
    )
    expect(await screen.findByTestId("blocker-count")).toHaveTextContent("1")
    fireEvent.click(screen.getByRole("button", { name: "open blocker" }))
    expect(openSurface).toHaveBeenCalledWith(expect.objectContaining({ kind: "questions", target: "q1", meta: { sessionId: "s1", openOnlyWhenSessionOpen: true } }))
  })

  it("opens company artifact references with explicit filesystem", () => {
    const openFile = vi.fn()
    const onOpenArtifact = vi.fn()
    const surface: SurfaceShellApi = {
      openFile,
      openSurface: vi.fn(),
      openPanel: vi.fn(),
      closeWorkbenchLeftPane: vi.fn(),
      expandToFile: vi.fn(),
      getSnapshot: () => ({ openTabs: [], activeTab: null }),
    }
    render(
      <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
        <ChatPanelHost
          sessionId="s1"
          onOpenArtifact={onOpenArtifact}
          surfaceDispatch={{ surface: () => surface, isWorkbenchOpen: () => true, openWorkbench: vi.fn() }}
        />
      </WorkspaceProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "open company artifact" }))
    expect(openFile).toHaveBeenCalledWith("/company/hr/policy.md", { filesystem: "company_context" })
    expect(onOpenArtifact).toHaveBeenCalledWith("/company/hr/policy.md", { filesystem: "company_context" })
  })

  it("composes workspace artifact opening with caller onOpenArtifact", () => {
    const openFile = vi.fn()
    const setSurfaceOpen = vi.fn()
    const onOpenArtifact = vi.fn()
    const surface: SurfaceShellApi = {
      openFile,
      openSurface: vi.fn(),
      openPanel: vi.fn(),
      closeWorkbenchLeftPane: vi.fn(),
      expandToFile: vi.fn(),
      getSnapshot: () => ({ openTabs: [], activeTab: null }),
    }
    const rafQueue: FrameRequestCallback[] = []
    const originalRaf = global.requestAnimationFrame
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    }) as typeof requestAnimationFrame

    try {
      render(
        <WorkspaceProvider chatPanel={FakeChatPanel} persistenceEnabled={false}>
          <ChatPanelHost
            sessionId="s1"
            onOpenArtifact={onOpenArtifact}
            surfaceDispatch={{ surface: () => surface, isWorkbenchOpen: () => false, openWorkbench: () => setSurfaceOpen(true) }}
          />
        </WorkspaceProvider>,
      )

      fireEvent.click(screen.getByRole("button", { name: "open artifact" }))

      expect(setSurfaceOpen).toHaveBeenCalledWith(true)
      expect(openFile).not.toHaveBeenCalled()
      rafQueue.shift()?.(0)
      expect(openFile).not.toHaveBeenCalled()
      rafQueue.shift()?.(0)
      expect(openFile).toHaveBeenCalledWith("src/example.ts", { filesystem: "user" })
      expect(onOpenArtifact).toHaveBeenCalledWith("src/example.ts")
    } finally {
      global.requestAnimationFrame = originalRaf
    }
  })
})
