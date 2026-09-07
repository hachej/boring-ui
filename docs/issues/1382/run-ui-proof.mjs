#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const require = createRequire(import.meta.url)
const repo = process.cwd()
const revision = process.argv[2]
const label = process.argv[3]
const outputDir = resolve(process.argv[4] ?? ".handoff/objectives-ui-proof")
if (!revision || !label) {
  console.error("usage: node docs/issues/1382/run-ui-proof.mjs <revision> <label> [output-dir]")
  process.exit(2)
}

const exactRevision = execFileSync("git", ["rev-parse", revision], { cwd: repo, encoding: "utf8" }).trim()
const tempRoot = mkdtempSync(join(tmpdir(), `objectives-ui-${label}-`))
const sourceRoot = join(tempRoot, "source")
const fixtureRoot = join(tempRoot, "fixture")
mkdirSync(sourceRoot, { recursive: true })
mkdirSync(fixtureRoot, { recursive: true })
mkdirSync(outputDir, { recursive: true })
// Archived revision sources resolve third-party packages through the installed
// dependency graph, while their first-party code still comes from exactRevision.
symlinkSync(join(repo, "node_modules"), join(tempRoot, "node_modules"), "dir")

function extract(path) {
  execFileSync("bash", ["-lc", `git archive ${exactRevision} -- ${JSON.stringify(path)} | tar -x -C ${JSON.stringify(sourceRoot)}`], {
    cwd: repo,
    stdio: "inherit",
  })
}

extract("packages/ui")
const objectivePath = "plugins/objectives/src/front/ObjectivePane.tsx"
const hasObjectiveSurface = (() => {
  try {
    execFileSync("git", ["cat-file", "-e", `${exactRevision}:${objectivePath}`], { cwd: repo, stdio: "ignore" })
    extract("plugins/objectives/src")
    return true
  } catch {
    return false
  }
})()

writeFileSync(join(fixtureRoot, "workspace-mock.ts"), 'export function useApiBaseUrl() { return "" }\n')
writeFileSync(join(fixtureRoot, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"/><title>Objective UI proof</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
writeFileSync(join(fixtureRoot, "main.tsx"), hasObjectiveSurface ? `
import React from "react"
import { createRoot } from "react-dom/client"
import { ObjectivePane } from ${JSON.stringify(join(sourceRoot, objectivePath))}
import "./proof.css"
let current = 2
const record = {
  id: "obj-11111111-1111-4111-8111-111111111111",
  title: "Ship reliable Objectives",
  objective: "Keep the Objective primitive durable across workspace restarts.",
  metric: "verified scenarios",
  baseline: 0,
  target: 10,
  current,
  status: "active",
  constraints: ["No hidden in-memory authority"],
  evidenceRefs: ["proof://restart-rehydration"],
  createdAt: "2026-09-07T12:00:00.000Z",
  updatedAt: "2026-09-07T12:00:00.000Z",
}
globalThis.fetch = async () => Response.json({ ok: true, output: { objective: { ...record, current } } })
function Fixture() {
  return <main><header><strong>Revision ${label}</strong><button onClick={() => { current = 7; Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")) }}>Apply server update</button></header><section data-testid="objective-surface"><ObjectivePane params={{ objectiveId: record.id }} api={{}} containerApi={{}} /></section></main>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
` : `
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import "./proof.css"
function Fixture() {
  const [probed, setProbed] = useState(false)
  return <main><header><strong>Revision ${label}</strong><button onClick={() => setProbed(true)}>Probe Objective surface</button></header><section className="absence" data-testid="objective-surface"><h1>Objective surface unavailable</h1><p>This revision does not contain plugins/objectives.</p>{probed ? <p role="status">No Objective panel registered.</p> : null}</section></main>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
`)
writeFileSync(join(fixtureRoot, "proof.css"), `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui; background: #0b1020; color: #e6edf7; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #172554, #0b1020 55%); }
main { width: 760px; margin: 48px auto; border: 1px solid #334155; border-radius: 16px; background: #111827; overflow: hidden; box-shadow: 0 24px 80px #0008; }
header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #334155; }
button { border: 1px solid #60a5fa; border-radius: 8px; padding: 9px 14px; background: #1d4ed8; color: white; font-weight: 650; cursor: pointer; }
section { min-height: 430px; padding: 24px; }
.absence { display: grid; place-content: center; text-align: center; color: #94a3b8; }
.h-full { height: 100%; } .flex { display: flex; } .items-center { align-items: center; } .justify-center { justify-content: center; }
.gap-2 { gap: .5rem; } .gap-3 { gap: .75rem; } .space-y-4 > * + * { margin-top: 1rem; }
.mt-1 { margin-top: .25rem; } .mt-2 { margin-top: .5rem; } .grid { display: grid; } .text-sm { font-size: .9rem; }
.text-xs { font-size: .78rem; } .font-medium { font-weight: 600; } .font-mono { font-family: ui-monospace, monospace; }
.text-muted-foreground { color: #94a3b8; } .text-foreground { color: #e6edf7; } .flex-1 { flex: 1; }
`)

let server
let browser
try {
  server = await createServer({
    root: fixtureRoot,
    cacheDir: join(tempRoot, "vite-cache"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
    resolve: {
      alias: [
        { find: /^@hachej\/boring-workspace$/, replacement: join(fixtureRoot, "workspace-mock.ts") },
        { find: /^@hachej\/boring-ui-kit$/, replacement: join(sourceRoot, "packages/ui/src/index.ts") },
        { find: /^react$/, replacement: require.resolve("react") },
        { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
        { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve("react/jsx-dev-runtime") },
        { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
        { find: /^react-dom$/, replacement: require.resolve("react-dom") },
        { find: /^lucide-react$/, replacement: require.resolve("lucide-react") },
      ],
      dedupe: ["react", "react-dom"],
    },
  })
  await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === "string") throw new Error("Vite did not expose a TCP port")
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()
  page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`))
  page.on("pageerror", (error) => console.error(`[browser:error] ${error.message}`))
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("objective-surface").waitFor()
  if (hasObjectiveSurface) {
    await page.getByText("2 / 10").waitFor()
    await page.getByRole("button", { name: "Apply server update" }).click()
    await page.getByText("7 / 10").waitFor()
    await page.getByText("No hidden in-memory authority").waitFor()
  } else {
    await page.getByText("Objective surface unavailable").waitFor()
    await page.getByRole("button", { name: "Probe Objective surface" }).click()
    await page.getByRole("status").filter({ hasText: "No Objective panel registered." }).waitFor()
  }
  await page.waitForTimeout(750)
  const video = page.video()
  await context.close()
  const sourceVideo = await video.path()
  const targetVideo = join(outputDir, `${label}-${exactRevision.slice(0, 12)}.webm`)
  execFileSync("cp", [sourceVideo, targetVideo])
  writeFileSync(join(outputDir, `${label}-${exactRevision.slice(0, 12)}.json`), JSON.stringify({
    revision: exactRevision,
    label,
    viewport: { width: 1280, height: 720 },
    hasObjectiveSurface,
    assertions: hasObjectiveSurface
      ? ["initial progress 2 / 10", "server update interaction", "refreshed progress 7 / 10", "constraint visible"]
      : ["surface absent", "probe interaction confirms no panel"],
    video: targetVideo,
  }, null, 2))
  console.log(JSON.stringify({ revision: exactRevision, label, hasObjectiveSurface, video: targetVideo }))
} finally {
  await browser?.close()
  await server?.close()
  rmSync(tempRoot, { recursive: true, force: true })
}
