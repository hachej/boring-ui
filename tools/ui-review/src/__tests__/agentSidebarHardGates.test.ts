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
      capabilityHeadings: [],
      legacyJargonCount: 0,
      actionOverlaps: [],
      undersizedAgentControls: [],
    },
  }
}

describe("workspace Agent sidebar state contract", () => {
  const detailsSnapshot = (overrides: Partial<AgentSidebarHardGateSnapshot["sidebar"]>) => {
    const base = snapshot([])
    return {
      ...base,
      checkpoint: "agent-details" as const,
      sidebar: {
        ...base.sidebar,
        detailOverlayCount: 1,
        capabilityHeadings: [
          "Instructions", "Knowledge", "Skills", "Tools", "MCP access", "Plugins", "System prompt", "Defaults",
        ],
        ...overrides,
      },
    }
  }
  const stateGate = (input: AgentSidebarHardGateSnapshot) =>
    evaluateAgentSidebarHardGates(input).results.find((result) => result.id === "state-contract")

  it("accepts exactly the eight capability sections, in order", () => {
    expect(stateGate(detailsSnapshot({}))).toMatchObject({ passed: true })
  })

  it("rejects a missing section instead of passing on a count floor", () => {
    expect(stateGate(detailsSnapshot({
      capabilityHeadings: ["Instructions", "Knowledge", "Skills", "Tools", "MCP access"],
    }))).toMatchObject({ passed: false })
  })

  it("rejects the right NUMBER of wrong sections", () => {
    expect(stateGate(detailsSnapshot({
      capabilityHeadings: ["A", "B", "C", "D", "E", "F", "G", "H"],
    }))).toMatchObject({ passed: false })
  })

  it("requires hover to REVEAL the hovered Agent's controls, resting to hide them", () => {
    // Two Agents, one resting action each, plus the two the hovered Agent
    // reveals. Six was the DOM count of buttons that exist — the old counter
    // ignored the container opacity doing the hiding, so it passed whether or
    // not hover revealed anything.
    const base = snapshot([])
    const at = (checkpoint: "hover-actions" | "agent-list", visibleActionCount: number) => evaluateAgentSidebarHardGates({
      ...base,
      checkpoint,
      sidebar: { ...base.sidebar, visibleActionCount },
    }).results.find((result) => result.id === "state-contract")
    expect(at("hover-actions", 4)).toMatchObject({ passed: true })
    expect(at("hover-actions", 6)).toMatchObject({ passed: false })
    expect(at("hover-actions", 2)).toMatchObject({ passed: false })
    expect(at("agent-list", 2)).toMatchObject({ passed: true })
    expect(at("agent-list", 6)).toMatchObject({ passed: false })
  })
})

describe("workspace Agent sidebar action-overlap gate", () => {
  const overlapGate = (actionOverlaps: AgentSidebarHardGateSnapshot["sidebar"]["actionOverlaps"]) => {
    const base = snapshot([])
    return evaluateAgentSidebarHardGates({ ...base, sidebar: { ...base.sidebar, actionOverlaps } })
      .results.find((result) => result.id === "session-row-action-overlap")
  }

  it("passes when nothing renders under the hover actions", () => {
    expect(overlapGate([])).toMatchObject({ passed: true })
  })

  it("fails on a title running under the action strip, with the measurement as evidence", () => {
    const gate = overlapGate([{ kind: "title", label: "hi", overlap: 59 }])
    expect(gate).toMatchObject({ passed: false })
    expect(gate?.evidence).toContain("59")
  })

  it("fails on the age label too, not only the title", () => {
    expect(overlapGate([{ kind: "age", label: "9h", overlap: 17 }])).toMatchObject({ passed: false })
  })
})

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
