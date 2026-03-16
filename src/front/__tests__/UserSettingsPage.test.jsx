import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import UserSettingsPage from '../pages/UserSettingsPage'

// Mock transport
const mockApiFetchJson = vi.fn()
vi.mock('../utils/transport', () => ({
  apiFetchJson: (...args) => mockApiFetchJson(...args),
}))

// Mock apiBase
vi.mock('../utils/apiBase', () => ({
  buildApiUrl: (path, _query) => path,
}))

// Mock ThemeToggle
vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

// Mock useTheme
const mockToggleTheme = vi.fn()
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: mockToggleTheme }),
}))

const mockListPiProviderKeyStatus = vi.fn()
const mockMaskPiProviderKey = vi.fn()
const mockSetPiProviderKey = vi.fn()
const mockRemovePiProviderKey = vi.fn()
const mockResolvePiProviderKeyScope = vi.fn()
vi.mock('../providers/pi/providerKeys', () => ({
  listPiProviderKeyStatus: (...args) => mockListPiProviderKeyStatus(...args),
  maskPiProviderKey: (...args) => mockMaskPiProviderKey(...args),
  setPiProviderKey: (...args) => mockSetPiProviderKey(...args),
  removePiProviderKey: (...args) => mockRemovePiProviderKey(...args),
  resolvePiProviderKeyScope: (...args) => mockResolvePiProviderKeyScope(...args),
}))

const defaultProviderKeys = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Used for Claude models and the default agent setup.',
    hasKey: false,
    maskedKey: '',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Used when you switch the agent to an OpenAI-backed model.',
    hasKey: false,
    maskedKey: '',
  },
  {
    id: 'google',
    label: 'Google',
    description: 'Used when you switch the agent to a Gemini-backed model.',
    hasKey: false,
    maskedKey: '',
  },
]

describe('UserSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockApiFetchJson.mockReset()
    mockListPiProviderKeyStatus.mockReset()
    mockMaskPiProviderKey.mockReset()
    mockSetPiProviderKey.mockReset()
    mockRemovePiProviderKey.mockReset()
    mockResolvePiProviderKeyScope.mockReset()
    mockListPiProviderKeyStatus.mockResolvedValue(defaultProviderKeys)
    mockMaskPiProviderKey.mockImplementation((value) => {
      const key = String(value || '').trim()
      if (!key) return ''
      if (key.length <= 4) return '••••'
      if (key.length <= 12) return `${key.slice(0, 2)}...${key.slice(-2)}`
      return `${key.slice(0, 4)}...${key.slice(-4)}`
    })
    mockSetPiProviderKey.mockResolvedValue({})
    mockRemovePiProviderKey.mockResolvedValue({})
    mockResolvePiProviderKeyScope.mockImplementation((scope) => (scope ? `scope:${scope}` : 'scope:anon-local'))
  })

  it('shows loading state initially', () => {
    mockApiFetchJson.mockReturnValue(new Promise(() => {})) // never resolves
    render(<UserSettingsPage />)
    expect(screen.getByText('Loading settings...')).toBeInTheDocument()
  })

  it('renders profile section when authenticated', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { email: 'user@test.com', display_name: 'Test User' },
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('user@test.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test User')).toBeInTheDocument()
  })

  it('email field is disabled (read-only)', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { email: 'user@test.com', display_name: '' },
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('user@test.com')).toBeDisabled()
    })
  })

  it('hides profile and account sections when not authenticated (401)', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })
    expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Account')).not.toBeInTheDocument()
  })

  it('renders appearance section with theme toggle', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })
    expect(screen.getByText('Light')).toBeInTheDocument()
  })

  it('renders agent API key management for locally saved keys', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })
    mockListPiProviderKeyStatus.mockResolvedValue([
      {
        ...defaultProviderKeys[0],
        hasKey: true,
        maskedKey: 'sk-a...1234',
      },
      ...defaultProviderKeys.slice(1),
    ])

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Agent API Keys')).toBeInTheDocument()
    })
    expect(screen.getByText('Saved locally as sk-a...1234')).toBeInTheDocument()
    expect(screen.getByText('If Anthropic still reports low credit after you top up or rotate the key, replace or remove the saved key here before starting another agent chat.')).toBeInTheDocument()
  })

  it('toggles theme when clicking theme button', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Light'))
    expect(mockToggleTheme).toHaveBeenCalled()
  })

  it('edits display name and saves', async () => {
    mockApiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { user_id: 'user-123', email: 'user@test.com', display_name: 'Old Name' },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: {},
      })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old Name')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('Old Name')
    fireEvent.change(nameInput, { target: { value: 'New Name' } })
    expect(nameInput.value).toBe('New Name')

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      expect(screen.getByText('Settings saved')).toBeInTheDocument()
    })

    // Verify save API was called with correct payload
    expect(mockApiFetchJson).toHaveBeenCalledTimes(2)
    const saveCall = mockApiFetchJson.mock.calls[1]
    expect(saveCall[0]).toBe('/api/v1/me/settings')
    expect(saveCall[1].method).toBe('PUT')
    expect(JSON.parse(saveCall[1].body)).toEqual({ display_name: 'New Name' })
  })

  it('saves a replacement Anthropic key using the scoped PI storage', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { user_id: 'user-123', email: 'user@test.com', display_name: 'Test User' },
    })
    mockListPiProviderKeyStatus.mockResolvedValueOnce(defaultProviderKeys)
    mockSetPiProviderKey.mockResolvedValueOnce({})

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Agent API Keys')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    const anthropicInput = within(anthropicField).getByPlaceholderText('Paste your Anthropic API key')
    fireEvent.change(anthropicInput, { target: { value: 'sk-ant-new-9999' } })
    fireEvent.click(within(anthropicField).getByRole('button', { name: 'Save Key' }))

    await waitFor(() => {
      expect(screen.getByText('Anthropic API key saved')).toBeInTheDocument()
    })
    expect(screen.getByText('Saved locally as sk-a...9999')).toBeInTheDocument()
    expect(mockSetPiProviderKey).toHaveBeenCalledWith('scope:user-123', 'anthropic', 'sk-ant-new-9999')
  })

  it('removes a stored Anthropic key', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { user_id: 'user-123', email: 'user@test.com', display_name: 'Test User' },
    })
    mockListPiProviderKeyStatus
      .mockResolvedValueOnce([
        {
          ...defaultProviderKeys[0],
          hasKey: true,
          maskedKey: 'sk-a...1234',
        },
        ...defaultProviderKeys.slice(1),
      ])

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Saved locally as sk-a...1234')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    fireEvent.click(within(anthropicField).getByRole('button', { name: 'Remove Key' }))

    await waitFor(() => {
      expect(screen.getByText('Anthropic API key removed')).toBeInTheDocument()
    })
    expect(mockRemovePiProviderKey).toHaveBeenCalledWith('scope:user-123', 'anthropic')
  })

  it('shows provider key save failure and clears pending state', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })
    mockSetPiProviderKey.mockRejectedValueOnce(new Error('save failed'))

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Agent API Keys')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    const anthropicInput = within(anthropicField).getByPlaceholderText('Paste your Anthropic API key')
    fireEvent.change(anthropicInput, { target: { value: 'sk-ant-fail-1234' } })
    fireEvent.click(within(anthropicField).getByRole('button', { name: 'Save Key' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save Anthropic API key')).toBeInTheDocument()
    })
    expect(within(anthropicField).getByRole('button', { name: 'Save Key' })).not.toBeDisabled()
  })

  it('shows provider key remove failure and clears pending state', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })
    mockListPiProviderKeyStatus.mockResolvedValueOnce([
      {
        ...defaultProviderKeys[0],
        hasKey: true,
        maskedKey: 'sk-a...1234',
      },
      ...defaultProviderKeys.slice(1),
    ])
    mockRemovePiProviderKey.mockRejectedValueOnce(new Error('remove failed'))

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Saved locally as sk-a...1234')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    fireEvent.click(within(anthropicField).getByRole('button', { name: 'Remove Key' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to remove Anthropic API key')).toBeInTheDocument()
    })
    expect(within(anthropicField).getByRole('button', { name: 'Remove Key' })).not.toBeDisabled()
  })

  it('shows provider key load failure without crashing the page', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })
    mockListPiProviderKeyStatus.mockRejectedValueOnce(new Error('storage failed'))

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load agent API keys')).toBeInTheDocument()
    })
  })

  it('validates empty provider key input before saving', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Agent API Keys')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    expect(within(anthropicField).getByRole('button', { name: 'Save Key' })).toBeDisabled()
    expect(mockSetPiProviderKey).not.toHaveBeenCalled()
  })

  it('uses a stable anonymous scope for unauthenticated provider keys', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })
    mockListPiProviderKeyStatus
      .mockResolvedValueOnce(defaultProviderKeys)

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Agent API Keys')).toBeInTheDocument()
    })

    const anthropicField = screen.getByText('Anthropic').closest('.settings-field')
    const anthropicInput = within(anthropicField).getByPlaceholderText('Paste your Anthropic API key')
    fireEvent.change(anthropicInput, { target: { value: 'sk-ant-anon-1234' } })
    fireEvent.click(within(anthropicField).getByRole('button', { name: 'Save Key' }))

    await waitFor(() => {
      expect(screen.getByText('Anthropic API key saved')).toBeInTheDocument()
    })

    expect(mockResolvePiProviderKeyScope).toHaveBeenCalledWith('')
    expect(mockSetPiProviderKey).toHaveBeenCalledWith('scope:anon-local', 'anthropic', 'sk-ant-anon-1234')
  })

  it('shows error message on save failure', async () => {
    mockApiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { email: 'user@test.com', display_name: 'Name' },
      })
      .mockRejectedValueOnce(new Error('Network error'))

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => {
      expect(screen.getByText('Failed to save')).toBeInTheDocument()
    })
  })

  it('renders sign out button when authenticated', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { email: 'user@test.com', display_name: '' },
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument()
    })
  })

  it('shows error state on API failure', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 500 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load user info')).toBeInTheDocument()
    })
  })

  it('shows back link to workspace when workspaceId provided', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage workspaceId="ws-123" />)

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })

    const backLink = screen.getByText('Back to workspace')
    expect(backLink.closest('a')).toHaveAttribute('href', '/w/ws-123/')
  })

  it('shows page title "User Settings"', async () => {
    mockApiFetchJson.mockResolvedValue({
      response: { ok: false, status: 401 },
      data: {},
    })

    render(<UserSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('User Settings')).toBeInTheDocument()
    })
  })
})
