import { expect, test } from "@playwright/test"
import { bootClean, openChartViaBridge, openWorkbench } from "./helpers"

/**
 * Regression: when the workbench is split into 2 vertical groups, the
 * bottom group's chart used to overflow its container — recharts
 * ResponsiveContainer measured the parent height ONCE on mount and didn't
 * shrink when the parent was resized. Cause: the chart's outer flex item
 * had `flex-1` but no `min-h-0`, so it couldn't shrink below the chart's
 * intrinsic size. Fix: `min-h-0 flex-1` on the chart container.
 *
 * This test enforces that the chart's recharts wrapper height stays inside
 * its content container in a split layout.
 */
test("vertical split — bottom chart fits inside its content container", async ({ page }) => {
  await bootClean(page)
  await openWorkbench(page)

  // Open two charts in the same group.
  await openChartViaBridge(page, "CPIAUCSL")
  await openChartViaBridge(page, "UNRATE")

  // Drag the second tab to the bottom of the dockview area to split.
  const tabs = await page.$$(".dv-tab")
  if (tabs.length < 2) {
    test.skip(true, `expected 2 tabs, got ${tabs.length}`)
    return
  }
  const tabBox = await tabs[1].boundingBox()
  const dockview = await page.locator(".workbench-dockview").first().boundingBox()
  if (!tabBox || !dockview) test.skip(true, "missing layout boxes")

  await page.mouse.move(tabBox!.x + tabBox!.width / 2, tabBox!.y + tabBox!.height / 2)
  await page.mouse.down()
  const targetX = dockview!.x + dockview!.width / 2
  const targetY = dockview!.y + dockview!.height - 30
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(
      tabBox!.x + tabBox!.width / 2 + (targetX - tabBox!.x - tabBox!.width / 2) * (i / 20),
      tabBox!.y + tabBox!.height / 2 + (targetY - tabBox!.y - tabBox!.height / 2) * (i / 20),
      { steps: 2 },
    )
    await page.waitForTimeout(15)
  }
  await page.mouse.up()
  await page.waitForTimeout(1500)

  // Measure each group's content area + the recharts wrapper inside it.
  const measurements = await page.evaluate(() => {
    const groups = [...document.querySelectorAll(".dv-groupview")]
    return groups.map((g) => {
      const content = g.querySelector(".dv-content-container")
      const recharts = g.querySelector(".recharts-wrapper")
      const cr = content?.getBoundingClientRect()
      const rr = recharts?.getBoundingClientRect()
      return {
        content: cr ? Math.round(cr.height) : null,
        recharts: rr ? Math.round(rr.height) : null,
      }
    })
  })

  // We need at least 2 groups (split happened).
  expect(measurements.length).toBeGreaterThanOrEqual(2)
  for (const m of measurements) {
    if (m.content == null || m.recharts == null) continue
    // Chart must fit inside its content container (with some slack for
    // padding). Pre-fix the bottom group reported recharts=789 inside a
    // 405px content container — i.e. ~2x overflow.
    expect(m.recharts).toBeLessThanOrEqual(m.content + 8)
  }
})
