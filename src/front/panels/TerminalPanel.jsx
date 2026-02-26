import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import Terminal from '../components/Terminal'
import ClaudeStreamChat from '../components/chat/ClaudeStreamChat'

const SESSION_STORAGE_KEY = 'kurt-web-terminal-sessions'
const ACTIVE_SESSION_KEY = 'kurt-web-terminal-active'
const CHAT_INTERFACE_KEY = 'kurt-web-terminal-chat-interface'
const DEFAULT_PROVIDER = 'claude'

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback: generate UUID v4 format using Math.random
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const loadSessions = () => {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

const loadActiveSession = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (!raw) return null
    const id = Number(raw)
    return Number.isNaN(id) ? null : id
  } catch {
    return null
  }
}

const normalizeSession = (session, fallbackId) => {
  const rest = session
  const id = Number(rest.id) || fallbackId
  // Always use claude as provider (migration from old codex sessions)
  return {
    ...rest,
    id,
    title: rest.title || `Session ${id}`,
    provider: DEFAULT_PROVIDER,
    sessionId: rest.sessionId || createSessionId(),
  }
}

const serializeSessions = (sessions) =>
  sessions.map((session) => {
    const persisted = { ...session }
    delete persisted.resume
    delete persisted.bannerMessage
    return persisted
  })

const getFileName = (path) => {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1]
}

export default function TerminalPanel({ params }) {
  const {
    panelId,
    onSplitPanel,
    approvals,
    onFocusReview,
    onDecision,
    normalizeApprovalPath,
  } = params || {}
  const terminalCounter = useRef(1)
  const [chatInterface, setChatInterface] = useState(() => {
    try {
      return localStorage.getItem(CHAT_INTERFACE_KEY) || 'web'
    } catch {
      return 'web'
    }
  })
  const [sessions, setSessions] = useState(() => {
    const saved = loadSessions()
    if (saved) {
      return saved.map((session, index) => ({
        ...normalizeSession(session, index + 1),
        resume: true,
      }))
    }
    return [
      {
        id: 1,
        title: 'Session 1',
        provider: DEFAULT_PROVIDER,
        sessionId: createSessionId(),
        resume: false,
      },
    ]
  })
  const [activeId, setActiveId] = useState(() => {
    const saved = loadActiveSession()
    if (saved) return saved
    if (saved === 0) return 0
    return null
  })

  const formatPrompt = useCallback((prompt) => {
    const cleaned = prompt.replace(/\s+/g, ' ').trim()
    if (!cleaned) return 'Session'
    return cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned
  }, [])

  const handleFirstPrompt = useCallback(
    (sessionId, prompt) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session
          if (!session.title.startsWith('Session')) return session
          return { ...session, title: formatPrompt(prompt) }
        }),
      )
    },
    [formatPrompt],
  )

  const addSession = () => {
    const nextId = terminalCounter.current + 1
    terminalCounter.current = nextId
    const next = {
      id: nextId,
      title: `Session ${nextId}`,
      provider: DEFAULT_PROVIDER,
      sessionId: createSessionId(),
      resume: false,
    }
    setSessions((prev) => [...prev, next])
    setActiveId(nextId)
  }

  const closeSession = (id) => {
    setSessions((prev) => {
      if (id == null) return prev
      const next = prev.filter((session) => session.id !== id)
      if (next.length === 0) {
        setActiveId(null)
        return next
      }
      if (id === activeId) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
  }

  const handleBannerShown = useCallback((id) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === id ? { ...session, bannerMessage: undefined } : session,
      ),
    )
  }, [])

  const handleResumeMissing = useCallback((id) => {
    // Session not found - restart with a new session ID and resume=false
    setSessions((prev) =>
      prev.map((session) =>
        session.id === id
          ? {
              ...session,
              sessionId: createSessionId(),
              resume: false,
            }
          : session,
      ),
    )
  }, [])

  useEffect(() => {
    const maxId = sessions.reduce((max, session) => Math.max(max, session.id), 1)
    terminalCounter.current = maxId
    if (!sessions.length) {
      setActiveId(null)
      return
    }
    if (!sessions.some((session) => session.id === activeId)) {
      setActiveId(sessions[0]?.id || 1)
    }
  }, [sessions, activeId])

  useEffect(() => {
    try {
      if (sessions.length === 0) {
        localStorage.removeItem(SESSION_STORAGE_KEY)
      } else {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(serializeSessions(sessions)))
      }
      if (activeId == null) {
        localStorage.removeItem(ACTIVE_SESSION_KEY)
      } else {
        localStorage.setItem(ACTIVE_SESSION_KEY, String(activeId))
      }
    } catch {
      // Ignore storage errors
    }
  }, [sessions, activeId])

  // Save chat interface preference
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_INTERFACE_KEY, chatInterface)
    } catch {
      // Ignore storage errors
    }
  }, [chatInterface])

  return (
    <div className="panel-content terminal-panel-content" data-testid="terminal-panel">
      <div className="terminal-header">
        {sessions.length === 0 ? (
          <>
            <span className="terminal-title-text">Agent</span>
            <div className="terminal-header-spacer" />
            <button
              type="button"
              className="terminal-icon-btn"
              onClick={() => {
                if (typeof onSplitPanel === 'function') {
                  onSplitPanel(panelId)
                  return
                }
                addSession()
              }}
              aria-label="Split chat panel"
              title="Split chat panel"
            >
              <Plus size={16} />
            </button>
          </>
        ) : (
          <>
            <select
              id="terminal-session-select"
              className="terminal-select"
              value={activeId ?? ''}
              onChange={(event) => setActiveId(Number(event.target.value))}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {`${session.title} - ${session.sessionId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            <div className="view-mode-toggle">
              <button
                type="button"
                className={`view-mode-btn ${chatInterface === 'cli' ? 'active' : ''}`}
                onClick={() => setChatInterface('cli')}
                title="CLI chat interface"
              >
                CLI
              </button>
              <button
                type="button"
                className={`view-mode-btn ${chatInterface === 'web' ? 'active' : ''}`}
                onClick={() => setChatInterface('web')}
                title="Web chat interface"
              >
                Web
              </button>
            </div>
            <div className="terminal-header-spacer" />
            <button
              type="button"
              className="terminal-icon-btn"
              onClick={() => {
                const active = sessions.find((s) => s.id === activeId)
                if (active?.sessionId) {
                  navigator.clipboard.writeText(active.sessionId)
                }
              }}
              title={sessions.find((s) => s.id === activeId)?.sessionId || 'Copy session ID'}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="terminal-icon-btn"
              onClick={() => {
                if (typeof onSplitPanel === 'function') {
                  onSplitPanel(panelId)
                  return
                }
                addSession()
              }}
              aria-label="Split chat panel"
              title="Split chat panel"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              className="terminal-icon-btn terminal-close-btn"
              onClick={() => closeSession(activeId)}
              title="Close session"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>
      {sessions.length > 0 && (
          <div className="terminal-body">
            {sessions.map((session) => {
              const isActive = session.id === activeId
              const className = `terminal-instance${isActive ? ' active' : ''}`

              // CLI: Show PTY terminal stream (render all but only active connects)
              if (chatInterface === 'cli') {
                return (
                  <div key={session.id} className={className}>
                    <Terminal
                      isActive={isActive}
                      provider={session.provider}
                      sessionId={session.sessionId}
                      sessionName={session.title}
                      resume={session.resume}
                      onSessionStarted={() => {
                        setSessions((prev) =>
                          prev.map((s) =>
                            s.id === session.id ? { ...s, resume: true } : s,
                          ),
                        )
                      }}
                      bannerMessage={session.bannerMessage}
                      onBannerShown={() => handleBannerShown(session.id)}
                      onResumeMissing={() => handleResumeMissing(session.id)}
                      onFirstPrompt={(prompt) => handleFirstPrompt(session.id, prompt)}
                    />
                  </div>
                )
              }

              // WEB: Only render the active session to avoid multiple WebSocket connections
              if (!isActive) {
                return <div key={session.id} className={className} />
              }

              return (
                <div key={session.id} className={className}>
                  <ClaudeStreamChat
                    initialSessionId={session.sessionId}
                    provider={session.provider}
                    resume={session.resume}
                    showSessionPicker={false}
                    onSessionStarted={(newSessionId) => {
                      if (!newSessionId) return
                      setSessions((prev) =>
                        prev.map((s) =>
                          s.id === session.id
                            ? {
                                ...s,
                                sessionId: newSessionId,
                                resume: true,
                              }
                            : s,
                        ),
                      )
                    }}
                  />
                </div>
              )
            })}
          </div>
      )}
      {Array.isArray(approvals) && approvals.length > 0 && (
        <div className="review-list">
          <div className="review-list-header">
            <span className="review-list-badge">{approvals.length}</span>
            Pending Reviews
          </div>
          <div className="review-list-items">
            {approvals.map((approval) => {
              const filePath = normalizeApprovalPath?.(approval) || approval.project_path || approval.file_path || ''
              const fileName = getFileName(filePath) || approval.tool_name || 'Review'
              return (
                <div
                  key={approval.id}
                  className="review-list-item"
                  onClick={() => onFocusReview?.(approval.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onFocusReview?.(approval.id)
                    }
                  }}
                >
                  <div className="review-list-item-info">
                    <span className="review-list-item-name">{fileName}</span>
                    {filePath && <span className="review-list-item-path">{filePath}</span>}
                  </div>
                  <div className="review-list-item-actions">
                    <button
                      type="button"
                      className="review-list-deny"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDecision?.(approval.id, 'deny')
                      }}
                      title="Deny"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className="review-list-allow"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDecision?.(approval.id, 'allow')
                      }}
                      title="Allow"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
