import { describe, expect, test, vi } from "vitest"

const harness = vi.hoisted(() => {
  function emitter() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    return {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const entries = listeners.get(event) ?? new Set()
        entries.add(listener)
        listeners.set(event, entries)
      }),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const wrapped = (...args: unknown[]) => {
          listeners.get(event)?.delete(wrapped)
          listener(...args)
        }
        const entries = listeners.get(event) ?? new Set()
        entries.add(wrapped)
        listeners.set(event, entries)
      }),
      removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(listener)
      }),
      emit(event: string, ...args: unknown[]) {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
      },
    }
  }

  const appEvents = emitter()
  const sessionEvents = emitter()
  const defaultSession = {
    ...sessionEvents,
    webRequest: { onBeforeSendHeaders: vi.fn() },
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  }
  const app = {
    ...appEvents,
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(async () => undefined),
    quit: vi.fn(),
  }
  const server = {
    origin: "http://127.0.0.1:41234",
    initialUrl: "http://127.0.0.1:41234/workspace/test",
    close: vi.fn(async () => undefined),
  }
  const windows: Array<{
    webContents: ReturnType<typeof emitter> & {
      session: typeof defaultSession
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
    loadURL: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    isDestroyed(): boolean
    close(): void
  }> = []

  class BrowserWindow {
    private readonly events = emitter()
    private destroyed = false
    webContents = Object.assign(emitter(), {
      session: defaultSession,
      setWindowOpenHandler: vi.fn(),
    })
    loadURL = vi.fn(async () => undefined)
    show = vi.fn()
    focus = vi.fn()

    constructor(_options: unknown) {
      windows.push(this)
    }

    on = this.events.on
    once = this.events.once
    isDestroyed() { return this.destroyed }
    close() {
      this.destroyed = true
      this.events.emit("closed")
    }
  }

  return {
    app,
    BrowserWindow,
    defaultSession,
    server,
    startServer: vi.fn(async () => server),
    showErrorBox: vi.fn(),
    windows,
  }
})

vi.mock("electron", () => ({
  app: harness.app,
  BrowserWindow: harness.BrowserWindow,
  dialog: { showErrorBox: harness.showErrorBox },
  session: { defaultSession: harness.defaultSession },
}))

vi.mock("@hachej/boring-ui-cli/server", () => ({
  startEmbeddedBoringUiServer: harness.startServer,
}))

describe("desktop main wiring", () => {
  test("owns the single instance, focuses it, and closes the server before quitting", async () => {
    await import("./main.js")
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1))

    expect(harness.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    harness.app.emit("second-instance")
    await vi.waitFor(() => expect(harness.windows[0].focus).toHaveBeenCalledTimes(1))

    const event = { preventDefault: vi.fn() }
    harness.app.emit("before-quit", event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(harness.server.close).toHaveBeenCalledTimes(1))
    expect(harness.app.quit).toHaveBeenCalled()
  })
})
