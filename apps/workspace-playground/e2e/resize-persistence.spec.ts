import { expect, test } from "@playwright/test"

/**
 * Verifies that the workspace front shell's two resize handles (sessions drawer +
 * workbench surface) actually move their panes AND persist the new width
 * across reloads. Regression test for:
 *   - a096700: handles existed but were positioned outside an
 *              overflow-hidden parent and got clipped
 *   - 4fdedcc: hover color regressed from accent (orange) to primary
 *              (gray); kept here as a non-asserted side-effect since
 *              CSS variables resolve at paint time and Playwright's
 *              evaluated computed style picks up the right value
 */

const STORAGE_KEY = "boring-ui-v2:layout:playground"
const DRAWER_KEY = `${STORAGE_KEY}:drawerWidth`
const SURFACE_KEY = `${STORAGE_KEY}:surfaceWidth`
const DRAWER_OPEN_KEY = `${STORAGE_KEY}:drawer`
const SURFACE_OPEN_KEY = `${STORAGE_KEY}:surface`

async function openBothPanes(page: import("@playwright/test").Page) {
  // The shell hides handles when the pane is collapsed (width=0). Toggle
  // both panes open via the floating edge buttons before each test.
  const sessionsBtn = page.getByRole("button", { name: /^sessions$/i })
  if (await sessionsBtn.isVisible().catch(() => false)) {
    await sessionsBtn.click()
  }
  const workbenchBtn = page.getByRole("button", { name: /^workbench$/i })
  if (await workbenchBtn.isVisible().catch(() => false)) {
    await workbenchBtn.click()
  }
  await page.waitForTimeout(400) // let the open transition settle
}

async function paneWidth(page: import("@playwright/test").Page, ariaLabel: string) {
  return page.evaluate(
    (label) =>
      document.querySelector(`aside[aria-label="${label}"]`)?.getBoundingClientRect()
        .width ?? null,
    ariaLabel,
  )
}

async function dragHandle(
  page: import("@playwright/test").Page,
  ariaLabel: string,
  deltaX: number,
) {
  const handle = page.locator(`[aria-label="${ariaLabel}"]`)
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`no bounding box for handle ${ariaLabel}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // 10 incremental steps so React state updates run, not a single jump
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, {
    steps: 10,
  })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

test.describe("workspace shell resize", () => {
  test.beforeEach(async ({ page }) => {
    // Start every test with no persisted widths so the defaults apply.
    await page.goto("/")
    await page.evaluate(
      (keys) => {
        for (const key of keys) localStorage.removeItem(key)
      },
      [DRAWER_KEY, SURFACE_KEY, DRAWER_OPEN_KEY, SURFACE_OPEN_KEY],
    )
    await page.reload()
    await openBothPanes(page)
  })

  test("drawer and workbench collapsed state persists across reloads", async ({ page }) => {
    const closeSessions = page.getByRole("button", { name: /close sessions/i })
    if (await closeSessions.isVisible().catch(() => false)) await closeSessions.click()
    const closeWorkbench = page.getByRole("button", { name: /close workbench/i })
    if (await closeWorkbench.isVisible().catch(() => false)) await closeWorkbench.click()

    await expect(page.locator('aside[aria-label="Session browser"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    await expect(page.locator('aside[aria-label="Surface"]')).toBeHidden()

    await page.reload()
    await expect(page.locator('aside[aria-label="Session browser"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    await expect(page.locator('aside[aria-label="Surface"]')).toBeHidden()
    await expect(page.getByRole("button", { name: /^sessions$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^workbench$/i })).toBeVisible()
  })

  test("dragging the workbench-left handle resizes the surface pane", async ({ page }) => {
    const before = await paneWidth(page, "Surface")
    expect(before).not.toBeNull()
    await dragHandle(page, "Resize workbench", -120) // drag left → grow
    const after = await paneWidth(page, "Surface")
    expect(after).not.toBeNull()
    // The pane grew by approximately the drag distance, modulo viewport
    // clamping. Allow a 20px tolerance for clamp + sub-pixel rendering.
    expect(after! - before!).toBeGreaterThan(80)
    expect(after! - before!).toBeLessThan(160)
  })

  test("dragging the drawer-right handle resizes the sessions pane", async ({
    page,
  }) => {
    const before = await paneWidth(page, "Session browser")
    expect(before).not.toBeNull()
    await dragHandle(page, "Resize sessions drawer", 80) // drag right → grow
    const after = await paneWidth(page, "Session browser")
    expect(after! - before!).toBeGreaterThan(50)
    expect(after! - before!).toBeLessThan(110)
  })

  test("workbench width persists across reloads", async ({ page }) => {
    await dragHandle(page, "Resize workbench", -100)
    const widthAfterDrag = await paneWidth(page, "Surface")
    expect(widthAfterDrag).not.toBeNull()

    // The persist useEffect fires asynchronously after React commits
    // the new width, then writes to localStorage on the next frame.
    // Poll up to 2s for the value to land — direct read after pointerup
    // can race with the effect.
    await expect
      .poll(
        () => page.evaluate((k) => Number(localStorage.getItem(k)), SURFACE_KEY),
        { timeout: 2_000 },
      )
      .toBe(Math.round(widthAfterDrag!))

    await page.reload()
    await openBothPanes(page)
    const widthAfterReload = await paneWidth(page, "Surface")
    expect(Math.abs(widthAfterReload! - widthAfterDrag!)).toBeLessThan(2)
  })

  test("drawer width persists across reloads", async ({ page }) => {
    await dragHandle(page, "Resize sessions drawer", 70)
    const widthAfterDrag = await paneWidth(page, "Session browser")
    expect(widthAfterDrag).not.toBeNull()

    await expect
      .poll(
        () => page.evaluate((k) => Number(localStorage.getItem(k)), DRAWER_KEY),
        { timeout: 2_000 },
      )
      .toBe(Math.round(widthAfterDrag!))

    await page.reload()
    await openBothPanes(page)
    const widthAfterReload = await paneWidth(page, "Session browser")
    expect(Math.abs(widthAfterReload! - widthAfterDrag!)).toBeLessThan(2)
  })
})
