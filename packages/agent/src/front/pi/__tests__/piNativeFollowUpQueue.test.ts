// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePiNativeFollowUpQueue } from '../piNativeFollowUpQueue'

const stop = vi.fn()

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

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

  it('restores a queued follow-up for the same session after remount', async () => {
    const first = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-remount',
      status: 'streaming',
      stop,
    }))

    act(() => {
      first.result.current.queueFollowUp({
        text: 'keep this queued message',
        files: [],
        serverMessage: 'keep this queued message',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-remount/followup',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(first.result.current.pendingMessages[0]?.posted).toBe(true)
    })

    vi.mocked(fetch).mockClear()
    first.unmount()

    const second = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-remount',
      status: 'streaming',
      stop,
    }))

    expect(second.result.current.pendingMessages).toHaveLength(1)
    expect(second.result.current.pendingMessages[0]?.text).toBe('keep this queued message')
    expect(second.result.current.projectedTailMessages).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not erase another session queued follow-up when switching sessions', async () => {
    const { result, rerender } = renderHook(
      ({ sessionId }) => usePiNativeFollowUpQueue({ sessionId, status: 'streaming', stop }),
      { initialProps: { sessionId: 'sess-a' } },
    )

    act(() => {
      result.current.queueFollowUp({
        text: 'queued on a',
        files: [],
        serverMessage: 'queued on a',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-a/followup',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    rerender({ sessionId: 'sess-b' })
    expect(result.current.pendingMessages).toHaveLength(0)

    rerender({ sessionId: 'sess-a' })
    expect(result.current.pendingMessages).toHaveLength(1)
    expect(result.current.projectedTailMessages).toHaveLength(1)
  })

  it('keeps queued follow-ups isolated between workspaces sharing a session id', async () => {
    const { result, rerender } = renderHook(
      ({ workspaceId }) => usePiNativeFollowUpQueue({
        sessionId: 'sess-shared',
        status: 'streaming',
        requestHeaders: { 'x-boring-workspace-id': workspaceId },
        stop,
      }),
      { initialProps: { workspaceId: 'workspace-a' } },
    )

    act(() => {
      result.current.queueFollowUp({
        text: 'queued in workspace a',
        files: [],
        serverMessage: 'queued in workspace a',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-shared/followup',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-boring-workspace-id': 'workspace-a' }),
        }),
      )
    })

    rerender({ workspaceId: 'workspace-b' })
    expect(result.current.pendingMessages).toHaveLength(0)
    expect(result.current.projectedTailMessages).toHaveLength(0)

    act(() => {
      result.current.queueFollowUp({
        text: 'queued in workspace b',
        files: [],
        serverMessage: 'queued in workspace b',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-shared/followup',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-boring-workspace-id': 'workspace-b' }),
        }),
      )
    })

    expect(result.current.pendingMessages[0]?.text).toBe('queued in workspace b')

    rerender({ workspaceId: 'workspace-a' })
    expect(result.current.pendingMessages).toHaveLength(1)
    expect(result.current.pendingMessages[0]?.text).toBe('queued in workspace a')
    expect(result.current.projectedTailMessages).toHaveLength(1)
  })

  it('reposts a restored unposted follow-up while streaming', async () => {
    localStorage.setItem('boring-agent:followup-queue:global:sess-unposted', JSON.stringify([{
      id: 'pending-unposted',
      sessionId: 'sess-unposted',
      text: 'restore and send me',
      files: [],
      serverMessage: 'restore and send me',
      attachments: [],
      posted: false,
      consumed: false,
      clientNonce: 'nonce-unposted',
      clientSeq: 1,
      postAttempts: 0,
    }]))

    const { result } = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-unposted',
      status: 'streaming',
      stop,
    }))

    expect(result.current.pendingMessages).toHaveLength(1)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-unposted/followup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('nonce-unposted'),
        }),
      )
      expect(result.current.pendingMessages[0]?.posted).toBe(true)
    })
  })

  it('preserves a queued follow-up when posting fails after switching sessions', async () => {
    let rejectPost: ((reason?: unknown) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((_, reject) => {
      rejectPost = reject
    })))

    const { result, rerender } = renderHook(
      ({ sessionId }) => usePiNativeFollowUpQueue({ sessionId, status: 'streaming', stop }),
      { initialProps: { sessionId: 'sess-a-fail' } },
    )

    act(() => {
      result.current.queueFollowUp({
        text: 'queued before failed post',
        files: [],
        serverMessage: 'queued before failed post',
        attachments: [],
      })
    })

    await waitFor(() => expect(rejectPost).toBeDefined())

    rerender({ sessionId: 'sess-b-fail' })
    expect(result.current.pendingMessages).toHaveLength(0)

    await act(async () => {
      rejectPost?.(new Error('offline'))
      await flushPromises()
    })

    rerender({ sessionId: 'sess-a-fail' })
    expect(result.current.pendingMessages).toHaveLength(1)
    expect(result.current.pendingMessages[0]).toEqual(expect.objectContaining({
      text: 'queued before failed post',
      posted: false,
    }))
  })

  it('does not replay a consumed follow-up after remount', async () => {
    const first = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-consumed',
      status: 'streaming',
      stop,
    }))

    act(() => {
      first.result.current.queueFollowUp({
        text: 'consumed follow-up',
        files: [],
        serverMessage: 'consumed follow-up',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/agent/chat/sess-consumed/followup',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    act(() => {
      first.result.current.handleData({
        type: 'data-followup-consumed',
        data: { text: 'consumed follow-up' },
      })
    })

    first.unmount()

    const second = renderHook(() => usePiNativeFollowUpQueue({
      sessionId: 'sess-consumed',
      status: 'streaming',
      stop,
    }))

    expect(second.result.current.pendingMessages).toHaveLength(0)
    expect(second.result.current.projectedTailMessages).toHaveLength(0)
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
