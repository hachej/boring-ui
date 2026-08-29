import { expect, test, type Locator } from "@playwright/test"

/**
 * #1451: opening a file (editor tab) put the workbench at its persisted
 * default width (680px). On a medium desktop viewport that left too little
 * room for the chat column once the Tasks overlay forced it back open —
 * ChatLayout deliberately skips its narrow-viewport chat-auto-collapse
 * whenever a chat overlay is active, so the overlay's flex wrapper was the
 * thing left computing to ~0 width instead. See ChatLayout.tsx's
 * `chatOverlayReserve` / measured `rowWidth`.
 */

/**
 * The workbench and the overlay's chat column both animate their width over
 * 280ms (`transition-[...,width,...] duration-[280ms]` in ChatLayout.tsx).
 * A single `boundingBox()` sample right after the overlay becomes visible
 * can land mid-transition and read an intermediate, pre-fix-like width —
 * visible does not mean geometry has settled (#1457 review finding 3).
 * Poll until two consecutive samples, spaced further apart than a single
 * animation frame, report the same box.
 */
async function waitForStableBoundingBox(locator: Locator, timeoutMs = 5_000) {
  let previous: Awaited<ReturnType<Locator["boundingBox"]>> = null
  await expect
    .poll(
      async () => {
        const current = await locator.boundingBox()
        const stable = current !== null
          && previous !== null
          && current.width === previous.width
          && current.height === previous.height
          && current.x === previous.x
          && current.y === previous.y
        previous = current
        return stable
      },
      { timeout: timeoutMs, intervals: [50, 50, 100, 100, 200] },
    )
    .toBe(true)
  const box = await locator.boundingBox()
  if (!box) throw new Error("element has no bounding box after it stabilized")
  return box
}

test.describe("Tasks panel width with editor tabs open", () => {
  test.use({ viewport: { width: 1024, height: 800 } })

  test("Tasks overlay stays visible and non-zero width after opening a file", async ({ page }) => {
    await page.goto("/?fresh=1")

    const filesButton = page.locator('[aria-label="Files"]').first()
    await expect(filesButton).toBeVisible({ timeout: 15_000 })
    await filesButton.click()

    await page.getByText("README.md", { exact: true }).first().click()
    await expect(page.getByRole("tab", { name: /README\.md/ })).toBeVisible({ timeout: 10_000 })

    await page.getByRole("button", { name: "Tasks" }).click()

    const overlay = page.locator('[data-boring-workspace-part="tasks-overlay"]')
    await expect(overlay).toBeVisible()

    // Pre-fix this settled at ~63px — mounted but effectively
    // invisible/unusable. The fix reserves a real minimum for the chat
    // column whenever it must host an overlay, so the board stays legible
    // once its (and the sibling workbench's) width transition settles.
    const box = await waitForStableBoundingBox(overlay)
    expect(box.width).toBeGreaterThan(200)
    expect(box.height).toBeGreaterThan(200)

    await expect(page.getByText("Tasks", { exact: true }).first()).toBeVisible()
  })
})
