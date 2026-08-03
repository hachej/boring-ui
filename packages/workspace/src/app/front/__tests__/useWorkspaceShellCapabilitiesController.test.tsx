import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SurfaceOpenRequest } from '../../../shared/types/surface'
import type { WorkspaceShellSessionRef } from '../../../shared/plugins/workspaceShellCapabilities'
import { useWorkspaceShellCapabilitiesController } from '../useWorkspaceShellCapabilitiesController'

function Probe({ openChatPane, openSurface, refreshChatSessions }: { openChatPane: (sessionId: string, agentTypeId?: string) => void; openSurface: (request: SurfaceOpenRequest) => void; refreshChatSessions: () => Promise<void> }) {
  const [floatingChatSession, setFloatingChatSession] = useState<{ ref: WorkspaceShellSessionRef; title?: string; initialDraft?: string; composingEnabled?: boolean } | null>(null)
  const shell = useWorkspaceShellCapabilitiesController({
    setFloatingChatSession,
    openChatPane,
    refreshChatSessions,
    isAppLeftOverlayAvailable: (id) => id === 'inbox',
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
    <button type="button" onClick={() => shell.openDetachedChat({ agentTypeId: 'alpha', sessionId: 'shared' })}>Open alpha chat</button>
    <button type="button" onClick={() => shell.openDetachedChat({ agentTypeId: 'beta', sessionId: 'shared' })}>Open beta chat</button>
    <button type="button" onClick={() => shell.openFullChat({ agentTypeId: 'beta', sessionId: 'shared' })}>Open full chat</button>
    <button type="button" onClick={() => shell.openInboxItem('question-1')}>Open inbox item</button>
    <output aria-label="Detached chat ref">{floatingChatSession ? `${floatingChatSession.ref.agentTypeId}/${floatingChatSession.ref.sessionId}` : ''}</output>
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

  it('opens full chat and Inbox items through addressed, validated capabilities', async () => {
    const user = userEvent.setup()
    const openChatPane = vi.fn()
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    render(<Probe openChatPane={openChatPane} openSurface={vi.fn()} refreshChatSessions={vi.fn(async () => undefined)} />)

    await user.click(screen.getByRole('button', { name: 'Open full chat' }))
    expect(openChatPane).toHaveBeenCalledWith('shared', 'beta')
    await user.click(screen.getByRole('button', { name: 'Open inbox item' }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'boring-workspace:open-app-left-overlay',
      detail: { id: 'inbox', params: { itemId: 'question-1' } },
    }))
    dispatch.mockRestore()
  })

  it('keeps the Agent owner when equal session ids open as detached chats', async () => {
    const user = userEvent.setup()
    render(<Probe openChatPane={vi.fn()} openSurface={vi.fn()} refreshChatSessions={vi.fn(async () => undefined)} />)

    await user.click(screen.getByRole('button', { name: 'Open alpha chat' }))
    expect(screen.getByLabelText('Detached chat ref')).toHaveTextContent('alpha/shared')

    await user.click(screen.getByRole('button', { name: 'Open beta chat' }))
    expect(screen.getByLabelText('Detached chat ref')).toHaveTextContent('beta/shared')
  })
})
