import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * #1465 — at 390x844 the public (no-auth) landing rendered its sign-in card
 * with a zero bounding box, and the workspace top bar's Sign in button lives in
 * the collapsed app-left pane in the plugin-tabs layout, so a phone had no way
 * to sign in or sign up at all.
 *
 * The dock is now a bottom sheet whose height IS the band the shell reserves,
 * so it can never sit on top of the hero/composer. These tests pin that
 * invariant at the viewport shapes that break naive bottom-sheet layouts:
 * a tall phone, a short landscape phone, and a keyboard-reduced viewport.
 */

const PHONE_PORTRAIT = { width: 390, height: 844 }
const PHONE_LANDSCAPE = { width: 667, height: 375 }
const MIN_TOUCH_TARGET = 44
const KEYBOARD_INSET_PX = 336

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockPublicLanding(page: Page, baseURL: string | undefined) {
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
}

type Rect = { x: number; y: number; width: number; height: number }

async function rectOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox()
  expect(box, `${locator} has no bounding box`).not.toBeNull()
  return box!
}

/**
 * The regression this file exists for is "present in the DOM but not usable",
 * so every check is geometric: a real box, inside the viewport, not covered by
 * anything, and hit-testable at its own centre.
 */
async function expectUnobscured(page: Page, locator: Locator, label: string) {
  const rect = await rectOf(locator)
  const viewport = page.viewportSize()!
  expect(rect.width, `${label} width`).toBeGreaterThan(0)
  expect(rect.height, `${label} height`).toBeGreaterThan(0)
  expect(rect.x, `${label} left edge`).toBeGreaterThanOrEqual(0)
  expect(rect.y, `${label} top edge`).toBeGreaterThanOrEqual(0)
  expect(rect.x + rect.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1)
  expect(rect.y + rect.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1)

  // elementFromPoint at the centre must land inside the element itself — this
  // is what catches a fixed sheet painted over it.
  const hit = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    if (!top) return { covered: true, by: '<nothing>' }
    if (el.contains(top) || top.contains(el)) return { covered: false, by: '' }
    const covering = top.closest('[class*="public-auth"]') ?? top
    return { covered: true, by: covering.className?.toString().slice(0, 80) ?? top.tagName }
  })
  expect(hit.covered, `${label} is covered by ${hit.by}`).toBe(false)
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * The invariant the fix is built on: the shell reserves exactly the sheet's
 * band, so nothing the hero column can display ever lands underneath the sheet.
 *
 * On a viewport too short to show the whole hero, the column overflows — but it
 * overflows into its own `overflow-y: auto` scroller, whose visible window ends
 * where the sheet begins. So the honest contract is "scroll it into view, then
 * it is genuinely unobscured", and the test proves the scroll escape exists
 * rather than assuming it.
 */
async function expectComposerReachable(page: Page, mode: string) {
  const dock = page.getByRole('complementary', { name: 'Sign in' })
  const composer = page.locator('[data-boring-agent-part="composer-rail"]')
  await expect(dock).toBeVisible()
  await expect(composer).toBeVisible()

  // If the hero does not fit, the column must be a real scroller — otherwise
  // "scroll it into view" would be a lie.
  const scroller = await composer.evaluate((el) => {
    let node: HTMLElement | null = el.parentElement
    while (node) {
      const style = getComputedStyle(node)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return { found: true, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
      }
      node = node.parentElement
    }
    return { found: false, scrollHeight: 0, clientHeight: 0 }
  })
  expect(scroller.found, `${mode}: hero column has no scroll escape`).toBe(true)

  await composer.scrollIntoViewIfNeeded()

  const dockRect = await rectOf(dock)
  const composerRect = await rectOf(composer)
  expect(
    overlaps(dockRect, composerRect),
    `${mode}: sheet ${JSON.stringify(dockRect)} overlaps composer ${JSON.stringify(composerRect)}`,
  ).toBe(false)

  await expectUnobscured(page, composer, `${mode}: composer`)
  await expectUnobscured(page, dock, `${mode}: sign-in sheet`)
}

test.describe('#1465 public landing auth sheet', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await mockPublicLanding(page, baseURL)
  })

  test('390x844: the sign-in form is visible, 44px, and typeable', async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT)
    await page.goto('/')

    const dock = page.getByRole('complementary', { name: 'Sign in' })
    await expectUnobscured(page, dock, 'sign-in sheet')

    const dockRect = await rectOf(dock)
    expect(dockRect.width).toBe(PHONE_PORTRAIT.width)
    // Docked to the bottom edge, not floating off-screen.
    expect(Math.round(dockRect.y + dockRect.height)).toBe(PHONE_PORTRAIT.height)

    // Every interactive control in the sheet clears the 44px touch target —
    // measured, not assumed.
    const controls = dock.locator('button, input')
    const controlCount = await controls.count()
    expect(controlCount).toBeGreaterThanOrEqual(5)
    for (let index = 0; index < controlCount; index += 1) {
      const control = controls.nth(index)
      const label = (await control.getAttribute('placeholder')) ?? (await control.innerText().catch(() => '')) ?? `control ${index}`
      const rect = await rectOf(control)
      expect(rect.height, `${label} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }

    const email = dock.getByPlaceholder('Email')
    await email.click()
    await email.fill('mobile@example.com')
    await expect(email).toHaveValue('mobile@example.com')
    await expect(email).toBeFocused()

    const password = dock.getByPlaceholder('Password')
    await password.fill('hunter2hunter2')
    await expect(password).toHaveValue('hunter2hunter2')

    const submit = dock.getByRole('button', { name: 'Continue with email' })
    await expect(submit).toBeEnabled()
    await expectUnobscured(page, submit, 'submit button')

    await expectComposerReachable(page, '390x844 sign-in')
  })

  test('390x844: sign-up mode keeps every field inside the sheet', async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT)
    await page.goto('/')

    const dock = page.getByRole('complementary', { name: 'Sign in' })
    await dock.getByRole('button', { name: 'Sign up', exact: true }).click()

    const dockRect = await rectOf(dock)
    for (const placeholder of ['Name', 'Email', 'Password']) {
      const field = dock.getByPlaceholder(placeholder)
      await expect(field).toBeVisible()
      const rect = await rectOf(field)
      // Inside the sheet's own box, not spilling past its top edge.
      expect(rect.y, `${placeholder} top`).toBeGreaterThanOrEqual(dockRect.y - 1)
      expect(rect.y + rect.height, `${placeholder} bottom`).toBeLessThanOrEqual(dockRect.y + dockRect.height + 1)
      expect(rect.height, `${placeholder} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
    await expect(dock.getByRole('button', { name: 'Create account' })).toBeVisible()

    await expectComposerReachable(page, '390x844 sign-up')
  })

  // The blocker the thermo gate reproduced: at 667x375 the sheet's content
  // height (265px sign-in / 293px sign-up) exceeded the reserved band, the
  // composer sat behind the sheet, and the shell has no scroll escape
  // (body overflow is hidden). The sheet now caps at the reserved band and
  // scrolls internally instead.
  test('667x375 landscape: the composer stays reachable in both modes', async ({ page }) => {
    await page.setViewportSize(PHONE_LANDSCAPE)
    await page.goto('/')

    await expectComposerReachable(page, '667x375 sign-in')

    const dock = page.getByRole('complementary', { name: 'Sign in' })
    const dockRect = await rectOf(dock)
    // The band is capped, so the sheet cannot eat the short viewport.
    expect(dockRect.height).toBeLessThanOrEqual(Math.round(PHONE_LANDSCAPE.height * 0.45) + 1)

    // The form is still fully reachable — by scrolling inside the sheet, not by
    // scrolling a page that cannot scroll.
    const card = dock.locator('.public-auth-card')
    const scroll = await card.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(scroll.scrollHeight).toBeGreaterThan(0)
    const submit = dock.getByRole('button', { name: 'Continue with email' })
    await submit.scrollIntoViewIfNeeded()
    await expectUnobscured(page, submit, '667x375 submit button')

    const email = dock.getByPlaceholder('Email')
    await email.scrollIntoViewIfNeeded()
    await email.fill('landscape@example.com')
    await expect(email).toHaveValue('landscape@example.com')

    await dock.getByRole('button', { name: 'Sign up', exact: true }).click()
    await expect(dock.getByPlaceholder('Name')).toBeVisible()
    await expectComposerReachable(page, '667x375 sign-up')
  })

  // Headless Chromium has no software keyboard, so the keyboard is simulated
  // through the exact contract the shell consumes: `--keyboard-inset`, written
  // on <html> by `useKeyboardInset()` from `visualViewport` (iOS never shrinks
  // the layout viewport, so this variable is the only signal there).
  test('390x844 with the keyboard open: the sheet rides above the keyboard', async ({ page }) => {
    await page.setViewportSize(PHONE_PORTRAIT)
    await page.goto('/')

    const dock = page.getByRole('complementary', { name: 'Sign in' })
    await expect(dock).toBeVisible()
    const closedRect = await rectOf(dock)

    await page.evaluate((inset) => {
      document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`)
    }, KEYBOARD_INSET_PX)
    await page.waitForFunction(
      (closedBottom) => {
        const el = document.querySelector('.public-auth-dock')
        if (!el) return false
        return Math.round(el.getBoundingClientRect().bottom) < closedBottom
      },
      Math.round(closedRect.y + closedRect.height),
    )

    const openRect = await rectOf(dock)
    // Sitting on top of the keyboard strip, not underneath it.
    expect(Math.round(openRect.y + openRect.height)).toBe(PHONE_PORTRAIT.height - KEYBOARD_INSET_PX)
    // And still smaller than the space the keyboard left behind.
    expect(openRect.height).toBeLessThanOrEqual(PHONE_PORTRAIT.height - KEYBOARD_INSET_PX)

    // The composer is still not trapped behind it.
    await expectComposerReachable(page, '390x844 keyboard open')

    const email = dock.getByPlaceholder('Email')
    await email.fill('keyboard@example.com')
    await expect(email).toHaveValue('keyboard@example.com')
  })
})
