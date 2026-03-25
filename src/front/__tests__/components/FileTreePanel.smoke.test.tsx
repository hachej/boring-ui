import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import paneRegistry from '../../registry/panes'
import FileTreePanel from '../../panels/FileTreePanel'

const mockGitInitMutate = vi.fn()
const mockGitHubConnect = vi.fn()

vi.mock('../../components/FileTree', () => ({
  default: () => <div data-testid="file-tree">File tree</div>,
}))

vi.mock('../../components/GitChangesView', () => ({
  default: () => <div data-testid="git-changes-view">Git changes</div>,
}))

vi.mock('../../components/UserMenu', () => ({
  default: ({ collapsed = false }: { collapsed?: boolean }) => (
    <div data-testid={collapsed ? 'user-menu-collapsed' : 'user-menu-expanded'}>User menu</div>
  ),
}))

vi.mock('../../components/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../components/SyncStatusFooter', () => ({
  default: () => <div data-testid="sync-status-footer">Sync status footer</div>,
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
  collapsed: false,
  onToggleCollapse: vi.fn(),
  showSidebarToggle: true,
  appName: 'Boring UI',
  onOpenChatTab: vi.fn(),
  sectionCollapsed: false,
  onToggleSection: vi.fn(),
  onActivateSidebarPanel: vi.fn(),
  activeSidebarPanelId: 'filetree',
  filetreeActivityIntent: null,
  userEmail: 'john@example.com',
  workspaceName: 'My Workspace',
  workspaceId: 'ws-123',
  onSwitchWorkspace: vi.fn(),
  showSwitchWorkspace: true,
  workspaceOptions: [],
  onCreateWorkspace: vi.fn(),
  onOpenUserSettings: vi.fn(),
  onOpenWorkspaceSettings: vi.fn(),
  onLogout: vi.fn(),
  userMenuStatusMessage: '',
  userMenuStatusTone: 'neutral',
  onUserMenuRetry: vi.fn(),
  userMenuDisabledActions: [],
  githubEnabled: false,
  dataBackend: 'lightningfs',
  ...overrides,
})

describe('FileTreePanel smoke', () => {
  beforeEach(() => {
    mockGitInitMutate.mockClear()
    mockGitHubConnect.mockClear()
  })

  it('keeps the filetree pane registry contract stable', () => {
    const config = paneRegistry.get('filetree')

    expect(config).toBeDefined()
    expect(config).toMatchObject({
      id: 'filetree',
      essential: true,
      placement: 'left',
      requiresFeatures: ['files'],
    })
  })

  it('renders the expanded structural shell', () => {
    const { container } = render(<FileTreePanel params={makeParams()} />)

    expect(container.querySelector('.panel-content.filetree-panel')).toBeInTheDocument()
    expect(container.querySelector('.filetree-body')).toBeInTheDocument()
    expect(container.querySelector('.filetree-footer')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu-expanded')).toBeInTheDocument()
  })

  it('renders the collapsed activity rail with the expected actions', () => {
    const onActivateSidebarPanel = vi.fn()
    const { container } = render(
      <FileTreePanel
        params={makeParams({
          collapsed: true,
          activeSidebarPanelId: 'filetree',
          onActivateSidebarPanel,
        })}
      />,
    )

    expect(container.querySelector('.filetree-collapsed')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu-collapsed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Data Catalog' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Git Changes' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Quick Search' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    fireEvent.click(screen.getByRole('button', { name: 'Data Catalog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Git Changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quick Search' }))

    expect(onActivateSidebarPanel).toHaveBeenNthCalledWith(1, 'filetree', { mode: 'files' })
    expect(onActivateSidebarPanel).toHaveBeenNthCalledWith(2, 'data-catalog', {})
    expect(onActivateSidebarPanel).toHaveBeenNthCalledWith(3, 'filetree', { mode: 'changes' })
    expect(onActivateSidebarPanel).toHaveBeenNthCalledWith(4, 'filetree', { mode: 'search' })
  })

  it('hides the filetree body when the section is collapsed', () => {
    const { container } = render(
      <FileTreePanel params={makeParams({ sectionCollapsed: true })} />,
    )

    expect(container.querySelector('.filetree-section-collapsed')).toBeInTheDocument()
    expect(container.querySelector('.filetree-body')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument()
  })

  it('switches between file and git-changes modes via panel intent', () => {
    const { rerender } = render(<FileTreePanel params={makeParams()} />)

    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.queryByTestId('git-changes-view')).not.toBeInTheDocument()

    rerender(
      <FileTreePanel
        params={makeParams({
          activeSidebarPanelId: 'filetree',
          filetreeActivityIntent: { panelId: 'filetree', mode: 'changes' },
        })}
      />,
    )

    expect(screen.getByTestId('git-changes-view')).toBeInTheDocument()
    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument()
  })
})
