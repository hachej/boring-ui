import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import { WorkspaceProvider, useWorkspaceAttention } from "../../../provider"
import { events } from "../../../events"
import { filesystemEvents } from "../../../../plugins/filesystemPlugin/shared/events"
import type { SurfaceShellApi } from "../../artifact-surface/SurfaceShell"
import { ChatPanelHost } from "../ChatPanelHost"
import type { WorkspaceChatPanelProps } from "../types"

function FakeChatPanel({ onData, onOpenArtifact, composerBlockers }: WorkspaceChatPanelProps) {
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
      <button type="button" onClick={() => onOpenArtifact?.("src/example.ts")}>
        open artifact
      </button>
    </div>
  )
}

function Blocker({ sessionId = "s1" }: { sessionId?: string }) {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({ id: `test:${sessionId}`, reason: "test", sessionId, label: "Blocked" })
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

  it("composes workspace artifact opening with caller onOpenArtifact", () => {
    const openFile = vi.fn()
    const setSurfaceOpen = vi.fn()
    const onOpenArtifact = vi.fn()
    const surface: SurfaceShellApi = {
      openFile,
      openSurface: vi.fn(),
      openPanel: vi.fn(),
      closeWorkbenchLeftPane: vi.fn(),
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
            getSurface={() => surface}
            isWorkbenchOpen={() => false}
            openWorkbench={() => setSurfaceOpen(true)}
          />
        </WorkspaceProvider>,
      )

      fireEvent.click(screen.getByRole("button", { name: "open artifact" }))

      expect(setSurfaceOpen).toHaveBeenCalledWith(true)
      expect(openFile).not.toHaveBeenCalled()
      rafQueue.shift()?.(0)
      expect(openFile).not.toHaveBeenCalled()
      rafQueue.shift()?.(0)
      expect(openFile).toHaveBeenCalledWith("src/example.ts")
      expect(onOpenArtifact).toHaveBeenCalledWith("src/example.ts")
    } finally {
      global.requestAnimationFrame = originalRaf
    }
  })
})
