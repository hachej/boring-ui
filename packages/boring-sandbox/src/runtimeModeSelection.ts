import { spawnSync } from 'node:child_process'

import { MODE_TO_PROVIDER, type RuntimeModeId, type SandboxProviderId } from './shared/providerMatrix'

export const BUILTIN_RUNTIME_MODE_IDS = [
  'direct',
  'local',
  'vercel-sandbox',
] as const satisfies readonly RuntimeModeId[]

export type BuiltinRuntimeModeId = typeof BUILTIN_RUNTIME_MODE_IDS[number]

export const BUILTIN_MODE_TO_PROVIDER = Object.fromEntries(
  BUILTIN_RUNTIME_MODE_IDS.map((mode) => [mode, MODE_TO_PROVIDER[mode]]),
) as Record<BuiltinRuntimeModeId, SandboxProviderId>

export function isRuntimeModeId(value: string): value is RuntimeModeId {
  return Object.hasOwn(MODE_TO_PROVIDER, value)
}

export function providerForRuntimeMode(mode: RuntimeModeId): SandboxProviderId {
  return MODE_TO_PROVIDER[mode]
}

export function isBuiltinRuntimeModeId(value: string): value is BuiltinRuntimeModeId {
  return Object.hasOwn(BUILTIN_MODE_TO_PROVIDER, value)
}

export function formatBuiltinRuntimeModeIds(): string {
  return BUILTIN_RUNTIME_MODE_IDS.join(', ')
}

export function hasBwrap(): boolean {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

export interface AutoDetectRuntimeModeOptions {
  explicitMode?: string
  platform?: NodeJS.Platform
  hasBwrap?: () => boolean
}

export function autoDetectRuntimeMode(opts: AutoDetectRuntimeModeOptions = {}): BuiltinRuntimeModeId {
  const rawExplicitMode = opts.explicitMode
  if (rawExplicitMode) {
    const explicitMode = rawExplicitMode.trim()
    if (!explicitMode || !isBuiltinRuntimeModeId(explicitMode)) {
      throw new Error(
        `Invalid BORING_AGENT_MODE "${rawExplicitMode}". Expected ${formatBuiltinRuntimeModeIds()}.`,
      )
    }
    return explicitMode
  }

  const platform = opts.platform ?? process.platform
  const detectBwrap = opts.hasBwrap ?? hasBwrap
  if (platform === 'linux' && detectBwrap()) {
    return 'local'
  }
  return 'direct'
}
