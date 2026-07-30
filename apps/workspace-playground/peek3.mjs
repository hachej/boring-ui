import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await (await b.newContext()).newPage()
const calls = []
p.on('request', r => { const u=r.url(); if (u.includes('/api/v1/agent')) calls.push(`${r.method()} ${u.split('/api/v1')[1]}`) })
const errs = []
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)) })
p.on('pageerror', e => errs.push('PAGEERROR: '+String(e).slice(0,200)))
await p.goto('http://127.0.0.1:5262', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(11000)

const before = await p.locator('[data-boring-workspace-part="app-session-row"]').count()
await p.getByRole('button', { name: /new chat/i }).first().click()
await p.waitForTimeout(3000)
const afterClick = await p.locator('[data-boring-workspace-part="app-session-row"]').count()

calls.length = 0
const ed = p.locator('[contenteditable="true"], textarea').first()
await ed.click(); await ed.type('probe-after-clean'); await p.keyboard.press('Enter')
await p.waitForTimeout(15000)

console.log(JSON.stringify({
  rowsBefore: before, rowsAfterNewChatClick: afterClick,
  callsAfterSend: calls, errors: errs,
  promptVisible: (await p.locator('body').innerText()).includes('probe-after-clean'),
}, null, 2))
await b.close()
