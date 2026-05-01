import { expect, test } from "@playwright/test"

/**
 * Regression: user reported "I have the feeling commands are not
 * working". Root cause was that the chat shell only saw workbench
 * commands such as Toggle Sidebar / Toggle Agent Panel / Close Tab.
 * Those target the dockview store, so triggering them from the
 * centered chat route produced no visible effect.
 *
 * Fix surfaced shell-specific commands (Toggle Sessions Drawer,
 * Toggle Workbench, New Chat) in the ⌘K palette. These tests check
 * that selecting them actually toggles the corresponding pane.
 */

const STORAGE_KEY = "boring-ui-v2:chat-centered-shell:v2"

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
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("dialog", { name: /command palette/i }),
  ).toBeHidden({ timeout: 2_000 })
}

async function paneWidth(
  page: import("@playwright/test").Page,
  ariaLabel: string,
) {
  return page.evaluate(
    (label) =>
      document
        .querySelector(`aside[aria-label="${label}"]`)
        ?.getBoundingClientRect().width ?? 0,
    ariaLabel,
  )
}

test.describe("command palette effects", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    // Reset open state so each test starts from collapsed.
    await page.evaluate((prefix) => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(prefix)) localStorage.removeItem(k)
      }
    }, STORAGE_KEY)
    await page.reload()
    await page.waitForLoadState("networkidle")
  })

  test("'Toggle Sessions Drawer' opens the closed drawer", async ({ page }) => {
    expect(await paneWidth(page, "Session browser")).toBe(0)
    await runCommandFromPalette(page, "Toggle Sessions")
    expect(await paneWidth(page, "Session browser")).toBeGreaterThan(0)
  })

  test("'Toggle Workbench' opens the closed workbench", async ({ page }) => {
    expect(await paneWidth(page, "Surface")).toBe(0)
    await runCommandFromPalette(page, "Toggle Workbench")
    expect(await paneWidth(page, "Surface")).toBeGreaterThan(0)
  })

  test("running the command twice toggles the pane closed again", async ({
    page,
  }) => {
    await runCommandFromPalette(page, "Toggle Sessions")
    expect(await paneWidth(page, "Session browser")).toBeGreaterThan(0)
    await runCommandFromPalette(page, "Toggle Sessions")
    // The pane has a 280ms width transition — poll instead of asserting
    // immediately, so we don't catch it mid-collapse.
    await expect
      .poll(() => paneWidth(page, "Session browser"), { timeout: 2_000 })
      .toBe(0)
  })
})
