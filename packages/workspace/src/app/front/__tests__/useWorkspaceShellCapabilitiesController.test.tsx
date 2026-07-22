import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SurfaceOpenRequest } from '../../../shared/types/surface'
import { useWorkspaceShellCapabilitiesController } from '../useWorkspaceShellCapabilitiesController'

function Probe({ openChatPane, openSurface }: { openChatPane: (sessionId: string) => void; openSurface: (request: SurfaceOpenRequest) => void }) {
  const [, setFloatingChatSession] = useState<{ sessionId: string; title?: string; initialDraft?: string; composingEnabled?: boolean } | null>(null)
  const shell = useWorkspaceShellCapabilitiesController({
    setFloatingChatSession,
    openChatPane,
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
  return <button type="button" onClick={() => shell.openArtifact(
    { type: 'surface', surfaceKind: 'questions', target: 'q1', params: { sessionId: 's1' } },
    { sessionId: 's1', title: 'Need input', instanceId: 'ask-user:s1:q1' },
  )}>Open question</button>
}

describe('useWorkspaceShellCapabilitiesController', () => {
  it('opens surface artifacts with session metadata without switching chat', async () => {
    const user = userEvent.setup()
    const openChatPane = vi.fn()
    const openSurface = vi.fn()

    render(<Probe openChatPane={openChatPane} openSurface={openSurface} />)
    await user.click(screen.getByRole('button', { name: 'Open question' }))

    expect(openChatPane).not.toHaveBeenCalled()
    expect(openSurface).toHaveBeenCalledWith({
      kind: 'questions',
      target: 'q1',
      filesystem: 'user',
      meta: { sessionId: 's1' },
    })
  })

  it('opens workspace document artifacts through the canonical file command', () => {
    const openFile = vi.fn()
    const openSurface = vi.fn()
    const { result } = renderHook(() => useWorkspaceShellCapabilitiesController({
      setFloatingChatSession: vi.fn(),
      openChatPane: vi.fn(),
      surfaceDispatch: {
        surface: () => ({
          openSurface,
          openFile,
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
    }))

    act(() => {
      expect(result.current.openArtifact({
        type: 'surface',
        surfaceKind: 'workspace.open.path',
        target: 'docs/release.md',
      })).toEqual({ success: true })
    })

    expect(openFile).toHaveBeenCalledWith('docs/release.md', { filesystem: 'user' })
    expect(openSurface).not.toHaveBeenCalled()
  })

  it('opens Inbox items and exact full-chat sessions without creating one', () => {
    const openChatPane = vi.fn()
    const inboxRequests: unknown[] = []
    const onInboxRequest = (event: Event) => inboxRequests.push((event as CustomEvent).detail)
    window.addEventListener('boring-workspace:open-app-left-overlay', onInboxRequest)
    const { result } = renderHook(() => useWorkspaceShellCapabilitiesController({
      setFloatingChatSession: vi.fn(),
      openChatPane,
      isAppLeftOverlayAvailable: (id) => id === 'inbox',
      surfaceDispatch: {
        surface: () => ({
          openSurface: vi.fn(),
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
    }))

    act(() => {
      expect(result.current.openFullChat('native-exact')).toEqual({ success: true })
      expect(result.current.openFullChat(' ')).toMatchObject({ success: false, reason: 'invalid-session' })
      expect(result.current.openInboxItem('ask-user:s1:q1')).toEqual({ success: true })
      expect(result.current.openInboxItem('bad\nitem')).toMatchObject({ success: false })
    })

    window.removeEventListener('boring-workspace:open-app-left-overlay', onInboxRequest)
    expect(inboxRequests).toEqual([{ id: 'inbox', params: { itemId: 'ask-user:s1:q1' } }])
    expect(openChatPane).toHaveBeenCalledTimes(1)
    expect(openChatPane).toHaveBeenCalledWith('native-exact')
  })

  it('registers an opaque browser-local session before opening its detached composer', () => {
    const setFloatingChatSession = vi.fn()
    const registerBrowserLocalSession = vi.fn()
    const onNativeSessionPersisted = vi.fn()
    const { result } = renderHook(() => useWorkspaceShellCapabilitiesController({
      setFloatingChatSession,
      openChatPane: vi.fn(),
      registerBrowserLocalSession,
      surfaceDispatch: {
        surface: () => ({
          openSurface: vi.fn(),
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
    }))

    act(() => {
      expect(result.current.openBrowserLocalDetachedChat({ title: 'Task', onNativeSessionPersisted })).toEqual({ success: true })
    })

    const localId = registerBrowserLocalSession.mock.calls[0]?.[0]
    expect(localId).toEqual(expect.any(String))
    expect(registerBrowserLocalSession).toHaveBeenCalledWith(localId, onNativeSessionPersisted)
    expect(setFloatingChatSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: localId, browserLocalId: localId, title: 'Task' }))
  })
})
