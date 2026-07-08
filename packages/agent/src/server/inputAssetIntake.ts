import type { ResolvedEnvironment } from '../shared/capabilities'
import type { AgentConfig, AgentSendInput } from '../shared/events'
import { AgentFilesystemRequiredError } from '../shared/events'

export type InputAssetIntakeDecision =
  | { strategy: 'writable-env-sink'; environmentId: string }
  | { strategy: 'provider-direct-asset' }
  | { strategy: 'stable-rejection'; reason: 'no-writable-env-sink' | 'ambiguous-writable-env-sink' }

export const LEGACY_WRITABLE_ENV_INPUT_ASSET_INTAKE: InputAssetIntakeDecision = {
  strategy: 'writable-env-sink',
  environmentId: 'legacy',
}

export function decideInputAssetIntake(
  config: Pick<AgentConfig, 'environments' | 'providerDirectInputAssets'>,
): InputAssetIntakeDecision {
  const sinks = inputAssetEnvironmentSinks(config.environments ?? [])
  if (sinks.length === 1) {
    return { strategy: 'writable-env-sink', environmentId: sinks[0].id }
  }
  if (sinks.length > 1) {
    const defaults = sinks.filter((env) => env.filesystem?.defaultInputAssetSink === true)
    if (defaults.length === 1) {
      return { strategy: 'writable-env-sink', environmentId: defaults[0].id }
    }
    return { strategy: 'stable-rejection', reason: 'ambiguous-writable-env-sink' }
  }
  if (config.providerDirectInputAssets === true) {
    return { strategy: 'provider-direct-asset' }
  }
  return { strategy: 'stable-rejection', reason: 'no-writable-env-sink' }
}

export function assertInputAssetsAccepted(
  decision: InputAssetIntakeDecision,
  payload: Pick<AgentSendInput, 'attachments'>,
): void {
  if (!payload.attachments || payload.attachments.length === 0) return
  if (decision.strategy !== 'stable-rejection') return
  throw new AgentFilesystemRequiredError(inputAssetRejectionMessage(decision))
}

function inputAssetEnvironmentSinks(environments: readonly ResolvedEnvironment[]): ResolvedEnvironment[] {
  return environments.filter((env) =>
    env.filesystem?.access === 'readwrite' &&
    env.filesystem.acceptsInputAssets === true,
  )
}

function inputAssetRejectionMessage(decision: Extract<InputAssetIntakeDecision, { strategy: 'stable-rejection' }>): string {
  if (decision.reason === 'ambiguous-writable-env-sink') {
    return 'Input assets require exactly one default writable environment sink.'
  }
  return 'Input assets require a writable environment sink.'
}
