import { act, render, waitFor } from "@testing-library/react"
import type { DockviewApi } from "dockview-react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DockviewShell } from "../../../../front/dock"
import { events, agentMeta, userMeta, workspaceEvents } from "../../../../front/events"
import { RegistryProvider } from "../../../../front/registry"
import { CommandRegistry } from "../../../../front/registry/CommandRegistry"
import { PanelRegistry } from "../../../../front/registry/PanelRegistry"
import { bindStore } from "../../../../front/store/selectors"
import { createWorkspaceStore } from "../../../../front/store"
import { filesystemEvents } from "../../shared/events"
import { emitFilesystemAgentFileChange } from "../agentFileBridge"
import { FilesystemFilePanelBinding } from "../filePanelBinding"

function DummyPanel() {
  return <div data-testid="dummy-panel">Panel content</div>
}

function renderBindingWithDockview(): DockviewApi {
  bindStore(createWorkspaceStore({ persistenceEnabled: false }))
  const panelRegistry = new PanelRegistry()
  panelRegistry.register("editor", { title: "Editor", component: DummyPanel })
  const commandRegistry = new CommandRegistry()
  let captured: DockviewApi | null = null

  render(
    <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
      <FilesystemFilePanelBinding />
      <DockviewShell
        layout={{
          version: "2.0",
          groups: [{ id: "main", position: "center", dynamic: true }],
        }}
        onReady={(api) => {
          captured = api
        }}
      />
    </RegistryProvider>,
  )

  if (!captured) throw new Error("DockviewApi not captured")
  return captured
}

describe("FilesystemFilePanelBinding", () => {
  beforeEach(() => {
    events._reset()
  })

  afterEach(() => {
    events._reset()
  })

  it("translates filesystem moved events into generic panel updates", () => {
    const observed = vi.fn()
    events.on(workspaceEvents.panelUpdate, observed)
    render(<FilesystemFilePanelBinding />)

    events.emit(filesystemEvents.moved, {
      ...agentMeta("tc-1"),
      from: "src/old.ts",
      to: "src/new.ts",
    })

    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: "agent",
        toolCallId: "tc-1",
        match: [
          { id: "file:src/old.ts" },
          { param: "path", value: "src/old.ts" },
        ],
        params: { path: "src/new.ts" },
        title: "new.ts",
      }),
    )
  })

  it("translates filesystem deleted events into generic panel closes", () => {
    const observed = vi.fn()
    events.on(workspaceEvents.panelClose, observed)
    render(<FilesystemFilePanelBinding />)

    events.emit(filesystemEvents.deleted, {
      ...userMeta(),
      path: "src/dead.ts",
    })

    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: "user",
        match: [
          { id: "file:src/dead.ts" },
          { param: "path", value: "src/dead.ts" },
        ],
      }),
    )
  })

  it("unsubscribes on unmount", () => {
    const observed = vi.fn()
    events.on(workspaceEvents.panelClose, observed)
    const { unmount } = render(<FilesystemFilePanelBinding />)
    unmount()

    events.emit(filesystemEvents.deleted, {
      ...userMeta(),
      path: "src/dead.ts",
    })

    expect(observed).not.toHaveBeenCalled()
  })

  it("wires agent SSE rename chunks through to open Dockview file panels", async () => {
    const api = renderBindingWithDockview()
    act(() => {
      api.addPanel({
        id: "file:src/old.ts",
        component: "editor",
        title: "old.ts",
        params: { path: "src/old.ts" },
      })
    })

    act(() => {
      emitFilesystemAgentFileChange({
        type: "data-file-changed",
        data: {
          op: "rename",
          oldPath: "src/old.ts",
          path: "src/new.ts",
          toolCallId: "tc-rename",
        },
      })
    })

    await waitFor(() => {
      const panel = api.getPanel("file:src/old.ts")
      expect(panel).toBeTruthy()
      expect((panel!.params as { path?: string }).path).toBe("src/new.ts")
      expect(panel!.title).toBe("new.ts")
    })
  })
})
