import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await (await b.newContext()).newPage()
const errs = []
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,200)) })
p.on('pageerror', e => errs.push('PAGEERROR: '+String(e).slice(0,300)))
await p.goto('http://127.0.0.1:5262', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(12000)
const text = (await p.locator('body').innerText().catch(()=>'')).slice(0,300)
const composers = await p.locator('[contenteditable="true"], textarea').count()
const newChat = await p.getByRole('button',{name:/new chat/i}).count()
console.log(JSON.stringify({ bodyTextSample: text, composers, newChatButtons: newChat, errors: errs }, null, 2))
await b.close()
