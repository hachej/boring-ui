import type { ModelRuntime } from '@mariozechner/pi-coding-agent'
import type { AgentSendInput } from '../../../shared/harness.js'
import { ErrorCode } from '../../../shared/error-codes.js'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials/errors.js'
import { readConfiguredDefaultModel } from '../../models/modelConfig.js'
import type { PiHarnessCredentialOperationLease } from './operationContextCoordinator.js'

export const OPERATION_SCOPED_MODEL_PROVIDER_ID = 'openai-codex'

export interface OperationScopedModelAvailabilityOptions {
  readonly strict?: boolean
  readonly enabled?: boolean
  readonly getOperationLease?: () => PiHarnessCredentialOperationLease | undefined
}

function modelUnavailableError(input: AgentSendInput): Error {
  return Object.assign(new Error('Requested model is not available.'), {
    statusCode: 400,
    code: ErrorCode.enum.TOOL_INVALID_INPUT,
    details: { provider: input.model?.provider, model: input.model?.id },
  })
}

/**
 * Removes personal Codex state from every synchronous view shared by one Pi
 * session. Actor-bound selection uses resolveOperationScopedModel() instead.
 */
export function makeSharedAvailabilityActorNeutral(modelRuntime: ModelRuntime): void {
  const getAvailableSnapshot = modelRuntime.getAvailableSnapshot.bind(modelRuntime)
  const hasConfiguredAuth = modelRuntime.hasConfiguredAuth.bind(modelRuntime)
  const isUsingOAuth = modelRuntime.isUsingOAuth.bind(modelRuntime)
  const isUsingSubscription = modelRuntime.isUsingSubscription.bind(modelRuntime)
  const getProviderAuthStatus = modelRuntime.getProviderAuthStatus.bind(modelRuntime)

  modelRuntime.getAvailableSnapshot = () => getAvailableSnapshot()
    .filter((model) => model.provider !== OPERATION_SCOPED_MODEL_PROVIDER_ID)
  modelRuntime.hasConfiguredAuth = (providerId) => providerId === OPERATION_SCOPED_MODEL_PROVIDER_ID
    ? false
    : hasConfiguredAuth(providerId)
  modelRuntime.isUsingOAuth = (providerId) => providerId === OPERATION_SCOPED_MODEL_PROVIDER_ID
    ? false
    : isUsingOAuth(providerId)
  modelRuntime.isUsingSubscription = (providerId) => providerId === OPERATION_SCOPED_MODEL_PROVIDER_ID
    ? false
    : isUsingSubscription(providerId)
  modelRuntime.getProviderAuthStatus = (providerId) => providerId === OPERATION_SCOPED_MODEL_PROVIDER_ID
    ? { configured: false }
    : getProviderAuthStatus(providerId)
}

export async function resolveOperationScopedModel(
  modelRuntime: ModelRuntime,
  input: AgentSendInput,
  options: OperationScopedModelAvailabilityOptions = {},
): Promise<ReturnType<ModelRuntime['getModel']>> {
  const requestedId = input.model?.id
  if (!input.model || !requestedId) return undefined

  const model = modelRuntime.getModel(input.model.provider, requestedId)
  let hasAuth = false
  if (model && options.enabled && model.provider === OPERATION_SCOPED_MODEL_PROVIDER_ID) {
    const lease = options.getOperationLease?.()
    if (!lease) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
        'model availability authority is missing or expired',
      )
    }
    lease.assertActive()
    const available = await modelRuntime.getAvailable(model.provider, { signal: lease.signal })
    lease.assertActive()
    hasAuth = available.some((candidate) =>
      candidate.provider === model.provider && candidate.id === model.id)
  } else if (model) {
    hasAuth = modelRuntime.getAvailableSnapshot().some((candidate) =>
      candidate.provider === model.provider && candidate.id === model.id)
  }

  if (!model || !hasAuth) {
    if (options.strict) throw modelUnavailableError(input)
    return undefined
  }
  return model
}

export async function resolveOperationScopedDefaultModel(
  modelRuntime: ModelRuntime,
  override: { provider: string; id: string } | undefined,
  options: OperationScopedModelAvailabilityOptions = {},
): Promise<ReturnType<ModelRuntime['getModel']>> {
  const configured = override ?? readConfiguredDefaultModel()
  if (!configured) return undefined
  return resolveOperationScopedModel(modelRuntime, { model: configured }, {
    ...options,
    // A stale user/global Pi default must not prevent an unconnected actor
    // from opening the shared session. Explicit host overrides remain strict.
    strict: override ? options.strict : false,
  })
}
