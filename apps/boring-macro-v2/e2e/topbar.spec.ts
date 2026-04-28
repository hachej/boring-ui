import { expect, test } from "@playwright/test"
import { bootClean } from "./helpers"

test("topbar shows boring.macro", async ({ page }) => {
  await bootClean(page)
  await expect(page.locator("text=boring.macro").first()).toBeVisible()
})

test("page title is boring.macro", async ({ page }) => {
  await bootClean(page)
  await expect(page).toHaveTitle(/boring\.macro/)
})
