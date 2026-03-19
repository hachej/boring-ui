import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  requestPiNewSession,
  requestPiSessionState,
  requestPiSwitchSession,
  subscribePiSessionState,
} from './sessionBus'

const defaultState = {
  currentSessionId: '',
  sessions: [],
}

export default function PiSessionToolbar({ panelId, onSplitPanel }) {
  const [state, setState] = useState(defaultState)

  useEffect(() => {
    const unsubscribe = subscribePiSessionState(panelId, (next) => {
      setState(next || defaultState)
    })

    requestPiSessionState(panelId)
    return unsubscribe
  }, [panelId])

  const sessions = Array.isArray(state.sessions) ? state.sessions : []

  return (
    <div className="agent-session-toolbar" data-testid="pi-session-toolbar">
      <select
        className="terminal-select agent-session-select"
        value={state.currentSessionId || ''}
        onChange={(e) => requestPiSwitchSession(panelId, e.target.value)}
        data-testid="pi-session-select"
      >
        {sessions.length === 0
          ? <option value="">No sessions</option>
          : sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
      <button
        type="button"
        className="terminal-new-icon"
        onClick={() => {
          if (typeof onSplitPanel === 'function') {
            onSplitPanel(panelId, { piSessionBootstrap: 'new' })
            return
          }
          requestPiNewSession(panelId)
        }}
        title={typeof onSplitPanel === 'function' ? 'Split agent panel' : 'New agent session'}
        aria-label={typeof onSplitPanel === 'function' ? 'Split agent panel' : 'New agent session'}
        data-testid="pi-session-new"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
