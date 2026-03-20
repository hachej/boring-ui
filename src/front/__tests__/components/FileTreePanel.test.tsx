import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileTreePanel from '../../panels/FileTreePanel'

let mockGitStatus = { is_repo: true }
const mockGitInitMutate = vi.fn()
const mockGitHubConnection = {
  status: null,
  connect: vi.fn(),
}
const mockLightningFsBootstrap = {
  state: 'disabled',
  message: '',
  error: '',
  busy: false,
  syncReady: false,
  remoteOpts: undefined,
  retry: vi.fn(),
}

vi.mock('../../components/FileTree', () => ({
  default: () => <div data-testid="file-tree">File tree</div>,
}))

vi.mock('../../components/GitChangesView', () => ({
  default: () => <div data-testid="git-changes-view">Git changes</div>,
}))

vi.mock('../../providers/data', () => ({
  useGitStatus: () => ({ isLoading: false, isFetching: false, data: mockGitStatus }),
  useGitInit: () => ({ mutate: mockGitInitMutate, isPending: false }),
  useGitBranch: () => ({ data: 'main' }),
}))

vi.mock('../../hooks/useAutoSync', () => ({
  useAutoSync: () => ({ state: 'disabled', lastError: null, syncNow: () => {} }),
}))

vi.mock('../../providers/data/DataContext', () => ({
  useDataProvider: () => ({
    git: {
      branches: vi.fn(async () => ({ branches: [] })),
      checkout: vi.fn(async () => {}),
      createBranch: vi.fn(async () => {}),
    },
  }),
}))

vi.mock('../../components/GitHubConnect', () => ({
  useGitHubConnection: () => mockGitHubConnection,
}))

vi.mock('../../hooks/useLightningFsGitBootstrap', () => ({
  useLightningFsGitBootstrap: () => mockLightningFsBootstrap,
}))

vi.mock('../../components/UserMenu', () => ({
  default: ({ collapsed = false }: { collapsed?: boolean }) => (
    <div data-testid={collapsed ? 'user-menu-collapsed' : 'user-menu-expanded'}>User menu</div>
  ),
}))

const makeParams = (overrides = {}) => ({
  onOpenFile: vi.fn(),
  onOpenFileToSide: vi.fn(),
  onOpenDiff: vi.fn(),
  projectRoot: '.',
  activeFile: null,
  activeDiffFile: null,
  collapsed: false,
  onToggleCollapse: vi.fn(),
  userEmail: 'john@example.com',
  workspaceName: 'My Workspace',
  workspaceId: 'ws-123',
  onSwitchWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
  onOpenUserSettings: vi.fn(),
  onLogout: vi.fn(),
  githubEnabled: false,
  dataBackend: 'lightningfs',
  ...overrides,
})

describe('FileTreePanel', () => {
  it('auto-initializes local git for lightningfs workspaces', () => {
    mockGitStatus = { is_repo: false }
    mockGitInitMutate.mockClear()

    render(<FileTreePanel params={makeParams({ dataBackend: 'lightningfs' })} />)

    expect(mockGitInitMutate).toHaveBeenCalledTimes(1)
  })

  it('does not auto-initialize git for http workspaces', () => {
    mockGitStatus = { is_repo: false }
    mockGitInitMutate.mockClear()

    render(<FileTreePanel params={makeParams({ dataBackend: 'http' })} />)

    expect(mockGitInitMutate).not.toHaveBeenCalled()
  })

  it('does not auto-initialize local git when a GitHub repo is already selected', () => {
    mockGitStatus = { is_repo: false }
    mockGitInitMutate.mockClear()
    mockGitHubConnection.status = {
      configured: true,
      connected: true,
      installation_connected: true,
      repo_selected: true,
      repo_url: 'https://github.com/boringdata/boring-ui-repo.git',
    }

    render(<FileTreePanel params={makeParams({ dataBackend: 'lightningfs', githubEnabled: true })} />)

    expect(mockGitInitMutate).not.toHaveBeenCalled()
    mockGitHubConnection.status = null
  })

  it('renders the GitHub footer affordance before the local repo exists', () => {
    mockGitStatus = { is_repo: false }
    mockGitInitMutate.mockClear()
    mockGitHubConnection.status = {
      configured: true,
      connected: true,
      installation_connected: true,
      repo_selected: true,
      repo_url: 'https://github.com/boringdata/boring-ui-repo.git',
    }
    mockLightningFsBootstrap.state = 'needs-clone'
    mockLightningFsBootstrap.message = 'Loading the selected GitHub repo into this workspace.'
    mockLightningFsBootstrap.syncReady = false

    render(<FileTreePanel params={makeParams({ githubEnabled: true })} />)

    expect(screen.getByLabelText('Connect and sync GitHub repo')).toBeInTheDocument()
  })

  it('renders user menu in footer when expanded', () => {
    mockGitStatus = { is_repo: true }
    mockGitInitMutate.mockClear()
    mockGitHubConnection.status = null
    mockLightningFsBootstrap.state = 'disabled'
    mockLightningFsBootstrap.message = ''
    mockLightningFsBootstrap.error = ''
    mockLightningFsBootstrap.busy = false
    mockLightningFsBootstrap.syncReady = false

    const { container } = render(<FileTreePanel params={makeParams()} />)

    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu-expanded')).toBeInTheDocument()
    expect(container.querySelector('.filetree-footer')).toBeInTheDocument()
    expect(container.querySelector('.filetree-body')).toBeInTheDocument()
  })

  it('switches from file tree to git changes view', () => {
    mockGitStatus = { is_repo: true }
    mockGitInitMutate.mockClear()
    render(<FileTreePanel params={makeParams()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Git changes view' }))
    expect(screen.getByTestId('git-changes-view')).toBeInTheDocument()
  })

  it('renders compact user menu when collapsed', () => {
    mockGitStatus = { is_repo: true }
    mockGitInitMutate.mockClear()
    render(<FileTreePanel params={makeParams({ collapsed: true })} />)

    expect(screen.getByTestId('user-menu-collapsed')).toBeInTheDocument()
    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument()
  })
})
