import { expect, test, type Page, type Request } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKSPACE_ROOT = resolve(process.env.BORING_AGENT_WORKSPACE_ROOT || resolve(APP_DIR, "e2e/fixtures/workspace"))
const COMPANY_CONTEXT_ROOT = resolve(process.env.BORING_WORKSPACE_PLAYGROUND_COMPANY_CONTEXT_ROOT || resolve(APP_DIR, "e2e/fixtures/company-context"))
const WORKSPACE_FILE = "workspace-root-test.md"
const COMPANY_FILE = "company-root-test.md"
const WORKSPACE_CONTENT = "Workspace source content 996"
const COMPANY_CONTENT = "Company source content 996"

test.beforeAll(async () => {
  await mkdir(WORKSPACE_ROOT, { recursive: true })
  await mkdir(COMPANY_CONTEXT_ROOT, { recursive: true })
  await writeFile(resolve(WORKSPACE_ROOT, WORKSPACE_FILE), `# ${WORKSPACE_CONTENT}\n`)
  await writeFile(resolve(COMPANY_CONTEXT_ROOT, COMPANY_FILE), `# ${COMPANY_CONTENT}\n`)
})

async function selectRoot(page: Page, label: string) {
  const rootSelector = page.getByRole("combobox", { name: "File root" })
  await rootSelector.click()
  await page.getByRole("option", { name: label }).click()
  await expect(rootSelector).toContainText(label)
}

function isFileRead(request: Request, path: string, filesystem: string): boolean {
  const url = new URL(request.url())
  return request.method() === "GET"
    && url.pathname === "/api/v1/files"
    && (url.searchParams.get("path") ?? "").replace(/^\/+/, "") === path
    && (url.searchParams.get("filesystem") ?? "user") === filesystem
}

async function openAndAssertFile(
  page: Page,
  options: { path: string; filesystem: string; content: string },
) {
  const read = page.waitForRequest((request) => isFileRead(request, options.path, options.filesystem))
  await page.getByText(options.path, { exact: true }).first().click()
  await read
  await expect(page.getByRole("tab", { name: new RegExp(options.path) })).toBeVisible()
  await expect(page.getByText(options.content, { exact: false }).first()).toBeVisible()
}

test("opening files preserves the selected Workspace and Company roots", async ({ page }) => {
  await page.goto("/?fresh=1&multiFilesystem=1")
  await page.getByRole("button", { name: "Open workbench" }).click()
  await page.getByRole("button", { name: "Files", exact: true }).click()

  const rootSelector = page.getByRole("combobox", { name: "File root" })
  await expect(rootSelector).toBeVisible({ timeout: 20_000 })
  await expect(rootSelector).toContainText("Workspace")

  await openAndAssertFile(page, {
    path: WORKSPACE_FILE,
    filesystem: "user",
    content: WORKSPACE_CONTENT,
  })
  await expect(rootSelector).toContainText("Workspace")

  await selectRoot(page, "Company")
  await openAndAssertFile(page, {
    path: COMPANY_FILE,
    filesystem: "company_context",
    content: COMPANY_CONTENT,
  })
  await expect(rootSelector).toContainText("Company")
})
