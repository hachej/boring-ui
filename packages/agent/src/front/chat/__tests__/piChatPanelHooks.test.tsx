// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { useExternalRemotePiSession } from '../piChatPanelHooks'

function remoteSession() {
  return { dispose: vi.fn() } as unknown as RemotePiSession
}

describe('useExternalRemotePiSession', () => {
  it('releases and restores the remote stream without unmounting its owner', () => {
    const first = remoteSession()
    const second = remoteSession()
    const createRemoteSession = vi.fn(() => createRemoteSession.mock.calls.length === 1 ? first : second)
    const { result, rerender } = renderHook(
      ({ enabled }) => useExternalRemotePiSession({
        sessionId: 'session-1',
        agentTypeId: 'default',
        workspaceId: 'workspace-1',
        storageScope: 'workspace-1',
        createRemoteSession,
        enabled,
      }),
      { initialProps: { enabled: true } },
    )

    expect(createRemoteSession).toHaveBeenCalledTimes(1)
    rerender({ enabled: false })
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(first)
    rerender({ enabled: true })
    expect(createRemoteSession).toHaveBeenCalledTimes(2)
  })

  it('clears a retained snapshot when its suspended session is removed', () => {
    const first = remoteSession()
    const createRemoteSession = vi.fn(() => first)
    const { result, rerender } = renderHook(
      ({ sessionId, enabled }: { sessionId: string | undefined; enabled: boolean }) => useExternalRemotePiSession({
        sessionId,
        agentTypeId: 'default',
        workspaceId: 'workspace-1',
        storageScope: 'workspace-1',
        createRemoteSession,
        enabled,
      }),
      { initialProps: { sessionId: 'session-1' as string | undefined, enabled: true } },
    )

    rerender({ sessionId: 'session-1', enabled: false })
    expect(result.current).toBe(first)
    rerender({ sessionId: undefined, enabled: false })
    expect(result.current).toBeUndefined()
  })

  it('keeps hydration alive across semantically equal request-header objects', () => {
    const first = remoteSession()
    const second = remoteSession()
    const createRemoteSession = vi.fn((_options: RemotePiSessionOptions) => (
      createRemoteSession.mock.calls.length === 1 ? first : second
    ))
    const { rerender, unmount } = renderHook(
      ({ headers }) => useExternalRemotePiSession({
        sessionId: 'session-1',
        agentTypeId: 'default',
        workspaceId: 'workspace-1',
        storageScope: 'workspace-1',
        requestHeaders: headers,
        createRemoteSession,
      }),
      { initialProps: { headers: { 'x-boring-workspace-id': 'workspace-1', ignored: undefined } } },
    )

    rerender({ headers: { ignored: undefined, 'x-boring-workspace-id': 'workspace-1' } })
    expect(createRemoteSession).toHaveBeenCalledTimes(1)
    expect(first.dispose).not.toHaveBeenCalled()

    rerender({ headers: { 'x-boring-workspace-id': 'workspace-2', ignored: undefined } })
    expect(createRemoteSession).toHaveBeenCalledTimes(2)
    expect(first.dispose).toHaveBeenCalledTimes(1)

    unmount()
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })
})
