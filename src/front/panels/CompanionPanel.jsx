import { useEffect, useMemo, useState } from 'react'
import { useCapabilitiesContext } from '../components/CapabilityGate'
import { setCompanionConfig } from '../providers/companion/config'
import CompanionAdapter from '../providers/companion/adapter'
import EmbeddedSessionToolbar from '../providers/companion/EmbeddedSessionToolbar'
import PiNativeAdapter from '../providers/pi/nativeAdapter'
import PiBackendAdapter from '../providers/pi/backendAdapter'
import PiSessionToolbar from '../providers/pi/PiSessionToolbar'
import { getPiServiceUrl, isPiBackendMode } from '../providers/pi/config'
import '../providers/companion/upstream.css'
import '../providers/companion/theme-bridge.css'

export default function CompanionPanel({ params }) {
  const {
    panelId,
    onSplitPanel,
    provider,
    lockProvider = false,
    piSessionBootstrap = 'latest',
    piInitialSessionId = '',
  } = params || {}
  const capabilities = useCapabilitiesContext()
  const initialProvider = provider === 'pi' ? 'pi' : 'companion'
  const companionAvailable = capabilities?.features?.companion === true
  const piAvailable = capabilities?.features?.pi === true
  const canSwitchProviders = !lockProvider && companionAvailable && piAvailable
  const [selectedProvider, setSelectedProvider] = useState(initialProvider)
  const activeProvider = canSwitchProviders ? selectedProvider : initialProvider
  const companionUrl = capabilities?.services?.companion?.url
  const piBackendEnabled = activeProvider === 'pi' && isPiBackendMode(capabilities)
  const piServiceUrl = piBackendEnabled ? getPiServiceUrl(capabilities) : ''

  useEffect(() => {
    setSelectedProvider(initialProvider)
  }, [initialProvider])

  const ready = useMemo(() => {
    if (activeProvider === 'pi') {
      return true
    }

    if (companionUrl) {
      setCompanionConfig(companionUrl, '')
      return true
    }

    // No explicit URL — use same-origin mode (companion proxied through backend)
    if (companionAvailable) {
      setCompanionConfig('', '')
      return true
    }

    return false
  }, [activeProvider, companionUrl, companionAvailable])

  return (
    <div className="panel-content terminal-panel-content companion-panel-content" data-testid="companion-panel">
      <div className="terminal-header">
        <span className="terminal-title-text">{activeProvider === 'pi' ? 'PI Agent' : 'Agent'}</span>
        {canSwitchProviders && (
          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              className={`px-2 py-0.5 text-xs rounded ${
                activeProvider === 'companion'
                  ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
              onClick={() => setSelectedProvider('companion')}
              aria-label="Use Agent provider"
            >
              Agent
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 text-xs rounded ${
                activeProvider === 'pi'
                  ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
              onClick={() => setSelectedProvider('pi')}
              aria-label="Use PI provider"
            >
              PI
            </button>
          </div>
        )}
        <div className="terminal-header-spacer" />
        {activeProvider === 'pi'
          ? <PiSessionToolbar panelId={panelId} onSplitPanel={onSplitPanel} />
          : <EmbeddedSessionToolbar panelId={panelId} onSplitPanel={onSplitPanel} />}
      </div>
      <div className="terminal-body companion-body">
        <div className="companion-instance active">
          {ready ? (
            activeProvider === 'pi'
              ? (
                <div className="provider-companion provider-pi-native" data-testid="pi-app">
                  {piBackendEnabled
                    ? (
                      <PiBackendAdapter
                        serviceUrl={piServiceUrl}
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
                )
              : (
                <div className="provider-companion" data-testid="companion-app">
                  <CompanionAdapter />
                </div>
                )
          ) : (
            <div
              data-testid="companion-connecting"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)' }}
            >
              Connecting to agent...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
