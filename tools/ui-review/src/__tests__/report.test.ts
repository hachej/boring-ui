import { describe, expect, it } from "vitest"
import { assertHardGatesPermitLiveCritic as assertGatesForSpec, buildPiCriticInvocation, createFixtureCriticReport } from "../core/critic"
import { UI_REVIEW_RUBRIC_VERSION, type UiHardGateReport, type UiReviewManifest } from "../core/contracts"
import { renderUiReviewHtml as renderReportForSpec } from "../core/report"
import { testSpec } from "./fixtures"

const assertHardGatesPermitLiveCritic = (gates: UiHardGateReport, value: UiReviewManifest) => assertGatesForSpec(gates, value, testSpec)
const renderUiReviewHtml = (input: Omit<Parameters<typeof renderReportForSpec>[0], "ownerSpotChecks">) => renderReportForSpec({ ...input, ownerSpotChecks: testSpec.ownerSpotChecks })

const manifest: UiReviewManifest = {
  schemaVersion: 1,
  runId: "run-1",
  scenarioId: "command-palette",
  rubricVersion: UI_REVIEW_RUBRIC_VERSION,
  resolvedModel: "fixture",
  states: [{
    id: "state-1",
    scenarioId: "command-palette",
    role: "candidate",
    checkpoint: "<script>alert(1)</script>",
    viewport: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
    screenshotPath: "selected/desktop/001.png",
    screenshotDigest: "a".repeat(64),
    screenshotBytes: 100,
    source: "bombadil",
    reproducePath: "reproduce/state-1",
    action: { Click: { name: '<script>alert("action")</script>' } },
  }],
  statePairs: [],
}

const hardGates: UiHardGateReport = {
  schemaVersion: 1,
  contractVersion: "command-palette-v2",
  results: [{ id: "console-errors", stateId: "state-1", passed: false, evidence: '<form action="https://example.com">bad</form>' }],
}
const hardGateManifest: UiReviewManifest = {
  ...manifest,
  states: [{ ...manifest.states[0]!, checkpoint: "closed", source: undefined }],
}
const closedGateIds = [
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
]
const completeHardGates: UiHardGateReport = {
  schemaVersion: 1,
  contractVersion: "command-palette-v2",
  results: closedGateIds.map((id) => ({ id, stateId: "state-1", passed: true, evidence: "pass" })),
}

describe("ui review report", () => {
  it("escapes untrusted content and emits a no-active-content CSP", () => {
    const critic = createFixtureCriticReport(manifest)
    critic.visualFindings[0]!.evidence = '<img src="https://example.com/x" onerror="alert(1)">javascript:alert(1)'
    const html = renderUiReviewHtml({ manifest, hardGates, critic })
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'none'")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).not.toContain('<form action="https://example.com">')
    expect(html).not.toContain('<img src="https://example.com/x"')
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("Bombadil exploration")
    expect(html).toContain("&lt;script&gt;alert")
  })

  it("builds a hermetic Pi invocation with explicit attachments", () => {
    const invocation = buildPiCriticInvocation({
      apiKey: "test-key",
      tempHome: "/tmp/ui-home",
      tempConfig: "/tmp/ui-config",
      systemPrompt: "Return JSON",
      criticPromptPath: "/tmp/prompt.md",
      manifestPath: "/tmp/manifest.json",
      schemaPath: "/tmp/UiCriticReportV1.schema.json",
      hardGatesPath: "/tmp/hard-gates.json",
      screenshotPaths: ["/tmp/one.png", "/tmp/two.png"],
    })
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--no-tools",
      "--no-extensions",
      "--no-context-files",
      "@/tmp/UiCriticReportV1.schema.json",
      "@/tmp/hard-gates.json",
      "@/tmp/one.png",
      "@/tmp/two.png",
    ]))
    expect(invocation.args.some((arg) => arg.includes("*"))).toBe(false)
    expect(Object.keys(invocation.env).sort()).toEqual([
      "GEMINI_API_KEY",
      "HOME",
      "PATH",
      "PI_CODING_AGENT_DIR",
      "PI_OFFLINE",
      "PI_TELEMETRY",
    ])
  })

  it("rejects incomplete hard-gate reports and blocks the critic on a failure", () => {
    expect(() => assertHardGatesPermitLiveCritic({ ...completeHardGates, results: [] }, hardGateManifest)).toThrow("UI_REVIEW_HARD_GATE_INCOMPLETE")
    expect(() => assertHardGatesPermitLiveCritic({
      ...completeHardGates,
      results: completeHardGates.results.map((result, index) => index === 0 ? { ...result, passed: false } : result),
    }, hardGateManifest)).toThrow("UI_REVIEW_HARD_GATES_FAILED:state-1")
    expect(() => assertHardGatesPermitLiveCritic(completeHardGates, hardGateManifest)).not.toThrow()
  })

  it("rejects active or remote screenshot paths", () => {
    const unsafe = { ...manifest, states: [{ ...manifest.states[0]!, screenshotPath: "https://example.com/x.png" }] }
    expect(() => renderUiReviewHtml({ manifest: unsafe, hardGates, critic: createFixtureCriticReport(unsafe) })).toThrow("UI_REVIEW_REPORT_SCREENSHOT_PATH_INVALID")
  })
})
