import { describe, expect, it, vi } from "vitest"
import { runUiReviewReadinessWithReload } from "../core/readiness"

describe("UI review page readiness", () => {
  it("does not reload when the first hydration reaches readiness", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const ready = vi.fn(async () => {})

    await runUiReviewReadinessWithReload(page, 60_000, ready)

    expect(ready).toHaveBeenCalledOnce()
    expect(page.reload).not.toHaveBeenCalled()
  })

  it("reloads once when one-shot app hydration becomes terminal", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const ready = vi.fn()
      .mockRejectedValueOnce(new Error("roster discovery failed"))
      .mockResolvedValueOnce(undefined)

    await runUiReviewReadinessWithReload(page, 60_000, ready)

    expect(ready).toHaveBeenNthCalledWith(1, page, 30_000)
    expect(page.reload).toHaveBeenCalledWith({ waitUntil: "domcontentloaded" })
    expect(ready).toHaveBeenNthCalledWith(2, page, 60_000)
  })

  it("surfaces the final readiness failure after exactly one reload", async () => {
    const page = { reload: vi.fn(async () => {}) }
    const ready = vi.fn()
      .mockRejectedValueOnce(new Error("first hydration failed"))
      .mockRejectedValueOnce(new Error("second hydration failed"))

    await expect(runUiReviewReadinessWithReload(page, 60_000, ready)).rejects.toThrow("second hydration failed")
    expect(page.reload).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledTimes(2)
  })
})
