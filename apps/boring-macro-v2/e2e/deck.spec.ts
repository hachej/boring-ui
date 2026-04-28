import { expect, test } from "@playwright/test"
import { bootClean, openDeckViaBridge, openWorkbench } from "./helpers"

const DECK_PATH = "intro.md"

test.describe("DeckPane", () => {
  test("renders frontmatter title + slide nav", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openDeckViaBridge(page, DECK_PATH)

    // Frontmatter title from intro.md.
    await expect(page.locator("text=Macro snapshot").first()).toBeVisible()
    // Slide indicator + Next button.
    await expect(page.locator('button:has-text("Next")').last()).toBeVisible()
  })

  test("Next button advances slides", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openDeckViaBridge(page, DECK_PATH)

    // Slide 1 has "Inflation pulse"
    await expect(page.locator("text=Inflation pulse").first()).toBeVisible()
    await page.locator('button:has-text("Next")').last().click()
    await page.waitForTimeout(1000)
    // Slide 2 has "Labor market"
    await expect(page.locator("text=Labor market").first()).toBeVisible()
  })

  test("Edit toggle reveals the textarea", async ({ page }) => {
    await bootClean(page)
    await openWorkbench(page)
    await openDeckViaBridge(page, DECK_PATH)

    await page.locator('button:has-text("Edit")').last().click()
    await page.waitForTimeout(500)
    await expect(page.locator("textarea").last()).toBeVisible()
  })
})

test.describe("DeckPane backend", () => {
  test("GET /api/macro/deck returns markdown", async ({ request }) => {
    const res = await request.get(`/api/macro/deck?path=${DECK_PATH}`)
    expect(res.ok()).toBe(true)
    const text = await res.text()
    expect(text).toMatch(/title: Macro snapshot/)
    expect(text).toMatch(/TimeSeries/)
  })

  test("PUT /api/macro/deck round-trips content", async ({ request }) => {
    // Read current.
    const before = await request.get(`/api/macro/deck?path=${DECK_PATH}`)
    const original = await before.text()

    // Write a marker, then verify, then restore.
    const marker = "<!-- e2e marker — boring-macro -->"
    const modified = `${original}\n${marker}\n`
    const put = await request.put(`/api/macro/deck?path=${DECK_PATH}`, {
      headers: { "Content-Type": "application/json" },
      data: { content: modified },
    })
    expect(put.ok()).toBe(true)

    const reread = await (await request.get(`/api/macro/deck?path=${DECK_PATH}`)).text()
    expect(reread).toContain(marker)

    // Restore.
    await request.put(`/api/macro/deck?path=${DECK_PATH}`, {
      headers: { "Content-Type": "application/json" },
      data: { content: original },
    })
  })

  test("PUT rejects path traversal", async ({ request }) => {
    const res = await request.put("/api/macro/deck?path=../../etc/passwd", {
      headers: { "Content-Type": "application/json" },
      data: { content: "x" },
    })
    expect(res.ok()).toBe(false)
  })
})
