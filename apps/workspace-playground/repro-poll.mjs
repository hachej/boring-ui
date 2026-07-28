import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:5230'
const API = 'http://127.0.0.1:5231'
const api = []

const listSessions = async () => (await (await fetch(`${API}/api/v1/agents/default/sessions?limit=50`)).json()).sessions

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/v1/agent')) api.push(`${Date.now() % 100000} ${r.method()} ${u.replace(BASE, '')}`)
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const before = await listSessions()

const newChat = page.getByRole('button', { name: /new chat/i }).first()
if (await newChat.isVisible().catch(() => false)) {
  await newChat.click()
  await page.waitForTimeout(2500)
}

const editor = page.locator('[contenteditable="true"], textarea').first()
await editor.waitFor({ timeout: 20000 })
await editor.click()
await editor.type('poll-probe')
await page.keyboard.press('Enter')

// Poll the new session's state while the UI is still open.
const timeline = []
let sid = null
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(3000)
  const after = await listSessions()
  const created = after.filter((s) => !before.some((b) => b.ref.sessionId === s.ref.sessionId))
  if (created.length && !sid) sid = created[0].ref.sessionId
  if (sid) {
    const st = await (await fetch(`${API}/api/v1/agents/default/sessions/${sid}/state`)).json().catch(() => ({}))
    const msgs = st?.state?.messages ?? []
    const summary = after.find((s) => s.ref.sessionId === sid)
    timeline.push({
      t: (i + 1) * 3,
      seq: st?.seq,
      status: st?.state?.status,
      msgs: msgs.length,
      roles: msgs.map((m) => m.role).join(','),
      summaryTurns: summary?.turnCount,
      summaryReply: summary?.hasAssistantReply,
    })
  }
}

const bodyText = await page.locator('body').innerText().catch(() => '')
console.log(JSON.stringify({
  sessionId: sid,
  uiShowsPrompt: bodyText.includes('poll-probe'),
  timeline,
  apiCalls: api.slice(-14),
}, null, 2))

await browser.close()
