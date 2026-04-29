import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const TEST_BASE = "https://api.test"

vi.mock("../DataProvider", () => ({
  useApiBaseUrl: () => TEST_BASE,
  // Keep the rest of the module — but this path only re-exports, so a
  // narrow shim is enough for the single hook under test.
  useDataClient: () => ({}),
}))

import { useFileEventInvalidation } from "../useFileEventInvalidation"
import { events, agentMeta, userMeta } from "../../events"

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("useFileEventInvalidation", () => {
  let qc: QueryClient
  // Untyped on purpose — vitest's MockInstance generic doesn't compose
  // with React Query's overloaded invalidateQueries signature.
  let invalidate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    events._reset()
    qc = new QueryClient()
    invalidate = vi.fn(() => Promise.resolve())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qc as any).invalidateQueries = invalidate
  })

  it("file:changed invalidates files + stat for the path only (granular)", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit("file:changed", { ...agentMeta("tc-1"), path: "src/a.ts" })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "files", "src/a.ts"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "stat", "src/a.ts"] })
    // Tree/search are NOT touched on a content-only change.
    const calls = invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly unknown[] }).queryKey)
    expect(calls.some((k) => k[1] === "tree")).toBe(false)
    expect(calls.some((k) => k[1] === "search")).toBe(false)
  })

  it("file:created (file) invalidates tree + stat", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit("file:created", { ...userMeta(), path: "src/new.ts", kind: "file" })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "tree"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "stat", "src/new.ts"] })
  })

  it("file:created (dir) invalidates tree only", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit("file:created", { ...userMeta(), path: "scripts", kind: "dir" })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "tree"] })
    const calls = invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly unknown[] }).queryKey)
    expect(calls.some((k) => k[1] === "stat")).toBe(false)
  })

  it("file:moved invalidates tree + files(from,to) + search", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit("file:moved", { ...userMeta(), from: "old.ts", to: "new.ts" })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "tree"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "files", "old.ts"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "files", "new.ts"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "search"] })
  })

  it("file:deleted invalidates tree + files(path) + search", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit("file:deleted", { ...userMeta(), path: "doomed.ts" })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "tree"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "files", "doomed.ts"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TEST_BASE, "search"] })
  })

  it("unsubscribes on unmount — events fired afterwards do not invalidate", () => {
    const { unmount } = renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    unmount()
    invalidate.mockClear()

    events.emit("file:changed", { ...userMeta(), path: "x.ts" })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
