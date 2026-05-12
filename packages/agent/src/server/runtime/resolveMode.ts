import { spawnSync } from 'node:child_process'

import { getEnv } from '../config/env'
import type { BuiltinRuntimeModeId, RuntimeModeAdapter, RuntimeModeId } from './mode'
import { directModeAdapter } from './modes/direct'
import { localModeAdapter } from './modes/local'
import { vercelSandboxModeAdapter } from './modes/vercel-sandbox'

const MODE_ADAPTERS: Record<BuiltinRuntimeModeId, RuntimeModeAdapter> = {
  direct: directModeAdapter,
  local: localModeAdapter,
  'vercel-sandbox': vercelSandboxModeAdapter,
}

function isBuiltinRuntimeModeId(value: string): value is BuiltinRuntimeModeId {
  return value === 'direct' || value === 'local' || value === 'vercel-sandbox'
}

export function hasBwrap(): boolean {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

export function autoDetectMode(): RuntimeModeId {
  const explicitMode = getEnv('BORING_AGENT_MODE')
  if (explicitMode) {
    if (!isBuiltinRuntimeModeId(explicitMode)) {
      throw new Error(
        `Invalid BORING_AGENT_MODE "${explicitMode}". Expected direct, local, or vercel-sandbox.`,
      )
    }
    return explicitMode
  }

  if (process.platform === 'linux' && hasBwrap()) {
    return 'local'
  }
  return 'direct'
}

export function resolveMode(mode: RuntimeModeId = autoDetectMode()): RuntimeModeAdapter {
  if (isBuiltinRuntimeModeId(mode)) return MODE_ADAPTERS[mode]
  throw new Error(`Runtime mode "${mode}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`)
}
