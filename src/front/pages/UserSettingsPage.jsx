import { useState, useEffect } from 'react'
import { Loader2, User, Palette, Shield } from 'lucide-react'
import { apiFetchJson } from '../utils/transport'
import { buildApiUrl } from '../utils/apiBase'
import { routes } from '../utils/routes'
import { useTheme } from '../hooks/useTheme'
import PageShell, { SettingsSection, SettingsField } from './PageShell'

export default function UserSettingsPage({ workspaceId }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const { theme, toggleTheme } = useTheme()

  const backRoute = workspaceId
    ? routes.controlPlane.workspaces.scope(workspaceId)
    : { path: '/', query: undefined }
  const backHref = backRoute.path

  useEffect(() => {
    const load = async () => {
      try {
        const meRoute = routes.controlPlane.me.get()
        const { response, data } = await apiFetchJson(meRoute.path, { query: meRoute.query })
        if (!response.ok) {
          if (response.status === 401) {
            // No active session — show settings without profile data.
            // Profile section will be hidden; theme/appearance still works.
            return
          }
          setError('Failed to load user info')
          return
        }
        setEmail(data.email || data.user?.email || '')
        setDisplayName(data.display_name || data.user?.display_name || '')
      } catch {
        // Backend unreachable — show settings without profile data
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      const settingsRoute = routes.controlPlane.me.settings
        ? routes.controlPlane.me.settings.update()
        : { path: '/api/v1/me/settings', query: undefined }
      await apiFetchJson(settingsRoute.path, {
        query: settingsRoute.query,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })
      setSaveMessage('Settings saved')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch {
      setSaveMessage('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    const route = routes.controlPlane.auth.logout()
    window.location.assign(buildApiUrl(route.path, route.query))
  }

  if (loading) {
    return (
      <PageShell title="User Settings" backHref={backHref}>
        <div className="page-loading">
          <Loader2 className="page-loading-icon" size={32} />
          <span>Loading settings...</span>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell title="User Settings" backHref={backHref}>
        <div className="page-error">{error}</div>
      </PageShell>
    )
  }

  const isAuthenticated = Boolean(email)

  return (
    <PageShell title="User Settings" backHref={backHref}>
      <div className="settings-card">
        {isAuthenticated && (
          <SettingsSection title="Profile" icon={User}>
            <SettingsField label="Email" description="Your account email address">
              <input
                type="email"
                className="settings-input"
                value={email}
                disabled
              />
            </SettingsField>
            <SettingsField label="Display Name">
              <input
                type="text"
                className="settings-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
              />
            </SettingsField>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              {saveMessage && (
                <span className={`settings-save-message ${saveMessage.includes('Failed') ? 'error' : 'success'}`}>
                  {saveMessage}
                </span>
              )}
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="Appearance" icon={Palette}>
          <SettingsField label="Theme" description="Choose light or dark mode">
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          </SettingsField>
        </SettingsSection>

        {isAuthenticated && (
          <SettingsSection title="Account" icon={Shield} danger>
            <SettingsField label="Sign Out" description="Sign out of your account">
              <button
                type="button"
                className="settings-btn settings-btn-danger"
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </SettingsField>
          </SettingsSection>
        )}
      </div>
    </PageShell>
  )
}
