import { test, expect } from '@playwright/test'

const BEAD_ID = 'boring-ui-v2-ofhw'

function log(event: string, data?: Record<string, unknown>) {
  const entry = {
    level: 30,
    time: new Date().toISOString(),
    event,
    beadId: BEAD_ID,
    ...data,
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry))
}

test.describe('Playground smoke', () => {
  test('boots dev server and returns HTTP 200', async ({ page }) => {
    log('smoke.start', { test: 'http-200' })
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    log('smoke.pass', { test: 'http-200' })
  })

  test('sign in as dev@local and land on workspace', async ({ page }) => {
    log('smoke.start', { test: 'sign-in-flow' })

    await page.goto('/auth/signin')
    await expect(page.getByLabel(/email/i)).toBeVisible()

    await page.getByLabel(/email/i).fill('dev@local')
    await page.getByLabel(/password/i).fill('dev')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), {
      timeout: 10_000,
    })

    log('smoke.signed-in', { url: page.url() })

    const title = await page.title()
    expect(title).toBeTruthy()

    log('smoke.pass', { test: 'sign-in-flow' })
  })

  test('authenticated user sees workspace shell', async ({ page }) => {
    log('smoke.start', { test: 'workspace-shell' })

    await page.goto('/auth/signin')
    await page.getByLabel(/email/i).fill('dev@local')
    await page.getByLabel(/password/i).fill('dev')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), {
      timeout: 10_000,
    })

    await expect(page.locator('.bg-background')).toBeVisible({ timeout: 5_000 })

    log('smoke.pass', { test: 'workspace-shell' })
  })
})
