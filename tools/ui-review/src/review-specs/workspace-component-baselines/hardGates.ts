import {
  UI_REVIEW_SCHEMA_VERSION,
  type UiHardGateReport,
  type UiHardGateResult,
  type UiReviewManifest,
} from "../../core/contracts"
import type { UiReviewBrowserErrors, UiReviewVisualBaselineResult } from "../../core/reviewSpec"

export const WORKSPACE_COMPONENT_HARD_GATE_CONTRACT = "workspace-component-baselines-v1"

const REQUIRED_GATES = [
  "visual-baseline",
  "fixture-ready",
  "console-errors",
  "page-errors",
  "request-failures",
  "http-errors",
  "horizontal-overflow",
] as const

export type WorkspaceComponentHardGateSnapshot = UiReviewBrowserErrors & {
  stateId: string
  checkpoint: string
  origin: string
  visualBaseline: UiReviewVisualBaselineResult
  fixtureName: string | null
  documentWidth: { scrollWidth: number; clientWidth: number }
}

export function evaluateWorkspaceComponentHardGates(snapshot: WorkspaceComponentHardGateSnapshot): UiHardGateReport {
  const results: UiHardGateResult[] = []
  const add = (id: string, passed: boolean, evidence: string) => {
    results.push({ id, stateId: snapshot.stateId, passed, evidence })
  }
  add("visual-baseline", snapshot.visualBaseline.passed, snapshot.visualBaseline.evidence)
  add("fixture-ready", snapshot.fixtureName === snapshot.checkpoint, `expected=${snapshot.checkpoint};actual=${snapshot.fixtureName ?? "missing"}`)
  add("console-errors", snapshot.consoleErrors.length === 0, snapshot.consoleErrors.join("\n") || "none")
  add("page-errors", snapshot.pageErrors.length === 0, snapshot.pageErrors.join("\n") || "none")
  const unexpectedRequestFailures = snapshot.requestFailures.filter((entry) => {
    try {
      const url = new URL(entry.url)
      return !(url.origin === snapshot.origin
        && `${url.pathname}${url.search}` === "/api/v1/tree?path=."
        && entry.errorText === "net::ERR_ABORTED")
    } catch {
      return true
    }
  })
  add("request-failures", unexpectedRequestFailures.length === 0, snapshot.requestFailures.map((entry) => `${entry.errorText} ${entry.url}`).join("\n") || "none")
  add("http-errors", snapshot.httpErrors.length === 0, snapshot.httpErrors.map((entry) => `${entry.status} ${entry.url}`).join("\n") || "none")
  add("horizontal-overflow", snapshot.documentWidth.scrollWidth <= snapshot.documentWidth.clientWidth, `${snapshot.documentWidth.scrollWidth}/${snapshot.documentWidth.clientWidth}`)
  return { schemaVersion: UI_REVIEW_SCHEMA_VERSION, contractVersion: WORKSPACE_COMPONENT_HARD_GATE_CONTRACT, results }
}

export function validateWorkspaceComponentHardGateReport(report: UiHardGateReport, manifest: UiReviewManifest): void {
  if (report.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_HARD_GATE_SCHEMA_INVALID")
  if (report.contractVersion !== WORKSPACE_COMPONENT_HARD_GATE_CONTRACT) throw new Error("UI_REVIEW_HARD_GATE_CONTRACT_INVALID")
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
