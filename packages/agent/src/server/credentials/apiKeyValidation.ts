import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import { InMemoryCredentialStore, type CredentialStore } from '@earendil-works/pi-ai'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../shared/credentials'
import type { ProviderId } from '../../shared/credentials'

export const API_KEY_VALIDATION_TIMEOUT_MS_V1 = 10_000

export type ApiKeyValidationFailureV1 =
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'unsupported'

export interface ApiKeyProbeInputV1 {
  readonly providerId: ProviderId
  readonly credentials: CredentialStore
  readonly signal: AbortSignal
}

/** Injectable seam: tests provide a deterministic transport; production delegates to Pi. */
export interface ApiKeyProbeTransportV1 {
  probe(input: ApiKeyProbeInputV1): Promise<void>
}

export interface ApiKeyValidatorV1 {
  validate(providerId: ProviderId, apiKey: Uint8Array): Promise<void>
}

type StatusLikeError = { status?: unknown; statusCode?: unknown; name?: unknown }

function failureFrom(error: unknown, signal: AbortSignal): ApiKeyValidationFailureV1 {
  if (signal.aborted) return 'timeout'
  if (!error || typeof error !== 'object') return 'network'
  const safe = error as StatusLikeError
  const status = typeof safe.status === 'number'
    ? safe.status
    : typeof safe.statusCode === 'number'
      ? safe.statusCode
      : undefined
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (safe.name === 'AbortError') return 'timeout'
  return 'network'
}

function validationError(failure: ApiKeyValidationFailureV1): CredentialResolutionError {
  switch (failure) {
    case 'unauthorized':
      return new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.VALIDATION_UNAUTHORIZED,
        'API key validation failed',
      )
    case 'rate_limited':
      return new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.VALIDATION_RATE_LIMITED,
        'API key validation failed',
        { retryable: true },
      )
    case 'timeout':
      return new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.VALIDATION_TIMEOUT,
        'API key validation failed',
        { retryable: true },
      )
    case 'unsupported':
      return new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.VALIDATION_UNSUPPORTED,
        'API key validation failed',
      )
    case 'network':
      return new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.VALIDATION_UNAVAILABLE,
        'API key validation failed',
        { retryable: true },
      )
  }
}

/**
 * Pi-owned validation transport. Dynamic providers use their model-list refresh.
 * Static providers have no list probe, so only those trusted Pi definitions use
 * a one-output-token completion fallback. Provider errors/bodies are discarded.
 */
export const piApiKeyProbeTransportV1: ApiKeyProbeTransportV1 = Object.freeze({
  async probe({ providerId, credentials, signal }: ApiKeyProbeInputV1): Promise<void> {
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      refreshOnCreate: false,
      signal,
    })
    const provider = runtime.getProvider(providerId)
    if (!provider?.auth.apiKey) throw validationError('unsupported')

    if (provider.refreshModels) {
      const result = await runtime.refresh({
        providers: [providerId],
        force: true,
        signal,
      })
      if (result.aborted) throw validationError('timeout')
      const error = result.errors.get(providerId)
      if (error) throw error
      return
    }

    const model = runtime.getModels(providerId)[0]
    if (!model) throw validationError('unsupported')
    let responseStatus: number | undefined
    const response = await runtime.completeSimple(model, {
      messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
    }, {
      maxTokens: 1,
      maxRetries: 0,
      signal,
      onResponse: ({ status }) => { responseStatus = status },
    })
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      // Deliberately do not inspect or propagate errorMessage: it may contain a
      // provider response body or request details. HTTP status is metadata-only.
      if (response.stopReason === 'aborted') throw validationError('timeout')
      throw responseStatus === undefined
        ? validationError('network')
        : { status: responseStatus }
    }
  },
})

export function createApiKeyValidatorV1(options: Readonly<{
  transport?: ApiKeyProbeTransportV1
  timeoutMs?: number
}> = {}): ApiKeyValidatorV1 {
  const transport = options.transport ?? piApiKeyProbeTransportV1
  const timeoutMs = options.timeoutMs ?? API_KEY_VALIDATION_TIMEOUT_MS_V1
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > API_KEY_VALIDATION_TIMEOUT_MS_V1) {
    throw new Error('Invalid API key validation timeout')
  }

  return Object.freeze({
    async validate(providerId: ProviderId, apiKey: Uint8Array): Promise<void> {
      const key = new TextDecoder('utf-8', { fatal: true }).decode(apiKey)
      const credentials = new InMemoryCredentialStore()
      await credentials.modify(providerId, async () => ({ type: 'api_key', key }))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        await Promise.race([
          transport.probe({ providerId, credentials, signal: controller.signal }),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(
              validationError('timeout'),
            ), { once: true })
          }),
        ])
      } catch (error) {
        if (error instanceof CredentialResolutionError) throw error
        throw validationError(failureFrom(error, controller.signal))
      } finally {
        clearTimeout(timer)
        await credentials.delete(providerId).catch(() => undefined)
      }
    },
  })
}
