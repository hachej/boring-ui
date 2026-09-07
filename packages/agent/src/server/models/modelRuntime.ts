import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from '@mariozechner/pi-coding-agent'
import { registerConfiguredModelProviders } from './modelConfig.js'

/**
 * Builds Boring Agent's Pi model runtime with Pi's normal file/environment
 * credential behavior. The optional overrides are a test seam and are not
 * supplied by production callers; a later slice can inject an actor-bound
 * CredentialStore through the same seam.
 */
export async function createConfiguredModelRuntime(
  options?: CreateModelRuntimeOptions,
): Promise<{
  modelRuntime: ModelRuntime
  configuredModels: ReturnType<typeof registerConfiguredModelProviders>
}> {
  const modelRuntime = await ModelRuntime.create(options)
  const configuredModels = registerConfiguredModelProviders(modelRuntime)
  // registerProvider queues an availability update. Await an explicit offline
  // refresh so callers can safely consume the synchronous snapshot.
  await modelRuntime.refresh({ allowNetwork: false })
  return { modelRuntime, configuredModels }
}
