import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5230'
const API = BASE.replace('5230', '5231')
const api = []
const consoleErrors = []

const listSessions = async () => (await (await fetch(`${API}/api/v1/agents/default/sessions?limit=50`)).json()).sessions

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()

page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/v1/agents/')) api.push(`${r.method()} ${u.replace(BASE, '')}`)
})
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 200)))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)

const before = await listSessions()

// Start a NEW chat through the UI — this is the flow that misbehaves.
const newChat = page.getByRole('button', { name: /new chat/i }).first()
const clickedNewChat = await newChat.isVisible().catch(() => false)
if (clickedNewChat) {
  await newChat.click()
  await page.waitForTimeout(2500)
}

api.length = 0 // only record what happens from here

const editor = page.locator('[contenteditable="true"], textarea').first()
await editor.waitFor({ timeout: 20000 })
await editor.click()
await editor.type('probe-alpha')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')

await page.waitForTimeout(18000)

const after = await listSessions()
const created = after.filter((s) => !before.some((b) => b.ref.sessionId === s.ref.sessionId))

const bodyText = await page.locator('body').innerText().catch(() => '')
const promptShown = bodyText.includes('probe-alpha')

console.log(JSON.stringify({
  clickedNewChat,
  sessionsBefore: before.length,
  sessionsAfter: after.length,
  createdCount: created.length,
  created: created.map((s) => ({ id: s.ref.sessionId, title: s.title, turnCount: s.turnCount, status: s.status })),
  promptShownInUi: promptShown,
  consoleErrors: consoleErrors.slice(0, 8),
  apiCallsAfterSend: api,
}, null, 2))

await page.screenshot({ path: '/home/ubuntu/.cache/repro-first-send.png', fullPage: true }).catch(() => {})
await browser.close()
