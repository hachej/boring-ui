import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto('http://127.0.0.1:5203/', { waitUntil: 'networkidle', timeout: 120000 })
const apps = page.getByText('Apps', { exact: true }).first()
if (await apps.count()) await apps.click()
await page.waitForTimeout(3000)
await page.screenshot({ path: '/home/ubuntu/projects/boring-ui-v2/.worktrees/app-runner-plugin/.artifacts/apps-panel.png', fullPage: true })
await browser.close()
