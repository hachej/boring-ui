import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, sql, desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import type { WorkspaceStore } from '../../app/types.js'
import type {
  MemberRole,
  User,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRuntime,
} from '../../../shared/types.js'
import { ERROR_CODES, HttpError } from '../../../shared/errors.js'
import {
  userSettings,
  users,
  workspaces,
  workspaceInvites,
  workspaceMembers,
  workspaceRuntimes,
  workspaceSettings,
} from '../schema.js'

type DbLike = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'execute'>

const UI_STATE_KEY_PREFIX = 'workspace_ui_state:'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  return value.toISOString()
}

function toWorkspaceRuntime(row: typeof workspaceRuntimes.$inferSelect): WorkspaceRuntime {
  return {
    workspaceId: row.workspaceId,
    spriteUrl: row.spriteUrl,
    spriteName: row.spriteName,
    state: row.state as WorkspaceRuntime['state'],
    lastError: row.lastError,
    provisioningStep: row.provisioningStep,
    stepStartedAt: toIso(row.stepStartedAt),
    updatedAt: toIso(row.updatedAt)!,
  }
}

function toWorkspaceInvite(row: typeof workspaceInvites.$inferSelect): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    tokenHash: row.tokenHash,
    role: row.role as MemberRole,
    expiresAt: toIso(row.expiresAt)!,
    acceptedAt: toIso(row.acceptedAt),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt)!,
  }
}

function toWorkspaceMember(row: typeof workspaceMembers.$inferSelect): WorkspaceMember {
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as MemberRole,
    createdAt: toIso(row.createdAt)!,
  }
}

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    isDefault: row.isDefault,
    machineId: row.machineId,
    volumeId: row.volumeId,
    flyRegion: row.flyRegion,
  }
}

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly workspaceSettingsKey: string = process.env.WORKSPACE_SETTINGS_ENCRYPTION_KEY ?? '',
  ) {}

  private uiStateKey(workspaceId: string): string {
    return `${UI_STATE_KEY_PREFIX}${workspaceId}`
  }

  private async getWorkspaceAppId(workspaceId: string): Promise<string | null> {
    const rows = await this.db
      .select({ appId: workspaces.appId })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1)

    return rows[0]?.appId ?? null
  }

  // ---------------------------------------------------------------------------
  // Workspace CRUD (Sub-PR 1)
  // ---------------------------------------------------------------------------

  async create(userId: string, name: string, appId: string): Promise<Workspace> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workspaces)
        .values({ appId, name, createdBy: userId })
        .returning()

      await tx.insert(workspaceMembers).values({
        workspaceId: row.id,
        userId,
        role: 'owner',
      })

      return toWorkspace(row)
    })
  }

  async list(userId: string, appId: string): Promise<Workspace[]> {
    const rows = await this.db
      .select({ ws: workspaces })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .where(and(eq(workspaces.appId, appId), isNull(workspaces.deletedAt)))
      .orderBy(desc(workspaces.isDefault), desc(workspaces.createdAt))

    return rows.map((r) => toWorkspace(r.ws))
  }

  async get(id: string): Promise<Workspace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1)
    return rows.length > 0 ? toWorkspace(rows[0]) : null
  }

  async update(
    id: string,
    updates: Partial<Pick<Workspace, 'name'>>,
  ): Promise<Workspace | null> {
    const rows = await this.db
      .update(workspaces)
      .set(updates)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning()
    return rows.length > 0 ? toWorkspace(rows[0]) : null
  }

  async delete(
    id: string,
  ): Promise<{
    removed: boolean
    code?:
      | typeof ERROR_CODES.WORKSPACE_PROVISIONING
      | typeof ERROR_CODES.NOT_FOUND
  }> {
    const ws = await this.get(id)
    if (!ws) return { removed: false, code: ERROR_CODES.NOT_FOUND }

    const [runtime] = await this.db
      .select()
      .from(workspaceRuntimes)
      .where(eq(workspaceRuntimes.workspaceId, id))
      .limit(1)
    if (runtime?.state === 'provisioning')
      return { removed: false, code: ERROR_CODES.WORKSPACE_PROVISIONING }

    await this.db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, id))

    return { removed: true }
  }

  // ---------------------------------------------------------------------------
  // Sole-owner query (Sub-PR 1)
  // ---------------------------------------------------------------------------

  async getWorkspacesWhereSoleOwner(userId: string): Promise<Workspace[]> {
    const rows = await this.db
      .select({ ws: workspaces })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, sql`'owner'`),
        ),
      )
      .where(
        and(
          isNull(workspaces.deletedAt),
          sql`(SELECT count(*) FROM workspace_members WHERE workspace_id = ${workspaces.id} AND role = 'owner') = 1`,
        ),
      )

    return rows.map((r) => toWorkspace(r.ws))
  }

  // ---------------------------------------------------------------------------
  // Member methods (Sub-PR 1)
  // ---------------------------------------------------------------------------

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ n: sql<number>`1` })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  async getMemberRole(
    workspaceId: string,
    userId: string,
  ): Promise<MemberRole | null> {
    const rows = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1)
    return rows.length > 0 ? (rows[0].role as MemberRole) : null
  }

  async listMembers(
    workspaceId: string,
  ): Promise<
    Array<
      WorkspaceMember & {
        user: Pick<User, 'id' | 'email' | 'name' | 'image'>
      }
    >
  > {
    const rows = await this.db
      .select({
        member: workspaceMembers,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          image: users.image,
        },
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))

    return rows.map((r) => ({
      ...toWorkspaceMember(r.member),
      user: {
        id: r.user.id,
        email: r.user.email,
        name: r.user.name,
        image: r.user.image,
      },
    }))
  }

  async upsertMember(
    workspaceId: string,
    userId: string,
    role: MemberRole,
  ): Promise<WorkspaceMember> {
    const [row] = await this.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role },
      })
      .returning()
    return toWorkspaceMember(row)
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<{
    removed: boolean
    code?:
      | typeof ERROR_CODES.LAST_OWNER
      | typeof ERROR_CODES.NOT_MEMBER
      | typeof ERROR_CODES.WORKSPACE_PROVISIONING
  }> {
    const role = await this.getMemberRole(workspaceId, userId)
    if (!role) return { removed: false, code: ERROR_CODES.NOT_MEMBER }

    const [runtime] = await this.db
      .select()
      .from(workspaceRuntimes)
      .where(eq(workspaceRuntimes.workspaceId, workspaceId))
      .limit(1)
    if (runtime?.state === 'provisioning')
      return { removed: false, code: ERROR_CODES.WORKSPACE_PROVISIONING }

    if (role === 'owner') {
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, sql`'owner'`),
          ),
        )
      if (Number(count) <= 1)
        return { removed: false, code: ERROR_CODES.LAST_OWNER }
    }

    await this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
    return { removed: true }
  }

  // ---------------------------------------------------------------------------
  // Invite methods (Sub-PR 2)
  // ---------------------------------------------------------------------------

  async createInvite(
    workspaceId: string,
    email: string,
    role: MemberRole,
    invitedBy: string | null,
  ): Promise<{ invite: WorkspaceInvite; rawToken: string }> {
    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    const rows = await this.db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: normalizeEmail(email),
        tokenHash,
        role,
        createdBy: invitedBy,
      })
      .returning()

    return {
      invite: toWorkspaceInvite(rows[0]),
      rawToken,
    }
  }

  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, workspaceId))
      .orderBy(workspaceInvites.createdAt)

    return rows.map(toWorkspaceInvite)
  }

  async getInvite(
    workspaceId: string,
    inviteId: string,
  ): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.id, inviteId),
        ),
      )
      .limit(1)

    return rows[0] ? toWorkspaceInvite(rows[0]) : null
  }

  async getInviteByTokenHash(tokenHash: string): Promise<WorkspaceInvite | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.tokenHash, tokenHash))
      .limit(1)

    return rows[0] ? toWorkspaceInvite(rows[0]) : null
  }

  async revokeInvite(workspaceId: string, inviteId: string): Promise<boolean> {
    const rows = await this.db
      .delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.id, inviteId),
        ),
      )
      .returning({ id: workspaceInvites.id })

    return rows.length > 0
  }

  async acceptInvite(
    workspaceId: string,
    inviteId: string,
    userId: string,
  ): Promise<{ invite: WorkspaceInvite; member: WorkspaceMember }> {
    return this.db.transaction(async (tx) => {
      const inviteRows = await tx
        .select()
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.workspaceId, workspaceId),
            eq(workspaceInvites.id, inviteId),
          ),
        )
        .limit(1)

      const invite = inviteRows[0]
      if (!invite) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.INVITE_NOT_FOUND,
          message: 'Invite not found',
        })
      }

      if (invite.acceptedAt) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.INVITE_ALREADY_ACCEPTED,
          message: 'Invite already accepted',
        })
      }

      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new HttpError({
          status: 410,
          code: ERROR_CODES.INVITE_EXPIRED,
          message: 'Invite expired',
        })
      }

      const userRows = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      const user = userRows[0]
      const userEmail = user ? normalizeEmail(user.email) : null
      if (!userEmail || userEmail !== normalizeEmail(invite.email)) {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.INVITE_EMAIL_MISMATCH,
          message: 'Invite email mismatch',
        })
      }

      const acceptedRows = await tx
        .update(workspaceInvites)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(workspaceInvites.workspaceId, workspaceId),
            eq(workspaceInvites.id, inviteId),
            isNull(workspaceInvites.acceptedAt),
          ),
        )
        .returning()

      if (acceptedRows.length === 0) {
        const refreshedRows = await tx
          .select()
          .from(workspaceInvites)
          .where(
            and(
              eq(workspaceInvites.workspaceId, workspaceId),
              eq(workspaceInvites.id, inviteId),
            ),
          )
          .limit(1)

        const refreshed = refreshedRows[0]
        if (!refreshed) {
          throw new HttpError({
            status: 404,
            code: ERROR_CODES.INVITE_NOT_FOUND,
            message: 'Invite not found',
          })
        }

        throw new HttpError({
          status: 409,
          code: ERROR_CODES.INVITE_ALREADY_ACCEPTED,
          message: 'Invite already accepted',
        })
      }

      const memberRows = await tx
        .insert(workspaceMembers)
        .values({
          workspaceId,
          userId,
          role: invite.role as MemberRole,
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: invite.role as MemberRole },
        })
        .returning()

      const acceptedInvite = acceptedRows[0]
      const member = memberRows[0]
      if (!acceptedInvite || !member) {
        throw new HttpError({
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Failed to accept invite',
        })
      }

      return {
        invite: toWorkspaceInvite(acceptedInvite),
        member: toWorkspaceMember(member),
      }
    })
  }

  async decryptSetting(
    workspaceId: string,
    key: string,
    db: DbLike = this.db,
  ): Promise<string | null> {
    try {
      const rows = await db
        .select({
          plaintext: sql<string>`pgp_sym_decrypt(${workspaceSettings.value}, ${this.workspaceSettingsKey})::text`,
        })
        .from(workspaceSettings)
        .where(
          and(
            eq(workspaceSettings.workspaceId, workspaceId),
            eq(workspaceSettings.key, key),
          ),
        )
        .limit(1)

      return rows[0]?.plaintext ?? null
    } catch {
      return null
    }
  }

  async encryptAndPut(
    workspaceId: string,
    key: string,
    value: string,
    db: DbLike = this.db,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
      VALUES (${workspaceId}::uuid, ${key}, pgp_sym_encrypt(${value}, ${this.workspaceSettingsKey}), NOW())
      ON CONFLICT (workspace_id, key)
      DO UPDATE SET value = pgp_sym_encrypt(${value}, ${this.workspaceSettingsKey}), updated_at = NOW()
    `)
  }

  async getWorkspaceSettings(
    workspaceId: string,
  ): Promise<Array<{ key: string; configured: boolean; updated_at: string }>> {
    const rows = await this.db
      .select({ key: workspaceSettings.key, updatedAt: workspaceSettings.updatedAt })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .orderBy(workspaceSettings.key)

    const metadata: Array<{ key: string; configured: boolean; updated_at: string }> = []

    for (const row of rows) {
      const decrypted = await this.decryptSetting(workspaceId, row.key)
      metadata.push({
        key: row.key,
        configured: decrypted !== null,
        updated_at: row.updatedAt.toISOString(),
      })
    }

    return metadata
  }

  async putWorkspaceSettings(
    workspaceId: string,
    settings: Record<string, string>,
  ): Promise<Array<{ key: string; configured: boolean; updated_at: string }>> {
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(settings)) {
        await this.encryptAndPut(workspaceId, key, value, tx)
      }
    })

    return this.getWorkspaceSettings(workspaceId)
  }

  async getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null> {
    const appId = await this.getWorkspaceAppId(workspaceId)
    if (!appId) return null

    const existingRows = await this.db
      .select()
      .from(workspaceRuntimes)
      .where(eq(workspaceRuntimes.workspaceId, workspaceId))
      .limit(1)

    if (existingRows.length > 0) {
      return toWorkspaceRuntime(existingRows[0])
    }

    await this.db
      .insert(workspaceRuntimes)
      .values({
        workspaceId,
        spriteUrl: null,
        spriteName: null,
        state: 'ready',
        lastError: null,
        provisioningStep: null,
        stepStartedAt: null,
        updatedAt: new Date(),
      })
      .onConflictDoNothing()

    const createdRows = await this.db
      .select()
      .from(workspaceRuntimes)
      .where(eq(workspaceRuntimes.workspaceId, workspaceId))
      .limit(1)

    if (createdRows.length === 0) return null
    return toWorkspaceRuntime(createdRows[0])
  }

  async putWorkspaceRuntime(
    workspaceId: string,
    state: Partial<WorkspaceRuntime>,
  ): Promise<WorkspaceRuntime> {
    const existing = await this.getWorkspaceRuntime(workspaceId)
    if (!existing) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    const merged: WorkspaceRuntime = {
      ...existing,
      ...state,
      workspaceId,
      updatedAt: new Date().toISOString(),
    }

    const rows = await this.db
      .insert(workspaceRuntimes)
      .values({
        workspaceId,
        spriteUrl: merged.spriteUrl,
        spriteName: merged.spriteName,
        state: merged.state,
        lastError: merged.lastError,
        provisioningStep: merged.provisioningStep,
        stepStartedAt: merged.stepStartedAt ? new Date(merged.stepStartedAt) : null,
        updatedAt: new Date(merged.updatedAt),
      })
      .onConflictDoUpdate({
        target: workspaceRuntimes.workspaceId,
        set: {
          spriteUrl: merged.spriteUrl,
          spriteName: merged.spriteName,
          state: merged.state,
          lastError: merged.lastError,
          provisioningStep: merged.provisioningStep,
          stepStartedAt: merged.stepStartedAt ? new Date(merged.stepStartedAt) : null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return toWorkspaceRuntime(rows[0])
  }

  async retryWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null> {
    const rows = await this.db
      .update(workspaceRuntimes)
      .set({
        state: 'pending',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceRuntimes.workspaceId, workspaceId),
          eq(workspaceRuntimes.state, 'error'),
        ),
      )
      .returning()

    if (rows.length === 0) return null
    return toWorkspaceRuntime(rows[0])
  }

  async getUiState(
    userId: string,
    workspaceId: string,
  ): Promise<Record<string, unknown> | null> {
    const appId = await this.getWorkspaceAppId(workspaceId)
    if (!appId) return null

    const rows = await this.db
      .select({ settings: userSettings.settings })
      .from(userSettings)
      .where(
        and(eq(userSettings.userId, userId), eq(userSettings.appId, appId)),
      )
      .limit(1)

    const key = this.uiStateKey(workspaceId)
    const payload = (rows[0]?.settings as Record<string, unknown> | undefined)?.[key]

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null
    }

    return payload as Record<string, unknown>
  }

  async putUiState(
    userId: string,
    workspaceId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    const appId = await this.getWorkspaceAppId(workspaceId)
    if (!appId) return

    const patch = JSON.stringify({ [this.uiStateKey(workspaceId)]: state })

    await this.db.execute(sql`
      INSERT INTO user_settings (user_id, app_id, display_name, email, settings, updated_at)
      VALUES (${userId}::uuid, ${appId}, '', '', ${patch}::jsonb, NOW())
      ON CONFLICT (user_id, app_id)
      DO UPDATE SET
        settings = COALESCE(user_settings.settings, '{}'::jsonb) || ${patch}::jsonb,
        updated_at = NOW()
    `)
  }
}
