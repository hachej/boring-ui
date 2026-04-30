import { expect, type Page } from "@playwright/test"

export async function waitForPlaygroundReady(page: Page) {
  await expect(
    page.getByRole("button", { name: /search, commands, or files/i }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByRole("main", { name: /chat stage/i }),
  ).toBeVisible({ timeout: 10_000 })
}
