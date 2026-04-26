import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { gzipSync } from "node:zlib"

const FRONT_DIR = path.resolve("packages/core/dist/front")
const DIST_DIR = path.resolve("packages/core/dist")
const SIZE_MD = path.resolve("packages/core/SIZE.md")
const DRIFT_THRESHOLD = 0.10

function toKb(bytes) {
  return bytes / 1024
}

function formatKb(bytes) {
  return `${toKb(bytes).toFixed(2)} KB`
}

async function measureFile(filePath) {
  const source = await readFile(filePath)
  return {
    file: path.relative(DIST_DIR, filePath),
    rawBytes: source.byteLength,
    gzipBytes: gzipSync(source).byteLength,
  }
}

async function collectFrontChunks() {
  const entryPath = path.join(FRONT_DIR, "index.js")
  const entrySource = await readFile(entryPath, "utf8")

  const chunks = [await measureFile(entryPath)]

  const importRe = /from\s+["'](\.\.\/(chunk-[^"']+\.js))["']/g
  let match
  while ((match = importRe.exec(entrySource)) !== null) {
    const chunkPath = path.join(FRONT_DIR, match[1])
    chunks.push(await measureFile(chunkPath))
  }

  return chunks.sort((a, b) => a.file.localeCompare(b.file))
}

function parseBaseline(content) {
  const match = content.match(/Total gzip:\s*([\d.]+)\s*KB/)
  if (!match) return null
  return Number(match[1])
}

function renderSizeMd(totalGzipKb, chunks) {
  const lines = [
    "# @boring/core front bundle size",
    "",
    `Total gzip: ${totalGzipKb.toFixed(2)} KB`,
    "",
    "## Chunks",
    "",
    ...chunks.map((c) => `- \`${c.file}\`: ${formatKb(c.gzipBytes)}`),
    "",
    `_Updated: ${new Date().toISOString().slice(0, 10)}_`,
    "",
  ]
  return lines.join("\n")
}

async function main() {
  const updateBaseline = process.argv.includes("--update-baseline")

  let chunks
  try {
    chunks = await collectFrontChunks()
  } catch {
    console.error(
      `No dist output found at ${FRONT_DIR}. Run "pnpm --filter @boring/core build" first.`,
    )
    process.exit(1)
  }

  if (chunks.length === 0) {
    console.error(`No JS chunks in ${FRONT_DIR}`)
    process.exit(1)
  }

  const totalGzipBytes = chunks.reduce((sum, c) => sum + c.gzipBytes, 0)
  const totalGzipKb = toKb(totalGzipBytes)

  console.log("\n@boring/core front bundle (gzip):")
  for (const chunk of chunks) {
    console.log(`  ${chunk.file}: ${formatKb(chunk.gzipBytes)}`)
  }
  console.log(`  TOTAL: ${totalGzipKb.toFixed(2)} KB\n`)

  if (updateBaseline) {
    await writeFile(SIZE_MD, renderSizeMd(totalGzipKb, chunks), "utf8")
    console.log(`Baseline updated in ${SIZE_MD}`)
    return
  }

  let baselineContent
  try {
    baselineContent = await readFile(SIZE_MD, "utf8")
  } catch {
    console.log("No SIZE.md baseline found — creating initial baseline.")
    await writeFile(SIZE_MD, renderSizeMd(totalGzipKb, chunks), "utf8")
    console.log(`Baseline written to ${SIZE_MD}`)
    return
  }

  const baselineKb = parseBaseline(baselineContent)
  if (baselineKb === null) {
    console.error("Could not parse baseline from SIZE.md. Run with --update-baseline.")
    process.exit(1)
  }

  const drift = (totalGzipKb - baselineKb) / baselineKb
  const driftPct = (drift * 100).toFixed(1)

  console.log(`Baseline: ${baselineKb.toFixed(2)} KB`)
  console.log(`Current:  ${totalGzipKb.toFixed(2)} KB`)
  console.log(`Drift:    ${driftPct}%`)

  if (drift > DRIFT_THRESHOLD) {
    console.error(
      `\nBundle grew ${driftPct}% over baseline (threshold: ${(DRIFT_THRESHOLD * 100).toFixed(0)}%).`,
    )
    console.error(
      `If this growth is intentional, run: node scripts/check-core-bundle-size.mjs --update-baseline`,
    )
    process.exit(1)
  }

  console.log("\nBundle size check PASSED.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
