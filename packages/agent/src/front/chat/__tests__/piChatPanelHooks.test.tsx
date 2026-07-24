// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { useExternalRemotePiSession } from '../piChatPanelHooks'

describe('useExternalRemotePiSession', () => {
  test('keeps a late native receipt bound to the remote session that created it', async () => {
    const createRemoteSession = vi.fn((_options: RemotePiSessionOptions) => ({ dispose: vi.fn() }) as unknown as RemotePiSession)
    const onAdoptA = vi.fn()
    const onAdoptB = vi.fn()
    const { rerender } = renderHook(
      ({ sessionId, onAdopt }) => useExternalRemotePiSession({
        sessionId,
        storageScope: 'scope-a',
        nativeSessionStartEnabled: true,
        onNativeSessionAdopt: onAdopt,
        createRemoteSession,
      }),
      { initialProps: { sessionId: 'local-a', onAdopt: onAdoptA } },
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(1))
    rerender({ sessionId: 'local-a', onAdopt: onAdoptB })
    await act(async () => {})
    expect(createRemoteSession).toHaveBeenCalledTimes(1)

    rerender({ sessionId: 'local-b', onAdopt: onAdoptB })
    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(2))

    const native = createRemoteSession.mock.calls[0]?.[0].nativeFirstPrompt
    act(() => native?.onAdopt({
      id: 'native-a', title: 'Native A', createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z', turnCount: 1,
    }))
    expect(onAdoptA).toHaveBeenCalledTimes(1)
    expect(onAdoptB).not.toHaveBeenCalled()
  })
})
