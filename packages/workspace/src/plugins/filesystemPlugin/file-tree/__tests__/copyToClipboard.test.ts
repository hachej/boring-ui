import { describe, it, expect, vi, afterEach } from "vitest"
import { copyToClipboard } from "../FileTreeView"

describe("copyToClipboard", () => {
  afterEach(() => {
    // Reset clipboard mock between tests so prior assignments don't leak.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    delete (document as { execCommand?: typeof document.execCommand }).execCommand
  })

  it("calls navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    await copyToClipboard("hello")
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to execCommand when navigator.clipboard is undefined", async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    ;(document as { execCommand?: typeof document.execCommand }).execCommand = execCommand
    await copyToClipboard("fallback")
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0)
  })

  it("falls back to execCommand when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"))
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    ;(document as { execCommand?: typeof document.execCommand }).execCommand = execCommand
    await copyToClipboard("retry")
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("throws when both paths fail", async () => {
    const execCommand = vi.fn().mockReturnValue(false)
    ;(document as { execCommand?: typeof document.execCommand }).execCommand = execCommand
    let caught: unknown
    try {
      await copyToClipboard("nope")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/Clipboard not available/)
    // textarea cleaned up even on failure
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0)
  })

  it("cleans up the hidden textarea even when writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    await copyToClipboard("clean")
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0)
  })
})
