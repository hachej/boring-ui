import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { sha256Hex, type UiCriticReport, type UiHardGateReport, type UiReviewManifest } from "../core/contracts"
import {
  createCalibrationRecord as createCalibrationForSpec,
  createExecutionPacket as createPacketForSpec,
  validateCalibrationRecord as validateCalibrationForSpec,
  validateCalibrationReviewConsistency,
  validateExecutionPacket as validatePacketForSpec,
  validateExecutionPacketEvidence,
} from "../core/improvement"
import { testSpec } from "./fixtures"

const createExecutionPacket = (input: Omit<Parameters<typeof createPacketForSpec>[0], "spec">) => createPacketForSpec({ ...input, spec: testSpec })
const createCalibrationRecord = (input: Omit<Parameters<typeof createCalibrationForSpec>[0], "spec">) => createCalibrationForSpec({ ...input, spec: testSpec })
const validateExecutionPacket = (raw: unknown, value: UiReviewManifest) => validatePacketForSpec(raw, value, testSpec)
const validateCalibrationRecord = (raw: unknown) => validateCalibrationForSpec(raw, testSpec)

const stateId = "run:command-palette:candidate:desktop:closed:aaaaaaaaaaaa"
const manifest: UiReviewManifest = {
  schemaVersion: 1,
  runId: "run",
  scenarioId: "command-palette",
  rubricVersion: "impeccable-v1",
  resolvedModel: "fixture",
  candidateRevision: "a".repeat(40),
  candidateTreeHash: "9".repeat(64),
  states: [{
    id: stateId,
    scenarioId: "command-palette",
    role: "candidate",
    checkpoint: "closed",
    viewport: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
    screenshotPath: "selected/desktop/closed.png",
    screenshotDigest: "b".repeat(64),
    screenshotBytes: 10,
  }],
  statePairs: [],
}
const hardGates: UiHardGateReport = {
  schemaVersion: 1,
  contractVersion: "command-palette-v2",
  results: [
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
  ].map((id) => ({ id, stateId, passed: true, evidence: "pass" })),
}

function score(value: number) {
  return {
    overall: value,
    dimensions: {
      hierarchy: value,
      spacingAlignment: value,
      typographyColor: value,
      consistency: value,
      interactionStates: value,
      responsiveAccessibility: value,
    },
  }
}

function critic(): UiCriticReport {
  return {
    schemaVersion: 1,
    mode: "candidate",
    confidence: 0.9,
    candidate: score(8),
    visualFindings: [],
    topFixes: [0.81, 0.99, 0.79, 0.9, 0.8].map((confidence, index) => ({
      stateIds: [stateId],
      problem: `problem-${index}<script>alert(1)</script>`,
      recommendation: `recommendation-${index} javascript:alert(1)`,
      confidence,
    })),
  }
}

function calibrationRecord() {
  return {
    schemaVersion: 1 as const,
    scenarioId: "command-palette" as const,
    candidateRevision: "a".repeat(40),
    candidateTreeHash: "9".repeat(64),
    score: { candidate: score(8) },
    confidence: 0.9,
    promptHash: "c".repeat(64),
    rubricHash: "d".repeat(64),
    manifestHash: "e".repeat(64),
    screenshotDigests: ["b".repeat(64)],
    resolvedModel: "fixture",
    ownerDisposition: "pending" as const,
  }
}

async function artifactRoot() {
  const root = await mkdtemp(join(tmpdir(), "ui-improvement."))
  await mkdir(join(root, "selected", "desktop"), { recursive: true })
  const review = critic()
  const calibration = calibrationRecord()
  const reportHtml = "<!doctype html><title>review</title>"
  await Promise.all([
    writeFile(join(root, "manifest.json"), JSON.stringify(manifest), "utf8"),
    writeFile(join(root, "hard-gates.json"), JSON.stringify(hardGates), "utf8"),
    writeFile(join(root, "critic.json"), JSON.stringify(review), "utf8"),
    writeFile(join(root, "report.html"), reportHtml, "utf8"),
    writeFile(join(root, "calibration.json"), JSON.stringify(calibration), "utf8"),
  ])
  return { root, review, calibration, reportHtml }
}

describe("bounded UI improvement", () => {
  it("selects at most three fixes at the documented 0.8 threshold and emits strict no-authority evidence", async () => {
    const artifacts = await artifactRoot()
    const packet = await createExecutionPacket({ root: artifacts.root, manifest, hardGates, critic: artifacts.review, calibration: artifacts.calibration, reportHtml: artifacts.reportHtml })
    expect(packet.fixes.map((fix) => fix.confidence)).toEqual([0.99, 0.9, 0.81])
    expect(packet.budget).toEqual({ maxRounds: 2, maxFixesPerRound: 3, fixConfidenceThreshold: 0.8 })
    expect(packet.executionOwner).toBe("/skill:exec")
    expect(packet.authority).toEqual({ mayEdit: false, mayMerge: false })
    expect(packet.evidence.report.path).toBe("report.html")
    expect(packet.handoff.ownerSpotChecks).toHaveLength(5)
    expect(() => validateExecutionPacket(packet, manifest)).not.toThrow()
  })

  it("rejects packet authority, bounds, hallucinated state ids, unknown fields, and failed gates", async () => {
    const artifacts = await artifactRoot()
    const packet = await createExecutionPacket({ root: artifacts.root, manifest, hardGates, critic: artifacts.review, calibration: artifacts.calibration, reportHtml: artifacts.reportHtml })
    expect(() => validateExecutionPacket({ ...packet, authority: { mayEdit: true, mayMerge: false } }, manifest)).toThrow("UI_EXECUTION_PACKET_AUTHORITY_INVALID")
    expect(() => validateExecutionPacket({ ...packet, budget: { ...packet.budget, maxRounds: 3 } }, manifest)).toThrow("UI_EXECUTION_PACKET_BUDGET_INVALID")
    expect(() => validateExecutionPacket({ ...packet, fixes: [{ ...packet.fixes[0]!, stateIds: ["invented"] }] }, manifest)).toThrow("UI_EXECUTION_PACKET_FIX_INVALID")
    expect(() => validateExecutionPacket({ ...packet, injected: "<script>" }, manifest)).toThrow("UI_STRICT_SCHEMA_INVALID:packet:unknown=injected")
    await expect(createExecutionPacket({ root: artifacts.root, manifest, hardGates: { ...hardGates, results: hardGates.results.map((result, index) => index === 0 ? { ...result, passed: false } : result) }, critic: artifacts.review, calibration: artifacts.calibration, reportHtml: artifacts.reportHtml })).rejects.toThrow("UI_IMPROVEMENT_HARD_GATES_FAILED")
    await writeFile(join(artifacts.root, "report.html"), "tampered", "utf8")
    await expect(validateExecutionPacketEvidence(artifacts.root, packet)).rejects.toThrow("UI_EXECUTION_PACKET_EVIDENCE_DIGEST_MISMATCH:report")
    await expect(createExecutionPacket({ root: artifacts.root, manifest, hardGates, critic: artifacts.review, calibration: artifacts.calibration, reportHtml: artifacts.reportHtml })).rejects.toThrow("UI_EXECUTION_PACKET_ARTIFACT_MISMATCH:report")
  })

  it("generates calibration hashes and metadata without screenshot bodies", async () => {
    const artifacts = await artifactRoot()
    const rubricPath = join(artifacts.root, "rubric.md")
    await writeFile(join(artifacts.root, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8")
    await writeFile(rubricPath, "precise calm rubric", "utf8")
    const record = await createCalibrationRecord({ root: artifacts.root, manifest, critic: critic(), prompt: "critic prompt", rubricPath })
    expect(record).toMatchObject({
      schemaVersion: 1,
      scenarioId: "command-palette",
      candidateRevision: "a".repeat(40),
      candidateTreeHash: "9".repeat(64),
      confidence: 0.9,
      ownerDisposition: "pending",
      screenshotDigests: ["b".repeat(64)],
    })
    expect(record.promptHash).toBe(sha256Hex(new TextEncoder().encode("critic prompt")))
    expect(JSON.stringify(record)).not.toContain("selected/desktop")
    expect(() => validateCalibrationRecord(record)).not.toThrow()
    expect(() => validateCalibrationReviewConsistency({
      calibration: record,
      manifest,
      critic: critic(),
      promptHash: record.promptHash,
      rubricHash: record.rubricHash,
      manifestHash: record.manifestHash,
    })).not.toThrow()
    expect(() => validateCalibrationReviewConsistency({
      calibration: record,
      manifest: { ...manifest, candidateRevision: "f".repeat(40) },
      critic: critic(),
      promptHash: record.promptHash,
      rubricHash: record.rubricHash,
      manifestHash: record.manifestHash,
    })).toThrow("UI_CALIBRATION_REVIEW_MISMATCH:candidateRevision")
    expect(() => validateCalibrationRecord({ ...record, screenshotBody: "private" })).toThrow("UI_STRICT_SCHEMA_INVALID:calibration:unknown=screenshotBody")
  })
})
