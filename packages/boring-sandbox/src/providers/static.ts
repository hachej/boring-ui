import type { SandboxRuntimeModeIdV1, SandboxProviderV1 } from '../shared/providerV1'
import {
  createBwrapSandboxProvider,
  type BwrapSandboxProviderOptions,
} from './bwrap/createBwrapProvider'
import {
  createDirectSandboxProvider,
  type DirectSandboxProviderOptions,
} from './direct/createDirectProvider'
import {
  createVercelSandboxProvider,
  type VercelSandboxProviderOptions,
} from './vercel-sandbox/createVercelSandboxProvider'

export interface StaticSandboxProviderOptionsV1 {
  direct?: DirectSandboxProviderOptions
  bwrap?: BwrapSandboxProviderOptions
  vercelSandbox?: VercelSandboxProviderOptions
}

export type StaticSandboxProvidersV1 = Readonly<{
  direct: SandboxProviderV1
  local: SandboxProviderV1
  'vercel-sandbox': SandboxProviderV1
}>

export function createStaticSandboxProvidersV1(
  options: StaticSandboxProviderOptionsV1 = {},
): StaticSandboxProvidersV1 {
  return Object.freeze({
    direct: createDirectSandboxProvider(options.direct),
    local: createBwrapSandboxProvider(options.bwrap),
    'vercel-sandbox': createVercelSandboxProvider(options.vercelSandbox),
  })
}

export function resolveStaticSandboxProviderV1(
  mode: SandboxRuntimeModeIdV1,
  providers: StaticSandboxProvidersV1,
): SandboxProviderV1 {
  return providers[mode]
}
