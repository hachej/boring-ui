import { expect, test } from '@playwright/test'

const USER = {
  id: 'user-runtime-readiness',
  email: 'runtime-readiness@local',
  name: 'Runtime Readiness',
}
const WORKSPACE = {
  id: 'ws-runtime-readiness',
  appId: 'boring-app',
  name: 'Runtime Readiness Workspace',
  createdBy: USER.id,
  isDefault: true,
  provisioning: 'ready',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

test('authenticated workspace can submit chat while runtime dependencies are still preparing', async ({ page, baseURL }) => {
  let chatSubmitted: { message?: string } | null = null
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
    if (path === '/api/v1/tree') return route.fulfill(json({ entries: [] }))
    if (path === '/api/v1/agent/pi-chat/sessions' && request.method() === 'GET') return route.fulfill(json([{ id: 'runtime-readiness', title: 'Runtime Readiness', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0 }]))
    if (path === '/api/v1/agent/pi-chat/runtime-readiness/state') return route.fulfill(json({ protocolVersion: 1, sessionId: 'runtime-readiness', seq: 0, status: 'idle', messages: [], queue: { followUps: [] }, followUpMode: 'one-at-a-time' }))
    if (path === '/api/v1/agent/pi-chat/runtime-readiness/events') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '{"type":"heartbeat","now":"2026-01-01T00:00:00.000Z"}\n' })
    if (path === '/api/v1/agent/models') return route.fulfill(json({ models: [] }))
    if (path === '/api/v1/ready-status') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: status\ndata: {"state":"ready","sandboxReady":true,"harnessReady":true,"capabilities":{"chat":{"state":"ready"},"workspace":{"state":"ready"},"runtimeDependencies":{"state":"preparing","requirement":"runtime:python"}}}\n\n',
      })
    }
    if (path === '/api/v1/agent/pi-chat/runtime-readiness/prompt' && request.method() === 'POST') {
      chatSubmitted = request.postDataJSON() as { message?: string }
      return route.fulfill(json({ accepted: true, cursor: 0, clientNonce: 'runtime-readiness' }))
    }
    if (path === '/api/v1/ui/state' && request.method() === 'PUT') return route.fulfill({ status: 204, body: '' })
    if (path === '/api/v1/ui/commands/next') return route.fulfill(json([]))
    if (path === '/api/v1/fs/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: init\ndata: {"v":1}\n\n' })
    if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))
    return route.continue()
  })

  await page.goto(`/workspace/${WORKSPACE.id}`)
  await expect(page.getByPlaceholder('Message the agent…')).toBeVisible()
  await page.getByPlaceholder('Message the agent…').fill('Can I chat before macro runtime is ready?')
  await page.getByLabel('Submit').click()

  await expect.poll(() => chatSubmitted?.message ?? null, {
    message: 'chat POST should be sent even while runtimeDependencies is preparing',
  }).toBe('Can I chat before macro runtime is ready?')
})
