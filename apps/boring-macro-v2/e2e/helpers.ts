/**
 * Macro-specific Playwright helpers. Generic primitives (`bootClean`,
 * `openWorkbench`, `openPaneViaBridge`) live in
 * `@boring/workspace/testing/e2e` — this file only carries the
 * macro-flavoured wrappers (chart pane, deck pane).
 */
import type { Page } from "@playwright/test"
import {
  bootClean as bootCleanGeneric,
  openWorkbench as openWorkbenchGeneric,
  openPaneViaBridge,
} from "@boring/workspace/testing"

/** Storage prefix for boring.macro's chat shell (mirrors App.tsx). */
export const SHELL_KEY = "boring-macro:shell"

/**
 * Macro-flavoured bootClean. Accepts a flat seed object (legacy shape
 * the macro specs use) and forwards it to the workspace helper as
 * `{ seed }`. Apps with their own e2e suite can call the workspace
 * helper directly if they prefer the structured options shape.
 */
export async function bootClean(
  page: Page,
  seed: Record<string, string> = {},
): Promise<void> {
  await bootCleanGeneric(page, { shellKey: SHELL_KEY, seed })
}

export async function openWorkbench(page: Page): Promise<void> {
  await openWorkbenchGeneric(page, { shellKey: SHELL_KEY })
}

/** Click the Data tab inside the workbench's left pane. */
export async function clickDataTab(page: Page): Promise<void> {
  await page
    .locator('button, [role="tab"]')
    .filter({ hasText: /^Data$/ })
    .first()
    .click()
  await page.waitForTimeout(1500)
}

/** Expand the Monthly frequency group inside the catalog. */
export async function expandMonthlyGroup(page: Page): Promise<void> {
  await page.locator("text=Monthly").first().click()
  await page.waitForTimeout(1500)
}

export async function openChartViaBridge(page: Page, seriesId: string): Promise<void> {
  await openPaneViaBridge(page, {
    id: `chart:${seriesId}`,
    component: "chart-canvas",
    title: seriesId,
    params: { seriesId },
  })
}

export async function openDeckViaBridge(page: Page, path: string): Promise<void> {
  await openPaneViaBridge(page, {
    id: `deck:${path}`,
    component: "deck",
    title: path,
    params: { path },
  })
}
