import { createRequire } from "node:module"
import { expect, type Page } from "@playwright/test"
import type { UiReviewSpec } from "../../core/reviewSpec"
import type { UiReviewViewport } from "../../core/contracts"
import {
  AGENT_SIDEBAR_HARD_GATE_CONTRACT,
  evaluateAgentSidebarHardGates,
  validateAgentSidebarHardGateReport,
  type AgentSidebarHardGateSnapshot,
} from "./hardGates"

const AXE_SCRIPT_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js")
const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]

async function ensureAgentNavigation(page: Page): Promise<void> {
  const trees = page.locator('[data-boring-workspace-part="app-left-agent-tree"]')
  const open = page.getByRole("button", { name: "Open app navigation" })
  await expect.poll(async () => await trees.count() === 2 || await open.isVisible().catch(() => false), { timeout: 60_000 }).toBe(true)
  if (await trees.count() !== 2) await open.click()
  await expect(trees).toHaveCount(2, { timeout: 60_000 })
  await expect(page.getByRole("button", { name: /Collapse Alpha;/ })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"] [data-boring-workspace-part="app-session-row"]')).toHaveCount(1, { timeout: 60_000 })
  await expect(page.getByRole("heading", { name: "What should we work on?" })).toBeVisible({ timeout: 60_000 })
}

export const workspaceAgentSidebarSpec: UiReviewSpec = {
  id: "workspace-agent-sidebar",
  specRevision: "workspace-agent-sidebar-v1",
  fixtureResetId: "workspace-agent-sidebar-fixture-v1",
  rubricVersion: "impeccable-v1",
  target: {
    root: "apps/workspace-playground",
    buildCommand: ["pnpm", "run", "build:deps"],
    serverCommand: ["pnpm", "exec", "vite", "--host", "127.0.0.1", "--strictPort"],
    route: "/?fresh=1",
    fixturePath: "tools/ui-review/fixtures/workspace-agent-sidebar",
    defaultPort: 5480,
    defaultApiPort: 5490,
    serverEnvironmentKeys: ["PORT", "AGENT_API_PORT", "BORING_AGENT_WORKSPACE_ROOT", "BORING_AGENT_SESSION_ROOT", "BORING_AGENT_E2E_SCRIPTED_PI", "VITE_HMR_HOST", "VITE_HMR_CLIENT_PORT"],
    environment: ({ isolation, port, apiPort }) => ({
      PORT: String(port),
      AGENT_API_PORT: String(apiPort ?? 5490),
      BORING_AGENT_WORKSPACE_ROOT: isolation.workspace,
      BORING_AGENT_SESSION_ROOT: isolation.sessions,
      BORING_AGENT_E2E_SCRIPTED_PI: "1",
      VITE_HMR_HOST: "127.0.0.1",
      VITE_HMR_CLIENT_PORT: String(port),
    }),
    ready: async (page) => ensureAgentNavigation(page),
  },
  viewports,
  checkpoints: [
    { id: "agent-list", colorScheme: "dark", reach: async (page) => {
      await ensureAgentNavigation(page)
      await page.mouse.move(1_000, 500)
    } },
    { id: "hover-actions", viewportNames: ["desktop"], colorScheme: "dark", reach: async (page) => {
      await page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="beta"] .app-left-agent-row').hover()
      await expect(page.getByRole("button", { name: "New chat with Beta", exact: true })).toBeVisible()
    } },
    { id: "expanded-sessions", colorScheme: "dark", reach: async (page) => {
      const expandBeta = page.getByRole("button", { name: /^Expand Beta;/ })
      if (await expandBeta.isVisible().catch(() => false)) await expandBeta.click()
      await expect(page.getByRole("button", { name: /^Collapse Beta;/ })).toBeVisible()
      await page.mouse.move(1_000, 500)
    } },
    { id: "pinned-chat", colorScheme: "dark", reach: async (page) => {
      const alphaTree = page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"]')
      const row = alphaTree.locator('[data-boring-workspace-part="app-session-row"]').first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.hover()
      await row.getByRole("button", { name: /Chat actions for/ }).click()
      await page.getByRole("menuitem", { name: "Pin chat" }).click()
      await expect(page.locator('section[aria-label="Pinned chats"]')).toBeVisible()
      await page.mouse.move(1_000, 500)
    } },
    { id: "agent-details", colorScheme: "dark", reach: async (page) => {
      await page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"] .app-left-agent-row').hover()
      await page.getByRole("button", { name: "Settings for Alpha" }).click()
      await expect(page.locator('[data-boring-workspace-part="agent-details-overlay"]')).toBeVisible()
      await expect(page.getByText("Configuration", { exact: true })).toBeVisible()
    } },
  ],
  criticPrompt: "Review the supplied multi-agent sidebar and Agent detail screenshots against the design context. Demand a compact, calm, editorial, world-class navigation hierarchy. Prioritize pinned-chat provenance, Agent/session information architecture, hover and touch discoverability, expansion rhythm and guide lines, active-session meaning, mobile behavior, and the unified Agent page. Return only UiCriticReportV1 JSON. Scores are advisory; every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md", "docs/WORKSPACE_CONTRACT.md"],
  ownerSpotChecks: [
    "Compare Agent list, hover actions, expanded sessions, pinned chat, and Agent details at desktop 1440×900.",
    "Compare Agent list, expanded sessions, pinned chat, and Agent details at mobile 390×844.",
    "Confirm pinned chats remain top-level and show their Agent provenance.",
    "Confirm desktop actions appear on hover/focus while touch actions remain directly available.",
    "Confirm Agent rows expand/collapse chats while only the dedicated settings control opens Agent details.",
    "Confirm Agent details is one unified page with no Overview/Settings tab split.",
    "Confirm all deterministic hard gates are green before approving visual taste.",
  ],
  hardGates: {
    contractVersion: AGENT_SIDEBAR_HARD_GATE_CONTRACT,
    collect: async (page, stateId, checkpoint, viewport, errors): Promise<AgentSidebarHardGateSnapshot> => {
      if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ path: AXE_SCRIPT_PATH })
      const [sidebar, axeViolations, documentWidth] = await Promise.all([
        page.evaluate(({ checkpoint, mobile }) => {
          const visible = (element: Element): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05
          }
          const text = (selector: string) => [...document.querySelectorAll(selector)].find(visible)?.textContent?.replace(/\s+/g, " ").trim() ?? null
          const agentTrees = [...document.querySelectorAll('[data-boring-workspace-part="app-left-agent-tree"]')]
          const actionButtons = agentTrees.flatMap((tree) => [...tree.querySelectorAll<HTMLButtonElement>('button[aria-label^="New chat with"], button[aria-label^="New chat options for"], button[aria-label^="Quick chat with"], button[aria-label^="Settings for"]')])
          const controls = agentTrees.flatMap((tree) => [...tree.querySelectorAll<HTMLButtonElement>("button")]).filter(visible)
          const pinned = document.querySelector('section[aria-label="Pinned chats"]')
          const pinnedRow = pinned?.querySelector('[data-boring-workspace-part="app-session-row"]')
          const provenance = pinnedRow?.querySelector(".app-left-session-trailing")?.textContent?.replace(/\s+/g, " ").trim() || null
          return {
            agentCount: agentTrees.length,
            agentHeading: text('[data-boring-workspace-part="app-left-agents-heading"]'),
            agentSeatSummary: text('section[aria-label="Agents"] > div span:last-child'),
            agentFilterCount: document.querySelectorAll('[aria-label="Filter Agents"]').length,
            legacyFilterCount: document.querySelectorAll('[aria-label="Filter chats by Agent"]').length,
            visibleActionCount: actionButtons.filter(visible).length,
            visibleAgentCountLabels: [...document.querySelectorAll('[data-boring-agent-session-count="true"]')].filter(visible).length,
            expandedRegionCount: document.querySelectorAll('[role="region"][aria-label$=" sessions"]').length,
            guideCount: document.querySelectorAll('[role="region"][aria-label$=" sessions"].border-l').length,
            pinnedHeading: pinned?.querySelector("div > span:first-child")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            pinnedCount: pinned?.querySelectorAll('[data-boring-workspace-part="app-session-row"]').length ?? 0,
            pinnedProvenance: provenance,
            pinnedAgentSessionCount: document.querySelectorAll('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"] [data-boring-workspace-part="app-session-row"]').length,
            nestedPinnedHasPin: Boolean(document.querySelector('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"] [data-boring-workspace-part="app-session-row"] .app-left-session-trailing svg')),
            detailOverlayCount: document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"]').length,
            detailTabCount: document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"] [role="tab"]').length,
            configurationHeadingCount: [...document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"] h3')].filter((heading) => heading.textContent?.trim() === "Configuration").length,
            undersizedAgentControls: mobile ? controls.map((control) => {
              const rect = control.getBoundingClientRect()
              return { label: control.getAttribute("aria-label") || control.textContent?.trim() || "button", width: rect.width, height: rect.height }
            }).filter((control) => control.width < 24 || control.height < 24) : [],
            checkpoint,
          }
        }, { checkpoint, mobile: viewport.name === "mobile" }),
        page.evaluate(async () => {
          const result = await (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe.run(document, { resultTypes: ["violations"] })
          return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => ({ id: violation.id, impact: violation.impact!, nodes: violation.nodes.length }))
        }),
        page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })),
      ])
      return {
        stateId,
        checkpoint,
        origin: new URL(page.url()).origin,
        viewport: { width: viewport.width, height: viewport.height, mobile: viewport.name === "mobile" },
        documentWidth,
        axeViolations,
        sidebar,
        ...errors,
      }
    },
    evaluate: (snapshot) => evaluateAgentSidebarHardGates(snapshot as AgentSidebarHardGateSnapshot),
    validate: validateAgentSidebarHardGateReport,
  },
}
