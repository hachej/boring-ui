#!/usr/bin/env node
/**
 * Render scripts/hero/hero.html → docs/assets/readme/hero.png via Playwright.
 * Pure static render; no dev server needed.
 */
import { chromium } from "@playwright/test"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = "file://" + resolve(__dirname, "hero", "hero.html")
const OUT = resolve(__dirname, "..", "docs", "assets", "readme", "hero.png")

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 760 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
await page.goto(SRC, { waitUntil: "networkidle" })
await page.waitForTimeout(800) // give Inter time to settle
await page.screenshot({ path: OUT, omitBackground: false, fullPage: false })
await browser.close()
console.log("wrote", OUT)
