import { expect, test } from "@playwright/test"

test.describe("workspace-playground inbox", () => {
  test("mounts the canonical Inbox shell without seeded fake demo rows", async ({ page }) => {
    await page.goto("/?fresh=1")

    const inboxButton = page.getByRole("button", { name: /Inbox/ })
    await expect(inboxButton).toBeVisible({ timeout: 15_000 })

    await inboxButton.click()
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await expect(page.getByText("Pick the deploy target for the release smoke")).toHaveCount(0)
    await expect(page.getByText("Review Codex notes on workspace inbox flow")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Inbox demo chat" })).toHaveCount(0)
  })
})
