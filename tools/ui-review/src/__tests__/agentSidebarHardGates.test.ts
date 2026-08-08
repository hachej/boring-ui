import { describe, expect, it } from "vitest"
import { evaluateAgentSidebarHardGates, type AgentSidebarHardGateSnapshot } from "../review-specs/workspace-agent-sidebar/hardGates"

function snapshot(requestFailures: AgentSidebarHardGateSnapshot["requestFailures"]): AgentSidebarHardGateSnapshot {
  return {
    stateId: "state",
    checkpoint: "agent-list",
    origin: "http://127.0.0.1:5480",
    viewport: { width: 1440, height: 900, mobile: false },
    documentWidth: { scrollWidth: 1440, clientWidth: 1440 },
    axeViolations: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures,
    httpErrors: [],
    sidebar: {
      agentCount: 2,
      agentHeading: "Agents",
      agentSeatSummary: null,
      agentFilterCount: 1,
      legacyFilterCount: 0,
      visibleActionCount: 0,
      visibleAgentCountLabels: 2,
      expandedRegionCount: 1,
      guideCount: 1,
      pinnedHeading: null,
      pinnedCount: 0,
      pinnedProvenance: null,
      pinnedAgentSessionCount: 0,
      nestedPinnedHasPin: false,
      detailOverlayCount: 0,
      detailTabCount: 0,
      capabilityHeadingCount: 0,
      legacyJargonCount: 0,
      undersizedAgentControls: [],
    },
  }
}

describe("workspace Agent sidebar request-failure gate", () => {
  it("accepts an exact known hydration abort and records its rationale", () => {
    const report = evaluateAgentSidebarHardGates(snapshot([{
      url: "http://127.0.0.1:5480/api/v1/tree?path=.",
      errorText: "net::ERR_ABORTED",
    }]))
    const gate = report.results.find((result) => result.id === "request-failures")
    expect(gate).toMatchObject({ passed: true })
    expect(gate?.evidence).toContain("Initial tree discovery")
  })

  it("rejects lookalike paths instead of hiding them behind an exemption", () => {
    const report = evaluateAgentSidebarHardGates(snapshot([{
      url: "http://127.0.0.1:5480/api/v1/tree-corrupt?path=.",
      errorText: "net::ERR_ABORTED",
    }]))
    const gate = report.results.find((result) => result.id === "request-failures")
    expect(gate).toMatchObject({ passed: false })
    expect(gate?.evidence).toContain("[unexpected]")
  })
})
