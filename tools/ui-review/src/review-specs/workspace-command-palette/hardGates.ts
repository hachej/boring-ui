import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
  type UiReviewState,
} from "../../core/contracts"
import { COMMAND_PALETTE_TOUCH_EXEMPTIONS } from "./touchPolicy"

export const COMMAND_PALETTE_HARD_GATE_CONTRACT = {
  schemaVersion: UI_REVIEW_SCHEMA_VERSION,
  contractVersion: "command-palette-v2",
  minimumTouchWidth: 44,
  minimumTouchHeight: 44,
  allowedHttpErrors: [] as Array<{ urlIncludes: string; statuses: number[] }>,
  allowedRequestFailures: [
    {
      path: "/api/v1/tree?path=.",
      errorText: "net::ERR_ABORTED",
      rationale: "The fixture shell cancels duplicate startup tree refreshes when its fresh-state reset completes.",
    },
    {
      path: "/api/v1/ready-status",
      errorText: "net::ERR_ABORTED",
      rationale: "The fixture shell cancels its readiness poll after the workspace becomes ready.",
    },
    {
      path: "/api/v1/ui/state",
      errorText: "net::ERR_ABORTED",
      rationale: "The fixture shell supersedes in-flight UI-state refreshes during deterministic startup.",
    },
  ],
  axeExemptions: [
    {
      id: "aria-hidden-focus",
      checkpoint: "closed",
      maxNodes: 1,
      rationale: "Known app-shell hidden-pane focusable outside the closed command-palette surface.",
    },
    {
      id: "color-contrast",
      checkpoint: "closed",
      maxNodes: 1,
      rationale: "Bounded existing fixture-shell contrast finding; any additional node fails.",
    },
    {
      id: "color-contrast",
      checkpoint: "open",
      maxNodes: 3,
      rationale: "Bounded existing command-palette contrast findings; any additional node fails.",
    },
    {
      id: "color-contrast",
      checkpoint: "commands",
      maxNodes: 1,
      rationale: "Bounded existing command-mode contrast finding; any additional node fails.",
    },
    {
      id: "nested-interactive",
      checkpoint: "open",
      maxNodes: 1,
      rationale: "Bounded existing command-result composition finding; any additional node fails.",
    },
  ],
  touchExemptions: COMMAND_PALETTE_TOUCH_EXEMPTIONS,
  allowNestedModal: false,
} as const

export type UiBounds = { x: number; y: number; width: number; height: number }

const ALWAYS_REQUIRED_GATES = [
  "console-errors",
  "page-errors",
  "request-failures",
  "axe-serious-critical",
  "http-errors",
  "horizontal-overflow",
  "modal-viewport-bounds",
  "modal-blocker-count",
  "focused-control-visible",
  "command-palette-visibility",
  "mobile-touch-targets",
] as const

export type UiHardGateSnapshot = {
  stateId: string
  origin: string
  viewport: { width: number; height: number; mobile: boolean }
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: Array<{ url: string; errorText: string }>
  httpErrors: Array<{ url: string; status: number }>
  axeViolations: Array<{ id: string; impact: string; nodes: number }>
  commandPalette: {
    checkpoint: string
    visible: boolean
    inputDividerCount: number
    dialogWidth: number | null
    keyboardHintsPresent: boolean
    commandModePressed: boolean | null
  }
  documentWidth: { scrollWidth: number; clientWidth: number }
  visibleModals: Array<{ label: string; bounds: UiBounds }>
  focusedControl: { label: string; bounds: UiBounds; occluded: boolean } | null
  undersizedTouchTargets: Array<{ label: string; selector: string; bounds: UiBounds; exempt: boolean; rationale?: string }>
}

export function validateCommandPaletteHardGateReport(
  report: UiHardGateReport,
  manifest: UiReviewManifest,
): void {
  if (report.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_HARD_GATE_SCHEMA_INVALID")
  if (report.contractVersion !== COMMAND_PALETTE_HARD_GATE_CONTRACT.contractVersion) {
    throw new Error("UI_REVIEW_HARD_GATE_CONTRACT_INVALID")
  }

  const states = new Map(manifest.states.map((state) => [state.id, state]))
  const expected = new Set(manifest.states.flatMap((state) => (
    expectedGateIds(state).map((gateId) => `${state.id}:${gateId}`)
  )))
  const actual = new Set<string>()
  for (const result of report.results) {
    const state = states.get(result.stateId)
    if (!state) throw new Error(`UI_REVIEW_HARD_GATE_STATE_INVALID:${result.stateId}`)
    const key = `${result.stateId}:${result.id}`
    if (!expected.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_ID_INVALID:${key}`)
    if (actual.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_DUPLICATE:${key}`)
    if (typeof result.passed !== "boolean" || typeof result.evidence !== "string" || !result.evidence.trim()) {
      throw new Error(`UI_REVIEW_HARD_GATE_RESULT_INVALID:${key}`)
    }
    actual.add(key)
  }
  const missing = [...expected].find((key) => !actual.has(key))
  if (missing || actual.size !== expected.size) {
    throw new Error(`UI_REVIEW_HARD_GATE_INCOMPLETE:${missing ?? "unexpected-result"}`)
  }
}

export function evaluateCommandPaletteHardGates(snapshot: UiHardGateSnapshot): UiHardGateReport {
  const contract = COMMAND_PALETTE_HARD_GATE_CONTRACT
  const results: UiHardGateResult[] = []
  const add = (id: string, passed: boolean, evidence: string) => {
    results.push({ id, stateId: snapshot.stateId, passed, evidence })
  }

  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  const unexpectedRequestFailures = snapshot.requestFailures.filter((entry) => !contract.allowedRequestFailures.some((allowed) => {
    try {
      const url = new URL(entry.url)
      return url.origin === snapshot.origin
        && `${url.pathname}${url.search}` === allowed.path
        && entry.errorText === allowed.errorText
    } catch {
      return false
    }
  }))
  add("request-failures", unexpectedRequestFailures.length === 0, snapshot.requestFailures.map((entry) => `${entry.errorText} ${entry.url}`).join("\n") || "none")
  const seriousAxe = snapshot.axeViolations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  const unexpectedAxe = seriousAxe.filter((violation) => !contract.axeExemptions.some((exemption) => (
    exemption.id === violation.id
    && exemption.checkpoint === snapshot.commandPalette.checkpoint
    && violation.nodes <= exemption.maxNodes
  )))
  add(
    "axe-serious-critical",
    unexpectedAxe.length === 0,
    seriousAxe.map((violation) => `${violation.impact}:${violation.id}:${violation.nodes}`).join("\n") || "none",
  )
  const unexpectedHttp = snapshot.httpErrors.filter((entry) => !contract.allowedHttpErrors.some((allowed) => (
    entry.url.includes(allowed.urlIncludes) && allowed.statuses.includes(entry.status)
  )))
  add("http-errors", unexpectedHttp.length === 0, unexpectedHttp.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")
  add(
    "horizontal-overflow",
    snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth,
    `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`,
  )

  const outOfBounds = snapshot.visibleModals.filter(({ bounds }) => !insideViewport(bounds, snapshot.viewport))
  add("modal-viewport-bounds", outOfBounds.length === 0, outOfBounds.map((modal) => modal.label).join(", ") || "inside")
  add(
    "modal-blocker-count",
    contract.allowNestedModal || snapshot.visibleModals.length <= 1,
    `visible=${snapshot.visibleModals.length}`,
  )

  const focusPassed = !snapshot.focusedControl
    || (insideViewport(snapshot.focusedControl.bounds, snapshot.viewport) && !snapshot.focusedControl.occluded)
  add("focused-control-visible", focusPassed, snapshot.focusedControl ? JSON.stringify(snapshot.focusedControl) : "none")

  const palette = snapshot.commandPalette
  const expectedVisible = palette.checkpoint !== "closed"
  add("command-palette-visibility", palette.visible === expectedVisible, `checkpoint=${palette.checkpoint};visible=${palette.visible}`)
  if (expectedVisible) {
    add("command-palette-input-divider", palette.inputDividerCount === 1, `count=${palette.inputDividerCount}`)
    if (!snapshot.viewport.mobile) {
      add("command-palette-desktop-width", palette.dialogWidth !== null && palette.dialogWidth > 600 && palette.dialogWidth <= 640, `width=${palette.dialogWidth ?? "missing"}`)
    }
    add("command-palette-keyboard-hints", palette.keyboardHintsPresent, `present=${palette.keyboardHintsPresent}`)
    add("command-palette-command-mode", palette.commandModePressed === (palette.checkpoint === "commands"), `pressed=${palette.commandModePressed}`)
  }

  const touchFailures = snapshot.viewport.mobile
    ? snapshot.undersizedTouchTargets.filter((target) => !target.exempt)
    : []
  add(
    "mobile-touch-targets",
    touchFailures.length === 0,
    touchFailures.map((target) => `${target.label}:${Math.round(target.bounds.width)}x${Math.round(target.bounds.height)}`).join(", ") || "pass",
  )

  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    contractVersion: contract.contractVersion,
    results,
  }
}

function expectedGateIds(state: UiReviewState): string[] {
  if (state.source === "bombadil") return ["bombadil-properties"]
  const ids: string[] = [...ALWAYS_REQUIRED_GATES]
  if (state.checkpoint !== "closed") {
    ids.push("command-palette-input-divider", "command-palette-keyboard-hints", "command-palette-command-mode")
    if (state.viewport.name === "desktop") ids.push("command-palette-desktop-width")
  }
  return ids
}

function insideViewport(bounds: UiBounds, viewport: { width: number; height: number }): boolean {
  return bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width
    && bounds.y + bounds.height <= viewport.height
}
