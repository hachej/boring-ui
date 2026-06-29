import { expect, test } from "@playwright/test"

/**
 * Plugin-tabs shell command palette smoke tests. The playground now boots the
 * app-left shell, so command effects should be asserted against the app nav and
 * chat stage rather than the old classic top-bar/session-drawer chrome.
 */

const STORAGE_PREFIX = "boring-ui-v2:layout:playground"

async function waitForPluginTabsShell(page: import("@playwright/test").Page) {
  await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 10_000 })
}

async function runCommandFromPalette(
  page: import("@playwright/test").Page,
  query: string,
) {
  await page.keyboard.press("ControlOrMeta+KeyK")
  await expect(
    page.getByRole("dialog", { name: /command palette/i }),
  ).toBeVisible({ timeout: 5_000 })
  await page.keyboard.type(`>${query}`)
  await page.waitForTimeout(200) // cmdk filter
  await page.getByRole("option", { name: new RegExp(query, "i") }).first().click()
  await expect(
    page.getByRole("dialog", { name: /command palette/i }),
  ).toBeHidden({ timeout: 2_000 })
}

async function resetPlaygroundStorage(page: import("@playwright/test").Page) {
  await page.evaluate((prefix) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) localStorage.removeItem(k)
    }
  }, STORAGE_PREFIX)
}

test.describe("command palette effects", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await resetPlaygroundStorage(page)
    await page.reload()
    await waitForPluginTabsShell(page)
  })

  test("app-left Search opens the provider command palette", async ({ page }) => {
    await page.locator('aside[aria-label="App navigation"]').getByRole("button", { name: /^search$/i }).click()
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 5_000 })
  })

  test("New Chat command keeps the composer ready", async ({ page }) => {
    await runCommandFromPalette(page, "New Chat")
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 5_000 })
  })

  test("Focus Chat returns focus to the composer", async ({ page }) => {
    await page.locator('aside[aria-label="App navigation"]').getByRole("button", { name: /^search$/i }).focus()
    await runCommandFromPalette(page, "Focus Chat")
    await expect(page.locator('[data-boring-agent] textarea[name="message"]')).toBeFocused({ timeout: 2_000 })
  })
})
