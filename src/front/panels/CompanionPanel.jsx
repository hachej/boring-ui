import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  const { collapsed, onToggleCollapse, provider, lockProvider = false } = params || {}
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

  if (collapsed) {
    return (
      <div
        className="panel-content terminal-panel-content right-rail-panel companion-panel-content terminal-collapsed"
        data-testid="companion-panel-collapsed"
      >
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title="Expand agent panel"
          aria-label="Expand agent panel"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="sidebar-collapsed-label">{activeProvider === 'pi' ? 'PI Agent' : 'Companion'}</div>
      </div>
    )
  }

  return (
    <div className="panel-content terminal-panel-content right-rail-panel companion-panel-content" data-testid="companion-panel">
      <div className="terminal-header">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title="Collapse agent panel"
          aria-label="Collapse agent panel"
        >
          <ChevronRight size={16} />
        </button>
        <span className="terminal-title-text">{activeProvider === 'pi' ? 'PI Agent' : 'Companion'}</span>
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
              aria-label="Use Companion provider"
            >
              Companion
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
        {activeProvider === 'pi' ? <PiSessionToolbar /> : <EmbeddedSessionToolbar />}
      </div>
      <div className="terminal-body companion-body">
        <div className="companion-instance active">
          {ready ? (
            activeProvider === 'pi'
              ? (
                <div className="provider-companion provider-pi-native" data-testid="pi-app">
                  {piBackendEnabled
                    ? <PiBackendAdapter serviceUrl={piServiceUrl} />
                    : <PiNativeAdapter />}
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
              Connecting to Companion server...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
