import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, isNull, sql as drizzleSql } from 'drizzle-orm'
import type { ServerConfig } from '../config.js'
import { createDbClient } from '../db/index.js'
import {
  workspaceInvites,
  userSettings,
  workspaceMembers,
  workspaceRuntimes,
  workspaces,
  workspaceSettings,
} from '../db/schema.js'
import {
  acceptWorkspaceInvite as localAcceptWorkspaceInvite,
  createWorkspace as localCreateWorkspace,
  createWorkspaceInvite as localCreateWorkspaceInvite,
  deleteWorkspace as localDeleteWorkspace,
  getMemberRole as localGetMemberRole,
  getUserSettings as localGetUserSettings,
  getWorkspace as localGetWorkspace,
  getWorkspaceInvite as localGetWorkspaceInvite,
  getWorkspaceSettings as localGetWorkspaceSettings,
  listWorkspaceInvites as localListWorkspaceInvites,
  listWorkspaceMembers as localListWorkspaceMembers,
  listWorkspaces as localListWorkspaces,
  putUserSettings as localPutUserSettings,
  putWorkspaceSettings as localPutWorkspaceSettings,
  removeWorkspaceMember as localRemoveWorkspaceMember,
  revokeWorkspaceInvite as localRevokeWorkspaceInvite,
  type LocalUserSettings,
  type LocalWorkspaceInvite,
  type LocalWorkspaceMember,
  type LocalWorkspace,
  type LocalMemberRole,
  upsertWorkspaceMember as localUpsertWorkspaceMember,
  updateWorkspace as localUpdateWorkspace,
} from './localWorkspaceStore.js'

export interface WorkspaceRuntimeRecord {
  workspace_id: string
  state: 'pending' | 'provisioning' | 'ready' | 'error'
  status: 'pending' | 'provisioning' | 'ready' | 'error'
  sprite_url: string | null
  sprite_name: string | null
  last_error: string | null
  updated_at: string | null
  provisioning_step?: string
  step_started_at?: string
  retryable: boolean
}

export interface GitHubConnectionRecord {
  installation_id: number | null
  repo_url: string | null
}

export interface GitHubUserLinkRecord {
  account_linked: boolean
  default_installation_id: number | null
}

export class SettingsKeyRequiredError extends Error {
  code = 'SETTINGS_KEY_NOT_CONFIGURED' as const
  constructor() {
    super('Settings encryption key not configured')
    this.name = 'SettingsKeyRequiredError'
  }
}

export class RuntimeNotFoundError extends Error {
  code = 'RUNTIME_NOT_FOUND' as const
  constructor() {
    super('Runtime not found for this workspace')
    this.name = 'RuntimeNotFoundError'
  }
}

export class RuntimeInvalidTransitionError extends Error {
  code = 'INVALID_TRANSITION' as const
  constructor() {
    super('Retry is only available from error/provisioning states')
    this.name = 'RuntimeInvalidTransitionError'
  }
}

export interface WorkspacePersistence {
  listWorkspaces(userId: string): Promise<LocalWorkspace[]>
  createWorkspace(userId: string, name: string): Promise<LocalWorkspace>
  getWorkspace(id: string): Promise<LocalWorkspace | undefined>
  updateWorkspace(id: string, updates: Partial<Pick<LocalWorkspace, 'name'>>): Promise<LocalWorkspace | undefined>
  deleteWorkspace(id: string): Promise<boolean>
  getWorkspaceRuntime(id: string): Promise<WorkspaceRuntimeRecord>
  retryWorkspaceRuntime(id: string): Promise<WorkspaceRuntimeRecord>
  getWorkspaceSettings(id: string): Promise<Record<string, unknown>>
  putWorkspaceSettings(id: string, settings: Record<string, string>): Promise<Record<string, unknown>>
  getMemberRole(workspaceId: string, userId: string): Promise<LocalMemberRole | null>
  listWorkspaceMembers(workspaceId: string): Promise<LocalWorkspaceMember[]>
  upsertWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: LocalMemberRole,
  ): Promise<LocalWorkspaceMember>
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<{ removed: boolean; code?: 'LAST_OWNER' }>
  listWorkspaceInvites(workspaceId: string): Promise<LocalWorkspaceInvite[]>
  createWorkspaceInvite(
    workspaceId: string,
    email: string,
    role: LocalMemberRole,
    invitedBy: string | null,
  ): Promise<LocalWorkspaceInvite>
  getWorkspaceInvite(workspaceId: string, inviteId: string): Promise<LocalWorkspaceInvite | undefined>
  revokeWorkspaceInvite(workspaceId: string, inviteId: string): Promise<boolean>
  acceptWorkspaceInvite(
    workspaceId: string,
    inviteId: string,
    userId: string,
  ): Promise<{ invite?: LocalWorkspaceInvite; member?: LocalWorkspaceMember }>
  getWorkspaceGitHubConnection(workspaceId: string): Promise<GitHubConnectionRecord | null>
  setWorkspaceGitHubConnection(
    workspaceId: string,
    updates: { installation_id?: number | null; repo_url?: string | null },
  ): Promise<GitHubConnectionRecord | null>
  clearWorkspaceGitHubConnection(workspaceId: string): Promise<void>
  getUserGitHubLink(userId: string, email?: string | null): Promise<GitHubUserLinkRecord>
  setUserGitHubLink(
    userId: string,
    email: string | null | undefined,
    installationId: number | null,
  ): Promise<GitHubUserLinkRecord>
  getUserSettings(userId: string, email?: string | null): Promise<LocalUserSettings>
  putUserSettings(
    userId: string,
    email: string | null | undefined,
    updates: Partial<LocalUserSettings>,
  ): Promise<LocalUserSettings>
}

type HostedClient = NonNullable<ReturnType<typeof createDbClient>>

const hostedClientCache = new Map<string, HostedClient>()

function mapWorkspaceRow(row: {
  id: string
  appId: string
  name: string
  createdBy: string
  createdAt: string
  isDefault: boolean
  machineId: string | null
  volumeId: string | null
  flyRegion: string | null
}): LocalWorkspace {
  return {
    id: row.id,
    app_id: row.appId,
    name: row.name,
    created_by: row.createdBy,
    created_at: row.createdAt,
    is_default: row.isDefault,
    machine_id: row.machineId,
    volume_id: row.volumeId,
    fly_region: row.flyRegion,
  }
}

function mapRuntimeRow(row: Record<string, unknown>): WorkspaceRuntimeRecord {
  const state = String(row.state || 'pending') as WorkspaceRuntimeRecord['state']
  const updatedAt = typeof row.updated_at === 'string'
    ? row.updated_at
    : row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : null
  const stepStartedAt = typeof row.step_started_at === 'string'
    ? row.step_started_at
    : row.step_started_at instanceof Date
      ? row.step_started_at.toISOString()
      : undefined

  return {
    workspace_id: String(row.workspace_id || ''),
    state,
    status: state,
    sprite_url: row.sprite_url ? String(row.sprite_url) : null,
    sprite_name: row.sprite_name ? String(row.sprite_name) : null,
    last_error: row.last_error ? String(row.last_error) : null,
    updated_at: updatedAt,
    provisioning_step: row.provisioning_step ? String(row.provisioning_step) : undefined,
    step_started_at: stepStartedAt,
    retryable: state === 'error' || state === 'provisioning',
  }
}

function requireHostedClient(config: ServerConfig): HostedClient {
  const cacheKey = config.databaseUrl || ''
  const cached = hostedClientCache.get(cacheKey)
  if (cached) return cached

  const client = createDbClient(config)
  if (!client) {
    throw new Error('DATABASE_URL is required for hosted persistence')
  }
  hostedClientCache.set(cacheKey, client)
  return client
}

function settingsKey(config: ServerConfig): string {
  const key = String(config.settingsKey || '').trim()
  if (!key) throw new SettingsKeyRequiredError()
  return key
}

function normalizeUserSettingsRow(
  row: { displayName: string; email: string; settings: unknown } | undefined,
): LocalUserSettings {
  const settings = row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
    ? { ...(row.settings as Record<string, unknown>) }
    : {}
  return {
    display_name: row?.displayName || '',
    email: row?.email || '',
    settings,
  }
}

function normalizeGitHubUserLink(settings: Record<string, unknown>): GitHubUserLinkRecord {
  const rawInstallationId = settings.github_default_installation_id
  let defaultInstallationId: number | null = null
  if (rawInstallationId !== null && rawInstallationId !== undefined && rawInstallationId !== '') {
    const parsed = Number(rawInstallationId)
    defaultInstallationId = Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return {
    account_linked: Boolean(settings.github_account_linked),
    default_installation_id: defaultInstallationId,
  }
}

function normalizeGitHubConnection(settings: Record<string, unknown>): GitHubConnectionRecord | null {
  const rawInstallationId = settings.github_installation_id
  const rawRepoUrl = settings.github_repo_url
  const parsedInstallationId = rawInstallationId === null || rawInstallationId === undefined || rawInstallationId === ''
    ? null
    : Number(rawInstallationId)

  const installationId = typeof parsedInstallationId === 'number'
    && Number.isInteger(parsedInstallationId)
    && parsedInstallationId > 0
    ? parsedInstallationId
    : null
  const repoUrl = typeof rawRepoUrl === 'string' && rawRepoUrl.trim() ? rawRepoUrl.trim() : null

  if (installationId === null && repoUrl === null) {
    return null
  }

  return {
    installation_id: installationId,
    repo_url: repoUrl,
  }
}

function normalizeInviteRow(row: {
  id: string
  workspaceId: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}): LocalWorkspaceInvite {
  return {
    id: row.id,
    invite_id: row.id,
    workspace_id: row.workspaceId,
    email: row.email,
    role: row.role as LocalMemberRole,
    invited_by: null,
    expires_at: row.expiresAt,
    accepted_at: row.acceptedAt,
    created_at: row.createdAt,
  }
}

function normalizeMemberRow(row: {
  workspaceId: string
  userId: string
  role: string
  createdAt: string
}): LocalWorkspaceMember {
  return {
    workspace_id: row.workspaceId,
    user_id: row.userId,
    role: row.role as LocalMemberRole,
    created_at: row.createdAt,
  }
}

function localReadyRuntime(id: string) {
  return {
    workspace_id: id,
    state: 'ready' as const,
    status: 'ready' as const,
    sprite_url: null,
    sprite_name: null,
    last_error: null,
    updated_at: new Date().toISOString(),
    retryable: false,
  }
}

function createLocalPersistence(config: ServerConfig): WorkspacePersistence {
  return {
    async listWorkspaces(userId) {
      return localListWorkspaces(userId)
    },
    async createWorkspace(userId, name) {
      return localCreateWorkspace(userId, name, config.controlPlaneAppId)
    },
    async getWorkspace(id) {
      return localGetWorkspace(id)
    },
    async updateWorkspace(id, updates) {
      return localUpdateWorkspace(id, updates)
    },
    async deleteWorkspace(id) {
      return localDeleteWorkspace(id)
    },
    async getWorkspaceRuntime(id) {
      return localReadyRuntime(id)
    },
    async retryWorkspaceRuntime(id) {
      return localReadyRuntime(id)
    },
    async getWorkspaceSettings(id) {
      return localGetWorkspaceSettings(id)
    },
    async putWorkspaceSettings(id, settings) {
      return localPutWorkspaceSettings(id, settings)
    },
    async getMemberRole(workspaceId, userId) {
      return localGetMemberRole(workspaceId, userId)
    },
    async listWorkspaceMembers(workspaceId) {
      return localListWorkspaceMembers(workspaceId)
    },
    async upsertWorkspaceMember(workspaceId, userId, role) {
      return localUpsertWorkspaceMember(workspaceId, userId, role)
    },
    async removeWorkspaceMember(workspaceId, userId) {
      return localRemoveWorkspaceMember(workspaceId, userId)
    },
    async listWorkspaceInvites(workspaceId) {
      return localListWorkspaceInvites(workspaceId)
    },
    async createWorkspaceInvite(workspaceId, email, role, invitedBy) {
      return localCreateWorkspaceInvite(workspaceId, email, role, invitedBy)
    },
    async getWorkspaceInvite(workspaceId, inviteId) {
      return localGetWorkspaceInvite(workspaceId, inviteId)
    },
    async revokeWorkspaceInvite(workspaceId, inviteId) {
      return localRevokeWorkspaceInvite(workspaceId, inviteId)
    },
    async acceptWorkspaceInvite(workspaceId, inviteId, userId) {
      return localAcceptWorkspaceInvite(workspaceId, inviteId, userId)
    },
    async getWorkspaceGitHubConnection(workspaceId) {
      return normalizeGitHubConnection(localGetWorkspaceSettings(workspaceId))
    },
    async setWorkspaceGitHubConnection(workspaceId, updates) {
      const patch: Record<string, string> = {}
      if (updates.installation_id !== undefined) {
        if (updates.installation_id === null) {
          patch.github_installation_id = ''
        } else {
          patch.github_installation_id = String(updates.installation_id)
        }
      }
      if (updates.repo_url !== undefined) {
        patch.github_repo_url = updates.repo_url ?? ''
      }
      const merged = localPutWorkspaceSettings(workspaceId, patch)
      return normalizeGitHubConnection(merged)
    },
    async clearWorkspaceGitHubConnection(workspaceId) {
      localPutWorkspaceSettings(workspaceId, {
        github_installation_id: '',
        github_repo_url: '',
      })
    },
    async getUserGitHubLink(userId, email) {
      const settings = (await this.getUserSettings(userId, email)).settings
      return normalizeGitHubUserLink(settings)
    },
    async setUserGitHubLink(userId, email, installationId) {
      const updated = await this.putUserSettings(userId, email, {
        settings: {
          github_account_linked: installationId !== null,
          github_default_installation_id: installationId,
        },
      })
      return normalizeGitHubUserLink(updated.settings)
    },
    async getUserSettings(userId) {
      return localGetUserSettings(userId, config.controlPlaneAppId)
    },
    async putUserSettings(userId, email, updates) {
      return localPutUserSettings(userId, config.controlPlaneAppId, {
        ...(email ? { email } : {}),
        ...updates,
      })
    },
  }
}

function createHostedPersistence(config: ServerConfig): WorkspacePersistence {
  const client = requireHostedClient(config)
  const { db, sql } = client
  const appId = config.controlPlaneAppId

  return {
    async listWorkspaces(userId) {
      const rows = await db
        .select({
          id: workspaces.id,
          appId: workspaces.appId,
          name: workspaces.name,
          createdBy: workspaces.createdBy,
          createdAt: workspaces.createdAt,
          isDefault: workspaces.isDefault,
          machineId: workspaces.machineId,
          volumeId: workspaces.volumeId,
          flyRegion: workspaces.flyRegion,
        })
        .from(workspaces)
        .innerJoin(workspaceMembers, and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, userId),
        ))
        .where(and(
          eq(workspaces.appId, appId),
          isNull(workspaces.deletedAt),
        ))
        .orderBy(asc(workspaces.createdAt))

      return rows.map(mapWorkspaceRow)
    },

    async createWorkspace(userId, name) {
      const created = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(
            eq(workspaces.createdBy, userId),
            eq(workspaces.appId, appId),
            isNull(workspaces.deletedAt),
          ))
          .limit(1)

        const [workspace] = await tx
          .insert(workspaces)
          .values({
            appId,
            name,
            createdBy: userId,
            isDefault: existing.length === 0,
          })
          .returning({
            id: workspaces.id,
            appId: workspaces.appId,
            name: workspaces.name,
            createdBy: workspaces.createdBy,
            createdAt: workspaces.createdAt,
            isDefault: workspaces.isDefault,
            machineId: workspaces.machineId,
            volumeId: workspaces.volumeId,
            flyRegion: workspaces.flyRegion,
          })

        await tx
          .insert(workspaceMembers)
          .values({
            workspaceId: workspace.id,
            userId,
            role: 'owner',
          })
          .onConflictDoNothing()

        // The TS backend never provisions Fly Machines — that only happens
        // in the Python control plane. Mark workspace ready immediately so
        // the setup page auto-advances instead of polling forever.
        await tx
          .insert(workspaceRuntimes)
          .values({
            workspaceId: workspace.id,
            state: 'ready',
          })
          .onConflictDoNothing()

        return workspace
      })

      await mkdir(join(config.workspaceRoot, created.id), { recursive: true })
      return mapWorkspaceRow(created)
    },

    async getWorkspace(id) {
      const [row] = await db
        .select({
          id: workspaces.id,
          appId: workspaces.appId,
          name: workspaces.name,
          createdBy: workspaces.createdBy,
          createdAt: workspaces.createdAt,
          isDefault: workspaces.isDefault,
          machineId: workspaces.machineId,
          volumeId: workspaces.volumeId,
          flyRegion: workspaces.flyRegion,
        })
        .from(workspaces)
        .where(and(
          eq(workspaces.id, id),
          eq(workspaces.appId, appId),
          isNull(workspaces.deletedAt),
        ))
        .limit(1)

      return row ? mapWorkspaceRow(row) : undefined
    },

    async updateWorkspace(id, updates) {
      const name = String(updates.name || '').trim()
      const [row] = await db
        .update(workspaces)
        .set({ name })
        .where(and(
          eq(workspaces.id, id),
          eq(workspaces.appId, appId),
          isNull(workspaces.deletedAt),
        ))
        .returning({
          id: workspaces.id,
          appId: workspaces.appId,
          name: workspaces.name,
          createdBy: workspaces.createdBy,
          createdAt: workspaces.createdAt,
          isDefault: workspaces.isDefault,
          machineId: workspaces.machineId,
          volumeId: workspaces.volumeId,
          flyRegion: workspaces.flyRegion,
        })

      return row ? mapWorkspaceRow(row) : undefined
    },

    async deleteWorkspace(id) {
      const rows = await db
        .update(workspaces)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(
          eq(workspaces.id, id),
          eq(workspaces.appId, appId),
          isNull(workspaces.deletedAt),
        ))
        .returning({ id: workspaces.id })

      return rows.length > 0
    },

    async getWorkspaceRuntime(id) {
      let [row] = await db
        .select({
          workspace_id: workspaceRuntimes.workspaceId,
          state: workspaceRuntimes.state,
          sprite_url: workspaceRuntimes.spriteUrl,
          sprite_name: workspaceRuntimes.spriteName,
          last_error: workspaceRuntimes.lastError,
          updated_at: workspaceRuntimes.updatedAt,
          provisioning_step: workspaceRuntimes.provisioningStep,
          step_started_at: workspaceRuntimes.stepStartedAt,
        })
        .from(workspaceRuntimes)
        .where(eq(workspaceRuntimes.workspaceId, id))
        .limit(1)

      if (!row) {
        await db
          .insert(workspaceRuntimes)
          .values({ workspaceId: id, state: 'pending' })
          .onConflictDoNothing()

        ;[row] = await db
          .select({
            workspace_id: workspaceRuntimes.workspaceId,
            state: workspaceRuntimes.state,
            sprite_url: workspaceRuntimes.spriteUrl,
            sprite_name: workspaceRuntimes.spriteName,
            last_error: workspaceRuntimes.lastError,
            updated_at: workspaceRuntimes.updatedAt,
            provisioning_step: workspaceRuntimes.provisioningStep,
            step_started_at: workspaceRuntimes.stepStartedAt,
          })
          .from(workspaceRuntimes)
          .where(eq(workspaceRuntimes.workspaceId, id))
          .limit(1)
      }

      return mapRuntimeRow(row as Record<string, unknown>)
    },

    async retryWorkspaceRuntime(id) {
      const rows = await sql<any[]>`
        UPDATE workspace_runtimes
        SET state = 'pending',
            last_error = NULL,
            provisioning_step = NULL,
            step_started_at = NULL,
            updated_at = now()
        WHERE workspace_id = ${id}::uuid
          AND state IN ('error', 'provisioning')
        RETURNING workspace_id, state, sprite_url, sprite_name, last_error,
                  updated_at, provisioning_step, step_started_at
      `

      if (rows.length > 0) {
        return mapRuntimeRow(rows[0] as Record<string, unknown>)
      }

      const currentRows = await sql<any[]>`
        SELECT workspace_id, state, sprite_url, sprite_name, last_error,
               updated_at, provisioning_step, step_started_at
        FROM workspace_runtimes
        WHERE workspace_id = ${id}::uuid
      `

      if (currentRows.length === 0) {
        throw new RuntimeNotFoundError()
      }

      throw new RuntimeInvalidTransitionError()
    },

    async getWorkspaceSettings(id) {
      const rows = await db
        .select({
          key: workspaceSettings.key,
          updatedAt: workspaceSettings.updatedAt,
        })
        .from(workspaceSettings)
        .where(eq(workspaceSettings.workspaceId, id))

      const payload: Record<string, unknown> = {}
      for (const row of rows) {
        payload[row.key] = {
          configured: true,
          updated_at: row.updatedAt,
        }
      }
      return payload
    },

    async putWorkspaceSettings(id, settings) {
      const key = settingsKey(config)
      for (const [settingKey, value] of Object.entries(settings)) {
        await sql`
          INSERT INTO workspace_settings (workspace_id, key, value)
          VALUES (${id}::uuid, ${settingKey}, pgp_sym_encrypt(${value}, ${key}))
          ON CONFLICT (workspace_id, key)
          DO UPDATE SET value = pgp_sym_encrypt(${value}, ${key}), updated_at = now()
        `
      }
      return { ...settings }
    },

    async getMemberRole(workspaceId, userId) {
      const [row] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ))
        .limit(1)

      return row?.role as LocalMemberRole | undefined ?? null
    },

    async listWorkspaceMembers(workspaceId) {
      const rows = await db
        .select({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
        })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId))
        .orderBy(
          drizzleSql`CASE ${workspaceMembers.role}
            WHEN 'owner' THEN 0
            WHEN 'editor' THEN 1
            ELSE 2
          END`,
          asc(workspaceMembers.createdAt),
        )

      return rows.map(normalizeMemberRow)
    },

    async upsertWorkspaceMember(workspaceId, userId, role) {
      const [row] = await db
        .insert(workspaceMembers)
        .values({
          workspaceId,
          userId,
          role,
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role },
        })
        .returning({
          workspaceId: workspaceMembers.workspaceId,
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
        })

      return normalizeMemberRow(row)
    },

    async removeWorkspaceMember(workspaceId, userId) {
      const [existing] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ))
        .limit(1)

      if (!existing) {
        return { removed: false }
      }

      if (existing.role === 'owner') {
        const ownerRows = await db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, 'owner'),
          ))

        if (ownerRows.length <= 1) {
          return { removed: false, code: 'LAST_OWNER' }
        }
      }

      const rows = await db
        .delete(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ))
        .returning({ userId: workspaceMembers.userId })

      return { removed: rows.length > 0 }
    },

    async listWorkspaceInvites(workspaceId) {
      const rows = await db
        .select({
          id: workspaceInvites.id,
          workspaceId: workspaceInvites.workspaceId,
          email: workspaceInvites.email,
          role: workspaceInvites.role,
          expiresAt: workspaceInvites.expiresAt,
          acceptedAt: workspaceInvites.acceptedAt,
          createdAt: workspaceInvites.createdAt,
        })
        .from(workspaceInvites)
        .where(eq(workspaceInvites.workspaceId, workspaceId))
        .orderBy(drizzleSql`${workspaceInvites.createdAt} DESC`)

      return rows.map(normalizeInviteRow)
    },

    async createWorkspaceInvite(workspaceId, email, role, invitedBy) {
      const [row] = await db
        .insert(workspaceInvites)
        .values({
          workspaceId,
          email: email.trim().toLowerCase(),
          tokenHash: randomBytes(32).toString('hex'),
          role,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdBy: String(invitedBy || ''),
        })
        .returning({
          id: workspaceInvites.id,
          workspaceId: workspaceInvites.workspaceId,
          email: workspaceInvites.email,
          role: workspaceInvites.role,
          expiresAt: workspaceInvites.expiresAt,
          acceptedAt: workspaceInvites.acceptedAt,
          createdAt: workspaceInvites.createdAt,
        })

      return normalizeInviteRow(row)
    },

    async getWorkspaceInvite(workspaceId, inviteId) {
      const [row] = await db
        .select({
          id: workspaceInvites.id,
          workspaceId: workspaceInvites.workspaceId,
          email: workspaceInvites.email,
          role: workspaceInvites.role,
          expiresAt: workspaceInvites.expiresAt,
          acceptedAt: workspaceInvites.acceptedAt,
          createdAt: workspaceInvites.createdAt,
        })
        .from(workspaceInvites)
        .where(and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.id, inviteId),
        ))
        .limit(1)

      return row ? normalizeInviteRow(row) : undefined
    },

    async revokeWorkspaceInvite(workspaceId, inviteId) {
      const rows = await db
        .delete(workspaceInvites)
        .where(and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.id, inviteId),
        ))
        .returning({ id: workspaceInvites.id })

      return rows.length > 0
    },

    async acceptWorkspaceInvite(workspaceId, inviteId, userId) {
      const inviteRows = await sql<any[]>`
        SELECT id, workspace_id, email, role, expires_at, accepted_at, created_at
        FROM workspace_invites
        WHERE id = ${inviteId}::uuid AND workspace_id = ${workspaceId}::uuid
      `

      if (inviteRows.length === 0) {
        return {}
      }

      await sql`
        UPDATE workspace_invites
        SET accepted_at = now()
        WHERE id = ${inviteId}::uuid
      `

      await sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${workspaceId}::uuid, ${userId}::uuid, ${inviteRows[0].role})
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `

      const memberRows = await sql<any[]>`
        SELECT workspace_id, user_id, role, created_at
        FROM workspace_members
        WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
      `

      const acceptedInvite = await sql<any[]>`
        SELECT id, workspace_id, email, role, expires_at, accepted_at, created_at
        FROM workspace_invites
        WHERE id = ${inviteId}::uuid
      `

      return {
        invite: acceptedInvite[0] ? normalizeInviteRow({
          id: String(acceptedInvite[0].id),
          workspaceId: String(acceptedInvite[0].workspace_id),
          email: String(acceptedInvite[0].email),
          role: String(acceptedInvite[0].role),
          expiresAt: acceptedInvite[0].expires_at instanceof Date
            ? acceptedInvite[0].expires_at.toISOString()
            : String(acceptedInvite[0].expires_at),
          acceptedAt: acceptedInvite[0].accepted_at instanceof Date
            ? acceptedInvite[0].accepted_at.toISOString()
            : acceptedInvite[0].accepted_at
              ? String(acceptedInvite[0].accepted_at)
              : null,
          createdAt: acceptedInvite[0].created_at instanceof Date
            ? acceptedInvite[0].created_at.toISOString()
            : String(acceptedInvite[0].created_at),
        }) : undefined,
        member: memberRows[0] ? normalizeMemberRow({
          workspaceId: String(memberRows[0].workspace_id),
          userId: String(memberRows[0].user_id),
          role: String(memberRows[0].role),
          createdAt: memberRows[0].created_at instanceof Date
            ? memberRows[0].created_at.toISOString()
            : String(memberRows[0].created_at),
        }) : undefined,
      }
    },

    async getWorkspaceGitHubConnection(workspaceId) {
      const key = String(config.settingsKey || '').trim()
      if (!key) {
        return null
      }
      const rows = await sql<any[]>`
        SELECT key, pgp_sym_decrypt(value, ${key}) AS val
        FROM workspace_settings
        WHERE workspace_id = ${workspaceId}::uuid
          AND key IN ('github_installation_id', 'github_repo_url')
      `

      const settings: Record<string, unknown> = {}
      for (const row of rows) {
        settings[String(row.key)] = row.val == null ? null : String(row.val)
      }
      return normalizeGitHubConnection(settings)
    },

    async setWorkspaceGitHubConnection(workspaceId, updates) {
      const key = settingsKey(config)
      if (updates.installation_id !== undefined) {
        if (updates.installation_id === null) {
          await sql`
            DELETE FROM workspace_settings
            WHERE workspace_id = ${workspaceId}::uuid
              AND key = 'github_installation_id'
          `
        } else {
          await sql`
            INSERT INTO workspace_settings (workspace_id, key, value)
            VALUES (${workspaceId}::uuid, 'github_installation_id', pgp_sym_encrypt(${String(updates.installation_id)}, ${key}))
            ON CONFLICT (workspace_id, key)
            DO UPDATE SET value = pgp_sym_encrypt(${String(updates.installation_id)}, ${key}), updated_at = now()
          `
        }
      }

      if (updates.repo_url !== undefined) {
        if (!updates.repo_url) {
          await sql`
            DELETE FROM workspace_settings
            WHERE workspace_id = ${workspaceId}::uuid
              AND key = 'github_repo_url'
          `
        } else {
          await sql`
            INSERT INTO workspace_settings (workspace_id, key, value)
            VALUES (${workspaceId}::uuid, 'github_repo_url', pgp_sym_encrypt(${updates.repo_url}, ${key}))
            ON CONFLICT (workspace_id, key)
            DO UPDATE SET value = pgp_sym_encrypt(${updates.repo_url}, ${key}), updated_at = now()
          `
        }
      }

      return this.getWorkspaceGitHubConnection(workspaceId)
    },

    async clearWorkspaceGitHubConnection(workspaceId) {
      await sql`
        DELETE FROM workspace_settings
        WHERE workspace_id = ${workspaceId}::uuid
          AND key IN ('github_installation_id', 'github_repo_url')
      `
    },

    async getUserGitHubLink(userId, email) {
      const settings = (await this.getUserSettings(userId, email)).settings
      return normalizeGitHubUserLink(settings)
    },

    async setUserGitHubLink(userId, email, installationId) {
      const updated = await this.putUserSettings(userId, email, {
        settings: {
          github_account_linked: installationId !== null,
          github_default_installation_id: installationId,
        },
      })
      return normalizeGitHubUserLink(updated.settings)
    },

    async getUserSettings(userId, email) {
      const [row] = await db
        .select({
          displayName: userSettings.displayName,
          email: userSettings.email,
          settings: userSettings.settings,
        })
        .from(userSettings)
        .where(and(
          eq(userSettings.userId, userId),
          eq(userSettings.appId, appId),
        ))
        .limit(1)

      const normalized = normalizeUserSettingsRow(row)
      if (!normalized.email && email) normalized.email = email
      return normalized
    },

    async putUserSettings(userId, email, updates) {
      const existing = await this.getUserSettings(userId, email)
      const mergedSettings = {
        ...existing.settings,
        ...(updates.settings || {}),
      }
      const displayName = updates.display_name ?? existing.display_name
      const storedEmail = String(email || existing.email || '').trim().toLowerCase()

      await db
        .insert(userSettings)
        .values({
          userId,
          appId,
          email: storedEmail,
          displayName,
          settings: mergedSettings,
        })
        .onConflictDoUpdate({
          target: [userSettings.userId, userSettings.appId],
          set: {
            email: storedEmail,
            displayName,
            settings: mergedSettings,
            updatedAt: drizzleSql`now()`,
          },
        })

      return {
        display_name: displayName,
        email: storedEmail,
        settings: mergedSettings,
      }
    },
  }
}

const localPersistenceCache = new WeakMap<ServerConfig, WorkspacePersistence>()
const hostedPersistenceCache = new WeakMap<ServerConfig, WorkspacePersistence>()

export function getWorkspacePersistence(config: ServerConfig): WorkspacePersistence {
  if (config.controlPlaneProvider === 'neon') {
    const cached = hostedPersistenceCache.get(config)
    if (cached) return cached
    const store = createHostedPersistence(config)
    hostedPersistenceCache.set(config, store)
    return store
  }

  const cached = localPersistenceCache.get(config)
  if (cached) return cached
  const store = createLocalPersistence(config)
  localPersistenceCache.set(config, store)
  return store
}
