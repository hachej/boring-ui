import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the adapter component
vi.mock('../providers/companion/adapter', () => ({
  default: () => <div data-testid="mock-companion-app">MockCompanionApp</div>,
}))
vi.mock('../providers/companion/EmbeddedSessionToolbar', () => ({
  default: () => <div data-testid="mock-companion-toolbar">MockCompanionToolbar</div>,
}))
vi.mock('../providers/pi/PiSessionToolbar', () => ({
  default: () => <div data-testid="mock-pi-toolbar">MockPiToolbar</div>,
}))
vi.mock('../providers/pi/nativeAdapter', () => ({
  default: () => <div data-testid="mock-pi-native-app">MockPiNativeApp</div>,
}))
vi.mock('../providers/pi/backendAdapter', () => ({
  default: () => <div data-testid="mock-pi-backend-app">MockPiBackendApp</div>,
}))

// Mock CSS imports
vi.mock('../providers/companion/upstream.css', () => ({}))
vi.mock('../providers/companion/theme-bridge.css', () => ({}))
vi.mock('../providers/companion/overrides.css', () => ({}))

// Mock config module
const mockSetCompanionConfig = vi.fn()
vi.mock('../providers/companion/config', () => ({
  setCompanionConfig: (...args) => mockSetCompanionConfig(...args),
}))
const mockIsPiBackendMode = vi.fn(() => false)
const mockGetPiServiceUrl = vi.fn(() => '')
vi.mock('../providers/pi/config', () => ({
  isPiBackendMode: (...args) => mockIsPiBackendMode(...args),
  getPiServiceUrl: (...args) => mockGetPiServiceUrl(...args),
}))

// Mock CapabilityGate context
const mockCapabilities = { services: {} }
vi.mock('../components/CapabilityGate', () => ({
  useCapabilitiesContext: () => mockCapabilities,
}))

import CompanionPanel from './CompanionPanel'

describe('CompanionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapabilities.services = {}
    mockIsPiBackendMode.mockReturnValue(false)
    mockGetPiServiceUrl.mockReturnValue('')
  })

  it('shows connecting state when companion URL is not available', () => {
    mockCapabilities.services = {}

    render(<CompanionPanel params={{}} />)

    expect(screen.getByTestId('companion-connecting')).toBeTruthy()
    expect(screen.queryByTestId('companion-app')).toBeNull()
    expect(mockSetCompanionConfig).not.toHaveBeenCalled()
  })

  it('renders PI native adapter without companion URL wiring when provider is pi', () => {
    mockCapabilities.services = {}

    render(<CompanionPanel params={{ provider: 'pi' }} />)

    expect(screen.getByTestId('pi-app')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toBeTruthy()
    expect(mockSetCompanionConfig).not.toHaveBeenCalled()
  })

  it('renders CompanionApp when companion URL is available', () => {
    mockCapabilities.services = {
      companion: { url: 'http://localhost:3456' },
    }

    render(<CompanionPanel params={{}} />)

    expect(screen.getByTestId('companion-app')).toBeTruthy()
    expect(screen.queryByTestId('companion-connecting')).toBeNull()
    expect(mockSetCompanionConfig).toHaveBeenCalledWith('http://localhost:3456', '')
  })

  it('keeps PI provider isolated when both provider URLs exist', () => {
    mockCapabilities.services = {
      companion: { url: 'http://localhost:3456' },
      pi: { url: 'http://localhost:8787', mode: 'embedded' },
    }

    render(<CompanionPanel params={{ provider: 'pi' }} />)

    expect(screen.getByTestId('pi-app')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toBeTruthy()
    expect(mockSetCompanionConfig).not.toHaveBeenCalled()
  })

  it('renders PI backend adapter when PI backend mode is enabled', () => {
    mockCapabilities.services = {
      pi: { url: 'http://localhost:8789', mode: 'backend' },
    }
    mockIsPiBackendMode.mockReturnValue(true)
    mockGetPiServiceUrl.mockReturnValue('http://localhost:8789')

    render(<CompanionPanel params={{ provider: 'pi' }} />)

    expect(screen.getByTestId('pi-app')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-backend-app')).toBeTruthy()
    expect(screen.queryByTestId('mock-pi-native-app')).toBeNull()
    expect(mockSetCompanionConfig).not.toHaveBeenCalled()
  })

  it('renders panel content even when legacy collapsed params are provided', () => {
    render(<CompanionPanel params={{ collapsed: true, onToggleCollapse: vi.fn() }} />)

    expect(screen.getByTestId('companion-panel')).toBeTruthy()
    expect(screen.getByTestId('companion-connecting')).toBeTruthy()
  })

  it('does not render legacy collapse/expand controls', () => {
    const onToggleCollapse = vi.fn()
    render(<CompanionPanel params={{ collapsed: true, onToggleCollapse }} />)

    expect(screen.queryByRole('button', { name: 'Expand agent panel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse agent panel' })).toBeNull()
    expect(onToggleCollapse).not.toHaveBeenCalled()
  })

  it('calls setCompanionConfig before rendering CompanionApp', () => {
    mockCapabilities.services = {
      companion: { url: 'http://localhost:3456' },
    }

    render(<CompanionPanel params={{}} />)

    expect(mockSetCompanionConfig).toHaveBeenCalledTimes(1)
    expect(mockSetCompanionConfig).toHaveBeenCalledWith('http://localhost:3456', '')
    expect(screen.getByTestId('mock-companion-app')).toBeTruthy()
  })
})
