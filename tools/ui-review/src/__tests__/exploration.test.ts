import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createUiReviewStagingPolicy,
  parseBombadilTrace,
  stageBombadilSelection as stageForSpec,
} from "../core/exploration"
import { hexadecimalHammingDistance } from "../core/imageHash"
import {
  readReproduceManifest as readManifestForSpec,
  validateReproduceOwnership as validateOwnershipForSpec,
  verifyReproducedFinalState,
} from "../core/replay"
import { isSafeCommandPaletteControl } from "../review-specs/workspace-command-palette/scenarioActions"
import { testSpec, testStagingPolicy } from "./fixtures"

const UI_REVIEW_STAGING_POLICY = testStagingPolicy
const stageBombadilSelection = (input: Omit<Parameters<typeof stageForSpec>[0], "spec">) => stageForSpec({ ...input, spec: testSpec })
const readReproduceManifest = (path: string) => readManifestForSpec(path, testSpec)
const validateReproduceOwnership = (input: Omit<Parameters<typeof validateOwnershipForSpec>[0], "spec">) => validateOwnershipForSpec({ ...input, spec: testSpec })

const viewport = { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 } as const

describe("Bombadil exploration staging", () => {
  it("reserves final files for candidate and paired baseline checkpoints", () => {
    const policy = createUiReviewStagingPolicy(testSpec)
    expect(policy.reservedFinalFiles).toBe(8 + (2 * testSpec.checkpoints.length * testSpec.viewports.length))
    expect(policy.maxFiles - policy.reservedFinalFiles).toBe(55)
  })

  it("parses action/state/hash/screenshot/violations and ignores hashes for visual dedupe", async () => {
    const raw = await fixture([
      entry(1, { hash: 10, screenshot: "same", palette: { dialogVisible: false } }),
      entry(2, { hash: 999, screenshot: "same", palette: { dialogVisible: false }, violations: [{ property: "lateViolation" }] }),
      entry(3, { hash: 10, screenshot: "same", palette: { dialogVisible: true } }),
    ])
    const parsed = await parseBombadilTrace(raw)
    expect(parsed[0]).toMatchObject({ ordinal: 1, action: null, state: { hashCurrent: 10 }, violations: [] })
    expect(parsed[0]!.normalizedStateSignature).toHaveLength(64)

    const outputRoot = await mkdtemp(join(tmpdir(), "ui-review-stage."))
    const staged = await stageBombadilSelection({ rawRoot: raw, outputRoot, runId: "run", origin: "http://localhost:5380/?fresh=1", viewport })
    expect(staged.selected).toHaveLength(2)
    expect(staged.overflow).toMatchObject({ "duplicate-visual-state": 1 })
    expect(staged.selected[0]!.hashCurrent).toBe(999)
    expect(staged.selected[0]!.violations).toHaveLength(1)
    expect(staged.rawViolations).toEqual([{ ordinal: 2, violations: [{ property: "lateViolation" }] }])
    expect(await readFile(join(outputRoot, staged.selected[0]!.reproducePath, "trace.jsonl"), "utf8")).toContain('"hash_current":999')
    const selected = staged.selected[0]!
    const reproduce = await readReproduceManifest(join(outputRoot, selected.reproducePath, "reproduce.json"))
    await expect(validateReproduceOwnership({
      outputRoot,
      selected,
      manifest: reproduce,
      origin: "http://localhost:5380/?fresh=1",
      targetUrl: "http://localhost:5380/?fresh=1",
    })).resolves.toBeUndefined()
    await expect(validateReproduceOwnership({
      outputRoot,
      selected,
      manifest: { ...reproduce, stateId: "other" },
      origin: "http://localhost:5380/?fresh=1",
      targetUrl: "http://localhost:5380/?fresh=1",
    })).rejects.toThrow("UI_REVIEW_REPRODUCE_OWNERSHIP_INVALID")
    const tracePath = join(outputRoot, selected.reproducePath, "trace.jsonl")
    await writeFile(tracePath, (await readFile(tracePath, "utf8")).replace('"hash_current":999', '"hash_current":998'))
    await expect(validateReproduceOwnership({
      outputRoot,
      selected,
      manifest: reproduce,
      origin: "http://localhost:5380/?fresh=1",
      targetUrl: "http://localhost:5380/?fresh=1",
    })).rejects.toThrow("UI_REVIEW_REPRODUCE_PREFIX_DIGEST_INVALID")
  })

  it("rejects malformed trace collections instead of treating them as passing", async () => {
    const raw = await fixture([entry(1, { screenshot: "one" })])
    const tracePath = join(raw, "trace.jsonl")
    const parsed = JSON.parse((await readFile(tracePath, "utf8")).trim())
    parsed.violations = {}
    await writeFile(tracePath, `${JSON.stringify(parsed)}\n`)
    await expect(parseBombadilTrace(raw)).rejects.toThrow("UI_REVIEW_TRACE_COLLECTION_INVALID")
  })

  it("measures perceptual hash similarity by Hamming distance", () => {
    expect(hexadecimalHammingDistance("0000000000000000", "0000000000000003")).toBe(2)
  })

  it("prioritizes violations then diverse dialog/loading/error/empty/layout states", async () => {
    const raw = await fixture([
      entry(1, { screenshot: "layout", palette: { horizontalOverflow: false } }),
      entry(2, { screenshot: "dialog", palette: { dialogVisible: true } }),
      entry(3, { screenshot: "loading", palette: { loading: true } }),
      entry(4, { screenshot: "error", palette: { error: true } }),
      entry(5, { screenshot: "empty", palette: { empty: true } }),
      entry(6, { screenshot: "violation", violations: [{ property: "noConsoleErrors" }] }),
    ])
    const outputRoot = await mkdtemp(join(tmpdir(), "ui-review-priority."))
    const staged = await stageBombadilSelection({ rawRoot: raw, outputRoot, runId: "run", origin: "http://localhost:5380/?fresh=1", viewport })
    expect(staged.selected[0]!.ordinal).toBe(6)
    expect(new Set(staged.selected.flatMap((state) => state.categories))).toEqual(new Set([
      "violation", "layout", "dialog-popover", "loading", "error", "empty",
    ]))
  })

  it("caps states and reports state/file/byte overflow reasons", async () => {
    const many = Array.from({ length: 14 }, (_, index) => entry(index + 1, {
      screenshot: `unique-${index}`,
      palette: { dialogVisible: index % 2 === 0, query: String(index) },
    }))
    const raw = await fixture(many)
    const outputRoot = await mkdtemp(join(tmpdir(), "ui-review-bounds."))
    const capped = await stageBombadilSelection({ rawRoot: raw, outputRoot, runId: "run", origin: "http://localhost:5380", viewport })
    expect(capped.selected).toHaveLength(UI_REVIEW_STAGING_POLICY.maxStatesPerViewport)
    expect(capped.overflow["state-limit"]).toBe(14 - UI_REVIEW_STAGING_POLICY.maxStatesPerViewport)

    const files = await stageBombadilSelection({ rawRoot: raw, outputRoot: await mkdtemp(join(tmpdir(), "ui-review-files.")), runId: "run", origin: "http://localhost:5380", viewport, existingFiles: UI_REVIEW_STAGING_POLICY.maxFiles })
    expect(files.selected).toHaveLength(0)
    expect(files.overflow["file-limit"]).toBe(14)

    const bytes = await stageBombadilSelection({ rawRoot: raw, outputRoot: await mkdtemp(join(tmpdir(), "ui-review-bytes.")), runId: "run", origin: "http://localhost:5380", viewport, existingBytes: UI_REVIEW_STAGING_POLICY.maxBytes })
    expect(bytes.selected).toHaveLength(0)
    expect(bytes.overflow["byte-limit"]).toBe(14)
  })

  it("verifies replay final normalized state and screenshot, not exit alone", async () => {
    const raw = await fixture([entry(1, { screenshot: "expected", palette: { dialogVisible: true } })])
    const [expected] = await parseBombadilTrace(raw)
    await expect(verifyReproducedFinalState(raw, {
      schemaVersion: 1,
      stateId: "state",
      scenarioId: "command-palette",
      scenarioSpecRevision: "command-palette-bombadil-v1",
      fixtureResetId: "workspace-playground-e2e-fresh-v1",
      origin: "http://localhost:5380",
      targetUrl: "http://localhost:5380/?fresh=1",
      viewport,
      expectedNormalizedStateSignature: expected!.normalizedStateSignature,
      expectedScreenshotDigest: expected!.screenshotDigest,
      expectedScreenshotPHash: expected!.screenshotPHash,
      maximumScreenshotPHashDistance: 8,
      traceDigest: "a".repeat(64),
      sourceScreenshotName: "1.png",
      actionCount: 1,
      hashCurrent: 1,
    })).resolves.toBeUndefined()
    await expect(verifyReproducedFinalState(raw, {
      schemaVersion: 1,
      stateId: "state",
      scenarioId: "command-palette",
      scenarioSpecRevision: "command-palette-bombadil-v1",
      fixtureResetId: "workspace-playground-e2e-fresh-v1",
      origin: "http://localhost:5380",
      targetUrl: "http://localhost:5380/?fresh=1",
      viewport,
      expectedNormalizedStateSignature: "0".repeat(64),
      expectedScreenshotDigest: expected!.screenshotDigest,
      expectedScreenshotPHash: expected!.screenshotPHash,
      maximumScreenshotPHashDistance: 8,
      traceDigest: "a".repeat(64),
      sourceScreenshotName: "1.png",
      actionCount: 1,
      hashCurrent: 1,
    })).rejects.toThrow("UI_REVIEW_REPRODUCE_STATE_MISMATCH")
  })
})

describe("command palette action safety", () => {
  it("allows only named non-submitting local palette controls", () => {
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Search catalogs and commands", insideDialog: false })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Search", insideDialog: false })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Search⌘K", insideDialog: false })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Open app navigation", insideDialog: false })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Commands", insideDialog: true })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Files", insideDialog: true })).toBe(true)
    expect(isSafeCommandPaletteControl({ tagName: "a", label: "Commands", href: "https://example.com", insideDialog: true })).toBe(false)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Delete workspace", insideDialog: true })).toBe(false)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Commands", type: "submit", insideDialog: true })).toBe(false)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Files", formAction: "https://example.com", insideDialog: true })).toBe(false)
    expect(isSafeCommandPaletteControl({ tagName: "button", label: "Open externally", insideDialog: true })).toBe(false)
  })
})

type EntryOptions = {
  hash?: number
  screenshot: string
  palette?: Record<string, unknown>
  violations?: unknown[]
}

function entry(ordinal: number, options: EntryOptions) {
  return { ordinal, ...options }
}

async function fixture(entries: Array<ReturnType<typeof entry>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ui-review-trace."))
  await mkdir(join(root, "screenshots"), { recursive: true })
  const lines: string[] = []
  for (const item of entries) {
    const screenshot = join(root, "screenshots", `${item.ordinal}.png`)
    const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    await writeFile(screenshot, Buffer.concat([onePixelPng, Buffer.from(item.screenshot)]))
    lines.push(JSON.stringify({
      timestamp: item.ordinal,
      action: item.ordinal === 1 ? null : { PressKey: { code: 27 } },
      state: {
        url: "http://localhost:5380/?fresh=1",
        hash_previous: item.ordinal - 1,
        hash_current: item.hash ?? item.ordinal,
        screenshot,
      },
      snapshots: [{ index: 0, name: "palette", value: item.palette ?? {}, time: item.ordinal }],
      violations: item.violations ?? [],
    }))
  }
  await writeFile(join(root, "trace.jsonl"), `${lines.join("\n")}\n`)
  return root
}
