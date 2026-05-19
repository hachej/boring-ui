#!/usr/bin/env node
/**
 * One-off: take README screenshots against a running workspace-playground.
 * Usage:
 *   pnpm --filter workspace-playground dev   # in another shell
 *   node scripts/take-readme-screenshots.mjs
 *
 * Outputs to docs/assets/readme/.
 */
import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, "..", "docs", "assets", "readme")
const BASE = process.env.SHOT_BASE_URL || "http://127.0.0.1:5380"
const VIEWPORT = { width: 1440, height: 900 }

async function run() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  const page = await ctx.newPage()

  // 1. Default landing
  await page.goto(BASE, { waitUntil: "networkidle" })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/01-landing.png` })
  console.log("captured 01-landing.png")

  // 2. Workbench open — try clicking workbench toggle button if available
  const wbBtn = page.getByRole("button", { name: /workbench/i }).first()
  if (await wbBtn.isVisible().catch(() => false)) {
    await wbBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/02-workbench-open.png` })
    console.log("captured 02-workbench-open.png")
  } else {
    console.log("skip 02: no workbench button visible")
  }

  // 3. Sessions drawer
  const sessionsBtn = page.getByRole("button", { name: /sessions/i }).first()
  if (await sessionsBtn.isVisible().catch(() => false)) {
    await sessionsBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/03-sessions-drawer.png` })
    console.log("captured 03-sessions-drawer.png")
  } else {
    console.log("skip 03: no sessions button visible")
  }

  // 4. Command palette
  await page.keyboard.press("ControlOrMeta+KeyK")
  await page.waitForTimeout(500)
  const palette = page.getByRole("dialog", { name: /command palette/i })
  if (await palette.isVisible().catch(() => false)) {
    await page.screenshot({ path: `${OUT}/04-command-palette.png` })
    console.log("captured 04-command-palette.png")
  } else {
    console.log("skip 04: palette did not open")
  }
  // close palette
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)

  await browser.close()
  console.log(`done. output: ${OUT}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
