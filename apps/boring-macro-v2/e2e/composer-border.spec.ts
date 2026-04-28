import { expect, test } from "@playwright/test"
import { bootClean } from "./helpers"

/**
 * Regression: the embedded composer used to be border-less at rest and
 * only showed an inset shadow on focus, which made it invisible until
 * clicked. Now there's an inset 1px border at rest using `var(--border)`,
 * swapping to an accent-tinted border on focus.
 *
 * The wrapper element doesn't have a stable test id, so we walk up the
 * DOM from the textarea and assert SOME ancestor has an inset shadow.
 */
async function getComposerShadow(page: import("@playwright/test").Page): Promise<string> {
  return await page.evaluate(() => {
    const ta = document.querySelector("textarea")
    if (!ta) return "no-textarea"
    let el: HTMLElement | null = ta as HTMLElement
    for (let i = 0; i < 10 && el; i++) {
      const s = getComputedStyle(el).boxShadow
      if (s && s.includes("inset")) return s
      el = el.parentElement
    }
    return "none"
  })
}

test("composer has visible inset border at rest", async ({ page }) => {
  await bootClean(page)
  // Click far from the composer so it has no focus.
  await page.mouse.click(50, 50)
  await page.waitForTimeout(300)
  const shadow = await getComposerShadow(page)
  expect(shadow).toMatch(/inset/)
})

test("composer focus state still applies", async ({ page }) => {
  await bootClean(page)
  await page.locator("textarea").first().click()
  await page.waitForTimeout(300)
  const shadow = await getComposerShadow(page)
  expect(shadow).toMatch(/inset/)
})
