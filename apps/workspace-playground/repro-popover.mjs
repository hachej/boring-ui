import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:5230'
const API = 'http://127.0.0.1:5231'
const api = []
const consoleErrors = []

const listSessions = async () => (await (await fetch(`${API}/api/v1/agents/default/sessions?limit=50`)).json()).sessions

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/v1/agent')) api.push(`${r.method()} ${u.replace(BASE, '')}`)
})
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 200)))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const before = await listSessions()

const quick = page.getByLabel('Quick chat').first()
const found = await quick.isVisible().catch(() => false)
if (found) {
  // The action only surfaces on hover of its row; force past the overlay.
  await page.getByText('New chat', { exact: true }).first().hover().catch(() => {})
  await page.waitForTimeout(300)
  await quick.click({ force: true })
  await page.waitForTimeout(4000)
}

// Is a detached popover actually on screen, and does it host a composer?
const popoverText = await page.locator('body').innerText().catch(() => '')
const composers = await page.locator('[contenteditable="true"], textarea').count()

// Try to type into the popover's composer (should be the last one mounted).
let sent = false
if (composers > 0) {
  const editor = page.locator('[contenteditable="true"], textarea').last()
  try {
    await editor.click({ timeout: 5000 })
    await editor.type('popover-probe')
    await page.keyboard.press('Enter')
    sent = true
  } catch { /* composer not interactable */ }
}
await page.waitForTimeout(12000)

const after = await listSessions()
const created = after.filter((s) => !before.some((b) => b.ref.sessionId === s.ref.sessionId))
let states = []
for (const s of created) {
  const st = await (await fetch(`${API}/api/v1/agents/default/sessions/${s.ref.sessionId}/state`)).json().catch(() => ({}))
  states.push({
    id: s.ref.sessionId.slice(0, 8),
    title: s.title,
    seq: st?.seq,
    msgs: (st?.state?.messages ?? []).length,
    roles: (st?.state?.messages ?? []).map((m) => m.role).join(','),
  })
}

console.log(JSON.stringify({
  quickChatControlFound: found,
  composersOnPage: composers,
  typedIntoComposer: sent,
  promptVisibleInUi: popoverText.includes('popover-probe'),
  createdSessions: created.length,
  states,
  consoleErrors: consoleErrors.slice(0, 6),
  apiCalls: api.slice(-10),
}, null, 2))

await page.screenshot({ path: '/home/ubuntu/.cache/repro-popover.png', fullPage: true }).catch(() => {})
await browser.close()
