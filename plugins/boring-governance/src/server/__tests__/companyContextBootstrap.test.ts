import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES } from '@hachej/boring-core/shared'
import { createGovernanceService } from '../governanceService.js'
import { reconcileCompanyContextWorkspace } from '../companyContextBootstrap.js'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000475'
const MANAGED_BY = 'company-context'

function service() {
  return createGovernanceService({
    enabled: true,
    status: { state: 'active', path: '/policy.yaml', tenantId: 'company', userCount: 2 },
    policy: {
      tenant: { id: 'company', companyContextWorkspaceId: WORKSPACE_ID, defaultMonthlyModelBudgetEur: 0, perRunHoldEur: 1, perRunHoldMicros: 1_000_000 },
      users: [
        { email: 'admin@example.com', role: 'admin', budgets: { monthlyEur: null, monthlyMicros: null }, models: [], companyContext: { allow: ['^/.*'] } },
        { email: 'user@example.com', role: 'user', budgets: { monthlyEur: null, monthlyMicros: null }, models: [], companyContext: { allow: ['^/public/.*'] } },
      ],
      usersByEmail: new Map(),
    },
  })
}

function createApp(options: {
  users?: Record<string, { id: string; email: string; emailVerified: boolean } | null>
  provision?: ReturnType<typeof vi.fn>
} = {}) {
  const app = Fastify({ logger: false }) as any
  const workspaces = new Map<string, any>()
  const members = new Map<string, any>()
  const runtimes = new Map<string, any>()
  const provision = options.provision ?? vi.fn(async () => ({ volumePath: '/tmp/company-context' }))
  const users = options.users ?? {
    'admin@example.com': { id: 'admin-id', email: 'admin@example.com', emailVerified: true },
    'user@example.com': { id: 'user-id', email: 'user@example.com', emailVerified: true },
  }

  app.config = { appId: 'full-app' }
  app.userStore = {
    getByEmail: vi.fn(async (email: string) => users[email] ?? null),
  }
  app.workspaceStore = {
    get: vi.fn(async (id: string) => {
      const workspace = workspaces.get(id)
      return workspace && !workspace.deletedAt ? workspace : null
    }),
    getIncludingDeleted: vi.fn(async (id: string) => workspaces.get(id) ?? null),
    restore: vi.fn(async (id: string) => {
      const workspace = workspaces.get(id)
      if (!workspace) return null
      const restored = { ...workspace, deletedAt: null }
      workspaces.set(id, restored)
      return restored
    }),
    create: vi.fn(async (userId: string, name: string, appId: string, opts: { id: string; isDefault: boolean; managedBy?: string }) => {
      const existing = workspaces.get(opts.id)
      if (existing) return existing
      const workspace = { id: opts.id, name, appId, createdBy: userId, isDefault: opts.isDefault, deletedAt: null, managedBy: opts.managedBy }
      workspaces.set(workspace.id, workspace)
      members.set(`${workspace.id}:${userId}`, { workspaceId: workspace.id, userId, role: 'owner' })
      return workspace
    }),
    upsertMember: vi.fn(async (workspaceId: string, userId: string, role: string) => {
      const member = { workspaceId, userId, role }
      members.set(`${workspaceId}:${userId}`, member)
      return member
    }),
    getMemberRole: vi.fn(async (workspaceId: string, userId: string) => members.get(`${workspaceId}:${userId}`)?.role ?? null),
    listMembers: vi.fn(async (workspaceId: string) => Array.from(members.values()).filter((member) => member.workspaceId === workspaceId)),
    removeMember: vi.fn(async (workspaceId: string, userId: string) => {
      const removed = members.delete(`${workspaceId}:${userId}`)
      return removed ? { removed } : { removed, code: ERROR_CODES.NOT_MEMBER }
    }),
    getWorkspaceRuntime: vi.fn(async (workspaceId: string) => runtimes.get(workspaceId) ?? null),
    putWorkspaceRuntime: vi.fn(async (workspaceId: string, state: any) => {
      const next = { workspaceId, ...(runtimes.get(workspaceId) ?? {}), ...state }
      runtimes.set(workspaceId, next)
      return next
    }),
  }
  app.provisioner = { provision }

  return { app, workspaces, members, runtimes, provision }
}

describe('reconcileCompanyContextWorkspace', () => {
  it('creates the policy-named workspace and grants only verified admins workspace membership', async () => {
    const { app, members, provision } = createApp()
    members.set(`${WORKSPACE_ID}:user-id`, {
      workspaceId: WORKSPACE_ID,
      userId: 'user-id',
      role: 'owner',
    })

    await reconcileCompanyContextWorkspace(app, service())

    expect(app.workspaceStore.create).toHaveBeenCalledWith('admin-id', 'Company Context', 'full-app', {
      id: WORKSPACE_ID,
      isDefault: false,
      managedBy: MANAGED_BY,
    })
    expect(await app.workspaceStore.getMemberRole(WORKSPACE_ID, 'admin-id')).toBe('owner')
    expect(await app.workspaceStore.getMemberRole(WORKSPACE_ID, 'user-id')).toBeNull()
    expect(app.workspaceStore.removeMember).toHaveBeenCalledWith(WORKSPACE_ID, 'user-id')
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID, ownerId: 'admin-id' }))

    await app.close()
  })

  it('refuses to adopt an existing unmarked workspace id without changing members', async () => {
    const { app, workspaces, members } = createApp()
    workspaces.set(WORKSPACE_ID, {
      id: WORKSPACE_ID,
      appId: 'full-app',
      name: 'User workspace',
      createdBy: 'user-id',
      createdAt: new Date().toISOString(),
      deletedAt: null,
      isDefault: false,
      managedBy: null,
    })
    members.set(`${WORKSPACE_ID}:user-id`, { workspaceId: WORKSPACE_ID, userId: 'user-id', role: 'owner' })

    await expect(reconcileCompanyContextWorkspace(app, service())).rejects.toThrow(/not marked as a managed Company Context workspace/)

    expect(app.workspaceStore.create).not.toHaveBeenCalled()
    expect(app.workspaceStore.upsertMember).not.toHaveBeenCalled()
    expect(app.workspaceStore.removeMember).not.toHaveBeenCalled()
    expect(members.get(`${WORKSPACE_ID}:user-id`)).toMatchObject({ role: 'owner' })

    await app.close()
  })

  it('is idempotent across concurrent bootstraps for the configured workspace id', async () => {
    const { app, workspaces, provision } = createApp()

    await Promise.all([
      reconcileCompanyContextWorkspace(app, service()),
      reconcileCompanyContextWorkspace(app, service()),
    ])

    expect(workspaces.size).toBe(1)
    expect(workspaces.get(WORKSPACE_ID)).toMatchObject({ managedBy: MANAGED_BY, name: 'Company Context' })
    expect(await app.workspaceStore.getMemberRole(WORKSPACE_ID, 'admin-id')).toBe('owner')
    expect(provision).toHaveBeenCalledOnce()

    await app.close()
  })

  it('revokes stale owners from a marked workspace when no verified admins resolve', async () => {
    const { app, workspaces, members, provision } = createApp({
      users: {
        'admin@example.com': { id: 'admin-id', email: 'admin@example.com', emailVerified: false },
        'user@example.com': { id: 'user-id', email: 'user@example.com', emailVerified: true },
      },
    })
    workspaces.set(WORKSPACE_ID, {
      id: WORKSPACE_ID,
      appId: 'full-app',
      name: 'Company Context',
      createdBy: 'stale-owner',
      createdAt: new Date().toISOString(),
      deletedAt: null,
      isDefault: false,
      managedBy: MANAGED_BY,
    })
    members.set(`${WORKSPACE_ID}:stale-owner`, { workspaceId: WORKSPACE_ID, userId: 'stale-owner', role: 'owner' })

    await reconcileCompanyContextWorkspace(app, service())

    expect(members.has(`${WORKSPACE_ID}:stale-owner`)).toBe(false)
    expect(app.workspaceStore.removeMember).toHaveBeenCalledWith(WORKSPACE_ID, 'stale-owner', { allowLastOwner: true })
    expect(app.workspaceStore.upsertMember).not.toHaveBeenCalled()
    expect(provision).not.toHaveBeenCalled()

    await app.close()
  })

  it('restores a soft-deleted marked workspace before reconciling it', async () => {
    const { app, workspaces, provision } = createApp()
    workspaces.set(WORKSPACE_ID, {
      id: WORKSPACE_ID,
      appId: 'full-app',
      name: 'Company Context',
      createdBy: 'admin-id',
      createdAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
      isDefault: false,
      managedBy: MANAGED_BY,
    })

    await reconcileCompanyContextWorkspace(app, service())

    expect(app.workspaceStore.restore).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(workspaces.get(WORKSPACE_ID)?.deletedAt).toBeNull()
    expect(app.workspaceStore.create).not.toHaveBeenCalled()
    expect(await app.workspaceStore.getMemberRole(WORKSPACE_ID, 'admin-id')).toBe('owner')
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID, ownerId: 'admin-id' }))

    await app.close()
  })
})
