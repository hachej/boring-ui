import type { FastifyRequest } from 'fastify'
import type { RegisterAgentRoutesOptions } from '@hachej/boring-agent/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import { loadGovernancePolicy, type LoadGovernancePolicyOptions } from './loadPolicy.js'
import { createGovernanceService, type GovernanceService } from './governanceService.js'
import { governanceRoutes } from './routes.js'
import { reconcileCompanyContextWorkspace } from './companyContextBootstrap.js'

export { GovernancePolicyError, GovernanceService } from './governanceService.js'
export type { GovernanceMeResponse } from './governanceService.js'
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
export { createDefaultCompanyContextRootResolver, createGovernanceFilesystemBindings } from './filesystemBindings.js'

export interface BuildGovernanceOptions extends Omit<LoadGovernancePolicyOptions, 'config'> {
  config?: Pick<CoreConfig, 'auth'>
}

export async function buildGovernanceService(options: BuildGovernanceOptions = {}): Promise<GovernanceService> {
  return createGovernanceService(await loadGovernancePolicy(options))
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

export function createGovernanceServerPlugin(service: GovernanceService): CoreWorkspaceAgentServerPlugin {
  return {
    id: 'full-app-governance',
    label: 'Full-app governance',
    routes: async (app) => {
      await app.register(governanceRoutes(service))
      app.addHook('onReady', async () => {
        await reconcileCompanyContextWorkspace(app, service)
      })
    },
  }
}
