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
    const unsubscribe = subscribePiSessionState((next) => {
      setState(next || defaultState)
    })

    requestPiSessionState()
    return unsubscribe
  }, [])

  const sessions = Array.isArray(state.sessions) ? state.sessions : []

  return (
    <div className="companion-session-toolbar" data-testid="pi-session-toolbar">
      <select
        className="terminal-select companion-session-select"
        value={state.currentSessionId || ''}
        onChange={(e) => requestPiSwitchSession(e.target.value)}
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
            onSplitPanel(panelId)
            return
          }
          requestPiNewSession()
        }}
        title={typeof onSplitPanel === 'function' ? 'Split chat panel' : 'New PI session'}
        aria-label={typeof onSplitPanel === 'function' ? 'Split chat panel' : 'New PI session'}
        data-testid="pi-session-new"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
