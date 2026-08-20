import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

const publicDir = new URL("../public/", import.meta.url)
const budgetBytes = Number(process.env.CLI_ENTRY_BUDGET_BYTES ?? 1_000_000)
const eagerBudgetBytes = Number(process.env.CLI_EAGER_BUDGET_BYTES ?? 1_000_000)
const startupBudgetBytes = Number(process.env.CLI_STARTUP_BUDGET_BYTES ?? 2_500_000)
const preChatBudgetBytes = Number(process.env.CLI_PRE_CHAT_BUDGET_BYTES ?? 4_000_000)
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

// HTML preload hints are not the whole mandatory startup graph: the entry can
// still statically import chunks that the browser discovers while parsing it.
// Traverse Vite's manifest so the regression gate covers every static import.
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", publicDir), "utf8"))
const manifestEntry = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.file === entry)
if (!manifestEntry) throw new Error(`CLI bundle budget: manifest has no entry for ${entry}`)
function collectStaticImports(chunk, files) {
  if (files.has(chunk.file)) return
  files.add(chunk.file)
  for (const importedKey of chunk.imports ?? []) {
    const imported = manifest[importedKey]
    if (!imported) throw new Error(`CLI bundle budget: manifest import ${importedKey} is missing`)
    collectStaticImports(imported, files)
  }
}
const startupFiles = new Set()
collectStaticImports(manifestEntry, startupFiles)
const startupBytes = [...startupFiles].reduce((total, file) => total + statSync(new URL(file, publicDir)).size, 0)

// The CLI waits for these default front descriptors before mounting chat, so
// their static closures are mandatory pre-chat work even though Vite represents
// the descriptor entries as dynamic imports from the application entry.
const defaultFrontSourceFragments = [
  "plugins/ask-user/src/front/index",
  "plugins/boring-automation/src/front/index",
  "plugins/diagram/src/front/index",
  "plugins/tasks/dist/front/index",
  "plugins/live-transcription/src/front/index",
]
const defaultFrontEntries = Object.entries(manifest)
  .filter(([key]) => defaultFrontSourceFragments.some((fragment) => key.includes(fragment)))
  .map(([, chunk]) => chunk)
if (defaultFrontEntries.length !== defaultFrontSourceFragments.length) {
  throw new Error(`CLI bundle budget: expected ${defaultFrontSourceFragments.length} default front entries, found ${defaultFrontEntries.length}`)
}
const preChatFiles = new Set(startupFiles)
for (const chunk of defaultFrontEntries) collectStaticImports(chunk, preChatFiles)
const preChatBytes = [...preChatFiles].reduce((total, file) => total + statSync(new URL(file, publicDir)).size, 0)

const rows = [
  "## CLI front bundle report",
  "",
  `Entry: \`${entry}\` — **${entryBytes.toLocaleString()} B** / ${budgetBytes.toLocaleString()} B budget`,
  `HTML entry + preload hints: **${eagerBytes.toLocaleString()} B** / ${eagerBudgetBytes.toLocaleString()} B budget across ${eagerFiles.length} files (${preloads.length} modulepreloads)`,
  `Mandatory startup static-import closure: **${startupBytes.toLocaleString()} B** / ${startupBudgetBytes.toLocaleString()} B budget across ${startupFiles.size} files`,
  `Mandatory pre-chat closure (entry + default front descriptors): **${preChatBytes.toLocaleString()} B** / ${preChatBudgetBytes.toLocaleString()} B budget across ${preChatFiles.size} files`,
  "",
  "| Chunk | Bytes | HTML eager | Startup closure | Pre-chat closure |",
  "| --- | ---: | :---: | :---: | :---: |",
  ...chunks.map(({ file, bytes }) => `| \`${basename(file)}\` | ${bytes.toLocaleString()} | ${eagerFiles.includes(file) ? "yes" : ""} | ${startupFiles.has(file) ? "yes" : ""} | ${preChatFiles.has(file) ? "yes" : ""} |`),
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
  console.error(`CLI HTML entry + preload hints exceed budget by ${(eagerBytes - eagerBudgetBytes).toLocaleString()} B`)
  process.exitCode = 1
}
if (startupBytes > startupBudgetBytes) {
  console.error(`CLI mandatory startup closure exceeds budget by ${(startupBytes - startupBudgetBytes).toLocaleString()} B`)
  process.exitCode = 1
}
if (preChatBytes > preChatBudgetBytes) {
  console.error(`CLI mandatory pre-chat closure exceeds budget by ${(preChatBytes - preChatBudgetBytes).toLocaleString()} B`)
  process.exitCode = 1
}
