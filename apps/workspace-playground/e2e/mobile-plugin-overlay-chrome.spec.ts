import { expect, test } from "@playwright/test"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
})

test("plugin overlay header clears the compact navigation control", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator('main[aria-label="Chat"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.dv-chat-stage, [data-boring-workspace-part="mobile-chat-pane"]').first()).toBeVisible()

  await page.getByRole("button", { name: "Open app navigation" }).tap()
  await page.getByRole("button", { name: "Tasks" }).tap()

  const overlay = page.locator('[data-boring-workspace-part="tasks-overlay"]')
  const navigationControl = page.getByRole("button", { name: "Open app navigation" })
  const headerIdentity = overlay.locator("header > div").first()

  await expect(overlay).toBeVisible()
  const [navigationBox, identityBox] = await Promise.all([
    navigationControl.boundingBox(),
    headerIdentity.boundingBox(),
  ])

  expect(navigationBox).not.toBeNull()
  expect(identityBox).not.toBeNull()
  expect(identityBox!.x).toBeGreaterThanOrEqual(navigationBox!.x + navigationBox!.width)
})
