import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import {
  DEFAULT_UI_REVIEW_MODEL,
  assertHardGatesPermitLiveCritic,
  buildPiCriticInvocation,
  createFixtureCriticReport,
  runPiCritic,
} from "../src/ui-review/critic"
import {
  UI_REVIEW_RUBRIC_VERSION,
  UI_REVIEW_SCHEMA_VERSION,
  createUiReviewStateId,
  validateUiCriticReport,
  validateUiReviewManifest,
  type UiHardGateReport,
  type UiReviewManifest,
  type UiReviewState,
  type UiReviewViewport,
} from "../src/ui-review/contracts"
import {
  COMMAND_PALETTE_HARD_GATE_CONTRACT,
  evaluateCommandPaletteHardGates,
  type UiHardGateSnapshot,
} from "../src/ui-review/hardGates"
import { renderUiReviewHtml, renderUiReviewMarkdown } from "../src/ui-review/report"
import {
  assertBoundedStagingDirectory,
  validateUiReviewSelection,
  type UiReviewSelection,
} from "../src/ui-review/exploration"

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CRITIC_SCHEMA_SOURCE = resolve(APP_ROOT, "src/ui-review/UiCriticReportV1.schema.json")
const AXE_SCRIPT_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js")
const runId = process.env.UI_REVIEW_RUN_ID?.trim() || `command-palette-${Date.now()}`
const outputRoot = resolve(APP_ROOT, process.env.UI_REVIEW_OUTPUT_DIR?.trim() || `e2e/fixtures/workspace/.pi/ui-review/runs/${runId}`)
const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]

test.describe("UI review fixture", () => {
  test("captures and reviews command-palette desktop/mobile states", async ({ browser }, testInfo) => {
    const exploration = await readExplorationSelection()
    const states: UiReviewState[] = exploration?.viewports.flatMap((entry) => entry.selected) ?? []
    const gateResults: UiHardGateReport["results"] = states.map((state) => {
      const viewportExploration = exploration!.viewports.find((entry) => entry.viewport.name === state.viewport.name)!
      const rawViolations = viewportExploration.rawViolations
      return {
        id: "bombadil-properties",
        stateId: state.id,
        passed: rawViolations.length === 0,
        evidence: rawViolations.length === 0
          ? `All ${viewportExploration.rawStates} raw Bombadil states passed exported properties.`
          : JSON.stringify(rawViolations).slice(0, 1_000),
      }
    })

    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        colorScheme: "dark",
      })
      const page = await context.newPage()
      const errors = monitorErrors(page)
      await page.goto("/?fresh=1")
      await expect(page.getByRole("main", { name: "Chat" })).toBeVisible({ timeout: 10_000 })

      await capture("closed", page, viewport, errors, states, gateResults)
      await page.keyboard.press("ControlOrMeta+KeyK")
      await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({ timeout: 5_000 })
      await capture("open", page, viewport, errors, states, gateResults)
      await page.keyboard.type(">")
      await expect(page.getByRole("button", { name: "Commands" })).toHaveAttribute("aria-pressed", "true")
      await capture("commands", page, viewport, errors, states, gateResults)
      await context.close()
    }

    const manifest: UiReviewManifest = {
      schemaVersion: UI_REVIEW_SCHEMA_VERSION,
      runId,
      scenarioId: "command-palette",
      rubricVersion: UI_REVIEW_RUBRIC_VERSION,
      resolvedModel: (process.env.UI_REVIEW_CRITIC ?? "fixture") === "pi"
        ? process.env.BORING_UI_REVIEW_MODEL ?? DEFAULT_UI_REVIEW_MODEL
        : "fixture",
      states,
      statePairs: [],
    }
    const hardGates: UiHardGateReport = {
      schemaVersion: UI_REVIEW_SCHEMA_VERSION,
      contractVersion: COMMAND_PALETTE_HARD_GATE_CONTRACT.contractVersion,
      results: gateResults,
    }
    await validateUiReviewManifest(outputRoot, manifest)
    await mkdir(outputRoot, { recursive: true })
    await Promise.all([
      writeJson("manifest.json", manifest),
      writeJson("hard-gates.json", hardGates),
      copyFile(CRITIC_SCHEMA_SOURCE, resolve(outputRoot, "UiCriticReportV1.schema.json")),
    ])
    assertHardGatesPermitLiveCritic(hardGates, manifest)
    const critic = await resolveCritic(manifest)
    await Promise.all([
      writeJson("critic.json", critic),
      writeFile(resolve(outputRoot, "report.html"), renderUiReviewHtml({ manifest, hardGates, critic, selection: exploration }), "utf8"),
      writeFile(resolve(outputRoot, "report.md"), renderUiReviewMarkdown({ manifest, hardGates, critic, selection: exploration }), "utf8"),
    ])

    await assertBoundedStagingDirectory(outputRoot)
    const failures = hardGates.results.filter((result) => !result.passed)
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])
    await testInfo.attach("ui-review-report.html", {
      body: Buffer.from(renderUiReviewHtml({ manifest, hardGates, critic, selection: exploration })),
      contentType: "text/html",
    })
    await testInfo.attach("ui-review-manifest.json", {
      body: Buffer.from(JSON.stringify(manifest, null, 2)),
      contentType: "application/json",
    })
  })
})

async function capture(
  checkpoint: string,
  page: Page,
  viewport: UiReviewViewport,
  errors: ReturnType<typeof monitorErrors>,
  states: UiReviewState[],
  results: UiHardGateReport["results"],
): Promise<void> {
  const screenshotPath = `selected/${viewport.name}/${String(states.length + 1).padStart(3, "0")}-${checkpoint}.png`
  const absolutePath = resolve(outputRoot, screenshotPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  const screenshot = await page.screenshot({ animations: "disabled" })
  await writeFile(absolutePath, screenshot)
  const screenshotDigest = createHash("sha256").update(screenshot).digest("hex")
  const stateId = createUiReviewStateId({
    runId,
    scenarioId: "command-palette",
    role: "candidate",
    viewport,
    checkpoint,
    screenshotDigest,
  })
  states.push({
    id: stateId,
    scenarioId: "command-palette",
    role: "candidate",
    checkpoint,
    viewport,
    screenshotPath,
    screenshotDigest,
    screenshotBytes: screenshot.byteLength,
  })
  const snapshot = await collectHardGateSnapshot(page, stateId, checkpoint, viewport, errors)
  results.push(...evaluateCommandPaletteHardGates(snapshot).results)
}

function monitorErrors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const requestFailures: Array<{ url: string; errorText: string }> = []
  const httpErrors: Array<{ url: string; status: number }> = []
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => requestFailures.push({
    url: request.url(),
    errorText: request.failure()?.errorText ?? "unknown request failure",
  }))
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() })
  })
  return { consoleErrors, pageErrors, requestFailures, httpErrors }
}

async function collectHardGateSnapshot(
  page: Page,
  stateId: string,
  checkpoint: string,
  viewport: UiReviewViewport,
  errors: ReturnType<typeof monitorErrors>,
): Promise<UiHardGateSnapshot> {
  if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ path: AXE_SCRIPT_PATH })
  const axeViolations = await page.evaluate(async () => {
    const result = await (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe.run(document, {
      resultTypes: ["violations"],
    })
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({ id: violation.id, impact: violation.impact!, nodes: violation.nodes.length }))
  })
  const observed = await page.evaluate(({ minimumWidth, minimumHeight, exemptions, checkpoint }) => {
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const label = (element: Element) => element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.tagName.toLowerCase()
    const modalElements = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })
    const active = document.activeElement instanceof Element ? document.activeElement : null
    let focusedControl = null
    if (active && active !== document.body) {
      const rect = active.getBoundingClientRect()
      const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2))
      const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2))
      const top = document.elementFromPoint(centerX, centerY)
      focusedControl = {
        label: label(active),
        bounds: bounds(active),
        occluded: Boolean(top && top !== active && !active.contains(top) && !top.contains(active)),
      }
    }
    const dialog = modalElements[0]
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }
    const targets = Array.from(document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])'))
      .filter(isVisible)
    const undersizedTouchTargets = targets.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width >= minimumWidth && rect.height >= minimumHeight) return []
      const exemption = exemptions.find((entry) => element.matches(entry.selector) && (!("name" in entry) || entry.name === label(element)))
      return [{
        label: label(element),
        selector: exemption?.selector ?? element.tagName.toLowerCase(),
        bounds: bounds(element),
        exempt: Boolean(exemption),
        rationale: exemption?.rationale,
      }]
    })
    const dividerCount = Array.from(document.querySelectorAll('[data-slot="command-input-wrapper"]')).filter((element) => {
      const style = getComputedStyle(element)
      return parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none" && isVisible(element)
    }).length
    const dialogContent = document.querySelector('[data-slot="dialog-content"]')
    const bodyText = document.body.innerText
    const commandMode = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) => label(element) === "Commands") ?? null
    return {
      origin: location.origin,
      documentWidth: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      visibleModals: modalElements.map((element) => ({ label: label(element), bounds: bounds(element) })),
      focusedControl,
      undersizedTouchTargets,
      commandPalette: {
        checkpoint,
        visible: Boolean(dialog && isVisible(dialog)),
        inputDividerCount: dividerCount,
        dialogWidth: dialogContent && isVisible(dialogContent) ? dialogContent.getBoundingClientRect().width : null,
        keyboardHintsPresent: /navigate/i.test(bodyText) && /open/i.test(bodyText) && /close/i.test(bodyText),
        commandModePressed: commandMode ? commandMode.getAttribute("aria-pressed") === "true" : null,
      },
    }
  }, {
    minimumWidth: COMMAND_PALETTE_HARD_GATE_CONTRACT.minimumTouchWidth,
    minimumHeight: COMMAND_PALETTE_HARD_GATE_CONTRACT.minimumTouchHeight,
    exemptions: COMMAND_PALETTE_HARD_GATE_CONTRACT.touchExemptions,
    checkpoint,
  })

  return {
    stateId,
    viewport: { width: viewport.width, height: viewport.height, mobile: viewport.name === "mobile" },
    consoleErrors: [...errors.consoleErrors],
    pageErrors: [...errors.pageErrors],
    requestFailures: [...errors.requestFailures],
    httpErrors: [...errors.httpErrors],
    axeViolations,
    ...observed,
  }
}

async function resolveCritic(manifest: UiReviewManifest) {
  if ((process.env.UI_REVIEW_CRITIC ?? "fixture") !== "pi") {
    return validateUiCriticReport(createFixtureCriticReport(manifest), manifest)
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("UI_REVIEW_CRITIC_CREDENTIAL_MISSING")
  const tempHome = await mkdtemp(joinTemp("ui-review-home."))
  const tempConfig = await mkdtemp(joinTemp("ui-review-config."))
  const criticPromptPath = resolve(outputRoot, "critic-prompt.md")
  await writeFile(criticPromptPath, [
    "Review the supplied command-palette screenshots against the design context.",
    "Return only UiCriticReportV1 JSON. Scores are advisory; every finding must cite supplied state ids.",
  ].join("\n"), "utf8")
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
    contextPaths: [resolve(APP_ROOT, "../..", ".impeccable.md")],
    screenshotPaths: manifest.states.map((state) => resolve(outputRoot, state.screenshotPath)),
  })
  return await runPiCritic(invocation, manifest)
}

function joinTemp(prefix: string): string {
  return resolve(tmpdir(), prefix)
}

async function readExplorationSelection(): Promise<UiReviewSelection | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(outputRoot, "selection.json"), "utf8"))
    const port = process.env.UI_REVIEW_VITE_PORT?.trim() || "5380"
    return validateUiReviewSelection(raw, { runId, origin: `http://127.0.0.1:${port}` })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(resolve(outputRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}
