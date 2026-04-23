import { spawnSync } from 'node:child_process'

import { getEnv } from '../config/env'
import type { RuntimeModeAdapter, RuntimeModeId } from './mode'
import { directModeAdapter } from './modes/direct'
import { localModeAdapter } from './modes/local'
import { vercelSandboxModeAdapter } from './modes/vercel-sandbox'

const MODE_ADAPTERS: Record<RuntimeModeId, RuntimeModeAdapter> = {
  direct: directModeAdapter,
  local: localModeAdapter,
  'vercel-sandbox': vercelSandboxModeAdapter,
}

function isRuntimeModeId(value: string): value is RuntimeModeId {
  return value === 'direct' || value === 'local' || value === 'vercel-sandbox'
}

export function hasBwrap(): boolean {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

export function autoDetectMode(): RuntimeModeId {
  const explicitMode = getEnv('BORING_AGENT_MODE')
  if (explicitMode) {
    if (!isRuntimeModeId(explicitMode)) {
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
  return MODE_ADAPTERS[mode]
}
