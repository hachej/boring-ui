import { getConfig } from '../config'

export default function EmptyPanel() {
  const config = getConfig()
  const message = config?.branding?.emptyPanelMessage || 'Open a file from the left pane to start'
  return (
    <div className="panel-content empty-panel">
      <div className="empty-panel-content">
        <p>{message}</p>
      </div>
    </div>
  )
}
