import { chromium } from '@playwright/test'

// Proves the stable-session-id claim end to end, in a real browser against a
// real server: the id the client mints IS the id the server persists, no
// adoption happens, and the first message still gets a reply.
const BASE = 'http://127.0.0.1:5240'
const API = 'http://127.0.0.1:5241'

const listSessions = async () => (await (await fetch(`${API}/api/v1/agents/default/sessions?limit=50`)).json()).sessions

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()

const api = []
const consoleErrors = []
let firstSendBody = null

page.on('request', (r) => {
  const u = r.url()
  if (!u.includes('/api/v1/agent')) return
  api.push(`${r.method()} ${u.replace(BASE, '')}`)
  if (u.includes('native-prompt') && r.method() === 'POST') {
    try { firstSendBody = JSON.parse(r.postData() ?? '{}') } catch { /* ignore */ }
  }
})
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 160)))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
// Vite re-optimizes deps on first load and invalidates the page; reload once
// after it settles or the app never mounts.
await page.waitForTimeout(9000)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const before = await listSessions()

const newChat = page.getByRole('button', { name: /new chat/i }).first()
if (await newChat.isVisible().catch(() => false)) {
  await newChat.click()
  await page.waitForTimeout(2500)
}

// Capture the id the CLIENT is using before it sends anything.
const idBeforeSend = await page.evaluate(() => {
  const el = document.querySelector('[data-boring-workspace-part="app-session-row"][data-boring-session-state="active"]')
  return el?.getAttribute('data-session-id') ?? null
})

const editor = page.locator('[contenteditable="true"], textarea').first()
await editor.waitFor({ timeout: 20000 })
await editor.click()
await editor.type('stable-id-probe')
await page.keyboard.press('Enter')
await page.waitForTimeout(18000)

const after = await listSessions()
const created = after.filter((s) => !before.some((b) => b.ref.sessionId === s.ref.sessionId))
const serverId = created[0]?.ref.sessionId ?? null

let state = {}
if (serverId) {
  state = await (await fetch(`${API}/api/v1/agents/default/sessions/${serverId}/state`)).json().catch(() => ({}))
}
const msgs = state?.state?.messages ?? []

// The id the client asked for, taken from the wire itself.
const requestedId = firstSendBody?.nativeSessionStart?.desiredSessionId
  ?? firstSendBody?.nativeSessionStart?.sessionId
  ?? firstSendBody?.sessionId
  ?? null

console.log(JSON.stringify({
  idBeforeSend,
  requestedIdOnWire: requestedId,
  serverSessionId: serverId,
  ID_IS_STABLE: Boolean(requestedId && serverId && requestedId === serverId),
  NO_LOCAL_PREFIX: requestedId ? !String(requestedId).startsWith('local-') : null,
  replyArrived: msgs.some((m) => m.role === 'assistant'),
  messageRoles: msgs.map((m) => m.role).join(','),
  createdSessionCount: created.length,
  consoleErrors,
  nativePromptCalls: api.filter((c) => c.includes('native-prompt')).length,
  firstSendKeys: firstSendBody ? Object.keys(firstSendBody) : null,
  nativeStartKeys: firstSendBody?.nativeSessionStart ? Object.keys(firstSendBody.nativeSessionStart) : null,
}, null, 2))

await browser.close()
