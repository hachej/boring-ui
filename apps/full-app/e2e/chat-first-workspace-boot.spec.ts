import { expect, test } from '@playwright/test'

const USER = {
  id: 'user-chat-first',
  email: 'chat-first@local',
  name: 'Chat First',
}
const WORKSPACE = {
  id: 'ws-chat-first',
  appId: 'boring-app',
  name: 'Chat First Workspace',
  createdBy: USER.id,
  isDefault: true,
  provisioning: 'ready',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

test('authenticated workspace route renders chat before tree/session warmup resolves', async ({ page, baseURL }) => {
  const delayed: string[] = []
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
        features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: false },
      }))
    }
    if (path === '/auth/get-session') {
      return route.fulfill(json({
        user: { ...USER, emailVerified: true, image: null, createdAt: WORKSPACE.createdAt, updatedAt: WORKSPACE.updatedAt },
        session: { expiresAt: new Date('2026-12-31T00:00:00.000Z').toISOString() },
      }))
    }
    if (path === '/api/v1/workspaces') return route.fulfill(json({ workspaces: [WORKSPACE] }))
    if (path === `/api/v1/workspaces/${WORKSPACE.id}`) return route.fulfill(json({ workspace: WORKSPACE, role: 'owner' }))
    if (path === '/api/v1/tree' || path === '/api/v1/agent/pi-chat/sessions') {
      delayed.push(path)
      return new Promise<void>(() => {})
    }
    if (path === '/api/v1/ready-status') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: status\ndata: {"state":"ready","sandboxReady":true,"harnessReady":true}\n\n' })
    if (path === '/api/v1/agent/models') return route.fulfill(json({ models: [] }))
    if (path === '/api/v1/ui/state' && request.method() === 'PUT') return route.fulfill({ status: 204, body: '' })
    if (path === '/api/v1/ui/commands/next') return route.fulfill(json([]))
    if (path === '/api/v1/fs/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: init\ndata: {"v":1}\n\n' })
    if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))
    return route.continue()
  })

  await page.goto(`/workspace/${WORKSPACE.id}`)

  await expect(page.getByText(WORKSPACE.name)).toBeVisible()
  await expect(page.getByPlaceholder('Ask anything…')).toBeVisible()
  await expect(page.getByText('Opening workspace')).toHaveCount(0)
  expect(delayed).toEqual(expect.arrayContaining(['/api/v1/tree', '/api/v1/agent/pi-chat/sessions']))
})
