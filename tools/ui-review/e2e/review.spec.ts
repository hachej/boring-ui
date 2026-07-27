import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import {
  DEFAULT_UI_REVIEW_MODEL,
  assertHardGatesPermitLiveCritic,
  buildPiCriticInvocation,
  createFixtureCriticReport,
  runPiCritic,
} from "../src/core/critic"
import {
  UI_REVIEW_SCHEMA_VERSION,
  createUiReviewStateId,
  validateUiCriticReport,
  validateUiReviewManifest,
  type UiHardGateReport,
  type UiReviewManifest,
  type UiReviewState,
  type UiReviewViewport,
} from "../src/core/contracts"
import {
  assertBoundedStagingDirectory,
  createUiReviewStagingPolicy,
  validateUiReviewSelection,
  type UiReviewSelection,
} from "../src/core/exploration"
import { createCalibrationRecord, createExecutionPacket } from "../src/core/improvement"
import { pairWithLocalBaseline } from "../src/core/pairing"
import { renderUiReviewHtml, renderUiReviewMarkdown } from "../src/core/report"
import {
  checkpointAppliesToViewport,
  type UiReviewBrowserErrors,
  type UiReviewCheckpoint,
  type UiReviewVisualBaselineResult,
} from "../src/core/reviewSpec"
import { getUiReviewSpec } from "../src/registry"

const TOOL_ROOT = resolve(import.meta.dirname, "..")
const REPO_ROOT = resolve(TOOL_ROOT, "../..")
const spec = getUiReviewSpec(requiredEnv("UI_REVIEW_SPEC"))
const criticSchemaSource = resolve(TOOL_ROOT, "src/core/UiCriticReportV1.schema.json")
const runId = process.env.UI_REVIEW_RUN_ID?.trim() || `${spec.id}-${Date.now()}`
const outputRoot = resolve(process.env.UI_REVIEW_OUTPUT_DIR?.trim() || `.pi/ui-review/runs/${runId}`)

// One generic driver executes the selected, repository-registered review spec.
test.describe("UI review", () => {
  test(`captures and reviews ${spec.id}`, async ({ browser }, testInfo) => {
    const exploration = await readExplorationSelection()
    const states: UiReviewState[] = exploration?.viewports.flatMap((entry) => entry.selected) ?? []
    const gateResults: UiHardGateReport["results"] = explorationGateResults(exploration)

    for (const viewport of spec.viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        colorScheme: "dark",
        locale: "en-US",
        timezoneId: "UTC",
      })
      const page = await context.newPage()
      const errors = monitorErrors(page)
      await page.goto(spec.target.route)
      await spec.target.ready(page, 60_000)
      for (const checkpoint of spec.checkpoints) {
        if (!checkpointAppliesToViewport(checkpoint, viewport.name)) continue
        await page.emulateMedia({ colorScheme: checkpoint.colorScheme ?? "dark" })
        await checkpoint.reach(page)
        const visualBaseline = await compareVisualBaseline(page, checkpoint)
        await capture(page, viewport, checkpoint.id, errors, states, gateResults, visualBaseline)
      }
      await context.close()
    }

    let reviewStates = states
    let statePairs: UiReviewManifest["statePairs"] = []
    let reviewGateResults = gateResults
    let baselineRevision: string | undefined
    let baselineTreeHash: string | undefined
    const baselineRoot = process.env.UI_REVIEW_BASELINE_DIR?.trim()
    if (baselineRoot) {
      const paired = await pairWithLocalBaseline({
        baselineRoot,
        outputRoot,
        runId,
        candidateStates: states,
        spec,
      })
      reviewStates = paired.states
      statePairs = paired.statePairs
      baselineRevision = paired.baselineRevision
      baselineTreeHash = paired.baselineTreeHash
      const includedCandidateIds = new Set(reviewStates.filter((state) => state.role === "candidate").map((state) => state.id))
      reviewGateResults = [...paired.baselineGateResults, ...gateResults.filter((result) => includedCandidateIds.has(result.stateId))]
    }

    const manifest: UiReviewManifest = {
      schemaVersion: UI_REVIEW_SCHEMA_VERSION,
      runId,
      scenarioId: spec.id,
      rubricVersion: spec.rubricVersion,
      resolvedModel: (process.env.UI_REVIEW_CRITIC ?? "fixture") === "pi"
        ? process.env.BORING_UI_REVIEW_MODEL ?? DEFAULT_UI_REVIEW_MODEL
        : "fixture",
      ...(baselineRevision ? { baselineRevision } : {}),
      ...(baselineTreeHash ? { baselineTreeHash } : {}),
      ...(process.env.UI_REVIEW_CANDIDATE_REVISION?.trim() ? { candidateRevision: process.env.UI_REVIEW_CANDIDATE_REVISION.trim() } : {}),
      ...(process.env.UI_REVIEW_CANDIDATE_TREE_HASH?.trim() ? { candidateTreeHash: process.env.UI_REVIEW_CANDIDATE_TREE_HASH.trim() } : {}),
      states: reviewStates,
      statePairs,
    }
    const hardGates: UiHardGateReport = {
      schemaVersion: UI_REVIEW_SCHEMA_VERSION,
      contractVersion: spec.hardGates.contractVersion,
      results: reviewGateResults,
    }
    await validateUiReviewManifest(outputRoot, manifest, spec)
    spec.hardGates.validate(hardGates, manifest)
    await mkdir(outputRoot, { recursive: true })
    await Promise.all([
      writeJson("manifest.json", manifest),
      writeJson("hard-gates.json", hardGates),
      copyFile(criticSchemaSource, resolve(outputRoot, "UiCriticReportV1.schema.json")),
    ])
    assertHardGatesPermitLiveCritic(hardGates, manifest, spec)
    const critic = await resolveCritic(manifest)
    const reportInput = {
      manifest,
      hardGates,
      critic,
      selection: baselineRoot ? null : exploration,
      ownerSpotChecks: spec.ownerSpotChecks,
    }
    const reportHtml = renderUiReviewHtml(reportInput)
    const reportMarkdown = renderUiReviewMarkdown(reportInput)
    await Promise.all([
      writeJson("critic.json", critic),
      writeFile(resolve(outputRoot, "report.html"), reportHtml, "utf8"),
      writeFile(resolve(outputRoot, "report.md"), reportMarkdown, "utf8"),
    ])
    const calibration = await createCalibrationRecord({
      root: outputRoot,
      manifest,
      critic,
      prompt: spec.criticPrompt,
      rubricPath: resolve(REPO_ROOT, spec.criticContextPaths[0]!),
      spec,
    })
    await writeJson("calibration.json", calibration)
    if (process.env.UI_REVIEW_MODE === "improve") {
      await writeJson("execution-packet.json", await createExecutionPacket({
        root: outputRoot,
        manifest,
        hardGates,
        critic,
        calibration,
        reportHtml,
        spec,
      }))
    }

    await assertBoundedStagingDirectory(outputRoot, createUiReviewStagingPolicy(spec))
    const failures = hardGates.results.filter((result) => !result.passed)
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])
    await testInfo.attach("ui-review-report.html", { body: Buffer.from(reportHtml), contentType: "text/html" })
    await testInfo.attach("ui-review-manifest.json", {
      body: Buffer.from(JSON.stringify(manifest, null, 2)),
      contentType: "application/json",
    })
  })
})

async function compareVisualBaseline(page: Page, checkpoint: UiReviewCheckpoint): Promise<UiReviewVisualBaselineResult | undefined> {
  const baseline = checkpoint.visualBaseline
  if (!baseline) return undefined
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
  })
  try {
    await expect(page.locator(baseline.locator)).toHaveScreenshot(
      [spec.id, "baselines", baseline.fileName],
      { animations: "disabled", caret: "hide", maxDiffPixels: baseline.maxDiffPixels },
    )
    return {
      passed: true,
      evidence: `matched ${baseline.fileName};maxDiffPixels=${baseline.maxDiffPixels};rationale=${baseline.rationale}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { passed: false, evidence: message.slice(0, 4_096) || `mismatch:${baseline.fileName}` }
  }
}

async function capture(
  page: Page,
  viewport: UiReviewViewport,
  checkpoint: string,
  errors: UiReviewBrowserErrors,
  states: UiReviewState[],
  results: UiHardGateReport["results"],
  visualBaseline?: UiReviewVisualBaselineResult,
): Promise<void> {
  const screenshotPath = `selected/${viewport.name}/${String(states.length + 1).padStart(3, "0")}-${checkpoint}.png`
  const absolutePath = resolve(outputRoot, screenshotPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  const screenshot = await page.screenshot({ animations: "disabled" })
  await writeFile(absolutePath, screenshot)
  const screenshotDigest = createHash("sha256").update(screenshot).digest("hex")
  const stateId = createUiReviewStateId({ runId, scenarioId: spec.id, role: "candidate", viewport, checkpoint, screenshotDigest })
  states.push({
    id: stateId,
    scenarioId: spec.id,
    role: "candidate",
    checkpoint,
    viewport,
    screenshotPath,
    screenshotDigest,
    screenshotBytes: screenshot.byteLength,
    source: "known",
  })
  const snapshot = await spec.hardGates.collect(page, stateId, checkpoint, viewport, copyErrors(errors), visualBaseline)
  results.push(...spec.hardGates.evaluate(snapshot).results)
}

function explorationGateResults(selection: UiReviewSelection | null): UiHardGateReport["results"] {
  if (!selection) return []
  return selection.viewports.flatMap((entry) => entry.selected.map((state) => ({
    id: "bombadil-properties",
    stateId: state.id,
    passed: entry.rawViolations.length === 0,
    evidence: entry.rawViolations.length === 0
      ? `All ${entry.rawStates} raw Bombadil states passed exported properties.`
      : JSON.stringify(entry.rawViolations).slice(0, 1_000),
  })))
}

function monitorErrors(page: Page): UiReviewBrowserErrors {
  const errors: UiReviewBrowserErrors = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] }
  page.on("console", (message) => { if (message.type() === "error") errors.consoleErrors.push(message.text()) })
  page.on("pageerror", (error) => errors.pageErrors.push(error.message))
  page.on("requestfailed", (request) => errors.requestFailures.push({
    url: request.url(),
    errorText: request.failure()?.errorText ?? "unknown request failure",
  }))
  page.on("response", (response) => {
    if (response.status() >= 400) errors.httpErrors.push({ url: response.url(), status: response.status() })
  })
  return errors
}

function copyErrors(errors: UiReviewBrowserErrors): UiReviewBrowserErrors {
  return {
    consoleErrors: [...errors.consoleErrors],
    pageErrors: [...errors.pageErrors],
    requestFailures: [...errors.requestFailures],
    httpErrors: [...errors.httpErrors],
  }
}

async function resolveCritic(manifest: UiReviewManifest) {
  if ((process.env.UI_REVIEW_CRITIC ?? "fixture") !== "pi") {
    return validateUiCriticReport(createFixtureCriticReport(manifest), manifest)
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("UI_REVIEW_CRITIC_CREDENTIAL_MISSING")
  const tempHome = await mkdtemp(resolve(tmpdir(), "ui-review-home."))
  const tempConfig = await mkdtemp(resolve(tmpdir(), "ui-review-config."))
  const criticPromptPath = resolve(outputRoot, "critic-prompt.md")
  await writeFile(criticPromptPath, spec.criticPrompt, "utf8")
  const invocation = buildPiCriticInvocation({
    model: process.env.BORING_UI_REVIEW_MODEL,
    apiKey,
    tempHome,
    tempConfig,
    systemPrompt: "You are a read-only visual critic. Return only valid JSON and never infer unsupplied repository context.",
    criticPromptPath,
    manifestPath: resolve(outputRoot, "manifest.json"),
    schemaPath: resolve(outputRoot, "UiCriticReportV1.schema.json"),
    hardGatesPath: resolve(outputRoot, "hard-gates.json"),
    contextPaths: spec.criticContextPaths.map((path) => resolve(REPO_ROOT, path)),
    screenshotPaths: manifest.states.map((state) => resolve(outputRoot, state.screenshotPath)),
  })
  return await runPiCritic(invocation, manifest)
}

async function readExplorationSelection(): Promise<UiReviewSelection | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(outputRoot, "selection.json"), "utf8"))
    const port = process.env.UI_REVIEW_VITE_PORT?.trim() || String(spec.target.defaultPort)
    return validateUiReviewSelection(raw, { runId, origin: `http://127.0.0.1:${port}`, spec })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(resolve(outputRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`UI_REVIEW_REQUIRED_ENV_MISSING:${name}`)
  return value
}
