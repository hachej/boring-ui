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
  WorkspaceRuntimeResource,
  WorkspaceRuntimeResourceInput,
  WorkspaceRuntimeResourceSelector,
} from '../../../shared/types.js'
import { ERROR_CODES, HttpError } from '../../../shared/errors.js'
import {
  userSettings,
  users,
  workspaces,
  workspaceInvites,
  workspaceMembers,
  workspaceRuntimeResources,
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

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toWorkspaceRuntime(row: typeof workspaceRuntimes.$inferSelect): WorkspaceRuntime {
  return {
    workspaceId: row.workspaceId,
    spriteUrl: row.spriteUrl,
    spriteName: row.spriteName,
    state: row.state as WorkspaceRuntime['state'],
    lastError: row.lastError,
    volumePath: row.volumePath,
    lastErrorOp: row.lastErrorOp,
    sandboxProvider: row.sandboxProvider,
    sandboxId: row.sandboxId,
    sandboxStatus: row.sandboxStatus,
    sandboxSnapshotId: row.sandboxSnapshotId,
    sandboxCreatedAt: toIso(row.sandboxCreatedAt),
    sandboxLastUsedAt: toIso(row.sandboxLastUsedAt),
    sandboxLastSeenAt: toIso(row.sandboxLastSeenAt),
    sandboxExpiresAt: toIso(row.sandboxExpiresAt),
    provisioningStep: row.provisioningStep,
    stepStartedAt: toIso(row.stepStartedAt),
    updatedAt: toIso(row.updatedAt)!,
  }
}

function toWorkspaceRuntimeResource(
  row: typeof workspaceRuntimeResources.$inferSelect,
): WorkspaceRuntimeResource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    purpose: row.purpose,
    provider: row.provider,
    handleKind: row.handleKind,
    stableKey: row.stableKey,
    providerResourceId: row.providerResourceId,
    parentResourceId: row.parentResourceId,
    state: row.state,
    persistenceMode: row.persistenceMode,
    config: asRecord(row.config),
    providerMeta: asRecord(row.providerMeta),
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
    lastSeenAt: toIso(row.lastSeenAt),
    lastUsedAt: toIso(row.lastUsedAt),
    expiresAt: toIso(row.expiresAt),
    generation: row.generation,
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
    failedAttempts: row.failedAttempts,
    lockedUntil: toIso(row.lockedUntil),
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

  async create(userId: string, name: string, appId: string, opts?: { isDefault?: boolean }): Promise<Workspace> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workspaces)
        .values({ appId, name, createdBy: userId, isDefault: opts?.isDefault ?? false })
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
    code?: typeof ERROR_CODES.NOT_FOUND
  }> {
    const ws = await this.get(id)
    if (!ws) return { removed: false, code: ERROR_CODES.NOT_FOUND }

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

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: MemberRole,
  ): Promise<{
    member?: WorkspaceMember
    code?:
      | typeof ERROR_CODES.LAST_OWNER
      | typeof ERROR_CODES.NOT_MEMBER
  }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT user_id
        FROM workspace_members
        WHERE workspace_id = ${workspaceId}
        FOR UPDATE
      `)

      const memberRows = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1)
      const currentRole = memberRows[0]?.role as MemberRole | undefined
      if (!currentRole) return { code: ERROR_CODES.NOT_MEMBER }

      if (currentRole === 'owner' && role !== 'owner') {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.role, sql`'owner'`),
            ),
          )
        if (Number(count) <= 1) {
          return { code: ERROR_CODES.LAST_OWNER }
        }
      }

      const [updated] = await tx
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .returning()
      return { member: toWorkspaceMember(updated) }
    })
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<{
    removed: boolean
    code?:
      | typeof ERROR_CODES.LAST_OWNER
      | typeof ERROR_CODES.NOT_MEMBER
  }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT user_id
        FROM workspace_members
        WHERE workspace_id = ${workspaceId}
          AND role = 'owner'
        FOR UPDATE
      `)

      const memberRows = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1)
      const role = memberRows[0]?.role as MemberRole | undefined
      if (!role) return { removed: false, code: ERROR_CODES.NOT_MEMBER }

      if (role === 'owner') {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.role, sql`'owner'`),
            ),
          )
        if (Number(count) <= 1) {
          return { removed: false, code: ERROR_CODES.LAST_OWNER }
        }
      }

      const deletedRows = await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .returning({ userId: workspaceMembers.userId })
      if (deletedRows.length === 0) {
        return { removed: false, code: ERROR_CODES.NOT_MEMBER }
      }

      return { removed: true }
    })
  }

  // ---------------------------------------------------------------------------
  // Invite methods (Sub-PR 2)
  // ---------------------------------------------------------------------------

  async createInvite(
    workspaceId: string,
    email: string,
    role: MemberRole,
    invitedBy: string | null,
    opts?: { ttlDays?: number },
  ): Promise<{ invite: WorkspaceInvite; rawToken: string }> {
    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    const ttlDays = opts?.ttlDays ?? 7
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

    const rows = await this.db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: normalizeEmail(email),
        tokenHash,
        role,
        expiresAt,
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

  async incrementInviteFailedAttempts(inviteId: string): Promise<{ failedAttempts: number; lockedUntil: string | null }> {
    const rows = await this.db
      .update(workspaceInvites)
      .set({
        failedAttempts: sql`${workspaceInvites.failedAttempts} + 1`,
        lockedUntil: sql`CASE WHEN ${workspaceInvites.failedAttempts} + 1 >= 50 THEN now() + interval '1 hour' ELSE ${workspaceInvites.lockedUntil} END`,
      })
      .where(eq(workspaceInvites.id, inviteId))
      .returning({
        failedAttempts: workspaceInvites.failedAttempts,
        lockedUntil: workspaceInvites.lockedUntil,
      })

    if (rows.length === 0) return { failedAttempts: 0, lockedUntil: null }
    return {
      failedAttempts: rows[0].failedAttempts,
      lockedUntil: toIso(rows[0].lockedUntil),
    }
  }

  async resetInviteFailedAttempts(inviteId: string): Promise<void> {
    await this.db
      .update(workspaceInvites)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(workspaceInvites.id, inviteId))
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
    } catch (err) {
      const code = err instanceof Error ? err.constructor.name : 'unknown'
      console.error(`[workspace-store] decryptSetting failed for key="${key}" workspace="${workspaceId}": ${code}`)
      return null
    }
  }

  async encryptAndPut(
    workspaceId: string,
    key: string,
    value: string,
    db: DbLike = this.db,
  ): Promise<void> {
    if (!this.workspaceSettingsKey) {
      throw new Error('WORKSPACE_SETTINGS_ENCRYPTION_KEY is not configured — cannot store encrypted settings')
    }
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
        sandboxProvider: null,
        sandboxId: null,
        sandboxStatus: null,
        sandboxSnapshotId: null,
        sandboxCreatedAt: null,
        sandboxLastUsedAt: null,
        sandboxLastSeenAt: null,
        sandboxExpiresAt: null,
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
        volumePath: merged.volumePath,
        lastErrorOp: merged.lastErrorOp,
        sandboxProvider: merged.sandboxProvider ?? null,
        sandboxId: merged.sandboxId ?? null,
        sandboxStatus: merged.sandboxStatus ?? null,
        sandboxSnapshotId: merged.sandboxSnapshotId ?? null,
        sandboxCreatedAt: merged.sandboxCreatedAt ? new Date(merged.sandboxCreatedAt) : null,
        sandboxLastUsedAt: merged.sandboxLastUsedAt ? new Date(merged.sandboxLastUsedAt) : null,
        sandboxLastSeenAt: merged.sandboxLastSeenAt ? new Date(merged.sandboxLastSeenAt) : null,
        sandboxExpiresAt: merged.sandboxExpiresAt ? new Date(merged.sandboxExpiresAt) : null,
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
          volumePath: merged.volumePath,
          lastErrorOp: merged.lastErrorOp,
          sandboxProvider: merged.sandboxProvider ?? null,
          sandboxId: merged.sandboxId ?? null,
          sandboxStatus: merged.sandboxStatus ?? null,
          sandboxSnapshotId: merged.sandboxSnapshotId ?? null,
          sandboxCreatedAt: merged.sandboxCreatedAt ? new Date(merged.sandboxCreatedAt) : null,
          sandboxLastUsedAt: merged.sandboxLastUsedAt ? new Date(merged.sandboxLastUsedAt) : null,
          sandboxLastSeenAt: merged.sandboxLastSeenAt ? new Date(merged.sandboxLastSeenAt) : null,
          sandboxExpiresAt: merged.sandboxExpiresAt ? new Date(merged.sandboxExpiresAt) : null,
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

  async listWorkspaceRuntimes(): Promise<WorkspaceRuntime[]> {
    const rows = await this.db.select().from(workspaceRuntimes)
    return rows.map((row) => toWorkspaceRuntime(row))
  }

  async getWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<WorkspaceRuntimeResource | null> {
    const rows = await this.db
      .select()
      .from(workspaceRuntimeResources)
      .where(
        and(
          eq(workspaceRuntimeResources.workspaceId, workspaceId),
          eq(workspaceRuntimeResources.kind, selector.kind),
          eq(workspaceRuntimeResources.purpose, selector.purpose),
          eq(workspaceRuntimeResources.provider, selector.provider),
          sql`${workspaceRuntimeResources.state} <> 'deleted'`,
        ),
      )
      .limit(1)

    return rows[0] ? toWorkspaceRuntimeResource(rows[0]) : null
  }

  async putWorkspaceRuntimeResource(
    workspaceId: string,
    resource: WorkspaceRuntimeResourceInput,
  ): Promise<WorkspaceRuntimeResource> {
    const workspace = await this.get(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const now = new Date()
    const existing = await this.getWorkspaceRuntimeResource(workspaceId, resource)
    const values = {
      workspaceId,
      kind: resource.kind,
      purpose: resource.purpose,
      provider: resource.provider,
      handleKind: resource.handleKind,
      stableKey: resource.stableKey ?? null,
      providerResourceId: resource.providerResourceId ?? null,
      parentResourceId: resource.parentResourceId ?? null,
      state: resource.state,
      persistenceMode: resource.persistenceMode,
      config: resource.config ?? {},
      providerMeta: resource.providerMeta ?? {},
      lastError: resource.lastError ?? null,
      lastErrorCode: resource.lastErrorCode ?? null,
      updatedAt: now,
      lastSeenAt: toDate(resource.lastSeenAt),
      lastUsedAt: toDate(resource.lastUsedAt),
      expiresAt: toDate(resource.expiresAt),
      generation: resource.generation ?? ((existing?.generation ?? -1) + 1),
    }

    if (existing) {
      const rows = await this.db
        .update(workspaceRuntimeResources)
        .set(values)
        .where(eq(workspaceRuntimeResources.id, existing.id))
        .returning()
      return toWorkspaceRuntimeResource(rows[0])
    }

    const rows = await this.db
      .insert(workspaceRuntimeResources)
      .values({
        id: resource.id,
        ...values,
        createdAt: now,
      })
      .returning()
    return toWorkspaceRuntimeResource(rows[0])
  }

  async deleteWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<void> {
    const existing = await this.getWorkspaceRuntimeResource(workspaceId, selector)
    if (!existing) return

    await this.db
      .update(workspaceRuntimeResources)
      .set({
        state: 'deleted',
        updatedAt: new Date(),
      })
      .where(eq(workspaceRuntimeResources.id, existing.id))
  }

  async listWorkspaceRuntimeResources(
    workspaceId?: string,
  ): Promise<WorkspaceRuntimeResource[]> {
    const base = this.db.select().from(workspaceRuntimeResources)
    const rows = workspaceId
      ? await base.where(eq(workspaceRuntimeResources.workspaceId, workspaceId))
      : await base
    return rows.map((row) => toWorkspaceRuntimeResource(row))
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
      VALUES (
        ${userId}::uuid,
        ${appId},
        COALESCE(
          (SELECT us.display_name FROM user_settings us WHERE us.user_id = ${userId}::uuid AND us.app_id = ${appId}),
          (SELECT COALESCE(u.name, '') FROM users u WHERE u.id = ${userId}::uuid),
          ''
        ),
        COALESCE(
          (SELECT us.email FROM user_settings us WHERE us.user_id = ${userId}::uuid AND us.app_id = ${appId}),
          (SELECT u.email FROM users u WHERE u.id = ${userId}::uuid),
          ''
        ),
        COALESCE(
          (SELECT us.settings FROM user_settings us WHERE us.user_id = ${userId}::uuid AND us.app_id = ${appId}),
          '{}'::jsonb
        ) || ${patch}::jsonb,
        NOW()
      )
      ON CONFLICT (user_id, app_id)
      DO UPDATE SET
        settings = COALESCE(user_settings.settings, '{}'::jsonb) || ${patch}::jsonb,
        updated_at = NOW()
    `)
  }
}
