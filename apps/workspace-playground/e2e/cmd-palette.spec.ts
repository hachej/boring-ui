import { expect, test } from "@playwright/test"

/**
 * Regression test for the "Escape needs two presses to close the
 * command palette" bug. Root cause: cmdk's CommandInput consumes the
 * first Escape to clear the input value before bubbling to Radix
 * Dialog's onEscapeKeyDown. Fixed in CommandPalette.tsx by attaching
 * our own onKeyDown handler that closes on the first Escape regardless
 * of input content.
 */

test.describe("command palette", () => {
  test("Escape closes the palette on the first press", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })

    // Open the palette via the keyboard shortcut. The shell binds Cmd+P
    // / Ctrl+P globally.
    await page.keyboard.press("ControlOrMeta+KeyK")
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 5_000 })

    // Type something so the cmdk input has a value (this is the path
    // that historically triggered the double-Escape bug).
    await page.keyboard.type("test")

    // Single Escape should close the dialog. Previously the first
    // Escape only cleared the cmdk input.
    await page.keyboard.press("Escape")

    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeHidden({ timeout: 2_000 })
  })

  test("Escape closes even with an empty input", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })

    await page.keyboard.press("ControlOrMeta+KeyK")
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press("Escape")
    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeHidden({ timeout: 2_000 })
  })

  test("only ONE palette dialog mounts (no double-layer)", async ({ page }) => {
    // Regression for "double layer cmd pane": app composition and the
    // chat shell both mounted <CommandPalette />, creating two stacked
    // dialogs and two ⌘K listeners.
    await page.goto("/")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("ControlOrMeta+KeyK")

    const dialogs = page.getByRole("dialog", { name: /command palette/i })
    await expect(dialogs.first()).toBeVisible({ timeout: 5_000 })
    expect(await dialogs.count()).toBe(1)
  })
})
