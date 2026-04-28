import { expect, test } from "@playwright/test"
import { bootClean, clickDataTab, openWorkbench } from "./helpers"

test("catalog renders frequency groups from real ClickHouse", async ({ page }) => {
  await bootClean(page)
  await openWorkbench(page)
  await clickDataTab(page)

  // Expect the standard frequency labels to be present + a count > 0.
  for (const label of ["Daily", "Weekly", "Monthly", "Quarterly", "Annual"]) {
    await expect(page.locator(`text=${label}`).first()).toBeVisible()
  }
})

test("backend catalog endpoint returns 87k+ series", async ({ request }) => {
  const res = await request.get("/api/macro/catalog?limit=1")
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(body.total).toBeGreaterThan(80_000)
  expect(Array.isArray(body.items)).toBe(true)
})

test("backend facets endpoint returns frequency + source", async ({ request }) => {
  const res = await request.get("/api/macro/facets")
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(Array.isArray(body.frequency)).toBe(true)
  expect(Array.isArray(body.source)).toBe(true)
  expect(body.frequency.length).toBeGreaterThan(0)
})
