import { expect, test } from '@playwright/test'

const BEAD = 'boring-ui-v2-q4fo'
const WORKSPACE_ID = 'ws-smoke'
const USER = {
  id: 'user-dev-local',
  email: 'dev@local',
  name: 'Dev Local',
}

const WORKSPACE = {
  id: WORKSPACE_ID,
  appId: 'boring-app',
  name: 'Smoke Workspace',
  createdBy: USER.id,
  isDefault: true,
  provisioning: 'ready',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ level: 'info', bead: BEAD, event, ...fields }))
}

test('smoke: sign in and land on /workspace/:id', async ({ page, baseURL }) => {
  let signedIn = false

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (baseURL && url.origin !== new URL(baseURL).origin) {
      return route.continue()
    }

    const path = url.pathname

    if (path === '/api/v1/config') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          appId: 'boring-app',
          appName: 'Boring Full App',
          appLogo: null,
          apiBase: baseURL,
          features: {
            githubOauth: false,
            invitesEnabled: true,
            sendWelcomeEmail: false,
          },
        }),
      })
    }

    if (path === '/auth/get-session') {
      const payload = signedIn
        ? {
            user: {
              ...USER,
              emailVerified: true,
              image: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
              updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            },
            session: {
              expiresAt: new Date('2026-12-31T00:00:00.000Z').toISOString(),
            },
          }
        : null

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    }

    if (path === '/auth/sign-in/email' && request.method() === 'POST') {
      signedIn = true
      log('smoke.signin.mocked')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: USER }),
      })
    }

    if (path === '/api/v1/workspaces') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workspaces: [WORKSPACE] }),
      })
    }

    if (path === `/api/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workspace: WORKSPACE, role: 'owner' }),
      })
    }

    if (path === '/api/v1/tree' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [] }),
      })
    }

    if (path === '/api/v1/agent/models') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [] }),
      })
    }

    if (path.startsWith('/api/v1/agent/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    }

    return route.continue()
  })

  log('smoke.start', { workspaceId: WORKSPACE_ID })

  await page.goto(`/workspace/${WORKSPACE_ID}`)
  await page.evaluate((workspacePath) => {
    const redirect = encodeURIComponent(workspacePath)
    window.history.pushState({}, '', `/auth/signin?redirect=${redirect}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/workspace/${WORKSPACE_ID}`)
  await expect(page).toHaveURL(new RegExp('/auth/signin'))

  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill('dev-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.goto(`/workspace/${WORKSPACE_ID}`)
  await expect(page).toHaveURL(new RegExp(`/workspace/${WORKSPACE_ID}$`))
  await expect(page.getByText('Smoke Workspace')).toBeVisible()
  await expect(page.locator('.dv-shell')).toBeVisible()

  log('smoke.complete', { workspaceId: WORKSPACE_ID })
})
