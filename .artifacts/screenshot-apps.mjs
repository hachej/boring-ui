import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto('http://127.0.0.1:5202/', { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForTimeout(1000)
const opened = await page.evaluate(async () => {
  const response = await fetch('/api/v1/ui/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'openSurface', params: { kind: 'app-runner', target: 'guestbook' } }),
  })
  return response.ok
})
if (!opened) throw new Error('failed to post Apps panel command')
await page.getByTestId('app-runner-metadata').waitFor({ timeout: 30000 })
await page.screenshot({ path: '/home/ubuntu/projects/boring-ui-v2/.worktrees/app-runner-plugin/.artifacts/apps-panel.png', fullPage: true })
await browser.close()
