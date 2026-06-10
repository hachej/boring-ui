// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readPiComposerSettings, type ActiveSessionStorageLike } from '../../chat/session'
import { useChatModelSelection } from '../useChatModelSelection'

function storage(initial: Record<string, string> = {}): ActiveSessionStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('useChatModelSelection', () => {
  it('does not persist a previous scope selection into a new storage scope', async () => {
    const store = storage()
    const selected = { provider: 'anthropic', id: 'claude-sonnet' } as const
    const { result, rerender } = renderHook(
      ({ scope }) => useChatModelSelection({ storageScope: scope, storage: store, enabled: false }),
      { initialProps: { scope: 'scope-a' } },
    )

    act(() => result.current.setModel(selected))

    await waitFor(() => {
      expect(readPiComposerSettings({ storageScope: 'scope-a', storage: store }).model).toEqual(selected)
    })

    rerender({ scope: 'scope-b' })

    await waitFor(() => expect(result.current.model).toBeNull())
    expect(readPiComposerSettings({ storageScope: 'scope-b', storage: store }).model).toBeNull()
  })

  it('clears a user-selected model override back to Pi default', async () => {
    const store = storage()
    const selected = { provider: 'anthropic', id: 'claude-sonnet' } as const
    const { result } = renderHook(() => useChatModelSelection({ storageScope: 'scope-a', storage: store, enabled: false }))

    act(() => result.current.setModel(selected))
    await waitFor(() => expect(readPiComposerSettings({ storageScope: 'scope-a', storage: store }).model).toEqual(selected))

    act(() => result.current.setModel(null))

    await waitFor(() => expect(result.current.model).toBeNull())
    expect(readPiComposerSettings({ storageScope: 'scope-a', storage: store }).model).toBeNull()
    expect(readPiComposerSettings({ storageScope: 'scope-a', storage: store }).userSelectedModel).toBe(false)
  })
})
