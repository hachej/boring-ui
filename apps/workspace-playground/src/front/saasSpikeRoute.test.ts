import { describe, expect, it } from "vitest"
import { isSaasSpikeRoute } from "./saasSpikeRoute"
import {
  SAAS_AGENTS,
  SAAS_ARTIFACTS,
  SAAS_COMPANIES,
  SAAS_COMPANY_ADAPTER,
  SAAS_FUNDS,
  SAAS_FUND_ADAPTER,
  SAAS_THREADS,
  SAAS_THREAD_CANVAS,
  SAAS_VIEWS,
  saasThreadCanvas,
  saasThreadCanvasGroups,
} from "./SaasSpikeFixtures"

describe("workspace-playground SaaS spike route", () => {
  // This dev server exists to show the spike, so the bare URL opens it and
  // `?saasSpike=0` is the way back to the normal playground.
  it("is the default route, with an explicit opt-out", () => {
    expect(isSaasSpikeRoute("")).toBe(true)
    expect(isSaasSpikeRoute("?saasSpike=1")).toBe(true)
    expect(isSaasSpikeRoute("?other=1")).toBe(true)
    expect(isSaasSpikeRoute("?saasSpike=0")).toBe(false)
  })

  it("keeps every record cross-link inside the fixture graph", () => {
    const artifactIds = new Set(SAAS_ARTIFACTS.map((artifact) => artifact.id))
    const fundIds = new Set(SAAS_FUNDS.map((fund) => fund.id))
    const threadIds = new Set(SAAS_THREADS.map((thread) => thread.id))

    for (const company of SAAS_COMPANIES) {
      expect(fundIds.has(company.fundId)).toBe(true)
      expect(company.documentIds.length).toBeGreaterThanOrEqual(2)
      expect(company.documentIds.length).toBeLessThanOrEqual(3)
      expect(company.documentIds.every((id) => artifactIds.has(id))).toBe(true)
      expect(company.threadIds.every((id) => threadIds.has(id))).toBe(true)
    }
    for (const thread of SAAS_THREADS) {
      expect(thread.artifactIds.every((id) => artifactIds.has(id))).toBe(true)
    }
    for (const agent of SAAS_AGENTS) {
      expect(agent.threadIds.every((id) => threadIds.has(id))).toBe(true)
    }
  })

  // Refinements #4/#6: selecting a view is ONE mechanism — mount the view's
  // explorer in column 2, open its home in column 3 — and this table is the
  // only place that pairing is written down.
  it("gives every view a distinct home panel and a known kind", () => {
    const homes = SAAS_VIEWS.map((view) => view.homePanel)
    expect(new Set(homes).size).toBe(homes.length)
    for (const view of SAAS_VIEWS) {
      expect(["collection", "document", "dashboard", "kanban", "chart"]).toContain(view.kind)
      expect(view.homePanel.startsWith("saas-")).toBe(true)
    }
  })

  it("lists the Library views in the ruled order, one entry per view", () => {
    // "1 entry = 1 view; a file is a view." Files leads because the explorer
    // must never open on an empty gutter.
    expect(SAAS_VIEWS.map((view) => view.id)).toEqual([
      "view-files",
      "view-companies",
      "view-funds",
      "view-portfolio-overview",
      "view-diligence-pipeline",
    ])
    expect(SAAS_VIEWS.filter((view) => view.kind === "collection").map((view) => view.homePanel))
      .toEqual(["saas-companies-home", "saas-funds-home"])
    expect(SAAS_VIEWS.find((view) => view.id === "view-files")?.kind).toBe("document")
  })

  // Rulings #8/#9: tabs are a document affordance. Every Library view opens a
  // dock tab, so every view's home must be a registered dock panel — while
  // threads/agents/records are pages and must NOT be registered, or there would
  // still be a way to open one as a tab.
  it("keeps every Library view home inside the dock panel set", () => {
    const dockPanels = new Set([
      "saas-overview",
      "saas-kanban-placeholder",
      "saas-companies-home",
      "saas-funds-home",
      "saas-file-home",
      "saas-company",
      "saas-fund",
    ])
    for (const view of SAAS_VIEWS) {
      expect(dockPanels.has(view.homePanel)).toBe(true)
    }
    // Page surfaces must not be dock panels.
    for (const pageId of ["saas-thread", "saas-inbox", "saas-agent"]) {
      expect(dockPanels.has(pageId)).toBe(false)
    }
  })

  // Refinement #5: the thread canvas is an embedded workbench over REAL files.
  it("seeds thread canvases with real workspace paths and real records", () => {
    const companyIds = new Set(SAAS_COMPANIES.map((company) => company.id))
    const fundIds = new Set(SAAS_FUNDS.map((fund) => fund.id))
    const threadIds = new Set(SAAS_THREADS.map((thread) => thread.id))

    for (const [threadId, items] of Object.entries(SAAS_THREAD_CANVAS)) {
      expect(threadIds.has(threadId)).toBe(true)
      expect(items.length).toBeGreaterThanOrEqual(2)
      for (const item of items) {
        if (item.kind === "file") {
          // A fixture-only name would render an editor that saves nothing.
          expect(item.path).toBeTruthy()
          expect(item.path?.startsWith("/")).toBe(false)
        }
        if (item.kind === "company") expect(companyIds.has(item.recordId ?? "")).toBe(true)
        if (item.kind === "fund") expect(fundIds.has(item.recordId ?? "")).toBe(true)
      }
      // Canvas ids must stay disjoint from the outer surface's `file:` ids:
      // DockviewShell applies global panelClose events to every instance.
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
      expect(items.every((item) => !item.id.startsWith("file:"))).toBe(true)
    }
  })

  // Refinement #6b: the rail survives ONLY inside the canvas, where its icons
  // are the thread's scope groups. No groups would mean a rail with no purpose.
  it("gives each canvas thread at least two scope groups, in ruled order", () => {
    for (const threadId of Object.keys(SAAS_THREAD_CANVAS)) {
      const groups = saasThreadCanvasGroups(threadId)
      expect(groups.length).toBeGreaterThanOrEqual(2)
      // "outputs" leads: what the agent produced is what you most want to see.
      expect(groups[0]).toBe("outputs")
      expect(new Set(groups).size).toBe(groups.length)
    }
    expect(saasThreadCanvasGroups("no-such-thread")).toEqual([])
  })

  // Refinement #7: the transcript summons the canvas, so every artifact card id
  // on a post must resolve to a canvas item of that same thread. A dangling id
  // would render a card that opens nothing.
  it("resolves every in-transcript artifact card to a canvas item", () => {
    for (const thread of SAAS_THREADS) {
      const canvasIds = new Set(saasThreadCanvas(thread.id).map((item) => item.id))
      const cardIds = thread.job.entries.flatMap((entry) => (
        entry.kind === "post" ? [...(entry.artifacts ?? [])] : []
      ))
      for (const id of cardIds) expect(canvasIds.has(id)).toBe(true)
      // Threads with a canvas must actually advertise it in the transcript,
      // because the canvas is closed until a card is clicked.
      if (canvasIds.size > 0) expect(cardIds.length).toBeGreaterThanOrEqual(3)
    }
  })

  it("returns an empty canvas for threads with no working set", () => {
    expect(saasThreadCanvas("acme-diligence").length).toBeGreaterThan(0)
    expect(saasThreadCanvas("no-such-thread")).toEqual([])
  })

  it("serves Companies and Funds from fixture adapters with working facets", async () => {
    const companies = await SAAS_COMPANY_ADAPTER.search({ query: "", filters: {}, limit: 50, offset: 0 })
    expect(companies.total).toBe(SAAS_COMPANIES.length)
    expect(companies.items[0]?.title).toBe(SAAS_COMPANIES[0]?.name)

    const funds = await SAAS_FUND_ADAPTER.search({ query: "", filters: {}, limit: 50, offset: 0 })
    expect(funds.total).toBe(SAAS_FUNDS.length)

    const facets = await SAAS_COMPANY_ADAPTER.fetchFacets?.({ filters: {} })
    expect(facets?.sector?.length).toBeGreaterThan(0)
    const sector = facets?.sector?.[0]?.value ?? ""
    const filtered = await SAAS_COMPANY_ADAPTER.search({ query: "", filters: { sector: [sector] }, limit: 50, offset: 0 })
    expect(filtered.total).toBeGreaterThan(0)
    expect(filtered.total).toBeLessThanOrEqual(companies.total)
    expect(filtered.items.every((item) => {
      const company = SAAS_COMPANIES.find((record) => record.id === item.id)
      return company?.sector === sector
    })).toBe(true)
  })
})
