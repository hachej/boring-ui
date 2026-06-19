import { describe, expect, it, vi } from "vitest"
import boringFeedbackPlugin, { BORING_FEEDBACK_PANEL_ID, BoringFeedbackPanel } from "../index"
import { BORING_FEEDBACK_PLUGIN_ID, BORING_FEEDBACK_SURFACE_KIND } from "../../shared/constants"

describe("boringFeedbackPlugin (BoringFrontFactory)", () => {
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
      registerLeftTab: vi.fn(),
      registerSurfaceResolver,
      registerToolRenderer: vi.fn(),
    }

    await boringFeedbackPlugin(api)

    expect(registerPanel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: BORING_FEEDBACK_PANEL_ID,
        label: "Feedback",
        placement: "center",
        component: BoringFeedbackPanel,
      }),
    )
    expect(registerPanelCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "boring-feedback.open",
        title: "Open Feedback",
        panelId: BORING_FEEDBACK_PANEL_ID,
      }),
    )
    expect(registerSurfaceResolver).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "boring-feedback",
        kind: BORING_FEEDBACK_SURFACE_KIND,
      }),
    )
  })

  it("is the default export (required for hot-reload dynamic import)", () => {
    expect(typeof boringFeedbackPlugin).toBe("function")
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(boringFeedbackPlugin.pluginId).toBe(BORING_FEEDBACK_PLUGIN_ID)
    expect(boringFeedbackPlugin.pluginLabel).toBe("Feedback")
  })
})
