// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MentionPicker, mentionSearchGlob } from '../mention-picker'

describe('MentionPicker', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: ['README.md'] }),
    })))
  })

  it('wraps typed mention queries as basename globs so server search filters by partial typing', () => {
    expect(mentionSearchGlob('read')).toBe('*read*')
    expect(mentionSearchGlob('')).toBe('*')
    expect(mentionSearchGlob('*?')).toBe('*')
  })

  it('requests filtered file results as the user types after @', async () => {
    render(
      <MentionPicker
        mention={{ query: 'read', anchorStart: 0, anchorEnd: 5 }}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/files/search?q=*read*&limit=8',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(await screen.findByText('README.md')).toBeTruthy()
  })
})
