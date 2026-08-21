import { expect, test } from "@playwright/test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const APP_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = resolve(
  process.env.BORING_AGENT_WORKSPACE_ROOT || resolve(APP_DIR, "fixtures/workspace"),
)
const TEST_DIR = resolve(WORKSPACE_ROOT, ".e2e-tmp/markdown-external-edit")
const RELATIVE_PATH = ".e2e-tmp/markdown-external-edit/open-agent-edit.md"
const ABSOLUTE_PATH = resolve(WORKSPACE_ROOT, RELATIVE_PATH)
const WATCH_CAP = Number(process.env.BORING_MAX_WATCHED_ENTRIES)
const HAS_EXPLICIT_WATCH_CAP = Number.isFinite(WATCH_CAP) && WATCH_CAP > 0

test.describe.configure({ timeout: 90_000 })

async function prepareFixture(forceOversized: boolean): Promise<void> {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(ABSOLUTE_PATH, "# External edit proof\n\nBefore agent edit.\n", "utf8")
  if (forceOversized) {
    const fillers = Array.from({ length: 20 }, (_, index) =>
      writeFile(resolve(TEST_DIR, `watch-cap-${index}.txt`), String(index), "utf8"),
    )
    await Promise.all(fillers)
  }
}

async function openProofDocument(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 20_000 })
  // Let the workspace command-stream effect subscribe before posting. This is
  // the same deterministic bridge seam used by the existing playground E2E helpers.
  await page.waitForTimeout(700)
  const posted = await page.evaluate(async (path) => {
    const response = await fetch("/api/v1/ui/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "openFile", params: { path } }),
    })
    return response.ok
  }, RELATIVE_PATH)
  expect(posted).toBe(true)
  await expect(page.locator('[data-boring-workspace-part="file-path-header"]')).toContainText(
    "open-agent-edit.md",
    { timeout: 15_000 },
  )
  await expect(page.getByText("Before agent edit.")).toBeVisible({ timeout: 15_000 })
}

async function proveExternalUpdate(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  // This is deliberately an ordinary host filesystem write, not a browser API:
  // it has the same plain-file contract as an Agent write/edit tool.
  await writeFile(ABSOLUTE_PATH, "# External edit proof\n\nAfter agent-style edit.\n", "utf8")

  await expect(page.getByText("After agent-style edit.")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId("markdown-document-status")).toHaveText("Updated from disk")
  await page.screenshot({ path: testInfo.outputPath("markdown-external-edit.png"), fullPage: true })
}

test.afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

test("@watch-unsupported open Markdown reconciles a plain-file edit via active-file fallback", async ({ page }, testInfo) => {
  test.skip(!HAS_EXPLICIT_WATCH_CAP || WATCH_CAP > 10, "requires an explicit low watcher cap")
  await prepareFixture(true)
  await openProofDocument(page)
  await expect(page.getByTestId("markdown-document-status")).toHaveText("Watching for file changes")
  await proveExternalUpdate(page, testInfo)

  // Keep the local buffer dirty by failing its autosave, then prove the next
  // external write freezes instead of being silently overwritten.
  await page.route("**/api/v1/files", async (route) => {
    if (route.request().method() === "POST") return route.abort("failed")
    return route.continue()
  })
  const editor = page.locator(".tiptap.ProseMirror")
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" Local draft")
  await page.waitForTimeout(400)
  await writeFile(ABSOLUTE_PATH, "# External edit proof\n\nAgent conflict version.\n", "utf8")

  await expect(page.getByText(/This file has been modified outside the editor/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId("markdown-document-status")).toHaveText(
    "Disk update conflicts with your edits",
  )
  await expect(editor).toContainText("Local draft")
  expect(await readFile(ABSOLUTE_PATH, "utf8")).toContain("Agent conflict version.")

  // Continued typing after conflict must not turn into implicit overwrite once
  // the transport works again.
  await page.unroute("**/api/v1/files")
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" after conflict")
  await page.waitForTimeout(600)
  expect(await readFile(ABSOLUTE_PATH, "utf8")).toContain("Agent conflict version.")

  await page.getByRole("button", { name: "Reload" }).click()
  await expect(editor).toContainText("Agent conflict version.")
  await expect(editor).not.toContainText("Local draft")
  await expect(page.getByTestId("markdown-document-status")).toHaveText("Reloaded from disk")

  // Exercise the other explicit resolution with edits that continue after the
  // conflict: Overwrite must persist the latest local buffer, not its snapshot.
  await page.route("**/api/v1/files", async (route) => {
    if (route.request().method() === "POST") return route.abort("failed")
    return route.continue()
  })
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" Local overwrite candidate")
  await page.waitForTimeout(400)
  await writeFile(ABSOLUTE_PATH, "# External edit proof\n\nSecond agent conflict.\n", "utf8")
  await expect(page.getByText(/This file has been modified outside the editor/)).toBeVisible({ timeout: 10_000 })
  await page.unroute("**/api/v1/files")
  await editor.click()
  await page.keyboard.press("End")
  await page.keyboard.type(" latest")
  await page.getByRole("button", { name: "Overwrite" }).click()

  await expect(page.getByTestId("markdown-document-status")).toHaveText("Overwrote disk version")
  expect(await readFile(ABSOLUTE_PATH, "utf8")).toContain("Local overwrite candidate latest")
  await page.screenshot({ path: testInfo.outputPath("markdown-conflict.png"), fullPage: true })
})

test("@watch-live open Markdown reconciles a plain-file edit via filesystem SSE", async ({ page }, testInfo) => {
  test.skip(!HAS_EXPLICIT_WATCH_CAP || WATCH_CAP <= 10, "requires an explicit live watcher cap")
  await prepareFixture(false)
  await openProofDocument(page)
  await expect(page.getByText("Watching for file changes")).toHaveCount(0)
  // Let chokidar finish its initial scan before the out-of-band write.
  await page.waitForTimeout(500)
  await proveExternalUpdate(page, testInfo)
})
