import { useEffect, useRef, useState } from 'react'
import { useSessions } from '../hooks/useSessions'
import type { SessionSummary } from '../../shared/session'

const MAX_VISIBLE = 10

export interface SessionToolbarProps {
  sessionId: string
  onSessionChange: (id: string) => void
}

export function SessionToolbar({ sessionId, onSessionChange }: SessionToolbarProps) {
  const { sessions, loading, error, create, switch: switchTo, delete: remove } = useSessions()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const current = sessions.find((s) => s.id === sessionId)
  const recent = sessions.slice(0, MAX_VISIBLE)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function handleNew() {
    try {
      const session = await create()
      onSessionChange(session.id)
    } catch {
      // error surfaced via hook's error state
    } finally {
      setOpen(false)
    }
  }

  function handleSwitch(id: string) {
    switchTo(id)
    onSessionChange(id)
    setOpen(false)
  }

  async function handleDelete(e: React.MouseEvent, session: SessionSummary) {
    e.stopPropagation()
    if (!window.confirm(`Delete "${session.title}"?`)) return
    try {
      await remove(session.id)
      if (session.id === sessionId) {
        const next = sessions.find((s) => s.id !== session.id)
        if (next) onSessionChange(next.id)
      }
    } catch {
      // error surfaced via hook's error state
    }
  }

  return (
    <div ref={rootRef} className="session-toolbar" style={{ position: 'relative' }}>
      <button
        className="session-toolbar__trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="session-toolbar__title">
          {loading ? '…' : (current?.title ?? 'New session')}
        </span>
        <span aria-hidden="true" style={{ marginLeft: 4 }}>▾</span>
      </button>

      {error && (
        <span className="session-toolbar__error" role="alert" style={{ color: 'var(--boring-chat-error)', fontSize: 12, marginLeft: 8 }}>
          {error.message}
        </span>
      )}

      {open && (
        <div
          className="session-toolbar__dropdown"
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            minWidth: 200,
            background: 'var(--boring-chat-dropdown-bg)',
            border: '1px solid var(--boring-chat-dropdown-border)',
            borderRadius: 'var(--boring-chat-dropdown-radius)',
            boxShadow: 'var(--boring-chat-dropdown-shadow)',
            marginTop: 4,
          }}
        >
          {recent.map((s) => (
            <div
              key={s.id}
              className="session-toolbar__item"
              role="option"
              aria-selected={s.id === sessionId}
              tabIndex={0}
              onClick={() => handleSwitch(s.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSwitch(s.id) } }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                cursor: 'pointer',
                fontWeight: s.id === sessionId ? 600 : 400,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.title}
              </span>
              <button
                className="session-toolbar__delete"
                onClick={(e) => void handleDelete(e, s)}
                type="button"
                aria-label={`Delete ${s.title}`}
                style={{ marginLeft: 8, opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="session-toolbar__new"
            type="button"
            onClick={() => void handleNew()}
            style={{
              display: 'block',
              width: '100%',
              borderTop: '1px solid var(--boring-chat-dropdown-border)',
              padding: '6px 10px',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              borderTopWidth: 1,
              borderTopStyle: 'solid',
              borderTopColor: 'var(--boring-chat-dropdown-border)',
              textAlign: 'left',
            }}
          >
            + New chat
          </button>
        </div>
      )}
    </div>
  )
}
