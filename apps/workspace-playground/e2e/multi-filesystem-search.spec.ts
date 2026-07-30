import { expect, test } from "@playwright/test"

async function openFilesSearch(page: import("@playwright/test").Page, query: string) {
  await page.keyboard.press("ControlOrMeta+KeyK")
  const dialog = page.getByRole("dialog", { name: /command palette/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Sources" }).click()
  await dialog.getByRole("combobox").fill(query)
  return dialog
}

test("global Files search opens duplicate paths in both readable roots", async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto("/?fresh=1")
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible({ timeout: 25_000 })

  let dialog = await openFilesSearch(page, "README")
  const companyResult = dialog.getByRole("option", { name: /README\.md.*company_context/i })
  const workspaceResult = dialog.getByRole("option", { name: /README\.md.*Workspace/i })
  await expect(companyResult).toBeVisible()
  await expect(workspaceResult).toBeVisible()

  const companyRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === "/api/v1/files"
      && url.searchParams.get("path") === "/README.md"
      && url.searchParams.get("filesystem") === "company_context"
  })
  await companyResult.click()
  expect((await companyRead).status()).toBe(200)

  dialog = await openFilesSearch(page, "README")
  const userRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === "/api/v1/files"
      && url.searchParams.get("path") === "README.md"
      && url.searchParams.get("filesystem") === null
  })
  await dialog.getByRole("option", { name: /README\.md.*Workspace/i }).click()
  expect((await userRead).status()).toBe(200)

  await expect(page.getByRole("tab", { name: /README\.md/ })).toHaveCount(2)
})
