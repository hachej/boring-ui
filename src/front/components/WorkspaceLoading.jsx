import { Loader2 } from 'lucide-react'

const workspaceLoadingStyle = {
  display: 'flex',
  flex: 1,
  width: '100%',
  height: '100%',
  minHeight: '100%',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
}

export default function WorkspaceLoading({ title = 'Opening workspace', message = 'Connecting to backend services...' }) {
  return (
    <div className="workspace-loading" style={workspaceLoadingStyle} role="status" aria-live="polite">
      <Loader2 className="workspace-loading-icon" size={28} />
      <p className="workspace-loading-title">{title}</p>
      <p className="workspace-loading-message">{message}</p>
    </div>
  )
}
