import { describe, expect, it, vi } from "vitest"
import { withStableBrowserCapture } from "../core/captureStability"

describe("UI review capture stability", () => {
  it("keeps motion frozen across both screenshot and hard-gate collection", async () => {
    const events: string[] = []
    const style = {
      evaluate: vi.fn(async () => { events.push("unfreeze") }),
    }
    const page = {
      addStyleTag: vi.fn(async () => {
        events.push("freeze")
        return style
      }),
      evaluate: vi.fn(async () => { events.push("settle") }),
    }

    await expect(withStableBrowserCapture(page, async () => {
      events.push("screenshot")
      events.push("hard-gates")
      return "captured"
    })).resolves.toBe("captured")

    expect(events).toEqual(["freeze", "settle", "screenshot", "hard-gates", "unfreeze"])
    expect(page.addStyleTag).toHaveBeenCalledWith({ content: expect.stringContaining("transition-duration: 0s") })
  })

  it("always removes the capture freeze after a failure", async () => {
    const style = { evaluate: vi.fn(async () => {}) }
    const page = {
      addStyleTag: vi.fn(async () => style),
      evaluate: vi.fn(async () => {}),
    }

    await expect(withStableBrowserCapture(page, async () => {
      throw new Error("gate failed")
    })).rejects.toThrow("gate failed")
    expect(style.evaluate).toHaveBeenCalledOnce()
  })
})
