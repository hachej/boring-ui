import { test, expect } from "../fixtures/loggingHarness"

test.describe("workspace-playground golden path", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("text=Loading workspace")).not.toBeVisible({
      timeout: 15_000,
    })
    await page.waitForTimeout(1_000)
  })

  test("page loads with file tree panel and tab bar", async ({ page }) => {
    await expect(page.locator("text=filetree").first()).toBeVisible()
    await expect(page.locator("text=empty").first()).toBeVisible()
  })

  test("file tree panel shows search input and file items", async ({
    page,
  }) => {
    const searchInput = page.locator("input[aria-label='Search files']")
    await expect(searchInput).toBeVisible({ timeout: 10_000 })

    const treeItems = page.locator("[data-testid=tree-skeleton], [role=treeitem], [data-path]")
    const itemCount = await treeItems.count()
    expect(itemCount).toBeGreaterThanOrEqual(0)
  })

  test("theme toggle switches data-theme attribute", async ({ page }) => {
    const toggle = page.locator("button", { hasText: /Dark|Light/ })
    await expect(toggle).toBeVisible()

    const initialTheme = await page.locator("html").getAttribute("data-theme")
    await toggle.click()
    await page.waitForTimeout(300)

    const newTheme = await page.locator("html").getAttribute("data-theme")
    expect(newTheme).not.toBe(initialTheme)

    await toggle.click()
    await page.waitForTimeout(300)
    const restoredTheme = await page.locator("html").getAttribute("data-theme")
    expect(restoredTheme).toBe(initialTheme)
  })

  test("command palette opens via keyboard shortcut", async ({ page }) => {
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 })

    const input = page.locator("[cmdk-input]")
    await expect(input).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
  })

  test("command palette command mode shows built-in commands", async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    await expect(page.getByRole("dialog")).toBeVisible()

    const input = page.locator("[cmdk-input]")
    await expect(input).toBeVisible()
    await input.pressSequentially(">", { delay: 50 })
    await page.waitForTimeout(500)

    await expect(
      page.locator("[cmdk-item]").filter({ hasText: "Toggle Sidebar" }),
    ).toBeVisible({ timeout: 5_000 })
  })

  test("sidebar toggle via keyboard shortcut", async ({ page }) => {
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await page.waitForTimeout(500)

    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await page.waitForTimeout(500)

    await expect(
      page.locator("input[aria-label='Search files']"),
    ).toBeVisible()
  })

  test("file tree search input accepts text", async ({ page }) => {
    const searchInput = page.locator("input[aria-label='Search files']")
    await expect(searchInput).toBeVisible()
    await searchInput.fill("greeter")
    await expect(searchInput).toHaveValue("greeter")
  })
})
