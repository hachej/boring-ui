import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  UI_REVIEW_SCHEMA_VERSION,
  sha256Hex,
  validateUiCriticReport,
  validateUiReviewManifest,
  type UiCriticReport,
  type UiHardGateReport,
  type UiReviewManifest,
  type UiScore,
  type UiTopFix,
} from "./contracts"
import type { UiReviewSpec } from "./reviewSpec"

export const UI_IMPROVEMENT_FIX_CONFIDENCE_THRESHOLD = 0.8
export const UI_IMPROVEMENT_MAX_FIXES_PER_ROUND = 3
export const UI_IMPROVEMENT_MAX_ROUNDS = 2

export const UI_IMPROVEMENT_STOP_CONDITIONS = [
  "all-hard-gates-green-and-no-material-high-confidence-fix-remains",
  "score-or-signed-delta-stalled",
  "remaining-fixes-subjective-or-out-of-scope",
  "two-round-limit-reached",
  "review-budget-exceeded",
] as const

export type UiCalibrationRecordV1 = {
  schemaVersion: 1
  scenarioId: string
  baselineRevision?: string
  baselineTreeHash?: string
  candidateRevision?: string
  candidateTreeHash?: string
  score: { baseline?: UiScore; candidate: UiScore }
  confidence: number
  promptHash: string
  rubricHash: string
  manifestHash: string
  screenshotDigests: string[]
  resolvedModel: string
  ownerDisposition: "pending" | "approved" | "request-changes"
}

export type UiExecutionPacketV1 = {
  schemaVersion: 1
  kind: "ui-improvement-execution-packet"
  scenarioId: string
  sourceRunId: string
  executionOwner: "/skill:exec"
  authority: { mayEdit: false; mayMerge: false }
  budget: {
    maxRounds: 2
    maxFixesPerRound: 3
    fixConfidenceThreshold: 0.8
  }
  fixes: UiTopFix[]
  stopConditions: string[]
  evidence: {
    manifest: EvidenceReference
    hardGates: EvidenceReference
    critic: EvidenceReference
    report: EvidenceReference
    calibration: EvidenceReference
  }
  handoff: {
    channel: "existing-inbox-ask_user"
    reportPath: "report.html"
    ownerSpotChecks: string[]
  }
}

type EvidenceReference = { path: string; sha256: string }

export async function createCalibrationRecord(input: {
  root: string
  manifest: UiReviewManifest
  critic: UiCriticReport
  prompt: string
  rubricPath: string
  spec: UiReviewSpec
}): Promise<UiCalibrationRecordV1> {
  validateUiCriticReport(input.critic, input.manifest)
  const manifestBytes = await readFile(resolve(input.root, "manifest.json"))
  const rubricBytes = await readFile(input.rubricPath)
  const record: UiCalibrationRecordV1 = {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    scenarioId: input.spec.id,
    ...(input.manifest.baselineRevision ? { baselineRevision: input.manifest.baselineRevision } : {}),
    ...(input.manifest.baselineTreeHash ? { baselineTreeHash: input.manifest.baselineTreeHash } : {}),
    ...(input.manifest.candidateRevision ? { candidateRevision: input.manifest.candidateRevision } : {}),
    ...(input.manifest.candidateTreeHash ? { candidateTreeHash: input.manifest.candidateTreeHash } : {}),
    score: {
      ...(input.critic.mode === "pair" ? { baseline: input.critic.baseline } : {}),
      candidate: input.critic.candidate,
    },
    confidence: input.critic.confidence,
    promptHash: sha256Hex(new TextEncoder().encode(input.prompt)),
    rubricHash: sha256Hex(rubricBytes),
    manifestHash: sha256Hex(manifestBytes),
    screenshotDigests: [...new Set(input.manifest.states.map((state) => state.screenshotDigest))].sort(),
    resolvedModel: input.manifest.resolvedModel,
    ownerDisposition: "pending",
  }
  validateCalibrationRecord(record, input.spec)
  return record
}

export async function createExecutionPacket(input: {
  root: string
  manifest: UiReviewManifest
  hardGates: UiHardGateReport
  critic: UiCriticReport
  calibration: UiCalibrationRecordV1
  reportHtml: string
  spec: UiReviewSpec
}): Promise<UiExecutionPacketV1> {
  if (input.manifest.scenarioId !== input.spec.id) throw new Error("UI_IMPROVEMENT_SCENARIO_INVALID")
  if (!input.manifest.candidateRevision || !input.manifest.candidateTreeHash) throw new Error("UI_IMPROVEMENT_SOURCE_IDENTITY_MISSING")
  input.spec.hardGates.validate(input.hardGates, input.manifest)
  validateUiCriticReport(input.critic, input.manifest)
  validateCalibrationRecord(input.calibration, input.spec)
  if (input.hardGates.results.some((result) => !result.passed)) throw new Error("UI_IMPROVEMENT_HARD_GATES_FAILED")
  await Promise.all([
    assertJsonArtifact(resolve(input.root, "manifest.json"), input.manifest, "manifest"),
    assertJsonArtifact(resolve(input.root, "hard-gates.json"), input.hardGates, "hard-gates"),
    assertJsonArtifact(resolve(input.root, "critic.json"), input.critic, "critic"),
    assertJsonArtifact(resolve(input.root, "calibration.json"), input.calibration, "calibration"),
    assertTextArtifact(resolve(input.root, "report.html"), input.reportHtml, "report"),
  ])

  const fixes = selectExecutionFixes(input.critic)

  const evidence = Object.fromEntries(await Promise.all([
    ["manifest", "manifest.json"],
    ["hardGates", "hard-gates.json"],
    ["critic", "critic.json"],
    ["report", "report.html"],
    ["calibration", "calibration.json"],
  ].map(async ([key, path]) => {
    const bytes = await readFile(resolve(input.root, path))
    return [key, { path, sha256: sha256Hex(bytes) }]
  }))) as UiExecutionPacketV1["evidence"]

  const packet: UiExecutionPacketV1 = {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    kind: "ui-improvement-execution-packet",
    scenarioId: input.spec.id,
    sourceRunId: input.manifest.runId,
    executionOwner: "/skill:exec",
    authority: { mayEdit: false, mayMerge: false },
    budget: {
      maxRounds: UI_IMPROVEMENT_MAX_ROUNDS,
      maxFixesPerRound: UI_IMPROVEMENT_MAX_FIXES_PER_ROUND,
      fixConfidenceThreshold: UI_IMPROVEMENT_FIX_CONFIDENCE_THRESHOLD,
    },
    fixes,
    stopConditions: [...UI_IMPROVEMENT_STOP_CONDITIONS],
    evidence,
    handoff: {
      channel: "existing-inbox-ask_user",
      reportPath: "report.html",
      ownerSpotChecks: [...input.spec.ownerSpotChecks],
    },
  }
  validateExecutionPacket(packet, input.manifest, input.spec)
  await validateExecutionPacketEvidence(input.root, packet)
  return packet
}

export async function validateExecutionPacketEvidence(root: string, packet: UiExecutionPacketV1): Promise<void> {
  for (const [key, reference] of Object.entries(packet.evidence)) {
    const bytes = await readFile(resolve(root, reference.path))
    if (sha256Hex(bytes) !== reference.sha256) throw new Error(`UI_EXECUTION_PACKET_EVIDENCE_DIGEST_MISMATCH:${key}`)
  }
}

export async function validateUiImprovementRun(input: {
  root: string
  currentRevision: string
  currentTreeHash: string
  prompt: string
  rubricPath: string
  spec: UiReviewSpec
}): Promise<void> {
  const manifest = await readJsonArtifact<UiReviewManifest>(resolve(input.root, "manifest.json"), "manifest")
  const hardGates = await readJsonArtifact<UiHardGateReport>(resolve(input.root, "hard-gates.json"), "hard-gates")
  const criticRaw = await readJsonArtifact<UiCriticReport>(resolve(input.root, "critic.json"), "critic")
  const calibration = await readJsonArtifact<UiCalibrationRecordV1>(resolve(input.root, "calibration.json"), "calibration")
  const packet = await readJsonArtifact<UiExecutionPacketV1>(resolve(input.root, "execution-packet.json"), "execution-packet")

  await validateUiReviewManifest(input.root, manifest, input.spec)
  input.spec.hardGates.validate(hardGates, manifest)
  if (hardGates.results.some((result) => !result.passed)) throw new Error("UI_IMPROVEMENT_HARD_GATES_FAILED")
  const critic = validateUiCriticReport(criticRaw, manifest)
  validateCalibrationRecord(calibration, input.spec)
  validateExecutionPacket(packet, manifest, input.spec)
  await validateExecutionPacketEvidence(input.root, packet)

  if (!manifest.candidateRevision || manifest.candidateRevision !== input.currentRevision) {
    throw new Error("UI_EXECUTION_PACKET_CHECKOUT_REVISION_MISMATCH")
  }
  if (!manifest.candidateTreeHash || manifest.candidateTreeHash !== input.currentTreeHash) {
    throw new Error("UI_EXECUTION_PACKET_WORKTREE_MISMATCH")
  }
  validateCalibrationReviewConsistency({
    calibration,
    manifest,
    critic,
    promptHash: sha256Hex(new TextEncoder().encode(input.prompt)),
    rubricHash: sha256Hex(await readFile(input.rubricPath)),
    manifestHash: sha256Hex(await readFile(resolve(input.root, "manifest.json"))),
  })
  if (canonicalJson(packet.fixes) !== canonicalJson(selectExecutionFixes(critic))) {
    throw new Error("UI_EXECUTION_PACKET_FIX_SELECTION_MISMATCH")
  }
}

export function validateCalibrationRecord(raw: unknown, spec: UiReviewSpec): asserts raw is UiCalibrationRecordV1 {
  if (!isRecord(raw)) throw new Error("UI_CALIBRATION_INVALID")
  exactKeys(raw, ["schemaVersion", "scenarioId", "baselineRevision", "baselineTreeHash", "candidateRevision", "candidateTreeHash", "score", "confidence", "promptHash", "rubricHash", "manifestHash", "screenshotDigests", "resolvedModel", "ownerDisposition"], ["baselineRevision", "baselineTreeHash", "candidateRevision", "candidateTreeHash"], "calibration")
  if (raw.schemaVersion !== 1 || raw.scenarioId !== spec.id || !["pending", "approved", "request-changes"].includes(raw.ownerDisposition)) throw new Error("UI_CALIBRATION_CONTRACT_INVALID")
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) throw new Error("UI_CALIBRATION_CONFIDENCE_INVALID")
  for (const key of ["promptHash", "rubricHash", "manifestHash"] as const) if (!isSha256(raw[key])) throw new Error(`UI_CALIBRATION_HASH_INVALID:${key}`)
  if (!Array.isArray(raw.screenshotDigests)
    || raw.screenshotDigests.length === 0
    || raw.screenshotDigests.some((value) => !isSha256(value))
    || new Set(raw.screenshotDigests).size !== raw.screenshotDigests.length
    || [...raw.screenshotDigests].sort().join("|") !== raw.screenshotDigests.join("|")) throw new Error("UI_CALIBRATION_SCREENSHOTS_INVALID")
  if (typeof raw.resolvedModel !== "string" || !/^(?:fixture|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/i.test(raw.resolvedModel)) throw new Error("UI_CALIBRATION_MODEL_INVALID")
  if (!isRecord(raw.score)) throw new Error("UI_CALIBRATION_SCORE_INVALID")
  exactKeys(raw.score, ["baseline", "candidate"], ["baseline"], "calibration.score")
  validateScore(raw.score.candidate, "candidate")
  if (raw.score.baseline !== undefined) validateScore(raw.score.baseline, "baseline")
  for (const key of ["baselineRevision", "candidateRevision"] as const) {
    if (raw[key] !== undefined && (typeof raw[key] !== "string" || !/^[a-f0-9]{7,64}$/i.test(raw[key]))) throw new Error(`UI_CALIBRATION_REVISION_INVALID:${key}`)
  }
  for (const key of ["baselineTreeHash", "candidateTreeHash"] as const) {
    if (raw[key] !== undefined && !isSha256(raw[key])) throw new Error(`UI_CALIBRATION_TREE_HASH_INVALID:${key}`)
  }
}

export function validateExecutionPacket(raw: unknown, manifest: UiReviewManifest, spec: UiReviewSpec): asserts raw is UiExecutionPacketV1 {
  if (!isRecord(raw)) throw new Error("UI_EXECUTION_PACKET_INVALID")
  exactKeys(raw, ["schemaVersion", "kind", "scenarioId", "sourceRunId", "executionOwner", "authority", "budget", "fixes", "stopConditions", "evidence", "handoff"], [], "packet")
  if (raw.schemaVersion !== 1 || raw.kind !== "ui-improvement-execution-packet" || raw.scenarioId !== spec.id || raw.sourceRunId !== manifest.runId) throw new Error("UI_EXECUTION_PACKET_IDENTITY_INVALID")
  if (raw.executionOwner !== "/skill:exec") throw new Error("UI_EXECUTION_PACKET_OWNER_INVALID")
  if (!isRecord(raw.authority) || Object.keys(raw.authority).sort().join(",") !== "mayEdit,mayMerge" || raw.authority.mayEdit !== false || raw.authority.mayMerge !== false) throw new Error("UI_EXECUTION_PACKET_AUTHORITY_INVALID")
  if (!isRecord(raw.budget) || Object.keys(raw.budget).sort().join(",") !== "fixConfidenceThreshold,maxFixesPerRound,maxRounds" || raw.budget.maxRounds !== 2 || raw.budget.maxFixesPerRound !== 3 || raw.budget.fixConfidenceThreshold !== 0.8) throw new Error("UI_EXECUTION_PACKET_BUDGET_INVALID")
  if (!Array.isArray(raw.fixes) || raw.fixes.length > 3) throw new Error("UI_EXECUTION_PACKET_FIX_LIMIT")
  const stateIds = new Set(manifest.states.map((state) => state.id))
  for (const fix of raw.fixes) {
    if (!isRecord(fix) || Object.keys(fix).sort().join(",") !== "confidence,problem,recommendation,stateIds" || typeof fix.confidence !== "number" || fix.confidence < 0.8 || !Array.isArray(fix.stateIds) || fix.stateIds.length === 0 || fix.stateIds.some((id) => typeof id !== "string" || !stateIds.has(id))) throw new Error("UI_EXECUTION_PACKET_FIX_INVALID")
    if (typeof fix.problem !== "string" || !fix.problem.trim() || typeof fix.recommendation !== "string" || !fix.recommendation.trim()) throw new Error("UI_EXECUTION_PACKET_FIX_INVALID")
  }
  if (!Array.isArray(raw.stopConditions) || raw.stopConditions.join("|") !== UI_IMPROVEMENT_STOP_CONDITIONS.join("|")) throw new Error("UI_EXECUTION_PACKET_STOPS_INVALID")
  if (!isRecord(raw.evidence) || Object.keys(raw.evidence).sort().join(",") !== "calibration,critic,hardGates,manifest,report") throw new Error("UI_EXECUTION_PACKET_EVIDENCE_INVALID")
  for (const [key, expectedPath] of Object.entries({ manifest: "manifest.json", hardGates: "hard-gates.json", critic: "critic.json", report: "report.html", calibration: "calibration.json" })) {
    const reference = raw.evidence[key]
    if (!isRecord(reference) || Object.keys(reference).sort().join(",") !== "path,sha256" || reference.path !== expectedPath || !isSha256(reference.sha256)) throw new Error(`UI_EXECUTION_PACKET_EVIDENCE_INVALID:${key}`)
  }
  if (!isRecord(raw.handoff) || Object.keys(raw.handoff).sort().join(",") !== "channel,ownerSpotChecks,reportPath" || raw.handoff.channel !== "existing-inbox-ask_user" || raw.handoff.reportPath !== "report.html" || !Array.isArray(raw.handoff.ownerSpotChecks) || raw.handoff.ownerSpotChecks.join("|") !== spec.ownerSpotChecks.join("|")) throw new Error("UI_EXECUTION_PACKET_HANDOFF_INVALID")
}

export function validateCalibrationReviewConsistency(input: {
  calibration: UiCalibrationRecordV1
  manifest: UiReviewManifest
  critic: UiCriticReport
  promptHash: string
  rubricHash: string
  manifestHash: string
}): void {
  const expected = {
    scenarioId: input.manifest.scenarioId,
    baselineRevision: input.manifest.baselineRevision,
    baselineTreeHash: input.manifest.baselineTreeHash,
    candidateRevision: input.manifest.candidateRevision,
    candidateTreeHash: input.manifest.candidateTreeHash,
    score: {
      ...(input.critic.mode === "pair" ? { baseline: input.critic.baseline } : {}),
      candidate: input.critic.candidate,
    },
    confidence: input.critic.confidence,
    promptHash: input.promptHash,
    rubricHash: input.rubricHash,
    manifestHash: input.manifestHash,
    screenshotDigests: [...new Set(input.manifest.states.map((state) => state.screenshotDigest))].sort(),
    resolvedModel: input.manifest.resolvedModel,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (canonicalJson(input.calibration[key as keyof UiCalibrationRecordV1]) !== canonicalJson(value)) {
      throw new Error(`UI_CALIBRATION_REVIEW_MISMATCH:${key}`)
    }
  }
}

function selectExecutionFixes(critic: UiCriticReport): UiTopFix[] {
  return critic.topFixes
    .map((fix, index) => ({ fix, index }))
    .filter(({ fix }) => fix.confidence >= UI_IMPROVEMENT_FIX_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.fix.confidence - a.fix.confidence || a.index - b.index)
    .slice(0, UI_IMPROVEMENT_MAX_FIXES_PER_ROUND)
    .map(({ fix }) => fix)
}

async function readJsonArtifact<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    throw new Error(`UI_EXECUTION_PACKET_ARTIFACT_INVALID:${label}`)
  }
}

async function assertJsonArtifact(path: string, expected: unknown, label: string): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, "utf8"))
  } catch {
    throw new Error(`UI_EXECUTION_PACKET_ARTIFACT_INVALID:${label}`)
  }
  if (canonicalJson(raw) !== canonicalJson(expected)) throw new Error(`UI_EXECUTION_PACKET_ARTIFACT_MISMATCH:${label}`)
}

async function assertTextArtifact(path: string, expected: string, label: string): Promise<void> {
  if (await readFile(path, "utf8") !== expected) throw new Error(`UI_EXECUTION_PACKET_ARTIFACT_MISMATCH:${label}`)
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined"
  return canonicalJsonValue(JSON.parse(JSON.stringify(value)))
}

function canonicalJsonValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(value[key])}`).join(",")}}`
  return JSON.stringify(value) as string
}

function validateScore(raw: unknown, label: string): void {
  if (!isRecord(raw)) throw new Error(`UI_CALIBRATION_SCORE_INVALID:${label}`)
  exactKeys(raw, ["overall", "dimensions"], [], `calibration.score.${label}`)
  const values = [raw.overall]
  if (!isRecord(raw.dimensions)) throw new Error(`UI_CALIBRATION_SCORE_INVALID:${label}.dimensions`)
  exactKeys(raw.dimensions, ["hierarchy", "spacingAlignment", "typographyColor", "consistency", "interactionStates", "responsiveAccessibility"], [], `calibration.score.${label}.dimensions`)
  values.push(...Object.values(raw.dimensions))
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10)) {
    throw new Error(`UI_CALIBRATION_SCORE_INVALID:${label}`)
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[], optional: string[], label: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  const missing = keys.find((key) => !optional.includes(key) && !(key in value))
  if (unknown || missing) throw new Error(`UI_STRICT_SCHEMA_INVALID:${label}:${unknown ? `unknown=${unknown}` : `missing=${missing}`}`)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
