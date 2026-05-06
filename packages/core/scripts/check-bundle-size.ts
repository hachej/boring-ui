import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { gzipSync } from "node:zlib"

// ─── Config ──────��───────────────────────────────────────────────────

const CORE_DIST = path.resolve("dist")
const SIZE_MD = path.resolve("SIZE.md")
const DRIFT_THRESHOLD = 0.10

interface Entry {
  name: string
  baselineKb: number | null
  currentKb: number
  chunks: Chunk[]
}

interface Chunk {
  file: string
  gzipBytes: number
}

// ─── Measure ─────────────��───────────────────────────────────────────

async function measureFile(filePath: string): Promise<Chunk> {
  const source = await readFile(filePath)
  return {
    file: path.relative(CORE_DIST, filePath),
    gzipBytes: gzipSync(source).byteLength,
  }
}

async function collectEntryChunks(entryPath: string): Promise<Chunk[]> {
  const source = await readFile(entryPath, "utf8")
  const chunks: Chunk[] = [await measureFile(entryPath)]

  const importRe = /from\s+["'](\.\.\/(chunk-[^"']+\.js))["']/g
  let match: RegExpExecArray | null
  while ((match = importRe.exec(source)) !== null) {
    const chunkPath = path.join(path.dirname(entryPath), match[1])
    chunks.push(await measureFile(chunkPath))
  }

  return chunks.sort((a, b) => a.file.localeCompare(b.file))
}

async function measureEntry(name: string, subdir: string): Promise<Entry> {
  const entryPath = path.join(CORE_DIST, subdir, "index.js")
  const chunks = await collectEntryChunks(entryPath)
  const currentKb = toKb(chunks.reduce((sum, c) => sum + c.gzipBytes, 0))
  return { name, baselineKb: null, currentKb, chunks }
}

// ─── SIZE.md parse / render ────────────────��─────────────────────────

function parseSizeMd(content: string): Map<string, number> {
  const baselines = new Map<string, number>()
  const rowRe = /\|\s*(\w+)\s*\|\s*([\d.]+)\s*\|/g
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(content)) !== null) {
    const name = match[1].toLowerCase()
    const kb = Number(match[2])
    if (Number.isFinite(kb) && kb > 0) baselines.set(name, kb)
  }
  return baselines
}

function renderSizeMd(entries: Entry[]): string {
  const lines = [
    "# @hachej/boring-core bundle size",
    "",
    "| Entry  | Gzip (KB) |",
    "|--------|-----------|",
    ...entries.map(
      (e) => `| ${e.name.padEnd(6)} | ${e.currentKb.toFixed(2).padStart(9)} |`,
    ),
    "",
    "### Chunk breakdown",
    "",
    ...entries.flatMap((e) => [
      `**${e.name}**`,
      ...e.chunks.map((c) => `- \`${c.file}\`: ${formatKb(c.gzipBytes)}`),
      "",
    ]),
    `_Updated: ${new Date().toISOString().slice(0, 10)}_`,
    "",
  ]
  return lines.join("\n")
}

// ─── Escape hatches ──────────────────────────────────────────────────

function approvedGrowth(): string | null {
  const desc = process.env.PR_DESCRIPTION ?? process.env.PR_BODY ?? ""
  const match = desc.match(/\/\/\s*approved-growth:\s*(.+)/i)
  return match ? match[1].trim() : null
}

// ─── Helpers ─────────���───────────────────────────────────────────────

function toKb(bytes: number): number {
  return bytes / 1024
}

function formatKb(bytes: number): string {
  return `${toKb(bytes).toFixed(2)} KB`
}

// ─── Main ───────────────────��─────────────────────────────��──────────

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes("--update-baseline")

  let entries: Entry[]
  try {
    entries = await Promise.all([
      measureEntry("front", "front"),
      measureEntry("server", "server"),
    ])
  } catch {
    console.error(
      `No dist output found at ${CORE_DIST}. Run "pnpm --filter @hachej/boring-core build" first.`,
    )
    process.exit(1)
  }

  console.log("\n@hachej/boring-core bundle sizes (gzip):")
  for (const entry of entries) {
    console.log(`  ${entry.name}:`)
    for (const chunk of entry.chunks) {
      console.log(`    ${chunk.file}: ${formatKb(chunk.gzipBytes)}`)
    }
    console.log(`    TOTAL: ${entry.currentKb.toFixed(2)} KB`)
  }
  console.log()

  if (updateBaseline) {
    await writeFile(SIZE_MD, renderSizeMd(entries), "utf8")
    console.log(`Baseline updated in ${SIZE_MD}`)
    return
  }

  let baselineContent: string
  try {
    baselineContent = await readFile(SIZE_MD, "utf8")
  } catch {
    console.log("No SIZE.md baseline found — creating initial baseline.")
    await writeFile(SIZE_MD, renderSizeMd(entries), "utf8")
    console.log(`Baseline written to ${SIZE_MD}`)
    return
  }

  const baselines = parseSizeMd(baselineContent)
  if (baselines.size === 0) {
    console.error(
      "Could not parse any baselines from SIZE.md. Run with --update-baseline.",
    )
    process.exit(1)
  }

  for (const entry of entries) {
    entry.baselineKb = baselines.get(entry.name) ?? null
  }

  const failures: string[] = []

  for (const entry of entries) {
    if (entry.baselineKb === null) {
      console.log(
        `  ${entry.name}: no baseline (new entry) — ${entry.currentKb.toFixed(2)} KB`,
      )
      continue
    }

    const drift = (entry.currentKb - entry.baselineKb) / entry.baselineKb
    const driftPct = (drift * 100).toFixed(1)

    console.log(
      `  ${entry.name}: baseline ${entry.baselineKb.toFixed(2)} KB → current ${entry.currentKb.toFixed(2)} KB (${drift >= 0 ? "+" : ""}${driftPct}%)`,
    )

    if (drift > DRIFT_THRESHOLD) {
      failures.push(
        `${entry.name} grew ${driftPct}% (${entry.baselineKb.toFixed(2)} → ${entry.currentKb.toFixed(2)} KB)`,
      )
    }
  }

  if (failures.length === 0) {
    console.log("\nBundle size check PASSED.")
    return
  }

  const approval = approvedGrowth()
  if (approval) {
    console.log(`\nGrowth approved via PR description: "${approval}"`)
    console.log("Bundle size check PASSED (approved growth).")
    return
  }

  console.error("\nBundle size check FAILED:")
  for (const f of failures) {
    console.error(`  - ${f}`)
  }
  console.error(
    `\nThreshold: ${(DRIFT_THRESHOLD * 100).toFixed(0)}%. To approve:`,
  )
  console.error(
    `  1. Bump baseline: pnpm --filter @hachej/boring-core run check:bundle-size -- --update-baseline`,
  )
  console.error(
    `  2. Or add "// approved-growth: <reason>" to your PR description`,
  )
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
