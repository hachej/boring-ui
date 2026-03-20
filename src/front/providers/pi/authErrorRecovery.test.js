import { describe, it, expect, vi } from 'vitest'
import {
  buildApiKeyPromptMessage,
  isProviderAuthenticationError,
  recoverProviderAuthenticationError,
} from './authErrorRecovery'

describe('authErrorRecovery', () => {
  it('detects provider authentication failures from model error text', () => {
    expect(isProviderAuthenticationError('Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toBe(true)
    expect(isProviderAuthenticationError('Unauthorized request from provider')).toBe(true)
    expect(isProviderAuthenticationError('Rate limit exceeded')).toBe(false)
  })

  it('builds a retry prompt that asks for a replacement key', () => {
    expect(buildApiKeyPromptMessage('anthropic', { retry: true })).toContain('Saved Anthropic API key was rejected')
    expect(buildApiKeyPromptMessage('anthropic')).toContain('Enter Anthropic API key')
  })

  it('clears the saved key and re-prompts once on an auth error', async () => {
    const handledFailures = new Set()
    const runtime = {
      providerKeys: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    }
    const promptForKey = vi.fn().mockResolvedValue(true)
    const event = {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
        timestamp: 12345,
      },
    }
    const agent = {
      state: {
        model: {
          provider: 'anthropic',
        },
      },
    }

    await expect(recoverProviderAuthenticationError({
      event,
      agent,
      runtime,
      handledFailures,
      promptForKey,
    })).resolves.toBe(true)

    expect(runtime.providerKeys.delete).toHaveBeenCalledWith('anthropic')
    expect(promptForKey).toHaveBeenCalledWith(
      'anthropic',
      runtime,
      expect.objectContaining({ retry: true }),
    )

    await expect(recoverProviderAuthenticationError({
      event,
      agent,
      runtime,
      handledFailures,
      promptForKey,
    })).resolves.toBe(false)

    expect(runtime.providerKeys.delete).toHaveBeenCalledTimes(1)
    expect(promptForKey).toHaveBeenCalledTimes(1)
  })

  it('ignores non-auth assistant errors', async () => {
    const runtime = {
      providerKeys: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    }
    const promptForKey = vi.fn().mockResolvedValue(true)

    await expect(recoverProviderAuthenticationError({
      event: {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Rate limit exceeded',
          timestamp: 1,
        },
      },
      agent: { state: { model: { provider: 'anthropic' } } },
      runtime,
      handledFailures: new Set(),
      promptForKey,
    })).resolves.toBe(false)

    expect(runtime.providerKeys.delete).not.toHaveBeenCalled()
    expect(promptForKey).not.toHaveBeenCalled()
  })
})
