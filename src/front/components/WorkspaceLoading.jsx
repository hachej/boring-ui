import { Loader2 } from 'lucide-react'

export default function WorkspaceLoading({ title = 'Opening workspace', message = 'Connecting to backend services...' }) {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <Loader2 className="workspace-loading-icon" size={28} />
      <p className="workspace-loading-title">{title}</p>
      <p className="workspace-loading-message">{message}</p>
    </div>
  )
}
