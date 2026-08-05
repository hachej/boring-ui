import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import {
  TASK_SESSION_LINKS_CHANGED_EVENT,
  taskSessionLinkKey,
  useTaskSessionLinkCounts,
} from "./taskSessionLinkStream"

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  closed = false

  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }

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

function client(postJson: ReturnType<typeof vi.fn> = vi.fn(async () => ({ links: [] }))): WorkspacePluginClient {
  return {
    agentTypeId: "default",
    apiBaseUrl: "/api",
    workspaceId: "workspace-a",
    workspaceHeaders: () => ({}),
    getJson: vi.fn(),
    readJsonFile: vi.fn(),
    postJson: postJson as unknown as WorkspacePluginClient["postJson"],
    deleteJson: vi.fn(),
    sendAgentPrompt: vi.fn(),
  }
}

afterEach(() => {
  MockEventSource.instances = []
  vi.unstubAllGlobals()
})

describe("useTaskSessionLinkCounts", () => {
  it("reconciles an initial snapshot and ordered redacted changes", () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const { result, unmount } = renderHook(() => useTaskSessionLinkCounts(client()))
    const source = MockEventSource.instances[0]!
    expect(result.current).toBeNull()
    expect(source.url).toBe("/api/api/boring-tasks/session-links/events?workspaceId=workspace-a")

    act(() => source.emit("snapshot", {
      streamId: "stream-a",
      revision: 2,
      tasks: [{ adapterId: "github", taskId: "776", count: 1 }],
    }))
    expect(result.current?.get(taskSessionLinkKey("github", "776"))).toBe(1)

    act(() => source.emit("change", { streamId: "stream-a", revision: 3, adapterId: "github", taskId: "776", count: 2 }))
    act(() => source.emit("change", { streamId: "stream-a", revision: 2, adapterId: "github", taskId: "776", count: 9 }))
    expect(result.current?.get(taskSessionLinkKey("github", "776"))).toBe(2)

    act(() => source.emit("snapshot", { streamId: "stream-b", revision: 0, tasks: [] }))
    expect(result.current?.has(taskSessionLinkKey("github", "776"))).toBe(false)
    unmount()
    expect(source.closed).toBe(true)
  })

  it("does not let a slow same-window confirmation overwrite a newer stream snapshot", async () => {
    vi.stubGlobal("EventSource", MockEventSource)
    let resolveRequest!: (value: { links: unknown[] }) => void
    const postJson = vi.fn(() => new Promise<{ links: unknown[] }>((resolve) => { resolveRequest = resolve }))
    const { result } = renderHook(() => useTaskSessionLinkCounts(client(postJson)))
    const source = MockEventSource.instances[0]!

    act(() => source.emit("snapshot", {
      streamId: "stream-a",
      revision: 3,
      tasks: [{ adapterId: "github", taskId: "776", count: 1 }],
    }))
    act(() => window.dispatchEvent(new CustomEvent(TASK_SESSION_LINKS_CHANGED_EVENT, {
      detail: { adapterId: "github", taskId: "776" },
    })))
    act(() => source.emit("change", { streamId: "stream-a", revision: 4, adapterId: "github", taskId: "776", count: 5 }))
    await act(async () => resolveRequest({ links: [{}, {}] }))

    expect(result.current?.get(taskSessionLinkKey("github", "776"))).toBe(5)
  })

  it("immediately confirms same-window task mutations with one targeted request", async () => {
    vi.stubGlobal("EventSource", MockEventSource)
    const postJson = vi.fn(async () => ({ links: [{ id: "one" }, { id: "two" }] }))
    const { result } = renderHook(() => useTaskSessionLinkCounts(client(postJson)))
    act(() => MockEventSource.instances[0]!.emit("snapshot", { streamId: "stream-a", revision: 0, tasks: [] }))

    act(() => window.dispatchEvent(new CustomEvent(TASK_SESSION_LINKS_CHANGED_EVENT, {
      detail: { adapterId: "github", taskId: "776" },
    })))

    await waitFor(() => expect(result.current?.get(taskSessionLinkKey("github", "776"))).toBe(2))
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/list", { adapterId: "github", taskId: "776" })
  })
})
