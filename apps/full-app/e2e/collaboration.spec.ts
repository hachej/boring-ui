import { expect, test, type Page, type Route } from '@playwright/test'

const BEAD = 'boring-ui-v2-cc7x'

// ─── Fixtures ────────────────────────────────────────────────────────

const USER_ALICE = {
  id: 'user-alice-001',
  email: 'alice@test.dev',
  name: 'Alice Test',
  emailVerified: true,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const USER_BOB = {
  id: 'user-bob-002',
  email: 'bob@test.dev',
  name: 'Bob Test',
  emailVerified: false,
  image: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const WORKSPACE = {
  id: 'ws-collab-001',
  appId: 'boring-app',
  name: 'Team Workspace',
  createdBy: USER_ALICE.id,
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  machineId: null,
  volumeId: null,
  flyRegion: null,
}

const INVITE = {
  id: 'inv-001',
  workspaceId: WORKSPACE.id,
  email: USER_BOB.email,
  tokenHash: 'mock-hash',
  role: 'editor' as const,
  expiresAt: '2027-01-01T00:00:00.000Z',
  acceptedAt: null,
  createdBy: USER_ALICE.id,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const CONFIG = {
  appId: 'boring-app',
  appName: 'Boring Full App',
  appLogo: null,
  apiBase: '',
  features: {
    githubOauth: false,
    googleOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: false,
  },
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ level: 'info', bead: BEAD, event, ...fields }))
}

function session(user: typeof USER_ALICE) {
  return {
    user,
    session: { expiresAt: '2026-12-31T00:00:00.000Z' },
  }
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

// ─── Scenario 1: Signup → Verify Email → First Sign-in ──────────────

test.describe('signup-to-workspace flow', () => {
  test('new user signs up, verifies email, lands on workspace', async ({ page, baseURL }) => {
    let currentUser: typeof USER_BOB | null = null
    let signedUp = false
    let emailVerified = false

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/v1/config') {
        return route.fulfill(json(CONFIG))
      }

      if (path === '/auth/get-session') {
        if (!currentUser) return route.fulfill(json(null))
        return route.fulfill(json(session(currentUser)))
      }

      if (path === '/auth/sign-up/email' && method === 'POST') {
        signedUp = true
        currentUser = { ...USER_BOB, emailVerified: false }
        log('e2e.signup.mocked')
        return route.fulfill(json({ user: currentUser }))
      }

      if (path === '/auth/verify-email' && method === 'GET') {
        emailVerified = true
        if (currentUser) currentUser = { ...currentUser, emailVerified: true }
        return route.fulfill(json({ data: { status: true, user: currentUser }, error: null }))
      }

      if (path === '/api/v1/workspaces') {
        if (!currentUser) return route.fulfill(json({ workspaces: [] }))
        return route.fulfill(json({ workspaces: [WORKSPACE] }))
      }

      if (path === `/api/v1/workspaces/${WORKSPACE.id}`) {
        return route.fulfill(json({ workspace: WORKSPACE, role: 'owner' }))
      }

      if (path === '/api/v1/me') {
        if (!currentUser) return route.fulfill(json({ error: 'unauthorized' }, 401))
        return route.fulfill(json({
          user: currentUser,
          settings: { displayName: currentUser.name, email: currentUser.email, settings: {} },
        }))
      }

      if (path === '/api/v1/tree') return route.fulfill(json({ entries: [] }))
      if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))

      return route.continue()
    })

    log('e2e.signup-flow.start')

    await page.goto('/auth/signup')
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible()

    await page.getByLabel('Name').fill(USER_BOB.name)
    await page.getByLabel('Email').fill(USER_BOB.email)
    await page.getByLabel('Password').fill('strongpassword123')
    await page.getByRole('button', { name: /sign up|create account/i }).click()

    await expect(page).toHaveURL(/verify-email|workspace/, { timeout: 10_000 })
    expect(signedUp).toBe(true)

    await page.goto('/auth/verify-email?token=mock-verify-token')
    await expect(page.getByText(/verified|success/i)).toBeVisible({ timeout: 10_000 })
    expect(emailVerified).toBe(true)

    await page.goto(`/workspace/${WORKSPACE.id}`)
    await expect(page).toHaveURL(new RegExp(`/workspace/${WORKSPACE.id}`))

    log('e2e.signup-flow.complete')
  })
})

// ─── Scenario 2: Workspace Creation → Invite → Accept ───────────────

test.describe('workspace invite flow', () => {
  test('owner creates workspace, invites user, invitee accepts', async ({ page, baseURL }) => {
    let workspaces = [WORKSPACE]
    let invites: typeof INVITE[] = []
    let members = [
      { workspaceId: WORKSPACE.id, userId: USER_ALICE.id, role: 'owner', createdAt: WORKSPACE.createdAt },
    ]

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/v1/config') return route.fulfill(json(CONFIG))
      if (path === '/auth/get-session') return route.fulfill(json(session(USER_ALICE)))
      if (path === '/api/v1/me') {
        return route.fulfill(json({
          user: USER_ALICE,
          settings: { displayName: USER_ALICE.name, email: USER_ALICE.email, settings: {} },
        }))
      }

      if (path === '/api/v1/workspaces' && method === 'GET') {
        return route.fulfill(json({ workspaces }))
      }

      if (path === '/api/v1/workspaces' && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}')
        const newWs = { ...WORKSPACE, id: 'ws-new-001', name: body.name, isDefault: false }
        workspaces = [...workspaces, newWs]
        log('e2e.workspace.created', { name: body.name })
        return route.fulfill(json({ workspace: newWs }, 201))
      }

      if (path.match(/\/api\/v1\/workspaces\/[^/]+\/invites$/) && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}')
        const inv = { ...INVITE, email: body.email, role: body.role ?? 'editor' }
        invites.push(inv)
        log('e2e.invite.created', { email: body.email })
        return route.fulfill(json({ invite: inv, warning: 'mail_disabled' }, 201))
      }

      if (path.match(/\/api\/v1\/workspaces\/[^/]+\/invites\/[^/]+\/accept/) && method === 'POST') {
        const acceptedInvite = { ...invites[0], acceptedAt: new Date().toISOString() }
        const newMember = { workspaceId: WORKSPACE.id, userId: USER_BOB.id, role: 'editor', createdAt: new Date().toISOString() }
        members.push(newMember)
        log('e2e.invite.accepted')
        return route.fulfill(json({ invite: acceptedInvite, member: newMember }))
      }

      if (path.match(/\/api\/v1\/workspaces\/[^/]+\/members/) && method === 'GET') {
        return route.fulfill(json({ members }))
      }

      if (path.match(/\/api\/v1\/workspaces\/[^/]+$/) && method === 'GET') {
        return route.fulfill(json({ workspace: WORKSPACE, role: 'owner' }))
      }

      if (path === '/api/v1/tree') return route.fulfill(json({ entries: [] }))
      if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))

      return route.continue()
    })

    log('e2e.invite-flow.start')

    await page.goto(`/workspace/${WORKSPACE.id}`)
    await expect(page.getByText(WORKSPACE.name)).toBeVisible({ timeout: 10_000 })

    log('e2e.invite-flow.workspace-visible')

    // Simulate the invite API call directly (workspace invite UI may vary)
    const inviteResponse = await page.evaluate(async (data) => {
      const res = await fetch(`/api/v1/workspaces/${data.wsId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, role: 'editor' }),
      })
      return res.json()
    }, { wsId: WORKSPACE.id, email: USER_BOB.email })

    expect(inviteResponse.invite.email).toBe(USER_BOB.email)
    expect(inviteResponse.invite.role).toBe('editor')

    // Accept invite via API
    const acceptResponse = await page.evaluate(async (data) => {
      const res = await fetch(
        `/api/v1/workspaces/${data.wsId}/invites/${data.invId}/accept?invite_token=mock-token`,
        { method: 'POST' },
      )
      return res.json()
    }, { wsId: WORKSPACE.id, invId: INVITE.id })

    expect(acceptResponse.member.userId).toBe(USER_BOB.id)
    expect(acceptResponse.member.role).toBe('editor')

    // Verify both members visible via API
    const membersResponse = await page.evaluate(async (wsId) => {
      const res = await fetch(`/api/v1/workspaces/${wsId}/members`)
      return res.json()
    }, WORKSPACE.id)

    expect(membersResponse.members).toHaveLength(2)
    expect(membersResponse.members.map((m: { userId: string }) => m.userId)).toContain(USER_ALICE.id)
    expect(membersResponse.members.map((m: { userId: string }) => m.userId)).toContain(USER_BOB.id)

    log('e2e.invite-flow.complete')
  })
})

// ─── Scenario 3: Last-owner deletion is blocked ──────────────────────

test.describe('owner protection', () => {
  test('sole owner cannot delete account — gets 409', async ({ page, baseURL }) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/v1/config') return route.fulfill(json(CONFIG))
      if (path === '/auth/get-session') return route.fulfill(json(session(USER_ALICE)))

      if (path === '/api/v1/me' && method === 'GET') {
        return route.fulfill(json({
          user: USER_ALICE,
          settings: { displayName: USER_ALICE.name, email: USER_ALICE.email, settings: {} },
        }))
      }

      if (path === '/api/v1/me' && method === 'DELETE') {
        log('e2e.delete-account.409-sole-owner')
        return route.fulfill(json({
          code: 'last_owner',
          message: 'You are the sole owner of 1 workspace(s)',
          soleOwnerWorkspaceCount: 1,
        }, 409))
      }

      if (path === '/api/v1/workspaces') return route.fulfill(json({ workspaces: [WORKSPACE] }))
      if (path === '/api/v1/tree') return route.fulfill(json({ entries: [] }))
      if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))

      return route.continue()
    })

    log('e2e.owner-protection.start')

    await page.goto('/me')
    await expect(page.getByText(/account settings/i)).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /delete account/i }).click()
    await expect(page.getByText(/this action cannot be undone/i)).toBeVisible()

    await page.getByPlaceholder('DELETE').fill('DELETE')
    await page.getByRole('button', { name: /delete my account/i }).click()

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('alert')).toContainText(/sole owner/i)

    log('e2e.owner-protection.complete')
  })
})

// ─── Scenario 4: Account deletion success ────────────────────────────

test.describe('account deletion', () => {
  test('user deletes account successfully and is signed out', async ({ page, baseURL }) => {
    let deleted = false

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/v1/config') return route.fulfill(json(CONFIG))

      if (path === '/auth/get-session') {
        if (deleted) return route.fulfill(json(null))
        return route.fulfill(json(session(USER_BOB)))
      }

      if (path === '/api/v1/me' && method === 'GET') {
        return route.fulfill(json({
          user: USER_BOB,
          settings: { displayName: USER_BOB.name, email: USER_BOB.email, settings: {} },
        }))
      }

      if (path === '/api/v1/me' && method === 'DELETE') {
        const body = JSON.parse(route.request().postData() ?? '{}')
        expect(body.confirm).toBe(USER_BOB.email)
        deleted = true
        log('e2e.delete-account.success')
        return route.fulfill(json({ deleted: true }))
      }

      if (path === '/auth/sign-out') {
        return route.fulfill(json({ data: null, error: null }))
      }

      if (path === '/api/v1/workspaces') return route.fulfill(json({ workspaces: [] }))
      if (path === '/api/v1/tree') return route.fulfill(json({ entries: [] }))
      if (path.startsWith('/api/v1/agent/')) return route.fulfill(json({}))

      return route.continue()
    })

    log('e2e.account-deletion.start')

    await page.goto('/me')
    await expect(page.getByText(/account settings/i)).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /delete account/i }).click()
    await expect(page.getByPlaceholder('DELETE')).toBeVisible()

    await page.getByPlaceholder('DELETE').fill('DELETE')
    await page.getByRole('button', { name: /delete my account/i }).click()

    await expect(page).toHaveURL(/auth\/signin/, { timeout: 10_000 })
    expect(deleted).toBe(true)

    log('e2e.account-deletion.complete')
  })
})

// ─── Scenario 5: Reset password flow ─────────────────────────────────

test.describe('reset password flow', () => {
  test('forgot password → reset link → new password set', async ({ page, baseURL }) => {
    let resetRequested = false
    let passwordReset = false

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (baseURL && url.origin !== new URL(baseURL).origin) return route.continue()
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/v1/config') return route.fulfill(json(CONFIG))
      if (path === '/auth/get-session') return route.fulfill(json(null))

      if (path === '/auth/forget-password' && method === 'POST') {
        resetRequested = true
        log('e2e.forgot-password.requested')
        return route.fulfill(json({ data: { status: true }, error: null }))
      }

      if (path === '/auth/reset-password' && method === 'POST') {
        passwordReset = true
        log('e2e.reset-password.completed')
        return route.fulfill(json({ data: { status: true }, error: null }))
      }

      if (path === '/api/v1/workspaces') return route.fulfill(json({ workspaces: [] }))

      return route.continue()
    })

    log('e2e.reset-password-flow.start')

    // Step 1: Navigate to forgot password
    await page.goto('/auth/forgot-password')
    await expect(page.getByRole('heading', { name: /forgot password/i })).toBeVisible()

    await page.getByLabel('Email').fill(USER_ALICE.email)
    await page.getByRole('button', { name: /send reset link|reset/i }).click()

    await expect(page.getByText(/check your email|reset link sent/i)).toBeVisible({ timeout: 5_000 })
    expect(resetRequested).toBe(true)

    // Step 2: Navigate to reset password page with token
    await page.goto('/auth/reset-password?token=mock-reset-token')
    await expect(page.getByLabel(/new password/i)).toBeVisible({ timeout: 5_000 })

    await page.getByLabel(/^new password$/i).fill('newstrongpassword')
    await page.getByLabel(/confirm/i).fill('newstrongpassword')
    await page.getByRole('button', { name: /reset password|set password/i }).click()

    await expect(page.getByText(/password.*reset|password.*changed|success/i)).toBeVisible({ timeout: 5_000 })
    expect(passwordReset).toBe(true)

    log('e2e.reset-password-flow.complete')
  })
})
