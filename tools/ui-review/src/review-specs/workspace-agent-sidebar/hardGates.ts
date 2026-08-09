import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
} from "../../core/contracts"
import type { UiReviewBrowserErrors } from "../../core/reviewSpec"

// v8 adds the viewport bands this contract used to be blind to. v5-v7 sampled
// only 1440-fine and 390-coarse, so any rule keyed to viewport WIDTH agreed
// with any rule keyed to POINTER TYPE at both sampled points and could
// disagree everywhere else. The snapshot now reports the pointer explicitly
// instead of inferring it from a viewport named "mobile", and the touch-target
// and always-visible-action expectations are keyed to the conditions the CSS
// actually uses.
//
// Carried forward from v5-v7:
// - Agent details is a capability inventory (Instructions / Knowledge /
//   Skills / Tools / MCP access / Plugins / Defaults; "System prompt" left in
//   v12): a capability-heading gate plus a jargon ban, and the no-tabs invariant.
// - Agent rows expose "New chat" (+), the "..." options trigger holding the
//   placement variants, and Settings; the action count recognises the trigger.
// v9 adds the two axes v8 was blind to. The overlap gate swept HORIZONTALLY
// and asked only whether row content sits under the strip; nothing asked
// whether a pixel inside the strip belongs to an action, and nothing asked
// whether the row title survived the reservations made around it. Both were
// broken in bands v8 already sampled.
// v10 follows the controls that left the pane. `agent-touch-targets` swept the
// `app-left-pane` SUBTREE, and consolidating the three placement icons behind a
// "..." trigger moved those three actions into a Radix menu portalled to
// <body> — out of the subtree, out of the sweep, and back to the 32px desktop
// menu density on touch, with the gate green throughout. The sweep now also
// matches the app-left menu part hook, and a coarse-only `agent-card-menu`
// checkpoint leaves that menu open so there is something to measure.
// v11 follows the Agents section becoming a static title. The heading was the
// label of a collapse toggle, so `agentHeading` was collected from inside a
// button and the section could be closed; it is now a plain heading beside a
// right-aligned seat summary, and the Agent list is unconditionally rendered.
// The revision bump matters because a replayed v10 manifest was captured
// against a surface where "Agents" could be absent by user action — the same
// snapshot field means a different thing now. `agentSeatSummary` was collected
// but never asserted, which is how it drifted onto a bare numeric span once
// already; v11 asserts it.
// v12 follows the "System prompt" section leaving the Agent details overlay.
// The owner judged the generated composed prompt unhelpful — a wall of text no
// operator could act on — so the section, its preview/expand affordances and
// its "Open in workbench" materialization were removed, and the `systemPrompt`
// field left the `/describe` payload with them. `capabilityHeadings` is an
// ORDERED SET, so a replayed v11 manifest would assert a heading that can no
// longer exist; the contract must move with it rather than let a stale replay
// pass against a surface that legitimately changed shape.
export const AGENT_SIDEBAR_HARD_GATE_CONTRACT = "workspace-agent-sidebar-v12"

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
  "session-row-action-overlap",
  "session-row-action-fallthrough",
  "session-row-title-legible",
  "agent-touch-targets",
] as const

export interface AgentSidebarHardGateSnapshot extends UiReviewBrowserErrors {
  stateId: string
  checkpoint: string
  origin: string
  /**
   * The two conditions the sidebar branches on, kept apart on purpose:
   * `mobileShell` is a WIDTH switch (the JS `viewport < 640` sheet) and
   * `coarsePointer` is a POINTER media condition. Folding them into one
   * "mobile" boolean is what let a width-keyed rule and a pointer-keyed rule
   * disagree unobserved.
   */
  viewport: { width: number; height: number; mobileShell: boolean; coarsePointer: boolean }
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
    capabilityHeadings: string[]
    legacyJargonCount: number
    actionOverlaps: Array<{ kind: string; label: string; overlap: number }>
    actionFallthrough: Array<{ session: string; pixels: number; sample: string[] }>
    illegibleTitles: Array<{ session: string; width: number; trailing: string }>
    undersizedAgentControls: Array<{ label: string; width: number; height: number }>
  }
}

/** The fixture fleet: exactly two Agents, each with three row controls. */
const EXPECTED_AGENT_COUNT = 2
const AGENT_ROW_ACTIONS_PER_AGENT = 3
/** "New chat with X" sits outside the fading strip; the other two do not. */
const AGENT_ROW_RESTING_ACTIONS_PER_AGENT = 1
const AGENT_ROW_RESTING_ACTIONS = AGENT_ROW_RESTING_ACTIONS_PER_AGENT * EXPECTED_AGENT_COUNT
const AGENT_ROW_ACTIONS = AGENT_ROW_ACTIONS_PER_AGENT * EXPECTED_AGENT_COUNT
/**
 * One Agent shows all of its actions; every OTHER Agent shows only its resting
 * one. Written as a whole-fleet sum rather than "the resting total plus a
 * per-Agent delta", which happened to be right for two Agents and silently
 * wrong for any other fleet size.
 */
const AGENT_ROW_HOVER_ACTIONS = AGENT_ROW_ACTIONS_PER_AGENT
  + AGENT_ROW_RESTING_ACTIONS_PER_AGENT * (EXPECTED_AGENT_COUNT - 1)

/** Every section the Agent details panel owes the operator, in order. */
const EXPECTED_CAPABILITY_HEADINGS = [
  "Instructions", "Knowledge", "Skills", "Tools", "MCP access", "Plugins", "Defaults",
] as const

function sameHeadings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((heading, index) => heading === expected[index])
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
  const agentNavigationExpected = snapshot.checkpoint !== "agent-details" || !snapshot.viewport.mobileShell
  // Agent-card actions stop hiding behind hover under EITHER of the two
  // conditions globals.css uses: `(max-width: 767px), (hover: none)`. Keyed to
  // the same union the stylesheet is, so the two cannot drift apart.
  const actionsAlwaysVisible = snapshot.viewport.coarsePointer || snapshot.viewport.width <= 767
  const surfaceReady = snapshot.checkpoint === "agent-details" ? state.detailOverlayCount === 1 : state.agentCount === 2
  const statePassed = surfaceReady
    && (!agentNavigationExpected || (state.agentCount === 2 && state.agentHeading === "Agents" && state.agentSeatSummary === "2 seats" && state.agentFilterCount === 1))
    && state.legacyFilterCount === 0
    // Hover REVEALS: the resting pane shows one action per Agent, and
    // hovering one Agent row adds exactly that Agent's other two. The old
    // 3x2 expectation only held because the counter ignored the container
    // opacity that does the hiding — it proved the buttons exist in the DOM,
    // which is not what discoverability means.
    && (snapshot.checkpoint !== "hover-actions" || state.visibleActionCount === (actionsAlwaysVisible ? AGENT_ROW_ACTIONS : AGENT_ROW_HOVER_ACTIONS))
    && (actionsAlwaysVisible || snapshot.checkpoint !== "agent-list" || state.visibleActionCount === AGENT_ROW_RESTING_ACTIONS)
    && (snapshot.checkpoint !== "expanded-sessions" || (state.expandedRegionCount >= 2 && state.guideCount >= 2))
    && (snapshot.checkpoint !== "pinned-chat" || (state.pinnedHeading === "Pinned chats" && state.pinnedCount === 1 && state.pinnedProvenance === "Alpha" && state.pinnedAgentSessionCount >= 1 && state.nestedPinnedHasPin))
    && (snapshot.checkpoint !== "agent-details" || (
      state.detailOverlayCount === 1
      && state.detailTabCount === 0
      && sameHeadings(state.capabilityHeadings, EXPECTED_CAPABILITY_HEADINGS)
      && state.legacyJargonCount === 0
    ))
    // Where hover cannot reveal them, "+", the "..." options trigger and
    // Settings are all directly visible per Agent.
    && (!actionsAlwaysVisible || snapshot.checkpoint !== "agent-list" || (
      state.visibleActionCount === AGENT_ROW_ACTIONS
      && state.visibleAgentCountLabels === EXPECTED_AGENT_COUNT
    ))

  add("fixture-ready", surfaceReady, `agentCount=${state.agentCount};detailOverlayCount=${state.detailOverlayCount}`)
  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  add("request-failures", unexpectedFailures.length === 0, classifiedFailures.map(({ entry, rationale }) => `${entry.errorText} ${entry.url}${rationale ? ` [expected: ${rationale}]` : " [unexpected]"}`).join("\n") || "none observed")
  add("http-errors", snapshot.httpErrors.length === 0, snapshot.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")
  add("horizontal-overflow", snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth, `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`)
  add("axe-serious-critical", snapshot.axeViolations.length === 0, snapshot.axeViolations.map((entry) => `${entry.impact}:${entry.id}:${entry.nodes}`).join("\n") || "none")
  add("state-contract", statePassed, JSON.stringify(state))
  // Row content must never render underneath the hover action strip. The
  // trailing slot reserves the strip's width for every variant; when that
  // reservation regresses, the title and the age silently sit under
  // background-less icon buttons.
  add("session-row-action-overlap", state.actionOverlaps.length === 0, JSON.stringify(state.actionOverlaps))
  // The mirror of the overlap gate, on both axes. Every pixel of the action
  // strip must belong to an action; a pixel that falls through to the row
  // button switches chats when the user aimed at the icon they can see.
  add("session-row-action-fallthrough", state.actionFallthrough.length === 0, JSON.stringify(state.actionFallthrough))
  // The title is what identifies the row. No reservation — badge ceiling,
  // owner ceiling, action strip — may take all of it.
  add("session-row-title-legible", state.illegibleTitles.length === 0, JSON.stringify(state.illegibleTitles))
  // Keyed to the POINTER, like the 44px rules themselves — not to a narrow
  // viewport, which is neither necessary nor sufficient for a coarse pointer.
  add("agent-touch-targets", !snapshot.viewport.coarsePointer || state.undersizedAgentControls.length === 0, JSON.stringify(state.undersizedAgentControls))
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
