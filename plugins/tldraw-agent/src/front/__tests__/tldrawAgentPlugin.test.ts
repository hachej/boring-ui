import { describe, expect, it, vi } from "vitest"
import tldrawAgentPlugin, { TLDRAW_AGENT_PANEL_ID, TldrawAgentPanel } from "../index"
import { TLDRAW_AGENT_PLUGIN_ID } from "../../shared/constants"
import { tldrawAgentSurfaceResolver } from "../surfaceResolver"

describe("tldrawAgentPlugin (BoringFrontFactory)", () => {
  it("registers a panel, a panel command, and a surface resolver", async () => {
    const registerPanel = vi.fn()
    const registerPanelCommand = vi.fn()
    const registerSurfaceResolver = vi.fn()
    const api = {
      registerProvider: vi.fn(),
      registerBinding: vi.fn(),
      registerCatalog: vi.fn(),
      registerPanel,
      registerPanelCommand,
      registerSurfaceResolver,
      registerWorkspaceSource: vi.fn(),
      registerAppLeftAction: vi.fn(),
      registerToolRenderer: vi.fn(),
    }

    await tldrawAgentPlugin(api)

    expect(registerPanel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: TLDRAW_AGENT_PANEL_ID,
        label: "tldraw Canvas",
        placement: "shared-dockview",
        component: TldrawAgentPanel,
      }),
    )
    expect(registerPanelCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "tldraw-agent.open",
        title: "Open tldraw Canvas",
        panelId: TLDRAW_AGENT_PANEL_ID,
      }),
    )
    expect(registerSurfaceResolver).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "tldraw-agent.open-file",
        kind: "workspace.open.path",
      }),
    )
  })

  it("resolves only user-filesystem tldraw paths", () => {
    expect(tldrawAgentSurfaceResolver.resolve({ kind: "workspace.open.path", target: "flow.tldraw", filesystem: "user" })).toMatchObject({ component: TLDRAW_AGENT_PANEL_ID })
    expect(tldrawAgentSurfaceResolver.resolve({ kind: "workspace.open.path", target: "flow.tldraw", filesystem: "company_context" })).toBeUndefined()
  })

  it("is the default export (required for hot-reload dynamic import)", () => {
    expect(typeof tldrawAgentPlugin).toBe("function")
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(tldrawAgentPlugin.pluginId).toBe(TLDRAW_AGENT_PLUGIN_ID)
    expect(tldrawAgentPlugin.pluginLabel).toBe("tldraw Canvas")
  })
})
