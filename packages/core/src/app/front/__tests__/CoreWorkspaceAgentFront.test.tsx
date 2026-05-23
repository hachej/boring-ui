// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

let currentWorkspaceId: string | null = 'workspace-a'
let routePath = '/workspace/workspace-a'
let routeStatus: { status: string; workspaceId?: string | null; message?: string } = {
  status: 'matched',
  workspaceId: 'workspace-a',
}
let workspaceAgentProps: Record<string, unknown> | null = null
let coreFrontProps: Record<string, unknown> | null = null
let sessionState: { data: { user: { id: string } } | null; isPending: boolean } = {
  data: { user: { id: 'user-1' } },
  isPending: false,
}

vi.mock('../../../front/index.js', () => ({
  CoreFront: ({ children, ...props }: { children?: ReactNode }) => {
    coreFrontProps = props
    return (
      <MemoryRouter initialEntries={[routePath]}>
        <Routes>{children}</Routes>
      </MemoryRouter>
    )
  },
  UserMenu: () => <div>User menu</div>,
  WorkspaceSwitcher: () => <div>Switcher</div>,
  routes: { signin: '/auth/signin' },
  useCurrentWorkspace: () => currentWorkspaceId ? ({ id: currentWorkspaceId, name: 'Workspace A' }) : null,
  useSession: () => sessionState,
  useWorkspaceRouteStatus: () => routeStatus,
}))

vi.mock('@hachej/boring-workspace/app/front', () => ({
  WorkspaceAgentFront: (props: Record<string, unknown>) => {
    workspaceAgentProps = props
    return <div data-testid="workspace-agent-front">Workspace agent</div>
  },
}))

async function importSubject() {
  return await import('../CoreWorkspaceAgentFront.js')
}

describe('CoreWorkspaceAgentFront', () => {
  beforeEach(() => {
    currentWorkspaceId = 'workspace-a'
    routePath = '/workspace/workspace-a'
    routeStatus = { status: 'matched', workspaceId: 'workspace-a' }
    workspaceAgentProps = null
    coreFrontProps = null
    sessionState = { data: { user: { id: 'user-1' } }, isPending: false }
    window.sessionStorage.clear()
  })

  it('injects the routed workspace id into workspace request headers without blocking boot gate', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        requestHeaders={{ existing: 'request' }}
        authHeaders={{ existing: 'auth' }}
        apiBaseUrl="/api-base"
        bootPreloadPaths={['/custom-preload']}
      />,
    )

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'workspace-a',
      requestHeaders: {
        existing: 'request',
        'x-boring-workspace-id': 'workspace-a',
      },
      authHeaders: {
        existing: 'auth',
        'x-boring-workspace-id': 'workspace-a',
      },
      bootPreloadPaths: ['/custom-preload'],
    })
  })

  it('keeps identity loading/mismatch as the only transition blocker', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = 'workspace-other'
    routeStatus = { status: 'mismatched', workspaceId: 'workspace-a', currentWorkspaceId: 'workspace-other' } as never

    render(<CoreWorkspaceAgentFront loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByText('Loading identity')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
  })

  it.each([
    ['not-found', 'Workspace not found'],
    ['forbidden', 'Workspace unavailable'],
    ['switch-failed', 'Workspace failed to open'],
  ])('renders terminal route recovery for %s', async (status, title) => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    routeStatus = { status, workspaceId: 'workspace-a', message: 'No access' }

    render(<CoreWorkspaceAgentFront />)

    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText('No access')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
  })

  it('preserves custom workspace route and param configuration', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    routePath = '/projects/project-1'
    currentWorkspaceId = 'project-1'
    routeStatus = { status: 'matched', workspaceId: 'project-1' }

    render(
      <CoreWorkspaceAgentFront
        workspaceRoute="/projects/:workspaceSlug"
        workspaceIdParam="workspaceSlug"
      />,
    )

    expect(coreFrontProps).toMatchObject({
      workspaceRoute: '/projects/:workspaceSlug',
      workspaceIdParam: 'workspaceSlug',
    })
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'project-1',
      requestHeaders: { 'x-boring-workspace-id': 'project-1' },
    })
  })

  it('renders a chat-first public shell without workspace chrome before auth', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" appTitle="Full App" />)

    expect(coreFrontProps).toMatchObject({ publicPaths: ['/', '/workspace', '/w'] })
    expect(screen.getByText('What do you want to build?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Switcher')).not.toBeInTheDocument()
    expect(screen.queryByText('User menu')).not.toBeInTheDocument()
    expect(workspaceAgentProps).toBeNull()
  })

  it('saves the local draft before opening chat-first sign in', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    fireEvent.change(screen.getByPlaceholderText(/Ask the agent/), { target: { value: 'Build a dashboard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(JSON.parse(window.sessionStorage.getItem('boring:pending-chat-entry') ?? '{}')).toMatchObject({
      draft: 'Build a dashboard',
      returnTo: '/',
    })
  })

  it('restores a pending chat-first draft after auth reaches the workspace shell', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Restore this',
      returnTo: '/',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    expect(workspaceAgentProps?.chatParams).toMatchObject({ initialDraft: 'Restore this' })
  })

  it('forces front plugin hot reload off while forwarding workspace props', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        apiBaseUrl="/api-base"
        defaultSurfaceOpen={false}
        extraPanels={['demo-panel']}
      />,
    )

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      apiBaseUrl: '/api-base',
      defaultSurfaceOpen: false,
      extraPanels: ['demo-panel'],
      frontPluginHotReload: false,
      hotReloadEnabled: false,
    })
  })

  it('fails fast if core app hot reload is requested', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    expect(() => render(
      <CoreWorkspaceAgentFront
        hotReload={true as false}
      />,
    )).toThrow(/does not support hotReload/)
  })
})
