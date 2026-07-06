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

  it('selects the first available model when the server omits a denied default', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { provider: 'infomaniak', id: 'allowed', label: 'Allowed', available: true },
      ],
    }))) as unknown as typeof fetch

    const store = storage()
    const { result } = renderHook(() => useChatModelSelection({
      storageScope: 'scope-a',
      storage: store,
      fetch: fetchImpl,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.model).toEqual({ provider: 'infomaniak', id: 'allowed' })
  })

  it('fails closed during a scope change before current discovery completes', async () => {
    let resolveSecond: ((response: Response) => void) | undefined
    let callCount = 0
    const fetchImpl = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response(JSON.stringify({
          models: [{ provider: 'anthropic', id: 'allowed-a', label: 'Allowed A', available: true }],
        }))
      }
      return new Promise<Response>((resolve) => { resolveSecond = resolve })
    }) as unknown as typeof fetch
    const store = storage()

    const { result, rerender } = renderHook(
      ({ scope }) => useChatModelSelection({ storageScope: scope, storage: store, fetch: fetchImpl, enabled: true }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.model).toEqual({ provider: 'anthropic', id: 'allowed-a' }))
    rerender({ scope: 'scope-b' })

    expect(result.current.loaded).toBe(false)
    expect(result.current.availableModels).toEqual([])
    expect(result.current.model).toBeNull()

    act(() => {
      resolveSecond?.(new Response(JSON.stringify({
        models: [{ provider: 'anthropic', id: 'allowed-b', label: 'Allowed B', available: true }],
      })))
    })
    await waitFor(() => expect(result.current.model).toEqual({ provider: 'anthropic', id: 'allowed-b' }))
  })

  it('clears stale/default selection and stale options when authoritative discovery fails', async () => {
    const staleModel = { provider: 'anthropic', id: 'stale' } as const
    const responses: Array<() => Promise<Response>> = [
      async () => new Response(JSON.stringify({
        models: [{ provider: 'anthropic', id: 'stale', label: 'Stale', available: true }],
      })),
      async () => { throw new Error('offline') },
    ]
    const fetchImpl = vi.fn(async () => responses.shift()?.() ?? new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch
    const store = storage()

    const { result, rerender } = renderHook(
      ({ scope }) => useChatModelSelection({
        defaultModel: staleModel,
        storageScope: scope,
        storage: store,
        fetch: fetchImpl,
        enabled: true,
      }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.availableModels).toHaveLength(1))
    expect(result.current.model).toEqual(staleModel)

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.model).toBeNull())
    expect(result.current.availableModels).toEqual([])
    expect(readPiComposerSettings({ storageScope: 'scope-b', storage: store }).model).toBeNull()
  })

  it('marks discovery loaded with no selection when no models are available', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch

    const store = storage()
    const { result } = renderHook(() => useChatModelSelection({
      storageScope: 'scope-a',
      storage: store,
      fetch: fetchImpl,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.availableModels).toEqual([])
    expect(result.current.model).toBeNull()
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
