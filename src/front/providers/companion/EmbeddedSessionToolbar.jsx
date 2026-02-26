import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from './upstream/api'
import { useStore } from './upstream/store'
import { connectSession, disconnectSession } from './upstream/ws'

const getSessionLabel = (session, sessionNames) => {
  const customName = sessionNames.get(session.sessionId)
  if (customName) return customName

  const cwdName = session.cwd?.split('/').filter(Boolean).pop()
  if (cwdName) return cwdName

  if (session.model) return session.model
  return session.sessionId.slice(0, 8)
}

export default function EmbeddedSessionToolbar({ panelId, onSplitPanel }) {
  const [isCreating, setIsCreating] = useState(false)
  const currentSessionId = useStore((s) => s.currentSessionId)
  const sdkSessions = useStore((s) => s.sdkSessions)
  const sessionNames = useStore((s) => s.sessionNames)
  const setCurrentSession = useStore((s) => s.setCurrentSession)
  const setSdkSessions = useStore((s) => s.setSdkSessions)

  const activeSessions = useMemo(
    () =>
      sdkSessions
        .filter((session) => !session.archived)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [sdkSessions],
  )

  const handleSelectSession = (nextSessionId) => {
    if (!nextSessionId || nextSessionId === currentSessionId) return

    if (currentSessionId) {
      disconnectSession(currentSessionId)
    }
    setCurrentSession(nextSessionId)
    connectSession(nextSessionId)
  }

  const handleCreateSession = async () => {
    if (isCreating) return
    setIsCreating(true)

    try {
      if (currentSessionId) {
        disconnectSession(currentSessionId)
      }

      const created = await api.createSession()
      setCurrentSession(created.sessionId)
      connectSession(created.sessionId)

      try {
        const sessions = await api.listSessions()
        setSdkSessions(sessions)
      } catch {
        // best effort refresh
      }
    } catch (err) {
      console.error('[Companion] Failed to create session', err)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="companion-session-toolbar">
      <select
        className="terminal-select companion-session-select"
        value={currentSessionId || ''}
        onChange={(e) => handleSelectSession(e.target.value)}
        data-testid="companion-session-select"
      >
        {activeSessions.length === 0 ? (
          <option value="">No sessions</option>
        ) : (
          activeSessions.map((session) => (
            <option key={session.sessionId} value={session.sessionId}>
              {getSessionLabel(session, sessionNames)}
            </option>
          ))
        )}
      </select>
      <button
        type="button"
        className="terminal-new-icon"
        onClick={() => {
          if (typeof onSplitPanel === 'function') {
            onSplitPanel(panelId)
            return
          }
          void handleCreateSession()
        }}
        title={typeof onSplitPanel === 'function' ? 'Split chat panel' : 'New Companion session'}
        aria-label={typeof onSplitPanel === 'function' ? 'Split chat panel' : 'New Companion session'}
        data-testid="companion-session-new"
        disabled={isCreating}
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
