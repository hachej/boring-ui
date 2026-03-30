import React from 'react'

/**
 * BrowseDrawer - Slides out from left, next to nav rail.
 *
 * Provides progressive-disclosure browsing for sessions and workspace.
 * Width: 220px, with slide animation.
 *
 * Props:
 *   open             - boolean  whether drawer is visible
 *   mode             - 'sessions' | 'workspace'
 *   sessions         - array of session metadata { id, title, lastModified, status }
 *   activeSessionId  - string|null
 *   onSwitchSession  - (id: string) => void
 *   onClose          - () => void
 */
export default function BrowseDrawer({
  open = false,
  mode = 'sessions',
  sessions = [],
  activeSessionId = null,
  onSwitchSession,
  onClose,
}) {
  if (!open) {
    return null
  }

  /**
   * Group sessions by recency: "Today", "Yesterday", "Earlier"
   * based on lastModified timestamp.
   */
  function groupSessionsByRecency(sessionList) {
    const now = Date.now()
    const oneDayMs = 86400000
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const yesterdayStart = new Date(todayStart.getTime() - oneDayMs)

    const groups = { Today: [], Yesterday: [], Earlier: [] }

    for (const session of sessionList) {
      const modified = session.lastModified || 0
      if (modified >= todayStart.getTime()) {
        groups.Today.push(session)
      } else if (modified >= yesterdayStart.getTime()) {
        groups.Yesterday.push(session)
      } else {
        groups.Earlier.push(session)
      }
    }

    return groups
  }

  return (
    <div className="browse-drawer" data-testid="browse-drawer">
      {mode === 'sessions' && (
        <>
          <div className="browse-drawer-head">History</div>
          <div className="browse-drawer-sessions" data-testid="browse-drawer-sessions">
            {sessions.length === 0 ? (
              <div className="browse-drawer-empty">No sessions yet</div>
            ) : (
              (() => {
                const groups = groupSessionsByRecency(sessions)
                return Object.entries(groups).map(([label, items]) => {
                  if (items.length === 0) return null
                  return (
                    <div key={label} className="browse-drawer-group">
                      <div className="browse-drawer-date" data-testid={`browse-drawer-date-${label.toLowerCase()}`}>
                        {label}
                      </div>
                      {items.map((session) => (
                        <button
                          key={session.id}
                          className={`browse-drawer-btn${session.id === activeSessionId ? ' active' : ''}`}
                          data-testid={`browse-drawer-session-${session.id}`}
                          onClick={() => onSwitchSession(session.id)}
                        >
                          <span className={`rail-session-dot ${session.status || 'idle'}`} />
                          <span className="browse-drawer-btn-label">{session.title}</span>
                        </button>
                      ))}
                    </div>
                  )
                })
              })()
            )}
          </div>
        </>
      )}

      {mode === 'workspace' && (
        <>
          <div className="browse-drawer-head">Workspace</div>
          <div className="browse-drawer-workspace" data-testid="browse-drawer-workspace">
            <div className="browse-drawer-placeholder">
              Files, Search, Git, Data
            </div>
          </div>
        </>
      )}
    </div>
  )
}
