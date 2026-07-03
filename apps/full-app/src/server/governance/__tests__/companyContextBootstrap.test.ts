import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { createGovernanceService } from '../governanceService.js'
import { reconcileCompanyContextWorkspace } from '../companyContextBootstrap.js'

function service() {
  return createGovernanceService({
    enabled: true,
    status: { state: 'active', path: '/policy.yaml', tenantId: 'company', userCount: 2 },
    policy: {
      tenant: { id: 'company', companyContextWorkspaceId: '00000000-0000-4000-8000-000000000475', defaultMonthlyModelBudgetEur: 0, perRunHoldEur: 1, perRunHoldMicros: 1_000_000 },
      users: [
        { email: 'admin@example.com', role: 'admin', models: [], companyContext: { allow: ['^/.*'] } },
        { email: 'user@example.com', role: 'user', models: [], companyContext: { allow: ['^/public/.*'] } },
      ],
      usersByEmail: new Map(),
    },
  })
}

describe('reconcileCompanyContextWorkspace', () => {
  it('creates the policy-named workspace and grants only verified admins workspace membership', async () => {
    const app = Fastify({ logger: false }) as any
    const workspaces = new Map<string, any>()
    const members = new Map<string, any>()
    const runtimes = new Map<string, any>()
    const provision = vi.fn(async () => ({ volumePath: '/tmp/company-context' }))

    app.config = { appId: 'full-app' }
    app.userStore = {
      getByEmail: vi.fn(async (email: string) => {
        if (email === 'admin@example.com') return { id: 'admin-id', email, emailVerified: true }
        if (email === 'user@example.com') return { id: 'user-id', email, emailVerified: true }
        return null
      }),
    }
    app.workspaceStore = {
      get: vi.fn(async (id: string) => workspaces.get(id) ?? null),
      create: vi.fn(async (userId: string, name: string, appId: string, opts: { id: string; isDefault: boolean }) => {
        const workspace = { id: opts.id, name, appId, createdBy: userId, isDefault: opts.isDefault, deletedAt: null }
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
        return { removed }
      }),
      getWorkspaceRuntime: vi.fn(async (workspaceId: string) => runtimes.get(workspaceId) ?? null),
      putWorkspaceRuntime: vi.fn(async (workspaceId: string, state: any) => {
        const next = { workspaceId, ...(runtimes.get(workspaceId) ?? {}), ...state }
        runtimes.set(workspaceId, next)
        return next
      }),
    }
    app.provisioner = { provision }
    members.set('00000000-0000-4000-8000-000000000475:user-id', {
      workspaceId: '00000000-0000-4000-8000-000000000475',
      userId: 'user-id',
      role: 'owner',
    })

    await reconcileCompanyContextWorkspace(app, service())

    expect(app.workspaceStore.create).toHaveBeenCalledWith('admin-id', 'Company Context', 'full-app', {
      id: '00000000-0000-4000-8000-000000000475',
      isDefault: false,
    })
    expect(await app.workspaceStore.getMemberRole('00000000-0000-4000-8000-000000000475', 'admin-id')).toBe('owner')
    expect(await app.workspaceStore.getMemberRole('00000000-0000-4000-8000-000000000475', 'user-id')).toBeNull()
    expect(app.workspaceStore.removeMember).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000475', 'user-id')
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: '00000000-0000-4000-8000-000000000475', ownerId: 'admin-id' }))

    await app.close()
  })
})
