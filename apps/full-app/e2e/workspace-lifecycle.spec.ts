import { expect, test, type Page, type Route } from '@playwright/test'

const USER = {
  id: 'user-workspace-lifecycle',
  email: 'workspace-lifecycle@test.dev',
  name: 'Workspace Lifecycle',
  emailVerified: true,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const CONFIG = {
  appId: 'boring-app',
  appName: 'Boring Full App',
  appLogo: null,
  apiBase: '',
  features: {
    githubOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: false,
  },
}

type WorkspaceFixture = {
  id: string
  appId: string
  name: string
  createdBy: string
  isDefault: boolean
  provisioning: 'ready'
  createdAt: string
  updatedAt: string
  deletedAt: null
  machineId: null
  volumeId: null
  flyRegion: null
}

type FileEntry = {
  name: string
  kind: 'file' | 'dir'
  path: string
}

type SessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
}

function workspace(id: string, name: string, isDefault = false): WorkspaceFixture {
  return {
    id,
    appId: 'boring-app',
    name,
    createdBy: USER.id,
    isDefault,
    provisioning: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    machineId: null,
    volumeId: null,
    flyRegion: null,
  }
}

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

function workspaceIdFromRequest(route: Route): string {
  return route.request().headers()['x-boring-workspace-id'] ?? 'missing-workspace'
}

function uiCommandWorkspaceIdFromRequest(route: Route): string {
  const url = new URL(route.request().url())
  return url.searchParams.get('workspaceId') ?? workspaceIdFromRequest(route)
}

function listEntries(files: Map<string, string>, dir: string | null): FileEntry[] {
  const normalizedDir = dir && dir !== '.' ? dir.replace(/^\/+|\/+$/g, '') : ''
  const prefix = normalizedDir ? `${normalizedDir}/` : ''
  const byPath = new Map<string, FileEntry>()

  for (const filePath of files.keys()) {
    if (!filePath.startsWith(prefix)) continue
    const rest = filePath.slice(prefix.length)
    if (!rest) continue
    const [name, ...tail] = rest.split('/')
    const childPath = normalizedDir ? `${normalizedDir}/${name}` : name
    byPath.set(childPath, {
      name,
      path: childPath,
      kind: tail.length > 0 ? 'dir' : 'file',
    })
  }

  return Array.from(byPath.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function installWorkspaceLifecycleMocks(page: Page, baseURL: string | undefined) {
  const workspaces: WorkspaceFixture[] = [
    workspace('ws-alpha', 'Alpha Workspace', true),
    workspace('ws-beta', 'Beta Workspace'),
  ]
  const filesByWorkspace = new Map<string, Map<string, string>>([
    ['ws-alpha', new Map([
      ['alpha.md', '# alpha'],
      ['alpha.ts', 'export const alpha = 1'],
    ])],
    ['ws-beta', new Map([['beta.md', '# beta']])],
  ])
  const sessionsByWorkspace = new Map<string, SessionSummary[]>()
  const sessionRequests: string[] = []
  const treeRequests: string[] = []
  const fileWrites: Array<{ workspaceId: string; path: string; content: string }> = []
  const uiCommandsByWorkspace = new Map<string, unknown[]>()
  let sessionSeq = 0

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (baseURL && url.origin !== new URL(baseURL).origin) {
      return route.continue()
    }

    const path = url.pathname
    const method = request.method()

    if (path === '/api/v1/config') return route.fulfill(json(CONFIG))

    if (path === '/auth/get-session') {
      return route.fulfill(json({
        user: USER,
        session: { expiresAt: '2026-12-31T00:00:00.000Z' },
      }))
    }

    if (path === '/api/v1/me') {
      return route.fulfill(json({
        user: USER,
        settings: { displayName: USER.name, email: USER.email, settings: {} },
      }))
    }

    if (path === '/api/v1/workspaces' && method === 'GET') {
      return route.fulfill(json({ workspaces }))
    }

    if (path === '/api/v1/workspaces' && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string }
      const name = String(body.name ?? '').trim()
      const created = workspace(`ws-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name)
      workspaces.push(created)
      filesByWorkspace.set(created.id, new Map())
      return route.fulfill(json({ workspace: created }, 201))
    }

    const workspaceDetailMatch = path.match(/^\/api\/v1\/workspaces\/([^/]+)$/)
    if (workspaceDetailMatch && method === 'GET') {
      const found = workspaces.find((item) => item.id === workspaceDetailMatch[1])
      if (!found) return route.fulfill(json({ error: 'not_found' }, 404))
      return route.fulfill(json({ workspace: found, role: 'owner' }))
    }

    if (path === '/api/v1/tree' && method === 'GET') {
      const workspaceId = workspaceIdFromRequest(route)
      treeRequests.push(workspaceId)
      const files = filesByWorkspace.get(workspaceId) ?? new Map()
      return route.fulfill(json({
        entries: listEntries(files, url.searchParams.get('path')),
      }))
    }

    if (path === '/api/v1/files' && method === 'GET') {
      const workspaceId = workspaceIdFromRequest(route)
      const filePath = url.searchParams.get('path') ?? ''
      const content = filesByWorkspace.get(workspaceId)?.get(filePath)
      if (content == null) return route.fulfill(json({ error: 'not_found' }, 404))
      return route.fulfill(json({ content, mtimeMs: 1 }))
    }

    if (path === '/api/v1/files' && method === 'POST') {
      const workspaceId = workspaceIdFromRequest(route)
      const body = JSON.parse(request.postData() ?? '{}') as {
        path?: string
        content?: string
      }
      const targetPath = String(body.path ?? '')
      const content = String(body.content ?? '')
      const files = filesByWorkspace.get(workspaceId) ?? new Map()
      files.set(targetPath, content)
      filesByWorkspace.set(workspaceId, files)
      fileWrites.push({ workspaceId, path: targetPath, content })
      return route.fulfill(json({ ok: true, mtimeMs: Date.now() }))
    }

    if (path === '/api/v1/stat' && method === 'GET') {
      const workspaceId = workspaceIdFromRequest(route)
      const targetPath = url.searchParams.get('path') ?? ''
      const files = filesByWorkspace.get(workspaceId) ?? new Map()
      if (files.has(targetPath)) {
        return route.fulfill(json({ kind: 'file', size: files.get(targetPath)?.length ?? 0, mtimeMs: 1 }))
      }
      if (listEntries(files, targetPath).length > 0) {
        return route.fulfill(json({ kind: 'dir', size: 0, mtimeMs: 1 }))
      }
      return route.fulfill(json({ error: 'not_found' }, 404))
    }

    if (path === '/api/v1/agent/models') {
      return route.fulfill(json({ models: [] }))
    }

    if (path === '/api/v1/agent/sessions' && method === 'GET') {
      const workspaceId = workspaceIdFromRequest(route)
      sessionRequests.push(workspaceId)
      return route.fulfill(json(sessionsByWorkspace.get(workspaceId) ?? []))
    }

    if (path === '/api/v1/agent/sessions' && method === 'POST') {
      const workspaceId = workspaceIdFromRequest(route)
      sessionRequests.push(workspaceId)
      const body = JSON.parse(request.postData() ?? '{}') as { title?: string }
      const now = new Date().toISOString()
      const session: SessionSummary = {
        id: `${workspaceId}-session-${++sessionSeq}`,
        title: body.title ?? 'New session',
        createdAt: now,
        updatedAt: now,
        turnCount: 0,
      }
      sessionsByWorkspace.set(workspaceId, [
        session,
        ...(sessionsByWorkspace.get(workspaceId) ?? []),
      ])
      return route.fulfill(json(session, 201))
    }

    const sessionDetailMatch = path.match(/^\/api\/v1\/agent\/sessions\/([^/]+)$/)
    if (sessionDetailMatch && method === 'GET') {
      const workspaceId = workspaceIdFromRequest(route)
      const session = (sessionsByWorkspace.get(workspaceId) ?? [])
        .find((item) => item.id === sessionDetailMatch[1])
      if (!session) return route.fulfill(json({ error: 'not_found' }, 404))
      return route.fulfill(json({ ...session, messages: [] }))
    }

    if (path === '/api/v1/ui/state' && method === 'PUT') {
      return route.fulfill({ status: 204, body: '' })
    }

    if (path === '/api/v1/ui/commands/next') {
      const workspaceId = uiCommandWorkspaceIdFromRequest(route)
      const commands = uiCommandsByWorkspace.get(workspaceId) ?? []
      const drained = commands.splice(0)
      if (url.searchParams.get('poll') === 'true') return route.fulfill(json(drained))
      const commandEvents = drained
        .map((command) => `event: command\ndata: ${JSON.stringify(command)}\n\n`)
        .join('')
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: init\ndata: {"v":1}\n\n${commandEvents}`,
      })
    }

    if (path === '/api/v1/fs/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: init\ndata: {"v":1}\n\n',
      })
    }

    if (path.startsWith('/api/v1/agent/')) {
      return route.fulfill(json({}))
    }

    return route.continue()
  })

  return { filesByWorkspace, fileWrites, sessionRequests, treeRequests, uiCommandsByWorkspace }
}

async function openWorkspaceMenu(page: Page) {
  await page.getByRole('button', { name: /Workspace menu:/ }).click()
}

async function switchWorkspace(page: Page, name: string, id: string) {
  await openWorkspaceMenu(page)
  await page.getByRole('menuitem', { name }).click()
  await expect(page).toHaveURL(new RegExp(`/workspace/${id}$`))
  await expect(page.getByRole('button', { name: new RegExp(`Workspace menu: ${name}`) }))
    .toBeVisible({ timeout: 10_000 })
}

async function openWorkbench(page: Page) {
  const button = page.getByRole('button', { name: 'Workbench' })
  if (await button.isVisible().catch(() => false)) {
    await button.click()
  }
  await expect(page.getByLabel('Workbench left pane')).toBeVisible({ timeout: 10_000 })
}

test('agent openFile command opens a closed workbench and focuses the file', async ({ page, baseURL }) => {
  const state = await installWorkspaceLifecycleMocks(page, baseURL)
  state.uiCommandsByWorkspace.set('ws-alpha', [
    { kind: 'openFile', params: { path: 'alpha.ts' }, seq: 1 },
  ])

  await page.goto('/workspace/ws-alpha')
  await expect(page.getByRole('button', { name: /Workspace menu: Alpha Workspace/ }))
    .toBeVisible({ timeout: 10_000 })

  await expect(page.getByLabel('Surface')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Nothing open yet')).toBeHidden({ timeout: 10_000 })
  await expect(page.locator('.cm-content')).toContainText('export const alpha = 1', { timeout: 10_000 })
})

test('workspace create and switch keeps files and sessions scoped per workspace', async ({ page, baseURL }) => {
  const state = await installWorkspaceLifecycleMocks(page, baseURL)

  await page.goto('/workspace/ws-alpha')
  await expect(page.getByRole('button', { name: /Workspace menu: Alpha Workspace/ }))
    .toBeVisible({ timeout: 10_000 })

  await openWorkbench(page)
  await expect(page.getByRole('treeitem', { name: /alpha\.md/ })).toBeVisible()
  await page.getByRole('treeitem', { name: /alpha\.md/ }).click()
  await expect(page.getByText('Nothing open yet')).toBeHidden({ timeout: 10_000 })

  await switchWorkspace(page, 'Beta Workspace', 'ws-beta')
  await openWorkbench(page)
  await expect(page.getByRole('treeitem', { name: /beta\.md/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /alpha\.md/ })).toHaveCount(0)

  await openWorkspaceMenu(page)
  await page.getByRole('menuitem', { name: 'Create workspace' }).click()
  await page.getByLabel('Name').fill('Gamma Workspace')
  await page.getByRole('button', { name: 'Create workspace' }).click()

  await expect(page).toHaveURL(/\/workspace\/ws-gamma-workspace$/)
  await expect(page.getByRole('button', { name: /Workspace menu: Gamma Workspace/ }))
    .toBeVisible({ timeout: 10_000 })
  await openWorkbench(page)

  const leftPane = page.getByLabel('Workbench left pane')
  await leftPane.click({ button: 'right', position: { x: 40, y: 110 } })
  await page.getByRole('menuitem', { name: 'New file' }).click()
  await page.getByTestId('file-tree-edit-input').fill('notes.md')
  await page.getByTestId('file-tree-edit-input').press('Enter')

  await expect(page.getByRole('treeitem', { name: /notes\.md/ })).toBeVisible({ timeout: 10_000 })
  expect(state.filesByWorkspace.get('ws-gamma-workspace')?.get('notes.md')).toBe('')
  expect(state.fileWrites).toContainEqual({
    workspaceId: 'ws-gamma-workspace',
    path: 'notes.md',
    content: '',
  })

  await switchWorkspace(page, 'Beta Workspace', 'ws-beta')
  await openWorkbench(page)
  await expect(page.getByRole('treeitem', { name: /beta\.md/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /notes\.md/ })).toHaveCount(0)

  await switchWorkspace(page, 'Gamma Workspace', 'ws-gamma-workspace')
  await openWorkbench(page)
  await expect(page.getByRole('treeitem', { name: /notes\.md/ })).toBeVisible()

  expect(new Set(state.sessionRequests)).toEqual(
    new Set(['ws-alpha', 'ws-beta', 'ws-gamma-workspace']),
  )
  expect(new Set(state.treeRequests)).toEqual(
    new Set(['ws-alpha', 'ws-beta', 'ws-gamma-workspace']),
  )
})
