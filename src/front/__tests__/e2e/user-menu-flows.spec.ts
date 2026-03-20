import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const json = (value: unknown) => JSON.stringify(value)

const trackApiRequests = (page: Page) => {
  const requests: { method: string; pathname: string }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/') || url.pathname === '/auth/logout') {
      requests.push({ method: request.method(), pathname: url.pathname })
    }
  })
  return requests
}

const fulfillJson = (route: Route, status: number, body: unknown) => {
  route.fulfill({
    status,
    contentType: 'application/json',
    body: json(body),
  })
}

const stubCapabilities = async (page: Page) => {
  await page.route('**/api/capabilities', (route) =>
    fulfillJson(route, 200, {
      version: 'test',
      features: {
        files: true,
        git: true,
        pty: true,
        chat_claude_code: true,
        approval: true,
        pi: true,
      },
      routers: [],
    }),
  )
}

const waitForUserMenuButton = async (page: Page) => {
  // Wait for DockView to render before looking for UserMenu inside the sidebar.
  await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })

  const button = page.locator('[aria-label="User menu"]').first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await button.waitFor({ state: 'visible', timeout: 10000 })
      return button
    } catch (error) {
      if (attempt === 2) throw error
      await page.reload()
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
    }
  }
  return button
}

test.describe('User Menu Control-Plane Flows', () => {
  // These flows involve prompt/dialog interactions + full-page navigation; give the suite
  // extra headroom under CI-like load.
  test.describe.configure({ timeout: 60_000 })

  // The default sidebar layout splits vertical space between data-catalog and filetree.
  // Use a taller viewport so the UserMenu footer stays visible.
  test.use({ viewport: { width: 1280, height: 1024 } })

  test.beforeEach(async ({ page }) => {
    await stubCapabilities(page)
  })

  test('switch workspace navigates to canonical /w/{id}/ via submenu', async ({ page }) => {
    const navRequests: string[] = []

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/w/')) {
        navRequests.push(url.pathname)
      }
    })

    await page.route('**/api/v1/me**', (route) =>
      fulfillJson(route, 200, { email: 'john@example.com' }),
    )

    await page.route('**/api/v1/workspaces**', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        return fulfillJson(route, 200, {
          workspaces: [
            { id: 'ws-1', name: 'One' },
            { id: 'ws-2', name: 'Two' },
          ],
        })
      }
      return fulfillJson(route, 405, { detail: 'unexpected method' })
    })

    // Intercept the navigation away from the UI and fulfill a minimal HTML response.
    await page.route(/\/w\/ws-2(\/|$)/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
    )

    await page.goto('/w/ws-1/')
    const userMenuButton = await waitForUserMenuButton(page)

    // Open user menu and click Switch workspace to reveal the submenu
    await userMenuButton.click()
    await expect(page.getByRole('menuitem', { name: 'Switch workspace' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Switch workspace' }).click()

    // Click the target workspace in the submenu portal
    const wsItem = page.locator('.user-menu-ws-submenu-item', { hasText: 'Two' })
    await expect(wsItem).toBeVisible({ timeout: 5000 })
    await wsItem.click()

    await expect.poll(() => navRequests.map((pathname) => pathname.replace(/\/$/, ''))).toContain('/w/ws-2')
  })

  test('create workspace writes settings and navigates to canonical /w/{id}/', async ({ page }) => {
    const requests = trackApiRequests(page)
    const navRequests: string[] = []

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/w/')) {
        navRequests.push(url.pathname)
      }
    })

    await page.route('**/api/v1/me', (route) =>
      fulfillJson(route, 200, { email: 'john@example.com' }),
    )

    let workspacesGetCount = 0
    await page.route('**/api/v1/workspaces', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        return fulfillJson(route, 201, {
          ok: true,
          workspace: {
            id: 'ws-new',
            workspace_id: 'ws-new',
            name: 'New',
            app_id: 'boring-ui',
            created_by: 'user-1',
          },
        })
      }
      if (req.method() === 'GET') {
        workspacesGetCount += 1
        return fulfillJson(route, 200, {
          workspaces: [
            { id: 'ws-new', name: 'New' },
            { id: 'ws-old', name: 'Old' },
          ],
        })
      }
      return fulfillJson(route, 405, { detail: 'unexpected method' })
    })

    await page.route('**/api/v1/workspaces/ws-new/runtime', (route) =>
      fulfillJson(route, 200, { runtime: { status: 'ready' } }),
    )

    let settingsPutBody = ''
    await page.route('**/api/v1/workspaces/ws-new/settings', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        return fulfillJson(route, 200, { data: { workspace_settings: { shell: 'zsh' } } })
      }
      if (req.method() === 'PUT') {
        settingsPutBody = req.postData() || ''
        return route.fulfill({ status: 204 })
      }
      return fulfillJson(route, 405, { detail: 'unexpected method' })
    })

    await page.route('**/w/ws-new*', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
    )

    await page.goto('/')
    const userMenuButton = await waitForUserMenuButton(page)
    await userMenuButton.click()
    await page.getByRole('menuitem', { name: 'Create workspace' }).click()

    // Fill in the Create Workspace modal and submit
    const dialog = page.getByRole('dialog', { name: 'Create Workspace' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Workspace Name').fill('New')
    await dialog.getByRole('button', { name: 'Create' }).click()

    await expect.poll(() => navRequests.map((pathname) => pathname.replace(/\/$/, ''))).toContain('/w/ws-new')
    await expect.poll(() => workspacesGetCount).toBeGreaterThan(0)
    expect(JSON.parse(settingsPutBody)).toEqual({ shell: 'zsh' })

    // Diagnostic: ensure key requests happened.
    expect(requests.map((r) => `${r.method} ${r.pathname}`)).toEqual(
      expect.arrayContaining([
        'POST /api/v1/workspaces',
        'GET /api/v1/workspaces',
        'GET /api/v1/workspaces/ws-new/runtime',
        'GET /api/v1/workspaces/ws-new/settings',
        'PUT /api/v1/workspaces/ws-new/settings',
      ]),
    )
  })

  test('logout uses canonical /auth/logout route', async ({ page }) => {
    const requests = trackApiRequests(page)

    await page.route('**/api/v1/me', (route) =>
      fulfillJson(route, 200, { email: 'john@example.com' }),
    )
    await page.route('**/api/v1/workspaces', (route) =>
      fulfillJson(route, 200, { workspaces: [{ id: 'ws-1', name: 'One' }] }),
    )
    await page.route('**/auth/logout', (route) =>
      route.fulfill({ status: 204, body: '' }),
    )

    await page.goto('/w/ws-1/')
    const userMenuButton = await waitForUserMenuButton(page)

    const logoutRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/auth/logout',
    )
    await userMenuButton.click()
    await page.getByRole('menuitem', { name: 'Logout' }).click()
    await logoutRequest

    expect(requests.map((r) => `${r.method} ${r.pathname}`)).toEqual(
      expect.arrayContaining(['GET /api/v1/me', 'GET /api/v1/workspaces', 'GET /auth/logout']),
    )
  })

  test('unauthenticated identity shows banner and disables actions, retry re-requests control plane', async ({ page }) => {
    const requests = trackApiRequests(page)
    let meCalls = 0
    let workspacesCalls = 0

    await page.route('**/api/v1/me', (route) => {
      meCalls += 1
      return fulfillJson(route, 401, { detail: 'not signed in' })
    })

    await page.route('**/api/v1/workspaces', (route) => {
      workspacesCalls += 1
      return fulfillJson(route, 401, { detail: 'not signed in' })
    })

    await page.goto('/')
    const userMenuButton = await waitForUserMenuButton(page)
    await userMenuButton.click()

    const userMenu = page.getByRole('menu', { name: 'User menu' })
    await expect(userMenu.getByRole('alert')).toHaveText(/Not signed in/i)
    await expect(userMenu.getByRole('menuitem', { name: 'Switch workspace' })).toHaveCount(0)
    await expect(userMenu.getByRole('menuitem', { name: 'Create workspace' })).toBeDisabled()
    await expect(userMenu.getByRole('menuitem', { name: 'User settings' })).toBeEnabled()
    await expect(userMenu.getByRole('menuitem', { name: 'Logout' })).toBeDisabled()

    await userMenu.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => meCalls).toBeGreaterThan(1)
    await expect.poll(() => workspacesCalls).toBeGreaterThan(1)

    // Diagnostic: prove requests were made through canonical endpoints.
    expect(requests.map((r) => r.pathname)).toEqual(
      expect.arrayContaining(['/api/v1/me', '/api/v1/workspaces']),
    )
  })

  test('workspaces transient failure disables switch and shows retry banner', async ({ page }) => {
    let workspacesCalls = 0
    await page.route('**/api/v1/me', (route) =>
      fulfillJson(route, 200, { email: 'john@example.com' }),
    )
    await page.route('**/api/v1/workspaces', (route) => {
      workspacesCalls += 1
      return fulfillJson(route, 500, { detail: 'boom' })
    })

    await page.goto('/')
    const userMenuButton = await waitForUserMenuButton(page)
    await userMenuButton.click()

    const userMenu = page.getByRole('menu', { name: 'User menu' })
    await expect(userMenu.getByRole('alert')).toHaveText(/Failed to load workspaces|boom/i)
    await expect(userMenu.getByRole('menuitem', { name: 'Switch workspace' })).toHaveCount(0)

    await userMenu.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => workspacesCalls).toBeGreaterThan(1)
  })
})
