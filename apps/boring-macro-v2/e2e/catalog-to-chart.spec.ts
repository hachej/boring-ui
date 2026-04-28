import { expect, test } from "@playwright/test"
import {
  bootClean,
  clickDataTab,
  expandMonthlyGroup,
  openWorkbench,
} from "./helpers"

/**
 * Regression: catalog onActivate → surface.openPanel({component: 'chart-canvas'})
 * was blocked by ALLOWED_PANELS in ArtifactSurfacePane until we added
 * `extraPanels` upstream. This test guards against that wiring breaking.
 */
test("clicking a series row opens a chart pane", async ({ page }) => {
  await bootClean(page)
  await openWorkbench(page)
  await clickDataTab(page)
  await expandMonthlyGroup(page)

  // The first series id under Monthly (deterministic in this dataset).
  const target = "TEST003"
  const row = page.locator(`text=${target}`).first()
  await row.scrollIntoViewIfNeeded()
  await row.dblclick({ force: true })
  await page.waitForTimeout(2500)

  // Chart pane should be open with recharts rendering, placeholder gone.
  await expect(page.locator(".recharts-wrapper").first()).toBeVisible()
  await expect(page.locator("text=Nothing open yet")).toHaveCount(0)
})
