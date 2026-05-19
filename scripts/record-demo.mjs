#!/usr/bin/env node
/**
 * Record a real video demo by:
 *   - launching playwright-chromium HEADED on an existing Xvfb display
 *   - capturing the display with ffmpeg x11grab while playwright drives the UI
 *
 * Usage:
 *   Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
 *   DISPLAY=:99 node scripts/record-demo.mjs <demo>
 *
 * Demos:
 *   plugin   — data-catalog: click Data tab, browse, drill into a row
 *   core     — chat: type a prompt, watch the agent open a file
 */
import { chromium } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, "..", "docs", "assets", "readme")
mkdirSync(OUT, { recursive: true })

const DEMO = process.argv[2] || "plugin"
const BASE = process.env.SHOT_BASE_URL || "http://127.0.0.1:5380"
const DISPLAY = process.env.DISPLAY || ":99"
const SIZE = { w: 1440, h: 900 }
const MP4 = resolve(OUT, `demo-${DEMO}.mp4`)

async function startFfmpeg() {
  const args = [
    "-y", "-loglevel", "error",
    "-f", "x11grab", "-framerate", "24",
    "-video_size", `${SIZE.w}x${SIZE.h}`,
    "-i", DISPLAY,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
    "-movflags", "+faststart",
    MP4,
  ]
  const p = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] })
  console.log(`[record] ffmpeg started pid=${p.pid}`)
  return p
}

function stopFfmpeg(proc) {
  return new Promise((res) => {
    proc.on("exit", () => res())
    // Sending 'q' on stdin is the documented graceful-stop signal for ffmpeg
    proc.stdin.write("q")
    setTimeout(() => proc.kill("SIGTERM"), 2000)
  })
}

async function runPlugin(page) {
  // Plugin/files demo: open workbench, browse the file tree, open a file
  console.log("[record] demo: plugin (file-browse)")
  await page.waitForSelector('[role="banner"], main', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(2500)

  // 1. Open workbench (⌘2)
  console.log("[record] open workbench")
  await page.keyboard.press("ControlOrMeta+Digit2")
  await page.waitForSelector('[data-boring-workspace-part="workbench"][data-boring-state="expanded"]', { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1500)

  // 2. Click README.md in the file tree
  const readmeRow = page.getByRole("treeitem", { name: /README\.md/i }).first()
  if (await readmeRow.count().catch(() => 0)) {
    console.log("[record] click README.md")
    await readmeRow.click()
    await page.waitForTimeout(2500)
  } else {
    // Fallback: click the file by text
    const readmeText = page.getByText(/^README\.md$/).first()
    if (await readmeText.count().catch(() => 0)) {
      console.log("[record] click README.md (text)")
      await readmeText.click()
      await page.waitForTimeout(2500)
    }
  }

  // 3. Click data.csv to switch what's shown
  const csvRow = page.getByText(/^data\.csv$/).first()
  if (await csvRow.count().catch(() => 0)) {
    console.log("[record] click data.csv")
    await csvRow.click()
    await page.waitForTimeout(2500)
  }

  await page.waitForTimeout(1500)
}

async function runCore(page) {
  console.log("[record] demo: core")
  await page.waitForSelector('[role="banner"], main', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const chat = page.getByPlaceholder(/ask|what|chat/i).first()
  await chat.click()
  await page.keyboard.type("Open the README and tell me what this project does", { delay: 35 })
  await page.waitForTimeout(800)
  await page.keyboard.press("Enter")

  // Wait for the agent to do something — tool call chip or a workbench tab
  await Promise.race([
    page.waitForSelector('[data-tool-call], [data-tool="read"]', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('[data-dockview-tab*="README" i], [data-dockview-tab*="readme" i]', { timeout: 30_000 }).catch(() => null),
  ])
  await page.waitForTimeout(4000)
}

async function main() {
  // Headed chromium maximized on Xvfb. We'll post-crop the chrome chrome
  // (URL bar + tabs, ~84px) in ffmpeg after the capture.
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      `--window-size=${SIZE.w},${SIZE.h}`,
      "--window-position=0,0",
      "--start-maximized",
    ],
    env: { ...process.env, DISPLAY },
  })
  const ctx = await browser.newContext({ viewport: null })
  const page = await ctx.newPage()
  // First visit just to get a same-origin context, then nuke localStorage so we start clean
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {})
  await page.evaluate(() => { try { localStorage.clear() } catch {} })
  await page.goto(BASE, { waitUntil: "load", timeout: 60_000 })

  const ff = await startFfmpeg()
  // give ffmpeg a moment to lock onto the display
  await new Promise((r) => setTimeout(r, 800))

  try {
    if (DEMO === "plugin") await runPlugin(page)
    else if (DEMO === "core") await runCore(page)
    else throw new Error(`unknown demo: ${DEMO}`)
  } finally {
    await stopFfmpeg(ff)
    await browser.close()
  }

  console.log(`[record] wrote ${MP4}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
