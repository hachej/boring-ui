import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createBridgeClient, type BridgeClientOptions } from "../client"
import type { WorkspaceBridge, CommandResult } from "../types"
import type { WorkspaceStore } from "../../store/types"

function ok(seq = 1): CommandResult {
  return { seq, status: "ok" }
}

function createMockBridge(): WorkspaceBridge {
  return {
    getOpenPanels: vi.fn(() => []),
    getActiveFile: vi.fn(() => null),
    getDirtyFiles: vi.fn(() => []),
    getVisibleFiles: vi.fn(() => []),
    openFile: vi.fn(async () => ok()),
    openPanel: vi.fn(async () => ok()),
    closePanel: vi.fn(async () => ok()),
    showNotification: vi.fn(async () => ok()),
    navigateToLine: vi.fn(async () => ok()),
    expandToFile: vi.fn(async () => ok()),
    markDirty: vi.fn(),
    markClean: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    select: vi.fn(() => () => {}),
  }
}

function createMockStore() {
  const state: WorkspaceStore = {
    hydrationComplete: true,
    layout: null,
    sidebar: { collapsed: false, width: 250 },
    panelSizes: {},
    preferences: { theme: "light" },
    panels: [{ id: "file:main.ts", component: "editor" }],
    activePanel: "file:main.ts",
    activeFile: "/main.ts",
    visibleFiles: ["/main.ts"],
    dirtyFiles: {},
    notifications: [],
    setHydrationComplete: vi.fn(),
    setLayout: vi.fn(),
    setSidebar: vi.fn(),
    setPanelSize: vi.fn(),
    setTheme: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    activatePanel: vi.fn(),
    openFile: vi.fn(),
    markDirty: vi.fn(),
    markClean: vi.fn(),
    showNotification: vi.fn(),
    dismissNotification: vi.fn(),
    navigateToLine: vi.fn(),
  }

  const subscribers = new Set<(s: WorkspaceStore, prev: WorkspaceStore) => void>()

  return {
    getState: () => state,
    subscribe: (fn: (s: WorkspaceStore, prev: WorkspaceStore) => void) => {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    notify: () => {
      for (const fn of subscribers) fn(state, state)
    },
    state,
  }
}

type EventListenerMap = Record<string, ((e: MessageEvent | Event) => void)[]>

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: EventListenerMap = {}
  readyState = 0
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: MessageEvent | Event) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  removeEventListener(type: string, fn: (e: MessageEvent | Event) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((f) => f !== fn)
    }
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  emit(type: string, data?: string) {
    const fns = this.listeners[type] ?? []
    const event = data !== undefined
      ? { data, type } as MessageEvent
      : { type } as Event
    for (const fn of fns) fn(event)
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  MockEventSource.instances = []
  ;(globalThis as any).EventSource = MockEventSource
  fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true })
  ;(globalThis as any).fetch = fetchMock
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).EventSource
  delete (globalThis as any).fetch
})

function createClient(overrides: Partial<BridgeClientOptions> = {}) {
  const bridge = createMockBridge()
  const store = createMockStore()
  const opts: BridgeClientOptions = {
    endpoint: "http://localhost:3000",
    bridge,
    store,
    ...overrides,
  }
  const client = createBridgeClient(opts)
  return { client, bridge, store, opts }
}

describe("createBridgeClient", () => {
  describe("SSE connection", () => {
    it("connects EventSource to bridgeEndpoint", () => {
      const { client } = createClient()
      client.connect()
      expect(MockEventSource.instances).toHaveLength(1)
      expect(MockEventSource.instances[0].url).toBe(
        "http://localhost:3000/api/v1/ui/commands/next",
      )
      client.disconnect()
    })

    it("does not leak auth token in SSE URL", () => {
      const { client } = createClient({ authToken: "test-token" })
      client.connect()
      expect(MockEventSource.instances[0].url).not.toContain("test-token")
      expect(MockEventSource.instances[0].url).toBe(
        "http://localhost:3000/api/v1/ui/commands/next",
      )
      client.disconnect()
    })

    it("dispatches init event as state reconciliation", async () => {
      const { client } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("init", "{}")
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/ui/state",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"causedBy":"restore"'),
        }),
      )
      client.disconnect()
    })

    it("dispatches command events through bridge", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "openFile", params: { path: "/foo.ts", mode: "edit" } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.openFile).toHaveBeenCalledWith("/foo.ts", { mode: "edit" })
      client.disconnect()
    })

    it("dispatches openPanel command", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({
          v: 1,
          kind: "openPanel",
          params: { id: "chat", component: "ChatPanel", title: "Chat" },
        }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.openPanel).toHaveBeenCalledWith(
        expect.objectContaining({ id: "chat", component: "ChatPanel", title: "Chat" }),
      )
      client.disconnect()
    })

    it("dispatches closePanel command", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "closePanel", params: { id: "chat" } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.closePanel).toHaveBeenCalledWith("chat")
      client.disconnect()
    })

    it("dispatches showNotification command", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({
          v: 1,
          kind: "showNotification",
          params: { msg: "Saved", level: "info" },
        }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.showNotification).toHaveBeenCalledWith("Saved", "info")
      client.disconnect()
    })

    it("dispatches error event as toast", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "error",
        JSON.stringify({ v: 1, code: "invalid_command", message: "Unknown panel" }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.showNotification).toHaveBeenCalledWith("Unknown panel", "error")
      client.disconnect()
    })

    it("handles heartbeat as no-op", () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("heartbeat", "{}")

      expect(bridge.openFile).not.toHaveBeenCalled()
      expect(bridge.showNotification).not.toHaveBeenCalled()
      client.disconnect()
    })

    it("calls onVersionMismatch for non-v1 commands", () => {
      const onVersionMismatch = vi.fn()
      const { client, bridge } = createClient({ onVersionMismatch })
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 2, kind: "openFile", params: { path: "/a.ts" } }),
      )

      expect(onVersionMismatch).toHaveBeenCalledWith(2)
      expect(bridge.openFile).not.toHaveBeenCalled()
      client.disconnect()
    })

    it("calls onVersionMismatch for non-v1 errors", () => {
      const onVersionMismatch = vi.fn()
      const { client, bridge } = createClient({ onVersionMismatch })
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "error",
        JSON.stringify({ v: 3, code: "err", message: "bad" }),
      )

      expect(onVersionMismatch).toHaveBeenCalledWith(3)
      expect(bridge.showNotification).not.toHaveBeenCalled()
      client.disconnect()
    })

    it("handles malformed JSON gracefully", () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("command", "not json{")

      expect(bridge.openFile).not.toHaveBeenCalled()
      client.disconnect()
    })

    it("notifies connection change on init", () => {
      const onConnectionChange = vi.fn()
      const { client } = createClient({ onConnectionChange })
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("init", "{}")

      expect(onConnectionChange).toHaveBeenCalledWith(true)
      client.disconnect()
    })

    it("notifies disconnection on SSE error without data", () => {
      const onConnectionChange = vi.fn()
      const { client } = createClient({ onConnectionChange })
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("init", "{}")
      onConnectionChange.mockClear()
      es.emit("error")

      expect(onConnectionChange).toHaveBeenCalledWith(false)
      client.disconnect()
    })
  })

  describe("PUT state publisher", () => {
    it("pushes state on store change, debounced 100ms", async () => {
      const { client, store } = createClient()
      client.connect()

      store.notify()
      expect(fetchMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(100)

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/ui/state",
        expect.objectContaining({
          method: "PUT",
          body: expect.any(String),
        }),
      )
      client.disconnect()
    })

    it("coalesces rapid state changes into single PUT", async () => {
      const { client, store } = createClient()
      client.connect()

      store.notify()
      store.notify()
      store.notify()

      await vi.advanceTimersByTimeAsync(100)

      const putCalls = fetchMock.mock.calls.filter(
        (c: unknown[]) => (c[1] as RequestInit)?.method === "PUT",
      )
      expect(putCalls).toHaveLength(1)
      client.disconnect()
    })

    it("sets causedBy to user for user-triggered changes", async () => {
      const { client, store } = createClient()
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      )
      expect(body.causedBy).toBe("user")
      client.disconnect()
    })

    it("includes correct state shape in PUT body", async () => {
      const { client, store } = createClient()
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      )
      expect(body).toEqual({
        v: 1,
        causedBy: "user",
        openPanels: [{ id: "file:main.ts", component: "editor" }],
        activePanel: "file:main.ts",
        activeFile: "/main.ts",
        visibleFiles: ["/main.ts"],
        dirtyFiles: [],
      })
      client.disconnect()
    })

    it("includes auth header on PUT", async () => {
      const { client, store } = createClient({ authToken: "my-token" })
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)

      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
      expect(headers["Authorization"]).toBe("Bearer my-token")
      client.disconnect()
    })

    it("calls onAuthError on 401 response", async () => {
      const onAuthError = vi.fn()
      fetchMock.mockResolvedValue({ status: 401, ok: false })
      const { client, store } = createClient({ onAuthError })
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(0)

      expect(onAuthError).toHaveBeenCalledWith(401)
      client.disconnect()
    })

    it("calls onAuthError on 403 response", async () => {
      const onAuthError = vi.fn()
      fetchMock.mockResolvedValue({ status: 403, ok: false })
      const { client, store } = createClient({ onAuthError })
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(0)

      expect(onAuthError).toHaveBeenCalledWith(403)
      client.disconnect()
    })

    it("survives network errors on PUT", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"))
      const { client, store } = createClient()
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(0)

      // Should not throw
      client.disconnect()
    })

    it("pushState method sends immediate PUT", async () => {
      const { client } = createClient()
      client.pushState("restore")
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/ui/state",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"causedBy":"restore"'),
        }),
      )
    })
  })

  describe("short-poll fallback", () => {
    it("polls when pollMode is true", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [],
      })
      const { client } = createClient({ pollMode: true })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/ui/commands/next?poll=true",
        expect.objectContaining({
          headers: expect.any(Object),
        }),
      )
      expect(MockEventSource.instances).toHaveLength(0)
      client.disconnect()
    })

    it("dispatches batched poll commands", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [
          { v: 1, kind: "openFile", params: { path: "/a.ts" } },
          { v: 1, kind: "openFile", params: { path: "/b.ts" } },
        ],
      })
      const { client, bridge } = createClient({ pollMode: true })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.openFile).toHaveBeenCalledTimes(2)
      client.disconnect()
    })

    it("polls at configured interval", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [],
      })
      const { client } = createClient({ pollMode: true, pollInterval: 5000 })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      const initialCalls = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)

      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls)
      client.disconnect()
    })

    it("calls onAuthError on 401 during poll", async () => {
      const onAuthError = vi.fn()
      fetchMock.mockResolvedValue({ status: 401, ok: false })
      const { client } = createClient({ pollMode: true, onAuthError })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(onAuthError).toHaveBeenCalledWith(401)
      client.disconnect()
    })

    it("sets connected on successful poll", async () => {
      const onConnectionChange = vi.fn()
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [],
      })
      const { client } = createClient({ pollMode: true, onConnectionChange })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(onConnectionChange).toHaveBeenCalledWith(true)
      client.disconnect()
    })

    it("sets disconnected on poll network error after prior connection", async () => {
      const onConnectionChange = vi.fn()
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => [],
      })
      const { client } = createClient({ pollMode: true, pollInterval: 1000, onConnectionChange })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(onConnectionChange).toHaveBeenCalledWith(true)
      onConnectionChange.mockClear()

      fetchMock.mockRejectedValue(new Error("Network error"))
      await vi.advanceTimersByTimeAsync(1000)

      expect(onConnectionChange).toHaveBeenCalledWith(false)
      client.disconnect()
    })

    it("skips commands with version mismatch during poll", async () => {
      const onVersionMismatch = vi.fn()
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [
          { v: 2, kind: "openFile", params: { path: "/a.ts" } },
        ],
      })
      const { client, bridge } = createClient({ pollMode: true, onVersionMismatch })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(onVersionMismatch).toHaveBeenCalledWith(2)
      expect(bridge.openFile).not.toHaveBeenCalled()
      client.disconnect()
    })
  })

  describe("disconnect", () => {
    it("closes EventSource on disconnect", () => {
      const { client } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]
      client.disconnect()
      expect(es.closed).toBe(true)
    })

    it("clears poll timer on disconnect", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => [],
      })
      const { client } = createClient({ pollMode: true, pollInterval: 1000 })
      client.connect()
      await vi.advanceTimersByTimeAsync(0)
      const callsBefore = fetchMock.mock.calls.length
      client.disconnect()
      await vi.advanceTimersByTimeAsync(5000)
      expect(fetchMock.mock.calls.length).toBe(callsBefore)
    })

    it("stops subscribing to store on disconnect", async () => {
      const { client, store } = createClient()
      client.connect()
      client.disconnect()
      fetchMock.mockClear()

      store.notify()
      await vi.advanceTimersByTimeAsync(200)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("cancels pending debounced PUT on disconnect", async () => {
      const { client, store } = createClient()
      client.connect()

      store.notify()
      client.disconnect()

      await vi.advanceTimersByTimeAsync(200)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("notifies disconnection", () => {
      const onConnectionChange = vi.fn()
      const { client } = createClient({ onConnectionChange })
      client.connect()
      const es = MockEventSource.instances[0]
      es.emit("init", "{}")
      onConnectionChange.mockClear()

      client.disconnect()
      expect(onConnectionChange).toHaveBeenCalledWith(false)
    })
  })

  describe("reconnection", () => {
    it("re-PUTs state on init after reconnect", async () => {
      const { client } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit("init", "{}")
      await vi.advanceTimersByTimeAsync(0)
      fetchMock.mockClear()

      es.emit("init", "{}")
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/ui/state",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"causedBy":"restore"'),
        }),
      )
      client.disconnect()
    })
  })

  describe("command dispatch coverage", () => {
    it("dispatches navigateToLine", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "navigateToLine", params: { file: "/a.ts", line: 42 } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.navigateToLine).toHaveBeenCalledWith("/a.ts", 42)
      client.disconnect()
    })

    it("dispatches expandToFile", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "expandToFile", params: { path: "/src" } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.expandToFile).toHaveBeenCalledWith("/src")
      client.disconnect()
    })

    it("dispatches markDirty", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "markDirty", params: { path: "/a.ts" } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.markDirty).toHaveBeenCalledWith("/a.ts")
      client.disconnect()
    })

    it("dispatches markClean", async () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "markClean", params: { path: "/a.ts" } }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(bridge.markClean).toHaveBeenCalledWith("/a.ts")
      client.disconnect()
    })
  })

  describe("post-disconnect guards", () => {
    it("ignores SSE events received after disconnect", () => {
      const { client, bridge } = createClient()
      client.connect()
      const es = MockEventSource.instances[0]
      client.disconnect()

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "openFile", params: { path: "/a.ts" } }),
      )

      expect(bridge.openFile).not.toHaveBeenCalled()
    })

    it("in-flight PUT is ignored after disconnect", async () => {
      const onAuthError = vi.fn()
      let resolveResponse: (v: Response) => void
      fetchMock.mockReturnValue(
        new Promise<Response>((r) => { resolveResponse = r }),
      )
      const { client, store } = createClient({ onAuthError })
      client.connect()

      store.notify()
      await vi.advanceTimersByTimeAsync(100)

      client.disconnect()
      resolveResponse!({ status: 401, ok: false } as Response)
      await vi.advanceTimersByTimeAsync(0)

      expect(onAuthError).not.toHaveBeenCalled()
    })
  })

  describe("causedBy attribution with overlapping commands", () => {
    it("attributes agent for concurrent commands", async () => {
      let resolveFirst: () => void
      const bridge = createMockBridge()
      ;(bridge.openFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => new Promise<void>((r) => { resolveFirst = r }),
      )
      const store = createMockStore()
      const client = createBridgeClient({
        endpoint: "http://localhost:3000",
        bridge,
        store,
      })
      client.connect()
      const es = MockEventSource.instances[0]

      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "openFile", params: { path: "/a.ts" } }),
      )
      es.emit(
        "command",
        JSON.stringify({ v: 1, kind: "openFile", params: { path: "/b.ts" } }),
      )

      store.notify()
      await vi.advanceTimersByTimeAsync(100)

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      )
      expect(body.causedBy).toBe("agent")

      resolveFirst!()
      await vi.advanceTimersByTimeAsync(0)
      client.disconnect()
    })
  })
})
