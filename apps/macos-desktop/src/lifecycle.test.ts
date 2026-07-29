import { describe, expect, test, vi } from "vitest"
import {
  DesktopLifecycle,
  type DesktopServerHandle,
  type DesktopWindowHandle,
} from "./lifecycle.js"

function fakeWindow(): DesktopWindowHandle & { destroyed: boolean } {
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed },
    focus: vi.fn(),
    close: vi.fn(function (this: { destroyed: boolean }) { this.destroyed = true }),
  }
}

describe("DesktopLifecycle", () => {
  test("starts once, focuses the existing window, recreates it after close, and stops idempotently", async () => {
    const server = { origin: "http://127.0.0.1:1234", initialUrl: "http://127.0.0.1:1234", close: vi.fn(async () => undefined) }
    const windows = [fakeWindow(), fakeWindow()]
    const cleanups = [vi.fn(), vi.fn()]
    const startServer = vi.fn(async () => server)
    const createWindow = vi.fn(async () => {
      const index = createWindow.mock.calls.length - 1
      return { window: windows[index], cleanup: cleanups[index] }
    })
    const lifecycle = new DesktopLifecycle({ startServer, createWindow, reportStartupError: vi.fn() })

    await Promise.all([lifecycle.start(), lifecycle.start()])
    expect(startServer).toHaveBeenCalledTimes(1)
    expect(createWindow).toHaveBeenCalledTimes(1)

    await lifecycle.activate()
    expect(windows[0].focus).toHaveBeenCalledTimes(1)

    lifecycle.windowClosed(windows[0])
    expect(cleanups[0]).toHaveBeenCalledTimes(1)
    windows[0].destroyed = true
    await Promise.all([lifecycle.activate(), lifecycle.activate()])
    expect(createWindow).toHaveBeenCalledTimes(2)

    await Promise.all([lifecycle.stop(), lifecycle.stop()])
    expect(cleanups[1]).toHaveBeenCalledTimes(1)
    expect(windows[1].close).toHaveBeenCalledTimes(1)
    expect(server.close).toHaveBeenCalledTimes(1)
  })

  test("waits for in-flight startup and closes without creating a window", async () => {
    let resolveServer!: (server: DesktopServerHandle) => void
    const server = {
      origin: "http://127.0.0.1:1234",
      initialUrl: "http://127.0.0.1:1234",
      close: vi.fn(async () => undefined),
    }
    const startServer = vi.fn(() => new Promise<DesktopServerHandle>((resolve) => {
      resolveServer = resolve
    }))
    const createWindow = vi.fn()
    const lifecycle = new DesktopLifecycle({ startServer, createWindow, reportStartupError: vi.fn() })

    const starting = lifecycle.start()
    const stopping = lifecycle.stop()
    resolveServer(server)
    await Promise.all([starting, stopping])

    expect(createWindow).not.toHaveBeenCalled()
    expect(server.close).toHaveBeenCalledTimes(1)
  })

  test("reports startup failures and closes a partially started server", async () => {
    const failure = new Error("window failed")
    const server = { origin: "http://127.0.0.1:1234", initialUrl: "http://127.0.0.1:1234", close: vi.fn(async () => undefined) }
    const reportStartupError = vi.fn()
    const lifecycle = new DesktopLifecycle({
      startServer: async () => server,
      createWindow: async () => { throw failure },
      reportStartupError,
    })

    await expect(lifecycle.start()).rejects.toBe(failure)
    expect(server.close).toHaveBeenCalledTimes(1)
    expect(reportStartupError).toHaveBeenCalledWith(failure)
  })
})
