// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, type ReactNode } from 'react'
import { MemoryRouter, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
let unstableSessionObject = false
const signInEmailMock = vi.fn(async () => ({ data: {}, error: null }))
const signUpEmailMock = vi.fn(async () => ({ data: {}, error: null }))
const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

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
  ThemeToggle: () => <div>Theme toggle</div>,
  WorkspaceSwitcher: () => <div>Switcher</div>,
  routes: { signin: '/auth/signin', forgotPassword: '/auth/forgot-password' },
  useCurrentWorkspace: () => currentWorkspaceId ? ({ id: currentWorkspaceId, name: 'Workspace A' }) : null,
  useSession: () => unstableSessionObject && sessionState.data
    ? { data: { user: { ...sessionState.data.user } }, isPending: sessionState.isPending }
    : sessionState,
  useSignIn: () => ({ email: signInEmailMock }),
  useSignUp: () => ({ email: signUpEmailMock }),
  useWorkspaceRouteStatus: () => routeStatus,
}))

vi.mock('@hachej/boring-workspace/app/front', () => ({
  WorkspaceAgentFront: (props: Record<string, unknown>) => {
    workspaceAgentProps = props
    return (
      <div data-testid="workspace-agent-front">
        <div>Workspace agent</div>
        {props.topBarRight as ReactNode}
      </div>
    )
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
    unstableSessionObject = false
    signInEmailMock.mockClear()
    signUpEmailMock.mockClear()
    navigateMock.mockClear()
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

  it('renders the regular workspace shell with sign-in chrome before auth', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" appTitle="Full App" />)

    expect(coreFrontProps).toMatchObject({ publicPaths: ['/', '/workspace/:id', '/w/:id'] })
    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Switcher')).not.toBeInTheDocument()
    expect(screen.queryByText('User menu')).not.toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'public',
      provisionWorkspace: false,
      bootPreloadPaths: [],
      navEnabled: false,
      defaultNavOpen: false,
      defaultSurfaceOpen: false,
    })
    expect(workspaceAgentProps?.beforeShell).toBeFalsy()
    expect(workspaceAgentProps?.chatParams).toMatchObject({ serverResourcesEnabled: false, hydrateMessages: false })
  })

  it('allows apps to customize the public chat-first shell copy', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(
      <CoreWorkspaceAgentFront
        chatEntryMode="chat-first"
        chatFirstPublicShell={{
          composerPlaceholder: 'Ask about macro data…',
          emptyState: {
            eyebrow: 'Macro analyst',
            title: 'What macro signal should we inspect?',
            description: 'Search FRED, plot indicators, or draft a deck.',
          },
          suggestions: [
            { label: 'Search series', hint: 'Find FRED data', prompt: 'Find CPI and unemployment series.' },
          ],
        }}
      />,
    )

    expect(workspaceAgentProps?.chatParams).toMatchObject({
      composerPlaceholder: 'Ask about macro data…',
      emptyState: {
        eyebrow: 'Macro analyst',
        title: 'What macro signal should we inspect?',
        description: 'Search FRED, plot indicators, or draft a deck.',
      },
      suggestions: [
        { label: 'Search series', hint: 'Find FRED data', prompt: 'Find CPI and unemployment series.' },
      ],
    })
  })

  it('signs in from the chat-first auth overlay without a hard browser reload', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'
    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Sign in' })[0])
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByPlaceholderText('Email'), 'test@example.com')
    await userEvent.type(within(dialog).getByPlaceholderText('Password'), 'BoringUi!123')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue with email' }))

    expect(signInEmailMock).toHaveBeenCalledWith({ email: 'test@example.com', password: 'BoringUi!123' })
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
  })

  it('saves the local draft and opens the auth modal before chat-first submit', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    await act(async () => {
      await (workspaceAgentProps?.chatParams as { onBeforeSubmit: (draft: string) => Promise<false> | false }).onBeforeSubmit('Build a dashboard')
    })

    expect(JSON.parse(window.sessionStorage.getItem('boring:pending-chat-entry') ?? '{}')).toMatchObject({
      draft: 'Build a dashboard',
      returnTo: '/',
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(workspaceAgentProps?.className).toBeUndefined()
    expect(within(dialog).getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe(
      '/auth/forgot-password?redirect=%2F',
    )
  })

  it('restores a pending chat-first draft after auth reaches the workspace shell', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Restore this',
      returnTo: '/',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    expect(workspaceAgentProps?.chatParams).toMatchObject({ initialDraft: 'Restore this', autoSubmitInitialDraft: true })
  })

  it('keeps a lean authenticated shell on / while the default workspace resolves', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = null
    routePath = '/'
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Keep this draft',
      returnTo: '/',
      intendedWorkspaceId: 'ws-pending',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(screen.queryByText('Loading identity')).not.toBeInTheDocument()
    expect(screen.getByText('User menu')).toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'ws-pending',
      provisionWorkspace: false,
      bootPreloadPaths: [],
      navEnabled: false,
      defaultNavOpen: false,
      defaultSurfaceOpen: false,
    })
    expect(workspaceAgentProps?.beforeShell).toBeTruthy()
    expect(workspaceAgentProps?.chatParams).toMatchObject({
      initialDraft: 'Keep this draft',
      serverResourcesEnabled: false,
      hydrateMessages: false,
    })
  })

  it('does not loop when the session hook returns a fresh user object each render', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = null
    routePath = '/'
    unstableSessionObject = true
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Keep this draft',
      returnTo: '/',
      intendedWorkspaceId: 'ws-pending',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps?.chatParams).toMatchObject({ initialDraft: 'Keep this draft' })
  })

  it('keeps a lean authenticated shell on the target workspace route until identity matches', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = null
    routePath = '/workspace/workspace-b'
    routeStatus = { status: 'loading', workspaceId: 'workspace-b' }
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Route draft',
      returnTo: '/workspace/workspace-b',
      intendedWorkspaceId: 'workspace-b',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(screen.queryByText('Loading identity')).not.toBeInTheDocument()
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'workspace-b',
      provisionWorkspace: false,
      bootPreloadPaths: [],
    })
    expect(workspaceAgentProps?.beforeShell).toBeTruthy()
    expect(workspaceAgentProps?.chatParams).toMatchObject({
      initialDraft: 'Route draft',
      serverResourcesEnabled: false,
      hydrateMessages: false,
    })
  })

  it('does not auto-submit a stale pending draft on a non-matching route', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    routePath = '/workspace/workspace-a'
    routeStatus = { status: 'matched', workspaceId: 'workspace-a' }
    currentWorkspaceId = 'workspace-a'
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Wrong workspace draft',
      returnTo: '/workspace/workspace-b',
      intendedWorkspaceId: 'workspace-b',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    expect(workspaceAgentProps?.chatParams).not.toMatchObject({
      initialDraft: 'Wrong workspace draft',
      autoSubmitInitialDraft: true,
    })
  })

  it('does not restore a pending draft when intended workspace disagrees with the matched route', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    routePath = '/workspace/workspace-a'
    routeStatus = { status: 'matched', workspaceId: 'workspace-a' }
    currentWorkspaceId = 'workspace-a'
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Mismatched intended workspace',
      returnTo: '/workspace/workspace-a',
      intendedWorkspaceId: 'workspace-b',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" />)

    expect(workspaceAgentProps?.chatParams).not.toMatchObject({
      initialDraft: 'Mismatched intended workspace',
      autoSubmitInitialDraft: true,
    })
  })

  it('blocks sends from the lean authenticated shell even with a host submit hook', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    const hostBeforeSubmit = vi.fn()
    currentWorkspaceId = null
    routePath = '/'
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Keep this draft',
      returnTo: '/',
      intendedWorkspaceId: 'ws-pending',
      createdAt: Date.now(),
    }))

    render(
      <CoreWorkspaceAgentFront
        chatEntryMode="chat-first"
        chatParams={{ onBeforeSubmit: hostBeforeSubmit }}
      />,
    )

    const result = await (workspaceAgentProps?.chatParams as { onBeforeSubmit: (draft: string, ctx: unknown) => false | void | Promise<false | void> }).onBeforeSubmit('Do not send yet', {})
    expect(result).toBe(false)
    expect(hostBeforeSubmit).not.toHaveBeenCalled()
  })

  it('marks custom workspace routes as public in chat-first mode', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/projects/project-1'

    render(
      <CoreWorkspaceAgentFront
        chatEntryMode="chat-first"
        workspaceRoute="/projects/:workspaceSlug"
        workspaceIdParam="workspaceSlug"
      />,
    )

    expect(coreFrontProps).toMatchObject({
      publicPaths: ['/', '/projects/:workspaceSlug', '/workspace/:id', '/w/:id'],
    })
  })

  it('keeps the loading fallback for authenticated chat-first loads without a pending draft', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByText('Loading identity')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
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
