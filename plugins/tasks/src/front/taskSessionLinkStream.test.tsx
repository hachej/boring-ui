import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import { WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT } from "@hachej/boring-workspace/plugin"
import { requestTaskSessionLinkRefresh, taskSessionLinkKey, useTaskSessionLinks } from "./taskSessionLinkStream"

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  closed = false
  constructor(readonly url: string) { MockEventSource.instances.push(this) }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener as (event: MessageEvent) => void)
    this.listeners.set(type, listeners)
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
  close() { this.closed = true }
}

function client(): WorkspacePluginClient {
  return {
    agentTypeId: "default",
    apiBaseUrl: "/api",
    workspaceId: "workspace-a",
    workspaceHeaders: () => ({}),
    getJson: vi.fn(),
    readJsonFile: vi.fn(),
    postJson: vi.fn(),
    deleteJson: vi.fn(),
    sendAgentPrompt: vi.fn(),
  }
}

const link = (id: string) => ({
  id,
  adapterId: "github",
  taskId: "776",
  agentTypeId: "default",
  sessionId: `native-${id}`,
  createdAt: "2026-08-05T00:00:00.000Z",
})

afterEach(() => {
  MockEventSource.instances = []
  vi.unstubAllGlobals()
})

describe("useTaskSessionLinks", () => {
  it("reconciles authoritative link descriptors from snapshots and ordered changes", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const { result, unmount } = renderHook(() => useTaskSessionLinks(client()))
    const source = MockEventSource.instances[0]!
    const key = taskSessionLinkKey("github", "776")
    expect(result.current).toBeNull()
    expect(source.url).toBe("/api/api/boring-tasks/session-links/events?workspaceId=workspace-a")

    act(() => source.emit("snapshot", {
      streamId: "stream-a",
      revision: 2,
      tasks: [{ adapterId: "github", taskId: "776", links: [link("one")] }],
    }))
    expect(result.current?.get(key)?.map((item) => item.sessionId)).toEqual(["native-one"])

    act(() => source.emit("change", { streamId: "stream-a", revision: 3, adapterId: "github", taskId: "776", links: [link("one"), link("two")] }))
    act(() => source.emit("change", { streamId: "stream-a", revision: 2, adapterId: "github", taskId: "776", links: [link("stale")] }))
    expect(result.current?.get(key)?.map((item) => item.sessionId)).toEqual(["native-one", "native-two"])

    act(() => source.emit("change", { streamId: "stream-a", revision: 4, adapterId: "github", taskId: "776", links: [] }))
    expect(result.current?.has(key)).toBe(false)
    unmount()
    expect(source.closed).toBe(true)
  })

  it("reconnects for a workspace-scoped mutation refresh and applies its authoritative snapshot", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const { result } = renderHook(() => useTaskSessionLinks(client()))
    const source = MockEventSource.instances[0]!
    act(() => source.emit("snapshot", { streamId: "stream-a", revision: 0, tasks: [] }))
    act(() => requestTaskSessionLinkRefresh("workspace-b"))
    expect(MockEventSource.instances).toHaveLength(1)
    act(() => requestTaskSessionLinkRefresh("workspace-a"))
    expect(source.closed).toBe(true)
    const reconnected = MockEventSource.instances[1]!
    act(() => reconnected.emit("snapshot", { streamId: "stream-a", revision: 1, tasks: [{ adapterId: "github", taskId: "776", links: [link("receipt")] }] }))
    expect(result.current?.get(taskSessionLinkKey("github", "776"))?.map((item) => item.sessionId)).toEqual(["native-receipt"])
  })

  it("releases its HTTP stream while a detached chat is open and reconnects on close", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    renderHook(() => useTaskSessionLinks(client()))
    const source = MockEventSource.instances[0]!

    act(() => window.dispatchEvent(new CustomEvent(WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT, { detail: { open: true } })))
    expect(source.closed).toBe(true)
    expect(MockEventSource.instances).toHaveLength(1)

    act(() => requestTaskSessionLinkRefresh("workspace-a"))
    expect(MockEventSource.instances).toHaveLength(1)

    act(() => window.dispatchEvent(new CustomEvent(WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT, { detail: { open: false } })))
    expect(MockEventSource.instances).toHaveLength(2)
  })

  it("replaces state from a reconnect snapshot", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const { result } = renderHook(() => useTaskSessionLinks(client()))
    const source = MockEventSource.instances[0]!
    act(() => source.emit("snapshot", { streamId: "old", revision: 9, tasks: [{ adapterId: "github", taskId: "776", links: [link("old")] }] }))
    act(() => source.emit("snapshot", { streamId: "new", revision: 0, tasks: [] }))
    expect(result.current?.size).toBe(0)
  })
})
