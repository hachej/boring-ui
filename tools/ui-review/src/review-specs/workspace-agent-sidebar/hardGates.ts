import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
} from "../../core/contracts"
import type { UiReviewBrowserErrors } from "../../core/reviewSpec"

export const AGENT_SIDEBAR_HARD_GATE_CONTRACT = "workspace-agent-sidebar-v2"

const KNOWN_ABORTED_REQUESTS: Array<{
  rationale: string
  matches: (url: URL) => boolean
}> = [
  { rationale: "Initial filesystem discovery is superseded when the addressed Agent source mounts.", matches: (url) => url.pathname === "/api/v1/filesystems" && url.search === "" },
  { rationale: "Initial tree discovery is superseded by workspace hydration.", matches: (url) => url.pathname === "/api/v1/tree" && url.searchParams.size === 1 && url.searchParams.get("path") === "." },
  { rationale: "UI-state hydration writes can supersede their preceding read.", matches: (url) => url.pathname === "/api/v1/ui/state" && url.search === "" },
  { rationale: "Agent readiness polling is cancelled after readiness resolves.", matches: (url) => /^\/api\/v1\/agents\/[^/]+\/ready-status$/.test(url.pathname) && url.search === "" },
  { rationale: "Workspace command long-poll is cancelled when the page state advances.", matches: (url) => url.pathname === "/api/v1/ui/commands/next" && url.searchParams.size === 1 && url.searchParams.has("workspaceId") },
  { rationale: "Filesystem event stream is cancelled when the review context closes.", matches: (url) => url.pathname === "/api/v1/fs/events" && url.searchParams.size === 1 && url.searchParams.has("workspaceId") },
  { rationale: "Session activity stream is cancelled when switching checkpoints or closing context.", matches: (url) => url.pathname === "/api/v1/agents/session-activity/events" && url.searchParams.size === 1 && url.searchParams.has("workspaceId") },
  { rationale: "Session event long-poll is cancelled when switching checkpoints or closing context.", matches: (url) => /^\/api\/v1\/agents\/[^/]+\/sessions\/[^/]+\/events$/.test(url.pathname) && url.searchParams.size === 1 && url.searchParams.has("cursor") },
]

const REQUIRED_GATES = [
  "fixture-ready",
  "console-errors",
  "page-errors",
  "request-failures",
  "http-errors",
  "horizontal-overflow",
  "axe-serious-critical",
  "state-contract",
  "agent-touch-targets",
] as const

export interface AgentSidebarHardGateSnapshot extends UiReviewBrowserErrors {
  stateId: string
  checkpoint: string
  origin: string
  viewport: { width: number; height: number; mobile: boolean }
  documentWidth: { scrollWidth: number; clientWidth: number }
  axeViolations: Array<{ id: string; impact: string; nodes: number }>
  sidebar: {
    agentCount: number
    agentHeading: string | null
    agentSeatSummary: string | null
    agentFilterCount: number
    legacyFilterCount: number
    visibleActionCount: number
    visibleAgentCountLabels: number
    expandedRegionCount: number
    guideCount: number
    pinnedHeading: string | null
    pinnedCount: number
    pinnedProvenance: string | null
    pinnedAgentSessionCount: number
    nestedPinnedHasPin: boolean
    detailOverlayCount: number
    detailTabCount: number
    configurationHeadingCount: number
    undersizedAgentControls: Array<{ label: string; width: number; height: number }>
  }
}

export function evaluateAgentSidebarHardGates(snapshot: AgentSidebarHardGateSnapshot): UiHardGateReport {
  const results: UiHardGateResult[] = []
  const add = (id: string, passed: boolean, evidence: string) => results.push({ id, stateId: snapshot.stateId, passed, evidence })
  const classifiedFailures = snapshot.requestFailures.map((entry) => {
    try {
      const url = new URL(entry.url)
      const known = url.origin === snapshot.origin && entry.errorText === "net::ERR_ABORTED"
        ? KNOWN_ABORTED_REQUESTS.find((candidate) => candidate.matches(url))
        : undefined
      return { entry, rationale: known?.rationale }
    } catch {
      return { entry, rationale: undefined }
    }
  })
  const unexpectedFailures = classifiedFailures.filter((failure) => !failure.rationale)
  const state = snapshot.sidebar
  const agentNavigationExpected = snapshot.checkpoint !== "agent-details" || !snapshot.viewport.mobile
  const surfaceReady = snapshot.checkpoint === "agent-details" ? state.detailOverlayCount === 1 : state.agentCount === 2
  const statePassed = surfaceReady
    && (!agentNavigationExpected || (state.agentCount === 2 && state.agentHeading === "Agents" && state.agentFilterCount === 1))
    && state.legacyFilterCount === 0
    && (snapshot.checkpoint !== "hover-actions" || state.visibleActionCount >= 4)
    && (snapshot.checkpoint !== "expanded-sessions" || (state.expandedRegionCount >= 2 && state.guideCount >= 2))
    && (snapshot.checkpoint !== "pinned-chat" || (state.pinnedHeading === "Pinned chats" && state.pinnedCount === 1 && state.pinnedProvenance === "Alpha" && state.pinnedAgentSessionCount >= 1 && state.nestedPinnedHasPin))
    && (snapshot.checkpoint !== "agent-details" || (state.detailOverlayCount === 1 && state.detailTabCount === 0 && state.configurationHeadingCount === 1))
    && (!snapshot.viewport.mobile || snapshot.checkpoint !== "agent-list" || (state.visibleActionCount >= 8 && state.visibleAgentCountLabels === 2))

  add("fixture-ready", surfaceReady, `agentCount=${state.agentCount};detailOverlayCount=${state.detailOverlayCount}`)
  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  add("request-failures", unexpectedFailures.length === 0, classifiedFailures.map(({ entry, rationale }) => `${entry.errorText} ${entry.url}${rationale ? ` [expected: ${rationale}]` : " [unexpected]"}`).join("\n") || "none observed")
  add("http-errors", snapshot.httpErrors.length === 0, snapshot.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")
  add("horizontal-overflow", snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth, `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`)
  add("axe-serious-critical", snapshot.axeViolations.length === 0, snapshot.axeViolations.map((entry) => `${entry.impact}:${entry.id}:${entry.nodes}`).join("\n") || "none")
  add("state-contract", statePassed, JSON.stringify(state))
  add("agent-touch-targets", !snapshot.viewport.mobile || state.undersizedAgentControls.length === 0, JSON.stringify(state.undersizedAgentControls))
  return { schemaVersion: UI_REVIEW_SCHEMA_VERSION, contractVersion: AGENT_SIDEBAR_HARD_GATE_CONTRACT, results }
}

export function validateAgentSidebarHardGateReport(report: UiHardGateReport, manifest: UiReviewManifest): void {
  if (report.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_HARD_GATE_SCHEMA_INVALID")
  if (report.contractVersion !== AGENT_SIDEBAR_HARD_GATE_CONTRACT) throw new Error("UI_REVIEW_HARD_GATE_CONTRACT_INVALID")
  const stateIds = new Set(manifest.states.map((state) => state.id))
  const expected = new Set(manifest.states.flatMap((state) => REQUIRED_GATES.map((gate) => `${state.id}:${gate}`)))
  const actual = new Set<string>()
  for (const result of report.results) {
    if (!stateIds.has(result.stateId)) throw new Error(`UI_REVIEW_HARD_GATE_STATE_INVALID:${result.stateId}`)
    const key = `${result.stateId}:${result.id}`
    if (!expected.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_ID_INVALID:${key}`)
    if (actual.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_DUPLICATE:${key}`)
    if (typeof result.passed !== "boolean" || !result.evidence.trim()) throw new Error(`UI_REVIEW_HARD_GATE_RESULT_INVALID:${key}`)
    actual.add(key)
  }
  const missing = [...expected].find((key) => !actual.has(key))
  if (missing || actual.size !== expected.size) throw new Error(`UI_REVIEW_HARD_GATE_INCOMPLETE:${missing ?? "unexpected-result"}`)
}
