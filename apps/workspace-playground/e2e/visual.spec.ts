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
  await page.waitForLoadState("networkidle")
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

    // Count elements with a non-zero border-bottom-width inside the
    // dialog content, ABOVE the result list. A "double border" bug
    // reappears as 2+ — assert exactly 1.
    const borderCount = await page.evaluate(() => {
      const content = document.querySelector('[data-slot="dialog-content"]')
      if (!content) return -1
      const list = content.querySelector('[cmdk-list]')
      if (!list) return -1
      // Walk every element in the dialog that comes BEFORE the list
      // and check its computed border-bottom-width.
      const range = document.createRange()
      range.setStartBefore(content)
      range.setEndBefore(list)
      const all = Array.from(content.querySelectorAll("*")).filter((el) =>
        range.intersectsNode(el) && !list.contains(el) && !el.contains(list),
      )
      return all.filter((el) => {
        const cs = getComputedStyle(el)
        const w = parseFloat(cs.borderBottomWidth)
        return w > 0 && cs.borderBottomStyle !== "none"
      }).length
    })

    expect(borderCount).toBe(1)
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

  test("> prefix surfaces the 'Command' mode pill", async ({ page }) => {
    await openPalette(page)
    // Pill not present yet
    await expect(page.getByText("Command", { exact: true })).toHaveCount(0)
    await page.keyboard.type(">")
    await expect(page.getByText("Command", { exact: true })).toBeVisible()
  })
})

test.describe("ChatLayout visual chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
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
