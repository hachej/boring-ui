import type { FastifyInstance } from 'fastify'
import { ConfigValidationError } from '@hachej/boring-core/shared'
import type { GovernanceService } from './governanceService.js'
import type { GovernanceUserPolicy } from './policyTypes.js'

type GovernanceWorkspace = NonNullable<Awaited<ReturnType<FastifyInstance['workspaceStore']['get']>>> & {
  managedBy?: string | null
}

type GovernanceWorkspaceStore = Omit<FastifyInstance['workspaceStore'], 'create' | 'get' | 'removeMember'> & {
  create(...args: Parameters<FastifyInstance['workspaceStore']['create']>): Promise<GovernanceWorkspace>
  get(id: string): Promise<GovernanceWorkspace | null>
  getIncludingDeleted(id: string): Promise<GovernanceWorkspace | null>
  restore(id: string): Promise<GovernanceWorkspace | null>
  removeMember(workspaceId: string, userId: string, opts?: { allowLastOwner?: boolean }): ReturnType<FastifyInstance['workspaceStore']['removeMember']>
}

type GovernanceBootstrapApp = FastifyInstance & {
  userStore: {
    getByEmail(email: string): Promise<{ id: string; email: string; emailVerified: boolean } | null>
  }
  workspaceStore: GovernanceWorkspaceStore
}

const COMPANY_CONTEXT_WORKSPACE_NAME = 'Company Context'
const COMPANY_CONTEXT_WORKSPACE_MANAGED_BY = 'company-context'
const provisionInFlight = new Map<string, Promise<void>>()

function adminPolicies(service: GovernanceService): GovernanceUserPolicy[] {
  const policy = service.policy()
  if (!policy) return []
  return policy.users.filter((user) => user.role === 'admin')
}

function assertCompanyContextWorkspace(workspace: GovernanceWorkspace, workspaceId: string): void {
  if (workspace.managedBy === COMPANY_CONTEXT_WORKSPACE_MANAGED_BY) return
  throw new ConfigValidationError([
    {
      path: ['tenant', 'companyContextWorkspaceId'],
      message: `workspace ${workspaceId} already exists but is not marked as a managed Company Context workspace`,
    },
  ])
}

async function provisionCompanyContextWorkspace(app: FastifyInstance, workspaceId: string, ownerId: string): Promise<void> {
  if (!app.provisioner) return
  const runtime = await app.workspaceStore.getWorkspaceRuntime(workspaceId)
  if (runtime?.state === 'ready' && runtime.volumePath) return

  const existingProvision = provisionInFlight.get(workspaceId)
  if (existingProvision) {
    await existingProvision
    return
  }

  const provisionPromise = (async () => {
    await app.workspaceStore.putWorkspaceRuntime(workspaceId, { state: 'pending' })
    try {
      const result = await app.provisioner!.provision({
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
  })()
  provisionInFlight.set(workspaceId, provisionPromise)
  try {
    await provisionPromise
  } finally {
    if (provisionInFlight.get(workspaceId) === provisionPromise) provisionInFlight.delete(workspaceId)
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

  let workspace = await governanceApp.workspaceStore.get(workspaceId)
  if (workspace) {
    assertCompanyContextWorkspace(workspace, workspaceId)
  } else {
    const deletedWorkspace = await governanceApp.workspaceStore.getIncludingDeleted(workspaceId)
    if (deletedWorkspace) {
      assertCompanyContextWorkspace(deletedWorkspace, workspaceId)
      workspace = await governanceApp.workspaceStore.restore(workspaceId)
      if (!workspace) throw new Error(`Workspace ${workspaceId} could not be restored`)
      app.log.info({ workspaceId }, 'governance.company_context.restored')
    }
  }

  const owner = adminUsers[0]
  if (!workspace) {
    if (!owner) {
      app.log.warn({ workspaceId }, 'governance.company_context.no_existing_verified_admins')
      return
    }

    workspace = await governanceApp.workspaceStore.create(owner.id, COMPANY_CONTEXT_WORKSPACE_NAME, app.config.appId, {
      id: workspaceId,
      isDefault: false,
      managedBy: COMPANY_CONTEXT_WORKSPACE_MANAGED_BY,
    })
    assertCompanyContextWorkspace(workspace, workspaceId)
    app.log.info({ workspaceId, ownerId: owner.id }, 'governance.company_context.created')
  }

  const adminIds = new Set(adminUsers.map((admin) => admin.id))
  for (const admin of adminUsers) {
    await governanceApp.workspaceStore.upsertMember(workspaceId, admin.id, 'owner')
  }

  const existingMembers = await governanceApp.workspaceStore.listMembers(workspaceId)
  for (const member of existingMembers) {
    if (adminIds.has(member.userId)) continue
    const result = adminIds.size === 0
      ? await governanceApp.workspaceStore.removeMember(workspaceId, member.userId, { allowLastOwner: true })
      : await governanceApp.workspaceStore.removeMember(workspaceId, member.userId)
    if (!result.removed) {
      app.log.warn({ workspaceId, userId: member.userId, code: result.code }, 'governance.company_context.remove_stale_member_failed')
    }
  }

  if (!owner) {
    app.log.warn({ workspaceId }, 'governance.company_context.no_existing_verified_admins')
    return
  }

  await provisionCompanyContextWorkspace(app, workspaceId, owner.id)
}
