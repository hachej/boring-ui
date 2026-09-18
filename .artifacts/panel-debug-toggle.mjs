import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto('http://127.0.0.1:5202/', { waitUntil: 'networkidle', timeout: 120000 })

// Clear any persisted debug preference so this run starts from the default state.
await page.evaluate(() => {
  try { window.localStorage.removeItem('boring:app-runner:debug-visible') } catch {}
})

const openPanel = async () => page.evaluate(async () => (await fetch('/api/v1/ui/commands', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'openSurface', params: { kind: 'app-runner', target: 'guestbook' } }),
})).ok)

const opened = await openPanel()
if (!opened) throw new Error('failed to post Apps panel command')

const frameElement = page.locator('iframe').last()
await frameElement.waitFor({ state: 'attached', timeout: 30000 })
const frame = page.frames().find(candidate => candidate.url().includes('.apps.localhost:9878'))
if (!frame) throw new Error('sandboxed app frame did not navigate')
await frame.locator('text=Sign the guestbook').first().waitFor({ timeout: 30000 })

// --- Default view: app only, debug chrome absent ---
const debugToggle = page.getByRole('button', { name: 'Show app debug details' })
await debugToggle.waitFor({ timeout: 15000 })
const metadataCountBefore = await page.getByTestId('app-runner-metadata').count()
await page.screenshot({ path: '.artifacts/panel-app-only.png', fullPage: true })
console.log(JSON.stringify({
  step: 'default',
  metadataNodesPresent: metadataCountBefore,
  sandbox: await frameElement.getAttribute('sandbox'),
}, null, 2))

// --- Debug view: toggle on, app still visible ---
await debugToggle.click()
await page.getByTestId('app-runner-metadata').waitFor({ timeout: 15000 })
await page.getByTestId('app-runner-logs').waitFor({ timeout: 15000 })
await page.screenshot({ path: '.artifacts/panel-debug.png', fullPage: true })
console.log(JSON.stringify({
  step: 'debug',
  metadataText: await page.getByTestId('app-runner-metadata').innerText(),
  sandbox: await frameElement.getAttribute('sandbox'),
  frameStillVisible: await frameElement.isVisible(),
}, null, 2))

await browser.close()
