import { test } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

// Diagnostic probe, not a CI spec: zero assertions, hardcoded settle waits,
// screenshots to disk. It only runs when explicitly demanded so the standard
// e2e suite neither pays ~25s of settle waits nor picks up its console spew.
test.skip(!process.env.MOBILE_SHOT_DIR, "diagnostic only — set MOBILE_SHOT_DIR to run")

const OUT = process.env.MOBILE_SHOT_DIR || resolve(process.cwd(), "mobile-shots")
mkdirSync(OUT, { recursive: true })

function wire(page: import("@playwright/test").Page, tag: string) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[${tag}][console.${m.type()}] ${m.text().slice(0, 400)}`)
  })
  page.on("pageerror", (e) => console.log(`[${tag}][pageerror] ${String(e).slice(0, 600)}`))
  page.on("requestfailed", (r) => console.log(`[${tag}][requestfailed] ${r.url().slice(0, 200)} :: ${r.failure()?.errorText}`))
}

async function probe(page: import("@playwright/test").Page, tag: string) {
  const info = await page.evaluate(() => {
    const root = document.getElementById("root")
    return {
      inner: [window.innerWidth, window.innerHeight],
      docScrollW: document.documentElement.scrollWidth,
      rootChildren: root?.children.length ?? -1,
      rootHTMLLen: root?.innerHTML.length ?? -1,
      rootHTMLHead: (root?.innerHTML ?? "").slice(0, 300),
      parts: Array.from(document.querySelectorAll("[data-boring-workspace-part]")).map((el) => el.getAttribute("data-boring-workspace-part")),
      visButtons: Array.from(document.querySelectorAll("button")).filter((b) => (b as HTMLElement).offsetParent !== null).length,
    }
  })
  console.log(`[${tag}] PROBE ${JSON.stringify(info)}`)
  await page.screenshot({ path: resolve(OUT, `diag-${tag}.png`) })
}

test("diag desktop", async ({ page }) => {
  wire(page, "desktop")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.waitForTimeout(6000)
  await probe(page, "desktop")
})

test("diag mobile-nomobileflag", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_VITE_PORT) || 5380}` })
  const page = await ctx.newPage()
  wire(page, "m-noflag")
  await page.goto("/")
  await page.waitForTimeout(6000)
  await probe(page, "m-noflag")
  await ctx.close()
})

test("diag mobile-full", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_VITE_PORT) || 5380}` })
  const page = await ctx.newPage()
  wire(page, "m-full")
  await page.goto("/")
  await page.waitForTimeout(6000)
  await probe(page, "m-full")
  await ctx.close()
})

test("diag desktop-then-resize", async ({ page }) => {
  wire(page, "resize")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await page.waitForTimeout(5000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(2500)
  await probe(page, "resize")
})
