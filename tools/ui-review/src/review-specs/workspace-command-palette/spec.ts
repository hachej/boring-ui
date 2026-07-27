import { createRequire } from "node:module"
import { resolve } from "node:path"
import { expect } from "@playwright/test"
import type { UiReviewSpec } from "../../core/reviewSpec"
import type { UiReviewViewport } from "../../core/contracts"
import { observeBrowserDocument } from "../../core/browserObservation"
import { observeCommandPaletteSurface } from "./browserObservation"
import { COMMAND_PALETTE_HARD_GATE_CONTRACT, evaluateCommandPaletteHardGates, validateCommandPaletteHardGateReport, type UiHardGateSnapshot } from "./hardGates"

const AXE_SCRIPT_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js")
const viewports: UiReviewViewport[] = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
]

export const workspaceCommandPaletteSpec: UiReviewSpec = {
  id: "workspace-command-palette",
  specRevision: "workspace-command-palette-v1",
  fixtureResetId: "workspace-playground-e2e-fresh-v1",
  rubricVersion: "impeccable-v1",
  target: {
    root: "apps/workspace-playground",
    buildCommand: ["pnpm", "run", "build:deps"],
    serverCommand: ["pnpm", "exec", "vite", "--host", "127.0.0.1", "--strictPort"],
    route: "/?fresh=1",
    fixturePath: "tools/ui-review/fixtures/workspace-command-palette",
    defaultPort: 5380,
    defaultApiPort: 5390,
    serverEnvironmentKeys: ["PORT", "AGENT_API_PORT", "BORING_AGENT_WORKSPACE_ROOT", "BORING_AGENT_SESSION_ROOT", "VITE_HMR_HOST", "VITE_HMR_CLIENT_PORT"],
    environment: ({ isolation, port, apiPort }) => ({
      PORT: String(port),
      AGENT_API_PORT: String(apiPort ?? 5390),
      BORING_AGENT_WORKSPACE_ROOT: isolation.workspace,
      BORING_AGENT_SESSION_ROOT: isolation.sessions,
      VITE_HMR_HOST: "127.0.0.1",
      VITE_HMR_CLIENT_PORT: String(port),
    }),
    ready: async (page, timeoutMs) => {
      await expect(page.getByRole("main", { name: "Chat" })).toBeVisible({ timeout: timeoutMs })
    },
  },
  viewports,
  checkpoints: [
    { id: "closed", reach: async () => {} },
    { id: "open", reach: async (page) => {
      await page.keyboard.press("ControlOrMeta+KeyK")
      await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({ timeout: 5_000 })
    } },
    { id: "commands", reach: async (page) => {
      await page.keyboard.type(">")
      await expect(page.getByRole("button", { name: "Commands" })).toHaveAttribute("aria-pressed", "true")
    } },
  ],
  criticPrompt: "Review the supplied workspace command-palette screenshots against the design context.\nReturn only UiCriticReportV1 JSON. Scores are advisory; every finding must cite supplied state ids.",
  criticContextPaths: [".impeccable.md"],
  ownerSpotChecks: [
    "Open report.html through workspace.open.path from the existing Inbox/ask_user handoff.",
    "Compare closed, open, and command-mode checkpoints at desktop 1440×900.",
    "Compare closed, open, and command-mode checkpoints at mobile 390×844.",
    "Verify palette focus, keyboard hints, command-mode selection, and Escape close behavior.",
    "Confirm every hard gate is green, then approve or request changes in the existing Inbox review.",
  ],
  hardGates: {
    contractVersion: COMMAND_PALETTE_HARD_GATE_CONTRACT.contractVersion,
    collect: async (page, stateId, checkpoint, viewport, errors): Promise<UiHardGateSnapshot> => {
      if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ path: AXE_SCRIPT_PATH })
      const axeViolations = await page.evaluate(async () => {
        const result = await (window as typeof window & { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe.run(document, { resultTypes: ["violations"] })
        return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => ({ id: violation.id, impact: violation.impact!, nodes: violation.nodes.length }))
      })
      const [observed, commandPalette] = await Promise.all([
        page.evaluate(observeBrowserDocument, {
          minimumTouchWidth: COMMAND_PALETTE_HARD_GATE_CONTRACT.minimumTouchWidth,
          minimumTouchHeight: COMMAND_PALETTE_HARD_GATE_CONTRACT.minimumTouchHeight,
          touchExemptions: COMMAND_PALETTE_HARD_GATE_CONTRACT.touchExemptions,
        }),
        page.evaluate(observeCommandPaletteSurface, { checkpoint }),
      ])
      return { stateId, viewport: { width: viewport.width, height: viewport.height, mobile: viewport.name === "mobile" }, axeViolations, commandPalette, ...errors, ...observed }
    },
    evaluate: (snapshot) => evaluateCommandPaletteHardGates(snapshot as UiHardGateSnapshot),
    validate: validateCommandPaletteHardGateReport,
  },
  exploration: {
    bombadilSpecPath: resolve(import.meta.dirname, "bombadil.spec.ts"),
    ready: async (page, timeoutMs) => {
      await Promise.all([
        expect(page.getByRole("main", { name: "Chat" })).toBeVisible({ timeout: timeoutMs }),
        expect(page.locator("button").filter({ hasText: /^Search/ }).first()).toBeVisible({ timeout: timeoutMs }),
      ])
    },
    selectReplayState: (states) => states.find((state) => {
      const palette = state.normalizedState
        && typeof state.normalizedState.palette === "object"
        && state.normalizedState.palette !== null
        && !Array.isArray(state.normalizedState.palette)
        ? state.normalizedState.palette as Record<string, unknown>
        : null
      return state.ordinal > 2 && state.action === "Wait" && palette?.dialogVisible === true
    }),
  },
}
