import { describe, expect, it, vi } from "vitest"
import { runUiReviewReadinessWithReload } from "../core/readiness"

describe("UI review page readiness", () => {
  it("does not reload when the first hydration reaches readiness", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const discover = vi.fn(async () => {})
    const assertReady = vi.fn(async () => {})

    await expect(runUiReviewReadinessWithReload(page, 60_000, discover, assertReady)).resolves.toEqual({
      retryUsed: false,
      firstError: null,
    })

    expect(discover).toHaveBeenCalledOnce()
    expect(assertReady).toHaveBeenCalledOnce()
    expect(page.reload).not.toHaveBeenCalled()
  })

  it("reloads once when one-shot app discovery becomes terminal and exposes the diagnostic", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const discover = vi.fn()
      .mockRejectedValueOnce(new Error("roster discovery failed"))
      .mockResolvedValueOnce(undefined)
    const assertReady = vi.fn(async () => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const diagnostic = await runUiReviewReadinessWithReload(page, 60_000, discover, assertReady)

    expect(discover).toHaveBeenNthCalledWith(1, page, 30_000)
    expect(page.reload).toHaveBeenCalledWith({ waitUntil: "domcontentloaded" })
    expect(discover).toHaveBeenNthCalledWith(2, page, 60_000)
    expect(assertReady).toHaveBeenCalledOnce()
    expect(diagnostic).toEqual({ retryUsed: true, firstError: "Error: roster discovery failed" })
    expect(warn).toHaveBeenCalledWith("UI_REVIEW_READINESS_DISCOVERY_RETRY: Error: roster discovery failed")
    warn.mockRestore()
  })

  it("surfaces the final discovery failure after exactly one reload", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const discover = vi.fn()
      .mockRejectedValueOnce(new Error("first hydration failed"))
      .mockRejectedValueOnce(new Error("second hydration failed"))
    const assertReady = vi.fn(async () => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(runUiReviewReadinessWithReload(page, 60_000, discover, assertReady)).rejects.toThrow("second hydration failed")
    expect(page.reload).toHaveBeenCalledOnce()
    expect(discover).toHaveBeenCalledTimes(2)
    expect(assertReady).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("does not retry a post-discovery readiness contract failure", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const discover = vi.fn(async () => {})
    const assertReady = vi.fn(async () => { throw new Error("composer heading missing") })

    await expect(runUiReviewReadinessWithReload(page, 60_000, discover, assertReady)).rejects.toThrow("composer heading missing")

    expect(discover).toHaveBeenCalledOnce()
    expect(assertReady).toHaveBeenCalledOnce()
    expect(page.reload).not.toHaveBeenCalled()
  })
})
