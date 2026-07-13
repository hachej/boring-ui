import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { describe, expect, test } from 'vitest'
import { deepLinkRoutes } from '../deepLink'
import { InMemoryShareEntryStore, ShareEntryErrorCode, type ShareEntryStore } from '../../../../shared/share-entry'
import type { Stat, Workspace } from '../../../../shared/workspace'

/** Minimal fake satisfying the `Workspace` contract for `stat`-only tests (mirrors share-entry.test.ts). */
function fakeWorkspace(opts: { existingPaths: Set<string> }): Workspace {
  return {
    root: '/workspace',
    runtimeContext: { runtimeCwd: '/workspace' },
    async readFile() {
      throw new Error('not implemented')
    },
    async writeFile() {
      throw new Error('not implemented')
    },
    async unlink() {
      throw new Error('not implemented')
    },
    async readdir() {
      return []
    },
    async stat(relPath: string): Promise<Stat> {
      if (!opts.existingPaths.has(relPath)) {
        throw new Error(`PATH_NOT_FOUND: ${relPath}`)
      }
      return { size: 0, mtimeMs: Date.now(), kind: 'file' }
    },
    async mkdir() {
      throw new Error('not implemented')
    },
    async rename() {
      throw new Error('not implemented')
    },
  }
}

async function buildApp(opts: {
  store: ShareEntryStore
  workspace: Workspace
  /** Simulates the caller's already-authorized/scoped workspace (set by the host's existing membership seam before this route runs). */
  requestWorkspaceId: string
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.workspaceContext = { workspaceId: opts.requestWorkspaceId, authenticated: true }
  })
  await app.register(deepLinkRoutes, {
    store: opts.store,
    getWorkspace: async () => opts.workspace,
  })
  await app.ready()
  return app
}

describe('GET /a/:id (AR1-003 Lane W deep link)', () => {
  test('member ok: authorized member lands on a live entry', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/q1.md',
      provenance: { producerPrincipalRef: 'agent-a' },
    })
    const workspace = fakeWorkspace({ existingPaths: new Set([entry.path]) })
    const app = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-1' })

    const res = await app.inject({ method: 'GET', url: `/a/${entry.id}` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ status: 'ok', workspaceId: 'workspace-1', id: entry.id })
    expect(JSON.stringify(body)).not.toContain('reports/q1.md')
    await app.close()
  })

  test('member tombstone: deleted target renders provenance, never a bare 404', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/q1.md',
      provenance: { producerPrincipalRef: 'agent-a', createdAt: '2020-01-01T00:00:00.000Z' },
    })
    const workspace = fakeWorkspace({ existingPaths: new Set() })
    const app = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-1' })

    const res = await app.inject({ method: 'GET', url: `/a/${entry.id}` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      status: 'tombstoned',
      code: ShareEntryErrorCode.enum.AR1_SHARE_TOMBSTONED,
      tombstone: {
        id: entry.id,
        workspaceId: 'workspace-1',
        provenance: { producerPrincipalRef: 'agent-a', createdAt: '2020-01-01T00:00:00.000Z' },
      },
    })
    expect(JSON.stringify(body)).not.toContain('reports/q1.md')
    await app.close()
  })

  test('non-member and nonexistent id are indistinguishable (same status, body, and code)', async () => {
    const store = new InMemoryShareEntryStore()
    const entry = await store.create({
      workspaceId: 'workspace-1',
      path: 'reports/q1.md',
      provenance: { producerPrincipalRef: 'agent-a' },
    })
    const workspace = fakeWorkspace({ existingPaths: new Set([entry.path]) })

    // Requester scoped to a DIFFERENT workspace than the entry (not a member of workspace-1).
    const nonMemberApp = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-2' })
    const nonMemberRes = await nonMemberApp.inject({ method: 'GET', url: `/a/${entry.id}` })

    // A genuinely nonexistent id, requested from the same (or any) workspace scope.
    const nonexistentApp = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-2' })
    const nonexistentRes = await nonexistentApp.inject({ method: 'GET', url: '/a/does-not-exist' })

    expect(nonMemberRes.statusCode).toBe(404)
    expect(nonexistentRes.statusCode).toBe(404)
    expect(nonMemberRes.json()).toEqual(nonexistentRes.json())
    expect(nonMemberRes.json()).toEqual({
      error: { code: ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND, message: 'share not found' },
    })

    // A member of workspace-1 requesting the *same* nonexistent id gets the identical shape too.
    const memberApp = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-1' })
    const memberNonexistentRes = await memberApp.inject({ method: 'GET', url: '/a/does-not-exist' })
    expect(memberNonexistentRes.statusCode).toBe(404)
    expect(memberNonexistentRes.json()).toEqual(nonMemberRes.json())

    await nonMemberApp.close()
    await nonexistentApp.close()
    await memberApp.close()
  })

  test('no path ever appears in any response body (ok, tombstone, or denial)', async () => {
    const store = new InMemoryShareEntryStore()
    const secretPath = 'private/secret-report.md'
    const liveEntry = await store.create({
      workspaceId: 'workspace-1',
      path: secretPath,
      provenance: { producerPrincipalRef: 'agent-a' },
    })
    const goneEntry = await store.create({
      workspaceId: 'workspace-1',
      path: secretPath,
      provenance: { producerPrincipalRef: 'agent-a' },
    })
    const workspace = fakeWorkspace({ existingPaths: new Set([liveEntry.path]) })

    const app = await buildApp({ store, workspace, requestWorkspaceId: 'workspace-1' })

    const okRes = await app.inject({ method: 'GET', url: `/a/${liveEntry.id}` })
    const tombstoneRes = await app.inject({ method: 'GET', url: `/a/${goneEntry.id}` })
    const deniedRes = await app.inject({ method: 'GET', url: '/a/does-not-exist' })

    for (const res of [okRes, tombstoneRes, deniedRes]) {
      expect(res.body).not.toContain(secretPath)
      expect(res.body).not.toContain('private/')
    }

    await app.close()
  })
})
