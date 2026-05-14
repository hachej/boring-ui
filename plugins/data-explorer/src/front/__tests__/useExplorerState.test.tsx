import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useExplorerState } from "../useExplorerState"
import type { ExplorerAdapter, SearchArgs, SearchResult, Facets } from "../types"

// ---------------------------------------------------------------------------
// Test adapter factory — records every call, lets each call resolve manually
// (so we can assert ordering, abort behavior, and pagination explicitly).
// ---------------------------------------------------------------------------

type Pending = {
  args: SearchArgs
  resolve: (r: SearchResult) => void
  reject: (e: unknown) => void
  aborted: boolean
}

function makeAdapter(opts: { facets?: Facets } = {}) {
  const calls: Pending[] = []
  const facetCalls: { filters: Record<string, string[]> }[] = []

  const adapter: ExplorerAdapter = {
    search(args) {
      const pending: Pending = {
        args,
        resolve: () => {},
        reject: () => {},
        aborted: false,
      }
      const promise = new Promise<SearchResult>((resolve, reject) => {
        pending.resolve = resolve
        pending.reject = reject
      })
      args.signal?.addEventListener("abort", () => {
        pending.aborted = true
        pending.reject(new DOMException("aborted", "AbortError"))
      })
      calls.push(pending)
      return promise
    },
    fetchFacets(args) {
      facetCalls.push({ filters: args.filters })
      return Promise.resolve(opts.facets ?? {})
    },
  }

  return { adapter, calls, facetCalls }
}

function row(id: string, group?: string) {
  return { id, title: id, group }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useExplorerState", () => {
  // -------------------------------------------------------------------------
  it("on mount: fetches facets once and runs initial top-level search", async () => {
    const { adapter, calls, facetCalls } = makeAdapter({
      facets: { frequency: [{ value: "M", count: 10 }] },
    })

    const { result } = renderHook(() =>
      useExplorerState({ adapter, facets: [{ key: "frequency", label: "Frequency" }] }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    expect(facetCalls.length).toBe(1)
    expect(calls[0].args).toMatchObject({
      query: "",
      filters: {},
      offset: 0,
    })
    expect(calls[0].args.group).toBeUndefined()

    act(() => calls[0].resolve({ items: [row("a"), row("b")], total: 2, hasMore: false }))

    await waitFor(() => expect(result.current.topItems).toHaveLength(2))
    expect(result.current.topTotal).toBe(2)
    expect(result.current.topHasMore).toBe(false)
    expect(result.current.facets).toEqual({ frequency: [{ value: "M", count: 10 }] })
    expect(result.current.loading).toBe(false)
  })

  // -------------------------------------------------------------------------
  it("setQuery debounces and aborts the in-flight request", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() => useExplorerState({ adapter }))

    // Initial search resolves immediately so we can focus on debounce behavior.
    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.setQuery("a"))
    act(() => result.current.setQuery("ab"))
    act(() => result.current.setQuery("abc"))

    // Before debounce timer fires, no new search.
    expect(calls.length).toBe(1)

    act(() => vi.advanceTimersByTime(250))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].args.query).toBe("abc")
  })

  // -------------------------------------------------------------------------
  it("rapid setQuery between completed searches aborts the previous in-flight call", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() => useExplorerState({ adapter }))

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.setQuery("foo"))
    act(() => vi.advanceTimersByTime(250))
    await waitFor(() => expect(calls.length).toBe(2))

    // Don't resolve calls[1] — issue a new search; it should abort calls[1].
    act(() => result.current.setQuery("bar"))
    act(() => vi.advanceTimersByTime(250))
    await waitFor(() => expect(calls.length).toBe(3))

    expect(calls[1].aborted).toBe(true)
    expect(calls[2].args.query).toBe("bar")
  })

  // -------------------------------------------------------------------------
  it("loadMoreTop appends to existing items at next offset", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({ adapter, pageSize: 2 }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [row("a"), row("b")], total: 5, hasMore: true }))

    await waitFor(() => expect(result.current.topItems).toHaveLength(2))
    expect(result.current.topHasMore).toBe(true)

    act(() => result.current.loadMoreTop())

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].args).toMatchObject({ offset: 2, limit: 2 })

    act(() => calls[1].resolve({ items: [row("c"), row("d")], total: 5, hasMore: true }))

    await waitFor(() => expect(result.current.topItems).toHaveLength(4))
    expect(result.current.topItems.map((r) => r.id)).toEqual(["a", "b", "c", "d"])
  })

  // -------------------------------------------------------------------------
  it("loadMoreTop is a no-op when hasMore is false", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() => useExplorerState({ adapter }))

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [row("a")], total: 1, hasMore: false }))
    await waitFor(() => expect(result.current.topHasMore).toBe(false))

    act(() => result.current.loadMoreTop())
    expect(calls.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  it("toggleFilter resets pagination and re-fetches facets with the new filter", async () => {
    const { adapter, calls, facetCalls } = makeAdapter({
      facets: { source: [{ value: "fred", count: 5 }] },
    })
    const { result } = renderHook(() =>
      useExplorerState({ adapter, facets: [{ key: "source", label: "Source" }] }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [row("a"), row("b")], total: 5, hasMore: true }))
    await waitFor(() => expect(result.current.topItems).toHaveLength(2))

    act(() => result.current.toggleFilter("source", "fred"))

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].args).toMatchObject({
      filters: { source: ["fred"] },
      offset: 0,
    })
    expect(facetCalls.length).toBe(2)
    expect(facetCalls[1].filters).toEqual({ source: ["fred"] })

    // Toggling again removes the value.
    act(() => result.current.toggleFilter("source", "fred"))
    await waitFor(() => expect(calls.length).toBe(3))
    expect(calls[2].args.filters).toEqual({})
  })

  // -------------------------------------------------------------------------
  it("expandGroup fetches first page for that group lazily", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({
        adapter,
        groupBy: "frequency",
        facets: [{ key: "frequency", label: "Frequency" }],
        pageSize: 50,
      }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.expandGroup("M"))
    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].args.group).toEqual({ key: "frequency", value: "M" })
    expect(calls[1].args.offset).toBe(0)

    act(() =>
      calls[1].resolve({
        items: [row("CPI", "M"), row("UNRATE", "M")],
        total: 2,
        hasMore: false,
      }),
    )

    await waitFor(() => {
      const g = result.current.getGroup("M")
      return expect(g.items).toHaveLength(2)
    })
    expect(result.current.isExpanded("M")).toBe(true)
  })

  // -------------------------------------------------------------------------
  it("expandGroup is a no-op if the group is already expanded and loaded", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({ adapter, groupBy: "frequency" }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.expandGroup("M"))
    await waitFor(() => expect(calls.length).toBe(2))
    act(() => calls[1].resolve({ items: [row("X", "M")], total: 1, hasMore: false }))
    await waitFor(() => expect(result.current.getGroup("M").items).toHaveLength(1))

    act(() => result.current.collapseGroup("M"))
    expect(result.current.isExpanded("M")).toBe(false)

    // Re-expanding should not refetch (data is still cached).
    act(() => result.current.expandGroup("M"))
    expect(result.current.isExpanded("M")).toBe(true)
    expect(calls.length).toBe(2)
  })

  // -------------------------------------------------------------------------
  it("loadMoreGroup paginates inside a group", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({ adapter, groupBy: "frequency", pageSize: 2 }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.expandGroup("M"))
    await waitFor(() => expect(calls.length).toBe(2))
    act(() =>
      calls[1].resolve({ items: [row("a", "M"), row("b", "M")], total: 4, hasMore: true }),
    )
    await waitFor(() => expect(result.current.getGroup("M").items).toHaveLength(2))

    act(() => result.current.loadMoreGroup("M"))
    await waitFor(() => expect(calls.length).toBe(3))
    expect(calls[2].args).toMatchObject({
      group: { key: "frequency", value: "M" },
      offset: 2,
      limit: 2,
    })

    act(() =>
      calls[2].resolve({ items: [row("c", "M"), row("d", "M")], total: 4, hasMore: false }),
    )
    await waitFor(() => expect(result.current.getGroup("M").items).toHaveLength(4))
  })

  // -------------------------------------------------------------------------
  it("changing query flushes group caches", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({ adapter, groupBy: "frequency" }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))
    act(() => result.current.expandGroup("M"))
    await waitFor(() => expect(calls.length).toBe(2))
    act(() => calls[1].resolve({ items: [row("a", "M")], total: 1, hasMore: false }))
    await waitFor(() => expect(result.current.getGroup("M").items).toHaveLength(1))

    act(() => result.current.setQuery("xyz"))
    act(() => vi.advanceTimersByTime(250))

    await waitFor(() => expect(calls.length).toBe(3))
    // After query change, the M group should be fresh — no stale items.
    expect(result.current.getGroup("M").items).toHaveLength(0)
    expect(result.current.isExpanded("M")).toBe(false)
  })

  // -------------------------------------------------------------------------
  it("clearFilters resets all filter state and refetches", async () => {
    const { adapter, calls } = makeAdapter()
    const { result } = renderHook(() =>
      useExplorerState({ adapter, facets: [{ key: "source", label: "Source" }] }),
    )

    await waitFor(() => expect(calls.length).toBe(1))
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.toggleFilter("source", "fred"))
    await waitFor(() => expect(calls.length).toBe(2))
    act(() => calls[1].resolve({ items: [], total: 0, hasMore: false }))

    act(() => result.current.clearFilters())
    await waitFor(() => expect(calls.length).toBe(3))
    expect(result.current.filters).toEqual({})
    expect(calls[2].args.filters).toEqual({})
  })

  // -------------------------------------------------------------------------
  it("controlled query: re-runs search synchronously when the prop changes", async () => {
    const { adapter, calls } = makeAdapter()
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useExplorerState({ adapter, query }),
      { initialProps: { query: "" } },
    )

    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].args.query).toBe("")
    act(() => calls[0].resolve({ items: [], total: 0, hasMore: false }))

    rerender({ query: "foo" })

    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].args.query).toBe("foo")

    // The hook does not provide its own input — setQuery is a no-op when
    // controlled (caller owns the value).
    act(() => result.current.setQuery("bar"))
    // Fast-forward past any internal debounce window.
    act(() => vi.advanceTimersByTime(500))
    expect(calls.length).toBe(2)
  })

  // -------------------------------------------------------------------------
  it("aborts pending requests on unmount", async () => {
    const { adapter, calls } = makeAdapter()
    const { result, unmount } = renderHook(() => useExplorerState({ adapter }))

    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].aborted).toBe(false)

    unmount()
    expect(calls[0].aborted).toBe(true)

    // Reference result so eslint/ts don't complain about unused.
    expect(result).toBeDefined()
  })
})
