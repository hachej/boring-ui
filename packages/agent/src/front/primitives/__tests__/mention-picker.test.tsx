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

  it('uses injected request plumbing for remote scoped file search', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: ['src/app.tsx'] }),
    })) as unknown as typeof globalThis.fetch

    render(
      <MentionPicker
        mention={{ query: 'app', anchorStart: 0, anchorEnd: 4 }}
        apiBaseUrl="https://agent.test/"
        fetch={fetchImpl}
        requestHeaders={{ authorization: 'Bearer token', empty: undefined }}
        storageScope="scope-b"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://agent.test/api/v1/files/search?q=*%5BAa%5D%5BPp%5D%5BPp%5D*&limit=8',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: {
            authorization: 'Bearer token',
          },
        }),
      )
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(await screen.findByText('src/app.tsx')).toBeTruthy()
  })

  it('does not duplicate an explicit storage-scope header with different casing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: ['src/scoped.ts'] }),
    })) as unknown as typeof globalThis.fetch

    render(
      <MentionPicker
        mention={{ query: 'scope', anchorStart: 0, anchorEnd: 6 }}
        fetch={fetchImpl}
        requestHeaders={{ 'X-Boring-Storage-Scope': 'explicit-scope' }}
        storageScope="prop-scope"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/v1/files/search?q=*%5BSs%5D%5BCc%5D%5BOo%5D%5BPp%5D%5BEe%5D*&limit=8',
        expect.objectContaining({
          headers: { 'X-Boring-Storage-Scope': 'explicit-scope' },
        }),
      )
    })
    expect(await screen.findByText('src/scoped.ts')).toBeTruthy()
  })
})
