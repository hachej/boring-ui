import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { checkpointAppliesToViewport, type UiReviewSpec } from "./reviewSpec"

export const UI_REVIEW_SCHEMA_VERSION = 1 as const
export const UI_REVIEW_RUBRIC_VERSION = "impeccable-v1" as const
export const UI_REVIEW_MAX_STATES_PER_VIEWPORT = 12
export const UI_REVIEW_MAX_SELECTED_BYTES = 24 * 1024 * 1024

export type UiReviewRole = "baseline" | "candidate"

export type UiReviewViewport = {
  name: string
  width: number
  height: number
  deviceScaleFactor: number
}

export type UiReviewState = {
  id: string
  scenarioId: string
  role: UiReviewRole
  checkpoint: string
  viewport: UiReviewViewport
  screenshotPath: string
  screenshotDigest: string
  screenshotBytes: number
  source?: "known" | "bombadil"
  normalizedStateSignature?: string
  reproducePath?: string
  action?: unknown
  categories?: string[]
}

export type UiReviewStatePair = {
  baselineStateId: string
  candidateStateId: string
}

export type UiReviewManifest = {
  schemaVersion: typeof UI_REVIEW_SCHEMA_VERSION
  runId: string
  scenarioId: string
  rubricVersion: string
  resolvedModel: string
  baselineRevision?: string
  baselineTreeHash?: string
  candidateRevision?: string
  candidateTreeHash?: string
  states: UiReviewState[]
  statePairs: UiReviewStatePair[]
}

export type UiScore = {
  overall: number
  dimensions: {
    hierarchy: number
    spacingAlignment: number
    typographyColor: number
    consistency: number
    interactionStates: number
    responsiveAccessibility: number
  }
}

export type UiVisualFinding = {
  stateIds: string[]
  evidence: string
  severity: "note" | "concern"
}

export type UiTopFix = {
  stateIds: string[]
  problem: string
  recommendation: string
  confidence: number
}

export type UiCriticCandidateReport = {
  schemaVersion: typeof UI_REVIEW_SCHEMA_VERSION
  mode: "candidate"
  confidence: number
  candidate: UiScore
  visualFindings: UiVisualFinding[]
  topFixes: UiTopFix[]
}

export type UiCriticPairReport = {
  schemaVersion: typeof UI_REVIEW_SCHEMA_VERSION
  mode: "pair"
  confidence: number
  baseline: UiScore
  candidate: UiScore
  visualFindings: UiVisualFinding[]
  topFixes: UiTopFix[]
}

export type UiCriticReport = UiCriticCandidateReport | UiCriticPairReport

export type UiPairResult = {
  baseline: UiScore
  candidate: UiScore
  signedDelta: Record<keyof UiScore["dimensions"] | "overall", number>
  statePairs: UiReviewStatePair[]
}

export type UiHardGateResult = {
  id: string
  stateId: string
  passed: boolean
  evidence: string
}

export type UiHardGateReport = {
  schemaVersion: typeof UI_REVIEW_SCHEMA_VERSION
  contractVersion: string
  results: UiHardGateResult[]
}

export function createUiReviewStateId(input: {
  runId: string
  scenarioId: string
  role: UiReviewRole
  viewport: UiReviewViewport
  checkpoint: string
  screenshotDigest: string
}): string {
  const slug = [input.runId, input.scenarioId, input.role, input.viewport.name, input.checkpoint]
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .join(":")
  return `${slug}:${input.screenshotDigest.slice(0, 12)}`
}

export function createUiReviewReproducePath(stateId: string): string {
  return `reproduce/${encodeURIComponent(stateId)}`
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function validateUiReviewManifest(root: string, manifest: UiReviewManifest, spec: UiReviewSpec): Promise<void> {
  if (manifest.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_MANIFEST_VERSION_INVALID")
  if (!manifest.runId.trim() || !manifest.scenarioId.trim()) throw new Error("UI_REVIEW_MANIFEST_ID_INVALID")

  if (manifest.scenarioId !== spec.id) throw new Error("UI_REVIEW_MANIFEST_SCENARIO_INVALID")
  if (manifest.rubricVersion !== spec.rubricVersion) throw new Error("UI_REVIEW_MANIFEST_RUBRIC_INVALID")
  if (!/^(?:fixture|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/i.test(manifest.resolvedModel)) {
    throw new Error("UI_REVIEW_MANIFEST_MODEL_INVALID")
  }
  for (const [label, revision] of [["baseline", manifest.baselineRevision], ["candidate", manifest.candidateRevision]] as const) {
    if (revision !== undefined && !/^[a-f0-9]{7,64}$/i.test(revision)) throw new Error(`UI_REVIEW_MANIFEST_REVISION_INVALID:${label}`)
  }
  for (const [label, treeHash] of [["baseline", manifest.baselineTreeHash], ["candidate", manifest.candidateTreeHash]] as const) {
    if (treeHash !== undefined && !/^[a-f0-9]{64}$/i.test(treeHash)) throw new Error(`UI_REVIEW_MANIFEST_TREE_HASH_INVALID:${label}`)
  }
  if ((manifest.baselineRevision || manifest.baselineTreeHash) && !manifest.states.some((state) => state.role === "baseline")) throw new Error("UI_REVIEW_MANIFEST_BASELINE_REVISION_INVALID")
  if (!manifest.states.length) throw new Error("UI_REVIEW_MANIFEST_STATES_MISSING")

  const ids = new Set<string>()
  const paths = new Set<string>()
  const stateKeys = new Set<string>()
  const knownStateKeys = new Set<string>()
  const statesByViewport = new Map<string, number>()
  let selectedBytes = 0
  const rootPath = resolve(root)

  for (const state of manifest.states) {
    if (state.scenarioId !== manifest.scenarioId) throw new Error(`UI_REVIEW_STATE_SCENARIO_INVALID:${state.id}`)
    if (state.role !== "baseline" && state.role !== "candidate") throw new Error(`UI_REVIEW_STATE_ROLE_INVALID:${state.id}`)
    const exploration = state.source === "bombadil"
    if (exploration ? !/^explore-\d{4}-(?:violation|dialog-popover|loading|error|empty|layout)$/.test(state.checkpoint) : !spec.checkpoints.some((checkpoint) => checkpoint.id === state.checkpoint)) {
      throw new Error(`UI_REVIEW_STATE_CHECKPOINT_INVALID:${state.id}`)
    }
    if (exploration) {
      if (!/^[a-f0-9]{64}$/.test(state.normalizedStateSignature ?? "")) throw new Error(`UI_REVIEW_STATE_SIGNATURE_INVALID:${state.id}`)
      if (state.reproducePath !== createUiReviewReproducePath(state.id)) throw new Error(`UI_REVIEW_REPRODUCE_OWNERSHIP_INVALID:${state.id}`)
    }
    const expectedViewport = spec.viewports.find((viewport) => viewport.name === state.viewport.name)
    if (!expectedViewport
      || state.viewport.width !== expectedViewport.width
      || state.viewport.height !== expectedViewport.height
      || state.viewport.deviceScaleFactor !== expectedViewport.deviceScaleFactor) {
      throw new Error(`UI_REVIEW_VIEWPORT_GEOMETRY_INVALID:${state.id}`)
    }
    const expectedId = createUiReviewStateId({
      runId: manifest.runId,
      scenarioId: manifest.scenarioId,
      role: state.role,
      viewport: state.viewport,
      checkpoint: state.checkpoint,
      screenshotDigest: state.screenshotDigest,
    })
    if (state.id !== expectedId) throw new Error(`UI_REVIEW_STATE_ID_NONDETERMINISTIC:${state.id}`)
    if (ids.has(state.id)) throw new Error(`UI_REVIEW_STATE_ID_DUPLICATE:${state.id}`)
    ids.add(state.id)
    const stateKey = `${state.role}:${state.viewport.name}:${state.checkpoint}`
    if (stateKeys.has(stateKey)) throw new Error(`UI_REVIEW_STATE_OWNERSHIP_DUPLICATE:${stateKey}`)
    stateKeys.add(stateKey)
    if (!exploration) knownStateKeys.add(stateKey)
    if (!new RegExp(`^selected/${state.viewport.name}/[a-zA-Z0-9._-]+\\.(?:png|jpe?g)$`).test(state.screenshotPath)) {
      throw new Error(`UI_REVIEW_SCREENSHOT_OWNERSHIP_INVALID:${state.id}`)
    }
    if (paths.has(state.screenshotPath)) throw new Error(`UI_REVIEW_SCREENSHOT_OWNERSHIP_DUPLICATE:${state.screenshotPath}`)
    paths.add(state.screenshotPath)
    statesByViewport.set(state.viewport.name, (statesByViewport.get(state.viewport.name) ?? 0) + 1)
    selectedBytes += state.screenshotBytes

    const absolutePath = resolve(rootPath, state.screenshotPath)
    if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${sep}`)) {
      throw new Error(`UI_REVIEW_SCREENSHOT_PATH_INVALID:${state.id}`)
    }
    const bytes = await readFile(absolutePath)
    if (bytes.byteLength !== state.screenshotBytes || sha256Hex(bytes) !== state.screenshotDigest) {
      throw new Error(`UI_REVIEW_SCREENSHOT_DIGEST_MISMATCH:${state.id}`)
    }
  }

  for (const [viewport, count] of statesByViewport) {
    if (count > UI_REVIEW_MAX_STATES_PER_VIEWPORT) throw new Error(`UI_REVIEW_VIEWPORT_STATE_LIMIT:${viewport}:${count}`)
  }
  if (selectedBytes > UI_REVIEW_MAX_SELECTED_BYTES) throw new Error("UI_REVIEW_SELECTED_BYTES_LIMIT")

  const roles: UiReviewRole[] = manifest.states.some((state) => state.role === "baseline")
    ? ["baseline", "candidate"]
    : ["candidate"]
  const expectedStateKeys = roles.flatMap((role) => (
    spec.viewports.flatMap((viewport) => (
      spec.checkpoints
        .filter((checkpoint) => checkpointAppliesToViewport(checkpoint, viewport.name))
        .map((checkpoint) => `${role}:${viewport.name}:${checkpoint.id}`)
    ))
  ))
  const missingStateKey = expectedStateKeys.find((key) => !knownStateKeys.has(key))
  if (missingStateKey || knownStateKeys.size !== expectedStateKeys.length) {
    throw new Error(`UI_REVIEW_SCENARIO_MATRIX_INCOMPLETE:${missingStateKey ?? "unexpected-state"}`)
  }

  const pairKeys = new Set<string>()
  const pairedIds = new Set<string>()
  for (const pair of manifest.statePairs) {
    const pairKey = `${pair.baselineStateId}:${pair.candidateStateId}`
    if (pairKeys.has(pairKey)) throw new Error("UI_REVIEW_PAIR_DUPLICATE")
    pairKeys.add(pairKey)
    const baseline = manifest.states.find((state) => state.id === pair.baselineStateId)
    const candidate = manifest.states.find((state) => state.id === pair.candidateStateId)
    if (!baseline || baseline.role !== "baseline") throw new Error("UI_REVIEW_PAIR_BASELINE_INVALID")
    if (!candidate || candidate.role !== "candidate") throw new Error("UI_REVIEW_PAIR_CANDIDATE_INVALID")
    if (pairedIds.has(baseline.id) || pairedIds.has(candidate.id)) throw new Error("UI_REVIEW_PAIR_STATE_REUSED")
    pairedIds.add(baseline.id)
    pairedIds.add(candidate.id)
    if (baseline.scenarioId !== candidate.scenarioId
      || baseline.checkpoint !== candidate.checkpoint
      || JSON.stringify(baseline.viewport) !== JSON.stringify(candidate.viewport)) {
      throw new Error("UI_REVIEW_PAIR_OWNERSHIP_INVALID")
    }
  }
  const hasBaseline = manifest.states.some((state) => state.role === "baseline")
  if (hasBaseline) {
    if (manifest.states.some((state) => !pairedIds.has(state.id))) throw new Error("UI_REVIEW_PAIRING_INCOMPLETE")
  } else if (manifest.statePairs.length > 0) {
    throw new Error("UI_REVIEW_PAIR_BASELINE_INVALID")
  }
}

export function validateUiCriticReport(raw: unknown, manifest: UiReviewManifest): UiCriticReport {
  if (!isRecord(raw) || raw.schemaVersion !== UI_REVIEW_SCHEMA_VERSION) throw new Error("UI_REVIEW_CRITIC_VERSION_INVALID")
  if (raw.mode !== "candidate" && raw.mode !== "pair") throw new Error("UI_REVIEW_CRITIC_MODE_INVALID")
  assertExactKeys(raw, raw.mode === "candidate"
    ? ["schemaVersion", "mode", "confidence", "candidate", "visualFindings", "topFixes"]
    : ["schemaVersion", "mode", "confidence", "baseline", "candidate", "visualFindings", "topFixes"], "report")
  assertUnitInterval(raw.confidence, "confidence")
  assertScore(raw.candidate, "candidate")
  if (raw.mode === "pair") {
    assertScore(raw.baseline, "baseline")
    if (manifest.statePairs.length === 0) throw new Error("UI_REVIEW_CRITIC_PAIR_MANIFEST_REQUIRED")
  }

  const stateById = new Map(manifest.states.map((state) => [state.id, state]))
  const findings = assertArray(raw.visualFindings, "visualFindings").map((finding, index) => {
    if (!isRecord(finding) || (finding.severity !== "note" && finding.severity !== "concern")) {
      throw new Error(`UI_REVIEW_CRITIC_FINDING_INVALID:${index}`)
    }
    assertExactKeys(finding, ["stateIds", "evidence", "severity"], `visualFindings.${index}`)
    return {
      stateIds: assertStateIds(finding.stateIds, stateById),
      evidence: assertString(finding.evidence, `visualFindings.${index}.evidence`),
      severity: finding.severity,
    } satisfies UiVisualFinding
  })
  const fixes = assertArray(raw.topFixes, "topFixes").map((fix, index) => {
    if (!isRecord(fix)) throw new Error(`UI_REVIEW_CRITIC_FIX_INVALID:${index}`)
    assertExactKeys(fix, ["stateIds", "problem", "recommendation", "confidence"], `topFixes.${index}`)
    assertUnitInterval(fix.confidence, `topFixes.${index}.confidence`)
    return {
      stateIds: assertStateIds(fix.stateIds, stateById),
      problem: assertString(fix.problem, `topFixes.${index}.problem`),
      recommendation: assertString(fix.recommendation, `topFixes.${index}.recommendation`),
      confidence: fix.confidence,
    } satisfies UiTopFix
  })

  if (raw.mode === "candidate") {
    if (manifest.states.some((state) => state.role !== "candidate")) throw new Error("UI_REVIEW_CANDIDATE_ROLE_INVALID")
    return {
      schemaVersion: UI_REVIEW_SCHEMA_VERSION,
      mode: "candidate",
      confidence: raw.confidence,
      candidate: raw.candidate as UiScore,
      visualFindings: findings,
      topFixes: fixes,
    }
  }
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    mode: "pair",
    confidence: raw.confidence,
    baseline: raw.baseline as UiScore,
    candidate: raw.candidate as UiScore,
    visualFindings: findings,
    topFixes: fixes,
  }
}

export function computeUiPairResult(report: UiCriticPairReport, manifest: UiReviewManifest): UiPairResult {
  const signedDelta = {
    overall: report.candidate.overall - report.baseline.overall,
    hierarchy: report.candidate.dimensions.hierarchy - report.baseline.dimensions.hierarchy,
    spacingAlignment: report.candidate.dimensions.spacingAlignment - report.baseline.dimensions.spacingAlignment,
    typographyColor: report.candidate.dimensions.typographyColor - report.baseline.dimensions.typographyColor,
    consistency: report.candidate.dimensions.consistency - report.baseline.dimensions.consistency,
    interactionStates: report.candidate.dimensions.interactionStates - report.baseline.dimensions.interactionStates,
    responsiveAccessibility: report.candidate.dimensions.responsiveAccessibility - report.baseline.dimensions.responsiveAccessibility,
  }
  return { baseline: report.baseline, candidate: report.candidate, signedDelta, statePairs: manifest.statePairs }
}

function assertScore(value: unknown, label: string): asserts value is UiScore {
  if (!isRecord(value)) throw new Error(`UI_REVIEW_SCORE_INVALID:${label}`)
  assertExactKeys(value, ["overall", "dimensions"], label)
  assertScoreNumber(value.overall, `${label}.overall`)
  if (!isRecord(value.dimensions)) throw new Error(`UI_REVIEW_SCORE_DIMENSIONS_INVALID:${label}`)
  assertExactKeys(value.dimensions, ["hierarchy", "spacingAlignment", "typographyColor", "consistency", "interactionStates", "responsiveAccessibility"], `${label}.dimensions`)
  for (const key of ["hierarchy", "spacingAlignment", "typographyColor", "consistency", "interactionStates", "responsiveAccessibility"] as const) {
    assertScoreNumber(value.dimensions[key], `${label}.dimensions.${key}`)
  }
}

function assertScoreNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`UI_REVIEW_SCORE_RANGE:${label}`)
  }
}

function assertUnitInterval(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`UI_REVIEW_CONFIDENCE_RANGE:${label}`)
  }
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`UI_REVIEW_ARRAY_INVALID:${label}`)
  return value
}

function assertStateIds(value: unknown, byId: Map<string, UiReviewState>): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !byId.has(id))) {
    throw new Error("UI_REVIEW_STATE_REFERENCE_INVALID")
  }
  if (new Set(value).size !== value.length) throw new Error("UI_REVIEW_STATE_REFERENCE_DUPLICATE")
  return value
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const expectedKeys = new Set(expected)
  const unknown = Object.keys(value).find((key) => !expectedKeys.has(key))
  const missing = expected.find((key) => !(key in value))
  if (unknown || missing) throw new Error(`UI_REVIEW_CRITIC_SCHEMA_INVALID:${label}:${unknown ? `unknown=${unknown}` : `missing=${missing}`}`)
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`UI_REVIEW_STRING_INVALID:${label}`)
  return value
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
