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
    { sessionId: null, title: 'Need input', instanceId: 'ask-user:s1:q1' },
  )}>Open question</button>
}

describe('useWorkspaceShellCapabilitiesController', () => {
  it('opens surface artifacts with metadata params without opening chat when session option is null', async () => {
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

  it('reveals only safe workspace-relative paths through expandToFile', () => {
    const expandToFile = vi.fn()
    const { result } = renderHook(() => useWorkspaceShellCapabilitiesController({
      setFloatingChatSession: vi.fn(),
      openChatPane: vi.fn(),
      surfaceDispatch: {
        surface: () => ({
          openSurface: vi.fn(),
          openFile: vi.fn(),
          openPanel: vi.fn(),
          closePanel: vi.fn(),
          navigateToLine: vi.fn(),
          expandToFile,
          closeWorkbenchLeftPane: vi.fn(),
          getSnapshot: () => ({ openTabs: [], activeTab: null }),
          on: () => () => undefined,
        }),
        isWorkbenchOpen: () => true,
        openWorkbench: vi.fn(),
      },
    }))

    act(() => {
      expect(result.current.revealWorkspacePath('docs/issues/776')).toEqual({ success: true })
      expect(result.current.revealWorkspacePath('../secrets')).toMatchObject({ success: false, reason: 'invalid-path' })
      expect(result.current.revealWorkspacePath('/absolute')).toMatchObject({ success: false, reason: 'invalid-path' })
      expect(result.current.revealWorkspacePath('docs\\issues')).toMatchObject({ success: false, reason: 'invalid-path' })
    })

    expect(expandToFile).toHaveBeenCalledTimes(1)
    expect(expandToFile).toHaveBeenCalledWith('docs/issues/776')
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
