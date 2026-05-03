import { expect, test } from "@playwright/test"

/**
 * Regression: user reported "I have the feeling commands are not
 * working". Root cause was that the chat shell only saw workbench
 * commands such as Toggle Sidebar / Toggle Agent Panel / Close Tab.
 * Those target the dockview store, so triggering them from the
 * centered chat route produced no visible effect.
 *
 * Fix surfaced shell-specific commands (Open/Close Session History,
 * Open/Close Workbench, New Chat) in the ⌘K palette. These tests
 * check that selecting them actually changes the corresponding pane.
 */

const STORAGE_KEY = "boring-ui-v2:layout:playground"

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

async function openSessionsDrawer(page: import("@playwright/test").Page) {
  const sessionsButton = page.getByRole("button", { name: /^sessions$/i })
  if (await sessionsButton.isVisible().catch(() => false)) {
    await sessionsButton.click()
    await page.waitForTimeout(400)
  }
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
    // Reset persisted layout/session state so each test starts from collapsed.
    await page.evaluate((prefix) => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(prefix)) localStorage.removeItem(k)
      }
      localStorage.setItem(`${prefix}:drawer`, "0")
      localStorage.setItem(`${prefix}:surface`, "0")
    }, STORAGE_KEY)
    await page.reload()
    await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible({ timeout: 10_000 })
  })

  test("top-bar Search opens the provider command palette", async ({ page }) => {
    await page.getByRole("button", { name: /search catalogs and commands/i }).click()
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 5_000 })
  })

  test("chat command can be selected from the palette", async ({ page }) => {
    await openSessionsDrawer(page)
    const sessions = page
      .getByRole("navigation", { name: /session history/i })
      .getByRole("listitem")
    const before = await sessions.count()
    await runCommandFromPalette(page, "New Chat")
    await expect(sessions).toHaveCount(before + 1)
  })


  test("'Open Session History' opens the closed drawer", async ({ page }) => {
    expect(await paneWidth(page, "Session browser")).toBe(0)
    await runCommandFromPalette(page, "Open Session History")
    expect(await paneWidth(page, "Session browser")).toBeGreaterThan(0)
  })

  test("'Open Workbench' opens the closed workbench", async ({ page }) => {
    expect(await paneWidth(page, "Surface")).toBe(0)
    await runCommandFromPalette(page, "Open Workbench")
    expect(await paneWidth(page, "Surface")).toBeGreaterThan(0)
  })

  test("running the session command twice toggles the pane closed again", async ({
    page,
  }) => {
    await runCommandFromPalette(page, "Open Session History")
    expect(await paneWidth(page, "Session browser")).toBeGreaterThan(0)
    await runCommandFromPalette(page, "Close Session History")
    // The pane has a 280ms width transition — poll instead of asserting
    // immediately, so we don't catch it mid-collapse.
    await expect
      .poll(() => paneWidth(page, "Session browser"), { timeout: 2_000 })
      .toBe(0)
  })

  test("Focus Chat closes sessions and workbench panes", async ({ page }) => {
    await runCommandFromPalette(page, "Open Session History")
    await runCommandFromPalette(page, "Open Workbench")
    expect(await paneWidth(page, "Session browser")).toBeGreaterThan(0)
    expect(await paneWidth(page, "Surface")).toBeGreaterThan(0)

    await runCommandFromPalette(page, "Focus Chat")

    await expect
      .poll(() => paneWidth(page, "Session browser"), { timeout: 2_000 })
      .toBe(0)
    await expect
      .poll(() => paneWidth(page, "Surface"), { timeout: 2_000 })
      .toBe(0)
    await expect(page.locator('[data-boring-agent] textarea[name="message"]')).toBeFocused({
      timeout: 2_000,
    })
  })
})
