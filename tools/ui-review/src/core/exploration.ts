import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, resolve } from "node:path"
import {
  UI_REVIEW_MAX_SELECTED_BYTES,
  UI_REVIEW_MAX_STATES_PER_VIEWPORT,
  createUiReviewReproducePath,
  createUiReviewStateId,
  type UiReviewState,
  type UiReviewViewport,
} from "./contracts"
import { hexadecimalHammingDistance } from "./imageHash"
import type { UiReviewReproduceManifest } from "./replay"
import { checkpointAppliesToViewport, type UiReviewSpec } from "./reviewSpec"
import { parseBombadilTrace, type BombadilTraceEntry } from "./trace"

export { parseBombadilTrace, type BombadilTraceEntry } from "./trace"
export function createUiReviewStagingPolicy(spec: UiReviewSpec) {
  const knownCheckpointStates = spec.viewports.reduce((count, viewport) => (
    count + spec.checkpoints.filter((checkpoint) => checkpointAppliesToViewport(checkpoint, viewport.name)).length
  ), 0)
  const reservedFinalFiles = 8 + (2 * knownCheckpointStates)
  const largestKnownViewport = Math.max(...spec.viewports.map((viewport) => (
    spec.checkpoints.filter((checkpoint) => checkpointAppliesToViewport(checkpoint, viewport.name)).length
  )))
  return {
    version: 1 as const,
    maxStatesPerViewport: Math.max(0, UI_REVIEW_MAX_STATES_PER_VIEWPORT - largestKnownViewport),
    maxFiles: 55 + reservedFinalFiles,
    maxBytes: UI_REVIEW_MAX_SELECTED_BYTES,
    reservedFinalFiles,
    reservedFinalBytes: 2 * 1024 * 1024,
  }
}

export type UiReviewSelectionState = UiReviewState & {
  source: "bombadil"
  ordinal: number
  action: unknown
  hashCurrent: string | number | null
  normalizedState: Record<string, unknown>
  normalizedStateSignature: string
  categories: string[]
  violations: unknown[]
  reproducePath: string
}

export type UiReviewSelection = {
  schemaVersion: 1
  policy: ReturnType<typeof createUiReviewStagingPolicy>
  runId: string
  scenarioId: string
  scenarioSpecRevision: string
  fixtureResetId: string
  origin: string
  viewports: Array<{
    viewport: UiReviewViewport
    rawStates: number
    selected: UiReviewSelectionState[]
    overflow: Record<string, number>
    rawViolations: Array<{ ordinal: number; violations: unknown[] }>
  }>
  stagedFiles: number
  stagedBytes: number
}

export async function stageBombadilSelection(input: {
  rawRoot: string
  outputRoot: string
  runId: string
  origin: string
  viewport: UiReviewViewport
  existingFiles?: number
  existingBytes?: number
  spec: UiReviewSpec
}): Promise<{
  selected: UiReviewSelectionState[]
  overflow: Record<string, number>
  stagedFiles: number
  stagedBytes: number
  rawStates: number
  rawViolations: Array<{ ordinal: number; violations: unknown[] }>
}> {
  const policy = createUiReviewStagingPolicy(input.spec)
  const entries = await parseBombadilTrace(input.rawRoot)
  const rawViolations = entries.flatMap((entry) => (
    entry.violations.length > 0 ? [{ ordinal: entry.ordinal, violations: entry.violations }] : []
  ))
  const overflow: Record<string, number> = {}
  const unique: BombadilTraceEntry[] = []
  for (const entry of entries) {
    // Bombadil transition hashes are deliberately excluded from identity.
    const duplicateIndex = unique.findIndex((candidate) => (
      candidate.normalizedStateSignature === entry.normalizedStateSignature
      && hexadecimalHammingDistance(candidate.screenshotPHash, entry.screenshotPHash) <= 4
    ))
    if (duplicateIndex >= 0) {
      increment(overflow, "duplicate-visual-state")
      const duplicate = unique[duplicateIndex]!
      if (entry.violations.length > duplicate.violations.length
        || (entry.action === "Wait" && duplicate.action !== "Wait")) {
        unique[duplicateIndex] = entry
      }
      continue
    }
    unique.push(entry)
  }

  const ordered = prioritizeEntries(unique)
  const selected: UiReviewSelectionState[] = []
  let stagedFiles = input.existingFiles ?? 1 // selection.json itself
  let stagedBytes = input.existingBytes ?? 0
  for (const entry of ordered) {
    if (selected.length >= policy.maxStatesPerViewport) {
      increment(overflow, "state-limit")
      continue
    }
    const checkpoint = `explore-${String(entry.ordinal).padStart(4, "0")}-${entry.categories[0] ?? "layout"}`
    const stateId = createUiReviewStateId({
      runId: input.runId,
      scenarioId: input.spec.id,
      role: "candidate",
      viewport: input.viewport,
      checkpoint,
      screenshotDigest: entry.screenshotDigest,
    })
    const extension = normalizedScreenshotExtension(entry.state.screenshot)
    const screenshotPath = `selected/${input.viewport.name}/${stateId.replaceAll(":", "-")}${extension}`
    const reproducePath = createUiReviewReproducePath(stateId)
    const prefixLines = entries.slice(0, entry.ordinal).map((candidate) => candidate.rawLine).join("\n") + "\n"
    const reproduce: UiReviewReproduceManifest = {
      schemaVersion: 1,
      stateId,
      scenarioId: input.spec.id,
      scenarioSpecRevision: input.spec.specRevision,
      fixtureResetId: input.spec.fixtureResetId,
      origin: new URL(input.origin).origin,
      targetUrl: input.origin,
      viewport: input.viewport,
      expectedNormalizedStateSignature: entry.normalizedStateSignature,
      expectedScreenshotDigest: entry.screenshotDigest,
      expectedScreenshotPHash: entry.screenshotPHash,
      maximumScreenshotPHashDistance: 8,
      traceDigest: createHash("sha256").update(prefixLines).digest("hex"),
      sourceScreenshotName: basename(entry.state.screenshot),
      actionCount: entry.ordinal,
      hashCurrent: entry.state.hashCurrent,
    }
    const reproduceJson = `${JSON.stringify(reproduce, null, 2)}\n`
    const addedBytes = entry.screenshotBytes + Buffer.byteLength(prefixLines) + Buffer.byteLength(reproduceJson)
    if (stagedFiles + 3 > policy.maxFiles - policy.reservedFinalFiles) {
      increment(overflow, "file-limit")
      continue
    }
    if (stagedBytes + addedBytes > policy.maxBytes - policy.reservedFinalBytes) {
      increment(overflow, "byte-limit")
      continue
    }

    await Promise.all([
      mkdir(dirname(resolve(input.outputRoot, screenshotPath)), { recursive: true }),
      mkdir(resolve(input.outputRoot, reproducePath), { recursive: true }),
    ])
    await Promise.all([
      copyFile(entry.state.screenshot, resolve(input.outputRoot, screenshotPath)),
      writeFile(resolve(input.outputRoot, reproducePath, "trace.jsonl"), prefixLines, "utf8"),
      writeFile(resolve(input.outputRoot, reproducePath, "reproduce.json"), reproduceJson, "utf8"),
    ])
    stagedFiles += 3
    stagedBytes += addedBytes
    selected.push({
      id: stateId,
      scenarioId: input.spec.id,
      role: "candidate",
      checkpoint,
      viewport: input.viewport,
      screenshotPath,
      screenshotDigest: entry.screenshotDigest,
      screenshotBytes: entry.screenshotBytes,
      source: "bombadil",
      ordinal: entry.ordinal,
      action: entry.action,
      hashCurrent: entry.state.hashCurrent,
      normalizedState: entry.normalizedState,
      normalizedStateSignature: entry.normalizedStateSignature,
      categories: entry.categories,
      violations: entry.violations,
      reproducePath,
    })
  }
  return { selected, overflow, stagedFiles, stagedBytes, rawStates: entries.length, rawViolations }
}

export function validateUiReviewSelection(
  raw: unknown,
  expected: { runId: string; origin: string; spec: UiReviewSpec },
): UiReviewSelection {
  if (!isRecord(raw)
    || raw.schemaVersion !== 1
    || raw.runId !== expected.runId
    || raw.scenarioId !== expected.spec.id
    || raw.scenarioSpecRevision !== expected.spec.specRevision
    || raw.fixtureResetId !== expected.spec.fixtureResetId
    || raw.origin !== new URL(expected.origin).origin
    || JSON.stringify(raw.policy) !== JSON.stringify(createUiReviewStagingPolicy(expected.spec))
    || !Array.isArray(raw.viewports)
    || raw.viewports.length !== expected.spec.viewports.length
    || !Number.isInteger(raw.stagedFiles)
    || !Number.isInteger(raw.stagedBytes)) {
    throw new Error("UI_REVIEW_SELECTION_INVALID")
  }
  const names = new Set<string>()
  for (const viewportEntry of raw.viewports) {
    if (!isRecord(viewportEntry)
      || !isViewport(viewportEntry.viewport, expected.spec)
      || names.has(viewportEntry.viewport.name)
      || !Number.isInteger(viewportEntry.rawStates)
      || (viewportEntry.rawStates as number) < 1
      || !Array.isArray(viewportEntry.selected)
      || viewportEntry.selected.length < 1
      || viewportEntry.selected.length > createUiReviewStagingPolicy(expected.spec).maxStatesPerViewport
      || (viewportEntry.rawStates as number) < viewportEntry.selected.length
      || !isCountRecord(viewportEntry.overflow)
      || !Array.isArray(viewportEntry.rawViolations)) {
      throw new Error("UI_REVIEW_SELECTION_VIEWPORT_INVALID")
    }
    names.add(viewportEntry.viewport.name)
    for (const selected of viewportEntry.selected) {
      if (!isRecord(selected)
        || selected.source !== "bombadil"
        || typeof selected.id !== "string"
        || !isRecord(selected.viewport)
        || selected.viewport.name !== viewportEntry.viewport.name
        || !Array.isArray(selected.violations)
        || !Array.isArray(selected.categories)
        || !Number.isInteger(selected.ordinal)) {
        throw new Error("UI_REVIEW_SELECTION_STATE_INVALID")
      }
    }
    for (const violation of viewportEntry.rawViolations) {
      if (!isRecord(violation) || !Number.isInteger(violation.ordinal) || !Array.isArray(violation.violations) || violation.violations.length === 0) {
        throw new Error("UI_REVIEW_SELECTION_VIOLATION_INVALID")
      }
    }
  }
  if (expected.spec.viewports.some((viewport) => !names.has(viewport.name))) throw new Error("UI_REVIEW_SELECTION_VIEWPORT_MATRIX_INVALID")
  return raw as unknown as UiReviewSelection
}

export async function writeSelection(outputRoot: string, selection: UiReviewSelection): Promise<void> {
  const json = `${JSON.stringify(selection, null, 2)}\n`
  const bytes = Buffer.byteLength(json)
  if (selection.stagedBytes + bytes > selection.policy.maxBytes) throw new Error("UI_REVIEW_SELECTION_BYTE_LIMIT")
  await writeFile(resolve(outputRoot, "selection.json"), json, "utf8")
}

export async function assertBoundedStagingDirectory(outputRoot: string, policy: UiReviewSelection["policy"]): Promise<void> {
  let files = 0
  let bytes = 0
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error("UI_REVIEW_STAGING_SYMLINK_INVALID")
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile()) throw new Error("UI_REVIEW_STAGING_ENTRY_INVALID")
      files += 1
      bytes += (await stat(path)).size
      if (files > policy.maxFiles || bytes > policy.maxBytes) {
        throw new Error(`UI_REVIEW_STAGING_LIMIT:${files}:${bytes}`)
      }
    }
  }
  await visit(resolve(outputRoot))
}

export async function assertStagingBounds(outputRoot: string, selection: UiReviewSelection): Promise<void> {
  let files = 1
  let bytes = (await stat(resolve(outputRoot, "selection.json"))).size
  for (const viewport of selection.viewports) {
    for (const state of viewport.selected) {
      for (const path of [state.screenshotPath, `${state.reproducePath}/trace.jsonl`, `${state.reproducePath}/reproduce.json`]) {
        files += 1
        bytes += (await stat(resolve(outputRoot, path))).size
      }
    }
  }
  if (files > selection.policy.maxFiles || bytes > selection.policy.maxBytes) {
    throw new Error(`UI_REVIEW_STAGING_LIMIT:${files}:${bytes}`)
  }
}

function prioritizeEntries(entries: BombadilTraceEntry[]): BombadilTraceEntry[] {
  const violations = entries.filter((entry) => entry.violations.length > 0)
  const rest = entries.filter((entry) => entry.violations.length === 0)
  const diverse: BombadilTraceEntry[] = []
  const deferred: BombadilTraceEntry[] = []
  const seenCategories = new Set<string>()
  for (const entry of rest) {
    const contributes = entry.categories.some((category) => !seenCategories.has(category))
    if (contributes) {
      diverse.push(entry)
      entry.categories.forEach((category) => seenCategories.add(category))
    } else {
      deferred.push(entry)
    }
  }
  return [...violations, ...diverse, ...deferred]
}

function normalizedScreenshotExtension(path: string): ".png" | ".jpg" | ".jpeg" {
  const extension = extname(path).toLowerCase()
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg") return extension
  throw new Error("UI_REVIEW_TRACE_SCREENSHOT_EXTENSION_INVALID")
}

function increment(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1
}

function isViewport(value: unknown, spec: UiReviewSpec): value is UiReviewViewport {
  if (!isRecord(value) || typeof value.name !== "string") return false
  const expected = spec.viewports.find((viewport) => viewport.name === value.name)
  return Boolean(expected)
    && value.width === expected!.width
    && value.height === expected!.height
    && value.deviceScaleFactor === expected!.deviceScaleFactor
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((count) => Number.isInteger(count) && (count as number) >= 0)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
