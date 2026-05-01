import { expect, test } from "@playwright/test"

/**
 * Targeted visual / DOM-shape regression tests for fixes that were
 * verified by manual probe but had no automated coverage. These are
 * NOT screenshot tests (notoriously flaky with font-shift) — they
 * assert specific DOM properties / computed CSS values that map 1:1
 * to the user-visible bug they catch.
 */

async function openPalette(page: import("@playwright/test").Page) {
  await page.goto("/")
  await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+KeyK")
  await expect(
    page.getByRole("dialog", { name: /command palette/i }),
  ).toBeVisible({ timeout: 5_000 })
}

test.describe("command palette visual chrome", () => {
  test("input row has exactly ONE bottom border (no double-line)", async ({
    page,
  }) => {
    await openPalette(page)

    // The input wrapper owns the single divider below the search row.
    // The surrounding row must not add a second full-width border.
    const inputChrome = await page.evaluate(() => {
      const content = document.querySelector('[data-slot="dialog-content"]')
      const wrapper = content?.querySelector('[data-slot="command-input-wrapper"]')
      const row = wrapper?.parentElement
      if (!wrapper || !row) return null
      const wrapperStyle = getComputedStyle(wrapper)
      const rowStyle = getComputedStyle(row)
      return {
        wrapperBorderBottom: parseFloat(wrapperStyle.borderBottomWidth),
        rowBorderBottom: parseFloat(rowStyle.borderBottomWidth),
      }
    })

    expect(inputChrome).toEqual({
      wrapperBorderBottom: 1,
      rowBorderBottom: 0,
    })
  })

  test("dialog is widened to the design's 640px max", async ({ page }) => {
    await openPalette(page)
    const maxWidth = await page.evaluate(() => {
      const content = document.querySelector('[data-slot="dialog-content"]')
      if (!content) return null
      return getComputedStyle(content).maxWidth
    })
    // sm:max-w-[640px] applies above 640px viewport (Playwright's
    // default 1280×720). Tolerate slight Tailwind translation to "px".
    expect(maxWidth).toMatch(/640/)
  })

  test("footer keyboard hints are present", async ({ page }) => {
    await openPalette(page)
    // The footer hint strip — ↑↓ navigate · ↵ open · esc close
    await expect(page.getByText(/navigate/i)).toBeVisible()
    await expect(page.getByText(/open/i).last()).toBeVisible()
    await expect(page.getByText(/close/i).last()).toBeVisible()
  })

  test("> prefix switches to command mode", async ({ page }) => {
    await openPalette(page)
    await expect(page.getByRole("button", { name: "Commands" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await page.keyboard.type(">")
    await expect(page.getByRole("button", { name: "Commands" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(page.getByPlaceholder("Run a command...")).toBeVisible()
  })
})

test.describe("ChatLayout visual chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible()
  })

  test("brand accent is available to declarative chrome", async ({ page }) => {
    const accent = await page.evaluate(() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(
        "--accent",
      )
      return v.trim()
    })
    expect(accent).toBeTruthy()
    await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible()
    await expect(page.locator(".dv-shell").first()).toBeVisible()
  })
})
