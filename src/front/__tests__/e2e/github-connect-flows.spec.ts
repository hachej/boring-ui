import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const json = (value: unknown) => JSON.stringify(value)

const fulfillJson = (route: Route, status: number, body: unknown) => {
  route.fulfill({
    status,
    contentType: 'application/json',
    body: json(body),
  })
}

/**
 * Stub /api/capabilities with control_plane + github features enabled.
 */
const stubCapabilities = async (page: Page, overrides: Record<string, boolean> = {}) => {
  await page.route('**/api/capabilities', (route) =>
    fulfillJson(route, 200, {
      version: 'test',
      features: {
        files: true,
        git: true,
        pty: true,
        chat_claude_code: true,
        approval: true,
        companion: true,
        control_plane: true,
        github: true,
        ...overrides,
      },
      routers: [],
    }),
  )
}

/**
 * Stub the authenticated user identity and workspace list.
 */
const stubIdentityAndWorkspaces = async (page: Page) => {
  await page.route('**/api/v1/me**', (route) =>
    fulfillJson(route, 200, { email: 'test@example.com' }),
  )
  await page.route('**/api/v1/workspaces', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      return fulfillJson(route, 200, {
        workspaces: [{ id: 'ws-gh-test', name: 'GH Test' }],
      })
    }
    return fulfillJson(route, 405, { detail: 'unexpected method' })
  })
}

/**
 * Stub workspace runtime and settings so the workspace loads.
 */
const stubWorkspaceData = async (page: Page, workspaceId = 'ws-gh-test') => {
  await page.route(`**/api/v1/workspaces/${workspaceId}/runtime**`, (route) =>
    fulfillJson(route, 200, { runtime: { state: 'ready' } }),
  )
  await page.route(`**/api/v1/workspaces/${workspaceId}/settings**`, (route) =>
    fulfillJson(route, 200, { data: { workspace_settings: {} } }),
  )
}

/**
 * Stub GitHub status endpoint.
 */
const stubGitHubStatus = async (
  page: Page,
  { configured = true, connected = false }: { configured?: boolean; connected?: boolean } = {},
) => {
  await page.route('**/api/v1/auth/github/status**', (route) =>
    fulfillJson(route, 200, { configured, connected }),
  )
}

/**
 * Stub /api/v1/git/status for the git changes panel.
 */
const stubGitStatus = async (page: Page, isRepo = true) => {
  await page.route('**/api/v1/git/status**', (route) =>
    fulfillJson(route, 200, { is_repo: isRepo, files: [] }),
  )
}

/**
 * Intercept the GitHub authorize redirect (popup window.open).
 * Returns a helper to assert that window.open was called with the authorize URL.
 */
const interceptGitHubAuthorize = async (page: Page): Promise<{ waitForCall: () => Promise<void> }> => {
  await page.route('**/api/v1/auth/github/authorize**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>GitHub OAuth</body></html>' }),
  )

  await page.evaluate(() => {
    ;(window as any).__githubAuthorizeUrl = null
    window.open = ((url: string) => {
      ;(window as any).__githubAuthorizeUrl = url
      return null
    }) as any
  })

  return {
    waitForCall: async () => {
      await expect
        .poll(() => page.evaluate(() => (window as any).__githubAuthorizeUrl), { timeout: 5000 })
        .toBeTruthy()
    },
  }
}

/**
 * Stub workspace boundary routes needed for setup page.
 * The Vite dev server serves setup as SPA (document), but the frontend also
 * makes XHR calls to /w/{id}/setup for setup data and /w/{id}/ for scope check.
 */
const stubSetupBoundaryApi = async (page: Page, workspaceId = 'ws-gh-test') => {
  // Stub the setup boundary API (XHR)
  await page.route(`**/w/${workspaceId}/setup`, (route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    return fulfillJson(route, 200, {
      ok: true,
      workspace_id: workspaceId,
      route: 'setup',
      runtime: { state: 'ready' },
    })
  })
  // Stub workspace scope root check — the SPA fetches /w/{id}/ to verify access
  await page.route(new RegExp(`/w/${workspaceId}/$`), (route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    return fulfillJson(route, 200, { ok: true, workspace_id: workspaceId })
  })
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

test.describe('GitHub Connect — 3 Entry Points', () => {
  test.describe.configure({ timeout: 60_000 })
  test.use({ viewport: { width: 1280, height: 1024 } })

  // ── Entry Point 1: Onboarding Wizard (WorkspaceSetupPage) ──────────────────
  // WorkspaceSetupPage is a full-page view (no DockView). It renders when the
  // URL is /w/{id}/setup and the frontend reads capabilities.features.github.

  test.describe('1. Onboarding Wizard', () => {
    test('shows Connect GitHub button when github feature enabled', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })
      await stubSetupBoundaryApi(page)

      await page.goto('/w/ws-gh-test/setup')

      // Setup wizard is a full-page view — wait for its header
      await expect(page.locator('.setup-wizard-header')).toBeVisible({ timeout: 20000 })

      const connectBtn = page.locator('button', { hasText: 'Connect GitHub' })
      await expect(connectBtn.first()).toBeVisible({ timeout: 10000 })
    })

    test('clicking Connect GitHub calls authorize endpoint', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })
      await stubSetupBoundaryApi(page)

      await page.goto('/w/ws-gh-test/setup')
      await expect(page.locator('.setup-wizard-header')).toBeVisible({ timeout: 20000 })

      const { waitForCall } = await interceptGitHubAuthorize(page)

      const connectBtn = page.locator('button', { hasText: 'Connect GitHub' })
      await connectBtn.first().click()

      await waitForCall()
      const url = await page.evaluate(() => (window as any).__githubAuthorizeUrl)
      expect(url).toContain('/api/v1/auth/github/authorize')
    })

    test('shows "GitHub connected" when already connected', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: true })
      await stubSetupBoundaryApi(page)

      await page.goto('/w/ws-gh-test/setup')
      await expect(page.locator('.setup-wizard-header')).toBeVisible({ timeout: 20000 })

      await expect(page.locator('text=GitHub connected')).toBeVisible({ timeout: 10000 })
      await expect(page.locator('button', { hasText: 'Continue to workspace' })).toBeVisible()
    })

    test('skips wizard when github feature is disabled', async ({ page }) => {
      await stubCapabilities(page, { github: false, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubSetupBoundaryApi(page)

      // When github is disabled, the wizard calls onComplete which navigates away.
      // Intercept the navigation target to verify it was triggered.
      const navRequests: string[] = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/w/ws-gh-test') && request.isNavigationRequest()) {
          navRequests.push(url.pathname)
        }
      })

      // Stub the workspace scope navigation target
      await page.route(new RegExp('/w/ws-gh-test/$'), (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>workspace</body></html>' }),
      )

      await page.goto('/w/ws-gh-test/setup')

      // The wizard should auto-skip and navigate to workspace scope
      await expect.poll(() => navRequests).toEqual(
        expect.arrayContaining([expect.stringMatching(/\/w\/ws-gh-test/)]),
      )
      // The setup wizard header should never have been visible
      await expect(page.locator('.setup-wizard-header')).not.toBeVisible()
    })
  })

  // ── Entry Point 2: Workspace Settings Page ─────────────────────────────────
  // WorkspaceSettingsPage is a full-page view (no DockView). Rendered when
  // URL is /w/{id}/settings.

  test.describe('2. Workspace Settings Page', () => {
    test('shows GitHub Integration section when github feature enabled', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })

      await page.goto('/w/ws-gh-test/settings')

      // Settings page is a full-page view — wait for the General section (always present when loaded)
      await expect(page.locator('h2:has-text("General")')).toBeVisible({ timeout: 20000 })
      await expect(page.locator('text=GitHub Integration')).toBeVisible({ timeout: 10000 })

      const connectBtn = page.locator('button', { hasText: 'Connect GitHub' })
      await expect(connectBtn.first()).toBeVisible()
    })

    test('clicking Connect GitHub in settings calls authorize', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })

      await page.goto('/w/ws-gh-test/settings')
      await expect(page.locator('h2:has-text("General")')).toBeVisible({ timeout: 20000 })

      const { waitForCall } = await interceptGitHubAuthorize(page)

      await expect(page.locator('text=GitHub Integration')).toBeVisible({ timeout: 10000 })
      const connectBtn = page.locator('.github-connect-disconnected button', { hasText: 'Connect GitHub' })
      await connectBtn.click()

      await waitForCall()
      const url = await page.evaluate(() => (window as any).__githubAuthorizeUrl)
      expect(url).toContain('/api/v1/auth/github/authorize')
    })

    test('shows "Connected" badge when already connected', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: true })

      await page.goto('/w/ws-gh-test/settings')
      await expect(page.locator('h2:has-text("General")')).toBeVisible({ timeout: 20000 })
      await expect(page.locator('text=GitHub Integration')).toBeVisible({ timeout: 10000 })
      await expect(page.locator('.github-connect-connected')).toBeVisible()
      await expect(page.locator('button', { hasText: 'Disconnect' })).toBeVisible()
    })

    test('hides GitHub section when github feature disabled', async ({ page }) => {
      await stubCapabilities(page, { github: false, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)

      await page.goto('/w/ws-gh-test/settings')
      await expect(page.locator('h2:has-text("General")')).toBeVisible({ timeout: 20000 })
      await expect(page.locator('text=GitHub Integration')).not.toBeVisible()
    })
  })

  // ── Entry Point 3: Files Header GitHub Button ──────────────────────────────
  // The compact GitHub connect trigger is rendered in the Files panel header
  // when github is configured and the workspace is not connected yet.

  test.describe('3. Files Header GitHub Button', () => {
    test('shows Connect GitHub button in files header when not connected', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })
      await stubGitStatus(page, true)

      await page.goto('/w/ws-gh-test/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
      const connectBtn = page.getByRole('button', { name: 'Connect GitHub' })
      await expect(connectBtn).toBeVisible({ timeout: 10000 })
    })

    test('clicking Connect GitHub in files header calls authorize', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: false })
      await stubGitStatus(page, true)

      await page.goto('/w/ws-gh-test/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
      const { waitForCall } = await interceptGitHubAuthorize(page)

      const connectBtn = page.getByRole('button', { name: 'Connect GitHub' })
      await expect(connectBtn).toBeVisible({ timeout: 10000 })
      await connectBtn.click()

      await waitForCall()
      const url = await page.evaluate(() => (window as any).__githubAuthorizeUrl)
      expect(url).toContain('/api/v1/auth/github/authorize')
    })

    test('hides Connect GitHub button when already connected', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: true, connected: true })
      await stubGitStatus(page, true)

      await page.goto('/w/ws-gh-test/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
      await expect(page.getByRole('button', { name: 'Connect GitHub' })).toHaveCount(0)
    })

    test('hides Connect GitHub button when github not configured', async ({ page }) => {
      await stubCapabilities(page, { github: true, control_plane: true })
      await stubIdentityAndWorkspaces(page)
      await stubWorkspaceData(page)
      await stubGitHubStatus(page, { configured: false, connected: false })
      await stubGitStatus(page, true)

      await page.goto('/w/ws-gh-test/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
      await expect(page.getByRole('button', { name: 'Connect GitHub' })).toHaveCount(0)
    })
  })
})
