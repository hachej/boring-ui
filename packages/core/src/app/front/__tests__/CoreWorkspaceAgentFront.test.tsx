// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, type ReactNode } from 'react'
import { MemoryRouter, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentWorkspaceId: string | null = 'workspace-a'
let currentWorkspaceDefaultAgentTypeId: string | null = null
let routePath = '/workspace/workspace-a'
let routeStatus: { status: string; workspaceId?: string | null; message?: string } = {
  status: 'matched',
  workspaceId: 'workspace-a',
}
let workspaceAgentProps: Record<string, unknown> | null = null
let workspaceProviderProps: Record<string, unknown> | null = null
let workspaceBootGateProps: Record<string, unknown> | null = null
let workspaceFullPagePanelProps: Record<string, unknown> | null = null
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
  routes: { signin: '/auth/signin', forgotPassword: '/auth/forgot-password', verifyEmail: '/auth/verify-email' },
  useConfig: () => ({
    appId: 'test-app',
    appName: 'Test Workspace',
    appLogo: null,
    apiBase: '/api/v1',
    features: {
      githubOauth: false,
      googleOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: false,
      emailVerification: false,
    },
  }),
  useCurrentWorkspace: () => currentWorkspaceId ? ({
    id: currentWorkspaceId,
    name: 'Workspace A',
    defaultAgentTypeId: currentWorkspaceDefaultAgentTypeId,
  }) : null,
  useSession: () => unstableSessionObject && sessionState.data
    ? { data: { user: { ...sessionState.data.user } }, isPending: sessionState.isPending }
    : sessionState,
  useSignIn: () => ({ email: signInEmailMock }),
  useSignUp: () => ({ email: signUpEmailMock }),
  useWorkspaceRouteStatus: () => routeStatus,
}))

vi.mock('@hachej/boring-workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-workspace')>()
  return {
    ...actual,
    WorkspaceProvider: ({ children, ...props }: { children?: ReactNode }) => {
      workspaceProviderProps = props
      return <div data-testid="workspace-provider">{children}</div>
    },
  }
})

vi.mock('@hachej/boring-workspace/app/front', () => ({
  DEFAULT_BOOT_PRELOAD_PATHS: ['/api/v1/tree?path=.'],
  WorkspaceAgentFront: (props: Record<string, unknown>) => {
    workspaceAgentProps = props
    return (
      <div data-testid="workspace-agent-front">
        <div>Workspace agent</div>
        {props.topBarRight as ReactNode}
      </div>
    )
  },
  WorkspaceBootGate: ({ children, ...props }: { children?: ReactNode }) => {
    workspaceBootGateProps = props
    return <div data-testid="workspace-boot-gate">{children}</div>
  },
  WorkspaceFullPagePanel: (props: Record<string, unknown>) => {
    workspaceFullPagePanelProps = props
    return <div data-testid="workspace-full-page-panel">Full page panel</div>
  },
  parseFullPagePanelLocation: (search: string) => {
    const query = new URLSearchParams(search)
    const componentId = query.get('component')?.trim() ?? ''
    if (!componentId) {
      return {
        componentId: null,
        params: {},
        error: { code: 'FULL_PAGE_PANEL_MISSING_COMPONENT', message: 'Missing full-page panel component id.' },
      }
    }
    const rawParams = query.get('params')
    return {
      componentId,
      params: rawParams ? JSON.parse(rawParams) as Record<string, unknown> : {},
    }
  },
}))

async function importSubject() {
  return await import('../CoreWorkspaceAgentFront.js')
}

describe('CoreWorkspaceAgentFront', () => {
  beforeEach(() => {
    currentWorkspaceId = 'workspace-a'
    currentWorkspaceDefaultAgentTypeId = null
    routePath = '/workspace/workspace-a'
    routeStatus = { status: 'matched', workspaceId: 'workspace-a' }
    workspaceAgentProps = null
    workspaceProviderProps = null
    workspaceBootGateProps = null
    workspaceFullPagePanelProps = null
    coreFrontProps = null
    sessionState = { data: { user: { id: 'user-1' } }, isPending: false }
    unstableSessionObject = false
    signInEmailMock.mockClear()
    signUpEmailMock.mockClear()
    navigateMock.mockClear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('injects the routed workspace id into workspace request headers without blocking boot gate', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        agentTypeId="default"
        requestHeaders={{ existing: 'request' }}
        authHeaders={{ existing: 'auth' }}
        apiBaseUrl="/api-base"
        bootPreloadPaths={['/custom-preload']}
      />,
    )

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps?.appTitle).toBe('Test Workspace')
    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'workspace-a',
      workspaceLabel: 'Workspace A',
      requestHeaders: {
        existing: 'request',
        'x-boring-workspace-id': 'workspace-a',
      },
      authHeaders: {
        existing: 'auth',
        'x-boring-workspace-id': 'workspace-a',
      },
      // gh-1402: the workspace-meta call the recovery verdict rides on joins the
      // host's own preload set; it is not a separate per-boot request.
      bootPreloadPaths: ['/custom-preload', '/api/v1/workspace/meta'],
    })
  }, 30_000) // Cold Core composition can exceed 15s under full-suite CI load.

  it('forwards the persisted regular default instead of the app compatibility fallback', async () => {
    currentWorkspaceDefaultAgentTypeId = 'reviewer'
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(<CoreWorkspaceAgentFront agentTypeId="default" />)

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps?.agentTypeId).toBe('reviewer')
  })

  // gh-1402: recovery is mounted reactively off the boot failure the server
  // already produces, and off that one code only.
  it('mounts default-Agent recovery when the workspace boot reports the unavailable seat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        workspaceId: 'workspace-a',
        status: 'unavailable',
        persistedDefaultAgentTypeId: 'retired-seat',
        availableAgents: [{ agentTypeId: 'general', label: 'General' }],
      }),
    })))
    const { CoreWorkspaceAgentFront } = await importSubject()
    render(<CoreWorkspaceAgentFront agentTypeId="default" />)
    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()

    // The boot path already asks for it, so the verdict arrives without any
    // extra request of the recovery feature's own.
    expect(workspaceAgentProps?.bootPreloadPaths).toContain('/api/v1/workspace/meta')

    const onWarmup = workspaceAgentProps?.onWorkspaceWarmupStatusChange as (status: unknown) => void
    await act(async () => {
      onWarmup({ status: 'failed', message: 'Workspace default Agent is unavailable', code: 'default_agent_type_unknown_seat' })
    })

    expect(await screen.findByTestId('workspace-default-agent-recovery')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
  })

  it('leaves an unrelated boot failure to the workspace\'s own error handling', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const { CoreWorkspaceAgentFront } = await importSubject()
    render(<CoreWorkspaceAgentFront agentTypeId="default" />)

    const onWarmup = workspaceAgentProps?.onWorkspaceWarmupStatusChange as (status: unknown) => void
    await act(async () => {
      onWarmup({ status: 'failed', message: 'tree failed with 500' })
    })

    // A generic boot failure must not be dressed up as an Agent problem.
    expect(screen.queryByTestId('workspace-default-agent-recovery')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows apps to suppress the default workspace switcher', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(<CoreWorkspaceAgentFront agentTypeId="default" topBarLeft={null} />)

    expect(screen.getByTestId('workspace-agent-front')).toBeInTheDocument()
    expect(workspaceAgentProps?.topBarLeft).toBeNull()
  })

  it('keeps identity loading/mismatch as the only transition blocker', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    currentWorkspaceId = 'workspace-other'
    routeStatus = { status: 'mismatched', workspaceId: 'workspace-a', currentWorkspaceId: 'workspace-other' } as never

    render(<CoreWorkspaceAgentFront agentTypeId="default" loadingFallback={<div>Loading identity</div>} />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" />)

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
        agentTypeId="default"
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

  it('scopes full-page panel links to the routed workspace', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(<CoreWorkspaceAgentFront agentTypeId="default" />)

    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'workspace-a',
      fullPageBasePath: '/full-page?workspaceId=workspace-a',
    })
  })

  it('renders the core full-page panel route inside workspace providers', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    const plugin = { id: 'deck-plugin' }
    routePath = '/full-page?workspaceId=workspace-a&component=deck&params=%7B%22path%22%3A%22deck%2Fintro.md%22%7D'

    render(
      <CoreWorkspaceAgentFront
        agentTypeId="default"
        plugins={[plugin] as never}
        apiBaseUrl="/api-base"
        requestHeaders={{ request: 'header' }}
        authHeaders={{ existing: 'auth' }}
        providerStorageKey="layout-key"
        bootPreloadPaths={['/api/v1/files?path=deck']}
      />,
    )

    expect(screen.getByTestId('workspace-boot-gate')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-full-page-panel')).toBeInTheDocument()
    expect(workspaceAgentProps).toBeNull()
    expect(workspaceProviderProps).toMatchObject({
      workspaceId: 'workspace-a',
      plugins: [plugin],
      apiBaseUrl: '/api-base',
      authHeaders: {
        request: 'header',
        existing: 'auth',
        'x-boring-workspace-id': 'workspace-a',
      },
      storageKey: 'layout-key',
      manageDocumentTitle: false,
      fullPageBasePath: '/full-page?workspaceId=workspace-a',
    })
    expect(workspaceProviderProps?.frontPluginHotReload).toBe(false)
    expect(workspaceProviderProps?.bridgeEndpoint).toBeNull()
    expect(workspaceBootGateProps).toMatchObject({
      workspaceId: 'workspace-a',
      requestHeaders: {
        request: 'header',
        'x-boring-workspace-id': 'workspace-a',
      },
      apiBaseUrl: '/api-base',
      preloadPaths: ['/api/v1/files?path=deck'],
    })
    expect(workspaceFullPagePanelProps).toEqual({
      componentId: 'deck',
      params: { path: 'deck/intro.md' },
    })
  })

  it('keeps chat-first public shell hidden while auth session is still loading', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: true }
    currentWorkspaceId = null
    routePath = '/workspace/workspace-a'

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" loadingFallback={<div>Checking session</div>} />)

    expect(screen.getByText('Checking session')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
  })

  it('renders the regular workspace shell with sign-in chrome before auth', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" appTitle="Full App" />)

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
        agentTypeId="default"
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

  it('keeps public launch panels scoped out of authenticated workspaces', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    const publicPlugin = { id: 'public-plugin' }
    const publicPanels = [{ id: 'public-landing-page', component: 'public.launch.landing', title: 'Landing page' }]

    render(
      <CoreWorkspaceAgentFront
        agentTypeId="default"
        chatEntryMode="chat-first"
        chatFirstPublicWorkspaceProps={{
          plugins: [publicPlugin] as never,
          surfaceInitialPanels: publicPanels,
        }}
      />,
    )

    expect(workspaceAgentProps).toMatchObject({ workspaceId: 'workspace-a' })
    expect(workspaceAgentProps?.plugins).toBeUndefined()
    expect(workspaceAgentProps?.surfaceInitialPanels).toBeUndefined()

    workspaceAgentProps = null
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'

    render(
      <CoreWorkspaceAgentFront
        agentTypeId="default"
        chatEntryMode="chat-first"
        chatFirstPublicWorkspaceProps={{
          plugins: [publicPlugin] as never,
          surfaceInitialPanels: publicPanels,
        }}
      />,
    )

    expect(workspaceAgentProps).toMatchObject({
      workspaceId: 'public',
      plugins: [publicPlugin],
      surfaceInitialPanels: publicPanels,
      defaultAppLeftPaneCollapsed: true,
    })
  })

  it('signs in from the chat-first auth overlay without a hard browser reload', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    sessionState = { data: null, isPending: false }
    currentWorkspaceId = null
    routePath = '/'
    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!)
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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" />)

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
  })

  it('restores a pending chat-first draft after auth reaches the workspace shell', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()
    window.sessionStorage.setItem('boring:pending-chat-entry', JSON.stringify({
      draft: 'Restore this',
      returnTo: '/',
      createdAt: Date.now(),
    }))

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" />)

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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" />)

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
        agentTypeId="default"
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
        agentTypeId="default"
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

    render(<CoreWorkspaceAgentFront agentTypeId="default" chatEntryMode="chat-first" loadingFallback={<div>Loading identity</div>} />)

    expect(screen.getByText('Loading identity')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-agent-front')).not.toBeInTheDocument()
  })

  it('forces front plugin hot reload off while forwarding workspace props', async () => {
    const { CoreWorkspaceAgentFront } = await importSubject()

    render(
      <CoreWorkspaceAgentFront
        agentTypeId="default"
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
        agentTypeId="default"
        hotReload={true as false}
      />,
    )).toThrow(/does not support hotReload/)
  })
})
