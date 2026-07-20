import { resolve } from "node:path"
import { expect } from "@playwright/test"
import type { UiReviewSpec } from "../../core/reviewSpec"
import {
  AUTOMATION_UI_HARD_GATE_CONTRACT,
  evaluateAutomationUiHardGates,
  validateAutomationUiHardGateReport,
  type AutomationUiHardGateSnapshot,
} from "./hardGates"

const AXE_SCRIPT_PATH = resolve(import.meta.dirname, "../../../node_modules/axe-core/axe.min.js")
const baseline = (fileName: string) => ({
  fileName,
  locator: "body",
  maxDiffPixels: 20,
  rationale: "Bounded Chromium/Linux font rasterization drift; structural pane or popover changes exceed this budget.",
})

export const automationPanePopoverSpec: UiReviewSpec = {
  id: "automation-pane-popover",
  specRevision: "automation-pane-popover-v1",
  fixtureResetId: "automation-pane-popover-fixture-v1",
  rubricVersion: "impeccable-v1",
  target: {
    root: "tools/ui-review/fixtures/workspace-components",
    buildCommand: ["pnpm", "run", "build:deps"],
    serverCommand: ["pnpm", "exec", "vite", "--host", "127.0.0.1", "--strictPort"],
    route: "/?ui-review-fixture=automation-pane",
    defaultPort: 5680,
    serverEnvironmentKeys: ["PORT"],
    environment: ({ port }) => ({ PORT: String(port) }),
    ready: async (page, timeoutMs) => {
      await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible({ timeout: timeoutMs })
      await expect(page.getByText("Daily workspace digest", { exact: true })).toBeVisible({ timeout: timeoutMs })
    },
  },
  viewports: [
    { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
    { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
  ],
  checkpoints: [
    {
      id: "automation-pane-desktop",
      viewportNames: ["desktop"],
      colorScheme: "light",
      visualBaseline: baseline("automation-pane-desktop.png"),
      reach: openPane,
    },
    {
      id: "automation-popover-desktop",
      viewportNames: ["desktop"],
      colorScheme: "light",
      visualBaseline: baseline("automation-popover-desktop.png"),
      reach: openPopover,
    },
    {
      id: "automation-pane-mobile",
      viewportNames: ["mobile"],
      colorScheme: "light",
      visualBaseline: baseline("automation-pane-mobile.png"),
      reach: openPane,
    },
    {
      id: "automation-popover-mobile",
      viewportNames: ["mobile"],
      colorScheme: "light",
      visualBaseline: baseline("automation-popover-mobile.png"),
      reach: openPopover,
    },
  ],
  criticPrompt: "Review the supplied Automations pane and New automation popover screenshots at desktop and mobile. Prioritize hierarchy, density, responsive layout, legibility, affordances, focus, and touch usability. Return only UiCriticReportV1 JSON. Scores are advisory and every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md", "plugins/boring-automation/README.md"],
  ownerSpotChecks: [
    "Inspect the Automations app-left pane at desktop and mobile widths.",
    "Inspect the New automation editor popover at desktop and mobile widths.",
    "Confirm list actions, form controls, focus, overflow, and touch targets remain usable.",
    "Confirm every authoritative hard gate before considering advisory visual findings.",
  ],
  hardGates: {
    contractVersion: AUTOMATION_UI_HARD_GATE_CONTRACT.contractVersion,
    collect: async (page, stateId, checkpoint, viewport, errors, visualBaseline): Promise<AutomationUiHardGateSnapshot> => {
      if (!visualBaseline) throw new Error(`UI_REVIEW_VISUAL_BASELINE_RESULT_MISSING:${checkpoint}`)
      if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ path: AXE_SCRIPT_PATH })
      const observed = await page.evaluate(async ({ checkpoint, minimumTouchWidth, minimumTouchHeight, viewportName }) => {
        const visible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false
          const bounds = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        }
        const bounds = (element: Element | null) => {
          if (!element || !visible(element)) return null
          const rect = element.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }
        const label = (element: HTMLElement) => element.getAttribute("aria-label")
          ?? element.getAttribute("title")
          ?? element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
          ?? element.tagName.toLowerCase()
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible) ?? null
        const active = document.activeElement instanceof HTMLElement && visible(document.activeElement) ? document.activeElement : null
        const touchTargets = [...document.querySelectorAll("button,input,textarea,[role=combobox],[role=checkbox]")]
          .filter(visible)
          .map((element) => {
            const own = element.getBoundingClientRect()
            const wrappingLabel = element.closest("label")
            const labelRect = wrappingLabel && visible(wrappingLabel) ? wrappingLabel.getBoundingClientRect() : null
            const target = labelRect && labelRect.width * labelRect.height > own.width * own.height ? labelRect : own
            return { element, bounds: { x: target.x, y: target.y, width: target.width, height: target.height } }
          })
          .filter(({ bounds: target }) => viewportName === "mobile" && (target.width < minimumTouchWidth || target.height < minimumTouchHeight))
          .map(({ element, bounds: target }) => ({ label: label(element as HTMLElement), bounds: target }))
        const axeResult = await (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe.run(document, { resultTypes: ["violations"] })
        return {
          origin: window.location.origin,
          fixtureName: document.querySelector("[data-ui-review-fixture]")?.getAttribute("data-ui-review-fixture") ?? null,
          viewport: { width: innerWidth, height: innerHeight, mobile: viewportName === "mobile" },
          documentWidth: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
          axeViolations: axeResult.violations.filter((violation) => violation.impact).map((violation) => ({ id: violation.id, impact: violation.impact!, nodes: violation.nodes.length })),
          pane: {
            bounds: bounds(document.querySelector("[data-ui-review-automation-frame]")),
            headingVisible: [...document.querySelectorAll("h2")].some((heading) => visible(heading) && heading.textContent?.trim() === "Automations"),
            automationRows: document.querySelectorAll("[data-ui-review-automation-frame] article").length,
          },
          editor: {
            visible: dialog !== null,
            bounds: bounds(dialog),
            title: dialog?.querySelector("h2")?.textContent?.trim() ?? null,
            formVisible: Boolean(dialog?.querySelector('form[aria-label="Create automation form"]')),
          },
          focusedControl: active ? {
            label: label(active),
            bounds: bounds(active)!,
            insideEditor: Boolean(dialog?.contains(active)),
          } : null,
          undersizedTouchTargets: touchTargets,
          checkpoint,
        }
      }, {
        checkpoint,
        minimumTouchWidth: AUTOMATION_UI_HARD_GATE_CONTRACT.minimumTouchWidth,
        minimumTouchHeight: AUTOMATION_UI_HARD_GATE_CONTRACT.minimumTouchHeight,
        viewportName: viewport.name,
      })
      return { stateId, visualBaseline, ...errors, ...observed }
    },
    evaluate: (snapshot) => evaluateAutomationUiHardGates(snapshot as AutomationUiHardGateSnapshot),
    validate: validateAutomationUiHardGateReport,
  },
}

async function openPane(page: Parameters<UiReviewSpec["checkpoints"][number]["reach"]>[0]) {
  await page.goto("/?ui-review-fixture=automation-pane")
  await expect(page.getByText("Daily workspace digest", { exact: true })).toBeVisible()
  await expect(page.getByText("Release readiness check", { exact: true })).toBeVisible()
}

async function openPopover(page: Parameters<UiReviewSpec["checkpoints"][number]["reach"]>[0]) {
  await openPane(page)
  await page.getByRole("button", { name: "New", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("heading", { name: "New automation" })).toBeVisible()
}
