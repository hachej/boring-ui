import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { perceptualHashImage } from "./imageHash"

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

export async function parseBombadilTrace(rawRoot: string): Promise<BombadilTraceEntry[]> {
  const contents = await readFile(resolve(rawRoot, "trace.jsonl"), "utf8")
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
      normalizedStateSignature: sha256Json(normalizedState),
      screenshotDigest: createHash("sha256").update(bytes).digest("hex"),
      screenshotPHash: perceptualHashImage(bytes),
      screenshotBytes: bytes.byteLength,
      categories: classifyState(normalizedState, violations),
    })
  }
  if (entries.length === 0) throw new Error("UI_REVIEW_TRACE_EMPTY")
  return entries
}

export function normalizeManifestState(
  url: string,
  snapshots: Array<{ name: string; value: unknown }>,
): Record<string, unknown> {
  const manifest: Record<string, unknown> = { path: new URL(url).pathname }
  for (const snapshot of snapshots) {
    if (snapshot.name === "palette") manifest.palette = normalizeJson(snapshot.value)
  }
  return manifest
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
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

function scalarMetadata(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
