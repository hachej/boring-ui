import { expect, test } from "@playwright/test"

/**
 * Verifies the palette dismisses on a single mouse click outside the
 * dialog. User reported "I need to click 2 times" — could mean Escape
 * key or click-outside. Escape is covered by cmd-palette.spec.ts;
 * this covers the click-outside path.
 */

test.describe("command palette click-outside", () => {
  test("clicking the overlay closes the dialog on the first click", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await page.keyboard.press("ControlOrMeta+KeyP")
    const dialog = page.getByRole("dialog", { name: /command palette/i })
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Click the Radix overlay backdrop (the semi-transparent layer Radix
    // mounts behind DialogContent). This is what users see when they
    // click "outside" the modal.
    const overlay = page.locator('[data-slot="dialog-overlay"]').first()
    await overlay.click({ position: { x: 5, y: 5 }, force: true })
    await expect(dialog).toBeHidden({ timeout: 2_000 })
  })

  test("clicking the overlay dismisses even with text in the input", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await page.keyboard.press("ControlOrMeta+KeyP")
    const dialog = page.getByRole("dialog", { name: /command palette/i })
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    await page.keyboard.type("test")
    const overlay = page.locator('[data-slot="dialog-overlay"]').first()
    await overlay.click({ position: { x: 5, y: 5 }, force: true })
    await expect(dialog).toBeHidden({ timeout: 2_000 })
  })
})
