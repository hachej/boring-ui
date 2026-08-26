import { describe, expect, it } from "vitest"
import { isSaasSpikeRoute } from "./saasSpikeRoute"
import { SAAS_ARTIFACTS, SAAS_COMPANIES, SAAS_FUNDS, SAAS_THREADS } from "./SaasSpikeFixtures"

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
  })
})
