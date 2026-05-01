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

  test("renders the main-style workbench with sources inside the surface", async ({ page }) => {
    await expect(page.getByRole("banner", { name: /app top bar/i })).toContainText("Boring")
    await expect(page.getByRole("navigation", { name: /session history/i })).toBeVisible()
    await expect(page.getByRole("region", { name: /agent assistant/i })).toBeVisible()
    await expect(page.getByTestId("surface-shell")).toBeVisible()
    await expect(page.getByRole("tablist", { name: /workbench sources/i }).first()).toBeVisible()
    await expect(page.getByText("artifact-surface").first()).toBeHidden()
  })

  test("sessions close button collapses the drawer and floating button reopens it", async ({ page }) => {
    await page.getByRole("button", { name: /close sessions/i }).click()
    await expect(page.getByRole("navigation", { name: /session history/i })).toBeHidden()
    await expect(page.getByRole("button", { name: /^sessions$/i })).toBeVisible()
    await page.getByRole("button", { name: /^sessions$/i }).click()
    await expect(page.getByRole("navigation", { name: /session history/i })).toBeVisible()
  })

  test("workbench close button collapses the surface and floating button reopens it", async ({ page }) => {
    await page.getByRole("button", { name: /close workbench/i }).click()
    await expect(page.getByTestId("surface-shell")).toBeHidden()
    await expect(page.getByRole("button", { name: /^workbench$/i })).toBeVisible()
    await page.getByRole("button", { name: /^workbench$/i }).click()
    await expect(page.getByTestId("surface-shell")).toBeVisible()
  })

  test("session clicks remount chat with the selected session id", async ({ page }) => {
    await page.getByText("Plan review").click()
    await expect(page.getByRole("banner", { name: /app top bar/i })).toContainText("Plan review")
    await expect(page.getByRole("region", { name: /agent assistant/i })).toBeVisible()
  })
})
