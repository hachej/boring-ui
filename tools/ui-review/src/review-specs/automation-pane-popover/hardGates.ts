import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
} from "../../core/contracts"
import type { UiReviewBrowserErrors, UiReviewVisualBaselineResult } from "../../core/reviewSpec"

export const AUTOMATION_UI_HARD_GATE_CONTRACT = {
  contractVersion: "automation-pane-popover-v1",
  minimumTouchWidth: 44,
  minimumTouchHeight: 44,
} as const

const REQUIRED_GATES = [
  "visual-baseline",
  "fixture-ready",
  "console-errors",
  "page-errors",
  "request-failures",
  "http-errors",
  "axe-serious-critical",
  "horizontal-overflow",
  "viewport-bounds",
  "pane-content",
  "editor-state",
  "focused-control-visible",
  "mobile-touch-targets",
] as const

type Bounds = { x: number; y: number; width: number; height: number }

export type AutomationUiHardGateSnapshot = UiReviewBrowserErrors & {
  stateId: string
  checkpoint: string
  visualBaseline: UiReviewVisualBaselineResult
  origin: string
  fixtureName: string | null
  viewport: { width: number; height: number; mobile: boolean }
  documentWidth: { scrollWidth: number; clientWidth: number }
  axeViolations: Array<{ id: string; impact: string; nodes: number }>
  pane: { bounds: Bounds | null; headingVisible: boolean; automationRows: number }
  editor: { visible: boolean; bounds: Bounds | null; title: string | null; formVisible: boolean }
  focusedControl: { label: string; bounds: Bounds; insideEditor: boolean } | null
  undersizedTouchTargets: Array<{ label: string; bounds: Bounds }>
}

export function evaluateAutomationUiHardGates(snapshot: AutomationUiHardGateSnapshot): UiHardGateReport {
  const results: UiHardGateResult[] = []
  const add = (id: string, passed: boolean, evidence: string) => {
    results.push({ id, stateId: snapshot.stateId, passed, evidence })
  }

  add("visual-baseline", snapshot.visualBaseline.passed, snapshot.visualBaseline.evidence)
  add("fixture-ready", snapshot.fixtureName === "automation-pane", `actual=${snapshot.fixtureName ?? "missing"}`)
  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  const unexpectedRequestFailures = snapshot.requestFailures.filter((entry) => {
    try {
      const url = new URL(entry.url)
      return !(url.origin === snapshot.origin && url.pathname === "/api/v1/fs/events" && entry.errorText === "net::ERR_ABORTED")
    } catch {
      return true
    }
  })
  add("request-failures", unexpectedRequestFailures.length === 0, unexpectedRequestFailures.map((entry) => `${entry.errorText} ${entry.url}`).join("\n") || "none")
  add("http-errors", snapshot.httpErrors.length === 0, snapshot.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")

  const seriousAxe = snapshot.axeViolations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  add("axe-serious-critical", seriousAxe.length === 0, seriousAxe.map((violation) => `${violation.impact}:${violation.id}:${violation.nodes}`).join("\n") || "none")
  add("horizontal-overflow", snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth, `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`)

  const bounded = [snapshot.pane.bounds, snapshot.editor.bounds].filter((bounds): bounds is Bounds => bounds !== null)
    .every((bounds) => insideViewport(bounds, snapshot.viewport))
  add("viewport-bounds", bounded, bounded ? "inside" : JSON.stringify({ pane: snapshot.pane.bounds, editor: snapshot.editor.bounds }))
  add("pane-content", snapshot.pane.headingVisible && snapshot.pane.automationRows === 2, `heading=${snapshot.pane.headingVisible};rows=${snapshot.pane.automationRows}`)

  const expectsEditor = snapshot.checkpoint.includes("popover")
  const editorPassed = snapshot.editor.visible === expectsEditor
    && (!expectsEditor || (snapshot.editor.title === "New automation" && snapshot.editor.formVisible))
  add("editor-state", editorPassed, `checkpoint=${snapshot.checkpoint};visible=${snapshot.editor.visible};title=${snapshot.editor.title ?? "none"};form=${snapshot.editor.formVisible}`)

  const focusPassed = !expectsEditor || (snapshot.focusedControl !== null
    && snapshot.focusedControl.insideEditor
    && insideViewport(snapshot.focusedControl.bounds, snapshot.viewport))
  add("focused-control-visible", focusPassed, snapshot.focusedControl ? JSON.stringify(snapshot.focusedControl) : "none")

  const touchFailures = snapshot.viewport.mobile ? snapshot.undersizedTouchTargets : []
  add(
    "mobile-touch-targets",
    touchFailures.length === 0,
    touchFailures.map((target) => `${target.label}:${Math.round(target.bounds.width)}x${Math.round(target.bounds.height)}`).join(", ") || "pass",
  )

  return { schemaVersion: UI_REVIEW_SCHEMA_VERSION, contractVersion: AUTOMATION_UI_HARD_GATE_CONTRACT.contractVersion, results }
}

export function validateAutomationUiHardGateReport(report: UiHardGateReport, manifest: UiReviewManifest): void {
  if (report.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_HARD_GATE_SCHEMA_INVALID")
  if (report.contractVersion !== AUTOMATION_UI_HARD_GATE_CONTRACT.contractVersion) throw new Error("UI_REVIEW_HARD_GATE_CONTRACT_INVALID")
  const stateIds = new Set(manifest.states.map((state) => state.id))
  const expected = new Set(manifest.states.flatMap((state) => REQUIRED_GATES.map((gate) => `${state.id}:${gate}`)))
  const actual = new Set<string>()
  for (const result of report.results) {
    if (!stateIds.has(result.stateId)) throw new Error(`UI_REVIEW_HARD_GATE_STATE_INVALID:${result.stateId}`)
    const key = `${result.stateId}:${result.id}`
    if (!expected.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_ID_INVALID:${key}`)
    if (actual.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_DUPLICATE:${key}`)
    if (typeof result.passed !== "boolean" || typeof result.evidence !== "string" || !result.evidence.trim()) {
      throw new Error(`UI_REVIEW_HARD_GATE_RESULT_INVALID:${key}`)
    }
    actual.add(key)
  }
  const missing = [...expected].find((key) => !actual.has(key))
  if (missing || actual.size !== expected.size) throw new Error(`UI_REVIEW_HARD_GATE_INCOMPLETE:${missing ?? "unexpected-result"}`)
}

function insideViewport(bounds: Bounds, viewport: { width: number; height: number }): boolean {
  return bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width
    && bounds.y + bounds.height <= viewport.height
}
