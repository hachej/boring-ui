import { Command, FileSearch } from 'lucide-react'
import { getConfig } from '../config'

export default function EmptyPanel() {
  const config = getConfig()
  const branding = config?.branding || {}
  const title = branding.emptyPanelTitle || 'No file selected'
  const message = branding.emptyPanelMessage || 'Open a file from the left pane to start'
  const hint = branding.emptyPanelHint
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? 'Cmd+P'
    : 'Ctrl+P'

  return (
    <div className="panel-content empty-panel">
      <div className="empty-panel-content empty-state">
        <span className="empty-state-icon-wrap empty-panel-icon" aria-hidden="true">
          <FileSearch size={48} />
        </span>
        <p className="empty-state-title">{title}</p>
        <p className="empty-state-message empty-panel-message">{message}</p>
        <p className="empty-state-hint empty-panel-hint">
          <Command size={14} aria-hidden="true" />
          <span>{hint || `${shortcut} to open quick file search`}</span>
        </p>
      </div>
    </div>
  )
}
