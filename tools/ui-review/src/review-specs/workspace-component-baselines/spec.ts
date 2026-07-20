import { expect } from "@playwright/test"
import type { UiReviewSpec } from "../../core/reviewSpec"
import {
  WORKSPACE_COMPONENT_HARD_GATE_CONTRACT,
  evaluateWorkspaceComponentHardGates,
  validateWorkspaceComponentHardGateReport,
  type WorkspaceComponentHardGateSnapshot,
} from "./hardGates"

const baseline = (
  fileName: string,
  maxDiffPixels = 20,
  rationale = "Bounded Linux font rasterization drift; structural UI changes exceed this budget.",
) => ({ fileName, locator: "[data-ui-review-fixture]", maxDiffPixels, rationale })

export const workspaceComponentBaselinesSpec: UiReviewSpec = {
  id: "workspace-component-baselines",
  specRevision: "workspace-component-baselines-v1",
  fixtureResetId: "workspace-component-fixtures-v1",
  rubricVersion: "impeccable-v1",
  target: {
    root: "tools/ui-review/fixtures/workspace-components",
    buildCommand: ["pnpm", "run", "build:deps"],
    serverCommand: ["pnpm", "exec", "vite", "--host", "127.0.0.1"],
    route: "/?ui-review-fixture=file-tree",
    defaultPort: 5480,
    serverEnvironmentKeys: ["PORT"],
    environment: ({ port }) => ({ PORT: String(port) }),
    ready: async (page, timeoutMs) => {
      await expect(page.locator('[data-ui-review-fixture="file-tree"]')).toBeVisible({ timeout: timeoutMs })
    },
  },
  viewports: [
    { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
    { name: "mobile", width: 375, height: 667, deviceScaleFactor: 1 },
    { name: "catalog", width: 404, height: 932, deviceScaleFactor: 1 },
  ],
  checkpoints: [
    {
      id: "file-tree",
      viewportNames: ["desktop"],
      colorScheme: "light",
      visualBaseline: baseline("workspace-filetree-desktop.png"),
      reach: async (page) => {
        await openFixture(page, "file-tree")
        await expect(page.getByText("src", { exact: true })).toBeVisible()
      },
    },
    {
      id: "code-editor",
      viewportNames: ["desktop"],
      colorScheme: "light",
      visualBaseline: baseline("workspace-codeeditor-desktop.png"),
      reach: async (page) => {
        await openFixture(page, "code-editor")
        await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 15_000 })
      },
    },
    {
      id: "markdown-editor",
      viewportNames: ["desktop"],
      colorScheme: "light",
      visualBaseline: baseline(
        "workspace-markdown-desktop.png",
        300,
        "The rich-text word-count footer has bounded Linux font rasterization drift; layout changes exceed this budget.",
      ),
      reach: async (page) => {
        await openFixture(page, "markdown-editor")
        await expect(page.getByRole("heading", { name: "Workspace Notes" })).toBeVisible()
      },
    },
    {
      id: "dock-group",
      viewportNames: ["desktop"],
      colorScheme: "dark",
      visualBaseline: baseline("workspace-dock-group-dark.png"),
      reach: async (page) => {
        await openFixture(page, "dock-group")
        await expect(page.locator(".dv-shell:visible")).toHaveCount(1)
      },
    },
    {
      id: "file-tree-pane",
      viewportNames: ["mobile"],
      colorScheme: "light",
      visualBaseline: baseline("workspace-file-tree-mobile.png"),
      reach: async (page) => {
        await openFixture(page, "file-tree-pane")
        await expect(page.getByPlaceholder("Search files...")).toBeVisible()
        await expect(page.getByText("docs", { exact: true })).toBeVisible()
      },
    },
    {
      id: "data-catalog",
      viewportNames: ["catalog"],
      colorScheme: "dark",
      visualBaseline: baseline("workspace-datacatalog-dark.png"),
      reach: async (page) => {
        await openFixture(page, "data-catalog")
        await expect(page.getByText("Annual", { exact: true })).toBeVisible({ timeout: 10_000 })
      },
    },
  ],
  criticPrompt: "Review the supplied deterministic workspace component screenshots against the design context. Return only UiCriticReportV1 JSON. Scores are advisory; every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md"],
  ownerSpotChecks: [
    "Open report.html through workspace.open.path from the existing Inbox/ask_user handoff.",
    "Inspect FileTree, CodeEditor, MarkdownEditor, and dock-group desktop checkpoints.",
    "Inspect the mobile FileTree pane and narrow dark data-catalog checkpoints.",
    "Confirm every deterministic pixel baseline and hard gate is green.",
  ],
  hardGates: {
    contractVersion: WORKSPACE_COMPONENT_HARD_GATE_CONTRACT,
    collect: async (page, stateId, checkpoint, _viewport, errors, visualBaseline): Promise<WorkspaceComponentHardGateSnapshot> => {
      if (!visualBaseline) throw new Error(`UI_REVIEW_VISUAL_BASELINE_RESULT_MISSING:${checkpoint}`)
      const observed = await page.evaluate(() => ({
        origin: window.location.origin,
        fixtureName: document.querySelector("[data-ui-review-fixture]")?.getAttribute("data-ui-review-fixture") ?? null,
        documentWidth: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      }))
      return { stateId, checkpoint, visualBaseline, ...errors, ...observed }
    },
    evaluate: (snapshot) => evaluateWorkspaceComponentHardGates(snapshot as WorkspaceComponentHardGateSnapshot),
    validate: validateWorkspaceComponentHardGateReport,
  },
}

async function openFixture(page: Parameters<UiReviewSpec["checkpoints"][number]["reach"]>[0], name: string) {
  await page.goto(`/?ui-review-fixture=${name}`)
  await expect(page.locator(`[data-ui-review-fixture="${name}"]`)).toBeVisible()
}
