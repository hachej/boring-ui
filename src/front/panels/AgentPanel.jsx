import PiNativeAdapter from '../providers/pi/nativeAdapter'
import PiSessionToolbar from '../providers/pi/PiSessionToolbar'

export default function AgentPanel({ params }) {
  const {
    panelId,
    onSplitPanel,
    piSessionBootstrap = 'latest',
    piInitialSessionId = '',
  } = params || {}

  return (
    <div className="panel-content agent-panel-content" data-testid="agent-panel">
      <div className="agent-header">
        <div className="agent-header-spacer" />
        <PiSessionToolbar panelId={panelId} onSplitPanel={onSplitPanel} />
      </div>
      <div className="agent-body">
        <div className="agent-instance active">
          <div className="provider-agent provider-pi-native" data-testid="agent-app">
            {/* Future runtimes can branch here via app config, but launch stays PI-only. */}
            <PiNativeAdapter
              panelId={panelId}
              sessionBootstrap={piSessionBootstrap}
              initialSessionId={piInitialSessionId}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
