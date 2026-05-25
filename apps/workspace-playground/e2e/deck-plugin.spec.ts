import { expect, test } from "@playwright/test"

const STORAGE_KEY = "boring-ui-v2:layout:playground"

async function openPalette(page: import("@playwright/test").Page) {
  await page.keyboard.press("ControlOrMeta+KeyK")
  await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({ timeout: 5_000 })
}

async function openDeckFile(page: import("@playwright/test").Page) {
  await test.step("open deck file from the command palette", async () => {
    await openPalette(page)
    await page.keyboard.type("intro")
    await page.waitForTimeout(300)
    await page.getByRole("option", { name: /intro\.md/i }).first().click()
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeHidden({ timeout: 2_000 })
  })
}

test.describe("workspace-playground deck plugin", () => {
  test.beforeEach(async ({ page }) => {
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
      await expect(page.getByRole("banner", { name: /app top bar/i })).toBeVisible({ timeout: 10_000 })
    })
  })

  test("opens, edits, previews, presents, and renders injected widget deck content", async ({ page }) => {
    await openDeckFile(page)

    await test.step("deck file opens through the deck surface resolver", async () => {
      await expect(page.getByText("Welcome to the neutral consumer deck.")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText("widget-ok")).toBeVisible()
      await expect(page.getByText("Slide 1 of 2")).toBeVisible()
    })

    await test.step("slide navigation works in read mode", async () => {
      await page.getByTestId("deck-next").click()
      await expect(page.getByText("Second slide")).toBeVisible()
      await expect(page.getByText("Slide 2 of 2")).toBeVisible()
      await page.getByTestId("deck-prev").click()
      await expect(page.getByText("Slide 1 of 2")).toBeVisible()
    })

    await test.step("edit mode supports raw markdown editing and save", async () => {
      await page.getByTestId("deck-mode-edit").click()
      await page.getByRole("button", { name: /^MD$/i }).click()
      const rawEditor = page.getByLabel("Raw markdown")
      await rawEditor.click()
      await rawEditor.press("End")
      await rawEditor.type("\n\nEdited from playwright")
      await page.getByTestId("deck-save").click()
      await page.getByTestId("deck-mode-read").click()
      await expect(page.getByText("Edited from playwright")).toBeVisible({ timeout: 10_000 })
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
