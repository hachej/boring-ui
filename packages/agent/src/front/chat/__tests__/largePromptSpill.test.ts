import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS,
  largePromptReference,
  prepareLargePromptSubmission,
} from '../largePromptSpill'

const context = {
  files: [],
  sessionId: 'session-1',
  source: 'composer' as const,
}

describe('prepareLargePromptSubmission', () => {
  it('leaves ordinary prompts inline', async () => {
    const upload = vi.fn()

    await expect(prepareLargePromptSubmission('short prompt', context, { upload })).resolves.toBeUndefined()
    expect(upload).not.toHaveBeenCalled()
  })

  it('stores oversized prompts through the attachment upload path and returns a compact reference', async () => {
    const upload = vi.fn(async (file: File) => {
      expect(file.name).toBe('composer-input-session-1.md')
      expect(file.type).toBe('text/markdown')
      expect(await file.text()).toBe('x'.repeat(20))
      return {
        path: 'assets/uploads/composer-input-mabc-123.md',
        url: '/api/v1/files/raw?path=assets%2Fuploads%2Fcomposer-input-mabc-123.md',
      }
    })

    await expect(prepareLargePromptSubmission('x'.repeat(20), context, {
      thresholdChars: 10,
      upload,
    })).resolves.toEqual(largePromptReference(
      'assets/uploads/composer-input-mabc-123.md',
      20,
    ))
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('lets a host policy handle the prompt before generic spilling', async () => {
    const upload = vi.fn()
    const handled = { handled: true as const, message: 'Stored by the host.' }

    await expect(prepareLargePromptSubmission('x'.repeat(20), context, {
      thresholdChars: 10,
      onBeforeSubmit: async () => handled,
      upload,
    })).resolves.toBe(handled)
    expect(upload).not.toHaveBeenCalled()
  })

  it('can be disabled by the host', async () => {
    const upload = vi.fn()

    await expect(prepareLargePromptSubmission('x'.repeat(DEFAULT_LARGE_PROMPT_THRESHOLD_CHARS + 1), context, {
      enabled: false,
      upload,
    })).resolves.toBeUndefined()
    expect(upload).not.toHaveBeenCalled()
  })
})
