import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import type { UiReviewSelectionState } from "./exploration"
import { hexadecimalHammingDistance, perceptualHashImage } from "./imageHash"
import { normalizeManifestState, parseBombadilTrace, sha256Json } from "./trace"
import { createUiReviewReproducePath, type UiReviewViewport } from "./contracts"
import type { UiReviewSpec } from "./reviewSpec"

export type UiReviewReproduceManifest = {
  schemaVersion: 1
  stateId: string
  scenarioId: string
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

export async function verifyReproducedFinalState(
  replayRoot: string,
  expected: UiReviewReproduceManifest,
): Promise<void> {
  const final = (await parseBombadilTrace(replayRoot)).at(-1)
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
  spec: UiReviewSpec
}): Promise<void> {
  const { selected, manifest, spec } = input
  if (manifest.stateId !== selected.id
    || manifest.scenarioId !== spec.id
    || manifest.scenarioSpecRevision !== spec.specRevision
    || manifest.fixtureResetId !== spec.fixtureResetId
    || selected.reproducePath !== createUiReviewReproducePath(selected.id)
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

export async function readReproduceManifest(path: string, spec: UiReviewSpec): Promise<UiReviewReproduceManifest> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(raw)
    || raw.schemaVersion !== 1
    || typeof raw.stateId !== "string"
    || raw.scenarioId !== spec.id
    || raw.scenarioSpecRevision !== spec.specRevision
    || raw.fixtureResetId !== spec.fixtureResetId
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

function isViewport(value: unknown): value is UiReviewViewport {
  return isRecord(value)
    && typeof value.name === "string"
    && Boolean(value.name)
    && Number.isInteger(value.width)
    && Number.isInteger(value.height)
    && typeof value.deviceScaleFactor === "number"
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
