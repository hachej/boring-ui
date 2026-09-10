import { ErrorCode, InMemoryShareEntryStore, ShareEntryErrorCode } from '@hachej/boring-agent/shared'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { mocks } from './createCoreWorkspaceAgentServer.testHarness.js'

const config = createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })

beforeEach(() => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({
    id,
    appId: config.appId,
    defaultAgentTypeId: null,
  }))
  mocks.getUser.mockImplementation(async (id: string) => ({ id }))
  mocks.isMember.mockImplementation(async (_workspaceId: string, userId: string) => userId === 'member-1')
})

describe('Core GET /a/:id lazy authorization', () => {
  test('hides live-share existence from anonymous/non-members while serving authorized live and tombstoned shares', async () => {
    const store = new InMemoryShareEntryStore()
    const live = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/live.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2026-09-10T00:00:00.000Z' },
    })
    const tombstoned = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/gone.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2026-09-10T00:00:00.000Z' },
    })
    const unavailable = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/unavailable.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2026-09-10T00:00:00.000Z' },
    })
    const release = vi.fn(async () => {})
    mocks.acquireEnvironment.mockImplementation(async () => ({
      workspace: {
        root: '/runtime/workspace-1',
        runtimeContext: { runtimeCwd: '/runtime/workspace-1' },
        stat: vi.fn(async (path: string) => {
          if (path === tombstoned.path) {
            throw Object.assign(new Error('PATH_NOT_FOUND'), { code: ErrorCode.enum.PATH_NOT_FOUND })
          }
          if (path === unavailable.path) {
            throw Object.assign(new Error('runtime Workspace unavailable'), { code: ErrorCode.enum.WORKSPACE_NOT_READY })
          }
          return { kind: 'file', size: 18, mtimeMs: 1 }
        }),
        readFile: vi.fn(async () => '# authorized live'),
      },
      fileSearch: {},
      gitWorkspace: {},
      release,
    }))

    const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
    const app = await createCoreWorkspaceAgentServer({
      config,
      workspaceRoot: '/tmp/full-app-workspaces',
      serveFrontend: false,
      shareEntryStore: store,
    })

    try {
      const nonMember = await app.inject({
        method: 'GET',
        url: `/a/${live.id}`,
        headers: { 'x-test-user-id': 'outsider' },
      })
      const anonymous = await app.inject({ method: 'GET', url: `/a/${live.id}` })
      const nonexistent = await app.inject({
        method: 'GET',
        url: '/a/opaque-id-that-does-not-exist',
        headers: { 'x-test-user-id': 'outsider' },
      })

      const denialBody = {
        error: { code: ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND, message: 'share not found' },
      }
      for (const response of [nonMember, anonymous, nonexistent]) {
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual(denialBody)
        expect(response.body).not.toContain(live.path)
        expect(response.headers).not.toHaveProperty('set-cookie')
      }
      const stableHeaders = ({ date: _date, ...headers }: typeof nonMember.headers) => headers
      expect(stableHeaders(nonMember.headers)).toEqual(stableHeaders(nonexistent.headers))
      expect(stableHeaders(anonymous.headers)).toEqual(stableHeaders(nonexistent.headers))
      expect(mocks.acquireEnvironment).not.toHaveBeenCalled()
      expect(mocks.isMember).toHaveBeenCalledWith('workspace-1', 'outsider')
      expect(mocks.isMember).toHaveBeenCalledWith('', 'outsider')

      const authorized = await app.inject({
        method: 'GET',
        url: `/a/${live.id}`,
        headers: { 'x-test-user-id': 'member-1' },
      })
      expect(authorized.statusCode).toBe(200)
      expect(authorized.body).toBe('# authorized live')
      expect(authorized.headers['content-type']).toContain('application/octet-stream')
      expect(authorized.headers['content-disposition']).toBe('attachment; filename="artifact.md"')
      expect(authorized.headers['x-content-type-options']).toBe('nosniff')
      expect(authorized.headers['content-security-policy']).toContain("default-src 'none'")
      expect(authorized.body).not.toContain(live.path)

      const tombstone = await app.inject({
        method: 'GET',
        url: `/a/${tombstoned.id}`,
        headers: { 'x-test-user-id': 'member-1' },
      })
      expect(tombstone.statusCode).toBe(200)
      expect(tombstone.json()).toEqual({
        status: 'tombstoned',
        code: ShareEntryErrorCode.enum.AR1_SHARE_TOMBSTONED,
        tombstone: {
          id: tombstoned.id,
          workspaceId: 'workspace-1',
          provenance: tombstoned.provenance,
        },
      })
      expect(tombstone.body).not.toContain(tombstoned.path)

      const operationalFailure = await app.inject({
        method: 'GET',
        url: `/a/${unavailable.id}`,
        headers: { 'x-test-user-id': 'member-1' },
      })
      expect(operationalFailure.statusCode).toBe(500)
      expect(operationalFailure.body).not.toContain(unavailable.path)
      expect(operationalFailure.body).not.toContain('tombstoned')
      expect(mocks.acquireEnvironment).toHaveBeenCalledTimes(3)
      expect(release).toHaveBeenCalledTimes(3)
    } finally {
      await app.close()
    }
  }, 60_000)
})
