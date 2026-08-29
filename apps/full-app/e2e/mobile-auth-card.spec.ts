import { expect, test } from '@playwright/test'

/**
 * #1465 — at 390x844 the public (no-auth) landing rendered its sign-in card
 * with a zero bounding box, and the workspace top bar's Sign in button lives in
 * the collapsed app-left pane in the plugin-tabs layout, so a phone had no way
 * to sign in or sign up at all. The dock must stay reachable at phone widths.
 */

const IPHONE_15 = { width: 390, height: 844 }
const MIN_TOUCH_TARGET = 44

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

test.use({ viewport: IPHONE_15 })

test('mobile 390x844: public landing exposes a usable sign-in/sign-up form', async ({ page, baseURL }) => {
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
    const path = url.pathname

    if (path === '/api/v1/config') {
      return route.fulfill(json({
        appId: 'boring-app',
        appName: 'Boring Full App',
        appLogo: null,
        apiBase: baseURL,
        features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: false },
      }))
    }
    // Unauthenticated: this is the surface the issue is about.
    if (path === '/auth/get-session') return route.fulfill(json(null))
    if (path === '/api/v1/workspaces') return route.fulfill(json({ workspaces: [] }))
    if (path === '/api/v1/ui/state' && request.method() === 'PUT') return route.fulfill({ status: 204, body: '' })
    if (path === '/api/v1/ui/commands/next') return route.fulfill(json([]))
    if (path === '/api/v1/fs/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: init\ndata: {"v":1}\n\n' })
    }
    if (path.startsWith('/api/v1/agents/')) return route.fulfill(json({}))
    return route.continue()
  })

  await page.goto('/')

  const dock = page.getByRole('complementary', { name: 'Sign in' })
  await expect(dock).toBeVisible()

  // The regression was a zero-size box, so assert real pixels, not just
  // attachment — and that the sheet sits inside the phone viewport.
  const box = await dock.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(300)
  expect(box!.height).toBeGreaterThan(150)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(IPHONE_15.width + 1)

  // Sign in / Sign up are both reachable, with 44px touch targets.
  for (const name of ['Sign in', 'Sign up']) {
    const tab = dock.getByRole('button', { name, exact: true })
    await expect(tab).toBeVisible()
    const tabBox = await tab.boundingBox()
    expect(tabBox!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  }

  // The form is actually usable: focus and type into the credentials.
  const email = dock.getByPlaceholder('Email')
  await expect(email).toBeVisible()
  await email.click()
  await email.fill('mobile@example.com')
  await expect(email).toHaveValue('mobile@example.com')
  await expect(email).toBeFocused()

  const password = dock.getByPlaceholder('Password')
  await password.fill('hunter2hunter2')
  await expect(password).toHaveValue('hunter2hunter2')

  const submit = dock.getByRole('button', { name: 'Continue with email' })
  await expect(submit).toBeVisible()
  await expect(submit).toBeEnabled()
  const submitBox = await submit.boundingBox()
  expect(submitBox!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)

  // Sign-up mode adds the Name field and stays inside the sheet.
  await dock.getByRole('button', { name: 'Sign up', exact: true }).click()
  const name = dock.getByPlaceholder('Name')
  await expect(name).toBeVisible()
  await name.fill('Mobile User')
  await expect(dock.getByRole('button', { name: 'Create account' })).toBeVisible()
})
