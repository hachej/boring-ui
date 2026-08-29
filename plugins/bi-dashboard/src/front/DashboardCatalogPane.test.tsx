// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DashboardCatalogPane, type DashboardCatalogAdapter } from "./DashboardCatalogPane"

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []
  active = false
  constructor(private readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this)
  }
  observe() { this.active = true }
  disconnect() { this.active = false }
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0]

  static async trigger() {
    // The pane rebuilds its observer in a passive effect once a page settles,
    // so the observer for the *current* page can still be a tick away when
    // findByText resolves. Waiting for a live observer makes the trigger
    // deterministic instead of racing that effect — without it this test fails
    // roughly one run in eight.
    await waitFor(() => expect(this.instances.some((instance) => instance.active)).toBe(true))
    const observer = [...this.instances].reverse().find((instance) => instance.active)
    await observer?.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
  }
}

vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)

afterEach(() => {
  IntersectionObserverStub.instances = []
  vi.restoreAllMocks()
})

describe("DashboardCatalogPane", () => {
  it("forwards search, groups rows, and resolves selected panels", async () => {
    const adapter: DashboardCatalogAdapter = {
      search: vi.fn().mockResolvedValue({
        items: [
          { id: "shared", title: "Overview", group: "Shared", badges: [{ label: "Shared" }], params: { path: "dashboards/overview.dashboard.json" } },
          { id: "tenant", title: "Workforce", group: "Acme", params: { spec: { title: "Acme" } } },
        ],
        total: 2,
        hasMore: false,
      }),
    }
    const openPanel = vi.fn()
    render(<DashboardCatalogPane adapter={adapter} openPanel={openPanel} params={{ searchQuery: "work" }} />)

    expect((await screen.findAllByText("Shared")).length).toBe(2)
    expect(screen.getByText("Acme")).toBeTruthy()
    expect(adapter.search).toHaveBeenCalledWith(expect.objectContaining({ query: "work", limit: 50, offset: 0 }))

    fireEvent.click(screen.getByRole("button", { name: /Workforce/ }))
    await waitFor(() => expect(openPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "bi-dashboard.panel:tenant",
      params: { spec: { title: "Acme" } },
    })))
  })

  it("keeps asynchronous pagination alive and advances by consumed rows", async () => {
    let resolvePage: ((value: { items: Array<{ id: string; title: string; params: { path: string } }>; total: number; hasMore: boolean }) => void) | undefined
    const adapter: DashboardCatalogAdapter = {
      search: vi.fn()
        .mockResolvedValueOnce({ items: [{ id: "one", title: "One", params: { path: "one" } }], total: 3, hasMore: true })
        .mockImplementationOnce(({ signal }) => new Promise((resolve, reject) => {
          resolvePage = resolve
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        }))
        .mockResolvedValueOnce({ items: [{ id: "three", title: "Three", params: { path: "three" } }], total: 3, hasMore: false }),
    }
    render(<DashboardCatalogPane adapter={adapter} params={{}} pageSize={1} />)
    await screen.findByText("One")

    await act(async () => IntersectionObserverStub.trigger())
    await waitFor(() => expect(adapter.search).toHaveBeenCalledTimes(2))
    expect(adapter.search).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1, offset: 1 }))
    expect((adapter.search as ReturnType<typeof vi.fn>).mock.calls[1][0].signal.aborted).toBe(false)
    await act(async () => resolvePage?.({ items: [{ id: "one", title: "One updated", params: { path: "one" } }], total: 3, hasMore: true }))
    expect(await screen.findByText("One updated")).toBeTruthy()

    await act(async () => IntersectionObserverStub.trigger())
    expect(await screen.findByText("Three")).toBeTruthy()
    expect(adapter.search).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1, offset: 2 }))
  })

  it("stops automatic pagination after an error", async () => {
    const adapter: DashboardCatalogAdapter = {
      search: vi.fn()
        .mockResolvedValueOnce({ items: [{ id: "one", title: "One", params: {} }], total: 2, hasMore: true })
        .mockRejectedValueOnce(new Error("offline")),
    }
    render(<DashboardCatalogPane adapter={adapter} params={{}} />)
    await screen.findByText("One")
    await waitFor(() => expect(IntersectionObserverStub.instances.some((instance) => instance.active)).toBe(true))
    await act(async () => IntersectionObserverStub.trigger())
    expect(await screen.findByText("Could not list dashboards")).toBeTruthy()
    expect(adapter.search).toHaveBeenCalledTimes(2)
  })
})
