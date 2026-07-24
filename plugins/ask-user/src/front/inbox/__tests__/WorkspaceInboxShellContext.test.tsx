import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceInboxShell } from '../WorkspaceInboxShellContext'
import type { WorkspaceInboxItem } from '../inboxItemModel'

const shellMock = vi.hoisted(() => ({
  openArtifact: vi.fn(() => ({ success: true as const })),
  openDetachedChat: vi.fn(() => ({ success: true as const })),
}))

vi.mock('@hachej/boring-workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-workspace')>()
  return {
    ...actual,
    useWorkspaceShellCapabilities: () => shellMock,
  }
})

const artifact = { id: 'plan', surfaceKind: 'questions', target: 'q1', title: 'Plan' }

const item: WorkspaceInboxItem = {
  id: 'ask-user:s1:q1',
  kind: 'question',
  status: 'open',
  title: 'Need input',
  description: 'ask-user.question',
  source: { type: 'plugin', pluginId: 'ask-user.question', label: 'question' },
  sessionId: 's1',
  chatAvailable: true,
  targetLabel: 'q1',
  artifacts: [artifact],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  priority: 10,
  actions: [],
}

function Probe() {
  const shell = useWorkspaceInboxShell()
  return <>
    <button type="button" onClick={() => shell.openInboxArtifact(item, artifact)}>Open artifact</button>
    <button type="button" onClick={() => shell.openDetachedChat('s1', { title: item.title })}>Open chat</button>
  </>
}

describe('useWorkspaceInboxShell', () => {
  it('opens inbox artifacts without also requesting a chat pane', async () => {
    const user = userEvent.setup()
    shellMock.openArtifact.mockClear()
    shellMock.openDetachedChat.mockClear()

    render(<Probe />)
    await user.click(screen.getByRole('button', { name: 'Open artifact' }))

    expect(shellMock.openArtifact).toHaveBeenCalledWith({ type: 'surface', surfaceKind: 'questions', target: 'q1' }, {
      sessionId: 's1',
      title: 'Plan',
      instanceId: 'human-artifact:plan',
    })
    expect(shellMock.openDetachedChat).not.toHaveBeenCalled()
  })

  it('keeps explicit chat opening separate from artifact opening', async () => {
    const user = userEvent.setup()
    shellMock.openArtifact.mockClear()
    shellMock.openDetachedChat.mockClear()

    render(<Probe />)
    await user.click(screen.getByRole('button', { name: 'Open chat' }))

    expect(shellMock.openDetachedChat).toHaveBeenCalledWith('s1', { title: item.title })
    expect(shellMock.openArtifact).not.toHaveBeenCalled()
  })
})
