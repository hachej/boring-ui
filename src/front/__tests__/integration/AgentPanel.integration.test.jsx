/**
 * @vitest-environment jsdom
 */
import React from 'react'
import '../setup.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import AgentPanel from '../../panels/AgentPanel'
import {
  CapabilitiesContext,
  CapabilitiesStatusContext,
  createCapabilityGatedPane,
} from '../../components/CapabilityGate'

const mockPiNativeAdapter = vi.fn(({ panelId, sessionBootstrap, initialSessionId }) => (
  <div data-testid="pi-native-adapter">
    native:{panelId}:{sessionBootstrap}:{initialSessionId}
  </div>
))

const mockPiSessionToolbar = vi.fn(({ panelId, onSplitPanel }) => (
  <button
    type="button"
    data-testid="pi-session-toolbar"
    onClick={() => onSplitPanel?.('split-right')}
  >
    toolbar:{panelId}
  </button>
))

vi.mock('../../providers/pi/nativeAdapter', () => ({
  default: (props) => mockPiNativeAdapter(props),
}))

vi.mock('../../providers/pi/PiSessionToolbar', () => ({
  default: (props) => mockPiSessionToolbar(props),
}))

const GatedAgentPanel = createCapabilityGatedPane('agent', AgentPanel)

const renderGatedAgent = ({ capabilities, params = {}, pending = false }) =>
  render(
    <CapabilitiesStatusContext.Provider value={{ pending }}>
      <CapabilitiesContext.Provider value={capabilities}>
        <GatedAgentPanel
          params={{
            panelId: 'agent-panel-1',
            onSplitPanel: vi.fn(),
            ...params,
          }}
        />
      </CapabilitiesContext.Provider>
    </CapabilitiesStatusContext.Provider>,
  )

describe('AgentPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the PI native adapter when agent chat capability is available', () => {
    renderGatedAgent({
      capabilities: {
        capabilities: { 'agent.chat': true },
        services: {},
      },
      params: {
        piSessionBootstrap: 'latest',
        piInitialSessionId: 'sess-123',
      },
    })

    expect(screen.getByTestId('agent-panel')).toBeInTheDocument()
    expect(screen.getByTestId('pi-session-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('pi-native-adapter')).toHaveTextContent(
      'native:agent-panel-1:latest:sess-123',
    )
    expect(mockPiNativeAdapter.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        panelId: 'agent-panel-1',
        sessionBootstrap: 'latest',
        initialSessionId: 'sess-123',
      }),
    )
  })

  it('still renders the PI native adapter when backend mode params and backend service capabilities are present', () => {
    renderGatedAgent({
      capabilities: {
        capabilities: { 'agent.chat': true },
        services: {
          pi: {
            mode: 'backend',
            url: '/w/ws-123',
          },
        },
      },
      params: {
        mode: 'backend',
        piSessionBootstrap: 'new',
      },
    })

    expect(screen.getByTestId('agent-panel')).toBeInTheDocument()
    expect(screen.getByTestId('pi-session-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('pi-native-adapter')).toHaveTextContent(
      'native:agent-panel-1:new:',
    )
    expect(mockPiNativeAdapter.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        panelId: 'agent-panel-1',
        sessionBootstrap: 'new',
      }),
    )
  })

  it('shows the gated pane error state when pi capability is missing', () => {
    renderGatedAgent({
      capabilities: {
        capabilities: {},
        services: {},
      },
    })

    expect(screen.getByText('Agent Unavailable')).toBeInTheDocument()
    expect(screen.getByText('This panel requires backend capabilities that are not available.')).toBeInTheDocument()
    expect(screen.getByText('agent.chat')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-panel')).not.toBeInTheDocument()
  })

  it('forwards split-panel callbacks through PiSessionToolbar', () => {
    const onSplitPanel = vi.fn()
    renderGatedAgent({
      capabilities: {
        capabilities: { 'agent.chat': true },
        services: {},
      },
      params: {
        onSplitPanel,
      },
    })

    fireEvent.click(screen.getByTestId('pi-session-toolbar'))
    expect(onSplitPanel).toHaveBeenCalledWith('split-right')
  })
})
