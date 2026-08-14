import type { SandboxHandleStore } from '@hachej/boring-agent/shared'

import type { SandboxLifecycle } from './client'
import type { BlaxelClient } from './client'
import { SandboxProviderError } from '../../shared/providerV1'

export const BLAXEL_WORKSPACE_ROOT = '/workspace' as const
export const BLAXEL_DEFAULT_IMAGE = 'blaxel/base-image:latest'
export const BLAXEL_DEFAULT_MEMORY_MB = 4096
export const BLAXEL_DEFAULT_VOLUME_SIZE_MB = 2048

export interface BlaxelSandboxProviderOptions {
  image?: string
  memoryMb?: number
  region?: string
  ttl?: string
  lifecycle?: SandboxLifecycle
  volume?: { enabled: boolean; sizeMb: number }
  workspaceRoot?: typeof BLAXEL_WORKSPACE_ROOT
  handleStore?: SandboxHandleStore
  client?: BlaxelClient
  now?: () => Date
}

export interface ResolvedBlaxelConfig {
  image: string
  memoryMb: number
  region: string
  ttl?: string
  lifecycle?: SandboxLifecycle
  volume: { enabled: boolean; sizeMb: number }
  workspaceRoot: typeof BLAXEL_WORKSPACE_ROOT
}

function positiveInteger(value: string | number | undefined, fallback: number, name: string, max = 1_048_576): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new SandboxProviderError('CONFIG_INVALID', `${name} must be a positive integer no greater than ${max}`)
  }
  return parsed
}

function optionalLifecycleFromEnv(env: NodeJS.ProcessEnv): SandboxLifecycle | undefined {
  const expirationPolicies: NonNullable<SandboxLifecycle['expirationPolicies']> = []
  if (env.BORING_BLAXEL_IDLE_TTL?.trim()) {
    if (/[\r\n\0]/.test(env.BORING_BLAXEL_IDLE_TTL)) {
      throw new SandboxProviderError('CONFIG_INVALID', 'BORING_BLAXEL_IDLE_TTL is invalid')
    }
    expirationPolicies.push({
      action: 'delete',
      type: 'ttl-idle',
      value: env.BORING_BLAXEL_IDLE_TTL.trim(),
    })
  }
  const terminatedRetention = env.BORING_BLAXEL_TERMINATED_RETENTION?.trim()
  if (terminatedRetention && /[\r\n\0]/.test(terminatedRetention)) {
    throw new SandboxProviderError('CONFIG_INVALID', 'BORING_BLAXEL_TERMINATED_RETENTION is invalid')
  }
  if (expirationPolicies.length === 0 && !terminatedRetention) return undefined
  return {
    ...(expirationPolicies.length > 0 ? { expirationPolicies } : {}),
    ...(terminatedRetention ? { terminatedRetention } : {}),
  }
}

export function resolveBlaxelConfig(
  options: BlaxelSandboxProviderOptions,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBlaxelConfig {
  const volume = options.volume ?? {
    enabled: true,
    sizeMb: positiveInteger(
      env.BORING_BLAXEL_VOLUME_SIZE_MB,
      BLAXEL_DEFAULT_VOLUME_SIZE_MB,
      'BORING_BLAXEL_VOLUME_SIZE_MB',
    ),
  }
  const region = options.region?.trim() ?? env.BORING_BLAXEL_REGION?.trim() ?? ''
  if (!region) {
    throw new SandboxProviderError(
      'CONFIG_INVALID',
      'BORING_BLAXEL_REGION is required for blaxel mode',
    )
  }
  if (!/^[a-z]{2}-[a-z0-9]+-[0-9]+$/.test(region)) {
    throw new SandboxProviderError('CONFIG_INVALID', 'BORING_BLAXEL_REGION has invalid syntax')
  }
  if (!region.startsWith('eu-')) {
    throw new SandboxProviderError(
      'CONFIG_INVALID',
      'BORING_BLAXEL_REGION must select an EU region for sovereign blaxel mode',
    )
  }

  const image = options.image?.trim() ?? env.BORING_BLAXEL_IMAGE?.trim() ?? BLAXEL_DEFAULT_IMAGE
  if (!image || /[\r\n\0]/.test(image)) {
    throw new SandboxProviderError('CONFIG_INVALID', 'BORING_BLAXEL_IMAGE is invalid')
  }

  const ttl = options.ttl ?? env.BORING_BLAXEL_TTL?.trim()
  if (ttl && /[\r\n\0]/.test(ttl)) {
    throw new SandboxProviderError('CONFIG_INVALID', 'BORING_BLAXEL_TTL is invalid')
  }
  const lifecycle = options.lifecycle ?? optionalLifecycleFromEnv(env)

  return {
    image,
    memoryMb: positiveInteger(
      options.memoryMb ?? env.BORING_BLAXEL_MEMORY_MB,
      BLAXEL_DEFAULT_MEMORY_MB,
      'BORING_BLAXEL_MEMORY_MB',
      65_536,
    ),
    region,
    ...(ttl ? { ttl } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    volume: {
      enabled: volume.enabled,
      sizeMb: positiveInteger(volume.sizeMb, BLAXEL_DEFAULT_VOLUME_SIZE_MB, 'Blaxel volume size'),
    },
    workspaceRoot: options.workspaceRoot ?? BLAXEL_WORKSPACE_ROOT,
  }
}

export function assertBlaxelCredentials(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.BL_WORKSPACE?.trim()) {
    throw new SandboxProviderError('BLAXEL_AUTH_FAILED', 'BL_WORKSPACE is required for blaxel mode')
  }
  if (!env.BL_API_KEY?.trim()) {
    throw new SandboxProviderError('BLAXEL_AUTH_FAILED', 'BL_API_KEY is required for blaxel mode')
  }
}
