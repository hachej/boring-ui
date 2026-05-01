import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  useFileContent,
  useFileList,
  useStat,
  useFileSearch,
  useFileWrite,
  useCreateDir,
  useMoveFile,
  useDeleteFile,
} from "../hooks"
import { events } from "../../../../front/events"
import { filesystemEvents } from "../../events"

const TEST_BASE = "http://test"
const TEST_WORKSPACE_ID = "workspace-hooks-test"

vi.mock("../DataProvider", () => ({
  useDataClient: () => mockClient,
  useApiBaseUrl: () => TEST_BASE,
  useWorkspaceRequestId: () => TEST_WORKSPACE_ID,
}))

let mockClient: {
  getFile: ReturnType<typeof vi.fn>
  getTree: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
  createDir: ReturnType<typeof vi.fn>
  moveFile: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
}

let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  mockClient = {
    getFile: vi.fn(),
    getTree: vi.fn(),
    stat: vi.fn(),
    search: vi.fn(),
    writeFile: vi.fn(),
    createDir: vi.fn(),
    moveFile: vi.fn(),
    deleteFile: vi.fn(),
  }
})

describe("useFileContent", () => {
  it("fetches and returns file content", async () => {
    mockClient.getFile.mockResolvedValue({ content: "hello" })
    const { result } = renderHook(() => useFileContent("/a.ts"), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ content: "hello" })
    expect(mockClient.getFile).toHaveBeenCalledWith("/a.ts", expect.any(AbortSignal))
  })

  it("is disabled when path is null", () => {
    const { result } = renderHook(() => useFileContent(null), { wrapper })
    expect(result.current.fetchStatus).toBe("idle")
  })

  it("uses different cache entries for different paths", async () => {
    mockClient.getFile
      .mockResolvedValueOnce({ content: "a" })
      .mockResolvedValueOnce({ content: "b" })
    const { result: r1 } = renderHook(() => useFileContent("/a.ts"), { wrapper })
    const { result: r2 } = renderHook(() => useFileContent("/b.ts"), { wrapper })
    await waitFor(() => expect(r1.current.isSuccess).toBe(true))
    await waitFor(() => expect(r2.current.isSuccess).toBe(true))
    expect(r1.current.data?.content).toBe("a")
    expect(r2.current.data?.content).toBe("b")
  })
})

describe("useFileList", () => {
  it("returns directory listing", async () => {
    const entries = [{ name: "a.ts", kind: "file" as const, path: "a.ts" }]
    mockClient.getTree.mockResolvedValue(entries)
    const { result } = renderHook(() => useFileList("/"), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(entries)
    expect(mockClient.getTree).toHaveBeenCalledWith("/", expect.any(AbortSignal))
  })
})

describe("useStat", () => {
  it("returns file metadata", async () => {
    mockClient.stat.mockResolvedValue({ size: 42, mtimeMs: 100, kind: "file" })
    const { result } = renderHook(() => useStat("/a.ts"), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ size: 42, mtimeMs: 100, kind: "file" })
    expect(mockClient.stat).toHaveBeenCalledWith("/a.ts", expect.any(AbortSignal))
  })
})

describe("useFileSearch", () => {
  it("fetches search results for non-empty query", async () => {
    mockClient.search.mockResolvedValue(["/a.ts", "/b.ts"])
    const { result } = renderHook(() => useFileSearch("*.ts", 10), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(["/a.ts", "/b.ts"])
    expect(mockClient.search).toHaveBeenCalledWith("*.ts", 10, expect.any(AbortSignal))
  })

  it("is disabled for empty query", () => {
    const { result } = renderHook(() => useFileSearch(""), { wrapper })
    expect(result.current.fetchStatus).toBe("idle")
  })
})

// File-mutation hooks no longer invalidate React Query directly.
// Invalidation is centralized in `useFileEventInvalidation`, which
// subscribes to the workspace event bus. The hooks' only post-success
// side effect is to emit the right `filesystem:file.*` event onto the bus —
// asserted in the "Mutation file-event emissions" suite below.

describe("useFileWrite", () => {
  it("calls writeFile and does not directly invalidate caches", async () => {
    mockClient.writeFile.mockResolvedValue(undefined)
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useFileWrite(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ path: "/a.ts", content: "new" })
    })

    // useFileWrite passes through expectedMtimeMs (third arg). When
    // not supplied, it forwards `undefined` so callers explicitly opt
    // into OCC.
    expect(mockClient.writeFile).toHaveBeenCalledWith("/a.ts", "new", undefined)
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it("forwards expectedMtimeMs through to the data client", async () => {
    mockClient.writeFile.mockResolvedValue({ mtimeMs: 999 })
    const { result } = renderHook(() => useFileWrite(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        path: "/a.ts",
        content: "new",
        expectedMtimeMs: 1000,
      })
    })

    expect(mockClient.writeFile).toHaveBeenCalledWith("/a.ts", "new", {
      expectedMtimeMs: 1000,
    })
  })
})

describe("Mutation file-event emissions", () => {
  beforeEach(() => events._reset())

  it("useMoveFile emits filesystem moved with cause=user after success", async () => {
    mockClient.moveFile.mockResolvedValue(undefined)
    const fn = vi.fn()
    events.on(filesystemEvents.moved, fn)

    const { result } = renderHook(() => useMoveFile(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ from: "old/a.ts", to: "new/a.ts" })
    })

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "old/a.ts",
        to: "new/a.ts",
        cause: "user",
      }),
    )
  })

  it("useMoveFile does NOT emit if the underlying call rejects", async () => {
    mockClient.moveFile.mockRejectedValue(new Error("denied"))
    const fn = vi.fn()
    events.on(filesystemEvents.moved, fn)

    const { result } = renderHook(() => useMoveFile(), { wrapper })
    await act(async () => {
      await result.current
        .mutateAsync({ from: "a.ts", to: "b.ts" })
        .catch(() => {})
    })

    expect(fn).not.toHaveBeenCalled()
  })

  it("useDeleteFile emits filesystem deleted after success", async () => {
    mockClient.deleteFile.mockResolvedValue(undefined)
    const fn = vi.fn()
    events.on(filesystemEvents.deleted, fn)

    const { result } = renderHook(() => useDeleteFile(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ path: "x.md" })
    })

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "x.md", cause: "user" }),
    )
  })

  it("useCreateDir emits filesystem created with kind=dir", async () => {
    mockClient.createDir.mockResolvedValue(undefined)
    const fn = vi.fn()
    events.on(filesystemEvents.created, fn)

    const { result } = renderHook(() => useCreateDir(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ path: "scripts" })
    })

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "scripts", kind: "dir", cause: "user" }),
    )
  })

  it("useFileWrite emits filesystem changed with cause=user after success", async () => {
    mockClient.writeFile.mockResolvedValue(undefined)
    const changed = vi.fn()
    events.on(filesystemEvents.changed, changed)

    const { result } = renderHook(() => useFileWrite(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ path: "a.ts", content: "x" })
    })

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.ts", cause: "user" }),
    )
  })

  it("useFileWrite does NOT emit filesystem changed if the underlying call rejects", async () => {
    mockClient.writeFile.mockRejectedValue(new Error("denied"))
    const changed = vi.fn()
    events.on(filesystemEvents.changed, changed)

    const { result } = renderHook(() => useFileWrite(), { wrapper })
    await act(async () => {
      await result.current
        .mutateAsync({ path: "a.ts", content: "x" })
        .catch(() => {})
    })

    expect(changed).not.toHaveBeenCalled()
  })
})
