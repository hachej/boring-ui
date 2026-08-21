import { createRequire } from "node:module"
import { expect } from "@playwright/test"
import type { UiReviewSpec } from "../../core/reviewSpec"
import { observeBrowserDocument } from "../../core/browserObservation"
import {
  ASK_USER_INLINE_HARD_GATE_CONTRACT,
  evaluateAskUserInlineHardGates,
  validateAskUserInlineHardGateReport,
  type AskUserInlineHardGateSnapshot,
} from "./hardGates"

const AXE_SCRIPT_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js")

export const askUserInlineSpec: UiReviewSpec = {
  id: "ask-user-inline",
  specRevision: "ask-user-inline-v2",
  fixtureResetId: "ask-user-inline-fixture-v2",
  rubricVersion: "impeccable-v1",
  target: {
    root: "tools/ui-review/fixtures/workspace-components",
    buildCommand: ["pnpm", "run", "build:deps"],
    serverCommand: ["pnpm", "exec", "vite", "--host", "127.0.0.1", "--strictPort"],
    route: "/?ui-review-fixture=ask-user-inline&state=pending",
    defaultPort: 5682,
    serverEnvironmentKeys: ["PORT"],
    environment: ({ port }) => ({ PORT: String(port) }),
    ready: async (page, timeoutMs) => {
      await expect(page.getByTestId("ask-user-inline-question")).toBeVisible({ timeout: timeoutMs })
    },
  },
  viewports: [
    { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
    { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
  ],
  checkpoints: [
    { id: "pending-light", viewportNames: ["desktop"], colorScheme: "light", reach: async (page) => {
      await openFixture(page, "pending")
      await expect(page.getByTestId("ask-user-inline-question")).toBeVisible()
    } },
    { id: "pending", colorScheme: "dark", reach: async (page) => {
      await openFixture(page, "pending")
      await expect(page.getByTestId("ask-user-inline-question")).toBeVisible()
    } },
    { id: "selected", colorScheme: "dark", reach: async (page) => {
      await openFixture(page, "pending")
      await page.getByRole("radio", { name: "Request changes" }).click()
      await expect(page.getByRole("radio", { name: "Request changes" })).toBeChecked()
    } },
    { id: "resolved", colorScheme: "dark", reach: async (page) => {
      await openFixture(page, "resolved")
      await expect(page.locator('[data-boring-ask-user-resolved-question="true"]')).toBeVisible()
    } },
    { id: "inbox-list", colorScheme: "dark", reach: async (page) => {
      await openFixture(page, "inbox-list")
      await expect(page.locator('[data-boring-workspace-part="inbox-overlay"]')).toBeVisible()
      await expect(page.getByText("Merge: inline artifacts in chat")).toBeVisible()
    } },
    { id: "inbox-expanded", colorScheme: "dark", reach: async (page) => {
      await openFixture(page, "inbox-expanded")
      await page.getByText("Merge: inline artifacts in chat").click()
      await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible()
    } },
  ],
  criticPrompt: "Review the supplied inline ask_user pending, selected, resolved, Inbox list, and expanded-card screenshots against the design context. Prioritize three-second scanability, human-first subject hierarchy, metadata restraint, Markdown legibility, artifact prominence, action contrast, density, responsive behavior, and state continuity. Return only UiCriticReportV1 JSON. Scores are advisory and every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md", "plugins/ask-user/README.md"],
  ownerSpotChecks: [
    "Compare light and dark pending states plus selected and resolved states at desktop and mobile widths.",
    "Confirm the primary action label is readable in dark mode and choices have clear selected state.",
    "Confirm no duplicate Questions pane or raw ask_user JSON appears in any checkpoint.",
    "Confirm progress from pending to resolved preserves the conversation-first hierarchy.",
    "Confirm Inbox rows lead with a plain-language subject and keep correlation in a compact chip.",
    "Confirm the expanded Inbox card exposes Markdown hierarchy and review material without a dense text blob.",
  ],
  hardGates: {
    contractVersion: ASK_USER_INLINE_HARD_GATE_CONTRACT.contractVersion,
    collect: async (page, stateId, checkpoint, viewport, errors): Promise<AskUserInlineHardGateSnapshot> => {
      if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ path: AXE_SCRIPT_PATH })
      const [common, question, axeViolations] = await Promise.all([
        page.evaluate(observeBrowserDocument, {
          minimumTouchWidth: ASK_USER_INLINE_HARD_GATE_CONTRACT.minimumTouchWidth,
          minimumTouchHeight: ASK_USER_INLINE_HARD_GATE_CONTRACT.minimumTouchHeight,
          touchExemptions: [{ selector: 'input[type="radio"]', rationale: "The native radio is contained by a full-width ChoiceItem label that owns the touch target." }],
        }),
        page.evaluate(() => {
          const visible = (element: Element): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
          }
          const target = document.querySelector('[data-boring-ask-user-inline-question="true"], [data-boring-ask-user-resolved-question="true"], [data-boring-workspace-part="inbox-overlay"]')
          const rect = target?.getBoundingClientRect()
          const selected = document.querySelector<HTMLInputElement>('input[name="direction"]:checked')
          const submit = [...document.querySelectorAll("button")].find((button) => visible(button) && button.textContent?.trim() === "Continue")
          let submitColors: { color: string; background: string; expectedColor: string; expectedBackground: string } | null = null
          if (submit) {
            const probe = document.createElement("span")
            probe.style.color = "var(--boring-primary-foreground)"
            probe.style.backgroundColor = "var(--boring-primary)"
            document.body.append(probe)
            const actual = getComputedStyle(submit)
            const expected = getComputedStyle(probe)
            submitColors = {
              color: actual.color,
              background: actual.backgroundColor,
              expectedColor: expected.color,
              expectedBackground: expected.backgroundColor,
            }
            probe.remove()
          }
          return {
            bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            inlineCount: document.querySelectorAll('[data-boring-ask-user-inline-question="true"]').length,
            resolvedCount: document.querySelectorAll('[data-boring-ask-user-resolved-question="true"]').length,
            paneCount: [...document.querySelectorAll("*")].filter((element) => visible(element) && element.textContent?.trim() === "Agent needs input").length,
            openIconCount: [...document.querySelectorAll('button[aria-label="Open Questions"]')].filter(visible).length,
            selectedValue: selected?.closest("label")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            submitLabel: submit?.textContent?.trim() ?? null,
            submitColors,
            rawSchemaVisible: document.body.innerText.includes('"wireVersion"'),
            metadataText: target?.querySelector('[aria-label="Question metadata"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            contextHeadings: [...(target?.querySelectorAll('[data-testid="ask-user-markdown"] h1, [data-testid="ask-user-markdown"] h2, [data-testid="ask-user-markdown"] h3, [data-testid="ask-user-markdown"] h4') ?? [])].map((heading) => heading.textContent?.trim() ?? ""),
            artifactCount: Number(target?.querySelector('[data-ask-user-artifact-count]')?.getAttribute('data-ask-user-artifact-count') ?? 0),
            inboxCount: document.querySelectorAll('[data-boring-workspace-part="inbox-overlay"]').length,
            inboxExpanded: document.querySelector('[data-boring-workspace-part="inbox-overlay"] [aria-expanded="true"]') !== null,
            inboxTitleVisible: document.body.innerText.includes("Merge: inline artifacts in chat"),
            inboxCorrelationVisible: document.body.innerText.includes("br-123 · PR #456"),
          }
        }),
        page.evaluate(async () => {
          const result = await (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe.run(document, { resultTypes: ["violations"] })
          return result.violations.filter((violation) => violation.impact).map((violation) => ({ id: violation.id, impact: violation.impact!, nodes: violation.nodes.length }))
        }),
      ])
      return {
        stateId,
        checkpoint,
        origin: common.origin,
        fixtureName: await page.locator("[data-ui-review-fixture]").getAttribute("data-ui-review-fixture"),
        viewport: { width: viewport.width, height: viewport.height, mobile: viewport.name === "mobile" },
        documentWidth: common.documentWidth,
        axeViolations,
        question,
        focusedControl: common.focusedControl,
        undersizedTouchTargets: common.undersizedTouchTargets.filter((target) => !target.exempt).map(({ label, bounds }) => ({ label, bounds })),
        ...errors,
      }
    },
    evaluate: (snapshot) => evaluateAskUserInlineHardGates(snapshot as AskUserInlineHardGateSnapshot),
    validate: validateAskUserInlineHardGateReport,
  },
}

async function openFixture(page: Parameters<UiReviewSpec["checkpoints"][number]["reach"]>[0], state: "pending" | "resolved" | "inbox-list" | "inbox-expanded") {
  await page.goto(`/?ui-review-fixture=ask-user-inline&state=${state}`)
  await expect(page.locator('[data-ui-review-fixture="ask-user-inline"]')).toBeVisible()
}
