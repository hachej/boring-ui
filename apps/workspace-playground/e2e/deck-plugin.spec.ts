import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const STORAGE_KEY = "boring-ui-v2:layout:playground"
const EDITED_MARKER = "Edited from playwright"
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_DECK_PATH = resolve(APP_DIR, "src/fixtures/deck/intro.md")
const WORKSPACE_ROOT = resolve(APP_DIR, "e2e/fixtures/workspace")
const WORKSPACE_DECK_PATH = resolve(WORKSPACE_ROOT, "deck/intro.md")

function resetDeckWorkspaceFile() {
  mkdirSync(dirname(WORKSPACE_DECK_PATH), { recursive: true })
  copyFileSync(SOURCE_DECK_PATH, WORKSPACE_DECK_PATH)
}

async function openPalette(page: import("@playwright/test").Page) {
  await page.keyboard.press("ControlOrMeta+KeyK")
  await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({ timeout: 5_000 })
}

async function openFileFromPalette(
  page: import("@playwright/test").Page,
  query: string,
  optionName: RegExp,
) {
  await test.step(`open ${query} from the command palette`, async () => {
    await openPalette(page)
    await page.getByRole("button", { name: "Sources" }).click()
    await page.keyboard.type(query)
    await page.waitForTimeout(300)
    await page.getByRole("option", { name: optionName }).first().click()
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeHidden({ timeout: 2_000 })
  })
}

async function openDeckFile(page: import("@playwright/test").Page) {
  await openFileFromPalette(page, "intro", /intro\.md/i)
}

test.describe("workspace-playground deck plugin", () => {
  test.beforeEach(async ({ page }) => {
    await test.step("reset deck workspace fixture", async () => {
      resetDeckWorkspaceFile()
      expect(readFileSync(WORKSPACE_DECK_PATH, "utf8")).not.toContain(EDITED_MARKER)
    })

    await test.step("reset persisted layout state", async () => {
      await page.goto("/")
      await page.evaluate((prefix) => {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i)
          if (key?.startsWith(prefix)) localStorage.removeItem(key)
        }
        localStorage.setItem(`${prefix}:drawer`, "0")
        localStorage.setItem(`${prefix}:surface`, "0")
      }, STORAGE_KEY)
      await page.reload()
      await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    })
  })

  test("opens, edits, previews, presents, and renders injected widget deck content", async ({ page }) => {
    await openDeckFile(page)

    await test.step("deck file opens through the deck surface resolver", async () => {
      await expect(page.getByText("Welcome to the neutral consumer deck.")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText("widget-ok")).toBeVisible()
      await expect(page.getByTestId("deck-next")).toBeVisible()
    })

    await test.step("slide navigation works in read mode", async () => {
      await page.getByTestId("deck-next").click()
      await expect(page.getByText("Second slide")).toBeVisible()
      await page.getByTestId("deck-prev").click()
      await expect(page.getByText("Welcome to the neutral consumer deck.")).toBeVisible()
    })

    await test.step("open in new tab uses the generic full-page route", async () => {
      const popupPromise = page.waitForEvent("popup")
      await page.getByTestId("deck-open-present").click()
      const popup = await popupPromise
      await expect(popup.getByTestId("deck-shell-present")).toBeVisible({ timeout: 10_000 })
      await expect(popup.getByText("Welcome to the neutral consumer deck.")).toBeVisible({ timeout: 10_000 })
      await expect(popup.getByTestId("deck-next")).toHaveCount(0)
      await popup.keyboard.press("ArrowRight")
      await expect(popup.getByText("Second slide")).toBeVisible({ timeout: 10_000 })
      await popup.close()
    })

    await test.step("edit mode supports raw markdown editing and autosave", async () => {
      await page.getByTestId("deck-mode-edit").click()
      await page.getByRole("button", { name: /^MD$/i }).click()

      let releaseSave: (() => void) | undefined
      await page.route("**/api/v1/files", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue()
          return
        }

        await new Promise<void>((resolve) => {
          releaseSave = resolve
        })
        await route.continue()
      }, { times: 1 })

      const rawEditor = page.getByLabel("Raw markdown")
      await rawEditor.click()
      await rawEditor.press("End")
      await rawEditor.type(`\n\n${EDITED_MARKER}`)

      await test.step("dirty deck updates the real workspace tab title", async () => {
        await expect(page.locator('[title="intro.md (unsaved changes)"]')).toBeVisible({ timeout: 10_000 })
      })

      await test.step("switching files while autosave is in flight does not leave the deck tab stuck", async () => {
        await expect.poll(() => typeof releaseSave, { timeout: 10_000 }).toBe("function")

        await openFileFromPalette(page, "README", /README\.md/i)
        await expect(page.getByText("Workspace Playground")).toBeVisible({ timeout: 10_000 })

        releaseSave?.()

        await expect.poll(() => readFileSync(WORKSPACE_DECK_PATH, "utf8"), {
          timeout: 10_000,
        }).toContain(EDITED_MARKER)
        await expect(page.getByTestId("tab-saving-spinner")).toHaveCount(0)
      })

      await page.locator('[title="intro.md"]').click()
      await page.getByTestId("deck-mode-read").click()
      await expect(page.getByText(EDITED_MARKER)).toBeVisible({ timeout: 10_000 })
    })

    await test.step("present mode keeps slide navigation", async () => {
      await page.getByTestId("deck-toggle-present").click()
      await expect(page.getByTestId("deck-shell-present")).toBeVisible()
      await page.getByTestId("deck-next").click()
      await expect(page.getByText("Second slide")).toBeVisible()
      await page.getByTestId("deck-toggle-present").click()
      await expect(page.getByTestId("deck-shell-read")).toBeVisible()
    })
  })
})
