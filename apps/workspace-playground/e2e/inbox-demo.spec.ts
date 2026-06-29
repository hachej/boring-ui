import { expect, test } from "@playwright/test"

test.describe("workspace-playground inbox demo", () => {
  test("mounts plugin-owned demo items in the app-left Inbox", async ({ page }) => {
    await page.goto("/?inboxDemo=1&fresh=1")

    await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await expect(page.getByRole("button", { name: "All 2" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Questions 1" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Reviews 1" })).toBeVisible()
    await expect(page.getByText("Pick the deploy target for the release smoke")).toBeVisible()
    await expect(page.getByText("Review Codex notes on workspace inbox flow")).toBeVisible()
  })
})
