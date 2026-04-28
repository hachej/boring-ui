import type { Page } from "@playwright/test"

/** Storage prefix for boring.macro's chat shell (mirrors App.tsx). */
export const SHELL_KEY = "boring-macro:shell"

/**
 * Land on the app with a clean localStorage so persistence-sensitive tests
 * start from defaults. By default the workbench surface is pre-opened —
 * the SSE-driven UI command dispatcher is a no-op when no surface is
 * mounted (early `if (!surface) return`), so any test that opens panels
 * via the bridge needs the workbench mounted at boot. Set
 * `openWorkbench: false` on the seed to start with it closed.
 */
export async function bootClean(
  page: Page,
  seed: Record<string, string> = {},
): Promise<void> {
  // Default the workbench-open flag unless caller already supplied it.
  const surfaceKey = `${SHELL_KEY}:surface`
  const finalSeed: Record<string, string> = {
    [surfaceKey]: "1",
    ...seed,
  }
  await page.addInitScript((entries) => {
    try {
      localStorage.clear()
      for (const [k, v] of Object.entries(entries as Record<string, string>)) {
        localStorage.setItem(k, v)
      }
    } catch {
      // storage unavailable — ignore
    }
  }, finalSeed)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  // Allow React + Vite + dockview to mount.
  await page.waitForTimeout(2500)
}

/**
 * Ensure the workbench surface is OPEN. Idempotent — checks the persisted
 * flag rather than blindly toggling, so it works whether bootClean
 * pre-seeded the open flag (default now) or not.
 */
export async function openWorkbench(page: Page): Promise<void> {
  const isOpen = await page.evaluate(
    (key) => localStorage.getItem(`${key}:surface`) === "1",
    SHELL_KEY,
  )
  if (isOpen) return
  await page.locator("body").click({ position: { x: 750, y: 300 } })
  await page.keyboard.press("Meta+2")
  await page.waitForTimeout(800)
}

/** Click the Data tab inside the workbench's left pane. */
export async function clickDataTab(page: Page): Promise<void> {
  await page
    .locator('button, [role="tab"]')
    .filter({ hasText: /^Data$/ })
    .first()
    .click()
  await page.waitForTimeout(1500)
}

/** Expand the Monthly frequency group inside the catalog. */
export async function expandMonthlyGroup(page: Page): Promise<void> {
  await page.locator("text=Monthly").first().click()
  await page.waitForTimeout(1500)
}

/**
 * Push an openPanel command through the agent UI bridge, then poll until
 * the corresponding dockview tab actually appears. The shell receives
 * commands over an SSE stream; subscribe latency is non-deterministic
 * (cold Vite, ClickHouse warm-up, EventSource reconnect budget), so we
 * wait on the rendered tab rather than a fixed sleep.
 */
async function openPaneViaBridge(
  page: Page,
  cfg: { id: string; component: string; title: string; params: Record<string, unknown> },
): Promise<void> {
  // Settle window so startUiCommandStream's useEffect runs and the
  // EventSource connects. Without an active subscriber, posted commands
  // queue server-side until somebody polls — they never reach dispatch.
  await page.waitForTimeout(700)

  const ok = await page.evaluate(async (c) => {
    const r = await fetch("/api/v1/ui/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "openPanel", params: c }),
    })
    return r.ok
  }, cfg)
  if (!ok) throw new Error(`bridge openPanel failed for ${cfg.id}`)

  // Wait for the dispatcher to mount the panel. Match by title (the bit
  // after "chart:" / "deck:") to be tolerant of how dockview renders the
  // tab text. 10s covers cold-startup latency; happy path settles in <1s.
  const titleMatch = cfg.title
  await page.waitForFunction(
    (needle) => {
      const tabs = document.querySelectorAll(".dv-tab")
      for (const t of tabs) {
        if ((t.textContent ?? "").includes(needle)) return true
      }
      return false
    },
    titleMatch,
    { timeout: 10_000 },
  )
  // Pane content (recharts / ReactMarkdown / fetches) finishes mounting.
  await page.waitForTimeout(800)
}

export async function openChartViaBridge(page: Page, seriesId: string): Promise<void> {
  await openPaneViaBridge(page, {
    id: `chart:${seriesId}`,
    component: "chart-canvas",
    title: seriesId,
    params: { seriesId },
  })
}

export async function openDeckViaBridge(page: Page, path: string): Promise<void> {
  await openPaneViaBridge(page, {
    id: `deck:${path}`,
    component: "deck",
    title: path,
    params: { path },
  })
}
