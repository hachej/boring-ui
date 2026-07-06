import { readFile, stat } from 'node:fs/promises'
import { parse } from 'yaml'
import { isCoreEmailVerificationEnabled, type CoreConfig } from '@hachej/boring-core/shared'
import type { GovernanceLoadResult } from './policyTypes.js'
import { validateGovernancePolicy } from './validatePolicy.js'

const MAX_POLICY_BYTES = 256 * 1024
export const GOVERNANCE_POLICY_PATH_ENV = 'BORING_GOVERNANCE_POLICY_PATH'
export const GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV = 'BORING_GOVERNANCE_ALLOW_UNVERIFIED_EMAIL_DEV'

export interface LoadGovernancePolicyOptions {
  env?: NodeJS.ProcessEnv
  nodeEnv?: string
  config?: Pick<CoreConfig, 'auth'>
}

function invalidResult(path: string, error: unknown): GovernanceLoadResult {
  return {
    enabled: true,
    policy: null,
    status: {
      state: 'invalid',
      path,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function shouldAllowDevEmailVerificationOverride(env: NodeJS.ProcessEnv, nodeEnv: string): boolean {
  return nodeEnv !== 'production' && env[GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV] === '1'
}

export async function loadGovernancePolicy({
  env = process.env,
  nodeEnv = process.env['NODE_ENV'] ?? 'development',
  config,
}: LoadGovernancePolicyOptions = {}): Promise<GovernanceLoadResult> {
  const configuredPath = env[GOVERNANCE_POLICY_PATH_ENV]?.trim()
  if (!configuredPath) {
    return {
      enabled: false,
      policy: null,
      status: { state: 'disabled', reason: 'missing-env', path: null },
    }
  }

  let fileStat
  try {
    fileStat = await stat(configuredPath)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') {
      return {
        enabled: false,
        policy: null,
        status: { state: 'disabled', reason: 'missing-file', path: configuredPath },
      }
    }
    throw error
  }

  if (fileStat.size > MAX_POLICY_BYTES) {
    const result = invalidResult(configuredPath, new Error(`policy file exceeds ${MAX_POLICY_BYTES} bytes`))
    if (nodeEnv === 'production') throw new Error(result.status.state === 'invalid' ? result.status.message : 'invalid governance policy')
    return result
  }

  try {
    if (config && !isCoreEmailVerificationEnabled(config) && !shouldAllowDevEmailVerificationOverride(env, nodeEnv)) {
      throw new Error(
        `governance requires email verification; configure mail or set ${GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV}=1 outside production`,
      )
    }
    const raw = await readFile(configuredPath, 'utf8')
    const parsed = parse(raw)
    const policy = validateGovernancePolicy(parsed)
    return {
      enabled: true,
      policy,
      status: {
        state: 'active',
        path: configuredPath,
        tenantId: policy.tenant.id,
        userCount: policy.users.length,
      },
    }
  } catch (error) {
    const result = invalidResult(configuredPath, error)
    if (nodeEnv === 'production') throw new Error(result.status.state === 'invalid' ? result.status.message : 'invalid governance policy')
    return result
  }
}
