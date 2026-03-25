/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import '../setup.ts'
import { fireEvent, render, screen } from '@testing-library/react'
import FileTreePanel from '../../panels/FileTreePanel'
import { ThemeProvider } from '../../hooks/useTheme'
import { routes } from '../../utils/routes'

const mockGitInitMutate = vi.fn()
const mockGitHubConnect = vi.fn()

vi.mock('../../components/FileTree', () => ({
  default: () => <div data-testid="file-tree">File tree</div>,
}))

vi.mock('../../components/GitChangesView', () => ({
  default: () => <div data-testid="git-changes-view">Git changes</div>,
}))

vi.mock('../../providers/data', () => ({
  useGitStatus: () => ({
    data: { is_repo: true, available: true },
    isLoading: false,
    isFetching: false,
  }),
  useGitInit: () => ({
    mutate: mockGitInitMutate,
    isPending: false,
  }),
}))

vi.mock('../../components/GitHubConnect', () => ({
  useGitHubConnection: () => ({
    status: null,
    connect: mockGitHubConnect,
  }),
}))

vi.mock('../../hooks/useLightningFsGitBootstrap', () => ({
  useLightningFsGitBootstrap: () => ({
    state: 'disabled',
    message: '',
    error: '',
    busy: false,
    syncReady: false,
    remoteOpts: undefined,
    retry: vi.fn(),
  }),
}))

const makeParams = (overrides = {}) => ({
  onOpenFile: vi.fn(),
  onOpenFileToSide: vi.fn(),
  onOpenDiff: vi.fn(),
  projectRoot: '.',
  activeFile: null,
  activeDiffFile: null,
  collapsed: true,
  onToggleCollapse: vi.fn(),
  userEmail: 'john@example.com',
  userMenuStatusMessage: '',
  userMenuStatusTone: 'error',
  onUserMenuRetry: vi.fn(),
  userMenuDisabledActions: [],
  workspaceName: 'my-workspace',
  workspaceId: 'ws-123',
  showSwitchWorkspace: true,
  workspaceOptions: [
    { workspace_id: 'ws-999', name: 'other-workspace' },
  ],
  onSwitchWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
  onOpenUserSettings: vi.fn(),
  onLogout: vi.fn(),
  ...overrides,
})

const renderWithTheme = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('FileTreePanel + UserMenu integration', () => {
  it('renders real collapsed menu and triggers action callbacks', async () => {
    const params = makeParams()
    renderWithTheme(<FileTreePanel params={params} />)

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('my-workspace')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }))
    expect(params.onLogout).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders switch-workspace submenu links and preserves create/settings callback context', async () => {
    const params = makeParams()
    renderWithTheme(<FileTreePanel params={params} />)

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace' }))
    expect(screen.getByRole('link', { name: 'other-workspace' })).toHaveAttribute(
      'href',
      routes.controlPlane.workspaces.scope('ws-999').path,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }))
    expect(params.onCreateWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-123' })

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'User settings' }))
    expect(params.onOpenUserSettings).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
  })

  it('renders status banner and retry wiring when provided by parent', async () => {
    const params = makeParams({
      userMenuStatusMessage: 'Control plane unreachable.',
      userMenuDisabledActions: ['switch'],
    })
    renderWithTheme(<FileTreePanel params={params} />)

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Control plane unreachable.')
    expect(screen.getByRole('menuitem', { name: 'Switch workspace' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(params.onUserMenuRetry).toHaveBeenCalledTimes(1)
  })
})
