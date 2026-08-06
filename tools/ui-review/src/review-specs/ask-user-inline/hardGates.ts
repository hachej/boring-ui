import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
} from "../../core/contracts"
import type { UiReviewBrowserErrors } from "../../core/reviewSpec"

export const ASK_USER_INLINE_HARD_GATE_CONTRACT = {
  contractVersion: "ask-user-inline-v1",
  minimumTouchWidth: 44,
  minimumTouchHeight: 44,
} as const

const REQUIRED_GATES = [
  "fixture-ready",
  "console-errors",
  "page-errors",
  "request-failures",
  "http-errors",
  "axe-serious-critical",
  "horizontal-overflow",
  "surface-bounds",
  "single-presentation",
  "checkpoint-state",
  "raw-json-hidden",
  "focused-control-visible",
  "mobile-touch-targets",
] as const

type Bounds = { x: number; y: number; width: number; height: number }

export type AskUserInlineHardGateSnapshot = UiReviewBrowserErrors & {
  stateId: string
  checkpoint: string
  origin: string
  fixtureName: string | null
  viewport: { width: number; height: number; mobile: boolean }
  documentWidth: { scrollWidth: number; clientWidth: number }
  axeViolations: Array<{ id: string; impact: string; nodes: number }>
  question: {
    bounds: Bounds | null
    inlineCount: number
    resolvedCount: number
    paneCount: number
    selectedValue: string | null
    submitLabel: string | null
    rawSchemaVisible: boolean
  }
  focusedControl: { label: string; bounds: Bounds; occluded: boolean } | null
  undersizedTouchTargets: Array<{ label: string; bounds: Bounds }>
}

export function evaluateAskUserInlineHardGates(snapshot: AskUserInlineHardGateSnapshot): UiHardGateReport {
  const results: UiHardGateResult[] = []
  const add = (id: string, passed: boolean, evidence: string) => results.push({ id, stateId: snapshot.stateId, passed, evidence })

  add("fixture-ready", snapshot.fixtureName === "ask-user-inline", `actual=${snapshot.fixtureName ?? "missing"}`)
  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  add("request-failures", snapshot.requestFailures.length === 0, snapshot.requestFailures.map((entry) => `${entry.errorText} ${entry.url}`).join("\n") || "none")
  add("http-errors", snapshot.httpErrors.length === 0, snapshot.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")
  const seriousAxe = snapshot.axeViolations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
  add("axe-serious-critical", seriousAxe.length === 0, seriousAxe.map((violation) => `${violation.impact}:${violation.id}:${violation.nodes}`).join("\n") || "none")
  add("horizontal-overflow", snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth, `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`)
  add("surface-bounds", snapshot.question.bounds !== null && insideViewport(snapshot.question.bounds, snapshot.viewport), JSON.stringify(snapshot.question.bounds))
  add("single-presentation", snapshot.question.paneCount === 0 && snapshot.question.inlineCount <= 1 && snapshot.question.resolvedCount <= 1, `pane=${snapshot.question.paneCount};inline=${snapshot.question.inlineCount};resolved=${snapshot.question.resolvedCount}`)

  const expected = snapshot.checkpoint === "resolved"
    ? snapshot.question.inlineCount === 0 && snapshot.question.resolvedCount === 1
    : snapshot.question.inlineCount === 1
      && snapshot.question.resolvedCount === 0
      && snapshot.question.submitLabel === "Continue"
      && (snapshot.checkpoint !== "selected" || snapshot.question.selectedValue?.startsWith("Request changes") === true)
  add("checkpoint-state", expected, `checkpoint=${snapshot.checkpoint};selected=${snapshot.question.selectedValue ?? "none"};submit=${snapshot.question.submitLabel ?? "none"}`)
  add("raw-json-hidden", !snapshot.question.rawSchemaVisible, `visible=${snapshot.question.rawSchemaVisible}`)

  const focusPassed = !snapshot.focusedControl || (insideViewport(snapshot.focusedControl.bounds, snapshot.viewport) && !snapshot.focusedControl.occluded)
  add("focused-control-visible", focusPassed, snapshot.focusedControl ? JSON.stringify(snapshot.focusedControl) : "none")
  const touchFailures = snapshot.viewport.mobile ? snapshot.undersizedTouchTargets : []
  add("mobile-touch-targets", touchFailures.length === 0, touchFailures.map((target) => `${target.label}:${Math.round(target.bounds.width)}x${Math.round(target.bounds.height)}`).join(", ") || "pass")

  return { schemaVersion: UI_REVIEW_SCHEMA_VERSION, contractVersion: ASK_USER_INLINE_HARD_GATE_CONTRACT.contractVersion, results }
}

export function validateAskUserInlineHardGateReport(report: UiHardGateReport, manifest: UiReviewManifest): void {
  if (report.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_HARD_GATE_SCHEMA_INVALID")
  if (report.contractVersion !== ASK_USER_INLINE_HARD_GATE_CONTRACT.contractVersion) throw new Error("UI_REVIEW_HARD_GATE_CONTRACT_INVALID")
  const stateIds = new Set(manifest.states.map((state) => state.id))
  const expected = new Set(manifest.states.flatMap((state) => REQUIRED_GATES.map((gate) => `${state.id}:${gate}`)))
  const actual = new Set<string>()
  for (const result of report.results) {
    if (!stateIds.has(result.stateId)) throw new Error(`UI_REVIEW_HARD_GATE_STATE_INVALID:${result.stateId}`)
    const key = `${result.stateId}:${result.id}`
    if (!expected.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_ID_INVALID:${key}`)
    if (actual.has(key)) throw new Error(`UI_REVIEW_HARD_GATE_DUPLICATE:${key}`)
    actual.add(key)
  }
  const missing = [...expected].find((key) => !actual.has(key))
  if (missing || actual.size !== expected.size) throw new Error(`UI_REVIEW_HARD_GATE_INCOMPLETE:${missing ?? "unexpected-result"}`)
}

function insideViewport(bounds: Bounds, viewport: { width: number; height: number }): boolean {
  return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height
}
