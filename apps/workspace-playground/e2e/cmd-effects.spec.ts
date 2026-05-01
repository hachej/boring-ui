import { expect, test } from "@playwright/test"

/**
 * Regression: user reported "I have the feeling commands are not
 * working". The playground now uses WorkspaceProvider + ChatLayout, so
 * the canary checks the provider-owned palette against the declarative
 * dockview shell instead of centered-shell-specific commands.
 */

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
    await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible()
  })

  test("top-bar Search opens the provider command palette", async ({ page }) => {
    await page.getByRole("button", { name: /search catalogs and commands/i }).click()
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 5_000 })
  })

  test("chat command can be selected from the palette", async ({ page }) => {
    const sessions = page
      .getByRole("navigation", { name: /session history/i })
      .getByRole("listitem")
    const before = await sessions.count()
    await runCommandFromPalette(page, "New Chat")
    await expect(sessions).toHaveCount(before + 1)
  })

  test("Focus Chat closes sessions and workbench panes", async ({ page }) => {
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

  test("session selection updates the TopBar through ChatLayout params", async ({ page }) => {
    await page.getByText("Plan review").click()
    await expect(page.getByRole("banner", { name: /app top bar/i })).toContainText("Plan review")
  })
})
