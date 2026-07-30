import { expect, test } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKSPACE_ROOT = resolve(process.env.BORING_AGENT_WORKSPACE_ROOT || resolve(APP_DIR, "e2e/fixtures/workspace"))
const COMPANY_ROOT = resolve(process.env.BORING_WORKSPACE_PLAYGROUND_COMPANY_CONTEXT_ROOT || resolve(APP_DIR, "e2e/fixtures/company-context"))
const DUPLICATE_FILE = "duplicate-search.md"

test.beforeAll(async () => {
  await mkdir(WORKSPACE_ROOT, { recursive: true })
  await mkdir(COMPANY_ROOT, { recursive: true })
  await writeFile(resolve(WORKSPACE_ROOT, DUPLICATE_FILE), "# Workspace search result\n")
  await writeFile(resolve(COMPANY_ROOT, DUPLICATE_FILE), "# Company search result\n")
})

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

  let dialog = await openFilesSearch(page, "duplicate-search")
  const companyResult = dialog.getByRole("option", { name: /duplicate-search\.md.*company_context/i })
  const workspaceResult = dialog.getByRole("option", { name: /duplicate-search\.md.*Workspace/i })
  await expect(companyResult).toBeVisible()
  await expect(workspaceResult).toBeVisible()

  const companyRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === "/api/v1/files"
      && url.searchParams.get("path") === `/${DUPLICATE_FILE}`
      && url.searchParams.get("filesystem") === "company_context"
  })
  await companyResult.click()
  expect((await companyRead).status()).toBe(200)

  dialog = await openFilesSearch(page, "duplicate-search")
  const userRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === "/api/v1/files"
      && url.searchParams.get("path") === DUPLICATE_FILE
      && url.searchParams.get("filesystem") === null
  })
  await dialog.getByRole("option", { name: /duplicate-search\.md.*Workspace/i }).click()
  expect((await userRead).status()).toBe(200)

  await expect(page.getByRole("tab", { name: /duplicate-search\.md/ })).toHaveCount(2)
})
