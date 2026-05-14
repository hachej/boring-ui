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

  it.each([
    ['read', '*[Rr][Ee][Aa][Dd]*'],
    ['README', '*[Rr][Ee][Aa][Dd][Mm][Ee]*'],
    ['src/*.tsx', '[Ss][Rr][Cc]/*.[Tt][Ss][Xx]'],
  ])('uses workspace-compatible file-search glob semantics for %s', (query, glob) => {
    expect(mentionSearchGlob(query)).toBe(glob)
  })

  it('keeps bare @ suggestions broad for empty mention queries', () => {
    expect(mentionSearchGlob('')).toBe('*')
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
        '/api/v1/files/search?q=*%5BRr%5D%5BEe%5D%5BAa%5D%5BDd%5D*&limit=8',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(await screen.findByText('README.md')).toBeTruthy()
  })
})
