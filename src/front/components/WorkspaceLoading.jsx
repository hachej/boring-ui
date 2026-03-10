import { Loader2 } from 'lucide-react'

export default function WorkspaceLoading({ title = 'Opening workspace', message = 'Connecting to backend services...' }) {
  const containerStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    minHeight: '100dvh',
    margin: 0,
    textAlign: 'center',
    background: 'var(--color-bg-primary, #0f1115)',
  }

  return (
    <div
      className="workspace-loading"
      style={containerStyle}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="workspace-loading-icon" size={28} />
      <p className="workspace-loading-title">{title}</p>
      <p className="workspace-loading-message">{message}</p>
    </div>
  )
}
