import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CapabilitiesContext } from '../../components/CapabilityGate'
import { getPane } from '../../registry/panes'
import AgentPanel from '../../panels/AgentPanel'

vi.mock('../../providers/pi/PiSessionToolbar', () => ({
  default: ({ panelId }) => <div data-testid="pi-session-toolbar">toolbar:{panelId}</div>,
}))

vi.mock('../../providers/pi/nativeAdapter', () => ({
  default: ({ panelId, sessionBootstrap, initialSessionId }) => (
    <div data-testid="pi-native-adapter">
      native:{panelId}:{sessionBootstrap}:{initialSessionId}
    </div>
  ),
}))

const renderPanel = ({
  capabilities = { capabilities: { 'agent.chat': true }, services: {} },
  params = {},
} = {}) =>
  render(
    <CapabilitiesContext.Provider value={capabilities}>
      <AgentPanel
        params={{
          panelId: 'agent-panel-1',
          ...params,
        }}
      />
    </CapabilitiesContext.Provider>,
  )

describe('AgentPanel smoke', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PI_SERVICE_URL', '')
  })

  it('keeps the agent pane registry contract stable', () => {
    const config = getPane('agent')

    expect(config).toBeDefined()
    expect(config).toMatchObject({
      id: 'agent',
      essential: false,
      placement: 'right',
      requiresCapabilities: ['agent.chat'],
    })
  })

  it('renders the expected structural shell with the PI native adapter', () => {
    const { container } = renderPanel()

    expect(container.querySelector('.panel-content.agent-panel-content')).toBeInTheDocument()
    expect(container.querySelector('.agent-header')).toBeInTheDocument()
    expect(container.querySelector('.agent-body')).toBeInTheDocument()
    expect(container.querySelector('.agent-instance.active')).toBeInTheDocument()
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument()
    expect(screen.getByTestId('agent-app')).toBeInTheDocument()
    expect(screen.getByTestId('pi-session-toolbar')).toHaveTextContent('toolbar:agent-panel-1')
    expect(screen.getByTestId('pi-native-adapter')).toHaveTextContent('native:agent-panel-1:latest:')
  })

  it('keeps rendering the native adapter when backend mode params are passed', () => {
    renderPanel({
      capabilities: {
        capabilities: { 'agent.chat': true },
        services: {
          pi: { mode: 'backend', url: '/w/ws-123' },
        },
      },
      params: {
        mode: 'backend',
        piSessionBootstrap: 'new',
        piInitialSessionId: 'sess-42',
      },
    })

    expect(screen.getByTestId('pi-native-adapter')).toHaveTextContent('native:agent-panel-1:new:sess-42')
  })
})
