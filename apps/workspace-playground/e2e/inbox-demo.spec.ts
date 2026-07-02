import { expect, test } from "@playwright/test"

test.describe("workspace-playground inbox demo", () => {
  test("mounts plugin-owned demo items in the app-left Inbox", async ({ page }) => {
    await page.goto("/?inboxDemo=1&fresh=1")

    const inboxButton = page.getByRole("button", { name: /Inbox 2 inbox items/ })
    await expect(inboxButton).toBeVisible({ timeout: 15_000 })
    if (!(await page.getByRole("heading", { name: "Inbox" }).isVisible())) await inboxButton.click()
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    const inboxOverlay = page.locator('[data-boring-workspace-part="inbox-overlay"]')
    await expect(inboxOverlay.getByRole("button", { name: "All 2" })).toBeVisible()
    await expect(inboxOverlay.getByRole("button", { name: "Questions 1" })).toBeVisible()
    await expect(inboxOverlay.getByRole("button", { name: "Reviews 1" })).toBeVisible()
    await expect(inboxOverlay.getByText("Pick the deploy target for the release smoke")).toBeVisible()
    await expect(inboxOverlay.getByText("Review Codex notes on workspace inbox flow")).toBeVisible()

    await expect(inboxOverlay.getByText("No artifacts attached")).toHaveCount(0)
    const firstInboxRow = inboxOverlay.getByRole("button", { name: /Pick the deploy target for the release smoke/ }).first()
    const firstInboxRowBox = await firstInboxRow.boundingBox()
    expect(firstInboxRowBox?.height).toBeLessThanOrEqual(48)
  })

  test("opens a read-only detached chat and preserves its dragged position across app-nav collapse", async ({ page }) => {
    await page.goto("/?inboxDemo=1&fresh=1")

    const inboxButton = page.getByRole("button", { name: /Inbox 2 inbox items/ })
    await expect(inboxButton).toBeVisible({ timeout: 15_000 })
    if (!(await page.getByRole("heading", { name: "Inbox" }).isVisible())) await inboxButton.click()

    const inboxOverlay = page.locator('[data-boring-workspace-part="inbox-overlay"]')
    const inboxRow = inboxOverlay.getByRole("button", { name: /Pick the deploy target for the release smoke/ }).first()
    await expect(inboxRow).toBeVisible({ timeout: 15_000 })
    await inboxRow.hover()
    await inboxOverlay.getByRole("button", { name: "Open chat session showcase", exact: true }).click()

    const popover = page.locator('[data-boring-workspace-part="detached-panel-popover"]')
    await expect(popover).toBeVisible()
    await expect(popover.getByText("Detached chat · dock to reply")).toBeVisible()
    await expect(popover.getByText("Dock this chat to reply.")).toBeVisible()

    const beforeDrag = await popover.boundingBox()
    expect(beforeDrag).not.toBeNull()
    await page.mouse.move(beforeDrag!.x + 180, beforeDrag!.y + 20)
    await page.mouse.down()
    await page.mouse.move(beforeDrag!.x + 260, beforeDrag!.y + 80)
    await page.mouse.up()

    const afterDrag = await popover.boundingBox()
    expect(afterDrag).not.toBeNull()
    expect(Math.abs(afterDrag!.x - beforeDrag!.x)).toBeGreaterThan(40)

    await page.getByRole("button", { name: "Hide app navigation" }).click()
    await expect(page.getByRole("button", { name: "Open app navigation" })).toBeVisible()

    const afterCollapse = await popover.boundingBox()
    expect(afterCollapse).not.toBeNull()
    expect(Math.abs(afterCollapse!.x - afterDrag!.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(afterCollapse!.y - afterDrag!.y)).toBeLessThanOrEqual(2)
  })
})
