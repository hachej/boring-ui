import { randomUUID, createHash } from 'node:crypto'
import type { WorkspaceStore } from '../../app/types.js'
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
  MemberRole,
  User,
} from '../../../shared/types.js'
import { ERROR_CODES, HttpError } from '../../../shared/errors.js'
import type { LocalUserStore } from './LocalUserStore.js'

export class LocalWorkspaceStore implements WorkspaceStore {
  private workspaces = new Map<string, Workspace>()
  private members = new Map<string, WorkspaceMember>() // key: `${workspaceId}:${userId}`
  private invites = new Map<string, WorkspaceInvite>()
  private runtimes = new Map<string, WorkspaceRuntime>()
  private wsSettings = new Map<string, Map<string, { value: string; updatedAt: string }>>()
  private uiStates = new Map<string, Record<string, unknown>>() // key: `${userId}:${workspaceId}`

  constructor(private userStore: LocalUserStore) {}

  async create(userId: string, name: string, appId: string, opts?: { isDefault?: boolean }): Promise<Workspace> {
    const now = new Date().toISOString()
    const ws: Workspace = {
      id: randomUUID(),
      appId,
      name,
      createdBy: userId,
      createdAt: now,
      deletedAt: null,
      isDefault: opts?.isDefault ?? false,
      machineId: null,
      volumeId: null,
      flyRegion: null,
    }
    this.workspaces.set(ws.id, ws)
    const memberKey = `${ws.id}:${userId}`
    this.members.set(memberKey, {
      workspaceId: ws.id,
      userId,
      role: 'owner',
      createdAt: now,
    })
    this.runtimes.set(ws.id, {
      workspaceId: ws.id,
      spriteUrl: null,
      spriteName: null,
      state: 'ready',
      lastError: null,
      provisioningStep: null,
      stepStartedAt: null,
      updatedAt: now,
    })
    return ws
  }

  async list(userId: string, appId: string): Promise<Workspace[]> {
    const result: Workspace[] = []
    for (const ws of this.workspaces.values()) {
      if (ws.deletedAt) continue
      if (ws.appId !== appId) continue
      const memberKey = `${ws.id}:${userId}`
      if (this.members.has(memberKey)) result.push(ws)
    }
    result.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return b.createdAt.localeCompare(a.createdAt)
    })
    return result
  }

  async get(id: string): Promise<Workspace | null> {
    const ws = this.workspaces.get(id)
    if (!ws || ws.deletedAt) return null
    return ws
  }

  async update(id: string, updates: Partial<Pick<Workspace, 'name'>>): Promise<Workspace | null> {
    const ws = this.workspaces.get(id)
    if (!ws || ws.deletedAt) return null
    const updated = { ...ws, ...updates }
    this.workspaces.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.WORKSPACE_PROVISIONING | typeof ERROR_CODES.NOT_FOUND }> {
    const ws = this.workspaces.get(id)
    if (!ws || ws.deletedAt) return { removed: false, code: ERROR_CODES.NOT_FOUND }
    const runtime = this.runtimes.get(id)
    if (runtime?.state === 'provisioning') return { removed: false, code: ERROR_CODES.WORKSPACE_PROVISIONING }
    ws.deletedAt = new Date().toISOString()
    this.workspaces.set(id, ws)
    return { removed: true }
  }

  async getWorkspacesWhereSoleOwner(userId: string): Promise<Workspace[]> {
    const result: Workspace[] = []
    for (const ws of this.workspaces.values()) {
      if (ws.deletedAt) continue
      const memberKey = `${ws.id}:${userId}`
      const membership = this.members.get(memberKey)
      if (!membership || membership.role !== 'owner') continue
      let otherOwnerExists = false
      for (const [key, m] of this.members) {
        if (m.workspaceId === ws.id && m.userId !== userId && m.role === 'owner') {
          otherOwnerExists = true
          break
        }
      }
      if (!otherOwnerExists) result.push(ws)
    }
    return result
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    return this.members.has(`${workspaceId}:${userId}`)
  }

  async getMemberRole(workspaceId: string, userId: string): Promise<MemberRole | null> {
    const m = this.members.get(`${workspaceId}:${userId}`)
    return m?.role ?? null
  }

  async listMembers(workspaceId: string): Promise<Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }>> {
    const result: Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }> = []
    for (const m of this.members.values()) {
      if (m.workspaceId !== workspaceId) continue
      const user = await this.userStore.getById(m.userId)
      result.push({
        ...m,
        user: {
          id: m.userId,
          email: user?.email ?? '',
          name: user?.name ?? null,
          image: user?.image ?? null,
        },
      })
    }
    return result
  }

  async upsertMember(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember> {
    const key = `${workspaceId}:${userId}`
    const existing = this.members.get(key)
    const now = new Date().toISOString()
    const member: WorkspaceMember = {
      workspaceId,
      userId,
      role,
      createdAt: existing?.createdAt ?? now,
    }
    this.members.set(key, member)
    return member
  }

  async removeMember(workspaceId: string, userId: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER | typeof ERROR_CODES.WORKSPACE_PROVISIONING }> {
    const key = `${workspaceId}:${userId}`
    const membership = this.members.get(key)
    if (!membership) return { removed: false, code: ERROR_CODES.NOT_MEMBER }
    const runtime = this.runtimes.get(workspaceId)
    if (runtime?.state === 'provisioning') return { removed: false, code: ERROR_CODES.WORKSPACE_PROVISIONING }
    if (membership.role === 'owner') {
      let otherOwnerExists = false
      for (const m of this.members.values()) {
        if (m.workspaceId === workspaceId && m.userId !== userId && m.role === 'owner') {
          otherOwnerExists = true
          break
        }
      }
      if (!otherOwnerExists) return { removed: false, code: ERROR_CODES.LAST_OWNER }
    }
    this.members.delete(key)
    return { removed: true }
  }

  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const result: WorkspaceInvite[] = []
    for (const inv of this.invites.values()) {
      if (inv.workspaceId === workspaceId) result.push(inv)
    }
    return result
  }

  async createInvite(workspaceId: string, email: string, role: MemberRole, invitedBy: string | null): Promise<{ invite: WorkspaceInvite; rawToken: string }> {
    const rawToken = randomUUID()
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const invite: WorkspaceInvite = {
      id: randomUUID(),
      workspaceId,
      email,
      tokenHash,
      role,
      expiresAt,
      acceptedAt: null,
      createdBy: invitedBy,
      createdAt: now,
    }
    this.invites.set(invite.id, invite)
    return { invite, rawToken }
  }

  async getInvite(workspaceId: string, inviteId: string): Promise<WorkspaceInvite | null> {
    const inv = this.invites.get(inviteId)
    if (!inv || inv.workspaceId !== workspaceId) return null
    return inv
  }

  async getInviteByTokenHash(tokenHash: string): Promise<WorkspaceInvite | null> {
    for (const inv of this.invites.values()) {
      if (inv.tokenHash === tokenHash) return inv
    }
    return null
  }

  async revokeInvite(workspaceId: string, inviteId: string): Promise<boolean> {
    const inv = this.invites.get(inviteId)
    if (!inv || inv.workspaceId !== workspaceId) return false
    this.invites.delete(inviteId)
    return true
  }

  async acceptInvite(workspaceId: string, inviteId: string, userId: string): Promise<{ invite: WorkspaceInvite; member: WorkspaceMember }> {
    const inv = this.invites.get(inviteId)
    if (!inv || inv.workspaceId !== workspaceId) {
      throw new HttpError({ status: 404, code: ERROR_CODES.INVITE_NOT_FOUND, message: 'Invite not found' })
    }
    if (new Date(inv.expiresAt) < new Date()) {
      throw new HttpError({ status: 410, code: ERROR_CODES.INVITE_EXPIRED, message: 'Invite has expired' })
    }
    if (inv.acceptedAt) {
      throw new HttpError({ status: 409, code: ERROR_CODES.INVITE_ALREADY_ACCEPTED, message: 'Invite already accepted' })
    }
    const now = new Date().toISOString()
    inv.acceptedAt = now
    this.invites.set(inviteId, inv)
    const user = await this.userStore.getById(userId)
    if (user && inv.email.toLowerCase() !== user.email.toLowerCase()) {
      inv.acceptedAt = null
      this.invites.set(inviteId, inv)
      throw new HttpError({ status: 403, code: ERROR_CODES.INVITE_EMAIL_MISMATCH, message: 'Invite email does not match your account' })
    }
    const member = await this.upsertMember(workspaceId, userId, inv.role)
    return { invite: inv, member }
  }

  async getWorkspaceSettings(workspaceId: string): Promise<Array<{ key: string; configured: boolean; updated_at: string }>> {
    const settings = this.wsSettings.get(workspaceId)
    if (!settings) return []
    return Array.from(settings.entries()).map(([key, { updatedAt }]) => ({
      key,
      configured: true,
      updated_at: updatedAt,
    }))
  }

  async putWorkspaceSettings(workspaceId: string, settings: Record<string, string>): Promise<Array<{ key: string; configured: boolean; updated_at: string }>> {
    const now = new Date().toISOString()
    let wsSettings = this.wsSettings.get(workspaceId)
    if (!wsSettings) {
      wsSettings = new Map()
      this.wsSettings.set(workspaceId, wsSettings)
    }
    for (const [key, value] of Object.entries(settings)) {
      wsSettings.set(key, { value: JSON.stringify(value), updatedAt: now })
    }
    return this.getWorkspaceSettings(workspaceId)
  }

  async getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null> {
    const ws = this.workspaces.get(workspaceId)
    if (!ws || ws.deletedAt) return null
    const existing = this.runtimes.get(workspaceId)
    if (existing) return existing
    const now = new Date().toISOString()
    const runtime: WorkspaceRuntime = {
      workspaceId,
      spriteUrl: null,
      spriteName: null,
      state: 'ready',
      lastError: null,
      provisioningStep: null,
      stepStartedAt: null,
      updatedAt: now,
    }
    this.runtimes.set(workspaceId, runtime)
    return runtime
  }

  async putWorkspaceRuntime(workspaceId: string, state: Partial<WorkspaceRuntime>): Promise<WorkspaceRuntime> {
    const existing = await this.getWorkspaceRuntime(workspaceId)
    if (!existing) throw new Error(`Workspace ${workspaceId} not found`)
    const updated: WorkspaceRuntime = {
      ...existing,
      ...state,
      workspaceId,
      updatedAt: new Date().toISOString(),
    }
    this.runtimes.set(workspaceId, updated)
    return updated
  }

  async retryWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null> {
    const existing = this.runtimes.get(workspaceId)
    if (!existing || existing.state !== 'error') return null
    const updated: WorkspaceRuntime = {
      ...existing,
      state: 'pending',
      lastError: null,
      updatedAt: new Date().toISOString(),
    }
    this.runtimes.set(workspaceId, updated)
    return updated
  }

  async getUiState(userId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
    return this.uiStates.get(`${userId}:${workspaceId}`) ?? null
  }

  async putUiState(userId: string, workspaceId: string, state: Record<string, unknown>): Promise<void> {
    this.uiStates.set(`${userId}:${workspaceId}`, state)
  }
}
