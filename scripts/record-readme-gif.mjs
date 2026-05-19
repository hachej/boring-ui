#!/usr/bin/env node
/**
 * Record a short interaction video of the workspace-playground and emit
 * `docs/assets/readme/demo.webm`. Convert to GIF with the companion ffmpeg
 * command shown at the end of the run.
 */
import { chromium } from "@playwright/test"
import { mkdir, rm } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, "..", "docs", "assets", "readme")
const VIDEO_DIR = resolve(OUT, "_video")
const BASE = process.env.SHOT_BASE_URL || "http://127.0.0.1:5380"
const VIEWPORT = { width: 1280, height: 800 }

async function run() {
  await rm(VIDEO_DIR, { recursive: true, force: true })
  await mkdir(VIDEO_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  })
  const page = await ctx.newPage()

  await page.goto(BASE, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)

  // open workbench
  const wb = page.getByRole("button", { name: /workbench/i }).first()
  if (await wb.isVisible().catch(() => false)) {
    await wb.click()
    await page.waitForTimeout(900)
  }

  // hover a file in the file tree
  const fileItem = page.getByRole("treeitem").or(page.locator('[data-slot="file-tree-item"]')).first()
  if (await fileItem.count().catch(() => 0)) {
    await fileItem.hover().catch(() => {})
    await page.waitForTimeout(400)
    await fileItem.click().catch(() => {})
    await page.waitForTimeout(1200)
  }

  // open command palette
  await page.keyboard.press("ControlOrMeta+KeyK")
  await page.waitForTimeout(800)
  await page.keyboard.type("toggle ", { delay: 50 })
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)

  // type in chat
  const chat = page.getByPlaceholder(/ask anything/i).first()
  if (await chat.isVisible().catch(() => false)) {
    await chat.click()
    await page.keyboard.type("show me every TODO in this repo", { delay: 40 })
    await page.waitForTimeout(800)
  }

  await page.waitForTimeout(500)
  await ctx.close()
  await browser.close()

  // Find the produced .webm and rename to demo.webm
  const fs = await import("node:fs/promises")
  const entries = await fs.readdir(VIDEO_DIR)
  const webm = entries.find((f) => f.endsWith(".webm"))
  if (!webm) { console.error("no .webm produced"); process.exit(1) }
  const src = resolve(VIDEO_DIR, webm)
  const dst = resolve(OUT, "demo.webm")
  await fs.rename(src, dst)
  console.log(`wrote ${dst}`)
  console.log("\nTo convert to GIF (12fps, 1080px wide):")
  console.log(`  ffmpeg -y -i ${dst} -vf "fps=12,scale=1080:-1:flags=lanczos,split [a][b];[a] palettegen=max_colors=128 [p];[b][p] paletteuse" ${OUT}/demo.gif`)
}

run().catch((e) => { console.error(e); process.exit(1) })
