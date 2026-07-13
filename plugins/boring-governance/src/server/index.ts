import path from 'node:path'
import type { FastifyRequest } from 'fastify'
import type { AgentMeteringSink, RegisterAgentRoutesOptions } from '@hachej/boring-agent/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import { PostgresBudgetReservationStore } from '@hachej/boring-core/server'
import { loadGovernancePolicy, type LoadGovernancePolicyOptions } from './loadPolicy.js'
import { createGovernanceService, type GovernanceService, type GovernanceUsageSpendReader } from './governanceService.js'
import { governanceRoutes } from './routes.js'
import { reconcileCompanyContextWorkspace } from './companyContextBootstrap.js'
import { createGovernanceMeteringSink, GOVERNANCE_ELIGIBLE_LEGACY_SOURCES } from './metering.js'
import {
  createDefaultCompanyContextRootResolver,
  createGovernanceFilesystemBindings,
  type CreateGovernanceFilesystemBindingsOptions,
} from './filesystemBindings.js'

export { GovernancePolicyError, GovernanceService } from './governanceService.js'
export type { GovernanceMeResponse, GovernancePolicyErrorCode, GovernanceUsageSpendReader } from './governanceService.js'
export type { GovernanceUsageEntry, GovernanceUsageSummary } from '../usageContract.js'
export type {
  GovernanceLoadResult,
  GovernanceModelGrant,
  GovernancePolicy,
  GovernancePolicyStatus,
  GovernanceUserLike,
  GovernanceUserPolicy,
  ServedModelLike,
  TenantRole,
} from './policyTypes.js'
export {
  GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV,
  GOVERNANCE_POLICY_PATH_ENV,
  loadGovernancePolicy,
} from './loadPolicy.js'
export { normalizePolicyEmail, validateGovernancePolicy } from './validatePolicy.js'
export { createGovernanceMeteringSink } from './metering.js'
export {
  createDefaultCompanyContextRootResolver,
  createGovernanceFilesystemBindings,
  type CompanyContextRootResolver,
  type CreateGovernanceFilesystemBindingsOptions,
  type GovernanceFilesystemBindingContext,
} from './filesystemBindings.js'

export interface BuildGovernanceOptions extends Omit<LoadGovernancePolicyOptions, 'config'> {
  config?: Pick<CoreConfig, 'auth'>
}

export async function buildGovernanceService(options: BuildGovernanceOptions = {}): Promise<GovernanceService> {
  return createGovernanceService(await loadGovernancePolicy(options))
}

type GovernanceMeteringOptions = Parameters<typeof createGovernanceMeteringSink>[0]

export interface CreateGovernanceResult {
  service: GovernanceService
  status: ReturnType<GovernanceService['policyStatus']>
  serverPlugin: CoreWorkspaceAgentServerPlugin
  filterModels: RegisterAgentRoutesOptions['filterModels']
  createMeteringSink(delegate: AgentMeteringSink, getDb: GovernanceMeteringOptions['getDb']): AgentMeteringSink
  getFilesystemBindings(options?: CreateGovernanceFilesystemBindingsOptions): NonNullable<RegisterAgentRoutesOptions['getFilesystemBindings']>
  pi: { strictModelResolution: boolean }
}

function defaultAdminMutationsAllowed(options: CreateGovernanceFilesystemBindingsOptions): boolean {
  if (options.resolveCompanyContextRoot) return false
  const companyRoot = process.env.BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT?.trim()
  if (!companyRoot) return false
  const workspaceRoot = path.resolve(process.env.BORING_AGENT_WORKSPACE_ROOT?.trim() || process.cwd())
  const resolvedCompanyRoot = path.resolve(companyRoot)
  const relative = path.relative(workspaceRoot, resolvedCompanyRoot)
  return relative.startsWith('..') || path.isAbsolute(relative)
}

type BudgetDb = ReturnType<GovernanceMeteringOptions['getDb']>

export async function createGovernance(config: CoreConfig): Promise<CreateGovernanceResult> {
  const service = await buildGovernanceService({ config })
  // The database only exists after the host builds its server, so capture the
  // metering getDb closure and reuse it to serve the read-only usage route.
  // Any host that wires governance metering gets the usage-summary route for free.
  let usageDb: (() => BudgetDb) | undefined
  const getUsageReader = (): GovernanceUsageSpendReader | undefined => (
    usageDb
      ? new PostgresBudgetReservationStore(usageDb(), { eligibleLegacySources: GOVERNANCE_ELIGIBLE_LEGACY_SOURCES })
      : undefined
  )
  return {
    service,
    status: service.policyStatus(),
    serverPlugin: createGovernanceServerPlugin(service, { getUsageReader }),
    filterModels: createGovernanceModelFilter(service),
    createMeteringSink: (delegate, getDb) => {
      usageDb = getDb
      return createGovernanceMeteringSink({ service, delegate, getDb })
    },
    getFilesystemBindings: (options = {}) => createGovernanceFilesystemBindings(service, {
      ...options,
      resolveCompanyContextRoot: options.resolveCompanyContextRoot ?? createDefaultCompanyContextRootResolver(),
      allowAdminMutations: options.allowAdminMutations ?? defaultAdminMutationsAllowed(options),
    }),
    pi: { strictModelResolution: service.isEnabled() },
  }
}

function governanceUserFromRequest(request: FastifyRequest) {
  const user = request.user
  return user ? { id: user.id, email: user.email, emailVerified: user.emailVerified } : null
}

export function createGovernanceModelFilter(service: GovernanceService): RegisterAgentRoutesOptions['filterModels'] {
  return async ({ request }, models, defaultModel) => {
    const user = governanceUserFromRequest(request)
    if (!service.isEnabled()) return { models, defaultModel }
    if (!user) return { models: [] }
    const aggregateBudgetMicros = service.userMonthlyBudgetMicros(user)
    if (aggregateBudgetMicros !== null && aggregateBudgetMicros <= 0) return { models: [], defaultModel: undefined }
    const allowedModels = service
      .allowedModelsForUser(user, models)
      .filter((model) => (service.monthlyBudgetMicros(user, model) ?? 0) > 0)
    const allowedDefault = defaultModel && allowedModels.some((model) => (
      model.available && model.provider === defaultModel.provider && model.id === defaultModel.id
    ))
      ? defaultModel
      : undefined
    return { models: allowedModels, defaultModel: allowedDefault }
  }
}

export function createGovernanceServerPlugin(
  service: GovernanceService,
  options: { getUsageReader?: () => GovernanceUsageSpendReader | undefined } = {},
): CoreWorkspaceAgentServerPlugin {
  return {
    id: 'full-app-governance',
    label: 'Full-app governance',
    routes: async (app) => {
      await app.register(governanceRoutes(service, { getUsageReader: options.getUsageReader }))
      app.addHook('onReady', async () => {
        await reconcileCompanyContextWorkspace(app, service)
      })
    },
  }
}
