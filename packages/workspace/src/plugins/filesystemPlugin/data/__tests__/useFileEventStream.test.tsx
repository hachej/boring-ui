import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const TEST_BASE = ""
const TEST_WORKSPACE_ID = "workspace-stream-test"

vi.mock("../DataProvider", () => ({
  useApiBaseUrl: () => TEST_BASE,
  useWorkspaceRequestId: () => TEST_WORKSPACE_ID,
  useDataClient: () => ({}),
}))

import { useFileEventStream } from "../useFileEventStream"
import { events } from "../../../../front/events"
import { filesystemEvents } from "../../events"

let nextSeq = 1
function envelope(change: {
  op: string
  path: string
  oldPath?: string
  mtimeMs?: number
}): string {
  return JSON.stringify({
    eventId: `evt-${nextSeq}`,
    seq: nextSeq++,
    ts: Date.now(),
    change,
  })
}

interface ESListener {
  type: string
  fn: EventListener
}

class MockEventSource {
  static instances: MockEventSource[] = []
  static lastInstance(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1]!
  }

  url: string
  listeners: ESListener[] = []
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: EventListener): void {
    this.listeners.push({ type, fn })
  }

  removeEventListener(type: string, fn: EventListener): void {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn))
  }

  close(): void {
    this.closed = true
  }

  dispatch(type: string, data: string): void {
    for (const l of this.listeners) {
      if (l.type === type) {
        l.fn(new MessageEvent(type, { data }))
      }
    }
  }
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe("useFileEventStream", () => {
  let qc: QueryClient
  let Wrapper: ({ children }: { children: ReactNode }) => ReturnType<typeof QueryClientProvider>

  beforeEach(() => {
    events._reset()
    MockEventSource.instances = []
    nextSeq = 1
    qc = new QueryClient()
    Wrapper = makeWrapper(qc)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).EventSource = MockEventSource
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).EventSource
  })

  it("opens an EventSource against /api/v1/fs/events", () => {
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.lastInstance().url).toBe(
      `/api/v1/fs/events?workspaceId=${TEST_WORKSPACE_ID}`,
    )
  })

  it("emits filesystem changed onto the bus with cause:remote on a write event", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.changed, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    MockEventSource.lastInstance().dispatch(
      "change",
      envelope({ op: "write", path: "src/a.ts", mtimeMs: 9 }),
    )

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", cause: "remote" }),
    )
  })

  it("emits filesystem created (kind:dir) on mkdir", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.created, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    MockEventSource.lastInstance().dispatch(
      "change",
      envelope({ op: "mkdir", path: "scripts" }),
    )

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "scripts", kind: "dir", cause: "remote" }),
    )
  })

  it("emits filesystem deleted on unlink", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.deleted, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    MockEventSource.lastInstance().dispatch(
      "change",
      envelope({ op: "unlink", path: "doomed.ts" }),
    )

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "doomed.ts", cause: "remote" }),
    )
  })

  it("emits filesystem moved on rename when oldPath is present", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.moved, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    MockEventSource.lastInstance().dispatch(
      "change",
      envelope({ op: "rename", path: "new.ts", oldPath: "old.ts" }),
    )

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ from: "old.ts", to: "new.ts", cause: "remote" }),
    )
  })

  it("dedupes by eventId — repeated envelopes only relay once", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.changed, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    const dup = JSON.stringify({
      eventId: "duplicate-id",
      seq: 1,
      ts: 1,
      change: { op: "write", path: "x.ts" },
    })
    MockEventSource.lastInstance().dispatch("change", dup)
    MockEventSource.lastInstance().dispatch("change", dup)
    MockEventSource.lastInstance().dispatch("change", dup)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("on resync-required: invalidates file/tree/stat/search keys, keeps stream open", () => {
    const invalidate = vi.fn(() => Promise.resolve())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qc as any).invalidateQueries = invalidate

    renderHook(() => useFileEventStream(), { wrapper: Wrapper })
    MockEventSource.lastInstance().dispatch("resync-required", "{}")

    // The hook calls invalidateQueries with a predicate. Probe it.
    expect(invalidate).toHaveBeenCalledTimes(1)
    const firstCall = invalidate.mock.calls[0] as unknown as Array<{
      predicate: (q: { queryKey: readonly unknown[] }) => boolean
    }>
    const call = firstCall[0]
    expect(typeof call.predicate).toBe("function")
    expect(call.predicate({ queryKey: ["", "files", "/a.ts"] })).toBe(true)
    expect(call.predicate({ queryKey: ["", "tree", "."] })).toBe(true)
    expect(call.predicate({ queryKey: ["", "stat", "/a.ts"] })).toBe(true)
    expect(call.predicate({ queryKey: ["", "search", "x"] })).toBe(true)
    expect(call.predicate({ queryKey: ["", "sessions"] })).toBe(false)

    // EventSource is NOT closed — server keeps streaming live events.
    expect(MockEventSource.lastInstance().closed).toBe(false)
  })

  it("closes the EventSource on `unsupported` event", () => {
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })
    MockEventSource.lastInstance().dispatch(
      "unsupported",
      JSON.stringify({ reason: "watch_not_implemented" }),
    )
    expect(MockEventSource.lastInstance().closed).toBe(true)
  })

  it("ignores malformed JSON without throwing", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.changed, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    expect(() =>
      MockEventSource.lastInstance().dispatch("change", "not-json{"),
    ).not.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })

  it("ignores envelopes missing eventId or change", () => {
    const fn = vi.fn()
    events.on(filesystemEvents.changed, fn)
    renderHook(() => useFileEventStream(), { wrapper: Wrapper })

    MockEventSource.lastInstance().dispatch(
      "change",
      JSON.stringify({ seq: 1, change: { op: "write", path: "x.ts" } }),
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() => useFileEventStream(), { wrapper: Wrapper })
    unmount()
    expect(MockEventSource.lastInstance().closed).toBe(true)
  })
})
