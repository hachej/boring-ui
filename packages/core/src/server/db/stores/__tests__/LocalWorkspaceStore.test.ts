import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { LocalUserStore } from '../LocalUserStore'
import { LocalWorkspaceStore } from '../LocalWorkspaceStore'
import { ERROR_CODES, HttpError } from '../../../../shared/errors'
import { describeWorkspaceStoreConformance } from '../../__tests__/storeConformance'

let userStore: LocalUserStore
let store: LocalWorkspaceStore

beforeEach(async () => {
  userStore = new LocalUserStore()
  store = new LocalWorkspaceStore(userStore)
  await userStore.upsert('u1', { email: 'alice@test.com', name: 'Alice' })
  await userStore.upsert('u2', { email: 'bob@test.com', name: 'Bob' })
})

describe('LocalWorkspaceStore', () => {
  describe('workspace CRUD', () => {
    it('creates a workspace and adds creator as owner', async () => {
      const ws = await store.create('u1', 'My WS', 'app1')
      expect(ws.name).toBe('My WS')
      expect(ws.appId).toBe('app1')
      expect(ws.createdBy).toBe('u1')
      const role = await store.getMemberRole(ws.id, 'u1')
      expect(role).toBe('owner')
    })

    it('list filters by userId and appId', async () => {
      await store.create('u1', 'WS1', 'app1')
      await store.create('u1', 'WS2', 'app2')
      await store.create('u2', 'WS3', 'app1')
      const list = await store.list('u1', 'app1')
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('WS1')
    })

    it('list returns isDefault first, then createdAt DESC', async () => {
      const ws1 = await store.create('u1', 'Oldest', 'app1')
      const ws2 = await store.create('u1', 'Middle', 'app1')
      const ws3 = await store.create('u1', 'Newest', 'app1')
      const wsMap = (store as any).workspaces as Map<string, any>
      wsMap.set(ws1.id, { ...wsMap.get(ws1.id), createdAt: '2026-01-01T00:00:00.000Z', isDefault: true })
      wsMap.set(ws2.id, { ...wsMap.get(ws2.id), createdAt: '2026-01-02T00:00:00.000Z' })
      wsMap.set(ws3.id, { ...wsMap.get(ws3.id), createdAt: '2026-01-03T00:00:00.000Z' })
      const list = await store.list('u1', 'app1')
      expect(list[0].name).toBe('Oldest')
      expect(list[0].isDefault).toBe(true)
      expect(list[1].name).toBe('Newest')
      expect(list[2].name).toBe('Middle')
    })

    it('get returns null for non-existent workspace', async () => {
      expect(await store.get('nonexistent')).toBeNull()
    })

    it('update changes workspace name', async () => {
      const ws = await store.create('u1', 'Old', 'app1')
      const updated = await store.update(ws.id, { name: 'New' })
      expect(updated?.name).toBe('New')
    })

    it('delete soft-deletes the workspace', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const result = await store.delete(ws.id)
      expect(result.removed).toBe(true)
      expect(await store.get(ws.id)).toBeNull()
    })

    it('delete returns not_found for unknown workspace', async () => {
      const result = await store.delete('nonexistent')
      expect(result.removed).toBe(false)
      expect(result.code).toBe(ERROR_CODES.NOT_FOUND)
    })
  })

  describe('getWorkspacesWhereSoleOwner', () => {
    it('returns workspace where user is the only owner', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const soleOwned = await store.getWorkspacesWhereSoleOwner('u1')
      expect(soleOwned).toHaveLength(1)
      expect(soleOwned[0].id).toBe(ws.id)
    })

    it('returns empty when another owner exists', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.upsertMember(ws.id, 'u2', 'owner')
      const soleOwned = await store.getWorkspacesWhereSoleOwner('u1')
      expect(soleOwned).toHaveLength(0)
    })
  })

  describe('membership', () => {
    it('isMember returns true for members', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      expect(await store.isMember(ws.id, 'u1')).toBe(true)
      expect(await store.isMember(ws.id, 'u2')).toBe(false)
    })

    it('listMembers returns enriched member records', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const members = await store.listMembers(ws.id)
      expect(members).toHaveLength(1)
      expect(members[0].user.email).toBe('alice@test.com')
      expect(members[0].role).toBe('owner')
    })

    it('upsertMember adds or updates a member', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.upsertMember(ws.id, 'u2', 'editor')
      expect(await store.getMemberRole(ws.id, 'u2')).toBe('editor')
      await store.upsertMember(ws.id, 'u2', 'viewer')
      expect(await store.getMemberRole(ws.id, 'u2')).toBe('viewer')
    })

    it('removeMember removes a non-owner member', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.upsertMember(ws.id, 'u2', 'editor')
      const result = await store.removeMember(ws.id, 'u2')
      expect(result.removed).toBe(true)
    })

    it('removeMember blocks removing last owner', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const result = await store.removeMember(ws.id, 'u1')
      expect(result.removed).toBe(false)
      expect(result.code).toBe(ERROR_CODES.LAST_OWNER)
    })

    it('removeMember returns not_member for non-members', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const result = await store.removeMember(ws.id, 'u2')
      expect(result.removed).toBe(false)
      expect(result.code).toBe(ERROR_CODES.NOT_MEMBER)
    })
  })

  describe('invites', () => {
    it('createInvite returns invite + rawToken', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite, rawToken } = await store.createInvite(ws.id, 'charlie@test.com', 'editor', 'u1')
      expect(invite.email).toBe('charlie@test.com')
      expect(invite.role).toBe('editor')
      expect(rawToken).toBeDefined()
      expect(invite.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'))
    })

    it('getInviteByTokenHash finds invite', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite, rawToken } = await store.createInvite(ws.id, 'c@t.com', 'viewer', null)
      const hash = createHash('sha256').update(rawToken).digest('hex')
      const found = await store.getInviteByTokenHash(hash)
      expect(found?.id).toBe(invite.id)
    })

    it('listInvites returns all invites for workspace', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.createInvite(ws.id, 'a@t.com', 'editor', null)
      await store.createInvite(ws.id, 'b@t.com', 'viewer', null)
      const invites = await store.listInvites(ws.id)
      expect(invites).toHaveLength(2)
    })

    it('revokeInvite removes the invite', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite } = await store.createInvite(ws.id, 'c@t.com', 'editor', null)
      expect(await store.revokeInvite(ws.id, invite.id)).toBe(true)
      expect(await store.getInvite(ws.id, invite.id)).toBeNull()
    })

    it('acceptInvite adds member and marks invite accepted', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite } = await store.createInvite(ws.id, 'bob@test.com', 'editor', 'u1')
      const result = await store.acceptInvite(ws.id, invite.id, 'u2')
      expect(result.member.role).toBe('editor')
      expect(result.invite.acceptedAt).toBeDefined()
    })

    it('acceptInvite throws INVITE_EXPIRED (410) on expired invite', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite } = await store.createInvite(ws.id, 'bob@test.com', 'editor', null)
      const expired = { ...invite, expiresAt: new Date(Date.now() - 1000).toISOString() }
      ;(store as any).invites.set(invite.id, expired)
      try {
        await store.acceptInvite(ws.id, invite.id, 'u2')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        expect((e as HttpError).status).toBe(410)
        expect((e as HttpError).code).toBe(ERROR_CODES.INVITE_EXPIRED)
      }
    })

    it('acceptInvite throws INVITE_EMAIL_MISMATCH (403) on email mismatch', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite } = await store.createInvite(ws.id, 'other@test.com', 'editor', null)
      try {
        await store.acceptInvite(ws.id, invite.id, 'u2')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        expect((e as HttpError).status).toBe(403)
        expect((e as HttpError).code).toBe(ERROR_CODES.INVITE_EMAIL_MISMATCH)
      }
    })

    it('acceptInvite throws INVITE_ALREADY_ACCEPTED (410) on already accepted', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const { invite } = await store.createInvite(ws.id, 'bob@test.com', 'editor', null)
      await store.acceptInvite(ws.id, invite.id, 'u2')
      try {
        await store.acceptInvite(ws.id, invite.id, 'u2')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        expect((e as HttpError).status).toBe(410)
        expect((e as HttpError).code).toBe(ERROR_CODES.INVITE_ALREADY_ACCEPTED)
      }
    })
  })

  describe('workspace settings', () => {
    it('returns empty for workspace with no settings', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      expect(await store.getWorkspaceSettings(ws.id)).toEqual([])
    })

    it('putWorkspaceSettings stores and returns metadata', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const result = await store.putWorkspaceSettings(ws.id, { github_token: 'abc' })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('github_token')
      expect(result[0].configured).toBe(true)
    })
  })

  describe('workspace runtime', () => {
    it('create seeds runtime as ready', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      const runtime = await store.getWorkspaceRuntime(ws.id)
      expect(runtime?.state).toBe('ready')
    })

    it('getWorkspaceRuntime auto-creates ready for existing workspace', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      // Delete the runtime to simulate a gap
      ;(store as any).runtimes.delete(ws.id)
      const runtime = await store.getWorkspaceRuntime(ws.id)
      expect(runtime?.state).toBe('ready')
    })

    it('putWorkspaceRuntime updates state', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.putWorkspaceRuntime(ws.id, { state: 'error', lastError: 'failed' })
      const runtime = await store.getWorkspaceRuntime(ws.id)
      expect(runtime?.state).toBe('error')
      expect(runtime?.lastError).toBe('failed')
    })

    it('retryWorkspaceRuntime moves error to pending', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      await store.putWorkspaceRuntime(ws.id, { state: 'error', lastError: 'oops' })
      const retried = await store.retryWorkspaceRuntime(ws.id)
      expect(retried?.state).toBe('pending')
      expect(retried?.lastError).toBeNull()
    })

    it('retryWorkspaceRuntime returns null if not in error state', async () => {
      const ws = await store.create('u1', 'WS', 'app1')
      expect(await store.retryWorkspaceRuntime(ws.id)).toBeNull()
    })

    it('stores provider-agnostic runtime resources', async () => {
      const ws = await store.create('u1', 'WS', 'app1')

      const created = await store.putWorkspaceRuntimeResource(ws.id, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'named',
        stableKey: `boring-dev-${ws.id}`,
        providerResourceId: 'sbx_current',
        state: 'ready',
        persistenceMode: 'persistent',
        providerMeta: { runtime: 'node24' },
        lastUsedAt: '2026-04-29T00:00:00.000Z',
      })

      expect(created.generation).toBe(0)
      expect(created.stableKey).toBe(`boring-dev-${ws.id}`)

      const fetched = await store.getWorkspaceRuntimeResource(ws.id, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })
      expect(fetched?.providerResourceId).toBe('sbx_current')
      expect(fetched?.providerMeta).toEqual({ runtime: 'node24' })

      await store.deleteWorkspaceRuntimeResource(ws.id, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })
      expect(await store.getWorkspaceRuntimeResource(ws.id, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })).toBeNull()
    })
  })

  describe('UI state', () => {
    it('returns null for missing UI state', async () => {
      expect(await store.getUiState('u1', 'ws1')).toBeNull()
    })

    it('stores and retrieves UI state', async () => {
      await store.putUiState('u1', 'ws1', { panel: 'chat', collapsed: true })
      const state = await store.getUiState('u1', 'ws1')
      expect(state).toEqual({ panel: 'chat', collapsed: true })
    })
  })

  describe('dev seed', () => {
    it('auto-seeds dev@local user and default workspace in local mode', async () => {
      const devUserStore = new LocalUserStore()
      devUserStore.seed({ id: 'dev-local', email: 'dev@local', name: 'Dev User', emailVerified: true, image: null })
      const devWsStore = new LocalWorkspaceStore(devUserStore)
      const ws = await devWsStore.create('dev-local', 'Default workspace', 'test-app')
      expect(ws.name).toBe('Default workspace')
      const user = await devUserStore.getById('dev-local')
      expect(user?.email).toBe('dev@local')
    })
  })
})

describeWorkspaceStoreConformance(
  async () => store,
  {
    makeUserStore: async () => userStore,
    deleteRuntime: async (workspaceId: string) => {
      ;(store as unknown as { runtimes: Map<string, unknown> }).runtimes.delete(workspaceId)
    },
    expireInvite: async (_workspaceId: string, inviteId: string) => {
      const invites = (store as unknown as { invites: Map<string, { expiresAt: string }> }).invites
      const invite = invites.get(inviteId)
      if (!invite) {
        throw new Error(`invite ${inviteId} not found`)
      }
      invites.set(inviteId, {
        ...invite,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
    },
    makeAppIds: () => ({ appId: 'app1', otherAppId: 'app2' }),
    emailDomain: 'local.storetest.dev',
  },
)
