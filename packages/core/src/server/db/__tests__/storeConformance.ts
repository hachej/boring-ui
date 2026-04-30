import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { withBeadId } from '../../__tests__/_setup'
import type { UserStore, WorkspaceStore } from '../../app/types.js'
import { ERROR_CODES } from '../../../shared/errors.js'

const BEAD_ID = 'boring-ui-v2-dvmv'

type MaybePromise<T> = T | Promise<T>

interface WorkspaceStoreConformanceOptions {
  makeUserStore: () => MaybePromise<UserStore>
  deleteRuntime: (workspaceId: string) => MaybePromise<void>
  expireInvite: (workspaceId: string, inviteId: string) => MaybePromise<void>
  makeAppIds?: () => { appId: string; otherAppId: string }
  emailDomain?: string
}

interface UserStoreConformanceOptions {
  emailDomain?: string
}

interface SeededUsers {
  owner: { id: string; email: string; name: string }
  member: { id: string; email: string; name: string }
  other: { id: string; email: string; name: string }
}

function defaultAppIds() {
  const tag = randomUUID().slice(0, 8)
  return {
    appId: `store-conformance-${tag}`,
    otherAppId: `store-conformance-alt-${tag}`,
  }
}

async function seedUsers(
  userStore: UserStore,
  emailDomain: string,
): Promise<SeededUsers> {
  const tag = randomUUID().slice(0, 8)
  const owner = {
    id: randomUUID(),
    email: `owner-${tag}@${emailDomain}`,
    name: 'Owner Test',
  }
  const member = {
    id: randomUUID(),
    email: `member-${tag}@${emailDomain}`,
    name: 'Member Test',
  }
  const other = {
    id: randomUUID(),
    email: `other-${tag}@${emailDomain}`,
    name: 'Other Test',
  }

  await userStore.upsert(owner.id, { email: owner.email, name: owner.name })
  await userStore.upsert(member.id, { email: member.email, name: member.name })
  await userStore.upsert(other.id, { email: other.email, name: other.name })

  return { owner, member, other }
}

async function expectHttpErrorCode(
  run: Promise<unknown>,
  status: number,
  code: string,
) {
  await expect(run).rejects.toMatchObject({ status, code })
}

export function describeUserStoreConformance(
  make: () => MaybePromise<UserStore>,
  options: UserStoreConformanceOptions = {},
): void {
  describe('UserStore conformance', () => {
    const emailDomain = options.emailDomain ?? 'storetest.dev'

    it(
      'getById/getByEmail return null for unknown users',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const missingId = await store.getById(randomUUID())
        const missingEmail = await store.getByEmail(`missing-${randomUUID()}@test.invalid`)
        expect(missingId).toBeNull()
        expect(missingEmail).toBeNull()
        assertionPassed('unknown-lookups-return-null')
      }),
    )

    it(
      'upsert creates user retrievable by id and email',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const email = `create-${randomUUID().slice(0, 8)}@${emailDomain}`

        const created = await store.upsert(userId, { email, name: 'Created User' })
        const byId = await store.getById(userId)
        const byEmail = await store.getByEmail(email)

        expect(created.id).toBe(userId)
        expect(created.email).toBe(email)
        expect(created.emailVerified).toBe(false)
        expect(byId?.id).toBe(userId)
        expect(byEmail?.id).toBe(userId)
        assertionPassed('upsert-creates-and-indexes-user')
      }),
    )

    it(
      'upsert updates existing user and refreshes email lookup',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const oldEmail = `old-${randomUUID().slice(0, 8)}@${emailDomain}`
        const newEmail = `new-${randomUUID().slice(0, 8)}@${emailDomain}`

        await store.upsert(userId, { email: oldEmail, name: 'Old Name' })
        const updated = await store.upsert(userId, { email: newEmail, name: 'New Name' })

        expect(updated.name).toBe('New Name')
        expect(updated.email).toBe(newEmail)
        expect(await store.getByEmail(oldEmail)).toBeNull()
        expect((await store.getByEmail(newEmail))?.id).toBe(userId)
        assertionPassed('upsert-updates-existing-user')
      }),
    )

    it(
      'getByEmail is case-insensitive',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const email = `case-${randomUUID().slice(0, 8)}@${emailDomain}`
        await store.upsert(userId, { email, name: 'Case User' })

        const upper = await store.getByEmail(email.toUpperCase())
        const lower = await store.getByEmail(email.toLowerCase())

        expect(upper?.id).toBe(userId)
        expect(lower?.id).toBe(userId)
        assertionPassed('email-lookup-case-insensitive')
      }),
    )

    it(
      'getUserSettings returns defaults from user profile',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const email = `defaults-${randomUUID().slice(0, 8)}@${emailDomain}`
        await store.upsert(userId, { email, name: 'Profile Name' })

        const settings = await store.getUserSettings(userId, 'app-a')
        expect(settings.displayName).toBe('Profile Name')
        expect(settings.email).toBe(email)
        expect(settings.settings).toEqual({})
        assertionPassed('default-user-settings-derived-from-user-record')
      }),
    )

    it(
      'putUserSettings writes settings and scopes by appId',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const email = `scope-${randomUUID().slice(0, 8)}@${emailDomain}`
        await store.upsert(userId, { email, name: 'Scoped User' })

        const appA = await store.putUserSettings(userId, 'app-a', {
          displayName: 'App A',
          settings: { theme: 'dark' },
        })
        const appB = await store.putUserSettings(userId, 'app-b', {
          displayName: 'App B',
          settings: { theme: 'light' },
        })

        expect(appA.displayName).toBe('App A')
        expect(appB.displayName).toBe('App B')
        expect((await store.getUserSettings(userId, 'app-a')).settings).toEqual({ theme: 'dark' })
        expect((await store.getUserSettings(userId, 'app-b')).settings).toEqual({ theme: 'light' })
        assertionPassed('user-settings-are-app-scoped')
      }),
    )

    it(
      'putUserSettings partial update preserves unspecified fields',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const store = await make()
        const userId = randomUUID()
        const email = `partial-${randomUUID().slice(0, 8)}@${emailDomain}`
        await store.upsert(userId, { email, name: 'Partial User' })

        await store.putUserSettings(userId, 'app-a', {
          displayName: 'Before',
          email: 'before@storetest.dev',
          settings: { feature: 'on' },
        })

        const updated = await store.putUserSettings(userId, 'app-a', {
          displayName: 'After',
        })

        expect(updated.displayName).toBe('After')
        expect(updated.email).toBe('before@storetest.dev')
        expect(updated.settings).toEqual({ feature: 'on' })
        assertionPassed('partial-settings-update-preserves-fields')
      }),
    )
  })
}

export function describeWorkspaceStoreConformance(
  make: () => MaybePromise<WorkspaceStore>,
  options: WorkspaceStoreConformanceOptions,
): void {
  describe('WorkspaceStore conformance', () => {
    async function setup() {
      const workspaceStore = await make()
      const userStore = await options.makeUserStore()
      const { appId, otherAppId } = options.makeAppIds?.() ?? defaultAppIds()
      const users = await seedUsers(userStore, options.emailDomain ?? 'storetest.dev')
      return { workspaceStore, userStore, appId, otherAppId, users }
    }

    it(
      'create adds workspace and owner membership',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Conformance WS', appId)
        expect(ws.appId).toBe(appId)
        expect(ws.createdBy).toBe(users.owner.id)
        expect(await workspaceStore.getMemberRole(ws.id, users.owner.id)).toBe('owner')
        assertionPassed('workspace-create-adds-owner-member')
      }),
    )

    it(
      'list scopes by membership and appId',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, otherAppId, users } = await setup()
        const owned = await workspaceStore.create(users.owner.id, 'Owned', appId)
        await workspaceStore.create(users.owner.id, 'Other App', otherAppId)
        await workspaceStore.create(users.member.id, 'Not Member', appId)

        const list = await workspaceStore.list(users.owner.id, appId)
        expect(list.map((ws) => ws.id)).toContain(owned.id)
        expect(list.every((ws) => ws.appId === appId)).toBe(true)
        expect(list.some((ws) => ws.name === 'Not Member')).toBe(false)
        assertionPassed('workspace-list-respects-app-and-membership')
      }),
    )

    it(
      'get returns workspace by id and null for unknown id',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Lookup', appId)
        expect((await workspaceStore.get(ws.id))?.id).toBe(ws.id)
        expect(await workspaceStore.get(randomUUID())).toBeNull()
        assertionPassed('workspace-get-happy-and-missing')
      }),
    )

    it(
      'update mutates name and returns null for unknown workspace',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Before', appId)
        const updated = await workspaceStore.update(ws.id, { name: 'After' })
        expect(updated?.name).toBe('After')
        expect(await workspaceStore.update(randomUUID(), { name: 'Nope' })).toBeNull()
        assertionPassed('workspace-update-happy-and-missing')
      }),
    )

    it(
      'delete soft-deletes workspace and returns not_found for unknown id',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Delete Me', appId)
        expect(await workspaceStore.delete(ws.id)).toEqual({ removed: true })
        expect(await workspaceStore.get(ws.id)).toBeNull()
        expect(await workspaceStore.update(ws.id, { name: 'After Delete' })).toBeNull()
        expect(await workspaceStore.delete(randomUUID())).toEqual({
          removed: false,
          code: ERROR_CODES.NOT_FOUND,
        })
        assertionPassed('workspace-delete-happy-and-not-found')
      }),
    )

    it(
      'getWorkspacesWhereSoleOwner handles none, sole-owner, and co-owned',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        expect(await workspaceStore.getWorkspacesWhereSoleOwner(users.owner.id)).toEqual([])

        const sole = await workspaceStore.create(users.owner.id, 'Sole', appId)
        const shared = await workspaceStore.create(users.owner.id, 'Shared', appId)
        const deletedSole = await workspaceStore.create(users.owner.id, 'Deleted Sole', appId)
        await workspaceStore.upsertMember(shared.id, users.member.id, 'owner')
        await workspaceStore.delete(deletedSole.id)

        const result = await workspaceStore.getWorkspacesWhereSoleOwner(users.owner.id)
        expect(result.map((ws) => ws.id)).toContain(sole.id)
        expect(result.map((ws) => ws.id)).not.toContain(shared.id)
        expect(result.map((ws) => ws.id)).not.toContain(deletedSole.id)
        assertionPassed('sole-owner-query-all-cases')
      }),
    )

    it(
      'isMember/getMemberRole reflect membership accurately',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Member Check', appId)
        await workspaceStore.upsertMember(ws.id, users.member.id, 'editor')

        expect(await workspaceStore.isMember(ws.id, users.owner.id)).toBe(true)
        expect(await workspaceStore.isMember(ws.id, users.other.id)).toBe(false)
        expect(await workspaceStore.getMemberRole(ws.id, users.member.id)).toBe('editor')
        expect(await workspaceStore.getMemberRole(ws.id, users.other.id)).toBeNull()
        assertionPassed('membership-and-role-lookups')
      }),
    )

    it(
      'listMembers returns enriched members joined with user info',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Members', appId)
        await workspaceStore.upsertMember(ws.id, users.member.id, 'editor')

        const members = await workspaceStore.listMembers(ws.id)
        expect(members).toHaveLength(2)
        const byUserId = new Map(members.map((member) => [member.userId, member]))
        expect(byUserId.get(users.owner.id)?.role).toBe('owner')
        expect(byUserId.get(users.member.id)?.role).toBe('editor')
        expect(byUserId.get(users.member.id)?.user.email).toBe(users.member.email)
        expect(byUserId.get(users.member.id)?.user).toHaveProperty('name')
        expect(byUserId.get(users.member.id)?.user).toHaveProperty('image')
        assertionPassed('listMembers-returns-joined-user-payload')
      }),
    )

    it(
      'upsertMember inserts and updates roles',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Upsert Member', appId)

        const inserted = await workspaceStore.upsertMember(ws.id, users.member.id, 'viewer')
        expect(inserted.role).toBe('viewer')
        const updated = await workspaceStore.upsertMember(ws.id, users.member.id, 'editor')
        expect(updated.role).toBe('editor')
        assertionPassed('upsertMember-insert-and-update')
      }),
    )

    it(
      'removeMember removes members and reports not_member for missing',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Remove', appId)
        await workspaceStore.upsertMember(ws.id, users.member.id, 'editor')

        expect(await workspaceStore.removeMember(ws.id, users.member.id)).toEqual({ removed: true })
        expect(await workspaceStore.getMemberRole(ws.id, users.member.id)).toBeNull()
        expect(await workspaceStore.removeMember(ws.id, users.member.id)).toEqual({
          removed: false,
          code: ERROR_CODES.NOT_MEMBER,
        })
        assertionPassed('removeMember-happy-and-not-member')
      }),
    )

    it(
      'removeMember blocks removing last owner',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Owner Rules', appId)

        expect(await workspaceStore.removeMember(ws.id, users.owner.id)).toEqual({
          removed: false,
          code: ERROR_CODES.LAST_OWNER,
        })
        assertionPassed('removeMember-guards')
      }),
    )

    it(
      'createInvite/listInvites produce workspace-scoped invite records',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invites', appId)
        const otherWs = await workspaceStore.create(users.owner.id, 'Invites Other', appId)

        const first = await workspaceStore.createInvite(ws.id, users.member.email, 'editor', users.owner.id)
        await workspaceStore.createInvite(otherWs.id, users.other.email, 'viewer', users.owner.id)

        expect(first.rawToken.length).toBeGreaterThan(0)
        expect(first.invite.tokenHash).toBe(createHash('sha256').update(first.rawToken).digest('hex'))

        const list = await workspaceStore.listInvites(ws.id)
        expect(list).toHaveLength(1)
        expect(list[0].id).toBe(first.invite.id)
        assertionPassed('createInvite-and-listInvites')
      }),
    )

    it(
      'getInvite/getInviteByTokenHash return matches and null on miss',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invite Lookup', appId)
        const otherWs = await workspaceStore.create(users.owner.id, 'Invite Lookup Other', appId)
        const created = await workspaceStore.createInvite(ws.id, users.member.email, 'viewer', users.owner.id)

        const byId = await workspaceStore.getInvite(ws.id, created.invite.id)
        const byHash = await workspaceStore.getInviteByTokenHash(created.invite.tokenHash)

        expect(byId?.id).toBe(created.invite.id)
        expect(byHash?.id).toBe(created.invite.id)
        expect(await workspaceStore.getInvite(otherWs.id, created.invite.id)).toBeNull()
        expect(await workspaceStore.getInvite(ws.id, randomUUID())).toBeNull()
        expect(await workspaceStore.getInviteByTokenHash(`missing-${randomUUID()}`)).toBeNull()
        assertionPassed('invite-lookup-by-id-and-token-hash')
      }),
    )

    it(
      'revokeInvite removes invite and is idempotent',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invite Revoke', appId)
        const created = await workspaceStore.createInvite(ws.id, users.member.email, 'viewer', users.owner.id)

        expect(await workspaceStore.revokeInvite(ws.id, created.invite.id)).toBe(true)
        expect(await workspaceStore.revokeInvite(ws.id, created.invite.id)).toBe(false)
        assertionPassed('revokeInvite-idempotent-delete')
      }),
    )

    it(
      'acceptInvite success marks accepted and creates membership',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invite Accept', appId)
        const created = await workspaceStore.createInvite(ws.id, users.member.email, 'editor', users.owner.id)

        const accepted = await workspaceStore.acceptInvite(ws.id, created.invite.id, users.member.id)
        expect(accepted.member.userId).toBe(users.member.id)
        expect(accepted.member.role).toBe('editor')
        expect(accepted.invite.acceptedAt).not.toBeNull()
        expect(await workspaceStore.getMemberRole(ws.id, users.member.id)).toBe('editor')
        assertionPassed('acceptInvite-success-path')
      }),
    )

    it(
      'acceptInvite throws invite_not_found and invite_already_accepted',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invite Errors', appId)
        const created = await workspaceStore.createInvite(ws.id, users.member.email, 'viewer', users.owner.id)

        await expectHttpErrorCode(
          workspaceStore.acceptInvite(ws.id, randomUUID(), users.member.id),
          404,
          ERROR_CODES.INVITE_NOT_FOUND,
        )

        await workspaceStore.acceptInvite(ws.id, created.invite.id, users.member.id)
        await expectHttpErrorCode(
          workspaceStore.acceptInvite(ws.id, created.invite.id, users.member.id),
          409,
          ERROR_CODES.INVITE_ALREADY_ACCEPTED,
        )
        assertionPassed('acceptInvite-not-found-and-already-accepted')
      }),
    )

    it(
      'acceptInvite throws invite_email_mismatch and invite_expired',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Invite Error Cases', appId)

        const mismatch = await workspaceStore.createInvite(ws.id, users.other.email, 'viewer', users.owner.id)
        await expectHttpErrorCode(
          workspaceStore.acceptInvite(ws.id, mismatch.invite.id, users.member.id),
          403,
          ERROR_CODES.INVITE_EMAIL_MISMATCH,
        )

        const expired = await workspaceStore.createInvite(ws.id, users.member.email, 'viewer', users.owner.id)
        await options.expireInvite(ws.id, expired.invite.id)
        await expectHttpErrorCode(
          workspaceStore.acceptInvite(ws.id, expired.invite.id, users.member.id),
          410,
          ERROR_CODES.INVITE_EXPIRED,
        )
        assertionPassed('acceptInvite-email-mismatch-and-expired')
      }),
    )

    it(
      'getWorkspaceSettings is empty before writes',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Settings', appId)
        expect(await workspaceStore.getWorkspaceSettings(ws.id)).toEqual([])
        assertionPassed('workspace-settings-empty-by-default')
      }),
    )

    it(
      'putWorkspaceSettings returns metadata-only entries and getWorkspaceSettings reflects keys',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Settings Put', appId)

        const put = await workspaceStore.putWorkspaceSettings(ws.id, {
          github_token: 'secret',
          github_installation: '123',
        })
        const get = await workspaceStore.getWorkspaceSettings(ws.id)

        expect(put).toHaveLength(2)
        expect(put.every((row) => row.configured === true)).toBe(true)
        expect(put.every((row) => typeof row.updated_at === 'string')).toBe(true)
        expect(put.every((row) => !('value' in (row as Record<string, unknown>)))).toBe(true)
        expect(get.map((row) => row.key).sort()).toEqual(['github_installation', 'github_token'])
        assertionPassed('workspace-settings-metadata-only-contract')
      }),
    )

    it(
      'getWorkspaceRuntime auto-creates ready row when missing',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Runtime', appId)

        const created = await workspaceStore.getWorkspaceRuntime(ws.id)
        expect(created?.state).toBe('ready')

        await options.deleteRuntime(ws.id)
        const recreated = await workspaceStore.getWorkspaceRuntime(ws.id)
        expect(recreated?.state).toBe('ready')
        expect(recreated?.workspaceId).toBe(ws.id)
        expect(recreated?.spriteUrl).toBeNull()
        expect(recreated?.spriteName).toBeNull()
        expect(recreated?.lastError).toBeNull()
        expect(recreated?.provisioningStep).toBeNull()
        expect(recreated?.stepStartedAt).toBeNull()
        assertionPassed('workspace-runtime-auto-create-on-read')
      }),
    )

    it(
      'putWorkspaceRuntime updates runtime fields',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Runtime Put', appId)
        const stepStartedAt = new Date().toISOString()

        const updated = await workspaceStore.putWorkspaceRuntime(ws.id, {
          state: 'error',
          spriteUrl: 'https://cdn.example.com/sprite.png',
          spriteName: 'sprite-a',
          lastError: 'boot timeout',
          lastErrorOp: 'provision',
          volumePath: '/data/ws-123',
        })

        expect(updated.state).toBe('error')
        expect(updated.spriteUrl).toBe('https://cdn.example.com/sprite.png')
        expect(updated.spriteName).toBe('sprite-a')
        expect(updated.lastError).toBe('boot timeout')
        expect(updated.lastErrorOp).toBe('provision')
        expect(updated.volumePath).toBe('/data/ws-123')
        assertionPassed('putWorkspaceRuntime-updates-fields')
      }),
    )

    it(
      'retryWorkspaceRuntime transitions error to pending and no-ops otherwise',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'Runtime Retry', appId)

        expect(await workspaceStore.retryWorkspaceRuntime(ws.id)).toBeNull()
        await workspaceStore.putWorkspaceRuntime(ws.id, {
          state: 'error',
          lastError: 'boom',
        })

        const retried = await workspaceStore.retryWorkspaceRuntime(ws.id)
        expect(retried?.state).toBe('pending')
        expect(retried?.lastError).toBeNull()
        assertionPassed('retryWorkspaceRuntime-error-to-pending')
      }),
    )

    it(
      'getUiState returns null when no state exists',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'UI State', appId)
        expect(await workspaceStore.getUiState(users.owner.id, ws.id)).toBeNull()
        assertionPassed('ui-state-default-null')
      }),
    )

    it(
      'putUiState stores state scoped by (userId, workspaceId)',
      withBeadId(BEAD_ID, async ({ assertionPassed }) => {
        const { workspaceStore, appId, users } = await setup()
        const ws = await workspaceStore.create(users.owner.id, 'UI Put', appId)
        const state = { activePanel: 'chat', collapsed: true }

        await workspaceStore.putUiState(users.owner.id, ws.id, state)
        expect(await workspaceStore.getUiState(users.owner.id, ws.id)).toEqual(state)
        expect(await workspaceStore.getUiState(users.member.id, ws.id)).toBeNull()
        assertionPassed('ui-state-scoped-by-user-and-workspace')
      }),
    )
  })
}
