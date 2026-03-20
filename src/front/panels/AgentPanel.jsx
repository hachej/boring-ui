import { useMemo } from 'react'
import { useCapabilitiesContext } from '../components/CapabilityGate'
import PiNativeAdapter from '../providers/pi/nativeAdapter'
import PiBackendAdapter from '../providers/pi/backendAdapter'
import PiSessionToolbar from '../providers/pi/PiSessionToolbar'
import { getPiServiceUrl, isPiBackendMode } from '../providers/pi/config'

export default function AgentPanel({ params }) {
  const {
    panelId,
    onSplitPanel,
    mode = 'frontend',
    piSessionBootstrap = 'latest',
    piInitialSessionId = '',
  } = params || {}
  const capabilities = useCapabilitiesContext()
  const backendMode = mode === 'backend'
  const backendTransportAvailable = backendMode && isPiBackendMode(capabilities)
  const serviceUrl = backendTransportAvailable ? getPiServiceUrl(capabilities) : ''

  const ready = useMemo(() => {
    if (!backendMode) return true
    // In backend mode, the PI agent is always available — PiBackendAdapter
    // falls back to same-origin routes when serviceUrl is empty.
    return true
  }, [backendMode, serviceUrl])

  return (
    <div className="panel-content terminal-panel-content agent-panel-content" data-testid="agent-panel">
      <div className="terminal-header">
        <div className="terminal-header-spacer" />
        <PiSessionToolbar panelId={panelId} onSplitPanel={onSplitPanel} />
      </div>
      <div className="terminal-body agent-body">
        <div className="agent-instance active">
          {ready ? (
            <div className="provider-agent provider-pi-native" data-testid="agent-app">
              {backendMode
                ? (
                  <PiBackendAdapter
                    serviceUrl={serviceUrl}
                    panelId={panelId}
                    sessionBootstrap={piSessionBootstrap}
                  />
                  )
                : (
                  <PiNativeAdapter
                    panelId={panelId}
                    sessionBootstrap={piSessionBootstrap}
                    initialSessionId={piInitialSessionId}
                  />
                  )}
            </div>
          ) : (
            <div data-testid="agent-connecting" className="agent-connecting-state">
              Connecting to agent...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
