/**
 * Playwright helpers for any app built on @boring/workspace.
 *
 * Use these from app-side e2e suites instead of reimplementing
 * `bootClean`/`openWorkbench`/`openPaneViaBridge` in each repo. The
 * helpers are storage-key-aware so apps with different shell prefixes
 * (`"boring-macro:shell"`, `"playground:shell"`, …) all work.
 *
 * Imports `playwright/test` types only — no runtime dependency.
 *
 * ```ts
 * import { bootClean, openWorkbench, openPaneViaBridge } from "@boring/workspace/testing/e2e"
 *
 * await bootClean(page, { shellKey: "boring-macro:shell" })
 * await openPaneViaBridge(page, { id: "chart:CPI", component: "chart-canvas", title: "CPI", params: {} })
 * ```
 */
import type { Page } from "@playwright/test"

export interface BootCleanOptions {
  /**
   * Storage prefix used by declarative chat shells. The
   * bootClean default is to pre-seed `${shellKey}:surface=1` so the
   * workbench mounts at boot — required for any test that posts an
   * openPanel via the bridge (the dispatcher early-returns when no
   * surface is mounted).
   */
  shellKey: string
  /** Extra localStorage entries to seed after the clear. */
  seed?: Record<string, string>
  /**
   * If false, surface=1 is NOT pre-seeded — the test starts with the
   * workbench closed. Default: true.
   */
  openWorkbenchAtBoot?: boolean
  /** Vite + dockview cold-mount allowance. Default 2500ms. */
  mountSettleMs?: number
}

/**
 * Land on the app with a clean localStorage so persistence-sensitive tests
 * start from defaults. Pre-opens the workbench surface unless told
 * otherwise — see `openWorkbenchAtBoot`.
 *
 * Also drains the server-side bridge command queue. The bridge is process-
 * global on a shared dev server (E2E_EXTERNAL_SERVER=1); without an
 * explicit drain, a leftover command from a previous test (e.g. an
 * openPanel posted just before that test ended) gets re-delivered to the
 * next test's SSE subscriber and mounts an unexpected pane. The drain is
 * a no-op when the queue is already empty.
 */
export async function bootClean(
  page: Page,
  opts: BootCleanOptions,
): Promise<void> {
  // Clear server-side bridge queue. Use Playwright's APIRequestContext so
  // we issue the drain BEFORE any page navigation. The browser hasn't
  // contacted the dev server yet, so this targets only the shared backend.
  try {
    await page.context().request.get("/api/v1/ui/commands/next?poll=true", {
      timeout: 2000,
    })
  } catch {
    // backend not yet serving (cold start) or auth — non-fatal, the
    // SSE drain-on-connect on the workspace side covers the gap.
  }

  const finalSeed: Record<string, string> = { ...(opts.seed ?? {}) }
  if (opts.openWorkbenchAtBoot !== false) {
    finalSeed[`${opts.shellKey}:surface`] = "1"
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
  await page.waitForTimeout(opts.mountSettleMs ?? 2500)
}

/**
 * Ensure the workbench surface is OPEN. Idempotent — checks the persisted
 * flag rather than blindly toggling, so it's safe to call after bootClean
 * (which pre-seeds the open flag by default) or independently.
 */
export async function openWorkbench(
  page: Page,
  opts: { shellKey: string },
): Promise<void> {
  const isOpen = await page.evaluate(
    (key) => localStorage.getItem(`${key}:surface`) === "1",
    opts.shellKey,
  )
  if (isOpen) return
  await page.locator("body").click({ position: { x: 750, y: 300 } })
  await page.keyboard.press("Meta+2")
  await page.waitForTimeout(800)
}

export interface OpenPaneViaBridgeConfig {
  /** Tab/panel instance id (e.g. `"chart:CPIAUCSL"`, `"deck:intro.md"`). */
  id: string
  /** Registered panel component id. Must appear in `extraPanels`. */
  component: string
  /** Tab title to wait for. */
  title: string
  /** Forwarded to the panel component as its `params`. */
  params: Record<string, unknown>
  /** Override the dockview-tab wait timeout. Default 10s. */
  paneMountTimeoutMs?: number
}

/**
 * Push an openPanel command through the workspace UI bridge, then poll
 * until the corresponding dockview tab actually appears. The chat shell
 * receives commands over an SSE stream; subscribe latency is
 * non-deterministic (cold Vite, ClickHouse warm-up, EventSource reconnect
 * budget), so we wait on the rendered tab rather than a fixed sleep.
 */
export async function openPaneViaBridge(
  page: Page,
  cfg: OpenPaneViaBridgeConfig,
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

  await page.waitForFunction(
    (needle) => {
      const tabs = document.querySelectorAll(".dv-tab")
      for (const t of tabs) {
        if ((t.textContent ?? "").includes(needle)) return true
      }
      return false
    },
    cfg.title,
    { timeout: cfg.paneMountTimeoutMs ?? 10_000 },
  )
  // Pane content (charts, markdown, fetches) finishes mounting.
  await page.waitForTimeout(800)
}
