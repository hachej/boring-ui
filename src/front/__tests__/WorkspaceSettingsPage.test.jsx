import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkspaceSettingsPage from '../pages/WorkspaceSettingsPage'

// Mock transport
const mockApiFetchJson = vi.fn()
vi.mock('../utils/transport', () => ({
  apiFetchJson: (...args) => mockApiFetchJson(...args),
}))

// Mock apiBase
vi.mock('../utils/apiBase', () => ({
  buildApiUrl: (path, query) => path,
}))

// Mock ThemeToggle
vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

const WORKSPACE_ID = 'ws-test-456'

function mockSuccessfulLoad(overrides = {}) {
  const workspaceName = overrides.workspaceName || 'Test Workspace'
  const runtimeState = overrides.runtimeState || 'ready'
  const settings = overrides.settings || {}

  mockApiFetchJson
    // list workspaces
    .mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: {
        workspaces: [{ id: WORKSPACE_ID, name: workspaceName }],
      },
    })
    // runtime
    .mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: { runtime: { state: runtimeState, ...overrides.runtime } },
    })
    // settings
    .mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: { settings },
    })
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockApiFetchJson.mockReset()
  })

  it('shows loading state initially', () => {
    mockApiFetchJson.mockReturnValue(new Promise(() => {}))
    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)
    expect(screen.getByText('Loading workspace settings...')).toBeInTheDocument()
  })

  it('renders general section with workspace name', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('General')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Test Workspace')).toBeInTheDocument()
  })

  it('renders workspace ID (disabled) with copy button', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue(WORKSPACE_ID)).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue(WORKSPACE_ID)).toBeDisabled()
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  it('copies workspace ID to clipboard', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Copy'))

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('edits workspace name and saves', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Workspace')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('Test Workspace')
    fireEvent.change(nameInput, { target: { value: 'Renamed Workspace' } })
    expect(nameInput.value).toBe('Renamed Workspace')

    // Mock the save response
    mockApiFetchJson.mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: {},
    })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(screen.getByText('Workspace name saved')).toBeInTheDocument()
    })

    // Verify save API call
    const saveCalls = mockApiFetchJson.mock.calls.filter(
      (c) => c[0] === `/api/v1/workspaces/${WORKSPACE_ID}` && c[1]?.method === 'PATCH'
    )
    expect(saveCalls).toHaveLength(1)
    expect(JSON.parse(saveCalls[0][1].body)).toEqual({ name: 'Renamed Workspace' })
  })

  it('disables save button when name is empty', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Workspace')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('Test Workspace')
    fireEvent.change(nameInput, { target: { value: '' } })

    expect(screen.getByText('Save')).toBeDisabled()
  })

  it('renders runtime section with status badge', async () => {
    mockSuccessfulLoad({ runtimeState: 'ready' })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Runtime')).toBeInTheDocument()
    })
    expect(screen.getByText('ready')).toBeInTheDocument()
  })

  it('shows retry button when runtime is in error state', async () => {
    mockSuccessfulLoad({
      runtimeState: 'error',
      runtime: { state: 'error', retryable: true, last_error: 'Provisioning failed' },
    })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })
    expect(screen.getByText('Provisioning failed')).toBeInTheDocument()
  })

  it('retries runtime when clicking retry', async () => {
    mockSuccessfulLoad({
      runtimeState: 'error',
      runtime: { state: 'error', retryable: true },
    })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    mockApiFetchJson.mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: { runtime: { state: 'provisioning' } },
    })

    fireEvent.click(screen.getByText('Retry'))

    // After retry, runtime state becomes 'provisioning' which is excluded from
    // hasRuntime, so the Runtime section hides. Verify the retry API was called.
    await waitFor(() => {
      expect(screen.queryByText('error')).not.toBeInTheDocument()
    })
    const retryCalls = mockApiFetchJson.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('/runtime/retry')
    )
    expect(retryCalls).toHaveLength(1)
  })

  it('shows sprite URL when available', async () => {
    mockSuccessfulLoad({
      runtimeState: 'ready',
      runtime: { state: 'ready', sprite_url: 'https://sprite.example.com' },
    })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://sprite.example.com')).toBeInTheDocument()
    })
  })

  it('renders configuration section when settings exist', async () => {
    mockSuccessfulLoad({
      settings: {
        ANTHROPIC_API_KEY: { updated_at: '2026-01-01T00:00:00Z' },
        DATABASE_URL: { updated_at: '2026-02-01T00:00:00Z' },
      },
    })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument()
    })
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(screen.getByText('DATABASE_URL')).toBeInTheDocument()
  })

  it('hides configuration section when no settings', async () => {
    mockSuccessfulLoad({ settings: {} })

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('General')).toBeInTheDocument()
    })
    expect(screen.queryByText('Configuration')).not.toBeInTheDocument()
  })

  it('renders danger zone with delete button', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Danger Zone')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeInTheDocument()
  })

  it('shows delete confirmation dialog', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }))

    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('cancels delete confirmation', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }))
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Confirm Delete')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Workspace' })).toBeInTheDocument()
  })

  it('shows error on load failure', async () => {
    mockApiFetchJson.mockRejectedValue(new Error('Network error'))

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load workspace data')).toBeInTheDocument()
    })
  })

  it('shows back link to workspace scope', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('General')).toBeInTheDocument()
    })

    const backLink = screen.getByText('Back to workspace')
    expect(backLink.closest('a')).toHaveAttribute('href', `/w/${WORKSPACE_ID}/`)
  })

  it('shows page title with workspace name and Settings', async () => {
    mockSuccessfulLoad()

    render(<WorkspaceSettingsPage workspaceId={WORKSPACE_ID} />)

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
    // The header title is composed: WorkspaceSwitcher / Settings
    expect(screen.getByText('Test Workspace')).toBeInTheDocument()
  })
})
