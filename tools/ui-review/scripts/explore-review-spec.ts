import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { chromium } from "@playwright/test"
import { createUiReviewStagingPolicy, assertStagingBounds, stageBombadilSelection, writeSelection, type UiReviewSelection } from "../src/core/exploration"
import { readReproduceManifest, validateReproduceOwnership, verifyReproducedFinalState } from "../src/core/replay"
import { getUiReviewSpec } from "../src/registry"

const spec = getUiReviewSpec(requiredEnv("UI_REVIEW_SPEC"))
if (!spec.exploration) process.exit(0)
const repoRoot = resolve(import.meta.dirname, "../../..")
const targetRoot = resolve(repoRoot, spec.target.root)
const outputRoot = resolve(process.env.UI_REVIEW_OUTPUT_DIR ?? join(tmpdir(), "boring-ui-review-output"))
const runId = requiredEnv("UI_REVIEW_RUN_ID")
const port = Number(requiredEnv("UI_REVIEW_VITE_PORT"))
const origin = `http://127.0.0.1:${port}${spec.target.route}`
const timeLimit = process.env.BOMBADIL_TIME_LIMIT?.trim() || "30s"
const bombadil = resolve(import.meta.dirname, "../node_modules/.bin/bombadil")
const targetReady = spec.exploration.ready ?? spec.target.ready

await mkdir(outputRoot, { recursive: true })
const server = startTarget()
try {
  await waitForTarget(server)
  await warmTarget()
  const selection: UiReviewSelection = {
    schemaVersion: 1,
    policy: createUiReviewStagingPolicy(spec),
    runId,
    scenarioId: spec.id,
    scenarioSpecRevision: spec.specRevision,
    fixtureResetId: spec.fixtureResetId,
    origin: new URL(origin).origin,
    viewports: [], stagedFiles: 1, stagedBytes: 0,
  }
  for (const viewport of spec.viewports) {
    const rawRoot = await mkdtemp(join(tmpdir(), `boring-ui-review-${viewport.name}.`))
    await runBombadil(["browser", "test", origin, spec.exploration.bombadilSpecPath, "--time-limit", timeLimit, "--output-path", rawRoot, "--headless", "--width", String(viewport.width), "--height", String(viewport.height), "--device-scale-factor", String(viewport.deviceScaleFactor), "--instrument-javascript", "inline"], targetRoot)
    const staged = await stageBombadilSelection({ rawRoot, outputRoot, runId, origin, viewport, existingFiles: selection.stagedFiles, existingBytes: selection.stagedBytes, spec })
    selection.stagedFiles = staged.stagedFiles
    selection.stagedBytes = staged.stagedBytes
    selection.viewports.push({ viewport, rawStates: staged.rawStates, selected: staged.selected, overflow: staged.overflow, rawViolations: staged.rawViolations })
  }
  await writeSelection(outputRoot, selection)
  await assertStagingBounds(outputRoot, selection)
  for (const viewport of selection.viewports) {
    const selected = spec.exploration.selectReplayState(viewport.selected)
    if (!selected) throw new Error(`UI_REVIEW_EXPLORATION_STABLE_ACTION_STATE_MISSING:${viewport.viewport.name}`)
    const bundleArgument = selected.reproducePath!
    const manifest = await readReproduceManifest(resolve(outputRoot, bundleArgument, "reproduce.json"), spec)
    await validateReproduceOwnership({ outputRoot, selected: selected as never, manifest, origin, targetUrl: origin, spec })
    const replayRoot = await mkdtemp(join(tmpdir(), `boring-ui-review-replay-${viewport.viewport.name}.`))
    await runBombadil(["browser", "test", manifest.targetUrl, spec.exploration.bombadilSpecPath, "--output-path", replayRoot, "--headless", "--width", String(manifest.viewport.width), "--height", String(manifest.viewport.height), "--device-scale-factor", String(manifest.viewport.deviceScaleFactor), "--instrument-javascript", "inline", "--reproduce", bundleArgument], outputRoot)
    await verifyReproducedFinalState(replayRoot, manifest)
    console.log(`verified Bombadil replay final state: ${selected.id}`)
  }
} finally { await stop(server) }

function startTarget(): ChildProcess {
  const [command, ...args] = spec.target.serverCommand
  return spawn(command, args, { cwd: targetRoot, env: process.env, stdio: ["ignore", "inherit", "inherit"] })
}
async function waitForTarget(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`UI_REVIEW_TARGET_EXITED:${server.exitCode}`)
    try { if ((await fetch(origin)).ok) { await sleep(1_000); return } } catch {}
    await sleep(200)
  }
  throw new Error("UI_REVIEW_TARGET_BOOT_TIMEOUT")
}
async function warmTarget(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const errors: string[] = []
    const record = (value: string) => { errors.push(value.slice(0, 1_000)); if (errors.length > 20) errors.shift() }
    let page = await browser.newPage()
    const observe = () => {
      page.on("pageerror", (error) => record(`pageerror: ${error.message}`))
      page.on("console", (message) => { if (message.type() === "error") record(`console: ${message.text()}`) })
    }
    const openFreshPage = async (attempt: string, timeout: number) => {
      await page.close().catch(() => {})
      page = await browser.newPage()
      observe()
      const target = new URL(origin)
      target.searchParams.set("uiReviewWarm", attempt)
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout })
    }
    observe()
    const deadline = Date.now() + 120_000
    let ready = false
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 })
      for (let attempt = 0; attempt < 6 && !ready && Date.now() < deadline; attempt += 1) {
        try {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          await targetReady(page, Math.min(20_000, remaining))
          ready = true
        } catch (error) {
          record(`readiness attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`)
          const remaining = deadline - Date.now()
          if (attempt < 5 && remaining > 0) {
            await sleep(1_000)
            await openFreshPage(String(attempt + 1), Math.min(20_000, remaining)).catch((error) => record(`fresh navigation: ${String(error)}`))
          }
        }
      }
    } catch (error) { record(`navigation: ${error instanceof Error ? error.message : String(error)}`) }
    if (!ready) {
      const diagnostics = [`url: ${page.url()}`, `body: ${(await page.locator("body").innerText().catch(() => "<unavailable>")).slice(0, 4_000)}`, ...errors].join("\n").slice(0, 24_000)
      await writeFile(resolve(outputRoot, "bootstrap-error.txt"), diagnostics, "utf8")
      throw new Error("UI_REVIEW_TARGET_NOT_READY")
    }
    await page.waitForTimeout(5_000)
    await openFreshPage("final", 60_000)
    await targetReady(page, 60_000)
  } finally { await browser.close() }
}
async function runBombadil(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(bombadil, args, { cwd, env: process.env, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => code === 0 || code === 2 ? resolveRun() : reject(new Error(`UI_REVIEW_BOMBADIL_FAILED:${code ?? "unknown"}`)))
  })
}
async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return
  server.kill("SIGTERM")
  await Promise.race([new Promise<void>((resolveExit) => server.once("exit", () => resolveExit())), sleep(5_000)])
  if (server.exitCode === null) server.kill("SIGKILL")
}
function requiredEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`UI_REVIEW_REQUIRED_ENV_MISSING:${name}`); return value }
