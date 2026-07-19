import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { chromium } from "@playwright/test"
import {
  UI_REVIEW_STAGING_POLICY,
  assertStagingBounds,
  stageBombadilSelection,
  writeSelection,
  type UiReviewSelection,
} from "../src/ui-review/exploration"
import {
  COMMAND_PALETTE_FIXTURE_RESET_ID,
  COMMAND_PALETTE_SPEC_REVISION,
  readReproduceManifest,
  validateReproduceOwnership,
  verifyReproducedFinalState,
} from "../src/ui-review/replay"
import type { UiReviewViewport } from "../src/ui-review/contracts"

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputRoot = resolve(process.env.UI_REVIEW_OUTPUT_DIR ?? join(tmpdir(), "boring-ui-review-output"))
const runId = process.env.UI_REVIEW_RUN_ID?.trim() || `command-palette-${Date.now()}`
const vitePort = Number(process.env.UI_REVIEW_VITE_PORT ?? "5380")
const origin = `http://127.0.0.1:${vitePort}/?fresh=1`
const timeLimit = process.env.BOMBADIL_TIME_LIMIT?.trim() || "30s"
const specPath = resolve(APP_ROOT, "e2e/bombadil/command-palette.spec.ts")
const bombadil = resolve(APP_ROOT, "node_modules/.bin/bombadil")
const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]

await mkdir(outputRoot, { recursive: true })
const server = startVite()
try {
  await waitForTarget(server)
  await warmTarget()
  const selection: UiReviewSelection = {
    schemaVersion: 1,
    policy: UI_REVIEW_STAGING_POLICY,
    runId,
    scenarioId: "command-palette",
    scenarioSpecRevision: COMMAND_PALETTE_SPEC_REVISION,
    fixtureResetId: COMMAND_PALETTE_FIXTURE_RESET_ID,
    origin: new URL(origin).origin,
    viewports: [],
    stagedFiles: 1,
    stagedBytes: 0,
  }
  for (const viewport of viewports) {
    const rawRoot = await mkdtemp(join(tmpdir(), `boring-ui-review-${viewport.name}.`))
    await runBombadil([
      "browser", "test", origin, specPath,
      "--time-limit", timeLimit,
      "--output-path", rawRoot,
      "--headless",
      "--width", String(viewport.width),
      "--height", String(viewport.height),
      "--device-scale-factor", String(viewport.deviceScaleFactor),
      "--instrument-javascript", "inline",
    ], APP_ROOT)
    const staged = await stageBombadilSelection({
      rawRoot,
      outputRoot,
      runId,
      origin,
      viewport,
      existingFiles: selection.stagedFiles,
      existingBytes: selection.stagedBytes,
    })
    selection.stagedFiles = staged.stagedFiles
    selection.stagedBytes = staged.stagedBytes
    selection.viewports.push({
      viewport,
      rawStates: staged.rawStates,
      selected: staged.selected,
      overflow: staged.overflow,
      rawViolations: staged.rawViolations,
    })
  }
  await writeSelection(outputRoot, selection)
  await assertStagingBounds(outputRoot, selection)

  // Proof is intentionally a real CLI replay, not an exit-code-only smoke.
  for (const viewport of selection.viewports) {
    const selected = viewport.selected.find((state) => {
      const palette = state.normalizedState.palette
      return state.ordinal > 2 && state.action === "Wait" && isRecord(palette) && palette.dialogVisible === true
    })
    if (!selected) throw new Error(`UI_REVIEW_EXPLORATION_STABLE_ACTION_STATE_MISSING:${viewport.viewport.name}`)
    const bundleArgument = selected.reproducePath
    const bundleRoot = resolve(outputRoot, bundleArgument)
    const manifest = await readReproduceManifest(resolve(bundleRoot, "reproduce.json"))
    await validateReproduceOwnership({ outputRoot, selected, manifest, origin, targetUrl: origin })
    const replayRoot = await mkdtemp(join(tmpdir(), `boring-ui-review-replay-${viewport.viewport.name}.`))
    await runBombadil([
      "browser", "test", manifest.targetUrl, specPath,
      "--output-path", replayRoot,
      "--headless",
      "--width", String(manifest.viewport.width),
      "--height", String(manifest.viewport.height),
      "--device-scale-factor", String(manifest.viewport.deviceScaleFactor),
      "--instrument-javascript", "inline",
      "--reproduce", bundleArgument,
    ], outputRoot)
    await verifyReproducedFinalState(replayRoot, manifest)
    console.log(`verified Bombadil replay final state: ${selected.id}`)
  }
} finally {
  await stop(server)
}

function startVite(): ChildProcess {
  return spawn("pnpm", ["exec", "vite"], {
    cwd: APP_ROOT,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  })
}

async function waitForTarget(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`UI_REVIEW_VITE_EXITED:${server.exitCode}`)
    try {
      const response = await fetch(origin)
      if (response.ok) {
        await sleep(1_000)
        return
      }
    } catch {
      // Retry until the bounded boot deadline.
    }
    await sleep(200)
  }
  throw new Error("UI_REVIEW_VITE_BOOT_TIMEOUT")
}

async function warmTarget(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const browserErrors: string[] = []
    const recordBrowserError = (value: string) => {
      browserErrors.push(value.slice(0, 1_000))
      if (browserErrors.length > 20) browserErrors.shift()
    }
    page.on("pageerror", (error) => recordBrowserError(`pageerror: ${error.message}`))
    page.on("console", (message) => { if (message.type() === "error") recordBrowserError(`console: ${message.text()}`) })
    const readinessDeadline = Date.now() + 120_000
    let ready = false
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 })
      for (let attempt = 0; attempt < 4 && !ready && Date.now() < readinessDeadline; attempt += 1) {
        const waitTimeout = Math.min(20_000, readinessDeadline - Date.now())
        try {
          await Promise.all([
            page.getByRole("main", { name: "Chat" }).waitFor({ state: "visible", timeout: waitTimeout }),
            page.locator("button").filter({ hasText: /^Search/ }).first().waitFor({ state: "visible", timeout: waitTimeout }),
          ])
          ready = true
        } catch (error) {
          recordBrowserError(`readiness attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`)
          const reloadTimeRemaining = readinessDeadline - Date.now()
          if (attempt < 3 && reloadTimeRemaining > 0) {
            await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(20_000, reloadTimeRemaining) }).catch((reloadError) => {
              recordBrowserError(`reload: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`)
            })
          }
        }
      }
    } catch (error) {
      recordBrowserError(`navigation: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!ready) {
      const diagnostics = [
        `url: ${page.url()}`,
        `body: ${(await page.locator("body").innerText().catch(() => "<unavailable>")).slice(0, 4_000)}`,
        ...browserErrors,
      ].join("\n").slice(0, 24_000)
      await writeFile(resolve(outputRoot, "bootstrap-error.txt"), diagnostics, "utf8")
      throw new Error("UI_REVIEW_TARGET_NOT_READY")
    }
    await page.waitForTimeout(5_000)
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 })
    await Promise.all([
      page.getByRole("main", { name: "Chat" }).waitFor({ state: "visible", timeout: 60_000 }),
      page.locator("button").filter({ hasText: /^Search/ }).first().waitFor({ state: "visible", timeout: 60_000 }),
    ])
  } finally {
    await browser.close()
  }
}

async function runBombadil(args: string[], cwd: string): Promise<void> {
  console.log(`bombadil ${args.map(shellDisplay).join(" ")}`)
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(bombadil, args, { cwd, env: process.env, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => code === 0 || code === 2
      ? resolveRun()
      : reject(new Error(`UI_REVIEW_BOMBADIL_FAILED:${code ?? "unknown"}`)))
  })
}

async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return
  server.kill("SIGTERM")
  await Promise.race([
    new Promise<void>((resolveExit) => server.once("exit", () => resolveExit())),
    sleep(5_000),
  ])
  if (server.exitCode === null) server.kill("SIGKILL")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shellDisplay(value: string): string {
  return /^[a-zA-Z0-9_./:?=-]+$/.test(value) ? value : JSON.stringify(value)
}
