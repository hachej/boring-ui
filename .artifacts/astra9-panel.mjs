import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const responses = []
page.on('response', response => {
  if (response.url().includes('.apps.localhost:9878/')) responses.push({ url: response.url(), status: response.status() })
})
await page.goto('http://127.0.0.1:5202/', { waitUntil: 'networkidle', timeout: 120000 })
const opened = await page.evaluate(async () => (await fetch('/api/v1/ui/commands', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'openSurface', params: { kind: 'app-runner', target: 'guestbook' } }),
})).ok)
if (!opened) throw new Error('failed to post Apps panel command')
await page.getByTestId('app-runner-metadata').waitFor({ timeout: 30000 })
console.log('iframes', await page.locator('iframe').evaluateAll(elements => elements.map(element => ({ title: element.title, src: element.src, sandbox: element.getAttribute('sandbox') }))))
const frameElement = page.locator('iframe').last()
await frameElement.waitFor({ state: 'visible', timeout: 30000 })
const frame = page.frames().find(candidate => candidate.url().includes('.apps.localhost:9878/'))
if (!frame) throw new Error('sandboxed app frame did not navigate')
await frame.locator('body').waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)
const body = (await frame.locator('body').innerText()).trim()
const sandbox = await frameElement.getAttribute('sandbox')
await page.screenshot({ path: '.artifacts/astra9-panel.png', fullPage: true })
console.log(JSON.stringify({ sandbox, body, responses }, null, 2))
await browser.close()
