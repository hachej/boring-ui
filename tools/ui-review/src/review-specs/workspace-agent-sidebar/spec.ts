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
// Width and pointer are INDEPENDENT axes and the sidebar CSS uses both. A
// two-point sample of (wide, fine) and (narrow, coarse) holds them locked
// together, so a rule keyed to width and a rule keyed to pointer agree at
// every sampled point and can disagree everywhere else — which is exactly how
// a 44px button in a 28px slot and a 24px button in a 44px slot both shipped
// green. These four viewports cover all four corners of the two axes.
const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  // Wide + fine's opposite corner. Touch-emulated: the coarse-pointer branch
  // (44px slots, always-visible actions, the trailing margin swap) only exists
  // under `pointer: coarse`, and a plain narrow viewport is still a
  // fine-pointer browser.
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true },
  // Narrow + FINE: a desktop browser window dragged small. Every `sm:`
  // utility drops out here while every pointer-keyed rule stays put.
  { name: "narrow-desktop", width: 500, height: 900, deviceScaleFactor: 1 },
  // Wide + COARSE: a tablet. Every `sm:` utility applies while every
  // pointer-keyed rule takes its touch branch.
  { name: "tablet", width: 834, height: 1112, deviceScaleFactor: 1, hasTouch: true },
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
  specRevision: "workspace-agent-sidebar-v4",
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
    { id: "hover-actions", viewportNames: ["desktop", "narrow-desktop"], colorScheme: "dark", reach: async (page) => {
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
    // The ONLY checkpoint that leaves a session row hovered at capture time.
    // Every other one ends with `page.mouse.move(1000, 500)`, so the action
    // strip is faded out and any gate that measures it sees nothing. On the
    // touch viewport the strip is permanently visible, so this checkpoint
    // covers the coarse-pointer branch too.
    { id: "session-row-hover", colorScheme: "dark", reach: async (page) => {
      const alphaTree = page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"]')
      const row = alphaTree.locator('[data-boring-workspace-part="app-session-row"]').first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.hover()
      await expect(row.locator(".app-left-session-actions")).toBeVisible()
      // KNOWN GAP: the fixture's only chat is its Agent's active one, and the
      // split / quick-chat shortcuts render exclusively on a chat that is not
      // on stage. So this state measures a strip holding just the "..."
      // trigger, and a 24px regression in the other two shortcuts shipped
      // green past `agent-touch-targets`. Closing it needs a fixture with a
      // second chat per Agent, not another assertion here.
      // Deliberately NO mouse.move away: the hovered state IS the subject.
    } },
    { id: "agent-details", colorScheme: "dark", reach: async (page) => {
      await page.locator('[data-boring-workspace-part="app-left-agent-tree"][data-boring-agent-type-id="alpha"] .app-left-agent-row').hover()
      await page.getByRole("button", { name: "Settings for Alpha" }).click()
      await expect(page.locator('[data-boring-workspace-part="agent-details-overlay"]')).toBeVisible()
      await expect(page.getByRole("heading", { name: "System prompt" })).toBeVisible()
    } },
  ],
  criticPrompt: "Review the supplied multi-agent sidebar and Agent detail screenshots against the design context. Demand a compact, calm, editorial, world-class navigation hierarchy. Prioritize pinned-chat provenance, Agent/session information architecture, hover and touch discoverability, expansion rhythm and guide lines, active-session meaning, mobile behavior, and the unified Agent page. Return only UiCriticReportV1 JSON. Scores are advisory; every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md", "docs/WORKSPACE_CONTRACT.md"],
  ownerSpotChecks: [
    "Compare Agent list, hover actions, expanded sessions, pinned chat, and Agent details at desktop 1440×900.",
    "Compare Agent list, expanded sessions, pinned chat, and Agent details at mobile 390×844.",
    "Compare the same states at narrow-desktop 500×900 (fine pointer) and tablet 834×1112 (coarse pointer) — the width/pointer corners a wide-fine plus narrow-coarse pair cannot see.",
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
        page.evaluate(({ checkpoint, coarsePointer }) => {
          // Effective opacity, not the element's own: hover/touch reveal
          // works by fading the CONTAINER, so a control's own opacity of 1
          // says nothing about whether the user can see or hit it.
          const shown = (node: Element): boolean => {
            let opacity = 1
            for (let el: Element | null = node; el && el !== document.body; el = el.parentElement) {
              opacity *= Number(getComputedStyle(el).opacity)
            }
            return opacity > 0.05
          }
          const visible = (element: Element): boolean => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && shown(element)
          }
          const text = (selector: string) => [...document.querySelectorAll(selector)].find(visible)?.textContent?.replace(/\s+/g, " ").trim() ?? null
          const agentTrees = [...document.querySelectorAll('[data-boring-workspace-part="app-left-agent-tree"]')]
          const actionButtons = agentTrees.flatMap((tree) => [...tree.querySelectorAll<HTMLButtonElement>('button[aria-label^="New chat with"], button[aria-label^="New chat options for"], button[aria-label^="Settings for"]')])
          // Scoped to the WHOLE app-left pane, not just the Agent trees: the
          // pinned-chats section and the pane chrome live outside a tree, and
          // the 24px row shortcuts that shipped undersized were only ever
          // measured on a row that happened to be the active session (which
          // hides them). A touch-target gate that inspects a subtree guards
          // only that subtree.
          const controls = [...document.querySelectorAll('[data-boring-workspace-part="app-left-pane"]')]
            .flatMap((pane) => [...pane.querySelectorAll<HTMLButtonElement>("button")])
            .filter(visible)
          const pinned = document.querySelector('section[aria-label="Pinned chats"]')
          const pinnedRow = pinned?.querySelector('[data-boring-workspace-part="app-session-row"]')
          const provenance = pinnedRow?.querySelector(".app-left-session-trailing")?.textContent?.replace(/\s+/g, " ").trim() || null
          return {
            agentCount: agentTrees.length,
            // Stable hook: the heading moved inside the collapse toggle in
            // the nested redesign, so a CSS path here drifts silently.
            agentHeading: text('[data-boring-workspace-part="app-left-agents-heading"]'),
            // Stable hook, like agentHeading above: the previous CSS path
            // drifted onto the numeric count span without anyone noticing.
            agentSeatSummary: text('[data-boring-workspace-part="app-left-agents-count"]'),
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
            // The SET, in order — a count could pass with the wrong five.
            capabilityHeadings: [...document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"] h3')].map((heading) => heading.textContent?.trim() ?? ""),
            // Prose is scanned for whole phrases; the single word
            // "Configuration" is only jargon as a HEADING, and matching it
            // across all overlay prose made this gate fire on any body copy
            // that happened to contain it.
            legacyJargonCount: [...document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"]')].filter((overlay) => /Runtime plugins explicitly bound|host fleet definition/.test(overlay.textContent ?? "")).length
              + [...document.querySelectorAll('[data-boring-workspace-part="agent-details-overlay"] h1, [data-boring-workspace-part="agent-details-overlay"] h2, [data-boring-workspace-part="agent-details-overlay"] h3')].filter((heading) => /^Configuration$/i.test(heading.textContent?.trim() ?? "")).length,
            // Hover actions are absolutely positioned and have no background,
            // so anything the trailing slot fails to reserve is drawn
            // underneath them. Measured, because this is invisible to any
            // assertion about markup.
            actionOverlaps: [...document.querySelectorAll('[data-boring-workspace-part="app-session-row"]')].flatMap((row) => {
              // `visible` already folds in ancestor opacity: the status slot
              // fades out behind a fading-in action strip on pointer devices,
              // and an invisible element cannot be overlapped.
              const actions = row.querySelector(".app-left-session-actions")
              if (!actions || !visible(actions)) return []
              const strip = actions.getBoundingClientRect()
              return ([
                ["title", row.querySelector("span.flex-1")],
                ["age", row.querySelector('[data-boring-workspace-part="app-session-age"]')],
                ["badge", row.querySelector('[data-boring-workspace-part="app-session-badge"]')],
                ["owner", row.querySelector(".app-left-session-trailing span.truncate")],
              ] as Array<[string, Element | null]>).flatMap(([kind, node]) => {
                if (!node || !shown(node)) return []
                const rect = node.getBoundingClientRect()
                const overlap = Math.min(rect.right, strip.right) - Math.max(rect.left, strip.left)
                return overlap > 0
                  ? [{ kind, label: node.textContent?.trim().slice(0, 20) ?? "", overlap: Math.round(overlap) }]
                  : []
              })
            }),
            undersizedAgentControls: coarsePointer ? controls.map((control) => {
              const rect = control.getBoundingClientRect()
              return { label: control.getAttribute("aria-label") || control.textContent?.trim() || "button", width: rect.width, height: rect.height }
            // The coarse-pointer rules TARGET 44px; asserting 24 let a
            // control shrink to 25px while the gate stayed green.
            }).filter((control) => control.width < 44 || control.height < 44) : [],
            checkpoint,
          }
        }, {
          checkpoint,
          // The page is told WHICH CONDITION to measure against, not which
          // viewport it happens to be. `viewport.name === "mobile"` conflated
          // "narrow" with "coarse pointer"; every band added since separates
          // them, and the CSS always did.
          coarsePointer: viewport.hasTouch === true,
        }),
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
        // Both conditions the sidebar branches on, reported separately.
        // `mobileShell` is the JS width switch in PluginTabsWorkspaceShell
        // (`viewport < 640`); `coarsePointer` is the CSS media condition.
        viewport: {
          width: viewport.width,
          height: viewport.height,
          mobileShell: viewport.width < 640,
          coarsePointer: viewport.hasTouch === true,
        },
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
