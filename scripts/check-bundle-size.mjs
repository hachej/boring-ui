import { appendFile, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { gzipSync } from "node:zlib"

const DEFAULT_DIST = path.resolve("packages/workspace/dist")
const DEFAULT_ENTRY = "workspace.js"

function parseArgs(argv) {
  let distDir = DEFAULT_DIST
  let entryFile = DEFAULT_ENTRY

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dist" && argv[index + 1]) {
      distDir = path.resolve(argv[index + 1])
      index += 1
      continue
    }
    if (arg === "--entry" && argv[index + 1]) {
      entryFile = argv[index + 1]
      index += 1
      continue
    }
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { distDir, entryFile }
}

function printHelp() {
  console.log(`Usage: node scripts/check-bundle-size.mjs [--dist <path>] [--entry <file>]

Environment variables:
  BUNDLE_INITIAL_BUDGET_KB  enforced budget for initial JS (default: 800)
  BUNDLE_TOTAL_BUDGET_KB    enforced budget for total JS (default: 800)
  BUNDLE_TARGET_INITIAL_KB  plan target for initial JS report (default: 150)
  BUNDLE_TARGET_TOTAL_KB    plan target for total JS report (default: 800)
`)
}

function parseBudget(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}="${raw}". Expected a positive number (KB).`,
    )
  }
  return parsed
}

function toKb(bytes) {
  return bytes / 1024
}

function formatKb(bytes) {
  return `${toKb(bytes).toFixed(2)} KB`
}

function formatStatus(ok) {
  return ok ? "PASS" : "FAIL"
}

function findEntryChunk(chunks, entryFile) {
  const exact = chunks.find((chunk) => chunk.file === entryFile)
  if (exact) return exact

  const fallback = chunks.find((chunk) => chunk.file.startsWith("workspace"))
  if (fallback) return fallback

  throw new Error(
    `Unable to locate initial entry chunk "${entryFile}" in dist output.`,
  )
}

function table(rows) {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => String(row[col]).length)),
  )

  return rows
    .map((row) =>
      row
        .map((cell, col) => String(cell).padEnd(widths[col]))
        .join(" | "),
    )
    .join("\n")
}

async function collectJsChunks(distDir) {
  const entries = await readdir(distDir, { withFileTypes: true })
  const jsEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".js"),
  )

  const chunks = await Promise.all(
    jsEntries.map(async (entry) => {
      const fullPath = path.join(distDir, entry.name)
      const source = await readFile(fullPath)
      return {
        file: entry.name,
        rawBytes: source.byteLength,
        gzipBytes: gzipSync(source).byteLength,
      }
    }),
  )

  return chunks.sort((a, b) => a.file.localeCompare(b.file))
}

function buildSummary({
  initialChunk,
  totalBytes,
  initialBudgetKb,
  totalBudgetKb,
  targetInitialKb,
  targetTotalKb,
}) {
  const initialHardPass = toKb(initialChunk.gzipBytes) <= initialBudgetKb
  const totalHardPass = toKb(totalBytes) <= totalBudgetKb
  const initialTargetPass = toKb(initialChunk.gzipBytes) <= targetInitialKb
  const totalTargetPass = toKb(totalBytes) <= targetTotalKb

  const rows = [
    ["Metric", "Actual (gzip)", "Hard Budget", "Target", "Hard", "Target"],
    [
      "Initial JS (shell + registry)",
      formatKb(initialChunk.gzipBytes),
      `${initialBudgetKb.toFixed(2)} KB`,
      `${targetInitialKb.toFixed(2)} KB`,
      formatStatus(initialHardPass),
      formatStatus(initialTargetPass),
    ],
    [
      "Total JS (all chunks)",
      formatKb(totalBytes),
      `${totalBudgetKb.toFixed(2)} KB`,
      `${targetTotalKb.toFixed(2)} KB`,
      formatStatus(totalHardPass),
      formatStatus(totalTargetPass),
    ],
  ]

  return {
    initialHardPass,
    totalHardPass,
    initialTargetPass,
    totalTargetPass,
    renderedTable: table(rows),
  }
}

async function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  await appendFile(summaryPath, markdown, "utf8")
}

async function main() {
  const { distDir, entryFile } = parseArgs(process.argv.slice(2))

  const initialBudgetKb = parseBudget("BUNDLE_INITIAL_BUDGET_KB", 800)
  const totalBudgetKb = parseBudget("BUNDLE_TOTAL_BUDGET_KB", 800)
  const targetInitialKb = parseBudget("BUNDLE_TARGET_INITIAL_KB", 150)
  const targetTotalKb = parseBudget("BUNDLE_TARGET_TOTAL_KB", 800)

  const chunks = await collectJsChunks(distDir)
  if (chunks.length === 0) {
    throw new Error(`No JavaScript chunks found in ${distDir}`)
  }

  const initialChunk = findEntryChunk(chunks, entryFile)
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0)
  const summary = buildSummary({
    initialChunk,
    totalBytes,
    initialBudgetKb,
    totalBudgetKb,
    targetInitialKb,
    targetTotalKb,
  })

  console.log("\nBundle size budgets (gzip):")
  console.log(summary.renderedTable)
  console.log("\nPer-chunk gzip breakdown:")
  for (const chunk of chunks) {
    console.log(`- ${chunk.file}: ${formatKb(chunk.gzipBytes)}`)
  }

  await writeStepSummary([
    "### Bundle Budget Report",
    "",
    "```text",
    summary.renderedTable,
    "```",
    "",
    "**Chunks (gzip):**",
    ...chunks.map((chunk) => `- \`${chunk.file}\`: ${formatKb(chunk.gzipBytes)}`),
    "",
  ].join("\n"))

  if (!summary.initialHardPass || !summary.totalHardPass) {
    console.error("\nBundle budget check failed.")
    process.exit(1)
  }

  console.log("\nBundle budget check passed.")

  if (!summary.initialTargetPass || !summary.totalTargetPass) {
    console.warn(
      "Plan target not yet met. Hard budget passed, but optimization follow-up is still required.",
    )
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Bundle size check failed: ${message}`)
  process.exit(1)
})
