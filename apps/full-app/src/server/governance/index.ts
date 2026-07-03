import type { CoreConfig } from '@hachej/boring-core/shared'
import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import { loadGovernancePolicy, type LoadGovernancePolicyOptions } from './loadPolicy.js'
import { createGovernanceService, type GovernanceService } from './governanceService.js'
import { governanceRoutes } from './routes.js'

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

export interface BuildGovernanceOptions extends Omit<LoadGovernancePolicyOptions, 'config'> {
  config?: Pick<CoreConfig, 'auth'>
}

export async function buildGovernanceService(options: BuildGovernanceOptions = {}): Promise<GovernanceService> {
  return createGovernanceService(await loadGovernancePolicy(options))
}

export function createGovernanceServerPlugin(service: GovernanceService): CoreWorkspaceAgentServerPlugin {
  return {
    id: 'full-app-governance',
    label: 'Full-app governance',
    routes: governanceRoutes(service),
  }
}
