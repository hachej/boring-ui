import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../providers/pi/PiSessionToolbar', () => ({
  default: () => <div data-testid="mock-pi-toolbar">MockPiToolbar</div>,
}))
vi.mock('../providers/pi/nativeAdapter', () => ({
  default: () => <div data-testid="mock-pi-native-app">MockPiNativeApp</div>,
}))
vi.mock('../providers/pi/backendAdapter', () => ({
  default: () => <div data-testid="mock-pi-backend-app">MockPiBackendApp</div>,
}))

const mockIsPiBackendMode = vi.fn(() => false)
const mockGetPiServiceUrl = vi.fn(() => '')
vi.mock('../providers/pi/config', () => ({
  isPiBackendMode: (...args) => mockIsPiBackendMode(...args),
  getPiServiceUrl: (...args) => mockGetPiServiceUrl(...args),
}))

const mockCapabilities = { services: {}, features: { pi: true } }
vi.mock('../components/CapabilityGate', () => ({
  useCapabilitiesContext: () => mockCapabilities,
}))

import AgentPanel from './AgentPanel'

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapabilities.services = {}
    mockCapabilities.features = { pi: true }
    mockIsPiBackendMode.mockReturnValue(false)
    mockGetPiServiceUrl.mockReturnValue('')
  })

  it('renders the frontend PI adapter by default', () => {
    render(<AgentPanel params={{}} />)

    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toBeTruthy()
    expect(screen.queryByTestId('mock-pi-backend-app')).toBeNull()
  })

  it('renders the backend PI adapter when backend mode is configured', () => {
    mockCapabilities.services = {
      pi: { url: 'http://localhost:8789', mode: 'backend' },
    }
    mockIsPiBackendMode.mockReturnValue(true)
    mockGetPiServiceUrl.mockReturnValue('http://localhost:8789')

    render(<AgentPanel params={{ mode: 'backend' }} />)

    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-backend-app')).toBeTruthy()
    expect(screen.queryByTestId('mock-pi-native-app')).toBeNull()
  })

  it('still renders the backend PI adapter when backend mode lacks a service URL', () => {
    mockIsPiBackendMode.mockReturnValue(true)
    mockGetPiServiceUrl.mockReturnValue('')

    render(<AgentPanel params={{ mode: 'backend' }} />)

    expect(screen.getByTestId('mock-pi-backend-app')).toBeTruthy()
    expect(screen.queryByTestId('agent-connecting')).toBeNull()
  })
})
