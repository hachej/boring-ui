import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SurfaceOpenRequest } from '../../../shared/types/surface'
import { useWorkspaceShellCapabilitiesController, type FloatingChatSession } from '../useWorkspaceShellCapabilitiesController'

function Probe({ openChatPane, openSurface, refreshChatSessions }: { openChatPane: (sessionId: string) => void; openSurface: (request: SurfaceOpenRequest) => void; refreshChatSessions: () => Promise<void> }) {
  const [, setFloatingChatSession] = useState<FloatingChatSession | null>(null)
  const shell = useWorkspaceShellCapabilitiesController({
    setFloatingChatSession,
    openChatPane,
    refreshChatSessions,
    surfaceDispatch: {
      surface: () => ({
        openSurface,
        openFile: vi.fn(),
        openPanel: vi.fn(),
        closePanel: vi.fn(),
        navigateToLine: vi.fn(),
        expandToFile: vi.fn(),
        closeWorkbenchLeftPane: vi.fn(),
        getSnapshot: () => ({ openTabs: [], activeTab: null }),
        on: () => () => undefined,
      }),
      isWorkbenchOpen: () => true,
      openWorkbench: vi.fn(),
    },
  })
  return <>
    <button type="button" onClick={() => shell.openArtifact(
      { type: 'surface', surfaceKind: 'questions', target: 'q1', params: { sessionId: 's1' } },
      { sessionId: null, title: 'Need input', instanceId: 'ask-user:s1:q1' },
    )}>Open question</button>
    <button type="button" onClick={() => void shell.refreshChatSessions?.()}>Refresh chats</button>
  </>
}

describe('useWorkspaceShellCapabilitiesController', () => {
  it('opens surface artifacts with metadata params without opening chat when session option is null', async () => {
    const user = userEvent.setup()
    const openChatPane = vi.fn()
    const openSurface = vi.fn()

    render(<Probe openChatPane={openChatPane} openSurface={openSurface} refreshChatSessions={vi.fn(async () => undefined)} />)
    await user.click(screen.getByRole('button', { name: 'Open question' }))

    expect(openChatPane).not.toHaveBeenCalled()
    expect(openSurface).toHaveBeenCalledWith({
      kind: 'questions',
      target: 'q1',
      filesystem: 'user',
      meta: { sessionId: 's1' },
    })
  })

  it('refreshes authoritative chat sessions through the shell capability', async () => {
    const user = userEvent.setup()
    const refreshChatSessions = vi.fn(async () => undefined)

    render(<Probe openChatPane={vi.fn()} openSurface={vi.fn()} refreshChatSessions={refreshChatSessions} />)
    await user.click(screen.getByRole('button', { name: 'Refresh chats' }))

    expect(refreshChatSessions).toHaveBeenCalledOnce()
  })
})
