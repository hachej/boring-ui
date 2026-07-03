import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
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
import { events, agentMeta, remoteMeta, userMeta } from "../../../../../front/events"
import { filesystemEvents } from "../../../shared/events"

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function queryKeyCalls(invalidate: ReturnType<typeof vi.fn>): Array<readonly unknown[]> {
  return invalidate.mock.calls.map(([f]) => (f as { queryKey: readonly unknown[] }).queryKey)
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

  it("filesystem changed invalidates files + stat for the path only (granular)", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.changed, { ...agentMeta("tc-1"), path: "src/a.ts" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "src/a.ts"],
    }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "stat", "user", "src/a.ts"],
    })
    // Tree/search are NOT touched on a content-only change.
    const calls = queryKeyCalls(invalidate)
    expect(calls.some((k) => k[2] === "tree")).toBe(false)
    expect(calls.some((k) => k[2] === "search")).toBe(false)
  })

  it("filesystem created (file) invalidates parent tree listing + files + stat", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...userMeta(), path: "src/new.ts", kind: "file" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src"],
    }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "src/new.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "stat", "user", "src/new.ts"],
    })
  })

  it("re-invalidates remote creates after the filesystem settles", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...remoteMeta(), path: "src/new.ts", kind: "file" })

    await waitFor(() => expect(
      queryKeyCalls(invalidate).filter((k) => k[2] === "tree" && k[3] === "user" && k[4] === "src"),
    ).toHaveLength(1))

    await waitFor(() => expect(
      queryKeyCalls(invalidate).filter((k) => k[2] === "tree" && k[3] === "user" && k[4] === "src"),
    ).toHaveLength(2), { timeout: 1000 })
  })

  it("updates cached parent tree entries for remote creates before refetch completes", async () => {
    qc.setQueryData([TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src"], [
      { name: "old.ts", kind: "file", path: "src/old.ts" },
    ])
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })

    events.emit(filesystemEvents.created, { ...remoteMeta(), path: "src/new.ts", kind: "file" })

    await waitFor(() => expect(qc.getQueryData([TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src"])).toEqual([
      { name: "old.ts", kind: "file", path: "src/old.ts" },
      { name: "new.ts", kind: "file", path: "src/new.ts" },
    ]))
  })

  it("keeps tree invalidation scoped by filesystem", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...userMeta(), filesystem: "project_alpha", path: "src/new.ts", kind: "file" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "project_alpha", "src"],
    }))
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src"],
    })
  })

  it("filesystem created (dir) invalidates the root tree listing only", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.created, { ...userMeta(), path: "scripts", kind: "dir" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "."],
    }))
    const calls = queryKeyCalls(invalidate)
    expect(calls.some((k) => k[2] === "stat")).toBe(false)
  })

  it("filesystem moved invalidates parent trees + files(from,to) + search", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.moved, { ...userMeta(), from: "old.ts", to: "docs/new.ts" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "."],
    }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "docs"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "old.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "docs/new.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "search"],
    })
  })

  it("directory move invalidates descendant file/stat/tree caches under the old prefix", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.moved, { ...userMeta(), from: "src", to: "lib" })

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const predicates = invalidate.mock.calls
      .map(([f]) => (f as { predicate?: (q: { queryKey: readonly unknown[] }) => boolean }).predicate)
      .filter((p): p is (q: { queryKey: readonly unknown[] }) => boolean => typeof p === "function")
    expect(predicates).toHaveLength(1)
    const matches = (key: readonly unknown[]) => predicates[0]({ queryKey: key })

    // Descendants under the OLD prefix are invalidated…
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "src/deep/a.ts"])).toBe(true)
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "stat", "user", "src/a.ts"])).toBe(true)
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src/deep"])).toBe(true)
    // The moved dir's OWN listing is dead too (panes mounted at rootDir="src").
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "src"])).toBe(true)
    // …unrelated paths, the new prefix, and other workspaces are not.
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "other/a.ts"])).toBe(false)
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "lib/a.ts"])).toBe(false)
    expect(matches([TEST_BASE, "other-workspace", "files", "user", "src/a.ts"])).toBe(false)
    // Prefix match is path-segment-aware: "src-other" is not under "src/".
    expect(matches([TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "src-other/a.ts"])).toBe(false)
  })

  it("filesystem deleted invalidates parent tree listing + files(path) + search", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    events.emit(filesystemEvents.deleted, { ...userMeta(), path: "doomed.ts" })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "."],
    }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "files", "user", "doomed.ts"],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "search"],
    })
  })

  it("coalesces a delete burst to one tree and one search invalidation", async () => {
    renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })

    for (let i = 0; i < 50; i += 1) {
      events.emit(filesystemEvents.deleted, { ...agentMeta("burst"), path: `folder/file-${i}.txt` })
    }

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TEST_BASE, TEST_WORKSPACE_ID, "tree", "user", "folder"],
    }))
    const calls = queryKeyCalls(invalidate)
    // All 50 deletions share one parent dir → one coalesced tree key.
    expect(calls.filter((k) => k[2] === "tree" && k[3] === "user")).toHaveLength(1)
    expect(calls.filter((k) => k[2] === "search")).toHaveLength(1)
    expect(calls.filter((k) => k[2] === "files")).toHaveLength(50)
  })

  it("unsubscribes on unmount — events fired afterwards do not invalidate", async () => {
    const { unmount } = renderHook(() => useFileEventInvalidation(), { wrapper: makeWrapper(qc) })
    unmount()
    invalidate.mockClear()

    events.emit(filesystemEvents.changed, { ...userMeta(), path: "x.ts" })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(invalidate).not.toHaveBeenCalled()
  })
})
