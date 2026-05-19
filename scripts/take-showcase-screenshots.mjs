#!/usr/bin/env node
/**
 * Screenshot live boring-ui apps for the README "Built with" section.
 */
import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, "..", "docs", "assets", "readme")

const TARGETS = [
  { id: "macro", url: "https://boring-macro.fly.dev/", viewport: { width: 1440, height: 900 } },
]

async function run() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  for (const t of TARGETS) {
    const ctx = await browser.newContext({ viewport: t.viewport, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    try {
      await page.goto(t.url, { waitUntil: "networkidle", timeout: 20000 })
      await page.waitForTimeout(1200)
      const path = `${OUT}/showcase-${t.id}.png`
      await page.screenshot({ path })
      console.log("captured", path)
    } catch (e) {
      console.error(`failed ${t.id}: ${e.message}`)
    }
    await ctx.close()
  }
  await browser.close()
}

run().catch((e) => { console.error(e); process.exit(1) })
