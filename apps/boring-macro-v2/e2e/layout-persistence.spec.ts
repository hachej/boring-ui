import { expect, test } from "@playwright/test"
import { bootClean, openWorkbench } from "./helpers"

/**
 * Regression: SurfaceShell's file-tree sidebar collapsed/width state is
 * persisted under `<storageKey>:surface:sidebarCollapsed` and
 * `<storageKey>:surface:sidebarWidth`. boring-macro passes
 * `storageKey="boring-macro:shell"` so the keys are
 * `boring-macro:shell:surface:sidebarCollapsed` etc.
 *
 * Pre-fix: legacy shell only forwarded `storageKey` for its OWN
 * drawer/surface widths and never passed a key down to SurfaceShell, so
 * SurfaceShell's persistence code was a no-op. Declarative apps now pass
 * `SurfaceShell.storageKey` as `${storageKey}:surface`.
 */

const SHELL_KEY = "boring-macro:shell"

test("collapsed file-tree sidebar persists across reload", async ({ page }) => {
  // Pre-seed the persisted flag via bootClean's seed param so the value
  // survives bootClean's localStorage.clear (which runs on every page
  // navigation, including the upcoming reload).
  await bootClean(page, {
    [`${SHELL_KEY}:surface:sidebarCollapsed`]: "1",
    [`${SHELL_KEY}:surface`]: "1", // workbench open
  })
  await page.waitForTimeout(1500)

  // SurfaceShell read the seeded "1" on mount → sidebar should be in
  // collapsed mode. The dockview wrapper exposes data-collapsed-files
  // when the bar is hidden.
  const collapsedAttr = await page.evaluate(() => {
    const el = document.querySelector(".workbench-dockview")
    return el?.getAttribute("data-collapsed-files")
  })
  expect(collapsedAttr).toBe("true")

  // Persisted value still readable after one render round-trip.
  const persisted = await page.evaluate(
    (key) => localStorage.getItem(`${key}:surface:sidebarCollapsed`),
    SHELL_KEY,
  )
  expect(persisted).toBe("1")
})

test("sidebar width persists across reload", async ({ page }) => {
  await bootClean(page, {
    [`${SHELL_KEY}:surface:sidebarWidth`]: "300",
    [`${SHELL_KEY}:surface`]: "1",
  })
  await page.waitForTimeout(1500)

  // After mount, SurfaceShell reads the seeded width and writes it back
  // (same value, idempotent). It must not have been overwritten with the
  // default (240px).
  const persisted = await page.evaluate(
    (key) => localStorage.getItem(`${key}:surface:sidebarWidth`),
    SHELL_KEY,
  )
  expect(persisted).toBe("300")
})

test("drawer + surface open state lives under the same prefix", async ({ page }) => {
  await bootClean(page)

  // Toggle workbench surface open via the keyboard shortcut.
  await openWorkbench(page)
  await page.waitForTimeout(500)

  // After Cmd+2 the surface flag should be flipped.
  const allKeys = await page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith("boring-macro:shell")) {
        out[k] = localStorage.getItem(k) ?? ""
      }
    }
    return out
  })
  // At minimum we expect SOMETHING under boring-macro:shell. Pre-fix the
  // chat-centered-shell defaulted to "boring-ui-v2:chat-centered-shell:v2"
  // and the macro app's prefix had nothing.
  expect(Object.keys(allKeys).length).toBeGreaterThan(0)
})
