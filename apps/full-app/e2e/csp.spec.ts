import { expect, test } from '@playwright/test'

const TASK_ID = 'boring-ui-v2-o8v6'

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ level: 'info', task: TASK_ID, event, ...fields }))
}

test('csp header has nonce and blocks inline script + cross-origin connect', async ({ page }) => {
  const consoleLines: string[] = []
  page.on('console', (msg) => {
    consoleLines.push(msg.text())
  })

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.warn(
        `[csp-violation] effective=${event.effectiveDirective} blocked=${event.blockedURI}`,
      )
    })
  })

  log('csp.start')

  const response = await page.goto('/')
  expect(response).toBeTruthy()
  expect(response?.status()).toBe(200)

  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/)
  expect(csp).toMatch(/style-src[^;]*'nonce-[^']+'/)
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")

  const inlineExecuted = await page.evaluate(async () => {
    ;(window as Window & { __inlineExecuted?: boolean }).__inlineExecuted = false
    const script = document.createElement('script')
    script.textContent = 'window.__inlineExecuted = true'
    document.body.appendChild(script)
    await new Promise((resolve) => setTimeout(resolve, 100))
    return Boolean((window as Window & { __inlineExecuted?: boolean }).__inlineExecuted)
  })
  expect(inlineExecuted).toBe(false)

  const crossOriginConnectBlocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/csp-connect-check', {
        method: 'GET',
        mode: 'cors',
      })
      return false
    } catch {
      return true
    }
  })
  expect(crossOriginConnectBlocked).toBe(true)

  expect(consoleLines.some((line) => line.includes('csp-violation'))).toBe(true)
  expect(consoleLines.some((line) => line.includes('effective=script-src'))).toBe(true)
  expect(consoleLines.some((line) => line.includes('effective=connect-src'))).toBe(true)

  log('csp.complete', { violations: consoleLines.filter((line) => line.includes('csp-violation')).length })
})
