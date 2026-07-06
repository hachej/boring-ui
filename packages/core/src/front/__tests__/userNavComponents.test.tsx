// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import type { Workspace } from '../../shared/types'
import { useMswHandler } from './_setup'
import { CompanyAdminProvider, type CompanyAdminStatus } from '../CompanyAdminProvider'
import { ThemeToggle } from '../components/ThemeToggle'
import { UserMenu } from '../components/UserMenu'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'

const BEAD_ID = 'boring-ui-v2-3odq'

const mockNavigate = vi.fn()
const mockUseUser = vi.fn()
const mockSignOut = vi.fn()
const mockUseCurrentWorkspace = vi.fn()
const mockUseWorkspaceRole = vi.fn()
const mockUseTheme = vi.fn()
const mockToast = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../auth/index', async () => {
  const actual = await vi.importActual<typeof import('../auth/index')>('../auth/index')
  return {
    ...actual,
    useUser: () => mockUseUser(),
    useSignOut: () => mockSignOut,
  }
})

vi.mock('../WorkspaceAuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../WorkspaceAuthProvider')>('../WorkspaceAuthProvider')
  return {
    ...actual,
    useCurrentWorkspace: () => mockUseCurrentWorkspace(),
    useWorkspaceRole: () => mockUseWorkspaceRole(),
  }
})

vi.mock('../hooks/index', async () => {
  const actual = await vi.importActual<typeof import('../hooks/index')>('../hooks/index')
  return {
    ...actual,
    useTheme: () => mockUseTheme(),
  }
})

vi.mock('@hachej/boring-ui-kit', async () => {
  const actual = await vi.importActual<typeof import('@hachej/boring-ui-kit')>('@hachej/boring-ui-kit')
  return {
    ...actual,
    useToast: () => ({ toast: mockToast }),
  }
})

const renderEmptyAdminContent = () => null

const WORKSPACES: Workspace[] = [
  {
    id: 'ws-a',
    appId: 'test-app',
    name: 'Workspace A',
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    isDefault: true,
  },
  {
    id: 'ws-b',
    appId: 'test-app',
    name: 'Workspace B',
    createdBy: 'user-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    isDefault: false,
  },
  {
    id: 'ws-c',
    appId: 'test-app',
    name: 'Workspace C',
    createdBy: 'user-1',
    createdAt: '2026-01-03T00:00:00.000Z',
    deletedAt: null,
    isDefault: false,
  },
]

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderWithProviders(ui: ReactNode, queryClient?: QueryClient) {
  const client = queryClient ?? createQueryClient()

  return {
    queryClient: client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function mockWorkspacesApi(options: {
  workspaces?: Workspace[]
  createResponse?: { status: number; body: Record<string, unknown> }
}) {
  const list = options.workspaces ?? WORKSPACES

  useMswHandler(async (input, init) => {
    const method = requestMethod(input, init)
    const url = requestUrl(input)

    if (url.endsWith('/api/v1/workspaces') && method === 'GET') {
      return new Response(JSON.stringify({ workspaces: list }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (url.endsWith('/api/v1/workspaces') && method === 'POST' && options.createResponse) {
      return new Response(JSON.stringify(options.createResponse.body), {
        status: options.createResponse.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    return undefined
  })
}

beforeEach(() => {
  mockNavigate.mockReset()
  mockUseUser.mockReset()
  mockSignOut.mockReset()
  mockUseCurrentWorkspace.mockReset()
  mockUseWorkspaceRole.mockReset()
  mockUseTheme.mockReset()
  mockToast.mockReset()

  mockUseUser.mockReturnValue({
    user: {
      id: 'user-1',
      email: 'menu-user@boring.dev',
      name: 'Menu User',
      image: null,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {
      displayName: 'Menu User',
      email: 'menu-user@boring.dev',
      settings: {},
    },
  })

  mockSignOut.mockResolvedValue(undefined)
  mockUseCurrentWorkspace.mockReturnValue(WORKSPACES[0])
  mockUseWorkspaceRole.mockReturnValue('owner')
  mockUseTheme.mockReturnValue({
    theme: 'light',
    preference: 'light',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserMenu', () => {
  async function settleLoadStatus(loadStatus: ReturnType<typeof vi.fn>) {
    await waitFor(() => expect(loadStatus).toHaveBeenCalledTimes(1))
    const result = loadStatus.mock.results[0]
    if (result?.type === 'return') {
      await act(async () => {
        await (result.value as Promise<unknown>).catch(() => undefined)
      })
    }
  }

  it(
    'renders signed-in user name/email and signs out to /auth/signin',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      renderWithProviders(<UserMenu />)

      fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

      expect(await screen.findByText('Menu User')).toBeInTheDocument()
      expect(screen.getByText('menu-user@boring.dev')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Light' })).toHaveAttribute('data-current', 'true')
      expect(screen.getByRole('menuitem', { name: 'User settings' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Create workspace' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Workspace settings' })).toBeNull()
      assertionPassed('user-menu-renders-user')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledTimes(1)
      })
      expect(mockNavigate).toHaveBeenCalledWith('/auth/signin')
      assertionPassed('user-menu-signout-navigates')
    }),
  )

  it('shows the default admin entry for provider admins even when they are not workspace owners', async () => {
    mockUseWorkspaceRole.mockReturnValue('editor')
    const status: CompanyAdminStatus = { enabled: true, role: 'admin', admin: true }
    const loadStatus = vi.fn(async () => status)
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument()
  })

  it('uses provider menu labels and navigates provider admins to the admin route', async () => {
    const status: CompanyAdminStatus = { enabled: true, role: 'admin', admin: true }
    const loadStatus = vi.fn(async () => status)
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent} labels={{ menuLabel: 'Company Admin' }}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Company Admin' }))

    expect(mockNavigate).toHaveBeenCalledWith('/w/ws-a/admin')
  })

  it('hides the admin entry when the provider reports a disabled surface', async () => {
    const status: CompanyAdminStatus = { enabled: false, role: 'admin', admin: true }
    const loadStatus = vi.fn(async () => status)
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'User settings' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull()
  })

  it('hides the admin entry when the provider reports a non-admin user', async () => {
    const status: CompanyAdminStatus = { enabled: true, role: 'user', admin: false }
    const loadStatus = vi.fn(async () => status)
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'User settings' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull()
  })

  it('hides the admin entry when the provider resolves without a status', async () => {
    const loadStatus = vi.fn(async () => null)
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'User settings' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull()
  })

  it('shows the admin entry while provider status is pending', async () => {
    const loadStatus = vi.fn(() => new Promise<CompanyAdminStatus | null>(() => {}))
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )

    await waitFor(() => expect(loadStatus).toHaveBeenCalledTimes(1))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument()
  })

  it('shows the admin entry when the provider status check fails', async () => {
    const loadStatus = vi.fn(async () => { throw new Error('Status check failed') })
    renderWithProviders(
      <CompanyAdminProvider loadStatus={loadStatus} renderContent={renderEmptyAdminContent}>
        <UserMenu />
      </CompanyAdminProvider>,
    )
    await settleLoadStatus(loadStatus)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'User menu' }))

    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument()
  })
})

describe('WorkspaceSwitcher', () => {
  it(
    'lists workspaces and includes create workspace action',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockWorkspacesApi({ workspaces: WORKSPACES })
      renderWithProviders(<WorkspaceSwitcher />)

      const trigger = await screen.findByRole('button', { name: 'Workspace menu: Workspace A' })
      expect(trigger).toHaveTextContent('Workspace A')
      expect(trigger).not.toHaveTextContent('Boring UI')
      fireEvent.pointerDown(trigger)

      expect(await screen.findByRole('menuitem', { name: 'Workspace A' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Workspace B' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Workspace C' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Workspace settings' })).toBeInTheDocument()
      assertionPassed('workspace-switcher-list-and-create-item')
    }),
  )

  it(
    'navigates to selected workspace and marks current workspace',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockWorkspacesApi({ workspaces: WORKSPACES })
      renderWithProviders(<WorkspaceSwitcher />)

      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Workspace menu: Workspace A' }))

      const currentItem = await screen.findByRole('menuitem', { name: 'Workspace A' })
      expect(currentItem).toHaveAttribute('data-current', 'true')
      assertionPassed('workspace-switcher-current-highlight')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace B' }))
      expect(mockNavigate).toHaveBeenCalledWith('/workspace/ws-b')
      assertionPassed('workspace-switcher-selection-navigates')
    }),
  )

  it(
    'creates workspace, invalidates query, closes modal, and navigates to new workspace',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockWorkspacesApi({
        workspaces: WORKSPACES,
        createResponse: {
          status: 201,
          body: {
            workspace: {
              ...WORKSPACES[0],
              id: 'ws-new',
              name: 'My App',
              isDefault: false,
            },
            role: 'owner',
          },
        },
      })

      const queryClient = createQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderWithProviders(<WorkspaceSwitcher />, queryClient)

      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Workspace menu: Workspace A' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Create workspace' }))

      expect(await screen.findByRole('heading', { name: 'Create workspace' })).toBeInTheDocument()
      const input = screen.getByLabelText('Name')
      fireEvent.change(input, { target: { value: 'My App' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/workspace/ws-new')
      })
      expect(queryClient.getQueryData(['workspace', 'ws-new'])).toMatchObject({
        workspace: { id: 'ws-new', name: 'My App' },
        role: 'owner',
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace', 'ws-new'] })
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Create workspace' })).toBeNull()
      })
      assertionPassed('workspace-create-happy-path')
    }),
  )

  it(
    'validates name, disables empty submit, and toasts on 400 create error',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockWorkspacesApi({
        workspaces: WORKSPACES,
        createResponse: {
          status: 400,
          body: {
            code: 'validation_failed',
            message: 'Workspace name already exists',
          },
        },
      })

      renderWithProviders(<WorkspaceSwitcher />)

      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Workspace menu: Workspace A' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Create workspace' }))

      const submit = await screen.findByRole('button', { name: 'Create workspace' })
      expect(submit).toBeDisabled()
      assertionPassed('workspace-create-empty-disabled')

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(101) } })
      expect(await screen.findByRole('alert')).toHaveTextContent('100 characters or fewer')
      assertionPassed('workspace-create-zod-max')

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Valid Name' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }))

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledTimes(1)
      })
      assertionPassed('workspace-create-400-toast')
    }),
  )

  it(
    'shows empty-state CTA when no workspaces are available',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockWorkspacesApi({ workspaces: [] })
      renderWithProviders(<WorkspaceSwitcher />)

      expect(await screen.findByRole('button', { name: 'Create your first workspace' })).toBeInTheDocument()
      assertionPassed('workspace-switcher-empty-state-cta')
    }),
  )
})

describe('ThemeToggle', () => {
  it(
    'cycles light → dark → system → light',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      let preference: 'light' | 'dark' | 'system' = 'light'
      const setTheme = vi.fn((next: 'light' | 'dark' | 'system') => {
        preference = next
      })

      mockUseTheme.mockImplementation(() => ({
        theme: preference === 'system' ? 'light' : preference,
        preference,
        setTheme,
        toggleTheme: vi.fn(),
      }))

      const { rerender } = renderWithProviders(<ThemeToggle />)

      fireEvent.click(screen.getByRole('button', { name: 'Theme toggle' }))
      expect(setTheme).toHaveBeenNthCalledWith(1, 'dark')
      assertionPassed('theme-toggle-light-to-dark')

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <ThemeToggle />
          </MemoryRouter>
        </QueryClientProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Theme toggle' }))
      expect(setTheme).toHaveBeenNthCalledWith(2, 'system')
      assertionPassed('theme-toggle-dark-to-system')

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <ThemeToggle />
          </MemoryRouter>
        </QueryClientProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Theme toggle' }))
      expect(setTheme).toHaveBeenNthCalledWith(3, 'light')
      assertionPassed('theme-toggle-system-to-light')
    }),
  )
})
