// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { useExternalRemotePiSession } from '../piChatPanelHooks'

describe('useExternalRemotePiSession', () => {
  test('does not recreate a native remote session when its adoption callback changes', async () => {
    const dispose = vi.fn()
    const createRemoteSession = vi.fn((_options: RemotePiSessionOptions) => ({ dispose }) as unknown as RemotePiSession)
    const onAdoptA = vi.fn()
    const onAdoptB = vi.fn()
    const { rerender } = renderHook(
      ({ onAdopt }) => useExternalRemotePiSession({
        sessionId: 'local-1',
        storageScope: 'scope-a',
        nativeSessionStartEnabled: true,
        onNativeSessionAdopt: onAdopt,
        createRemoteSession,
      }),
      { initialProps: { onAdopt: onAdoptA } },
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(1))
    rerender({ onAdopt: onAdoptB })
    await act(async () => {})

    expect(createRemoteSession).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    const native = createRemoteSession.mock.calls[0]?.[0].nativeFirstPrompt
    act(() => native?.onAdopt({
      id: 'native-1', title: 'Native', createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z', turnCount: 1,
    }))
    expect(onAdoptA).not.toHaveBeenCalled()
    expect(onAdoptB).toHaveBeenCalledTimes(1)
  })
})
