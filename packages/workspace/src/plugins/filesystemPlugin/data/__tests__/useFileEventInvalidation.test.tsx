import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const TEST_BASE = "https://api.test"
const TEST_WORKSPACE_ID = "workspace-test"

vi.mock("../DataProvider", () => ({
  useApiBaseUrl: () => TEST_BASE,
  useWorkspaceRequestId: () => TEST_WORKSPACE_ID,
  // Keep the rest of the module — but this path only re-exports, so a
  // narrow shim is enough for the single hook under test.
  useDataClient: () => ({}),
}))

import { useFileEventInvalidation } from "../useFileEventInvalidation"
import { events, agentMeta, userMeta } from "../../../../front/events"
import { filesystemEvents } from "../../events"

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

  it("filesystem changed invalidates files + stat for the path only (granular)", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.changed, { ...agentMeta("tc-1"), path: "src/a.ts" })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "src/a.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "stat", "src/a.ts"],
    })
    // Tree/search are NOT touched on a content-only change.
    const calls = invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly unknown[] }).queryKey)
    expect(calls.some((k) => k[2] === "tree")).toBe(false)
    expect(calls.some((k) => k[2] === "search")).toBe(false)
  })

  it("filesystem created (file) invalidates tree + files + stat", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...userMeta(), path: "src/new.ts", kind: "file" })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "src/new.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "stat", "src/new.ts"],
    })
  })

  it("filesystem created (dir) invalidates tree only", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...userMeta(), path: "scripts", kind: "dir" })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree"],
    })
    const calls = invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly unknown[] }).queryKey)
    expect(calls.some((k) => k[2] === "stat")).toBe(false)
  })

  it("filesystem moved invalidates tree + files(from,to) + search", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.moved, { ...userMeta(), from: "old.ts", to: "new.ts" })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "old.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "new.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "search"],
    })
  })

  it("filesystem deleted invalidates tree + files(path) + search", () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.deleted, { ...userMeta(), path: "doomed.ts" })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "doomed.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "search"],
    })
  })

  it("unsubscribes on unmount — events fired afterwards do not invalidate", () => {
    const { unmount } = renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    unmount()
    invalidate.mockClear()

    events.emit(filesystemEvents.changed, { ...userMeta(), path: "x.ts" })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
