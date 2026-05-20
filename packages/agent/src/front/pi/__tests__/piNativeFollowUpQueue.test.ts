// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePiNativeFollowUpQueue } from '../piNativeFollowUpQueue'

const stop = vi.fn()

function installStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  })
}

describe('usePiNativeFollowUpQueue', () => {
  beforeEach(() => {
    stop.mockReset()
    installStorage()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes one queued follow-up locally and asks the server to drop the matching nonce', async () => {
    const { result } = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-delete-one',
      status: 'streaming',
      stop,
    }))

    act(() => {
      result.current.queueFollowUp({
        text: 'delete this queued message',
        files: [],
        serverMessage: 'delete this queued message',
        attachments: [],
      })
    })

    const queuedId = result.current.pendingMessages[0]?.id
    expect(queuedId).toBeTruthy()
    expect(result.current.projectedFollowUps).toHaveLength(1)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-delete-one/followup',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    act(() => {
      result.current.deleteFollowUp(queuedId!)
    })

    expect(result.current.pendingMessages).toHaveLength(0)
    expect(result.current.projectedFollowUps).toHaveLength(0)
    expect(result.current.projectedTailMessages).toHaveLength(0)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/agent\/chat\/sess-delete-one\/followup\?clientNonce=.+&clientSeq=1$/),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
