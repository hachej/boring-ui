import { expect, test } from "@playwright/test"
import { bootClean, openChartViaBridge, openWorkbench } from "./helpers"

test.describe("ChartCanvasPane tabs", () => {
  test("opens via bridge and renders 4 tabs", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openChartViaBridge(page, "CPIAUCSL")

    for (const label of ["Chart", "Table", "Metadata", "Lineage"]) {
      await expect(
        page.locator(`button:has-text("${label}")`).last(),
      ).toBeVisible()
    }
  })

  test("Chart tab renders recharts SVG with real data", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openChartViaBridge(page, "CPIAUCSL")
    await expect(page.locator(".recharts-wrapper").first()).toBeVisible()
  })

  test("Table tab shows date column", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openChartViaBridge(page, "CPIAUCSL")
    await page.locator('button:has-text("Table")').last().click()
    await expect(page.locator('th:has-text("Date")').first()).toBeVisible()
  })

  test("Metadata tab shows Frequency / Units / Start Date", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openChartViaBridge(page, "CPIAUCSL")
    await page.locator('button:has-text("Metadata")').last().click()
    for (const field of ["Frequency", "Units", "Start Date"]) {
      await expect(page.locator(`text=${field}`).first()).toBeVisible()
    }
  })

  test("Lineage tab loads upstream + downstream sections", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openChartViaBridge(page, "CPIAUCSL")
    await page.locator('button:has-text("Lineage")').last().click()
    // Lineage fetches from /api/macro/series/:id/lineage — give it 5s.
    await expect(page.locator("text=Upstream sources").first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      page.locator("text=Downstream derived").first(),
    ).toBeVisible()
  })
})

test.describe("ChartCanvasPane backend", () => {
  test("/api/macro/series/:id returns observations + metadata", async ({ request }) => {
    const res = await request.get("/api/macro/series/CPIAUCSL")
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.observations)).toBe(true)
    expect(body.observations.length).toBeGreaterThan(100)
    expect(body.metadata).toBeTruthy()
    expect(body.metadata.title).toMatch(/Consumer Price Index/i)
  })

  test("/api/macro/series/:id/lineage returns nodes + edges", async ({ request }) => {
    const res = await request.get("/api/macro/series/CPIAUCSL/lineage")
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(Array.isArray(body.edges)).toBe(true)
  })
})
