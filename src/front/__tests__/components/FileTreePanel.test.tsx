import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileTreePanel from '../../panels/FileTreePanel'

vi.mock('../../components/FileTree', () => ({
  default: () => <div data-testid="file-tree">File tree</div>,
}))

vi.mock('../../components/GitChangesView', () => ({
  default: () => <div data-testid="git-changes-view">Git changes</div>,
}))

vi.mock('../../providers/data', () => ({
  useGitStatus: () => ({ isLoading: false, isFetching: false, data: { is_repo: true } }),
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
  ...overrides,
})

describe('FileTreePanel', () => {
  it('renders user menu in footer when expanded', () => {
    const { container } = render(<FileTreePanel params={makeParams()} />)

    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu-expanded')).toBeInTheDocument()
    expect(container.querySelector('.filetree-footer')).toBeInTheDocument()
    expect(container.querySelector('.filetree-body')).toBeInTheDocument()
  })

  it('switches from file tree to git changes view', () => {
    render(<FileTreePanel params={makeParams()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Git changes view' }))
    expect(screen.getByTestId('git-changes-view')).toBeInTheDocument()
  })

  it('renders compact user menu when collapsed', () => {
    render(<FileTreePanel params={makeParams({ collapsed: true })} />)

    expect(screen.getByTestId('user-menu-collapsed')).toBeInTheDocument()
    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument()
  })
})
