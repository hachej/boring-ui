import { expect, test } from "@playwright/test"

/**
 * #1451: opening a file (editor tab) put the workbench at its persisted
 * default width (680px). On a medium desktop viewport that left too little
 * room for the chat column once the Tasks overlay forced it back open —
 * ChatLayout deliberately skips its narrow-viewport chat-auto-collapse
 * whenever a chat overlay is active, so the overlay's flex wrapper was the
 * thing left computing to ~0 width instead. See ChatLayout.tsx's
 * `chatOverlayReserve` / measured `rowWidth`.
 */
test.describe("Tasks panel width with editor tabs open", () => {
  test.use({ viewport: { width: 1024, height: 800 } })

  test("Tasks overlay stays visible and non-zero width after opening a file", async ({ page }) => {
    await page.goto("/?fresh=1")

    const filesButton = page.locator('[aria-label="Files"]').first()
    await expect(filesButton).toBeVisible({ timeout: 15_000 })
    await filesButton.click()

    await page.getByText("README.md", { exact: true }).first().click()
    await expect(page.getByRole("tab", { name: /README\.md/ })).toBeVisible({ timeout: 10_000 })

    await page.getByRole("button", { name: "Tasks" }).click()

    const overlay = page.locator('[data-boring-workspace-part="tasks-overlay"]')
    await expect(overlay).toBeVisible()

    const box = await overlay.boundingBox()
    expect(box).not.toBeNull()
    // Pre-fix this collapsed to ~63px — effectively invisible/unusable. The
    // fix reserves a real minimum for the chat column whenever it must host
    // an overlay, so the board stays legible.
    expect(box!.width).toBeGreaterThan(200)
    expect(box!.height).toBeGreaterThan(200)

    await expect(page.getByText("Tasks", { exact: true }).first()).toBeVisible()
  })
})
