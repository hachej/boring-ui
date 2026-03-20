import { Loader2 } from 'lucide-react'

const paneLoadingStyle = {
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: '100%',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
}

export default function PaneLoadingState({ paneId, paneTitle }) {
  return (
    <div className="pane-loading-state" style={paneLoadingStyle} role="status" aria-live="polite">
      <Loader2 className="pane-loading-icon" size={36} />
      <h3 className="pane-loading-title">{paneTitle || paneId} Loading</h3>
      <p className="pane-loading-message">
        Waiting for backend capabilities. This should resolve automatically.
      </p>
    </div>
  )
}
