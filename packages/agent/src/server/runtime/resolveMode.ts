import { spawnSync } from 'node:child_process'

import { getEnv } from '../config/env'
import type { BuiltinRuntimeModeId, RuntimeModeAdapter, RuntimeModeId } from './mode'

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

export interface ResolveModeOptions {
  adapters?: Readonly<Record<BuiltinRuntimeModeId, RuntimeModeAdapter>>
}

export function resolveMode(mode: RuntimeModeId = autoDetectMode(), opts: ResolveModeOptions = {}): RuntimeModeAdapter {
  if (isBuiltinRuntimeModeId(mode) && opts.adapters) return opts.adapters[mode]
  if (isBuiltinRuntimeModeId(mode)) {
    throw new Error(`Runtime mode "${mode}" requires a host-injected runtimeModeAdapter.`)
  }
  throw new Error(`Runtime mode "${mode}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`)
}
