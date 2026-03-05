import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'

export default function CreateWorkspaceModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    if (trimmed.length > 100) {
      setError('Name must be 100 characters or fewer')
      return
    }

    setCreating(true)
    setError('')
    try {
      await onCreate(trimmed)
    } catch (err) {
      setError(err?.message || 'Failed to create workspace')
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Workspace</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <label className="settings-field-label" htmlFor="workspace-name">
              Workspace Name
            </label>
            <input
              id="workspace-name"
              ref={inputRef}
              type="text"
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              disabled={creating}
              autoComplete="off"
            />
            {error && <div className="modal-error">{error}</div>}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-btn settings-btn-primary"
              disabled={creating || !name.trim()}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
