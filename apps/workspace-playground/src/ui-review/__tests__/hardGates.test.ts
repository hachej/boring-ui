import { describe, expect, it } from "vitest"
import { evaluateCommandPaletteHardGates, type UiHardGateSnapshot } from "../hardGates"

function snapshot(overrides: Partial<UiHardGateSnapshot> = {}): UiHardGateSnapshot {
  return {
    stateId: "state-1",
    origin: "http://127.0.0.1:5380",
    viewport: { width: 390, height: 844, mobile: true },
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    axeViolations: [],
    commandPalette: {
      checkpoint: "open",
      visible: true,
      inputDividerCount: 1,
      dialogWidth: 630,
      keyboardHintsPresent: true,
      commandModePressed: false,
    },
    documentWidth: { scrollWidth: 390, clientWidth: 390 },
    visibleModals: [{ label: "Command palette", bounds: { x: 10, y: 20, width: 370, height: 600 } }],
    focusedControl: { label: "Search", bounds: { x: 20, y: 40, width: 300, height: 48 }, occluded: false },
    undersizedTouchTargets: [],
    ...overrides,
  }
}

describe("command palette hard gates", () => {
  it("passes a bounded error-free state", () => {
    expect(evaluateCommandPaletteHardGates(snapshot()).results.every((result) => result.passed)).toBe(true)
  })

  it("reports deterministic failures and honors named exemptions", () => {
    const report = evaluateCommandPaletteHardGates(snapshot({
      consoleErrors: ["boom"],
      requestFailures: [{ url: "http://localhost/missing", errorText: "net::ERR_FAILED" }],
      axeViolations: [{ id: "aria-required-attr", impact: "serious", nodes: 1 }],
      documentWidth: { scrollWidth: 420, clientWidth: 390 },
      undersizedTouchTargets: [
        { label: "Commands", selector: "mode", bounds: { x: 0, y: 0, width: 40, height: 28 }, exempt: true, rationale: "known segmented mode" },
        { label: "Open", selector: "button", bounds: { x: 0, y: 0, width: 30, height: 30 }, exempt: false },
      ],
    }))
    expect(report.results.filter((result) => !result.passed).map((result) => result.id)).toEqual([
      "console-errors",
      "request-failures",
      "axe-serious-critical",
      "horizontal-overflow",
      "mobile-touch-targets",
    ])
  })

  it("allows only origin-bound exact startup aborts", () => {
    const allowed = evaluateCommandPaletteHardGates(snapshot({
      requestFailures: [{ url: "http://127.0.0.1:5380/api/v1/ready-status", errorText: "net::ERR_ABORTED" }],
    }))
    expect(allowed.results.find((result) => result.id === "request-failures")?.passed).toBe(true)

    const external = evaluateCommandPaletteHardGates(snapshot({
      requestFailures: [{ url: "https://example.com/api/v1/ready-status", errorText: "net::ERR_ABORTED" }],
    }))
    expect(external.results.find((result) => result.id === "request-failures")?.passed).toBe(false)
  })

  it("enforces command-palette chrome invariants as machine-readable gates", () => {
    const report = evaluateCommandPaletteHardGates(snapshot({
      viewport: { width: 1440, height: 900, mobile: false },
      commandPalette: {
        checkpoint: "commands",
        visible: true,
        inputDividerCount: 2,
        dialogWidth: 580,
        keyboardHintsPresent: false,
        commandModePressed: false,
      },
    }))
    expect(report.results.filter((result) => !result.passed).map((result) => result.id)).toEqual([
      "command-palette-input-divider",
      "command-palette-desktop-width",
      "command-palette-keyboard-hints",
      "command-palette-command-mode",
    ])
  })
})
