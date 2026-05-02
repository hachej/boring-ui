/**
 * Macro-specific Playwright helpers. Generic primitives (`bootClean`,
 * `openWorkbench`, `openPaneViaBridge`) live in
 * `@boring/workspace/testing` — this file only carries the
 * macro-flavoured wrappers (chart pane, deck pane).
 */
import type { Page } from "@playwright/test"
import {
  bootClean as bootCleanGeneric,
  openWorkbench as openWorkbenchGeneric,
  openPaneViaBridge,
} from "@boring/workspace/testing/e2e"

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

/**
 * Click the Data tab inside the workbench's left pane, then wait for the
 * catalog to actually paint a row group header. Replaces a 1.5s sleep
 * that flaked when ClickHouse was warming up.
 */
export async function clickDataTab(page: Page): Promise<void> {
  await page
    .locator('button, [role="tab"]')
    .filter({ hasText: /^Data$/ })
    .first()
    .click()
  // Catalog renders frequency-group headers (Daily/Weekly/Monthly/...) once
  // the first /catalog response lands. Any one of them is sufficient.
  await page
    .locator("text=/^(Daily|Weekly|Monthly|Quarterly|Semiannual|Annual)$/")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
}

/**
 * Expand the Monthly frequency group inside the catalog and wait for at
 * least one series row to appear under it.
 */
export async function expandMonthlyGroup(page: Page): Promise<void> {
  await page.locator("text=Monthly").first().click()
  // Series IDs are uppercase letters/digits, ≥3 chars (CPIAUCSL, UNRATE, …).
  // Wait until at least one such row is rendered — proves the group is
  // expanded AND the rows finished hydrating.
  await page
    .locator('[data-explorer-row], [role="row"], li, button')
    .filter({ hasText: /^[A-Z][A-Z0-9_]{2,}$/ })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
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
