import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DataExplorer } from "../DataExplorer"
import type {
  ExplorerAdapter,
  ExplorerRow,
  Facets,
  SearchArgs,
  SearchResult,
} from "../types"

// ---------------------------------------------------------------------------
// Synchronous in-memory adapter — paginates and groups a fixed dataset.
// ---------------------------------------------------------------------------

function makeAdapter(rows: ExplorerRow[], facetData?: Facets): ExplorerAdapter {
  return {
    async search(args: SearchArgs): Promise<SearchResult> {
      let pool = rows
      if (args.group) {
        const g = args.group
        pool = pool.filter((r) => r.group === g.value)
      }
      if (args.query) {
        const q = args.query.toLowerCase()
        pool = pool.filter((r) => r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
      }
      for (const [k, vs] of Object.entries(args.filters)) {
        // Naive filter: only honors `kind` against an `extra.kind` dimension if present;
        // otherwise filters by group key (sufficient for tests that exercise toggling).
        if (k === "group") pool = pool.filter((r) => vs.includes(r.group ?? ""))
      }
      const slice = pool.slice(args.offset, args.offset + args.limit)
      return { items: slice, total: pool.length, hasMore: args.offset + slice.length < pool.length }
    },
    async fetchFacets() {
      return facetData ?? {}
    },
  }
}

const seriesRows: ExplorerRow[] = [
  { id: "GDPC1", title: "Real GDP", group: "Q", leading: { code: "Q" } },
  { id: "CPIAUCSL", title: "CPI All Urban", group: "M", leading: { code: "M" } },
  { id: "UNRATE", title: "Unemployment Rate", group: "M", leading: { code: "M" }, trailing: [{ code: "D" }] },
  { id: "DFF", title: "Federal Funds Rate", group: "D", leading: { code: "D" }, meta: "8.4M" },
]

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("DataExplorer", () => {
  // -------------------------------------------------------------------------
  it("renders rows from the adapter on mount (flat mode)", async () => {
    const adapter = makeAdapter(seriesRows)
    render(<DataExplorer adapter={adapter} />)

    expect(await screen.findByText("Real GDP")).toBeInTheDocument()
    expect(screen.getByText("CPI All Urban")).toBeInTheDocument()
    expect(screen.getByText("Unemployment Rate")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  it("renders an empty state when adapter returns no rows", async () => {
    const adapter = makeAdapter([])
    render(<DataExplorer adapter={adapter} emptyState="No results" />)
    expect(await screen.findByText("No results")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  it("renders the leading badge code", async () => {
    const adapter = makeAdapter(seriesRows)
    render(<DataExplorer adapter={adapter} />)
    await screen.findByText("Real GDP")
    // "Q" appears at least once as a leading badge.
    expect(screen.getAllByText("Q").length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  it("renders subtitle, trailing chips, and meta text", async () => {
    const adapter = makeAdapter([
      {
        id: "DFF",
        title: "Federal Funds Rate",
        subtitle: "Daily, percent",
        leading: { code: "D" },
        trailing: [{ code: "LIVE" }],
        meta: "8.4M",
      },
    ])
    render(<DataExplorer adapter={adapter} />)

    expect(await screen.findByText("Federal Funds Rate")).toBeInTheDocument()
    expect(screen.getByText("Daily, percent")).toBeInTheDocument()
    expect(screen.getByText("LIVE")).toBeInTheDocument()
    expect(screen.getByText("8.4M")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  it("calls onActivate with the row when a row is clicked", async () => {
    const onActivate = vi.fn()
    const adapter = makeAdapter(seriesRows)
    render(<DataExplorer adapter={adapter} onActivate={onActivate} />)

    const row = await screen.findByText("Real GDP")
    fireEvent.click(row)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0][0].id).toBe("GDPC1")
  })

  // -------------------------------------------------------------------------
  it("rows are not draggable when getDragPayload is omitted", async () => {
    const adapter = makeAdapter(seriesRows)
    const { container } = render(<DataExplorer adapter={adapter} />)
    await screen.findByText("Real GDP")
    expect(container.querySelectorAll("[draggable=true]")).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  it("rows are draggable when getDragPayload is provided and the payload is set on dragStart", async () => {
    const adapter = makeAdapter(seriesRows)
    const getDragPayload = vi.fn((row: ExplorerRow) => ({
      mimeType: "text/series-id",
      value: row.id,
    }))
    render(<DataExplorer adapter={adapter} getDragPayload={getDragPayload} />)

    const row = (await screen.findByText("Real GDP")).closest('[draggable="true"]') as HTMLElement
    expect(row).toBeTruthy()

    const dataTransfer: { setData: ReturnType<typeof vi.fn>; effectAllowed: string } = {
      setData: vi.fn(),
      effectAllowed: "",
    }
    fireEvent.dragStart(row, { dataTransfer })

    expect(getDragPayload).toHaveBeenCalled()
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/series-id", "GDPC1")
  })

  // -------------------------------------------------------------------------
  it("typing in the search input filters rows after debounce", async () => {
    const user = userEvent.setup()
    const adapter = makeAdapter(seriesRows)
    render(<DataExplorer adapter={adapter} debounceMs={50} />)

    await screen.findByText("Real GDP")

    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, "CPI")

    await waitFor(
      () => {
        expect(screen.queryByText("Real GDP")).toBeNull()
        expect(screen.getByText("CPI All Urban")).toBeInTheDocument()
      },
      { timeout: 1000 },
    )
  })

  // -------------------------------------------------------------------------
  it("renders group headers and expands/collapses on click in tree mode", async () => {
    const adapter = makeAdapter(seriesRows, {
      frequency: [
        { value: "M", count: 2 },
        { value: "Q", count: 1 },
        { value: "D", count: 1 },
      ],
    })
    const formatFreq = (v: string) =>
      ({ D: "Daily", M: "Monthly", Q: "Quarterly" })[v] ?? v
    render(
      <DataExplorer
        adapter={adapter}
        groupBy="frequency"
        facets={[
          { key: "frequency", label: "Frequency", order: ["D", "M", "Q"], formatValue: formatFreq },
        ]}
      />,
    )

    // Group headers come from facets; rows are NOT fetched until expand.
    const header = await screen.findByRole("button", { name: /Monthly/i })
    // The "M" group should not have rendered any item yet.
    expect(screen.queryByText("CPI All Urban")).toBeNull()

    fireEvent.click(header)

    expect(await screen.findByText("CPI All Urban")).toBeInTheDocument()
    expect(screen.getByText("Unemployment Rate")).toBeInTheDocument()

    fireEvent.click(header)
    await waitFor(() => expect(screen.queryByText("CPI All Urban")).toBeNull())
  })

  // -------------------------------------------------------------------------
  it("forces flat mode when a query is active, even if groupBy is set", async () => {
    const adapter = makeAdapter(seriesRows, {
      frequency: [
        { value: "M", count: 2 },
        { value: "Q", count: 1 },
      ],
    })
    const { rerender } = render(
      <DataExplorer
        adapter={adapter}
        groupBy="frequency"
        facets={[{ key: "frequency", label: "Frequency" }]}
        query=""
      />,
    )

    // Tree mode: rows are hidden until a group is expanded.
    await screen.findByText("M")
    expect(screen.queryByText("CPI All Urban")).toBeNull()

    rerender(
      <DataExplorer
        adapter={adapter}
        groupBy="frequency"
        facets={[{ key: "frequency", label: "Frequency" }]}
        query="CPI"
      />,
    )

    // With a query, flat mode kicks in — matching rows appear directly.
    expect(await screen.findByText("CPI All Urban")).toBeInTheDocument()
    // Group headers no longer present.
    expect(screen.queryByRole("button", { name: /^M\b/ })).toBeNull()
  })

  // -------------------------------------------------------------------------
  it("does not render a search input when searchable is explicitly false", async () => {
    const adapter = makeAdapter(seriesRows)
    render(<DataExplorer adapter={adapter} searchable={false} />)
    await screen.findByText("Real GDP")
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
  })
})
