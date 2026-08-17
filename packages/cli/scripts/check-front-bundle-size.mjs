import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

const publicDir = new URL("../public/", import.meta.url)
const budgetBytes = Number(process.env.CLI_ENTRY_BUDGET_BYTES ?? 1_000_000)
const eagerBudgetBytes = Number(process.env.CLI_EAGER_BUDGET_BYTES ?? 1_000_000)
const html = readFileSync(new URL("index.html", publicDir), "utf8")
const entry = html.match(/<script[^>]+src="\/([^\"]+\.js)"/)?.[1]
if (!entry) throw new Error("CLI bundle budget: index.html has no module entry")

const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^\"]+\.js)"/g)].map((match) => match[1])
const assetsDir = new URL("assets/", publicDir)
const chunks = readdirSync(assetsDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({ file: `assets/${file}`, bytes: statSync(new URL(file, assetsDir)).size }))
  .sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file))
const entryBytes = statSync(new URL(entry, publicDir)).size
const eagerFiles = [...new Set([entry, ...preloads])]
const eagerBytes = eagerFiles.reduce((total, file) => total + statSync(new URL(file, publicDir)).size, 0)

const rows = [
  "## CLI front bundle report",
  "",
  `Entry: \`${entry}\` — **${entryBytes.toLocaleString()} B** / ${budgetBytes.toLocaleString()} B budget`,
  `Eager HTML JS: **${eagerBytes.toLocaleString()} B** / ${eagerBudgetBytes.toLocaleString()} B budget across ${eagerFiles.length} files (${preloads.length} modulepreloads)`,
  "",
  "| Chunk | Bytes | Eager |",
  "| --- | ---: | :---: |",
  ...chunks.map(({ file, bytes }) => `| \`${basename(file)}\` | ${bytes.toLocaleString()} | ${eagerFiles.includes(file) ? "yes" : ""} |`),
  "",
]
const report = rows.join("\n")
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
if (entryBytes > budgetBytes) {
  console.error(`CLI entry exceeds budget by ${(entryBytes - budgetBytes).toLocaleString()} B`)
  process.exitCode = 1
}
if (eagerBytes > eagerBudgetBytes) {
  console.error(`CLI eager HTML JS exceeds budget by ${(eagerBytes - eagerBudgetBytes).toLocaleString()} B`)
  process.exitCode = 1
}
