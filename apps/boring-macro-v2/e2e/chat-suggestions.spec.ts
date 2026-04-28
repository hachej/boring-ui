import { expect, test } from "@playwright/test"
import { bootClean } from "./helpers"

test("empty chat shows the four macro suggestion cards", async ({ page }) => {
  await bootClean(page)
  for (const label of [
    "Find a series",
    "Plot Real GDP",
    "Compute YoY growth",
    "Draft a briefing deck",
  ]) {
    await expect(page.locator(`text=${label}`).first()).toBeVisible()
  }
})

test("empty chat custom title + description", async ({ page }) => {
  await bootClean(page)
  await expect(
    page.locator("text=What macro question are we tackling?"),
  ).toBeVisible()
  await expect(
    page.locator(
      "text=Search FRED, plot a series, derive a transform, or draft a briefing deck.",
    ),
  ).toBeVisible()
})
