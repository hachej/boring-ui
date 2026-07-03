import type { FastifyInstance } from 'fastify'
import type { GovernanceService } from './governanceService.js'
import type { GovernanceUserPolicy } from './policyTypes.js'

type GovernanceBootstrapApp = FastifyInstance & {
  userStore: {
    getByEmail(email: string): Promise<{ id: string; email: string; emailVerified: boolean } | null>
  }
  workspaceStore: FastifyInstance['workspaceStore'] & {
    create(userId: string, name: string, appId: string, opts?: { isDefault?: boolean; id?: string }): ReturnType<FastifyInstance['workspaceStore']['create']>
  }
}

const COMPANY_CONTEXT_WORKSPACE_NAME = 'Company Context'

function adminPolicies(service: GovernanceService): GovernanceUserPolicy[] {
  const policy = service.policy()
  if (!policy) return []
  return policy.users.filter((user) => user.role === 'admin')
}

async function provisionCompanyContextWorkspace(app: FastifyInstance, workspaceId: string, ownerId: string): Promise<void> {
  if (!app.provisioner) return
  const runtime = await app.workspaceStore.getWorkspaceRuntime(workspaceId)
  if (runtime?.state === 'ready' && runtime.volumePath) return

  await app.workspaceStore.putWorkspaceRuntime(workspaceId, { state: 'pending' })
  try {
    const result = await app.provisioner.provision({
      workspaceId,
      workspaceName: COMPANY_CONTEXT_WORKSPACE_NAME,
      ownerId,
      appId: app.config.appId,
    })
    await app.workspaceStore.putWorkspaceRuntime(workspaceId, {
      state: 'ready',
      volumePath: result.volumePath,
    })
  } catch (error) {
    await app.workspaceStore.putWorkspaceRuntime(workspaceId, {
      state: 'error',
      lastError: error instanceof Error ? error.message : String(error),
      lastErrorOp: 'provision',
    })
    throw error
  }
}

export async function reconcileCompanyContextWorkspace(app: FastifyInstance, service: GovernanceService): Promise<void> {
  if (!service.isEnabled()) return
  const governanceApp = app as GovernanceBootstrapApp
  const workspaceId = service.companyContextWorkspaceId()
  if (!workspaceId) return

  const adminUsers = []
  for (const policyUser of adminPolicies(service)) {
    const user = await governanceApp.userStore.getByEmail(policyUser.email)
    if (user?.emailVerified) adminUsers.push(user)
  }

  if (adminUsers.length === 0) {
    app.log.warn({ workspaceId }, 'governance.company_context.no_existing_verified_admins')
    return
  }

  const owner = adminUsers[0]
  const existing = await governanceApp.workspaceStore.get(workspaceId)
  if (!existing) {
    await governanceApp.workspaceStore.create(owner.id, COMPANY_CONTEXT_WORKSPACE_NAME, app.config.appId, {
      id: workspaceId,
      isDefault: false,
    })
    app.log.info({ workspaceId, ownerId: owner.id }, 'governance.company_context.created')
  }

  const adminIds = new Set(adminUsers.map((admin) => admin.id))
  for (const admin of adminUsers) {
    await governanceApp.workspaceStore.upsertMember(workspaceId, admin.id, 'owner')
  }

  const existingMembers = await governanceApp.workspaceStore.listMembers(workspaceId)
  for (const member of existingMembers) {
    if (adminIds.has(member.userId)) continue
    const result = await governanceApp.workspaceStore.removeMember(workspaceId, member.userId)
    if (!result.removed) {
      app.log.warn({ workspaceId, userId: member.userId, code: result.code }, 'governance.company_context.remove_stale_member_failed')
    }
  }

  await provisionCompanyContextWorkspace(app, workspaceId, owner.id)
}
