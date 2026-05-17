import { describe, expect, it, vi } from "vitest"
import samplePlugin, { SAMPLE_PANEL_ID, SamplePanel } from "../index"
import { SAMPLE_SURFACE_KIND } from "../../shared/constants"

describe("samplePlugin (BoringFrontFactory)", () => {
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
    }

    await samplePlugin(api)

    expect(registerPanel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: SAMPLE_PANEL_ID,
        label: "Sample",
        placement: "center",
        component: SamplePanel,
      }),
    )
    expect(registerPanelCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "sample.open",
        title: "Open Sample",
        panelId: SAMPLE_PANEL_ID,
      }),
    )
    expect(registerSurfaceResolver).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "sample",
        kind: SAMPLE_SURFACE_KIND,
      }),
    )
  })

  it("is the default export (required for hot-reload dynamic import)", () => {
    expect(typeof samplePlugin).toBe("function")
  })
})
