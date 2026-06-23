#!/usr/bin/env node
/**
 * Capture workspace-playground UI states and ask Gemini for a visual rating.
 *
 * Usage:
 *   # Start playground separately first.
 *   pnpm review:workspace-ui
 *
 * Options/env:
 *   SHOT_BASE_URL=http://127.0.0.1:5255
 *   UI_REVIEW_OUT=artifacts/ui-review/<name>
 *   GEMINI_API_KEY=...       # optional; falls back to vault secret/agent/gemini
 *   GEMINI_MODEL=gemini-3.1-pro-preview
 *   MIN_RATING=9
 *   SKIP_GEMINI=1            # capture screenshots only
 */
import { chromium } from "@playwright/test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const BASE = process.env.SHOT_BASE_URL || "http://127.0.0.1:5255"
const OUT = resolve(ROOT, process.env.UI_REVIEW_OUT || `artifacts/ui-review/${new Date().toISOString().replace(/[:.]/g, "-")}`)
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview"
const MIN_RATING = Number(process.env.MIN_RATING || "9")
const SKIP_GEMINI = process.env.SKIP_GEMINI === "1"
const VIEWPORT = { width: 1440, height: 900 }
const TABLET_VIEWPORT = { width: 980, height: 760 }

const shots = []
const metrics = {}

function shotPath(id) {
  return resolve(OUT, `${String(shots.length + 1).padStart(2, "0")}-${id}.png`)
}

async function screenshot(page, id, description, options = {}) {
  const path = shotPath(id)
  await page.screenshot({ path, ...options })
  shots.push({ id, path, file: basename(path), description })
  console.log("captured", basename(path), "-", description)
}

async function box(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return { x: r.x, y: r.y, width: r.width, height: r.height, position: style.position, zIndex: style.zIndex }
  }, selector)
}

async function innerText(page, selector) {
  return await page.locator(selector).first().innerText().catch(() => null)
}

async function openWorkbench(page) {
  const btn = page.getByRole("button", { name: "Open workbench" }).first()
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(900)
  }
}

async function closeOverlayIfOpen(page, label) {
  const btn = page.getByRole("button", { name: label }).first()
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(250)
  }
}

async function captureDesktop(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}?fresh=1&ui-review=1`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.waitForTimeout(2400)

  const appNav = page.getByLabel("App navigation")
  metrics.initial = {
    appLeft: await box(page, '[data-boring-workspace-part="app-left-pane"]'),
    chat: await box(page, '[data-boring-workspace-part="chat-stage"]'),
    workbench: await box(page, '[data-boring-workspace-part="workbench"]'),
  }
  await screenshot(page, "desktop-left-bar", "Desktop default: app-left navigation, Workspaces/Chats sections, chat stage")

  const rowsBefore = await page.locator('[data-boring-workspace-part="app-session-row"]').count()
  await appNav.getByRole("button", { name: "New chat", exact: true }).click()
  await page.waitForTimeout(1200)
  const rowsAfter = await page.locator('[data-boring-workspace-part="app-session-row"]').count()
  metrics.newChat = { rowsBefore, rowsAfter, increments: rowsAfter > rowsBefore }
  await screenshot(page, "new-chat-created", "After clicking New chat in the left pane")

  await openWorkbench(page)
  metrics.workbenchOpen = {
    chat: await box(page, '[data-boring-workspace-part="chat-stage"]'),
    workbench: await box(page, '[data-boring-workspace-part="workbench"]'),
    appHideButton: await box(page, '[aria-label="Hide app navigation"]'),
    workspaceMenuButton: await box(page, '[aria-label="Hide workspace menu"]'),
  }
  await screenshot(page, "workbench-open", "Workbench open next to chat")

  await appNav.getByRole("button", { name: "Skills", exact: true }).click()
  await page.waitForTimeout(1000)
  metrics.skillsOverlay = {
    chat: await box(page, '[data-boring-workspace-part="chat-stage"]'),
    overlay: await box(page, '[data-boring-workspace-part="chat-left-overlay"]'),
    inner: await box(page, '[data-boring-workspace-part="chat-left-overlay"] > div'),
    workbench: await box(page, '[data-boring-workspace-part="workbench"]'),
    text: await innerText(page, '[data-boring-workspace-part="skills-page"]'),
  }
  await screenshot(page, "skills-overlay-workbench", "Skills overlay fills chat stage; workbench remains visible")
  await closeOverlayIfOpen(page, "Close skills")

  await appNav.getByRole("button", { name: "Plugins", exact: true }).click()
  await page.waitForTimeout(1000)
  metrics.pluginsOverlay = {
    chat: await box(page, '[data-boring-workspace-part="chat-stage"]'),
    overlay: await box(page, '[data-boring-workspace-part="chat-left-overlay"]'),
    inner: await box(page, '[data-boring-workspace-part="chat-left-overlay"] > div'),
    workbench: await box(page, '[data-boring-workspace-part="workbench"]'),
    text: await innerText(page, '[data-boring-workspace-part="plugins-overlay"]'),
  }
  await screenshot(page, "plugins-overlay-workbench", "External plugins overlay fills chat stage; workbench remains visible")
  await closeOverlayIfOpen(page, "Close plugins")

  await page.getByRole("button", { name: "Hide app navigation" }).click()
  await page.waitForTimeout(700)
  metrics.appNavCollapsed = {
    button: await box(page, '[aria-label="Open app navigation"]'),
    appLeft: await box(page, '[data-boring-workspace-part="app-left-pane"]'),
    chat: await box(page, '[data-boring-workspace-part="chat-stage"]'),
  }
  await screenshot(page, "app-nav-collapsed", "App-left pane collapsed; restore control fixed in place")
  await page.getByRole("button", { name: "Open app navigation" }).click()
  await page.waitForTimeout(600)

  await page.keyboard.press("ControlOrMeta+KeyK")
  await page.waitForTimeout(700)
  metrics.commandPaletteChats = { text: await innerText(page, '[role="dialog"]') }
  await screenshot(page, "palette-chats", "Command palette opened in Chats mode")
  await page.getByRole("button", { name: "Catalogs" }).click()
  await page.waitForTimeout(500)
  metrics.commandPaletteCatalogs = { text: await innerText(page, '[role="dialog"]') }
  await screenshot(page, "palette-catalogs", "Command palette Catalogs mode")
  await page.getByRole("button", { name: "Commands" }).click()
  await page.waitForTimeout(500)
  metrics.commandPaletteCommands = { text: await innerText(page, '[role="dialog"]') }
  await screenshot(page, "palette-commands", "Command palette Commands mode")

  await ctx.close()
}

async function captureTablet(browser) {
  const ctx = await browser.newContext({ viewport: TABLET_VIEWPORT, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}?fresh=1&ui-review=tablet`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.waitForTimeout(2400)
  await screenshot(page, "tablet-default", "Tablet viewport default layout", { fullPage: false })
  await openWorkbench(page)
  await page.waitForTimeout(700)
  await screenshot(page, "tablet-workbench", "Tablet viewport with workbench open", { fullPage: false })
  await ctx.close()
}

function geminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  try {
    return execFileSync("vault", ["kv", "get", "-field=api_key", "secret/agent/gemini"], { encoding: "utf8" }).trim()
  } catch (error) {
    throw new Error("GEMINI_API_KEY not set and vault lookup failed. Set SKIP_GEMINI=1 to capture screenshots only.")
  }
}

async function inlinePart(path) {
  const data = await readFile(path)
  return { inline_data: { mime_type: "image/png", data: data.toString("base64") } }
}

function prompt() {
  return `You are Gemini reviewing a production coding-agent workspace UI from screenshots.

Goal: give an honest design rating out of 10. Target is >= ${MIN_RATING}/10.

Design direction / constraints:
- Precise, calm, editorial, refined minimal, dark-first compatible.
- Conversation is the interface; chrome should be quiet and stable.
- No glassmorphism blur for app/workspace chrome; avoid soft drop shadows.
- Separation via borders and opacity. Radius ramp 6/8/10/12/16/24.
- Icons should feel from one system; left collapse controls use plain panel glyphs.
- Skills/Plugins overlays must cover the full chat area only, never the workbench.
- Workbench remains visible when open.
- Left nav sections should read Workspaces / Chats.
- Command palette should expose Chats, Catalogs, Commands as first-class modes.

DOM metrics collected by the script:
${JSON.stringify(metrics, null, 2)}

Review instructions:
1. Inspect every screenshot.
2. Use a RAW 0-10 production-design scale. Do NOT use a compressed scale. Do NOT write a lower formal rating while saying the UI clears a higher uncompressed bar.
3. Score each major area on the same raw 0-10 scale: left navigation, collapse chrome, chat overlay behavior, skills page, plugins page, command palette, workbench coexistence, responsive/tablet.
4. Give ONE overall raw rating in this exact line format: RATING: X.X/10
5. The RATING line must match your conclusion. If you think it clears the >= ${MIN_RATING}/10 bar, the RATING must be >= ${MIN_RATING}/10.
6. List P0/P1/P2 issues. P0/P1 should block claiming >9/10.
7. If overall rating is below ${MIN_RATING}, give the shortest concrete changes that would likely push it above ${MIN_RATING}.
8. If score is >= ${MIN_RATING}, say why it clears the bar and any remaining polish only.`
}

async function askGemini() {
  const key = geminiApiKey()
  const parts = [{ text: prompt() }]
  for (const shot of shots) {
    parts.push({ text: `\nScreenshot ${shot.file}: ${shot.description}` })
    parts.push(await inlinePart(shot.path))
  }
  const body = {
    contents: [{ parts }],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.25,
      thinkingConfig: { thinkingBudget: 8192 },
    },
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Gemini request failed ${response.status}: ${await response.text()}`)
  }
  const json = await response.json()
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n")?.trim()
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(json).slice(0, 1000)}`)
  const out = resolve(OUT, "gemini-review.md")
  await writeFile(out, text)
  const match = text.match(/RATING:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i)
  const rating = match ? Number(match[1]) : null
  await writeFile(resolve(OUT, "rating.json"), JSON.stringify({ rating, minRating: MIN_RATING, model: MODEL }, null, 2))
  console.log("gemini review", out)
  if (rating !== null) console.log(`rating ${rating}/10 (target >= ${MIN_RATING})`)
  if (rating !== null && rating < MIN_RATING) {
    process.exitCode = 2
  }
  return { text, rating }
}

async function run() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    await captureDesktop(browser)
    await captureTablet(browser)
  } finally {
    await browser.close()
  }
  const manifest = { baseUrl: BASE, outDir: OUT, viewport: VIEWPORT, tabletViewport: TABLET_VIEWPORT, shots, metrics }
  await writeFile(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2))
  console.log("manifest", resolve(OUT, "manifest.json"))
  if (!SKIP_GEMINI) {
    const result = await askGemini()
    console.log("\n--- Gemini summary ---\n")
    console.log(result.text)
  } else {
    console.log("SKIP_GEMINI=1 set; screenshots only")
  }
  console.log(`done. output: ${OUT}`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
