import { getEnv } from '../config/env'
import type { SandboxHandleStore } from '@hachej/boring-sandbox/providers/vercel-sandbox'
import {
  autoDetectRuntimeMode,
  isBuiltinRuntimeModeId,
} from '@hachej/boring-sandbox/runtime-mode'
import type { BuiltinRuntimeModeId, RuntimeModeAdapter, RuntimeModeId } from './mode'
import { directModeAdapter } from './modes/direct'
import { localModeAdapter } from './modes/local'
import { createVercelSandboxModeAdapter, vercelSandboxModeAdapter } from './modes/vercel-sandbox'

export { hasBwrap } from '@hachej/boring-sandbox/runtime-mode'

const MODE_ADAPTERS: Record<BuiltinRuntimeModeId, RuntimeModeAdapter> = {
  direct: directModeAdapter,
  local: localModeAdapter,
  'vercel-sandbox': vercelSandboxModeAdapter,
}

export function autoDetectMode(): RuntimeModeId {
  return autoDetectRuntimeMode({ explicitMode: getEnv('BORING_AGENT_MODE') })
}

export interface ResolveModeOptions {
  sandboxHandleStore?: SandboxHandleStore
}

export function resolveMode(mode: RuntimeModeId = autoDetectMode(), opts: ResolveModeOptions = {}): RuntimeModeAdapter {
  if (mode === 'vercel-sandbox' && opts.sandboxHandleStore) {
    return createVercelSandboxModeAdapter({
      store: opts.sandboxHandleStore,
      orphanGuardMaxIdleMs: null,
    })
  }
  if (isBuiltinRuntimeModeId(mode)) return MODE_ADAPTERS[mode]
  throw new Error(`Runtime mode "${mode}" has no built-in adapter. Pass runtimeModeAdapter to use a custom sandbox mode.`)
}
