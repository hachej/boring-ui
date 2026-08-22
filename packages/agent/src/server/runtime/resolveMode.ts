import { spawnSync } from 'node:child_process'

import { getEnv } from '../config/env'
import {
  BUILTIN_RUNTIME_MODE_IDS,
  isBuiltinRuntimeModeId,
} from '../../shared/runtime-mode'
import type { BuiltinRuntimeModeId, RuntimeModeAdapter, RuntimeModeId } from './mode'

function describeBuiltinRuntimeModeIds(): string {
  const initialIds = BUILTIN_RUNTIME_MODE_IDS.slice(0, -1)
  return `${initialIds.join(', ')}, or ${BUILTIN_RUNTIME_MODE_IDS.at(-1)}`
}

export function hasBwrap(): boolean {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

export function autoDetectMode(): BuiltinRuntimeModeId {
  const explicitMode = getEnv('BORING_AGENT_MODE')
  if (explicitMode) {
    if (!isBuiltinRuntimeModeId(explicitMode)) {
      throw new Error(
        `Invalid BORING_AGENT_MODE "${explicitMode}". Expected ${describeBuiltinRuntimeModeIds()}.`,
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
  adapters?: Readonly<Record<string, RuntimeModeAdapter>>
}

export function resolveMode(mode: RuntimeModeId = autoDetectMode(), opts: ResolveModeOptions = {}): RuntimeModeAdapter {
  if (isBuiltinRuntimeModeId(mode) && opts.adapters?.[mode]) return opts.adapters[mode]
  if (isBuiltinRuntimeModeId(mode)) {
    throw new Error(`Runtime mode "${mode}" requires a host-injected runtimeModeAdapter.`)
  }
  throw new Error(`Runtime mode "${mode}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`)
}
