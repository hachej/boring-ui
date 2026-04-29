import { expect, test } from "@playwright/test"

/**
 * Canary coverage for the workspace-playground migration to the declarative
 * TopBar + ChatLayout stack.
 */

test.describe("ChatLayout canary", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible()
  })

  test("renders TopBar plus all four declarative chrome panels", async ({ page }) => {
    await expect(page.getByRole("banner", { name: /app top bar/i })).toContainText("Boring")
    await expect(page.getByRole("navigation", { name: /session history/i })).toBeVisible()
    await expect(page.getByRole("region", { name: /agent assistant/i })).toBeVisible()
    await expect(page.getByRole("tablist", { name: /workbench sources/i }).first()).toBeVisible()
    await expect(page.getByText("artifact-surface").first()).toBeVisible()
  })

  test("dockview close button removes the active artifact surface tab", async ({ page }) => {
    await page.getByRole("button", { name: /close artifact-surface/i }).click()
    await expect(page.getByText("artifact-surface")).toHaveCount(0)
  })

  test("session clicks remount chat with the selected session id", async ({ page }) => {
    await page.getByText("Plan review").click()
    await expect(page.getByRole("banner", { name: /app top bar/i })).toContainText("Plan review")
    await expect(page.getByRole("region", { name: /agent assistant/i })).toBeVisible()
  })
})
