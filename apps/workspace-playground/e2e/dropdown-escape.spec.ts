import { expect, test } from "@playwright/test"

/**
 * Regression test for #1391: dropdown menus (Radix DropdownMenu, e.g. the
 * left pane's session "Chat actions" kebab menu) did not close on Escape
 * in a real browser, even though jsdom unit tests passed.
 *
 * Root cause: ChatLayout registers a global, `document`-level,
 * capture-phase Escape shortcut ("focus chat") via useKeyboardShortcuts.
 * It mounts once at app-shell boot, before any dropdown opens, so its
 * `document.addEventListener("keydown", ..., true)` always fires first.
 * It called `event.preventDefault()` unconditionally, which set
 * `event.defaultPrevented = true` before Radix's own DismissableLayer
 * (also a `document`-level, capture-phase listener, but mounted later
 * when the menu opens) got to check that flag and decide whether to
 * dismiss — so the menu silently never closed.
 *
 * jsdom component tests for the dropdown alone can't catch this: they
 * never mount ChatLayout, so there's no competing global listener to
 * race against. Only a real browser run against the full app shell
 * reproduces it, which is why this lives in Playwright rather than a
 * unit test.
 */

test.describe("dropdown menus close on Escape", () => {
  test("the session kebab menu closes on Escape in the real app shell", async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto("/")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    await expect(composer).toBeVisible({ timeout: 30_000 })

    // Create a session so a "Chat actions" kebab menu exists to open.
    await page.keyboard.press("ControlOrMeta+KeyK")
    const palette = page.getByRole("dialog", { name: /command palette/i })
    await expect(palette).toBeVisible()
    await page.keyboard.type(">New Chat")
    await page.getByRole("option", { name: /New Chat/i }).first().click()
    await expect(palette).toBeHidden()
    await expect.poll(
      () => page.locator('[data-boring-workspace-part="app-session-row"]').count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(0)

    const sessionRow = page.locator('[data-boring-workspace-part="app-session-row"]').first()
    await sessionRow.hover()
    const chatActionsPattern = new RegExp("^Chat actions for ")
    const kebab = sessionRow.getByRole("button", { name: chatActionsPattern })
    await kebab.click()

    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible({ timeout: 5_000 })

    await page.keyboard.press("Escape")

    await expect(menu).toBeHidden({ timeout: 2_000 })
  })
})
