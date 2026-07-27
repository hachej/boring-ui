// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { useExternalRemotePiSession } from '../piChatPanelHooks'

describe('useExternalRemotePiSession addressed identity', () => {
  test('fails closed during an agent switch instead of rendering the previous agent remote', async () => {
    const renders: string[] = []
    const createRemoteSession = vi.fn((options: RemotePiSessionOptions) => ({
      agentTypeId: options.agentTypeId,
      dispose: vi.fn(),
    }) as unknown as RemotePiSession)

    function Probe({ agentTypeId }: { agentTypeId: string }) {
      const session = useExternalRemotePiSession({
        sessionId: 'shared',
        agentTypeId,
        storageScope: 'workspace-a',
        createRemoteSession,
      })
      renders.push((session as unknown as { agentTypeId?: string } | undefined)?.agentTypeId ?? 'none')
      return <div>{(session as unknown as { agentTypeId?: string } | undefined)?.agentTypeId ?? 'none'}</div>
    }

    const { rerender } = render(<Probe agentTypeId="alpha" />)
    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(renders.at(-1)).toBe('alpha'))
    renders.length = 0

    rerender(<Probe agentTypeId="beta" />)

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(renders.at(-1)).toBe('beta'))
    expect(renders[0]).toBe('none')
    expect(renders).not.toContain('alpha')
  })
})
