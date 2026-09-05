import { ModelRuntime } from '@mariozechner/pi-coding-agent'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { describe, expect, test, vi } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
} from '../../../shared/credentials'
import type { ProviderId } from '../../../shared/credentials'
import {
  createApiKeyValidatorV1,
  piApiKeyProbeTransportV1,
} from '../apiKeyValidation'
import type { ApiKeyProbeTransportV1 } from '../apiKeyValidation'

const PROVIDER = 'anthropic' as ProviderId

function statusError(status: number, secret: string): Error & { status: number } {
  return Object.assign(new Error(`provider body contained ${secret}`), { status })
}

describe('API key validation', () => {
  test('uses a provider request, not Pi remote-catalog refresh, for static providers', async () => {
    const refresh = vi.fn(async () => ({ aborted: false, errors: new Map() }))
    const completeSimple = vi.fn(async () => ({ stopReason: 'stop' }))
    const staticModel = { provider: PROVIDER, id: 'model-a' }
    const create = vi.spyOn(ModelRuntime, 'create').mockResolvedValue({
      getProvider: () => ({ auth: { apiKey: {} }, refreshModels: vi.fn() }),
      getModels: () => [staticModel],
      refresh,
      completeSimple,
    } as unknown as ModelRuntime)
    try {
      await piApiKeyProbeTransportV1.probe({
        providerId: PROVIDER,
        credentials: new InMemoryCredentialStore(),
        signal: new AbortController().signal,
      })
      expect(refresh).not.toHaveBeenCalled()
      expect(completeSimple).toHaveBeenCalledOnce()
      expect(completeSimple).toHaveBeenCalledWith(staticModel, expect.anything(), expect.objectContaining({
        maxTokens: 1,
        maxRetries: 0,
      }))
    } finally {
      create.mockRestore()
    }
  })

  test('uses a throwaway in-memory Pi credential store and removes material after success', async () => {
    let capturedStore: Parameters<ApiKeyProbeTransportV1['probe']>[0]['credentials'] | undefined
    const probe = vi.fn<ApiKeyProbeTransportV1['probe']>(async ({ providerId, credentials }) => {
      capturedStore = credentials
      expect(await credentials.read(providerId)).toEqual({ type: 'api_key', key: 'secret-canary' })
    })
    const validator = createApiKeyValidatorV1({ transport: { probe } })

    await validator.validate(PROVIDER, new TextEncoder().encode('secret-canary'))

    expect(probe).toHaveBeenCalledOnce()
    await expect(capturedStore!.read(PROVIDER)).resolves.toBeUndefined()
  })

  test.each([
    [401, CREDENTIAL_ERROR_CODES.VALIDATION_UNAUTHORIZED, false],
    [403, CREDENTIAL_ERROR_CODES.VALIDATION_UNAUTHORIZED, false],
    [429, CREDENTIAL_ERROR_CODES.VALIDATION_RATE_LIMITED, true],
    [503, CREDENTIAL_ERROR_CODES.VALIDATION_UNAVAILABLE, true],
  ] as const)('maps provider status %s to a stable redacted failure', async (status, code, retryable) => {
    const secret = `secret-canary-${status}`
    const validator = createApiKeyValidatorV1({
      transport: { probe: async () => { throw statusError(status, secret) } },
    })

    const result = await validator.validate(PROVIDER, new TextEncoder().encode(secret))
      .then(() => undefined, (error: unknown) => error)

    expect(result).toMatchObject({ code, message: 'API key validation failed', retryable })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test('aborts at the bounded timeout and returns no transport detail', async () => {
    const secret = 'timeout-secret-canary'
    const validator = createApiKeyValidatorV1({
      timeoutMs: 5,
      transport: {
        probe: ({ signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(statusError(503, secret)), { once: true })
        }),
      },
    })

    const result = await validator.validate(PROVIDER, new TextEncoder().encode(secret))
      .then(() => undefined, (error: unknown) => error)

    expect(result).toMatchObject({
      code: CREDENTIAL_ERROR_CODES.VALIDATION_TIMEOUT,
      message: 'API key validation failed',
      retryable: true,
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
