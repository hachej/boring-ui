// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readPiComposerSettings, scopedComposerStorageKey, type ActiveSessionStorageLike } from '../../chat/session'
import type { ModelSelection } from '../../chatPanelSettings'
import { useChatModelSelection as useAddressedChatModelSelection } from '../useChatModelSelection'

function useChatModelSelection(options: Omit<Parameters<typeof useAddressedChatModelSelection>[0], 'agentTypeId'> & { agentTypeId?: string }) {
  return useAddressedChatModelSelection({ agentTypeId: 'default', ...options })
}

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

  it('uses addressed session model instead of conflicting browser storage for an existing session', async () => {
    const stale = { provider: 'infomaniak', id: 'Kimi-K2.6' } as const
    const currentModel = { provider: 'openai-codex', id: 'gpt-5.6-sol' } as const
    const store = storage({
      [scopedComposerStorageKey('scope-a', 'model')]: JSON.stringify(stale),
      [scopedComposerStorageKey('scope-a', 'model:user-selected')]: '1',
    })

    const { result } = renderHook(() => useChatModelSelection({
      sessionId: 'api-created',
      sessionHydrated: true,
      sessionModel: currentModel,
      storageScope: 'scope-a',
      storage: store,
      enabled: false,
    }))

    await waitFor(() => expect(result.current.model).toEqual(currentModel))
    expect(result.current.sessionModel).toEqual(currentModel)
    expect(result.current.isOverride).toBe(false)
  })

  it('uses local storage only as the default for a genuinely new session', async () => {
    const localDefault = { provider: 'openai', id: 'gpt-new-default' } as const
    const store = storage({
      [scopedComposerStorageKey('scope-a', 'model')]: JSON.stringify(localDefault),
      [scopedComposerStorageKey('scope-a', 'model:user-selected')]: '1',
    })

    const { result } = renderHook(() => useChatModelSelection({
      sessionId: 'new-session',
      sessionHydrated: true,
      sessionIsNew: true,
      storageScope: 'scope-a',
      storage: store,
      enabled: false,
    }))

    await waitFor(() => expect(result.current.model).toEqual(localDefault))
    expect(result.current.sessionModel).toBeUndefined()
    expect(result.current.isOverride).toBe(false)
  })

  it('restores a local default as an honest override for a still-empty new session', async () => {
    const sessionModel = { provider: 'anthropic', id: 'claude-sonnet' } as const
    const localDefault = { provider: 'anthropic', id: 'claude-opus' } as const
    const store = storage({
      [scopedComposerStorageKey('scope-a', 'model')]: JSON.stringify(localDefault),
      [scopedComposerStorageKey('scope-a', 'model:user-selected')]: '1',
    })
    const { result } = renderHook(() => useChatModelSelection({
      sessionId: 'empty-new',
      sessionHydrated: true,
      sessionIsNew: true,
      sessionModel,
      storageScope: 'scope-a',
      storage: store,
      enabled: false,
    }))

    await waitFor(() => expect(result.current.isOverride).toBe(true))
    expect(result.current.sessionModel).toEqual(sessionModel)
    expect(result.current.model).toEqual(localDefault)
  })

  it('represents an explicit next-message model difference as an override and clears it on refresh', async () => {
    const currentModel: ModelSelection = { provider: 'openai-codex', id: 'gpt-5.6-sol' } as const
    const override = { provider: 'openai', id: 'gpt-5.7' } as const
    const store = storage()
    const { result, rerender } = renderHook(
      ({ sessionModel }) => useChatModelSelection({
        sessionId: 'existing',
        sessionHydrated: true,
        sessionModel,
        storageScope: 'scope-a',
        storage: store,
        enabled: false,
      }),
      { initialProps: { sessionModel: currentModel } },
    )

    act(() => result.current.setModel(override))
    expect(result.current.model).toEqual(override)
    expect(result.current.sessionModel).toEqual(currentModel)
    expect(result.current.isOverride).toBe(true)

    rerender({ sessionModel: override })
    await waitFor(() => expect(result.current.isOverride).toBe(false))
    expect(result.current.model).toEqual(override)
  })

  it('does not fall back to local storage for a non-new session whose model authority is unavailable', async () => {
    const store = storage({
      [scopedComposerStorageKey('scope-a', 'model')]: JSON.stringify({ provider: 'infomaniak', id: 'stale' }),
    })
    const { result } = renderHook(() => useChatModelSelection({
      sessionId: 'existing-with-history',
      sessionHydrated: true,
      sessionIsNew: false,
      storageScope: 'scope-a',
      storage: store,
      enabled: false,
    }))

    expect(result.current.model).toBeNull()
  })

  it('normalizes discovered model metadata before storing a prompt selection', async () => {
    const store = storage()
    const { result } = renderHook(() => useChatModelSelection({
      storageScope: 'scope-a',
      storage: store,
      enabled: false,
    }))

    const discovered = {
      provider: 'openai-codex',
      id: 'gpt-5.6-sol',
      label: 'GPT 5.6 sol',
      available: true,
    }
    act(() => result.current.setModel(discovered))

    const expected = { provider: 'openai-codex', id: 'gpt-5.6-sol' }
    expect(result.current.model).toEqual(expected)
    expect(readPiComposerSettings({ storageScope: 'scope-a', storage: store }).model).toEqual(expected)
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
