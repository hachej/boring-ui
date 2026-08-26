import { describe, expect, it } from "vitest"
import { isSaasSpikeRoute } from "./saasSpikeRoute"
import {
  SAAS_AGENTS,
  SAAS_ARTIFACTS,
  SAAS_COMPANIES,
  SAAS_COMPANY_ADAPTER,
  SAAS_FUNDS,
  SAAS_FUND_ADAPTER,
  SAAS_SAVED_VIEWS,
  SAAS_THREADS,
} from "./SaasSpikeFixtures"

describe("workspace-playground SaaS spike route", () => {
  it("enables only for the explicit saasSpike opt-in", () => {
    expect(isSaasSpikeRoute("?saasSpike=1")).toBe(true)
    expect(isSaasSpikeRoute("?saasSpike=0")).toBe(false)
    expect(isSaasSpikeRoute("?jobThread=1")).toBe(false)
    expect(isSaasSpikeRoute("?consoleSpike=1")).toBe(false)
    expect(isSaasSpikeRoute("")).toBe(false)
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

  // The re-composition's architecture claim: a rail TOOL and a LIBRARY entry are
  // two doors onto ONE view. `createDataCatalogPlugin({ id: "saas-companies",
  // visualizationPanelId: "saas-companies-visualization" })` registers that panel
  // id for the rail; the saved view must carry the SAME id, or the two doors
  // quietly become two lookalike panels and the claim is false.
  it("points each collection saved view at the panel its rail tool registers", () => {
    const collectionPanels = SAAS_SAVED_VIEWS
      .filter((view) => view.kind === "collection")
      .map((view) => view.panel)
    expect(collectionPanels).toEqual(["saas-companies-visualization", "saas-funds-visualization"])
  })

  it("gives every saved view a distinct panel id and a known kind", () => {
    const panels = SAAS_SAVED_VIEWS.map((view) => view.panel)
    expect(new Set(panels).size).toBe(panels.length)
    for (const view of SAAS_SAVED_VIEWS) {
      expect(["collection", "document", "dashboard", "kanban", "chart"]).toContain(view.kind)
    }
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
