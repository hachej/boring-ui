import {
  REMOTE_WORKER_ERROR_CODES_V1,
} from '../shared/remoteWorkerProtocolV1'
import {
  SandboxProviderError,
  type SandboxRuntimeModeIdV1,
  type SandboxProviderV1,
} from '../shared/providerV1'
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
import {
  createRemoteWorkerSandboxProviderV1,
  type RemoteWorkerSandboxProviderOptionsV1,
} from './remote-worker/createRemoteWorkerProvider'

export interface StaticSandboxProviderOptionsV1 {
  direct?: DirectSandboxProviderOptions
  bwrap?: BwrapSandboxProviderOptions
  vercelSandbox?: VercelSandboxProviderOptions
  remoteWorker?: RemoteWorkerSandboxProviderOptionsV1
}

export type StaticSandboxProvidersV1 = Readonly<{
  direct: SandboxProviderV1
  local: SandboxProviderV1
  'vercel-sandbox': SandboxProviderV1
  'remote-worker'?: SandboxProviderV1
}>

export function createStaticSandboxProvidersV1(
  options: StaticSandboxProviderOptionsV1 = {},
): StaticSandboxProvidersV1 {
  const providers: StaticSandboxProvidersV1 = Object.freeze({
    direct: createDirectSandboxProvider(options.direct),
    local: createBwrapSandboxProvider(options.bwrap),
    'vercel-sandbox': createVercelSandboxProvider(options.vercelSandbox),
    ...(options.remoteWorker
      ? { 'remote-worker': createRemoteWorkerSandboxProviderV1(options.remoteWorker) }
      : {}),
  })
  return providers
}

export function resolveStaticSandboxProviderV1(
  mode: SandboxRuntimeModeIdV1,
  providers: StaticSandboxProvidersV1,
): SandboxProviderV1 {
  const provider = providers[mode]
  if (!provider) {
    throw new SandboxProviderError(
      REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
      `Runtime mode "${mode}" is not configured`,
    )
  }
  return provider
}
