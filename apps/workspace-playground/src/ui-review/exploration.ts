import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, resolve, sep } from "node:path"
import { inflateSync } from "node:zlib"
import { decode as decodeJpeg } from "jpeg-js"
import {
  UI_REVIEW_MAX_SELECTED_BYTES,
  UI_REVIEW_MAX_STATES_PER_VIEWPORT,
  createUiReviewStateId,
  type UiReviewState,
  type UiReviewViewport,
} from "./contracts"

export const COMMAND_PALETTE_SPEC_REVISION = "command-palette-bombadil-v1"
export const COMMAND_PALETTE_FIXTURE_RESET_ID = "workspace-playground-e2e-fresh-v1"
export const UI_REVIEW_STAGING_POLICY = {
  version: 1,
  // Reserve the three known Playwright checkpoints inside the 12-state budget.
  maxStatesPerViewport: UI_REVIEW_MAX_STATES_PER_VIEWPORT - 3,
  maxFiles: 73,
  maxBytes: UI_REVIEW_MAX_SELECTED_BYTES,
  reservedFinalFiles: 18,
  reservedFinalBytes: 2 * 1024 * 1024,
} as const

export type BombadilTraceEntry = {
  ordinal: number
  rawLine: string
  action: unknown
  state: {
    url: string
    hashPrevious: string | number | null
    hashCurrent: string | number | null
    screenshot: string
  }
  snapshots: Array<{ name: string; value: unknown }>
  violations: unknown[]
  normalizedState: Record<string, unknown>
  normalizedStateSignature: string
  screenshotDigest: string
  screenshotPHash: string
  screenshotBytes: number
  categories: string[]
}

export type UiReviewReproduceManifest = {
  schemaVersion: 1
  stateId: string
  scenarioId: "command-palette"
  scenarioSpecRevision: string
  fixtureResetId: string
  origin: string
  targetUrl: string
  viewport: UiReviewViewport
  expectedNormalizedStateSignature: string
  expectedScreenshotDigest: string
  expectedScreenshotPHash: string
  maximumScreenshotPHashDistance: number
  traceDigest: string
  sourceScreenshotName: string
  actionCount: number
  hashCurrent: string | number | null
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
  policy: typeof UI_REVIEW_STAGING_POLICY
  runId: string
  scenarioId: "command-palette"
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

export async function parseBombadilTrace(rawRoot: string): Promise<BombadilTraceEntry[]> {
  const tracePath = resolve(rawRoot, "trace.jsonl")
  const contents = await readFile(tracePath, "utf8")
  const lines = contents.split(/\r?\n/).filter((line) => line.trim())
  const entries: BombadilTraceEntry[] = []
  for (const [index, rawLine] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawLine)
    } catch {
      throw new Error(`UI_REVIEW_TRACE_JSON_INVALID:${index + 1}`)
    }
    if (!isRecord(parsed) || !isRecord(parsed.state) || typeof parsed.state.screenshot !== "string" || typeof parsed.state.url !== "string") {
      throw new Error(`UI_REVIEW_TRACE_ENTRY_INVALID:${index + 1}`)
    }
    const screenshot = resolve(rawRoot, parsed.state.screenshot)
    const screenshotsRoot = resolve(rawRoot, "screenshots")
    if (screenshot !== screenshotsRoot && !screenshot.startsWith(`${screenshotsRoot}${sep}`)) {
      throw new Error(`UI_REVIEW_TRACE_SCREENSHOT_PATH_INVALID:${index + 1}`)
    }
    const bytes = await readFile(screenshot)
    if (!Array.isArray(parsed.snapshots) || !Array.isArray(parsed.violations)) {
      throw new Error(`UI_REVIEW_TRACE_COLLECTION_INVALID:${index + 1}`)
    }
    const snapshots = parsed.snapshots.map((snapshot) => {
      if (!isRecord(snapshot) || typeof snapshot.name !== "string" || !("value" in snapshot)) {
        throw new Error(`UI_REVIEW_TRACE_SNAPSHOT_INVALID:${index + 1}`)
      }
      return { name: snapshot.name, value: snapshot.value }
    })
    const violations = parsed.violations
    const normalizedState = normalizeManifestState(parsed.state.url, snapshots)
    const normalizedStateSignature = sha256Json(normalizedState)
    entries.push({
      ordinal: index + 1,
      rawLine,
      action: parsed.action ?? null,
      state: {
        url: parsed.state.url,
        hashPrevious: scalarMetadata(parsed.state.hash_previous),
        hashCurrent: scalarMetadata(parsed.state.hash_current),
        screenshot,
      },
      snapshots,
      violations,
      normalizedState,
      normalizedStateSignature,
      screenshotDigest: createHash("sha256").update(bytes).digest("hex"),
      screenshotPHash: perceptualHashImage(bytes),
      screenshotBytes: bytes.byteLength,
      categories: classifyState(normalizedState, violations),
    })
  }
  if (entries.length === 0) throw new Error("UI_REVIEW_TRACE_EMPTY")
  return entries
}

export async function stageBombadilSelection(input: {
  rawRoot: string
  outputRoot: string
  runId: string
  origin: string
  viewport: UiReviewViewport
  existingFiles?: number
  existingBytes?: number
}): Promise<{
  selected: UiReviewSelectionState[]
  overflow: Record<string, number>
  stagedFiles: number
  stagedBytes: number
  rawStates: number
  rawViolations: Array<{ ordinal: number; violations: unknown[] }>
}> {
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
    if (selected.length >= UI_REVIEW_STAGING_POLICY.maxStatesPerViewport) {
      increment(overflow, "state-limit")
      continue
    }
    const checkpoint = `explore-${String(entry.ordinal).padStart(4, "0")}-${entry.categories[0] ?? "layout"}`
    const stateId = createUiReviewStateId({
      runId: input.runId,
      scenarioId: "command-palette",
      role: "candidate",
      viewport: input.viewport,
      checkpoint,
      screenshotDigest: entry.screenshotDigest,
    })
    const extension = normalizedScreenshotExtension(entry.state.screenshot)
    const screenshotPath = `selected/${input.viewport.name}/${stateId.replaceAll(":", "-")}${extension}`
    const reproducePath = `reproduce/${stateId}`
    const prefixLines = entries.slice(0, entry.ordinal).map((candidate) => candidate.rawLine).join("\n") + "\n"
    const reproduce: UiReviewReproduceManifest = {
      schemaVersion: 1,
      stateId,
      scenarioId: "command-palette",
      scenarioSpecRevision: COMMAND_PALETTE_SPEC_REVISION,
      fixtureResetId: COMMAND_PALETTE_FIXTURE_RESET_ID,
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
    if (stagedFiles + 3 > UI_REVIEW_STAGING_POLICY.maxFiles - UI_REVIEW_STAGING_POLICY.reservedFinalFiles) {
      increment(overflow, "file-limit")
      continue
    }
    if (stagedBytes + addedBytes > UI_REVIEW_STAGING_POLICY.maxBytes - UI_REVIEW_STAGING_POLICY.reservedFinalBytes) {
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
      scenarioId: "command-palette",
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

export async function verifyReproducedFinalState(replayRoot: string, expected: UiReviewReproduceManifest): Promise<void> {
  const entries = await parseBombadilTrace(replayRoot)
  const final = entries.at(-1)
  if (!final) throw new Error(`UI_REVIEW_REPRODUCE_EMPTY:${expected.stateId}`)
  if (final.normalizedStateSignature !== expected.expectedNormalizedStateSignature) {
    throw new Error(`UI_REVIEW_REPRODUCE_STATE_MISMATCH:${expected.stateId}`)
  }
  const screenshotDistance = hexadecimalHammingDistance(final.screenshotPHash, expected.expectedScreenshotPHash)
  if (screenshotDistance > expected.maximumScreenshotPHashDistance) {
    throw new Error(`UI_REVIEW_REPRODUCE_SCREENSHOT_MISMATCH:${expected.stateId}:${screenshotDistance}`)
  }
}

export async function validateReproduceOwnership(input: {
  outputRoot: string
  selected: UiReviewSelectionState
  manifest: UiReviewReproduceManifest
  origin: string
  targetUrl: string
}): Promise<void> {
  const { selected, manifest } = input
  if (manifest.stateId !== selected.id
    || selected.reproducePath !== `reproduce/${selected.id}`
    || manifest.origin !== new URL(input.origin).origin
    || manifest.targetUrl !== input.targetUrl
    || JSON.stringify(manifest.viewport) !== JSON.stringify(selected.viewport)
    || manifest.expectedNormalizedStateSignature !== selected.normalizedStateSignature
    || manifest.expectedScreenshotDigest !== selected.screenshotDigest
    || manifest.actionCount !== selected.ordinal
    || manifest.hashCurrent !== selected.hashCurrent) {
    throw new Error(`UI_REVIEW_REPRODUCE_OWNERSHIP_INVALID:${selected.id}`)
  }

  const screenshot = await readFile(resolve(input.outputRoot, selected.screenshotPath))
  if (createHash("sha256").update(screenshot).digest("hex") !== manifest.expectedScreenshotDigest
    || perceptualHashImage(screenshot) !== manifest.expectedScreenshotPHash) {
    throw new Error(`UI_REVIEW_REPRODUCE_SCREENSHOT_OWNERSHIP_INVALID:${selected.id}`)
  }
  const trace = await readFile(resolve(input.outputRoot, selected.reproducePath, "trace.jsonl"), "utf8")
  const lines = trace.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length !== manifest.actionCount) throw new Error(`UI_REVIEW_REPRODUCE_PREFIX_INVALID:${selected.id}`)
  if (createHash("sha256").update(trace).digest("hex") !== manifest.traceDigest) {
    throw new Error(`UI_REVIEW_REPRODUCE_PREFIX_DIGEST_INVALID:${selected.id}`)
  }
  const final: unknown = JSON.parse(lines.at(-1)!)
  if (!isRecord(final) || JSON.stringify(final.action ?? null) !== JSON.stringify(selected.action ?? null)) {
    throw new Error(`UI_REVIEW_REPRODUCE_ACTION_INVALID:${selected.id}`)
  }
  if (!isRecord(final.state)
    || typeof final.state.url !== "string"
    || new URL(final.state.url).origin !== new URL(manifest.targetUrl).origin
    || new URL(final.state.url).pathname !== new URL(manifest.targetUrl).pathname
    || final.state.hash_current !== manifest.hashCurrent
    || typeof final.state.screenshot !== "string"
    || basename(final.state.screenshot) !== manifest.sourceScreenshotName
    || !Array.isArray(final.snapshots)) {
    throw new Error(`UI_REVIEW_REPRODUCE_TRACE_STATE_INVALID:${selected.id}`)
  }
  const snapshots = final.snapshots.map((snapshot) => {
    if (!isRecord(snapshot) || typeof snapshot.name !== "string" || !("value" in snapshot)) {
      throw new Error(`UI_REVIEW_REPRODUCE_TRACE_SNAPSHOT_INVALID:${selected.id}`)
    }
    return { name: snapshot.name, value: snapshot.value }
  })
  if (sha256Json(normalizeManifestState(final.state.url, snapshots)) !== selected.normalizedStateSignature) {
    throw new Error(`UI_REVIEW_REPRODUCE_TRACE_SIGNATURE_INVALID:${selected.id}`)
  }
}

export async function readReproduceManifest(path: string): Promise<UiReviewReproduceManifest> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(raw)
    || raw.schemaVersion !== 1
    || typeof raw.stateId !== "string"
    || raw.scenarioId !== "command-palette"
    || raw.scenarioSpecRevision !== COMMAND_PALETTE_SPEC_REVISION
    || raw.fixtureResetId !== COMMAND_PALETTE_FIXTURE_RESET_ID
    || typeof raw.origin !== "string"
    || typeof raw.targetUrl !== "string"
    || !isViewport(raw.viewport)
    || !isSha256(raw.expectedNormalizedStateSignature)
    || !isSha256(raw.expectedScreenshotDigest)
    || typeof raw.expectedScreenshotPHash !== "string"
    || !/^[a-f0-9]{16}$/i.test(raw.expectedScreenshotPHash)
    || !isSha256(raw.traceDigest)
    || typeof raw.sourceScreenshotName !== "string"
    || !/^[a-zA-Z0-9._-]+\.(?:png|jpe?g)$/.test(raw.sourceScreenshotName)
    || !Number.isInteger(raw.maximumScreenshotPHashDistance)
    || (raw.maximumScreenshotPHashDistance as number) < 0
    || (raw.maximumScreenshotPHashDistance as number) > 64
    || !Number.isInteger(raw.actionCount)
    || (raw.actionCount as number) < 1
    || (raw.hashCurrent !== null && typeof raw.hashCurrent !== "string" && typeof raw.hashCurrent !== "number")) {
    throw new Error("UI_REVIEW_REPRODUCE_MANIFEST_INVALID")
  }
  if (new URL(raw.targetUrl).origin !== new URL(raw.origin).origin || new URL(raw.origin).origin !== raw.origin) {
    throw new Error("UI_REVIEW_REPRODUCE_ORIGIN_INVALID")
  }
  return raw as unknown as UiReviewReproduceManifest
}

export function validateUiReviewSelection(
  raw: unknown,
  expected: { runId: string; origin: string },
): UiReviewSelection {
  if (!isRecord(raw)
    || raw.schemaVersion !== 1
    || raw.runId !== expected.runId
    || raw.scenarioId !== "command-palette"
    || raw.scenarioSpecRevision !== COMMAND_PALETTE_SPEC_REVISION
    || raw.fixtureResetId !== COMMAND_PALETTE_FIXTURE_RESET_ID
    || raw.origin !== new URL(expected.origin).origin
    || JSON.stringify(raw.policy) !== JSON.stringify(UI_REVIEW_STAGING_POLICY)
    || !Array.isArray(raw.viewports)
    || raw.viewports.length !== 2
    || !Number.isInteger(raw.stagedFiles)
    || !Number.isInteger(raw.stagedBytes)) {
    throw new Error("UI_REVIEW_SELECTION_INVALID")
  }
  const names = new Set<string>()
  for (const viewportEntry of raw.viewports) {
    if (!isRecord(viewportEntry)
      || !isViewport(viewportEntry.viewport)
      || names.has(viewportEntry.viewport.name)
      || !Number.isInteger(viewportEntry.rawStates)
      || (viewportEntry.rawStates as number) < 1
      || !Array.isArray(viewportEntry.selected)
      || viewportEntry.selected.length < 1
      || viewportEntry.selected.length > UI_REVIEW_STAGING_POLICY.maxStatesPerViewport
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
  if (!names.has("desktop") || !names.has("mobile")) throw new Error("UI_REVIEW_SELECTION_VIEWPORT_MATRIX_INVALID")
  return raw as unknown as UiReviewSelection
}

export async function writeSelection(outputRoot: string, selection: UiReviewSelection): Promise<void> {
  const json = `${JSON.stringify(selection, null, 2)}\n`
  const bytes = Buffer.byteLength(json)
  if (selection.stagedBytes + bytes > UI_REVIEW_STAGING_POLICY.maxBytes) throw new Error("UI_REVIEW_SELECTION_BYTE_LIMIT")
  await writeFile(resolve(outputRoot, "selection.json"), json, "utf8")
}

export async function assertBoundedStagingDirectory(outputRoot: string): Promise<void> {
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
      if (files > UI_REVIEW_STAGING_POLICY.maxFiles || bytes > UI_REVIEW_STAGING_POLICY.maxBytes) {
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
  if (files > UI_REVIEW_STAGING_POLICY.maxFiles || bytes > UI_REVIEW_STAGING_POLICY.maxBytes) {
    throw new Error(`UI_REVIEW_STAGING_LIMIT:${files}:${bytes}`)
  }
}

function normalizeManifestState(url: string, snapshots: Array<{ name: string; value: unknown }>): Record<string, unknown> {
  const manifest: Record<string, unknown> = { path: new URL(url).pathname }
  for (const snapshot of snapshots) {
    if (snapshot.name === "palette") manifest.palette = normalizeJson(snapshot.value)
  }
  return manifest
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (!isRecord(value)) return value === undefined ? null : value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]))
}

function classifyState(state: Record<string, unknown>, violations: unknown[]): string[] {
  const encoded = JSON.stringify(state).toLowerCase()
  const categories: string[] = []
  if (violations.length > 0) categories.push("violation")
  if (/"dialogvisible":true|"dialog":true|popover/.test(encoded)) categories.push("dialog-popover")
  if (/"loading":true/.test(encoded)) categories.push("loading")
  if (/"error":true/.test(encoded)) categories.push("error")
  if (/"empty":true/.test(encoded)) categories.push("empty")
  if (/"horizontaloverflow":true|overflow|layout/.test(encoded)) categories.push("layout")
  if (categories.length === 0) categories.push("layout")
  return [...new Set(categories)]
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

export function perceptualHashImage(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const decoded = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true })
    return averageHashPixels(decoded.data, decoded.width, decoded.height, 4, false)
  }
  const signature = "89504e470d0a1a0a"
  if (buffer.subarray(0, 8).toString("hex") !== signature) throw new Error("UI_REVIEW_SCREENSHOT_IMAGE_INVALID")

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const compressed: Buffer[] = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii")
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error("UI_REVIEW_SCREENSHOT_PNG_TRUNCATED")
    const data = buffer.subarray(dataStart, dataEnd)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? -1
      interlace = data[12] ?? -1
    } else if (type === "IDAT") {
      compressed.push(data)
    } else if (type === "IEND") {
      break
    }
    offset = dataEnd + 4
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!width || !height || bitDepth !== 8 || channels === 0 || interlace !== 0 || compressed.length === 0) {
    throw new Error("UI_REVIEW_SCREENSHOT_PNG_FORMAT_UNSUPPORTED")
  }

  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(compressed))
  if (inflated.length !== (stride + 1) * height) throw new Error("UI_REVIEW_SCREENSHOT_PNG_DATA_INVALID")
  const pixels = Buffer.alloc(stride * height)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++]!
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[sourceOffset++]!
      const left = x >= channels ? pixels[rowOffset + x - channels]! : 0
      const up = y > 0 ? pixels[rowOffset + x - stride]! : 0
      const upLeft = y > 0 && x >= channels ? pixels[rowOffset + x - stride - channels]! : 0
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paeth(left, up, upLeft)
                : -1
      if (predictor < 0) throw new Error("UI_REVIEW_SCREENSHOT_PNG_FILTER_INVALID")
      pixels[rowOffset + x] = (encoded + predictor) & 0xff
    }
  }

  return averageHashPixels(pixels, width, height, channels, colorType === 0 || colorType === 4)
}

function averageHashPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  grayscale: boolean,
): string {
  if (width <= 0 || height <= 0) throw new Error("UI_REVIEW_SCREENSHOT_DIMENSIONS_INVALID")
  const stride = width * channels
  const luminance: number[] = []
  for (let sampleY = 0; sampleY < 8; sampleY += 1) {
    const y = Math.min(height - 1, Math.floor(((sampleY + 0.5) * height) / 8))
    for (let sampleX = 0; sampleX < 8; sampleX += 1) {
      const x = Math.min(width - 1, Math.floor(((sampleX + 0.5) * width) / 8))
      const pixelOffset = y * stride + x * channels
      const red = pixels[pixelOffset]!
      const green = grayscale ? red : pixels[pixelOffset + 1]!
      const blue = grayscale ? red : pixels[pixelOffset + 2]!
      luminance.push(Math.round(red * 0.299 + green * 0.587 + blue * 0.114))
    }
  }
  const average = luminance.reduce((sum, value) => sum + value, 0) / luminance.length
  let hash = ""
  for (let index = 0; index < luminance.length; index += 4) {
    let nibble = 0
    for (let bit = 0; bit < 4; bit += 1) {
      if (luminance[index + bit]! >= average) nibble |= 1 << (3 - bit)
    }
    hash += nibble.toString(16)
  }
  return hash
}

export function hexadecimalHammingDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) {
    throw new Error("UI_REVIEW_SCREENSHOT_PHASH_INVALID")
  }
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    let xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16)
    while (xor > 0) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function scalarMetadata(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function increment(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1
}

function isViewport(value: unknown): value is UiReviewViewport {
  if (!isRecord(value) || (value.name !== "desktop" && value.name !== "mobile")) return false
  const expected = value.name === "desktop"
    ? { width: 1440, height: 900, deviceScaleFactor: 1 }
    : { width: 390, height: 844, deviceScaleFactor: 1 }
  return value.width === expected.width
    && value.height === expected.height
    && value.deviceScaleFactor === expected.deviceScaleFactor
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
