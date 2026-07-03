import { expect, test } from "@playwright/test"

/**
 * Plugin-tabs shell resize/collapse persistence. The left app navigation is the
 * persistent shell pane in this mode; classic session/workbench resize handles
 * are covered by package tests for the classic layout.
 */

const STORAGE_PREFIX = "boring-ui-v2:layout:playground"

async function resetPlaygroundStorage(page: import("@playwright/test").Page) {
  await page.evaluate((prefix) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) localStorage.removeItem(k)
    }
  }, STORAGE_PREFIX)
}

async function appNavWidth(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    document.querySelector('aside[aria-label="App navigation"]')?.getBoundingClientRect().width ?? null,
  )
}

async function dragHandle(
  page: import("@playwright/test").Page,
  ariaLabel: string,
  deltaX: number,
) {
  const handle = page.locator(`[aria-label="${ariaLabel}"]`)
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`no bounding box for handle ${ariaLabel}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

test.describe("workspace shell resize", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await resetPlaygroundStorage(page)
    await page.reload()
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
  })

  test("app navigation collapsed state persists across reloads", async ({ page }) => {
    await page.getByRole("button", { name: "Hide app navigation" }).click()
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeHidden({ timeout: 2_000 })
    await page.reload()
    await expect(page.getByRole("button", { name: "Open app navigation" })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeHidden()
  })

  test("dragging the app navigation handle resizes the left pane", async ({ page }) => {
    const before = await appNavWidth(page)
    expect(before).not.toBeNull()
    await dragHandle(page, "Resize app navigation", 80)
    const after = await appNavWidth(page)
    expect(after).not.toBeNull()
    expect(after! - before!).toBeGreaterThan(50)
    expect(after! - before!).toBeLessThan(110)
  })

  test("app navigation width persists across reloads", async ({ page }) => {
    await dragHandle(page, "Resize app navigation", 70)
    const widthAfterDrag = await appNavWidth(page)
    expect(widthAfterDrag).not.toBeNull()

    await expect
      .poll(
        () => page.evaluate((prefix) => {
          const key = Object.keys(localStorage).find((k) => k.startsWith(prefix) && k.endsWith(":appLeftPaneWidth"))
          return key ? Number(localStorage.getItem(key)) : 0
        }, STORAGE_PREFIX),
        { timeout: 2_000 },
      )
      .toBe(Math.round(widthAfterDrag!))

    await page.reload()
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    const widthAfterReload = await appNavWidth(page)
    expect(Math.abs(widthAfterReload! - widthAfterDrag!)).toBeLessThan(2)
  })
})
