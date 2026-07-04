import { expect, test, type Page } from '@playwright/test'

const TASK_ID = 'boring-ui-v2-reorg-2omj'
const GOOGLE_BUTTON_NAME = 'Continue with Google'
const CALLBACK_PATH = '/auth/callback/google?code=mock-google-code&state=mock-google-state'

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ level: 'info', task: TASK_ID, event, ...fields }))
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

async function installGoogleAuthSmokeMocks(page: Page, baseURL: string | undefined) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    log('google-signup.route.visited', { url: frame.url() })
  })

  page.on('pageerror', (error) => {
    log('google-signup.pageerror', {
      name: error.name,
      message: error.message,
    })
  })

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    log('google-signup.console.error', { text: msg.text() })
  })

  await page.route('https://accounts.google.com/**', async (route) => {
    log('google-signup.external-google-redirect', {
      url: route.request().url(),
      method: route.request().method(),
    })

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>mock google oauth boundary</body></html>',
    })
  })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (baseURL && url.origin !== new URL(baseURL).origin) {
      return route.continue()
    }

    const path = url.pathname

    if (path === '/api/v1/config') {
      const response = await route.fetch()
      const payload = await response.json()
      const googleOauth = (payload as { features?: { googleOauth?: boolean } }).features?.googleOauth ?? null
      log('google-signup.runtime-config', {
        path,
        googleOauth,
      })
      return route.fulfill({ response })
    }

    if (path === '/auth/get-session') {
      return route.fulfill(json(null))
    }

    if (path === '/api/v1/workspaces' && request.method() === 'GET') {
      return route.fulfill(json({ workspaces: [] }))
    }

    return route.continue()
  })
}

async function visit(page: Page, route: string) {
  log('google-signup.visit.start', { route })
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
  log('google-signup.visit.complete', {
    route,
    status: response?.status() ?? null,
    finalUrl: page.url(),
  })
  return response
}

async function readGoogleButtonState(page: Page, route: string) {
  const button = page.getByRole('button', { name: GOOGLE_BUTTON_NAME })
  const count = await button.count()
  const visible = count > 0
    ? await button.first().isVisible().catch(() => false)
    : false

  log('google-signup.button-state', {
    route,
    rendered: count > 0,
    visible,
    count,
  })

  return { button, count, visible }
}

test.describe('google signup smoke', () => {
  test('stock sign-in shows Google and real social-init redirects toward Google', async ({ page, baseURL }) => {
    await installGoogleAuthSmokeMocks(page, baseURL)

    await test.step('stock sign-in shows Google button when enabled by real runtime config', async () => {
      const response = await visit(page, '/auth/signin')
      expect(response?.status(), 'expected /auth/signin to be served by the app shell').toBe(200)
      await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByLabel('Password')).toBeVisible()

      const { button, visible } = await readGoogleButtonState(page, '/auth/signin')
      expect(
        visible,
        'expected stock sign-in to render Continue with Google when the live runtime config exposes features.googleOauth=true',
      ).toBe(true)
      await expect(button).toBeVisible()
    })

    await test.step('clicking Google uses the real auth route and redirects toward Google', async () => {
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/auth/sign-in/social'
      })

      await page.getByRole('button', { name: GOOGLE_BUTTON_NAME }).click()
      const socialInit = await responsePromise
      const socialInitUrl = new URL(socialInit.url())

      log('google-signup.social-init.response', {
        path: socialInitUrl.pathname,
        status: socialInit.status(),
      })

      expect(socialInit.status(), 'expected real /auth/sign-in/social request to succeed').toBe(200)
      await page.waitForURL(/accounts\.google\.com/, { timeout: 15_000 })

      log('google-signup.social-init.boundary', {
        finalUrl: page.url(),
        manualBoundary: 'Live Google auth completion still requires a real provider redirect + valid callback exchange.',
      })
    })
  })

  test('stock sign-up shows Google, invite-token sign-up hides it, and callback path is real', async ({ page, baseURL }) => {
    await installGoogleAuthSmokeMocks(page, baseURL)

    await test.step('normal stock sign-up shows Google button', async () => {
      const response = await visit(page, '/auth/signup')
      expect(response?.status(), 'expected /auth/signup to be served by the app shell').toBe(200)
      await expect(page.getByLabel('Name')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()

      const { button, visible } = await readGoogleButtonState(page, '/auth/signup')
      expect(
        visible,
        'expected stock sign-up to render Continue with Google when the live runtime config exposes features.googleOauth=true',
      ).toBe(true)
      await expect(button).toBeVisible()
    })

    await test.step('invite-token sign-up hides Google button and keeps email fields', async () => {
      const inviteRoute = '/auth/signup?invite_token=invite-smoke-token'
      const response = await visit(page, inviteRoute)
      expect(response?.status(), 'expected invite-token sign-up route to be served by the app shell').toBe(200)
      await expect(page.getByLabel('Name')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()

      const { count, visible } = await readGoogleButtonState(page, inviteRoute)
      expect(
        count,
        'expected invite-token sign-up to stay email-only and hide Continue with Google',
      ).toBe(0)
      expect(visible).toBe(false)
    })

    await test.step('callback path is reachable through the real auth stack', async () => {
      const callbackResponse = await page.request.get(CALLBACK_PATH, {
        headers: { accept: 'text/html' },
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      const redirectLocation = callbackResponse.headers()['location'] ?? null

      log('google-signup.callback.reached', {
        route: CALLBACK_PATH,
        status: callbackResponse.status(),
        location: redirectLocation,
      })

      expect(
        [302, 400, 401],
        'expected /auth/callback/google to be mounted and handled by the real auth stack; bad state should still produce an auth response instead of 404/500',
      ).toContain(callbackResponse.status())

      if (callbackResponse.status() === 302 && redirectLocation) {
        const redirectUrl = new URL(redirectLocation, baseURL)
        await visit(page, `${redirectUrl.pathname}${redirectUrl.search}`)
        await expect(page.getByText('Authentication error')).toBeVisible({ timeout: 10_000 })
      }
    })
  })
})
