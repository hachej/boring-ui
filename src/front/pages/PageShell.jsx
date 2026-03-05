import { ArrowLeft } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import ThemeToggle from '../components/ThemeToggle'

export default function PageShell({ title, children, backHref, backLabel = 'Back to workspace' }) {
  return (
    <div className="page-shell">
      <header className="page-shell-header">
        <div className="page-shell-header-left">
          {backHref && (
            <a href={backHref} className="page-shell-back">
              <ArrowLeft size={16} />
              <span>{backLabel}</span>
            </a>
          )}
        </div>
        <h1 className="page-shell-title">{title}</h1>
        <div className="page-shell-header-right">
          <ThemeToggle />
        </div>
      </header>
      <main className="page-shell-content">
        {children}
      </main>
    </div>
  )
}

export function SettingsSection({ title, description, children, danger = false }) {
  return (
    <section className={`settings-section ${danger ? 'settings-section-danger' : ''}`}>
      <div className="settings-section-header">
        <h2 className="settings-section-title">{title}</h2>
        {description && <p className="settings-section-description">{description}</p>}
      </div>
      <div className="settings-section-body">
        {children}
      </div>
    </section>
  )
}

export function SettingsField({ label, description, children }) {
  return (
    <div className="settings-field">
      <div className="settings-field-label-group">
        <label className="settings-field-label">{label}</label>
        {description && <span className="settings-field-description">{description}</span>}
      </div>
      <div className="settings-field-control">
        {children}
      </div>
    </div>
  )
}
