import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../providers/pi/PiSessionToolbar', () => ({
  default: () => <div data-testid="mock-pi-toolbar">MockPiToolbar</div>,
}))
vi.mock('../providers/pi/nativeAdapter', () => ({
  default: ({ panelId, sessionBootstrap, initialSessionId }) => (
    <div data-testid="mock-pi-native-app">
      {`MockPiNativeApp:${panelId}:${sessionBootstrap}:${initialSessionId}`}
    </div>
  ),
}))

import AgentPanel from './AgentPanel'

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the native PI adapter by default', () => {
    render(<AgentPanel params={{ panelId: 'panel-1' }} />)

    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toHaveTextContent('MockPiNativeApp:panel-1:latest:')
  })

  it('still renders the native PI adapter when backend mode params are present', () => {
    render(<AgentPanel params={{ panelId: 'panel-2', mode: 'backend' }} />)

    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-toolbar')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toBeTruthy()
    expect(screen.getByTestId('mock-pi-native-app')).toHaveTextContent('MockPiNativeApp:panel-2:latest:')
  })

  it('forwards session bootstrap props to the native adapter', () => {
    render(
      <AgentPanel
        params={{
          panelId: 'panel-3',
          mode: 'backend',
          piSessionBootstrap: 'new',
          piInitialSessionId: 'sess-123',
        }}
      />,
    )

    expect(screen.getByTestId('mock-pi-native-app')).toHaveTextContent('MockPiNativeApp:panel-3:new:sess-123')
  })
})
