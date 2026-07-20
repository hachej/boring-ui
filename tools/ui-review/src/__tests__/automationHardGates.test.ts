import { describe, expect, it } from "vitest"
import {
  evaluateAutomationUiHardGates,
  type AutomationUiHardGateSnapshot,
} from "../review-specs/automation-pane-popover/hardGates"

function snapshot(overrides: Partial<AutomationUiHardGateSnapshot> = {}): AutomationUiHardGateSnapshot {
  return {
    stateId: "automation-state",
    checkpoint: "automation-pane-desktop",
    visualBaseline: { passed: true, evidence: "matched" },
    origin: "http://127.0.0.1:5680",
    fixtureName: "automation-pane",
    viewport: { width: 1_440, height: 900, mobile: false },
    documentWidth: { scrollWidth: 1_440, clientWidth: 1_440 },
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    axeViolations: [],
    pane: {
      bounds: { x: 16, y: 16, width: 480, height: 868 },
      headingVisible: true,
      automationRows: 2,
    },
    editor: { visible: false, bounds: null, title: null, formVisible: false },
    focusedControl: null,
    undersizedTouchTargets: [],
    ...overrides,
  }
}

function result(report: ReturnType<typeof evaluateAutomationUiHardGates>, id: string) {
  return report.results.find((entry) => entry.id === id)
}

describe("automation UI hard gates", () => {
  it("passes a bounded desktop pane", () => {
    const report = evaluateAutomationUiHardGates(snapshot())
    expect(report.results).toHaveLength(13)
    expect(report.results.every((entry) => entry.passed)).toBe(true)
  })

  it("requires the popover, form, and focused control for popover checkpoints", () => {
    const report = evaluateAutomationUiHardGates(snapshot({
      checkpoint: "automation-popover-desktop",
      editor: {
        visible: true,
        bounds: { x: 420, y: 80, width: 600, height: 720 },
        title: "New automation",
        formVisible: true,
      },
      focusedControl: {
        label: "Title",
        bounds: { x: 450, y: 180, width: 240, height: 40 },
        insideEditor: true,
      },
    }))
    expect(result(report, "editor-state")?.passed).toBe(true)
    expect(result(report, "focused-control-visible")?.passed).toBe(true)
  })

  it("fails mobile overflow and undersized controls", () => {
    const report = evaluateAutomationUiHardGates(snapshot({
      checkpoint: "automation-pane-mobile",
      viewport: { width: 390, height: 844, mobile: true },
      documentWidth: { scrollWidth: 520, clientWidth: 390 },
      pane: {
        bounds: { x: 16, y: 16, width: 358, height: 812 },
        headingVisible: true,
        automationRows: 2,
      },
      undersizedTouchTargets: [{ label: "Edit", bounds: { x: 300, y: 100, width: 32, height: 32 } }],
    }))
    expect(result(report, "horizontal-overflow")?.passed).toBe(false)
    expect(result(report, "mobile-touch-targets")?.passed).toBe(false)
  })
})
