import { test, expect, type Page } from "@playwright/test"

async function openStory(
  page: Page,
  storyId: string,
  options?: { dark?: boolean },
) {
  const globals = options?.dark ? "&globals=theme:dark" : ""
  await page.goto(`/iframe.html?id=${storyId}${globals}`, {
    waitUntil: "domcontentloaded",
  })
  await page.waitForSelector("#storybook-root > *", { state: "visible" })
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })
  })
}

test.describe("storybook visual baseline", () => {
  const snapshotOptions = {
    animations: "disabled" as const,
    caret: "hide" as const,
  }

  test("workspace desktop stories", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    await openStory(page, "workspace-filetree--files-100")
    await expect(page.locator("#storybook-root")).toHaveScreenshot("workspace-filetree-desktop.png", snapshotOptions)

    await openStory(page, "workspace-codeeditor--java-script")
    await expect(page.locator("#storybook-root")).toHaveScreenshot("workspace-codeeditor-desktop.png", snapshotOptions)

    await openStory(page, "workspace-markdowneditor--rich-content")
    await expect(page.locator("#storybook-root")).toHaveScreenshot("workspace-markdown-desktop.png", snapshotOptions)
  })

  test("workspace dark-mode stories", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    await openStory(page, "workspace-dock-groupchrome--locked-and-collapsible", { dark: true })
    await expect(page.locator("#storybook-root")).toHaveScreenshot("workspace-dock-group-dark.png", snapshotOptions)
  })

  test("mobile overlay story", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await openStory(page, "workspace-panes--file-tree-pane")
    await expect(page.locator("#storybook-root")).toHaveScreenshot("workspace-file-tree-mobile.png", snapshotOptions)
  })

  // Note: the legacy ChatPanel visual stories were removed alongside the
  // pi-native chat rewrite that deleted src/front/ChatPanel.tsx. The new
  // PiChatPanel surface is covered by unit + e2e suites; a stable visual
  // baseline for it should be regenerated in the CI environment.
})
