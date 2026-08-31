import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS,
  LargePromptSpillCache,
  largePromptReference,
  spillLargePrompt,
} from '../largePromptSpill'

describe('spillLargePrompt', () => {
  it('leaves ordinary prompts inline', async () => {
    const upload = vi.fn()

    await expect(spillLargePrompt('short prompt', { sessionId: 'session-1', upload })).resolves.toBeUndefined()
    expect(upload).not.toHaveBeenCalled()
  })

  it('stores oversized final model text through the attachment upload path', async () => {
    const upload = vi.fn(async (file: File) => {
      expect(file.name).toBe('composer-input-session-1.md')
      expect(file.type).toBe('text/markdown')
      expect(await file.text()).toBe('x'.repeat(20))
      return {
        path: 'assets/uploads/composer-input-mabc-123.md',
        url: '/api/v1/files/raw?path=assets%2Fuploads%2Fcomposer-input-mabc-123.md',
      }
    })

    await expect(spillLargePrompt('x'.repeat(20), {
      sessionId: 'session-1',
      thresholdChars: 10,
      upload,
    })).resolves.toEqual(largePromptReference(
      'assets/uploads/composer-input-mabc-123.md',
      20,
    ))
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('reuses a successful workspace receipt when the same submission is retried', async () => {
    const cache = new LargePromptSpillCache()
    const upload = vi.fn(async () => ({ path: 'assets/uploads/prompt.md', url: '/raw/prompt.md' }))
    const options = { sessionId: 'session-1', thresholdChars: 10, cache, upload }

    await spillLargePrompt('x'.repeat(20), options)
    await spillLargePrompt('x'.repeat(20), options)

    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('does not reuse receipts across upload destinations', async () => {
    const cache = new LargePromptSpillCache()
    const upload = vi.fn(async () => ({ path: 'assets/uploads/prompt.md', url: '/raw/prompt.md' }))
    const shared = { sessionId: 'same-session', thresholdChars: 10, cache, upload }

    await spillLargePrompt('x'.repeat(20), { ...shared, destinationIdentity: 'workspace-a' })
    await spillLargePrompt('x'.repeat(20), { ...shared, destinationIdentity: 'workspace-b' })

    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('can be disabled by the host', async () => {
    const upload = vi.fn()

    await expect(spillLargePrompt('x'.repeat(DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS + 1), {
      sessionId: 'session-1',
      enabled: false,
      upload,
    })).resolves.toBeUndefined()
    expect(upload).not.toHaveBeenCalled()
  })
})
